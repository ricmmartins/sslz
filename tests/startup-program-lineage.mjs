#!/usr/bin/env node

import assert from "node:assert/strict";
import { runProgramLineageJourney } from "./program-lineage-fixture.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planPostgresql } from "../scripts/startup-postgresql-plan.mjs";
import {
  buildProgramLineageEnvelope,
  validateProgramLineageEnvelope,
} from "../scripts/startup-program-lineage.mjs";
import {
  containerImageCicdDigest,
  planContainerImageCicd,
} from "../scripts/startup-container-image-cicd-plan.mjs";
import { planConnectivity } from "../scripts/startup-connectivity-plan.mjs";
import { planPostgresqlExecution } from "../scripts/startup-postgresql-execution-plan.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const baseline = {
  journeyId: "synthetic-program-lineage-test",
  evidenceMode: "synthetic",
  target: {
    environment: "prod",
    environmentReference: "environment.production.orders",
    region: "centralus",
    targetReference: "target.postgresql.orders.flexible",
  },
  bindings: {
    workloadProfilePlanDigest: digest("1"),
    regionalPlanDigest: digest("2"),
    postgresqlDecisionDigest: null,
    iacPlanDigest: digest("3"),
    readinessEvidenceDigest: digest("4"),
    deploymentManifestDigest: digest("5"),
    deploymentApprovalDigest: digest("6"),
  },
};

const postgresqlRegionalPlanInput = JSON.parse(
  readFileSync(
    resolve("agent/examples/postgresql-regional-plan-input.json"),
    "utf8",
  ),
);
const postgresqlRegionalPlan = planPostgresql(
  postgresqlRegionalPlanInput,
  { evaluatedAt: Date.parse("2026-08-11T18:00:00.000Z") },
);
baseline.bindings.postgresqlDecisionDigest =
  postgresqlRegionalPlan.decisionDigest;
