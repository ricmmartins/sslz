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
import { join, resolve } from "node:path";
import {
  CONTAINER_CICD_CHECK_IDS,
  CONTAINER_CICD_CHECK_ORDER,
  STAGE_ORDER,
  containerImageCicdDigest,
  planContainerImageCicd,
} from "../scripts/startup-container-image-cicd-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(".");
const script = resolve(root, "scripts/startup-container-image-cicd-plan.mjs");
const base = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/container-image-cicd-plan-input.json"),
    "utf8",
  ),
);
const scenarios = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/container-image-cicd-planner/scenarios.json"),
    "utf8",
  ),
);
const outputSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/container-image-cicd-plan.schema.json"),
    "utf8",
  ),
);

function setPath(value, path, replacement) {
  const parts = path.split(".");
  const property = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[property] = structuredClone(replacement);
}

function checkById(plan, id) {
  return plan.checks.find((check) => check.id === id);
}

function planWith(...mutations) {
  const input = structuredClone(base);
  for (const [path, value] of mutations) {
    setPath(input, path, value);
  }
  return planContainerImageCicd(input);
}

for (const scenario of scenarios) {
  const input = structuredClone(base);
  for (const [path, value] of scenario.mutations) {
    setPath(input, path, value);
  }
  const first = planContainerImageCicd(input);
  const second = planContainerImageCicd(structuredClone(input));
  assert.deepEqual(second, first, `${scenario.name}: output must be deterministic`);
  validateDocument(outputSchema, first);
  assert.equal(first.status, scenario.expectedStatus, scenario.name);
  assert.equal(
    first.transition.selected,
    scenario.expectedStrategy,
    scenario.name,
  );
  assert.deepEqual(first.requiredChecks, CONTAINER_CICD_CHECK_ORDER);
  assert.deepEqual(
    first.checks.map(({ id }) => id),
    CONTAINER_CICD_CHECK_ORDER,
  );
  for (const id of scenario.expectedChecks) {
    assert.notEqual(
      checkById(first, id).classification,
      "pass",
      `${scenario.name}: ${id} must block`,
    );
  }
  assert.equal(first.safety.executionEnabled, false);
  assert.equal(first.safety.executionEligible, false);
  assert.equal(first.safety.sourceRegistryActions, "none");
  assert.equal(first.safety.targetRegistryActions, "none");
  assert.equal(first.safety.imagePushPull, "none");
  assert.equal(first.safety.pipelineWrites, "none");
  assert.equal(first.safety.cloudOperations, "none");
  assert.equal(first.safety.iacActions, "none");
  assert.equal(first.safety.dnsActions, "none");
  assert.equal(first.safety.credentialActions, "none");
  assert.equal(first.safety.generatedArtifacts, "stdout-only");
  assert.deepEqual(
    first.stages.map(({ state }) => state),
    STAGE_ORDER,
  );
  assert(first.stages.every(({ executionAllowed }) => !executionAllowed));
  assert.equal(first.identityBindings.readiness.executionEligible, false);
  assert.equal(first.identityBindings.iac.executionEligible, false);
  assert.equal(first.identityBindings.manifest.executionEligible, false);
  assert.equal(first.identityBindings.approval.executionEligible, false);
  assert.equal(
    first.planDigest,
    containerImageCicdDigest(
      Object.fromEntries(
        Object.entries(first).filter(([key]) => key !== "planDigest"),
      ),
    ),
  );
}

// Every catalog check must have a blocking synthetic scenario.
const coveredCheckIds = new Set();
for (const scenario of scenarios) {
  for (const id of scenario.expectedChecks) {
    coveredCheckIds.add(id);
  }
}
assert.deepEqual(
  [...coveredCheckIds].sort(),
  [...CONTAINER_CICD_CHECK_ORDER].sort(),
  "Every container image and CI/CD catalog check requires a blocking scenario",
);

const ready = planContainerImageCicd(base);
assert.equal(ready.status, "ready");
assert.equal(ready.transition.selected, "dual-publish-cutover");
assert.equal(ready.transition.requested, "auto");
assert(ready.checks.every((check) => check.classification === "pass"));
assert(
  ready.transitionPlan.imagePromotion.some((step) =>
    step.includes("immutable digest"),
  ),
);
assert(
  ready.transitionPlan.sourceOfTruthRules.some((rule) =>
    rule.includes("authoritative before cutover"),
  ),
);
assert.deepEqual(ready.transitionPlan.unsupportedFindings, []);
assert.deepEqual(ready.transitionPlan.requiredRemediations, []);
assert.deepEqual(ready.transitionPlan.unresolvedDecisions, []);

// Identity bindings are identical across readiness, iac, manifest, and approval.
assert.equal(
  ready.identityBindings.readiness.containerIdentityDigest,
  ready.identityBindings.containerIdentityDigest,
);
assert.deepEqual(ready.identityBindings.readiness, ready.identityBindings.iac);
assert.deepEqual(ready.identityBindings.iac, ready.identityBindings.manifest);
assert.deepEqual(ready.identityBindings.manifest, ready.identityBindings.approval);

