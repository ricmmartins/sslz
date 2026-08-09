#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.1.0";
const PLANNER_VERSION = "1.1.0";
const PROFILE_ORDER = [
  "container-apps",
  "aks",
  "postgresql",
  "foundry",
  "gpu",
];
const CHECK_IDS = {
  policy: "region.policy.allowed-locations",
  services: "region.services.available",
  zones: "region.availability-zones.supported",
  skus: "region.skus.eligible",
  quota: "quota.workload.headroom",
  capacity: "capacity.workload.available",
  foundry: "region.foundry-model.available",
  residency: "region.data-residency.compatible",
  addressSpace: "network.regional-address-space.non-overlapping",
};
const CHECK_ORDER = [
  CHECK_IDS.policy,
  CHECK_IDS.services,
  CHECK_IDS.zones,
  CHECK_IDS.skus,
  CHECK_IDS.quota,
  CHECK_IDS.capacity,
  CHECK_IDS.foundry,
  CHECK_IDS.residency,
  CHECK_IDS.addressSpace,
];

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const regionalInputSchema = load(
  "agent/schemas/regional-planning-input.schema.json",
);
const profiles = Object.fromEntries(
  PROFILE_ORDER.map((id) => [id, load(`agent/profiles/${id}.json`)]),
);

function unique(values) {
  return [...new Set(values)];
}

function evidenceFreshness(observedAt, input) {
  if (!observedAt) {
    return "unresolved";
  }

  const ageMilliseconds =
    Date.parse(input.planningAt) - Date.parse(observedAt);
  if (ageMilliseconds < 0) {
    return "unresolved";
  }

  return ageMilliseconds > input.maxEvidenceAgeHours * 60 * 60 * 1000
    ? "stale"
    : "current";
}

function check(input, id, classification, observedAt, summary) {
  if (classification === "not-required") {
    return {
      id,
      classification,
      freshness: "not-applicable",
      evidenceTimestamp: null,
      summary,
    };
  }

  return {
    id,
    classification,
    freshness: evidenceFreshness(observedAt, input),
    evidenceTimestamp: observedAt ?? null,
    summary,
  };
}

function classificationFromBoolean(value) {
  if (value === null || value === undefined) {
    return "unresolved";
  }
  return value ? "pass" : "fail";
}

function parseIpv4Cidr(cidr) {
  const [address, prefixText] = cidr.split("/");
  const octets = address.split(".").map(Number);
  const prefix = Number(prefixText);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return null;
  }

  const numericAddress = octets.reduce(
    (value, octet) => value * 256 + octet,
    0,
  );
  const blockSize = 2 ** (32 - prefix);
  const start = Math.floor(numericAddress / blockSize) * blockSize;
  return { start, end: start + blockSize - 1 };
}

function cidrsOverlap(first, second) {
  const firstRange = parseIpv4Cidr(first);
  const secondRange = parseIpv4Cidr(second);
  if (!firstRange || !secondRange) {
    return null;
  }
  return (
    firstRange.start <= secondRange.end &&
    secondRange.start <= firstRange.end
  );
}

function selectedProfileDefinitions(workloadPlan) {
  const selectedIds = [
    workloadPlan.computeProfile,
    ...workloadPlan.profileExtensions,
  ].filter(Boolean);
  return selectedIds.map((id) => {
    if (!profiles[id]) {
      throw new Error(`Unsupported workload profile: ${id}`);
    }
    return profiles[id];
  });
}

function buildRequirements(input) {
  const selectedProfiles = selectedProfileDefinitions(input.workloadPlan);
  const regionalDefinitions = selectedProfiles.map(
    (profile) => profile.regionalRequirements,
  );
  const services = unique([
    ...regionalDefinitions.flatMap((definition) => definition.services),
    ...[...input.regionalRequirements.additionalRequiredServices].sort(),
  ]);

  return {
    services,
    requireAvailabilityZones:
      input.regionalRequirements.requireAvailabilityZones,
    requireComputeSku: regionalDefinitions.some(
      (definition) => definition.computeSkuEvidence,
    ),
    requireGpuSku: regionalDefinitions.some(
      (definition) => definition.gpuSkuEvidence,
    ),
    requireFoundry: regionalDefinitions.some(
      (definition) => definition.foundryDeploymentEvidence,
    ),
  };
}

