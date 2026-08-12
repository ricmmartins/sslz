#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PLANNER_VERSION = "1.0.0";
const POSTGRESQL_CHECK_IDS = Object.freeze([
  "region.postgresql.edition-version-supported",
  "region.postgresql.extensions-supported",
  "quota.postgresql.eligible",
  "capacity.postgresql.available",
  "region.postgresql.recovery-supported",
  "workload.postgresql.provider-parity",
]);

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const inputSchema = load(
  "agent/schemas/postgresql-regional-plan-input.schema.json",
);
const outputSchema = load("agent/schemas/postgresql-regional-plan.schema.json");

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

function freshness(source, input) {
  const planningAt = Date.parse(input.planningAt);
  const observedAt = Date.parse(source.observedAt);
  const expiresAt = Date.parse(source.expiresAt);
  if (
    !Number.isFinite(planningAt) ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(expiresAt) ||
    observedAt > planningAt ||
    expiresAt <= planningAt
  ) {
    return "stale";
  }
  return planningAt - observedAt <= input.maxEvidenceAgeHours * 60 * 60 * 1000
    ? "current"
    : "stale";
}

function addReason(reasons, code, classification, summary) {
  reasons.push({ code, classification, summary });
}

function exactVersionSupported(evidence, requirements) {
  return evidence.supportedVersions.some(
    (version) =>
      version.major === requirements.engineVersion.major &&
      version.minor === requirements.engineVersion.minor,
  );
}

function exactEditionSupported(evidence, requirements) {
  return evidence.supportedEditions.some(
    (edition) =>
      edition.tier === requirements.tier && edition.sku === requirements.sku,
  );
}

function evaluateCandidate(input, evidence) {
  const reasons = [];
  const requirements = input.requirements;
  const evidenceFreshness = freshness(evidence.source, input);
  if (evidenceFreshness !== "current") {
    addReason(
      reasons,
      "postgresql.evidence.stale",
      "unresolved",
      "The PostgreSQL observation is stale, future-dated, or expired.",
    );
  }
  if (!input.allowedLocations.includes(evidence.region)) {
    addReason(
      reasons,
      "postgresql.policy.location-denied",
      "fail",
      "The candidate is outside the configured Allowed Locations set.",
    );
  }
  if (evidence.allowedByPolicy === false) {
    addReason(
      reasons,
      "postgresql.policy.denied",
      "fail",
      "Authoritative policy evidence denies PostgreSQL in this region.",
    );
  } else if (evidence.allowedByPolicy === null) {
    addReason(
      reasons,
      "postgresql.policy.unknown",
      "unresolved",
      "Policy eligibility is unknown.",
    );
  }
  if (!evidence.residencyBoundaries.includes(requirements.dataResidency)) {
    addReason(
      reasons,
      "postgresql.residency.rejected",
      "fail",
      "The region does not satisfy the required data-residency boundary.",
    );
  }
  if (evidence.serviceAvailability === "unavailable") {
    addReason(
      reasons,
      "postgresql.service.unavailable",
      "fail",
      "PostgreSQL Flexible Server is unavailable in this region.",
    );
  } else if (evidence.serviceAvailability === "unknown") {
    addReason(
      reasons,
      "postgresql.service.unknown",
      "unresolved",
      "PostgreSQL Flexible Server availability is unknown.",
    );
  }
  if (!exactEditionSupported(evidence, requirements)) {
    addReason(
      reasons,
      "postgresql.edition.unsupported",
      "fail",
      `The exact ${requirements.tier}/${requirements.sku} selection is unsupported.`,
    );
  }
  if (!exactVersionSupported(evidence, requirements)) {
    addReason(
      reasons,
      "postgresql.version.unsupported",
      "fail",
      `The exact PostgreSQL ${requirements.engineVersion.major}.${requirements.engineVersion.minor} version is unsupported.`,
    );
  }
  const missingExtensions = requirements.extensions.filter(
    (extension) => !evidence.supportedExtensions.includes(extension),
  );
  if (missingExtensions.length > 0) {
    addReason(
      reasons,
      "postgresql.extension.unsupported",
      "fail",
      `Required extensions are unsupported: ${missingExtensions.join(", ")}.`,
    );
  }
  if (
    requirements.zoneRedundant &&
    (!evidence.zoneSupport.available ||
      evidence.zoneSupport.zones.length < requirements.minimumZones)
  ) {
    addReason(
      reasons,
      "postgresql.zone.unsupported",
      "fail",
      "The required zone-redundant topology is unsupported.",
    );
  }
  if (
    evidence.recovery.minimumRtoMinutes > requirements.rtoMinutes ||
    evidence.recovery.minimumRpoMinutes > requirements.rpoMinutes
  ) {
    addReason(
      reasons,
      "postgresql.recovery.unmet",
      "fail",
      "Observed PostgreSQL recovery capability does not meet the RTO/RPO constraints.",
    );
  }
  if (
    evidence.quota.status === "shortage" ||
    evidence.quota.available < evidence.quota.required
  ) {
    addReason(
      reasons,
      "postgresql.quota.shortage",
      "fail",
      "Eligible quota is below the exact selected SKU requirement.",
    );
  } else if (evidence.quota.status === "unknown") {
    addReason(
      reasons,
      "postgresql.quota.unknown",
      "unresolved",
      "Quota eligibility is unknown.",
    );
  }
  if (evidence.capacity.status === "unavailable") {
    addReason(
      reasons,
      "postgresql.capacity.unavailable",
      "fail",
      "Point-in-time capacity for the exact selection is unavailable.",
    );
  } else if (evidence.capacity.status === "unknown") {
    addReason(
      reasons,
      "postgresql.capacity.unknown",
      "unresolved",
      "Point-in-time capacity is unknown.",
    );
  }
  if (evidence.estimatedMonthlyCost > requirements.monthlyCostCeiling) {
    addReason(
      reasons,
      "postgresql.cost.ceiling-exceeded",
      "fail",
      "The point-in-time estimate exceeds the configured monthly cost ceiling.",
    );
  }

  const failures = reasons.filter((reason) => reason.classification === "fail");
  const unresolved = reasons.filter(
    (reason) => reason.classification === "unresolved",
  );
  const eligible =
    failures.length === 0 &&
    unresolved.length === 0 &&
    evidenceFreshness === "current";
  const evidenceDigest = digest(evidence);
  return {
    region: evidence.region,
    preferenceRank: evidence.preferenceRank,
    disposition: eligible
      ? "eligible"
      : failures.length > 0
        ? "rejected"
        : "unresolved",
    reasons: reasons.sort((left, right) => left.code.localeCompare(right.code)),
    evidenceDigest,
    evidence: {
      serviceAvailability: evidence.serviceAvailability,
      supportedEditions: evidence.supportedEditions,
      supportedVersions: evidence.supportedVersions,
      supportedExtensions: evidence.supportedExtensions,
      zoneSupport: evidence.zoneSupport,
      quota: evidence.quota,
      capacity: evidence.capacity,
      allowedByPolicy: evidence.allowedByPolicy,
      residencyBoundaries: evidence.residencyBoundaries,
      recovery: evidence.recovery,
      estimatedMonthlyCost: evidence.estimatedMonthlyCost,
      source: evidence.source,
      freshness: evidenceFreshness,
    },
    exactSelection: {
      tier: requirements.tier,
      sku: requirements.sku,
      engineVersion: requirements.engineVersion,
      extensions: [...requirements.extensions].sort(),
      zoneRedundant: requirements.zoneRedundant,
    },
    capacityReservationClaimed: false,
  };
}

