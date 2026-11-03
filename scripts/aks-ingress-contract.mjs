#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SUPPORTED_MODES = ["private", "public-azure-load-balancer"];
const HEALTH_PROBE_PRIORITY = 100;
const DATA_PATH_PRIORITY = 110;
const VNET_PRIORITY = 120;
const DENY_PRIORITY = 4096;
const POSTCHECK_CHECK_ID = "network.aks-ingress.postcheck-current";
const MAX_POSTCHECK_AGE_MS = 15 * 60 * 1000;
const MAX_POSTCHECK_VALIDITY_MS = 30 * 60 * 1000;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function isIpv4Cidr(value) {
  const match = String(value).match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/,
  );
  return Boolean(match && match.slice(1, 5).every((part) => Number(part) <= 255));
}

function review(reason) {
  const error = new Error(reason);
  error.code = "network.aks-ingress.architecture-review";
  throw error;
}

function validateAksIngressDecision(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    review("AKS requires an explicit private or public Azure Load Balancer ingress decision.");
  }
  if (!SUPPORTED_MODES.includes(input.mode)) {
    review(`Unsupported AKS ingress mode: ${input.mode ?? "missing"}.`);
  }
  if (
    !input.healthProbe ||
    typeof input.healthProbe !== "object" ||
    Array.isArray(input.healthProbe) ||
    !Array.isArray(input.dataSourcePrefixes) ||
    !Array.isArray(input.reservedNsgPriorities)
  ) {
    review(
      "AKS ingress requires explicit health-probe, client source-prefix, and reserved-priority inputs.",
    );
  }
  const reserved = [...(input.reservedNsgPriorities ?? [])].sort((a, b) => a - b);
  if (
    reserved.some(
      (priority) =>
        !Number.isInteger(priority) || priority < 100 || priority > DENY_PRIORITY,
    )
  ) {
    review("Reserved NSG priorities must be unique integers from 100 through 4096.");
  }
  if (new Set(reserved).size !== reserved.length) {
    review("Reserved NSG priorities must be unique.");
  }
  const generatedPriorities =
    input.mode === "public-azure-load-balancer"
      ? [HEALTH_PROBE_PRIORITY, DATA_PATH_PRIORITY, VNET_PRIORITY, DENY_PRIORITY]
      : [VNET_PRIORITY, DENY_PRIORITY];
  const collision = generatedPriorities.find((priority) => reserved.includes(priority));
  if (collision !== undefined) {
    review(`AKS ingress NSG priority ${collision} conflicts with a reserved rule.`);
  }

  if (input.mode === "private") {
    if (
      input.serviceType !== "ClusterIP" ||
      input.frontendExposure !== "private" ||
      input.protocol !== "Tcp" ||
      input.frontendPort !== null ||
      input.backendNodePort !== null ||
      input.healthProbe?.sourcePrefix !== null ||
      input.healthProbe?.port !== null ||
      (input.dataSourcePrefixes ?? []).length !== 0
    ) {
      review(
        "Private AKS ingress supports ClusterIP only and forbids public LoadBalancer or NodePort exposure.",
      );
    }
  } else {
    if (
      input.serviceType !== "LoadBalancer" ||
      input.frontendExposure !== "public" ||
      input.protocol !== "Tcp"
    ) {
      review(
        "Public AKS ingress requires a TCP Service of type LoadBalancer with public frontend exposure.",
      );
    }
    if (![80, 443].includes(input.frontendPort)) {
      review("Public AKS ingress supports only an explicit HTTP or HTTPS frontend port.");
    }
    if (
      !Number.isInteger(input.backendNodePort) ||
      input.backendNodePort < 30000 ||
      input.backendNodePort > 32767
    ) {
      review("Public AKS ingress requires one exact NodePort in the Kubernetes 30000-32767 range.");
    }
    if (
      input.healthProbe?.sourcePrefix !== "AzureLoadBalancer" ||
      input.healthProbe?.port !== input.backendNodePort
    ) {
      review(
        "Public AKS ingress requires an AzureLoadBalancer health probe bound to the exact backend NodePort.",
      );
    }
    const sourcePrefixes = [...(input.dataSourcePrefixes ?? [])].sort();
    if (
      sourcePrefixes.length === 0 ||
      new Set(sourcePrefixes).size !== sourcePrefixes.length ||
      sourcePrefixes.some(
        (prefix) => prefix !== "Internet" && !isIpv4Cidr(prefix),
      )
    ) {
      review(
        "Public AKS ingress requires unique, proven client source prefixes using Internet or explicit IPv4 CIDRs.",
      );
    }
    if (
      sourcePrefixes.includes("AzureLoadBalancer") ||
      sourcePrefixes.includes("VirtualNetwork")
    ) {
      review("Health-probe or virtual-network prefixes cannot stand in for public client sources.");
    }
  }

  const normalized = {
    mode: input.mode,
    serviceType: input.serviceType,
    frontendExposure: input.frontendExposure,
    protocol: input.protocol,
    frontendPort: input.frontendPort,
    backendNodePort: input.backendNodePort,
    healthProbe: {
      sourcePrefix: input.healthProbe.sourcePrefix,
      port: input.healthProbe.port,
    },
    dataSourcePrefixes: [...input.dataSourcePrefixes].sort(),
    reservedNsgPriorities: reserved,
  };
  return {
    ...normalized,
    decisionDigest: digest(normalized),
    nsgRules: buildAksIngressNsgRules(normalized),
    postcheck: expectedAksIngressPostcheck(normalized),
  };
}