// GCP and generic positive paths remain ready.
const gcp = planWith(
  ["sourceAssessment.registry.provider", "gcp-artifact-registry"],
  ["sourceAssessment.registry.region", "us-central1"],
  ["sourceAssessment.cicd.provider", "gcp-cloud-build"],
);
assert.equal(gcp.status, "ready");
assert.equal(
  checkById(gcp, CONTAINER_CICD_CHECK_IDS.cicdSourceBound).classification,
  "pass",
);
const generic = planWith(
  ["sourceAssessment.registry.provider", "generic-oci"],
  ["sourceAssessment.cicd.provider", "jenkins"],
);
assert.equal(generic.status, "ready");

// Provenance discontinuity (tamper) is a blocking, distinct finding.
const tampered = planWith([
  "sourceAssessment.images.0.provenanceSubjectDigest",
  "sha256:0000000000000000000000000000000000000000000000000000000000000000",
]);
assert.equal(
  checkById(tampered, CONTAINER_CICD_CHECK_IDS.provenanceContinuous).classification,
  "fail",
);
assert.notEqual(tampered.planDigest, ready.planDigest);
assert.notEqual(
  tampered.identityBindings.containerIdentityDigest,
  ready.identityBindings.containerIdentityDigest,
);

// Region mismatch invalidates the target binding and the identity.
const regionMutation = planWith([
  "target.registryTargetEvidence.region",
  "westeurope",
]);
assert.equal(
  checkById(regionMutation, CONTAINER_CICD_CHECK_IDS.targetBound).classification,
  "fail",
);
assert.notEqual(regionMutation.planDigest, ready.planDigest);
assert.notEqual(
  regionMutation.identityBindings.containerIdentityDigest,
  ready.identityBindings.containerIdentityDigest,
);

// Requirements, transition, and integration changes each reproduce a new identity.
const requirementsMutation = planWith([
  "requirements.maxCriticalVulnerabilities",
  5,
]);
assert.notEqual(requirementsMutation.planDigest, ready.planDigest);
assert.notEqual(
  requirementsMutation.identityBindings.requirementsDigest,
  ready.identityBindings.requirementsDigest,
);
const transitionMutation = planWith([
  "transition.cutoverReference",
  "runbook.container.cutover.orders.v2",
]);
assert.notEqual(
  transitionMutation.identityBindings.transitionDigest,
  ready.identityBindings.transitionDigest,
);
const integrationMutation = planWith(["integration", null]);
assert.notEqual(
  integrationMutation.identityBindings.integrationDigest,
  ready.identityBindings.integrationDigest,
);

// Replay of an accepted attempt ordinal is rejected.
const replay = planWith([
  "lineage.acceptedAttempts",
  [
    {
      attemptOrdinal: 2,
      assessmentId: "assessment.ecr.orders.20260811",
      nonce: "nonce.container.orders.0000",
    },
  ],
]);
assert.equal(replay.status, "blocked");
assert.equal(
  checkById(replay, CONTAINER_CICD_CHECK_IDS.replayProtected).classification,
  "fail",
);

// Secret-bearing keys and values fail closed before evaluation.
const secretKey = structuredClone(base);
secretKey.sourceAssessment.registry.accessKey = "not-allowed";
assert.throws(
  () => planContainerImageCicd(secretKey),
  /container\.cicd\.secret-material/,
);
const secretValue = structuredClone(base);
secretValue.sourceAssessment.registry.reference = `https://ci-user:${["raw", "secret"].join("-")}@source.example/registry`;
assert.throws(
  () => planContainerImageCicd(secretValue),
  /container\.cicd\.secret-material/,
);

// The CLI reads local JSON and writes JSON to standard output only.
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "sslz-container-image-cicd-plan-"),
);
const inputPath = join(temporaryDirectory, "input.json");
const blockedInputPath = join(temporaryDirectory, "blocked-input.json");
writeFileSync(inputPath, `${JSON.stringify(base)}\n`);
const blockedInput = structuredClone(base);
blockedInput.sourceAssessment.governance.sourceOfTruth = "ambiguous";
writeFileSync(blockedInputPath, `${JSON.stringify(blockedInput)}\n`);
const before = readdirSync(temporaryDirectory).sort();
const cli = spawnSync(
  process.execPath,
  [script, "plan", "--input", inputPath, "--output", "json"],
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);
assert.deepEqual(JSON.parse(cli.stdout), ready);

const blocked = spawnSync(
  process.execPath,
  [script, "plan", "--input", blockedInputPath, "--output", "json"],
  {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: { ...process.env },
  },
);
assert.equal(blocked.status, 1, blocked.stderr);
assert.equal(JSON.parse(blocked.stdout).status, "blocked");

for (const [path, value] of [
  ["scope.includeAttestations", false],
  ["requirements.requireImmutableTags", false],
]) {
  const unsafePolicy = structuredClone(base);
  setPath(unsafePolicy, path, value);
  assert.throws(
    () => planContainerImageCicd(unsafePolicy),
    /expected constant true/,
  );
}

// The planner surface performs no execution and emits no commands.
const source = readFileSync(script, "utf8");
assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls)/);
assert.doesNotMatch(
  source,
  /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/,
);
assert.doesNotMatch(
  source,
  /\b(?:docker|podman|buildx|cosign|skopeo|crane|oras|kubectl|helm|terraform|gcloud)\b/,
);
assert.doesNotMatch(
  JSON.stringify(ready),
  /ci-user|BEGIN [A-Z ]+PRIVATE KEY/,
);

console.log(
  `Container image and CI/CD planner tests passed for ${scenarios.length} synthetic scenarios.`,
);
