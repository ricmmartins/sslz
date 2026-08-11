#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReadinessEvidence,
  readinessEvidenceDigest,
} from "../scripts/startup-iac-plan.mjs";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { buildReadinessEvidence } from "./readiness-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const regionalInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/regional-planning-input.json"),
    "utf8",
  ),
);
const documentedExample = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/readiness-evidence.json"),
    "utf8",
  ),
);
const evaluatedAt = Date.parse("2026-08-09T12:00:00Z");

function createInput({
  planId = "readiness-contract-test",
  regionalMode = "cool-infrastructure",
  foundry = false,
} = {}) {
  const planningInput = structuredClone(regionalInput);
  planningInput.startupInput.reliability.regionalMode = regionalMode;
  planningInput.startupInput.reliability.rtoMinutes = 240;
  planningInput.startupInput.reliability.rpoMinutes = 60;
  planningInput.regionalRequirements.secondaryBaseline.minimum = 30;
  planningInput.regionalRequirements.secondaryBaseline.maximum = 60;
  planningInput.startupInput.reliability.failoverOwnerConfirmed = true;
  planningInput.startupInput.workload.usesFoundryModels = foundry;
  planningInput.startupInput.workload.managedModelFit = foundry ? "yes" : "unknown";
  if (foundry) {
    planningInput.regionalRequirements.foundry = {
      model: "gpt-4.1",
      deploymentType: "GlobalStandard",
    };
  }
  planningInput.workloadPlan = planWorkload(planningInput.startupInput);
  const regionalPlan = planRegions(planningInput);
  const input = {
    schemaVersion: "3.0.0",
    planId,
    target: {
      tenantId: "11111111-1111-1111-1111-111111111111",
      environments: [
        {
          name: "prod",
          subscriptionId:
            planningInput.startupInput.subscriptions.prodSubscriptionId,
        },
        {
          name: "nonprod",
          subscriptionId:
            planningInput.startupInput.subscriptions.nonprodSubscriptionId,
        },
      ],
    },
    workloadPlan: planningInput.workloadPlan,
    regionalPlan,
  };
  input.readinessEvidence = buildReadinessEvidence(input);
  return input;
}

function mutate(input, change, rehash = true) {
  const changed = structuredClone(input);
  change(changed.readinessEvidence, changed);
  if (rehash && changed.readinessEvidence) {
    changed.readinessEvidence.evidenceDigest = readinessEvidenceDigest(
      changed.readinessEvidence,
    );
  }
  return changed;
}

function expectCode(input, code) {
  assert.throws(
    () => assertReadinessEvidence(input, evaluatedAt),
    (error) => error?.code === code,
    code,
  );
}

function expectCodeAndCheckId(input, code, checkId) {
  assert.throws(
    () => assertReadinessEvidence(input, evaluatedAt),
    (error) => error?.code === code && error?.checkId === checkId,
    `${code} should identify ${checkId}`,
  );
}

const valid = createInput();
assert.equal(assertReadinessEvidence(valid, evaluatedAt), valid.readinessEvidence);
assert.match(valid.readinessEvidence.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
assert.equal(
  readinessEvidenceDigest(documentedExample),
  documentedExample.evidenceDigest,
);

const omitted = structuredClone(valid);
delete omitted.readinessEvidence;
expectCode(omitted, "readiness.evidence.required");

expectCode(
  mutate(valid, (evidence) => {
    evidence.status = "blocked";
  }),
  "readiness.evidence.blocked",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.coolFootprintCost.ceilingPercent = 20;
  }),
  "readiness.cost.ceiling-exceeded",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.recoveryExercise.status = "not-tested";
  }),
  "readiness.recovery.exercise-failed",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.codeEvidence.preflight.status = "blocked";
  }),
  "readiness.preflight.blocked",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.startupBillingSupport.status = "pending";
  }),
  "readiness.support.confirmation-required",
);
for (const [review, code] of [
  ["security", "readiness.review.security-approved"],
  ["azureArchitecture", "readiness.review.azure-architecture-approved"],
  ["iacParity", "readiness.review.iac-parity-approved"],
]) {
  expectCode(
    mutate(valid, (evidence) => {
      evidence.humanAttestations.externalReviews[review].status = "pending";
    }),
    code,
  );
}
expectCodeAndCheckId(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.externalReviews.security.expiresAt =
      "2026-08-09T11:59:59Z";
  }),
  "readiness.evidence.stale",
  "readiness.review.security-approved",
);