function missingEvidenceCandidate(input, region, role, preferenceRank) {
  const checks = CHECK_ORDER.map((id) =>
    check(input, id, "unresolved", null, `No supplied evidence exists for ${region}.`),
  );
  return finalizeCandidate(
    {
      region,
      rank: 1,
      role,
      checks,
      alternateOptions: [],
      proposedVnetCidr: "unresolved",
      estimatedMonthlyCost: 0,
    },
    preferenceRank,
    0,
  );
}

function skuCheck(input, evidence, requirements) {
  if (!requirements.requireComputeSku && !requirements.requireGpuSku) {
    return check(
      input,
      CHECK_IDS.skus,
      "not-required",
      null,
      "The selected profile does not require regional VM SKU evidence.",
    );
  }

  const missingSelections = [];
  const ineligibleSelections = [];
  if (requirements.requireComputeSku) {
    const computeSku = input.regionalRequirements.computeSku;
    if (!computeSku) {
      missingSelections.push("compute SKU");
    } else if (!evidence.eligibleComputeSkus.includes(computeSku)) {
      ineligibleSelections.push(computeSku);
    }
  }
  if (requirements.requireGpuSku) {
    const gpuSku = input.regionalRequirements.gpuSku;
    if (!gpuSku) {
      missingSelections.push("GPU SKU");
    } else if (!evidence.eligibleGpuSkus.includes(gpuSku)) {
      ineligibleSelections.push(gpuSku);
    }
  }

  if (missingSelections.length > 0) {
    return check(
      input,
      CHECK_IDS.skus,
      "unresolved",
      evidence.observedAt,
      `No ${missingSelections.join(" or ")} was selected for eligibility evaluation.`,
    );
  }
  if (ineligibleSelections.length > 0) {
    return check(
      input,
      CHECK_IDS.skus,
      "fail",
      evidence.observedAt,
      `The selected SKU evidence is ineligible: ${ineligibleSelections.join(", ")}.`,
    );
  }
  return check(
    input,
    CHECK_IDS.skus,
    "pass",
    evidence.observedAt,
    "The selected compute and GPU SKUs are eligible.",
  );
}

function quotaCheck(input, evidence) {
  const { required, available, unit } = evidence.quota;
  if (required === null || available === null) {
    return check(
      input,
      CHECK_IDS.quota,
      "unresolved",
      evidence.observedAt,
      `Quota evidence in ${unit} is incomplete.`,
    );
  }
  if (available < required) {
    return check(
      input,
      CHECK_IDS.quota,
      "fail",
      evidence.observedAt,
      `Quota headroom is insufficient: ${available} ${unit} available, ${required} required.`,
    );
  }
  return check(
    input,
    CHECK_IDS.quota,
    "pass",
    evidence.observedAt,
    `Quota headroom is sufficient: ${available} ${unit} available, ${required} required.`,
  );
}

function capacityCheck(input, evidence) {
  const classifications = {
    available: "pass",
    unavailable: "fail",
    unknown: "unresolved",
  };
  const summaries = {
    available:
      "Point-in-time capacity evidence reports availability; this is not a reservation.",
    unavailable:
      "Point-in-time capacity evidence reports that the selected capacity is unavailable.",
    unknown: "Point-in-time capacity availability is unresolved.",
  };
  return check(
    input,
    CHECK_IDS.capacity,
    classifications[evidence.capacity.status],
    evidence.capacity.observedAt,
    summaries[evidence.capacity.status],
  );
}