function providerParameters(input, selectedRegion, selectedEvidenceDigest) {
  const common = {
    deploymentBoundary: "planning-only",
    location: selectedRegion,
    tier: input.requirements.tier,
    sku: input.requirements.sku,
    engineMajorVersion: input.requirements.engineVersion.major,
    engineMinorVersion: input.requirements.engineVersion.minor,
    extensions: [...input.requirements.extensions].sort(),
    zoneRedundant: input.requirements.zoneRedundant,
    evidenceDigest: selectedEvidenceDigest,
    capacityReservationClaimed: false,
  };
  return {
    bicep: common,
    terraform: Object.fromEntries(
      Object.entries(common).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    ),
  };
}

function planPostgresql(input) {
  validateDocument(inputSchema, input);
  const candidates = input.evidence
    .map((item) => evaluateCandidate(input, item))
    .sort((left, right) => {
      const dispositionRank = { eligible: 0, unresolved: 1, rejected: 2 };
      return (
        dispositionRank[left.disposition] -
          dispositionRank[right.disposition] ||
        left.preferenceRank - right.preferenceRank ||
        left.evidence.estimatedMonthlyCost -
          right.evidence.estimatedMonthlyCost ||
        left.region.localeCompare(right.region)
      );
    });
  const target = candidates.find(
    (candidate) => candidate.region === input.targetRegion,
  );
  const selected =
    target?.disposition === "eligible"
      ? target
      : candidates.find(
          (candidate) =>
            candidate.disposition === "eligible" &&
            candidate.region !== input.targetRegion,
        ) ?? null;
  const status = !selected
    ? "blocked"
    : selected.region === input.targetRegion
      ? "ready"
      : "fallback-required";
  const fallback = {
    required: status === "fallback-required",
    fromRegion: input.targetRegion,
    toRegion: status === "fallback-required" ? selected.region : null,
    rationale:
      status === "fallback-required"
        ? target
          ? target.reasons.map((reason) => reason.code)
          : ["postgresql.target.evidence-missing"]
        : [],
    requiresNewPlanArtifactsManifestApproval: status === "fallback-required",
  };
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    planId: input.planId,
    status,
    targetRegion: input.targetRegion,
    selectedRegion: selected?.region ?? null,
    requirements: {
      ...input.requirements,
      extensions: [...input.requirements.extensions].sort(),
    },
    candidates,
    fallback,
    selectedEvidenceDigest: selected?.evidenceDigest ?? null,
    providerParameters:
      selected === null
        ? null
        : providerParameters(input, selected.region, selected.evidenceDigest),
    deploymentBoundary: "planning-only",
    azureOperations: "none",
    capacityReservationClaimed: false,
    decisionDigest: "sha256:pending",
  };
  plan.decisionDigest = digest(
    Object.fromEntries(
      Object.entries(plan).filter(([key]) => key !== "decisionDigest"),
    ),
  );
  validateDocument(outputSchema, plan);
  return plan;
}

function parseArguments(args) {
  if (args[0] !== "plan") {
    throw new Error(
      "Usage: startup-postgresql-plan.mjs plan --input <path> [--output json]",
    );
  }
  let inputPath = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--input") {
      inputPath = args[index + 1];
      index += 1;
    } else if (args[index] === "--output" && args[index + 1] === "json") {
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${args[index]}`);
    }
  }
  if (!inputPath) {
    throw new Error("--input is required.");
  }
  return { inputPath };
}

function main() {
  try {
    const { inputPath } = parseArguments(process.argv.slice(2));
    const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    const plan = planPostgresql(input);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = plan.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  POSTGRESQL_CHECK_IDS,
  canonicalJson,
  digest as postgresqlDecisionDigest,
  planPostgresql,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