const missingOwnerRole = mutate(valid, (evidence) => {
  delete evidence.humanAttestations.failoverOwner.roleReference;
});
assert.throws(
  () => assertReadinessEvidence(missingOwnerRole, evaluatedAt),
  /missing required property roleReference/,
);

const missingTargets = mutate(valid, (evidence, input) => {
  input.regionalPlan.recoveryTargets.rtoMinutes = null;
  input.regionalPlan.recoveryTargets.rpoMinutes = null;
});
expectCode(missingTargets, "readiness.recovery.target-required");

expectCode(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.recoveryMeasurements[0].measuredRtoMinutes = 241;
  }),
  "readiness.recovery.objective-unmet",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.serviceRecoveryTests = [];
  }),
  "readiness.recovery.service-test-required",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.serviceRecoveryTests[0].status = "fail";
  }),
  "readiness.recovery.service-test-failed",
);

expectCode(
  mutate(valid, (evidence) => {
    evidence.expiresAt = "2026-08-09T11:59:59Z";
  }),
  "readiness.evidence.stale",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.humanAttestations.coolFootprintCost.minimum = 181;
  }),
  "readiness.cost.range-invalid",
);
const missingCostProvenance = mutate(valid, (evidence) => {
  delete evidence.humanAttestations.coolFootprintCost.provenanceReference;
});
assert.throws(
  () => assertReadinessEvidence(missingCostProvenance, evaluatedAt),
  /expected exactly one oneOf match/,
);

expectCode(
  mutate(valid, (evidence) => {
    evidence.subject.primaryRegion = "westus3";
  }),
  "readiness.evidence.scope-mismatch",
);
expectCode(
  mutate(valid, (evidence) => {
    evidence.codeEvidence.regional[1].region = "westus3";
  }),
  "readiness.region.scope-mismatch",
);

const foundry = createInput({ foundry: true });
assert.equal(assertReadinessEvidence(foundry, evaluatedAt), foundry.readinessEvidence);
expectCode(
  mutate(foundry, (evidence) => {
    evidence.codeEvidence.foundry = [];
  }),
  "readiness.foundry.evidence-required",
);
const missingFoundryVersion = mutate(foundry, (evidence) => {
  delete evidence.codeEvidence.foundry[0].modelVersion;
});
assert.throws(
  () => assertReadinessEvidence(missingFoundryVersion, evaluatedAt),
  /missing required property modelVersion/,
);
expectCode(
  mutate(foundry, (evidence) => {
    evidence.codeEvidence.foundry[0].availableQuota = 9;
  }),
  "readiness.foundry.blocked",
);

expectCode(
  mutate(
    valid,
    (evidence) => {
      evidence.codeEvidence.preflight.evidenceDigest =
        `sha256:${"0".repeat(64)}`;
    },
    false,
  ),
  "readiness.evidence.digest-mismatch",
);

const replayed = createInput({ planId: "different-plan" });
replayed.readinessEvidence = structuredClone(valid.readinessEvidence);
expectCode(replayed, "readiness.evidence.scope-mismatch");

const singleRegion = createInput({ regionalMode: "single-region-ready" });
assert.equal(
  assertReadinessEvidence(singleRegion, evaluatedAt),
  singleRegion.readinessEvidence,
);
assert.equal(singleRegion.readinessEvidence.subject.secondaryRegion, null);
assert.equal(
  singleRegion.readinessEvidence.humanAttestations.coolFootprintCost,
  null,
);
assert.equal(
  singleRegion.readinessEvidence.humanAttestations.recoveryExercise,
  null,
);

console.log("Startup readiness evidence fixture tests passed.");