function foundryCheck(input, evidence, requirements) {
  if (!requirements.requireFoundry) {
    return check(
      input,
      CHECK_IDS.foundry,
      "not-required",
      null,
      "The selected workload profile does not require Foundry deployment evidence.",
    );
  }

  const selection = input.regionalRequirements.foundry;
  if (!selection) {
    return check(
      input,
      CHECK_IDS.foundry,
      "unresolved",
      evidence.observedAt,
      "The required Foundry model and deployment type were not selected.",
    );
  }

  const deployment = evidence.foundryDeployments.find(
    (item) =>
      item.model === selection.model &&
      item.deploymentType === selection.deploymentType,
  );
  if (!deployment) {
    return check(
      input,
      CHECK_IDS.foundry,
      "fail",
      evidence.observedAt,
      `${selection.model} with ${selection.deploymentType} has no availability evidence in this region.`,
    );
  }

  return check(
    input,
    CHECK_IDS.foundry,
    classificationFromBoolean(deployment.available),
    evidence.observedAt,
    deployment.available === true
      ? `${selection.model} with ${selection.deploymentType} is available.`
      : deployment.available === false
        ? `${selection.model} with ${selection.deploymentType} is unavailable.`
        : `${selection.model} with ${selection.deploymentType} availability is unresolved.`,
  );
}

function addressSpaceCheck(input, evidence, role, primaryEvidence) {
  if (
    role === "primary" ||
    input.startupInput.reliability.regionalMode === "single-region-ready"
  ) {
    return check(
      input,
      CHECK_IDS.addressSpace,
      "not-required",
      null,
      "Cross-region address-space validation is not required for this candidate role and mode.",
    );
  }
  if (!primaryEvidence) {
    return check(
      input,
      CHECK_IDS.addressSpace,
      "unresolved",
      evidence.observedAt,
      "A primary VNet proposal is required before secondary overlap can be evaluated.",
    );
  }

  const overlap = cidrsOverlap(
    primaryEvidence.proposedVnetCidr,
    evidence.proposedVnetCidr,
  );
  if (overlap === null) {
    return check(
      input,
      CHECK_IDS.addressSpace,
      "unresolved",
      evidence.observedAt,
      "One or both proposed VNet CIDRs are invalid.",
    );
  }
  return check(
    input,
    CHECK_IDS.addressSpace,
    overlap ? "fail" : "pass",
    evidence.observedAt,
    overlap
      ? "The proposed secondary VNet overlaps the selected primary VNet."
      : "The proposed secondary VNet does not overlap the selected primary VNet.",
  );
}

function evaluateCandidate(
  input,
  evidence,
  region,
  role,
  preferenceRank,
  requirements,
  primaryEvidence,
) {
  if (!evidence) {
    return missingEvidenceCandidate(input, region, role, preferenceRank);
  }

  const missingServices = requirements.services.filter(
    (service) => !evidence.availableServices.includes(service),
  );
  const policyClassification = classificationFromBoolean(
    evidence.allowedByPolicy,
  );
  const zoneClassification = requirements.requireAvailabilityZones
    ? classificationFromBoolean(evidence.availabilityZonesSupported)
    : "not-required";
  const residencyBoundary = input.startupInput.reliability.dataResidency;
  const checks = [
    check(
      input,
      CHECK_IDS.policy,
      policyClassification,
      evidence.observedAt,
      policyClassification === "pass"
        ? "Allowed-location policy permits this region."
        : policyClassification === "fail"
          ? "Allowed-location policy rejects this region."
          : "Allowed-location policy evidence is unresolved.",
    ),
    check(
      input,
      CHECK_IDS.services,
      missingServices.length === 0 ? "pass" : "fail",
      evidence.observedAt,
      missingServices.length === 0
        ? "All selected-profile services are available."
        : `Required services are unavailable: ${missingServices.join(", ")}.`,
    ),
    check(
      input,
      CHECK_IDS.zones,
      zoneClassification,
      requirements.requireAvailabilityZones ? evidence.observedAt : null,
      !requirements.requireAvailabilityZones
        ? "Availability-zone support was not required."
        : zoneClassification === "pass"
          ? "Availability-zone support is present."
          : zoneClassification === "fail"
            ? "Availability-zone support is absent."
            : "Availability-zone support is unresolved.",
    ),
    skuCheck(input, evidence, requirements),
    quotaCheck(input, evidence),
    capacityCheck(input, evidence),
    foundryCheck(input, evidence, requirements),
    check(
      input,
      CHECK_IDS.residency,
      evidence.residencyBoundaries.includes(residencyBoundary) ? "pass" : "fail",
      evidence.observedAt,
      evidence.residencyBoundaries.includes(residencyBoundary)
        ? `The region is compatible with the ${residencyBoundary} data-residency boundary.`
        : `The region is not compatible with the ${residencyBoundary} data-residency boundary.`,
    ),
    addressSpaceCheck(input, evidence, role, primaryEvidence),
  ];
  const alternateOptions = evidence.alternates
    .filter((alternate) => alternate.available)
    .map(({ type, value }) => ({ type, value }))
    .sort((left, right) =>
      `${left.type}:${left.value}`.localeCompare(`${right.type}:${right.value}`),
    );

  return finalizeCandidate(
    {
      region,
      rank: 1,
      role,
      checks,
      alternateOptions,
      proposedVnetCidr: evidence.proposedVnetCidr,
      estimatedMonthlyCost: evidence.estimatedMonthlyCost,
    },
    preferenceRank,
    evidence.latencyRank,
  );
}