function buildAksIngressNsgRules(decision) {
  const rules = [];
  if (decision.mode === "public-azure-load-balancer") {
    rules.push(
      {
        name: "AllowAzureLoadBalancerHealthProbe",
        priority: HEALTH_PROBE_PRIORITY,
        direction: "Inbound",
        access: "Allow",
        protocol: "Tcp",
        sourceAddressPrefixes: ["AzureLoadBalancer"],
        destinationPort: decision.backendNodePort,
      },
      {
        name: "AllowApprovedPublicIngress",
        priority: DATA_PATH_PRIORITY,
        direction: "Inbound",
        access: "Allow",
        protocol: "Tcp",
        sourceAddressPrefixes: [...decision.dataSourcePrefixes],
        destinationPort: decision.backendNodePort,
      },
    );
  }
  rules.push(
    {
      name: "AllowVNetInbound",
      priority: VNET_PRIORITY,
      direction: "Inbound",
      access: "Allow",
      protocol: "*",
      sourceAddressPrefixes: ["VirtualNetwork"],
      destinationPort: "*",
    },
    {
      name: "DenyAllInbound",
      priority: DENY_PRIORITY,
      direction: "Inbound",
      access: "Deny",
      protocol: "*",
      sourceAddressPrefixes: ["*"],
      destinationPort: "*",
    },
  );
  return rules;
}

function expectedAksIngressPostcheck(decision) {
  return {
    contractVersion: "1.0.0",
    decisionDigest: digest({
      mode: decision.mode,
      serviceType: decision.serviceType,
      frontendExposure: decision.frontendExposure,
      protocol: decision.protocol,
      frontendPort: decision.frontendPort,
      backendNodePort: decision.backendNodePort,
      healthProbe: decision.healthProbe,
      dataSourcePrefixes: [...decision.dataSourcePrefixes].sort(),
      reservedNsgPriorities: [...decision.reservedNsgPriorities].sort((a, b) => a - b),
    }),
    serviceType: decision.serviceType,
    frontendExposure: decision.frontendExposure,
    frontendPort: decision.frontendPort,
    backendNodePort: decision.backendNodePort,
    expectedHealthState:
      decision.mode === "public-azure-load-balancer" ? "healthy" : "not-applicable",
    expectedReachability:
      decision.mode === "public-azure-load-balancer" ? "reachable" : "not-publicly-reachable",
    observedHealthState: "not-observed",
    observedReachability: "not-observed",
    observedAt: null,
    expiresAt: null,
    evidenceReference: null,
    liveConnectivityClaimed: false,
  };
}