const {
  input,
  trustedPlannerDigests,
  envelope,
  negativeJourneys,
} = runProgramLineageJourney(baseline, { postgresqlRegionalPlanInput });
assert.equal(envelope.status, "ready-for-human-review");
assert.equal(
  envelope.readiness.baselineGreenfieldDeployment.status,
  "ready",
);
assert.equal(
  envelope.readiness.migrationAndDualCloudPlanning.executionAuthority,
  "not-granted",
);
assert.equal(envelope.safety.networkCalls, "none");
assert.equal(envelope.safety.cloudOperations, "none");
assert.equal(envelope.safety.databaseOperations, "none");
assert.equal(envelope.safety.imageOperations, "none");
assert.equal(envelope.safety.dnsOperations, "none");
assert.equal(envelope.safety.identityOperations, "none");
assert.equal(envelope.safety.iacOperations, "none");
assert.equal(negativeJourneys.length, 9);
assert(
  negativeJourneys.every(
    (journey) =>
      journey.status === "blocked" && journey.writePreparationEvents === 0,
  ),
);
assert.doesNotMatch(JSON.stringify(envelope), /@[a-z0-9.-]+\.[a-z]{2,}/i);
assert.doesNotMatch(JSON.stringify(envelope), /-----BEGIN [A-Z ]+PRIVATE KEY-----/);
assert.doesNotMatch(JSON.stringify(envelope), /\/subscriptions\//i);
assert.doesNotMatch(
  JSON.stringify(envelope),
  /\b(?:az|terraform|kubectl|docker|psql|curl)\s+/i,
);
assert.deepEqual(
  envelope.stages.map(({ artifactDigest }) => artifactDigest),
  [
    input.postgresql.migrationPlan.planDigest,
    input.postgresql.rehearsalPlan.planDigest,
    input.postgresql.executionPlan.planDigest,
    input.container.plan.planDigest,
    input.connectivity.plan.planDigest,
  ],
);

const cascaded = structuredClone(input);
cascaded.baseline.bindings.workloadProfilePlanDigest = digest("9");
cascaded.container.planInput.integration.workloadProfilePlanDigest = digest("9");
cascaded.container.plan = planContainerImageCicd(cascaded.container.planInput);
cascaded.connectivity.planInput.integration.workloadProfilePlanDigest = digest("9");
cascaded.connectivity.planInput.integration.containerImageCicdPlanDigest =
  cascaded.container.plan.planDigest;
cascaded.connectivity.plan = planConnectivity(cascaded.connectivity.planInput);
const cascadedEnvelope = buildProgramLineageEnvelope(cascaded, {
  trustedPlannerDigests,
});
assert(
  cascadedEnvelope.stages.every(
    (stage, index) => stage.stageDigest !== envelope.stages[index].stageDigest,
  ),
  "An upstream baseline mutation must cascade through every stage digest.",
);
assert.notEqual(
  cascadedEnvelope.programIdentityDigest,
  envelope.programIdentityDigest,
);
assert.notEqual(cascadedEnvelope.envelopeDigest, envelope.envelopeDigest);

const forgedOutput = structuredClone(input);
forgedOutput.container.plan.transitionPlan.cutover[0] =
  "Substituted cutover instruction.";
forgedOutput.container.plan.planDigest = containerImageCicdDigest(
  Object.fromEntries(
    Object.entries(forgedOutput.container.plan).filter(
      ([key]) => key !== "planDigest",
    ),
  ),
);
assert.throws(
  () =>
    buildProgramLineageEnvelope(forgedOutput, {
      trustedPlannerDigests,
    }),
  (error) => error.checkId === "program.lineage.digests-current",
);

const staleApproval = structuredClone(input);
staleApproval.postgresql.executionDocuments.approvals.approvals[0].expiresAt =
  "2026-08-12T12:45:00Z";
assert.throws(
  () =>
    buildProgramLineageEnvelope(staleApproval, {
      trustedPlannerDigests,
    }),
  (error) => error.checkId === "program.lineage.evidence-current",
);

const overAgeApproval = structuredClone(input);
overAgeApproval.postgresql.executionDocuments.approvals.approvals[0].issuedAt =
  "2026-08-10T12:40:00Z";
overAgeApproval.postgresql.executionPlan = planPostgresqlExecution(
  overAgeApproval.postgresql.executionDocuments,
  overAgeApproval.generatedAt,
  trustedPlannerDigests.postgresqlExecutionTrustManifestDigest,
  trustedPlannerDigests.postgresqlExecutionEvaluationTimeDigest,
);
assert.throws(
  () =>
    buildProgramLineageEnvelope(overAgeApproval, {
      trustedPlannerDigests,
    }),
  (error) => error.checkId === "program.lineage.evidence-current",
);

const substitutedTrust = {
  ...trustedPlannerDigests,
  postgresqlExecutionTrustManifestDigest: `${
    trustedPlannerDigests.postgresqlExecutionTrustManifestDigest.slice(0, -1)
  }${
    trustedPlannerDigests.postgresqlExecutionTrustManifestDigest.endsWith("0")
      ? "1"
      : "0"
  }`,
};
assert.throws(
  () =>
    buildProgramLineageEnvelope(input, {
      trustedPlannerDigests: substitutedTrust,
    }),
  (error) => error.checkId === "program.lineage.digests-current",
);

const successor = structuredClone(input);
successor.lineage.attemptOrdinal = 2;
successor.lineage.attemptNonce = "nonce.synthetic-startup-program.0002";
successor.lineage.acceptedAttempts = [
  {
    attemptOrdinal: 1,
    attemptNonce: input.lineage.attemptNonce,
    envelopeDigest: envelope.envelopeDigest,
  },
];
assert.throws(
  () =>
    buildProgramLineageEnvelope(successor, {
      trustedPlannerDigests,
    }),
  (error) => error.checkId === "program.lineage.replay-protected",
);
const successorEnvelope = buildProgramLineageEnvelope(successor, {
  trustedPlannerDigests,
  trustedPreviousEnvelope: envelope,
});
assert.equal(successorEnvelope.lineage.attemptOrdinal, 2);

const rewrittenHistory = structuredClone(successor);
rewrittenHistory.lineage.acceptedAttempts[0].attemptNonce =
  "nonce.synthetic-startup-program.rewritten";
assert.throws(
  () =>
    buildProgramLineageEnvelope(rewrittenHistory, {
      trustedPlannerDigests,
      trustedPreviousEnvelope: envelope,
    }),
  (error) => error.checkId === "program.lineage.replay-protected",
);

const lineageSource = readFileSync(
  resolve("scripts/startup-program-lineage.mjs"),
  "utf8",
);
assert.doesNotMatch(
  lineageSource,
  /node:(?:child_process|http|https|net|tls)/,
);
assert.doesNotMatch(
  lineageSource,
  /\b(?:writeFile|appendFile|mkdir|rmSync|unlink|rename|copyFile|fetch)\w*\s*\(/,
);
validateProgramLineageEnvelope(
  JSON.parse(
    readFileSync(
      resolve("agent/examples/program-lineage-envelope.json"),
      "utf8",
    ),
  ),
);

console.log(
  `Program lineage validation passed with ${negativeJourneys.length} fail-closed journeys.`,
);