function finalizeCandidate(candidate, preferenceRank, latencyRank) {
  const failures = candidate.checks.filter(
    (item) => item.classification === "fail",
  ).length;
  const unresolved = candidate.checks.filter(
    (item) => item.classification === "unresolved",
  ).length;
  const stale = candidate.checks.filter(
    (item) => item.freshness === "stale",
  ).length;
  const disposition =
    failures > 0
      ? "rejected"
      : unresolved > 0 || stale > 0
        ? "unresolved"
        : "eligible";

  return {
    ...candidate,
    disposition,
    score: {
      failures,
      unresolved,
      stale,
      preferenceRank,
      latencyRank,
    },
  };
}

function rankCandidates(candidates) {
  const dispositionRank = { eligible: 0, unresolved: 1, rejected: 2 };
  return [...candidates]
    .sort(
      (left, right) =>
        dispositionRank[left.disposition] - dispositionRank[right.disposition] ||
        left.score.failures - right.score.failures ||
        left.score.unresolved - right.score.unresolved ||
        left.score.stale - right.score.stale ||
        left.score.latencyRank - right.score.latencyRank ||
        left.estimatedMonthlyCost - right.estimatedMonthlyCost ||
        left.score.preferenceRank - right.score.preferenceRank ||
        left.region.localeCompare(right.region),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function requiredCheckIds(input, requirements) {
  const ids = [
    CHECK_IDS.policy,
    CHECK_IDS.services,
    CHECK_IDS.quota,
    CHECK_IDS.capacity,
    CHECK_IDS.residency,
  ];
  if (requirements.requireAvailabilityZones) {
    ids.push(CHECK_IDS.zones);
  }
  if (requirements.requireComputeSku || requirements.requireGpuSku) {
    ids.push(CHECK_IDS.skus);
  }
  if (requirements.requireFoundry) {
    ids.push(CHECK_IDS.foundry);
  }
  if (input.startupInput.reliability.regionalMode !== "single-region-ready") {
    ids.push(CHECK_IDS.addressSpace);
  }
  return ids;
}

function unresolvedDecisions(input) {
  const decisions = [];
  if (input.startupInput.reliability.rtoMinutes === null) {
    decisions.push({
      id: "reliability.rto.required",
      severity: "advisory",
      question: "What recovery time objective does the workload require?",
      reason: "The planner preserved the missing RTO and did not invent a default.",
    });
  }
  if (input.startupInput.reliability.rpoMinutes === null) {
    decisions.push({
      id: "reliability.rpo.required",
      severity: "advisory",
      question: "What recovery point objective does the workload require?",
      reason: "The planner preserved the missing RPO and did not invent a default.",
    });
  }
  if (input.startupInput.reliability.regionalMode !== "single-region-ready") {
    decisions.push({
      id: "regional.mode.review-required",
      severity: "blocking",
      question: "Has the Hot/Cool topology and service-specific recovery design been reviewed?",
      reason:
        "The first release can review cool or warm regional evidence but cannot mark that topology executable.",
    });
  }
  return decisions;
}

function actionForCheck(candidate, item) {
  const suffix = candidate.region;
  const actionTypes = {
    [CHECK_IDS.policy]: "manual",
    [CHECK_IDS.services]: "information",
    [CHECK_IDS.zones]: "information",
    [CHECK_IDS.skus]: "support",
    [CHECK_IDS.quota]: "support",
    [CHECK_IDS.capacity]: "information",
    [CHECK_IDS.foundry]: "information",
    [CHECK_IDS.residency]: "manual",
    [CHECK_IDS.addressSpace]: "manual",
  };
  if (item.classification === "fail") {
    return {
      id: `${item.id}.resolve.${suffix}`,
      type: actionTypes[item.id],
      region: candidate.region,
      summary:
        item.freshness === "stale"
          ? `Resolve ${item.id} and refresh its stale evidence before selecting ${candidate.region}.`
          : `Resolve ${item.id} before selecting ${candidate.region}.`,
    };
  }
  if (item.classification === "unresolved") {
    return {
      id: `evidence.collect.${suffix}`,
      type: "information",
      region: candidate.region,
      summary: `Collect unresolved ${item.id} evidence for ${candidate.region}.`,
    };
  }
  if (item.freshness === "stale") {
    return {
      id: `evidence.refresh.${suffix}`,
      type: "information",
      region: candidate.region,
      summary: `Refresh stale regional evidence for ${candidate.region}.`,
    };
  }
  return null;
}

function requiredActions(primaryCandidates, selectedPrimary, secondaryCandidates, mode) {
  const candidates = [];
  if (!selectedPrimary && primaryCandidates[0]) {
    candidates.push(primaryCandidates[0]);
  }
  if (mode !== "single-region-ready") {
    const selectedSecondary = secondaryCandidates.find(
      (candidate) => candidate.disposition === "eligible",
    );
    if (!selectedSecondary && secondaryCandidates[0]) {
      candidates.push(secondaryCandidates[0]);
    }
  }

  const actions = candidates.flatMap((candidate) =>
    candidate.checks
      .map((item) => actionForCheck(candidate, item))
      .filter(Boolean),
  );
  const seen = new Set();
  return actions.filter((action) => {
    if (seen.has(action.id)) {
      return false;
    }
    seen.add(action.id);
    return true;
  });
}

function overallFreshness(candidate) {
  if (!candidate) {
    return "unresolved";
  }
  if (
    candidate.checks.some(
      (item) =>
        item.freshness === "unresolved" ||
        item.classification === "unresolved",
    )
  ) {
    return "unresolved";
  }
  return candidate.checks.some((item) => item.freshness === "stale")
    ? "stale"
    : "current";
}

function planRegions(input) {
  validateDocument(regionalInputSchema, input);
  if (input.workloadPlan.status !== "ready") {
    throw new Error("Regional planning requires a ready workload profile plan.");
  }

  const evidenceByRegion = new Map();
  for (const evidence of input.evidence.regions) {
    if (evidenceByRegion.has(evidence.region)) {
      throw new Error(`Duplicate regional evidence: ${evidence.region}`);
    }
    evidenceByRegion.set(evidence.region, evidence);
  }

  const requirements = buildRequirements(input);
  const primaryCandidates = rankCandidates(
    input.regionalRequirements.primaryCandidates.map((region, index) =>
      evaluateCandidate(
        input,
        evidenceByRegion.get(region),
        region,
        "primary",
        index,
        requirements,
        null,
      ),
    ),
  );
  const selectedPrimary =
    primaryCandidates.find((candidate) => candidate.disposition === "eligible") ??
    null;
  const selectedPrimaryEvidence = selectedPrimary
    ? evidenceByRegion.get(selectedPrimary.region)
    : null;
  const secondaryCandidates = rankCandidates(
    input.regionalRequirements.secondaryCandidates
      .filter((region) => region !== selectedPrimary?.region)
      .map((region, index) =>
        evaluateCandidate(
          input,
          evidenceByRegion.get(region),
          region,
          "secondary",
          index,
          requirements,
          selectedPrimaryEvidence,
        ),
      ),
  );
  const secondaryRecommendation =
    secondaryCandidates.find(
      (candidate) => candidate.disposition === "eligible",
    ) ?? null;
  const requestedRegionalMode = input.startupInput.reliability.regionalMode;
  const reviewOnly = requestedRegionalMode !== "single-region-ready";
  const status = reviewOnly
    ? selectedPrimary && secondaryRecommendation
      ? "review-required"
      : "blocked"
    : selectedPrimary
      ? "ready"
      : "blocked";
  const evidenceCandidate = selectedPrimary ?? primaryCandidates[0] ?? null;
  const evidenceRecord = evidenceCandidate
    ? evidenceByRegion.get(evidenceCandidate.region)
    : null;
  const secondaryBaseline = input.regionalRequirements.secondaryBaseline;

  return {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    profileVersion: input.workloadPlan.profileVersion,
    workloadSelection: {
      computeProfile: input.workloadPlan.computeProfile,
      profileExtensions: [...input.workloadPlan.profileExtensions],
    },
    status,
    requestedRegionalMode,
    executableRegionalMode: status === "ready" ? "single-region-ready" : null,
    reviewOnly,
    recoveryTargets: {
      rtoMinutes: input.startupInput.reliability.rtoMinutes,
      rpoMinutes: input.startupInput.reliability.rpoMinutes,
    },
    requiredChecks: requiredCheckIds(input, requirements),
    rankedCandidates: primaryCandidates,
    selectedPrimary,
    secondaryCandidates,
    secondaryRecommendation,
    evidence: {
      planningAt: input.planningAt,
      maxEvidenceAgeHours: input.maxEvidenceAgeHours,
      primaryPointInTimeCapacityAt:
        evidenceRecord?.capacity.observedAt ?? null,
      overallFreshness: overallFreshness(evidenceCandidate),
    },
    costAssumptions: {
      currency: "USD",
      selectedPrimaryEstimate:
        selectedPrimary?.estimatedMonthlyCost ?? null,
      secondaryBaseline: {
        minimum: secondaryBaseline.minimum,
        maximum: secondaryBaseline.maximum,
        assumptions: secondaryBaseline.assumptions,
      },
    },
    requiredActions: requiredActions(
      primaryCandidates,
      selectedPrimary,
      secondaryCandidates,
      requestedRegionalMode,
    ),
    unresolvedDecisions: unresolvedDecisions(input),
    iacGenerated: false,
    azureOperations: "none",
  };
}

function usage() {
  return [
    "Usage:",
    "  startup-regional-plan.mjs plan --input <path|-> [--output json]",
    "",
    "The planner evaluates supplied evidence only. It makes no Azure calls and generates no IaC.",
  ].join("\n");
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  if (args[0] !== "plan") {
    throw new Error("The only supported command is plan.");
  }

  let inputPath;
  let output = "json";
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") {
      inputPath = args[index + 1];
      index += 1;
    } else if (argument === "--output") {
      output = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!inputPath) {
    throw new Error("--input is required.");
  }
  if (output !== "json") {
    throw new Error("The only supported output is json.");
  }
  return { help: false, inputPath };
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const source =
      options.inputPath === "-"
        ? readFileSync(0, "utf8")
        : readFileSync(resolve(process.cwd(), options.inputPath), "utf8");
    const plan = planRegions(JSON.parse(source));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = plan.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Regional planning failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}

export { planRegions };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