function validateAksIngressPostcheck(
  postcheck,
  purpose,
  evaluatedAt = Date.now(),
  { expectedDecision } = {},
) {
  if (!["planning", "acceptance", "recovery"].includes(purpose)) {
    throw new Error("Postcheck purpose must be planning, acceptance, or recovery.");
  }
  let decision;
  try {
    decision = validateAksIngressDecision(expectedDecision);
  } catch {
    const error = new Error(
      "AKS ingress postchecks require the canonical reviewed ingress decision.",
    );
    error.code = "network.aks-ingress.postcheck-binding-required";
    error.checkId = POSTCHECK_CHECK_ID;
    throw error;
  }
  const expected = decision.postcheck;
  const staticFields = [
    "contractVersion",
    "decisionDigest",
    "serviceType",
    "frontendExposure",
    "frontendPort",
    "backendNodePort",
    "expectedHealthState",
    "expectedReachability",
  ];
  if (
    !postcheck ||
    staticFields.some(
      (field) => canonicalJson(postcheck[field]) !== canonicalJson(expected[field]),
    )
  ) {
    const error = new Error(
      "AKS ingress postcheck expectations do not match the reviewed ingress decision.",
    );
    error.code = "network.aks-ingress.postcheck-binding-mismatch";
    error.checkId = POSTCHECK_CHECK_ID;
    throw error;
  }
  if (purpose === "planning") {
    if (
      postcheck.observedHealthState !== "not-observed" ||
      postcheck.observedReachability !== "not-observed" ||
      postcheck.observedAt !== null ||
      postcheck.expiresAt !== null ||
      postcheck.evidenceReference !== null ||
      postcheck.liveConnectivityClaimed !== false
    ) {
      const error = new Error(
        "Planning postchecks must retain explicit not-observed placeholders and cannot claim live connectivity.",
      );
      error.code = "network.aks-ingress.live-evidence-not-observed";
      error.checkId = POSTCHECK_CHECK_ID;
      throw error;
    }
    return { status: "planned", liveConnectivityObserved: false };
  }
  const observedAt = Date.parse(postcheck.observedAt);
  const expiresAt = Date.parse(postcheck.expiresAt);
  if (
    postcheck.observedHealthState !== postcheck.expectedHealthState ||
    postcheck.observedReachability !== postcheck.expectedReachability ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(expiresAt) ||
    observedAt > evaluatedAt ||
    evaluatedAt - observedAt > MAX_POSTCHECK_AGE_MS ||
    expiresAt <= evaluatedAt ||
    observedAt >= expiresAt ||
    expiresAt - observedAt > MAX_POSTCHECK_VALIDITY_MS ||
    typeof postcheck.evidenceReference !== "string" ||
    postcheck.evidenceReference.length === 0 ||
    postcheck.liveConnectivityClaimed !== true ||
    postcheck.observedHealthState === "not-observed" ||
    postcheck.observedReachability === "not-observed"
  ) {
    const error = new Error(
      "Fresh observed health and reachability evidence is required for AKS ingress acceptance or recovery.",
    );
    error.code = "network.aks-ingress.postcheck-evidence-required";
    error.checkId = POSTCHECK_CHECK_ID;
    throw error;
  }
  return { status: "observed", liveConnectivityObserved: true };
}

async function main() {
  try {
    if (
      process.argv[2] !== "validate-postcheck" ||
      !process.argv[3] ||
      !process.argv[5]
    ) {
      throw new Error(
        "Usage: aks-ingress-contract.mjs validate-postcheck <postcheck-path> <planning|acceptance|recovery> <decision-path> [manifest-path approval-path]",
      );
    }
    const document = JSON.parse(readFileSync(process.argv[3], "utf8"));
    const purpose = process.argv[4] ?? "acceptance";
    const expectedDecision = JSON.parse(readFileSync(process.argv[5], "utf8"));
    let result;
    if (purpose === "planning") {
      result = validateAksIngressPostcheck(document, purpose, Date.now(), {
        expectedDecision,
      });
    } else {
      if (!process.argv[6] || !process.argv[7]) {
        throw new Error(
          "Acceptance and recovery validation require a manifest and signed approval.",
        );
      }
      const {
        readTrustedPublicKey,
        validateApprovedAksIngressPostcheck,
      } = await import("./startup-deployment-integration.mjs");
      result = validateApprovedAksIngressPostcheck({
        postcheck: document,
        purpose,
        expectedDecision,
        manifest: JSON.parse(readFileSync(process.argv[6], "utf8")),
        approval: JSON.parse(readFileSync(process.argv[7], "utf8")),
        publicKey: readTrustedPublicKey(
          "SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE",
          "network.aks-ingress.postcheck-trust-anchor",
          "AKS ingress acceptance and recovery require an absolute protected trusted approval public-key path.",
        ),
      });
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`AKS ingress validation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export {
  buildAksIngressNsgRules,
  canonicalJson,
  digest as aksIngressDigest,
  expectedAksIngressPostcheck,
  validateAksIngressDecision,
  validateAksIngressPostcheck,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
