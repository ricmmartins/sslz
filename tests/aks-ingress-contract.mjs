#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateAksIngressDecision,
  validateAksIngressPostcheck,
} from "../scripts/aks-ingress-contract.mjs";

function fixture(name) {
  return JSON.parse(
    readFileSync(resolve(`agent/examples/${name}.json`), "utf8"),
  );
}

function expectReview(input, pattern) {
  assert.throws(
    () => validateAksIngressDecision(input),
    (error) =>
      error.code === "network.aks-ingress.architecture-review" &&
      pattern.test(error.message),
  );
}

const privateDecision = validateAksIngressDecision(
  fixture("aks-ingress-private"),
);
assert.equal(privateDecision.mode, "private");
assert.deepEqual(
  privateDecision.nsgRules.map((rule) => rule.name),
  ["AllowVNetInbound", "DenyAllInbound"],
);
assert.equal(
  privateDecision.nsgRules.some(
    (rule) =>
      rule.sourceAddressPrefixes.includes("Internet") ||
      rule.sourceAddressPrefixes.includes("AzureLoadBalancer"),
  ),
  false,
);
assert.equal(privateDecision.postcheck.liveConnectivityClaimed, false);
assert.equal(privateDecision.postcheck.observedReachability, "not-observed");

const publicInput = fixture("aks-ingress-public");
const publicDecision = validateAksIngressDecision(publicInput);
assert.deepEqual(
  publicDecision.nsgRules,
  [
    {
      name: "AllowAzureLoadBalancerHealthProbe",
      priority: 100,
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      sourceAddressPrefixes: ["AzureLoadBalancer"],
      destinationPort: 30080,
    },
    {
      name: "AllowApprovedPublicIngress",
      priority: 110,
      direction: "Inbound",
      access: "Allow",
      protocol: "Tcp",
      sourceAddressPrefixes: ["Internet"],
      destinationPort: 30080,
    },
    {
      name: "AllowVNetInbound",
      priority: 120,
      direction: "Inbound",
      access: "Allow",
      protocol: "*",
      sourceAddressPrefixes: ["VirtualNetwork"],
      destinationPort: "*",
    },
    {
      name: "DenyAllInbound",
      priority: 4096,
      direction: "Inbound",
      access: "Deny",
      protocol: "*",
      sourceAddressPrefixes: ["*"],
      destinationPort: "*",
    },
  ],
);

expectReview(undefined, /explicit private or public/);
expectReview(
  { ...publicInput, mode: undefined },
  /Unsupported AKS ingress mode: missing/,
);
expectReview(
  {
    ...fixture("aks-ingress-private"),
    serviceType: "LoadBalancer",
    frontendExposure: "public",
    frontendPort: 80,
    backendNodePort: 30080,
  },
  /forbids public LoadBalancer or NodePort/,
);
expectReview(
  { ...publicInput, serviceType: "NodePort" },
  /requires a TCP Service of type LoadBalancer/,
);
expectReview(
  { ...publicInput, backendNodePort: 29999 },
  /one exact NodePort/,
);
expectReview(
  { ...publicInput, backendNodePort: "30000-32767" },
  /one exact NodePort/,
);
expectReview(
  { ...publicInput, reservedNsgPriorities: [110] },
  /priority 110 conflicts/,
);
expectReview(
  { ...publicInput, dataSourcePrefixes: ["AzureLoadBalancer"] },
  /unique, proven client source prefixes/,
);
expectReview(
  { ...publicInput, dataSourcePrefixes: ["203.0.113.999/24"] },
  /unique, proven client source prefixes/,
);
expectReview(
  { ...publicInput, healthProbe: { sourcePrefix: "Internet", port: 30080 } },
  /requires an AzureLoadBalancer health probe/,
);
expectReview(
  { ...publicInput, healthProbe: { sourcePrefix: "AzureLoadBalancer", port: 30081 } },
  /exact backend NodePort/,
);
expectReview(
  { ...publicInput, healthProbe: undefined },
  /explicit health-probe/,
);

assert.deepEqual(
  validateAksIngressPostcheck(publicDecision.postcheck, "planning", Date.now(), {
    expectedDecision: publicInput,
  }),
  { status: "planned", liveConnectivityObserved: false },
);
assert.throws(
  () =>
    validateAksIngressPostcheck(
      {
        ...publicDecision.postcheck,
        liveConnectivityClaimed: true,
      },
      "planning",
      Date.now(),
      { expectedDecision: publicInput },
    ),
  (error) =>
    error.code === "network.aks-ingress.live-evidence-not-observed",
);
assert.throws(
  () =>
    validateAksIngressPostcheck(
      publicDecision.postcheck,
      "acceptance",
      Date.parse("2026-08-10T10:00:00Z"),
      { expectedDecision: publicInput },
    ),
  (error) =>
    error.code === "network.aks-ingress.postcheck-evidence-required",
);
assert.throws(
  () =>
    validateAksIngressPostcheck(
      {
        ...publicDecision.postcheck,
        observedHealthState: "healthy",
        observedReachability: "reachable",
        observedAt: "2026-08-10T09:40:00Z",
        expiresAt: "2026-08-10T10:10:00Z",
        evidenceReference: "synthetic.postcheck.stale.001",
        liveConnectivityClaimed: true,
      },
      "acceptance",
      Date.parse("2026-08-10T10:00:00Z"),
      { expectedDecision: publicInput },
    ),
  (error) =>
    error.code === "network.aks-ingress.postcheck-evidence-required",
);
assert.throws(
  () =>
    validateAksIngressPostcheck(
      {
        ...publicDecision.postcheck,
        decisionDigest: `sha256:${"0".repeat(64)}`,
        observedHealthState: "healthy",
        observedReachability: "reachable",
        observedAt: "2026-08-10T09:55:00Z",
        expiresAt: "2026-08-10T10:10:00Z",
        evidenceReference: "synthetic.postcheck.replayed.001",
        liveConnectivityClaimed: true,
      },
      "acceptance",
      Date.parse("2026-08-10T10:00:00Z"),
      { expectedDecision: publicInput },
    ),
  (error) => error.code === "network.aks-ingress.postcheck-binding-mismatch",
);
assert.deepEqual(
  validateAksIngressPostcheck(
    {
      ...publicDecision.postcheck,
      observedHealthState: "healthy",
      observedReachability: "reachable",
      observedAt: "2026-08-10T09:55:00Z",
      expiresAt: "2026-08-10T10:10:00Z",
      evidenceReference: "synthetic.postcheck.public.001",
      liveConnectivityClaimed: true,
    },
    "acceptance",
    Date.parse("2026-08-10T10:00:00Z"),
    { expectedDecision: publicInput },
  ),
  { status: "observed", liveConnectivityObserved: true },
);

const source = readFileSync(
  resolve("scripts/aks-ingress-contract.mjs"),
  "utf8",
);
assert.doesNotMatch(source, /node:(?:child_process|http|https)/);
assert.doesNotMatch(
  source,
  /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/,
);
assert.doesNotMatch(source, /\baz\s+(?:account|provider|deployment|aks)\b/i);

console.log("AKS ingress decision and postcheck contracts passed.");
