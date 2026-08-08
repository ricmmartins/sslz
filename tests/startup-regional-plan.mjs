#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/startup-regional-plan.mjs");
const fixtureDirectory = resolve(root, "tests/fixtures/regional-planner");
const inputSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/regional-planning-input.schema.json"),
    "utf8",
  ),
);
const planSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/regional-capacity-plan.schema.json"),
    "utf8",
  ),
);
const catalog = JSON.parse(
  readFileSync(resolve(root, "agent/checks/check-catalog.json"), "utf8"),
);
const baseInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/regional-planning-input.json"),
    "utf8",
  ),
);
const catalogIds = new Set(catalog.checks.map((item) => item.id));

function merge(base, overrides) {
  if (
    !base ||
    !overrides ||
    typeof base !== "object" ||
    typeof overrides !== "object" ||
    Array.isArray(base) ||
    Array.isArray(overrides)
  ) {
    return structuredClone(overrides);
  }

  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    result[key] =
      key in result && value && typeof value === "object" && !Array.isArray(value)
        ? merge(result[key], value)
        : structuredClone(value);
  }
  return result;
}

function fixtureInput(fixture) {
  const input = structuredClone(baseInput);
  input.startupInput = merge(input.startupInput, fixture.startupOverrides ?? {});
  input.workloadPlan = planWorkload(input.startupInput);
  input.regionalRequirements = merge(
    input.regionalRequirements,
    fixture.requirementOverrides ?? {},
  );
  input.evidence.regions = input.evidence.regions.map((evidence) =>
    merge(evidence, fixture.regionEvidenceOverrides?.[evidence.region] ?? {}),
  );
  return input;
}

function checkById(candidate, id) {
  return candidate.checks.find((item) => item.id === id);
}

function assertExpected(plan, expected, name) {
  assert.equal(plan.status, expected.status, name);
  if (expected.selectedPrimary !== undefined) {
    assert.equal(plan.selectedPrimary?.region ?? null, expected.selectedPrimary, name);
  }
  if (expected.primaryDisposition) {
    assert.equal(plan.rankedCandidates[0].disposition, expected.primaryDisposition, name);
  }
  if (expected.secondaryDisposition) {
    assert.equal(
      plan.secondaryCandidates[0].disposition,
      expected.secondaryDisposition,
      name,
    );
  }
  if (expected.secondaryRecommendation !== undefined) {
    assert.equal(
      plan.secondaryRecommendation?.region ?? null,
      expected.secondaryRecommendation,
      name,
    );
  }
  if (expected.failedCheck) {
    assert.equal(
      checkById(plan.rankedCandidates[0], expected.failedCheck).classification,
      "fail",
      name,
    );
  }
  if (expected.secondaryFailedCheck) {
    assert.equal(
      checkById(
        plan.secondaryCandidates[0],
        expected.secondaryFailedCheck,
      ).classification,
      "fail",
      name,
    );
  }
  if (expected.quotaClassification) {
    assert.equal(
      checkById(plan.rankedCandidates[0], "quota.workload.headroom")
        .classification,
      expected.quotaClassification,
      name,
    );
  }
  if (expected.capacityClassification) {
    assert.equal(
      checkById(plan.rankedCandidates[0], "capacity.workload.available")
        .classification,
      expected.capacityClassification,
      name,
    );
  }
  if (expected.overallFreshness) {
    assert.equal(plan.evidence.overallFreshness, expected.overallFreshness, name);
  }
  if (expected.rankedRegions) {
    assert.deepEqual(
      plan.rankedCandidates.map((candidate) => candidate.region),
      expected.rankedRegions,
      name,
    );
  }
}

