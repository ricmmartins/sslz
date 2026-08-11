#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  assertAttemptExecutable,
  completeRegionalAttemptReservation,
  createRegionalAttempt,
  hashCanonical,
  persistRegionalAttemptCleanup,
  recordAttemptFailure,
  recordAttemptStarted,
  recordCleanupOutcome,
  releaseRegionalAttemptReservation,
  replanRegionalAttempt,
  reserveRegionalAttempt,
  sanitizeDiagnostics,
} from "../scripts/regional-attempt.mjs";

const fixture = JSON.parse(
  readFileSync(
    resolve("tests/fixtures/regional-retry/primary-failure-alternate-success.json"),
    "utf8",
  ),
);
const digest = (character) => `sha256:${character.repeat(64)}`;
const bindings = (offset = 0) => ({
  regionalEvidenceDigest: digest(String((offset + 1) % 10)),
  planDigest: digest(String((offset + 2) % 10)),
  artifactDigest: digest(String((offset + 3) % 10)),
  manifestDigest: digest(String((offset + 4) % 10)),
  approvalDigest: digest(String((offset + 5) % 10)),
});

function create(provider = fixture.provider) {
  return createRegionalAttempt({
    ...fixture,
    provider,
    targetRegion: fixture.originalRegion,
    ...bindings(),
    createdAt: fixture.timestamps.planned,
  });
}

const primary = create();
assert.equal(primary.status, "planned");
assert.equal(primary.identities.resourceSuffix, "");
assert.equal(primary.identities.deploymentName, "sslz-nonprod-222222222222");
assert.equal(primary.identities.previewDeploymentName, "sslz-preview-nonprod-eastus2");
assert.equal(
  primary.identities.nestedDeploymentNames.policies,
  "deploy-policies-nonprod",
);
assert.equal(primary.identities.stateKey, "startup-primary-nonprod-primary.tfstate");

const started = recordAttemptStarted(primary, fixture.timestamps.started);
const failed = recordAttemptFailure(started, {
  code: "deployment.execution.failed",
  summary: "Primary region capacity allocation failed.",
  diagnostics: {
    authorization: "Bearer top-secret",
    contact: "operator@example.com",
    service: "Microsoft.App",
    error: "AllocationFailed",
  },
  occurredAt: fixture.timestamps.failed,
});
assert.equal(failed.status, "cleanup-required");
assert.equal(failed.cleanup.status, "pending");
assert.equal(failed.failureEvidence[0].sensitiveValuesRetained, false);
assert(!JSON.stringify(failed).includes("top-secret"));
assert(!JSON.stringify(failed).includes("operator@example.com"));

assert.throws(
  () =>
    replanRegionalAttempt(failed, {
      ...fixture,
      targetRegion: fixture.alternateRegion,
      ...bindings(1),
      createdAt: fixture.timestamps.replanned,
    }),
  /Cleanup failure or pending cleanup/,
);

const cleanupFailed = recordCleanupOutcome(failed, {
  succeeded: false,
  evidenceDigest: digest("a"),
  occurredAt: fixture.timestamps.cleaned,
  summary: "Policy assignment identity cleanup failed.",
});
assert.equal(cleanupFailed.status, "cleanup-required");
assert.equal(cleanupFailed.failureEvidence[0].evidenceDigest, failed.failureEvidence[0].evidenceDigest);
assert.throws(
  () =>
    replanRegionalAttempt(cleanupFailed, {
      ...fixture,
      targetRegion: fixture.alternateRegion,
      ...bindings(1),
      createdAt: fixture.timestamps.replanned,
    }),
  /Cleanup failure or pending cleanup/,
);

const cleaned = recordCleanupOutcome(failed, {
  succeeded: true,
  evidenceDigest: digest("b"),
  occurredAt: fixture.timestamps.cleaned,
  summary: "Attempt-owned resources and identities were verified absent.",
});
const alternate = replanRegionalAttempt(cleaned, {
  ...fixture,
  targetRegion: fixture.alternateRegion,
  ...bindings(1),
  createdAt: fixture.timestamps.replanned,
});
assert.equal(alternate.status, "replanned");
assert.equal(alternate.attemptNumber, 2);
assert.equal(alternate.previousAttemptDigest, cleaned.recordDigest);
assert.notEqual(alternate.identities.deploymentName, primary.identities.deploymentName);
assert.equal(alternate.identities.stateKey, primary.identities.stateKey);
assert.notEqual(alternate.identities.workspaceName, primary.identities.workspaceName);
assert.notEqual(alternate.identities.artifactRoot, primary.identities.artifactRoot);
assert.notEqual(
  alternate.identities.nestedDeploymentNames.policies,
  primary.identities.nestedDeploymentNames.policies,
);
assert.notEqual(
  alternate.identities.policyAssignmentNames.activityLogDiagnostics,
  primary.identities.policyAssignmentNames.activityLogDiagnostics,
);
assert.equal(alternate.identities.policyIdentityLifecycle.reuseAcrossChangedRegion, false);
assert.match(alternate.identities.resourceSuffix, /^-a02-centralus-/);
assertAttemptExecutable(alternate, {
  targetRegion: fixture.alternateRegion,
  planDigest: bindings(1).planDigest,
  manifestDigest: bindings(1).manifestDigest,
  approvalDigest: bindings(1).approvalDigest,
});
assert.throws(
  () =>
    replanRegionalAttempt(cleaned, {
      ...fixture,
      backendKeyPrefix: "replacement-state",
      targetRegion: fixture.alternateRegion,
      ...bindings(1),
      createdAt: fixture.timestamps.replanned,
    }),
  /cannot change its plan, environment, or state chain/,
);