const fixtureFiles = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const fixtureFile of fixtureFiles) {
  const fixture = JSON.parse(
    readFileSync(resolve(fixtureDirectory, fixtureFile), "utf8"),
  );
  const input = fixtureInput(fixture);
  validateDocument(inputSchema, input);

  const first = planRegions(input);
  const second = planRegions(structuredClone(input));
  assert.deepEqual(second, first, `${fixture.name}: output must be deterministic`);
  validateDocument(planSchema, first);
  assertExpected(first, fixture.expected, fixture.name);
  assert.equal(first.profileVersion, input.workloadPlan.profileVersion);
  assert.equal(first.iacGenerated, false);
  assert.equal(first.azureOperations, "none");
  assert.equal(first.executableRegionalMode, first.status === "ready" ? "single-region-ready" : null);
  for (const checkId of first.requiredChecks) {
    assert(catalogIds.has(checkId), `${fixture.name}: unknown check ${checkId}`);
  }
  for (const candidate of [
    ...first.rankedCandidates,
    ...first.secondaryCandidates,
  ]) {
    for (const item of candidate.checks) {
      assert(catalogIds.has(item.id), `${fixture.name}: unknown check ${item.id}`);
    }
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "sslz-regional-plan-"));
  const inputPath = join(temporaryDirectory, "input.json");
  writeFileSync(inputPath, `${JSON.stringify(input)}\n`);
  const before = readdirSync(temporaryDirectory).sort();
  const result = spawnSync(
    process.execPath,
    [script, "plan", "--input", inputPath, "--output", "json"],
    {
      cwd: temporaryDirectory,
      encoding: "utf8",
    },
  );
  const after = readdirSync(temporaryDirectory).sort();
  assert.deepEqual(after, before, `${fixture.name}: planner wrote a file`);
  assert.equal(
    result.status,
    first.status === "ready" ? 0 : 1,
    `${fixture.name}: unexpected exit status\n${result.stderr}`,
  );
  assert.deepEqual(JSON.parse(result.stdout), first, fixture.name);

  if (fixtureFile === "primary-secondary-parity.json") {
    const primaryChecks = first.selectedPrimary.checks
      .filter((item) => item.id !== "network.regional-address-space.non-overlapping")
      .map(({ id, classification }) => ({ id, classification }));
    const secondaryChecks = first.secondaryRecommendation.checks
      .filter((item) => item.id !== "network.regional-address-space.non-overlapping")
      .map(({ id, classification }) => ({ id, classification }));
    assert.deepEqual(
      secondaryChecks,
      primaryChecks,
      "Primary and secondary must receive identical selected-profile checks",
    );
    assert.equal(first.reviewOnly, true);
    assert.equal(first.executableRegionalMode, null);
  }
}

const basePlan = planRegions(baseInput);
assert.equal(basePlan.recoveryTargets.rtoMinutes, null);
assert.equal(basePlan.recoveryTargets.rpoMinutes, null);
assert(
  basePlan.unresolvedDecisions.some(
    (decision) => decision.id === "reliability.rto.required",
  ),
);
assert(
  basePlan.unresolvedDecisions.some(
    (decision) => decision.id === "reliability.rpo.required",
  ),
);
assert.deepEqual(basePlan.costAssumptions.secondaryBaseline, {
  minimum: 75,
  maximum: 180,
  assumptions: [
    "The estimate covers a reviewed secondary baseline only; workload usage, replication, and transfer are separate.",
  ],
});
assert(
  basePlan.selectedPrimary.alternateOptions.some(
    (option) =>
      option.type === "foundry-deployment" &&
      option.value === "gpt-4.1:DataZoneStandard",
  ),
);
assert.equal(
  basePlan.evidence.primaryPointInTimeCapacityAt,
  "2026-08-08T11:30:00Z",
);

const staleQuotaFailureInput = structuredClone(baseInput);
staleQuotaFailureInput.regionalRequirements.primaryCandidates = ["eastus2"];
staleQuotaFailureInput.regionalRequirements.secondaryCandidates = [];
staleQuotaFailureInput.evidence.regions = [
  merge(staleQuotaFailureInput.evidence.regions[0], {
    observedAt: "2026-08-06T11:00:00Z",
    quota: {
      required: 8,
      available: 2,
      unit: "vCPUs",
    },
  }),
];
const staleQuotaFailurePlan = planRegions(staleQuotaFailureInput);
assert(
  staleQuotaFailurePlan.requiredActions.some(
    (action) =>
      action.id === "quota.workload.headroom.resolve.eastus2" &&
      action.type === "support" &&
      action.summary.includes("stale evidence"),
  ),
  "A stale failing check must retain its specific remediation action",
);

const source = readFileSync(script, "utf8");
assert.doesNotMatch(source, /node:(?:child_process|http|https)/);
assert.doesNotMatch(
  source,
  /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/,
);
assert.doesNotMatch(
  source,
  /(?:@azure|az\s+(?:account|provider|deployment|aks|role)|bicepparam|terraform)/i,
);

console.log("Startup regional planner fixture tests passed.");