for (const key of Object.keys(bindings())) {
  assert.throws(
    () =>
      replanRegionalAttempt(cleaned, {
        ...fixture,
        targetRegion: fixture.alternateRegion,
        ...bindings(1),
        [key]: bindings()[key],
        createdAt: fixture.timestamps.replanned,
      }),
    new RegExp(`cannot reuse the prior ${key}`),
  );
}

const safeSameRegionFailure = recordAttemptFailure(primary, {
  code: "deployment.prewrite.failed",
  summary: "No write started.",
  diagnostics: {},
  occurredAt: fixture.timestamps.failed,
  cleanupRequired: false,
});
const sameRegion = replanRegionalAttempt(safeSameRegionFailure, {
  ...fixture,
  targetRegion: fixture.originalRegion,
  safeSameRegionRetry: true,
  ...bindings(),
  createdAt: fixture.timestamps.replanned,
});
assert.equal(sameRegion.targetRegion, fixture.originalRegion);

const terraform = create("terraform");
assert.equal(terraform.identities.attemptKey, primary.identities.attemptKey);
assert.equal(terraform.identities.resourceSuffix, primary.identities.resourceSuffix);
assert.equal(
  terraform.identities.policyIdentityLifecycle.mode,
  primary.identities.policyIdentityLifecycle.mode,
);

const sanitized = sanitizeDiagnostics({
  clientSecret: "secret-value",
  nested: { password: "password-value", code: "AllocationFailed" },
});
assert.deepEqual(sanitized, {
  clientSecret: "[REDACTED]",
  nested: { password: "[REDACTED]", code: "AllocationFailed" },
});

const stateDirectory = mkdtempSync(resolve(tmpdir(), "sslz-regional-attempt-"));
try {
  const reservation = reserveRegionalAttempt(primary, stateDirectory);
  assert.equal(reservation.status, "reserved");
  assert.equal(reserveRegionalAttempt(primary, stateDirectory).status, "concurrent");
  completeRegionalAttemptReservation(reservation, failed);
  assert.equal(reserveRegionalAttempt(primary, stateDirectory).status, "replayed");
  assert.equal(
    persistRegionalAttemptCleanup(failed, cleaned, stateDirectory),
    true,
  );

  const alternateReservation = reserveRegionalAttempt(alternate, stateDirectory, {
    previousAttemptKey: cleaned.identities.attemptKey,
    previousTargetRegion: cleaned.targetRegion,
  });
  assert.equal(alternateReservation.status, "reserved");
  releaseRegionalAttemptReservation(alternateReservation);
} finally {
  rmSync(stateDirectory, { recursive: true, force: true });
}

const failedFinalizationDirectory = mkdtempSync(
  resolve(tmpdir(), "sslz-regional-finalization-"),
);
try {
  const reservation = reserveRegionalAttempt(primary, failedFinalizationDirectory);
  mkdirSync(reservation.completedPath);
  const terminal = recordAttemptFailure(primary, {
    code: "deployment.prewrite.failed",
    summary: "No write started.",
    diagnostics: {},
    occurredAt: fixture.timestamps.failed,
    cleanupRequired: false,
  });
  assert.equal(completeRegionalAttemptReservation(reservation, terminal), false);
  assert.equal(reservation.status, "finalization-failed");
  assert.equal(existsSync(reservation.lockPath), true);
  assert.equal(
    reserveRegionalAttempt(primary, failedFinalizationDirectory).status,
    "concurrent",
  );
} finally {
  rmSync(failedFinalizationDirectory, { recursive: true, force: true });
}

assert.equal(hashCanonical(primary), hashCanonical(structuredClone(primary)));
console.log("Regional attempt and retry tests passed.");
