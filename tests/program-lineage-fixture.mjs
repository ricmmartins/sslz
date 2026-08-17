import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planPostgresqlMigration,
  postgresqlMigrationDigest,
} from "../scripts/startup-postgresql-migration-plan.mjs";
import {
  planPostgresqlRehearsal,
  postgresqlRehearsalDigest,
} from "../scripts/startup-postgresql-rehearsal-plan.mjs";
import {
  planPostgresqlExecution,
  postgresqlExecutionDigest,
} from "../scripts/startup-postgresql-execution-plan.mjs";
import {
  planContainerImageCicd,
} from "../scripts/startup-container-image-cicd-plan.mjs";
import {
  connectivityPlanDigest,
  planConnectivity,
} from "../scripts/startup-connectivity-plan.mjs";
import {
  PROGRAM_LINEAGE_CHECK_IDS,
  PROGRAM_STAGE_ORDER,
  buildPredecessorProgramLineageEnvelope,
  buildProgramLineageEnvelope,
  programLineageDigest,
  validateProgramLineageEnvelope,
} from "../scripts/startup-program-lineage.mjs";
import { planControlPlaneOwnership } from "../scripts/startup-control-plane-ownership-plan.mjs";
import {
  createControlPlaneOwnershipFixture,
  finalizeIntegrity,
} from "./control-plane-ownership-fixture.mjs";

const root = resolve(import.meta.dirname, "..");
const PROGRAM_GENERATED_AT = "2026-08-12T12:50:00.000Z";
const EXECUTION_AS_OF = "2026-08-12T12:50:00Z";

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function bindRehearsalEvidence(migrationPlan, lineage) {
  const evidence = readJson("agent/examples/postgresql-rehearsal-evidence.json");
  evidence.bindings = {
    sourceAssessmentDigest: migrationPlan.sourceAssessmentDigest,
    migrationPlanDigest: migrationPlan.planDigest,
    migrationIdentityDigest:
      migrationPlan.identityBindings.migrationIdentityDigest,
    targetRegion: migrationPlan.target.region,
    targetEngine: structuredClone(migrationPlan.target.engine),
    targetPostgresqlDecisionDigest:
      migrationPlan.identityBindings.targetPostgresqlDecisionDigest,
    targetPostgresqlSelectedEvidenceDigest:
      migrationPlan.identityBindings.targetPostgresqlSelectedEvidenceDigest,
    targetMigrationEvidenceDigest:
      migrationPlan.identityBindings.targetMigrationEvidenceDigest,
    strategy: migrationPlan.strategy.selected,
    scopeDigest: migrationPlan.identityBindings.scopeDigest,
    validationPlanDigest:
      migrationPlan.identityBindings.validationPlanDigest,
    rollbackPlanDigest: migrationPlan.identityBindings.rollbackPlanDigest,
    acceptedLineageDigest: postgresqlRehearsalDigest(lineage),
  };
  return evidence;
}

function buildPostgresqlProgram(postgresqlRegionalPlanInput) {
  const migrationPlanInput = readJson(
    "agent/examples/postgresql-migration-plan-input.json",
  );
  migrationPlanInput.target.regionalPlanningInput = structuredClone(
    postgresqlRegionalPlanInput,
  );
  const migrationPlan = planPostgresqlMigration(migrationPlanInput);
  const rehearsalLineage = readJson(
    "agent/examples/postgresql-rehearsal-lineage.json",
  );
  const rehearsalEvidence = bindRehearsalEvidence(
    migrationPlan,
    rehearsalLineage,
  );
  const rehearsalPlan = planPostgresqlRehearsal(
    migrationPlanInput.sourceAssessment,
    migrationPlanInput,
    migrationPlan,
    rehearsalEvidence,
    rehearsalLineage,
    "2026-08-12T12:30:00Z",
    postgresqlMigrationDigest(migrationPlanInput),
    migrationPlan.planDigest,
    postgresqlRehearsalDigest(rehearsalLineage),
  );
  const executionDocuments = {
    sourceAssessment: structuredClone(migrationPlanInput.sourceAssessment),
    migrationPlanInput,
    migrationPlan,
    rehearsalEvidence,
    rehearsalPlan,
    request: readJson("agent/examples/postgresql-execution-request.json"),
    liveEvidence: readJson(
      "agent/examples/postgresql-execution-evidence.json",
    ),
    approvals: readJson(
      "agent/examples/postgresql-execution-approvals.json",
    ),
    lineage: readJson("agent/examples/postgresql-execution-lineage.json"),
    trust: readJson("agent/examples/postgresql-execution-trust.json"),
  };
  const executionPlan = planPostgresqlExecution(
    executionDocuments,
    EXECUTION_AS_OF,
    postgresqlExecutionDigest(executionDocuments.trust),
    postgresqlExecutionDigest({
      evaluatedAt: new Date(EXECUTION_AS_OF).toISOString(),
    }),
  );
  assert.equal(migrationPlan.status, "ready");
  assert.equal(rehearsalPlan.status, "ready-for-cutover-review");
  assert.equal(executionPlan.status, "blocked");
  assert.equal(executionPlan.executionEligibility.eligible, false);
  assert.equal(executionPlan.executionEligibility.executionPerformed, false);
  return {
    migrationPlanInput,
    migrationPlan,
    rehearsalEvidence,
    rehearsalLineage,
    rehearsalPlan,
    executionDocuments,
    executionPlan,
  };
}

function integrationBindings(baseline, migrationPlan) {
  return {
    workloadProfilePlanDigest: baseline.bindings.workloadProfilePlanDigest,
    regionalPlanDigest: baseline.bindings.regionalPlanDigest,
    iacPlanDigest: baseline.bindings.iacPlanDigest,
    readinessEvidenceDigest: baseline.bindings.readinessEvidenceDigest,
    deploymentManifestDigest: baseline.bindings.deploymentManifestDigest,
    deploymentApprovalDigest: baseline.bindings.deploymentApprovalDigest,
    postgresqlMigrationIdentityDigest:
      migrationPlan.identityBindings.migrationIdentityDigest,
  };
}

function buildContainerProgram(baseline, migrationPlan) {
  const planInput = readJson(
    "agent/examples/container-image-cicd-plan-input.json",
  );
  planInput.target.registryTargetEvidence.region = baseline.target.region;
  planInput.integration = integrationBindings(baseline, migrationPlan);
  const plan = planContainerImageCicd(planInput);
  assert.equal(plan.status, "ready");
  return { planInput, plan };
}

function buildConnectivityProgram(baseline, migrationPlan, containerPlan) {
  const planInput = readJson("agent/examples/connectivity-plan-input.json");
  const rewriteDates = (value) => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        value[index] = rewriteDates(value[index]);
      }
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        value[key] = rewriteDates(child);
      }
    } else if (typeof value === "string") {
      return value
        .replaceAll("2026-09-01", "2026-08-12")
        .replaceAll("2026-09-02", "2026-08-13");
    }
    return value;
  };
  rewriteDates(planInput);
  planInput.target.connectivityTargetEvidence.region = baseline.target.region;
  planInput.integration = {
    ...integrationBindings(baseline, migrationPlan),
    containerImageCicdPlanDigest: containerPlan.planDigest,
  };
  planInput.integrityClaims.sourceAssessmentDigestClaim =
    connectivityPlanDigest(planInput.sourceAssessment);
  planInput.integrityClaims.targetEvidenceDigestClaim =
    connectivityPlanDigest(planInput.target);
  const plan = planConnectivity(planInput);
  assert.equal(plan.status, "ready");
  return { planInput, plan };
}

function createProgramLineageInput(baseline, { postgresqlRegionalPlanInput }) {
  const postgresql = buildPostgresqlProgram(postgresqlRegionalPlanInput);
  const container = buildContainerProgram(
    baseline,
    postgresql.migrationPlan,
  );
  const connectivity = buildConnectivityProgram(
    baseline,
    postgresql.migrationPlan,
    container.plan,
  );
  return {
    schemaVersion: "1.0.0",
    programId: "program.synthetic-startup-lineage.v1",
    generatedAt: PROGRAM_GENERATED_AT,
    evidenceMode: "synthetic",
    baseline: structuredClone(baseline),
    lineage: {
      lineageId: "lineage.synthetic-startup-program",
      attemptOrdinal: 1,
      attemptNonce: "nonce.synthetic-startup-program.0001",
      acceptedAttempts: [],
    },
    stageOrder: [...PROGRAM_STAGE_ORDER],
    postgresql,
    container,
    connectivity,
  };
}

function createTrustedPlannerDigests(input) {
  return {
    postgresqlMigrationPlanInputDigest: postgresqlMigrationDigest(
      input.postgresql.migrationPlanInput,
    ),
    postgresqlMigrationPlanDigest: input.postgresql.migrationPlan.planDigest,
    postgresqlRehearsalLineageDigest: postgresqlRehearsalDigest(
      input.postgresql.rehearsalLineage,
    ),
    postgresqlExecutionTrustManifestDigest: postgresqlExecutionDigest(
      input.postgresql.executionDocuments.trust,
    ),
    postgresqlExecutionEvaluationTimeDigest: postgresqlExecutionDigest({
      evaluatedAt: input.postgresql.executionPlan.evaluatedAt,
    }),
  };
}

function createOwnershipProgram(input, trustedPlannerDigests) {
  const predecessorEnvelope = buildPredecessorProgramLineageEnvelope(input, {
    trustedPlannerDigests,
  });
  const fixture = createControlPlaneOwnershipFixture("aws");
  const trustedBindings = {
    predecessorProgramLineageEnvelopeDigest:
      predecessorEnvelope.envelopeDigest,
    programIdentityDigest: predecessorEnvelope.programIdentityDigest,
    connectivityPlanDigest: input.connectivity.plan.planDigest,
    postgresqlMigrationPlanDigest:
      input.postgresql.migrationPlan.planDigest,
    containerImageCicdPlanDigest: input.container.plan.planDigest,
    readinessEvidenceDigest:
      input.baseline.bindings.readinessEvidenceDigest,
    iacPlanDigest: input.baseline.bindings.iacPlanDigest,
    deploymentManifestDigest:
      input.baseline.bindings.deploymentManifestDigest,
    deploymentApprovalDigest:
      input.baseline.bindings.deploymentApprovalDigest,
    environment: input.baseline.target.environment,
    environmentReference: input.baseline.target.environmentReference,
    targetReference: input.baseline.target.targetReference,
  };
  fixture.input.integration = structuredClone(trustedBindings);
  fixture.input.target = structuredClone(input.baseline.target);
  fixture.input.planId = "ownership.synthetic.program-lineage.orders.v1";
  finalizeIntegrity(fixture.input);
  return {
    input: fixture.input,
    plan: planControlPlaneOwnership(fixture.input, { trustedBindings }),
    trustedBindings,
    predecessorEnvelope,
  };
}

function expectBlocked(id, expectedCheckId, action) {
  let error;
  try {
    action();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${id} must fail closed.`);
  assert.equal(error.checkId, expectedCheckId, id);
  return {
    id,
    status: "blocked",
    failedAtStage: "program-lineage",
    blockerIds: [error.checkId],
    writePreparationEvents: 0,
    diagnostic: error.message,
  };
}

function buildNegativeJourneys(
  validInput,
  envelope,
  trustedPlannerDigests,
  ownership,
) {
  const build = (input) =>
    buildProgramLineageEnvelope(input, { trustedPlannerDigests });
  const upstreamMutation = structuredClone(validInput);
  upstreamMutation.postgresql.migrationPlan.sourceAssessment.size.usedGiB += 1;

  const staleEvidence = structuredClone(validInput);
  staleEvidence.container.planInput.sourceAssessment.observedAt =
    "2026-08-01T10:00:00Z";
  staleEvidence.container.planInput.sourceAssessment.expiresAt =
    "2026-08-02T10:00:00Z";
  staleEvidence.container.plan = planContainerImageCicd(
    staleEvidence.container.planInput,
  );

  const omittedArtifact = structuredClone(validInput);
  delete omittedArtifact.connectivity;

  const replay = structuredClone(validInput);
  replay.lineage.acceptedAttempts.push({
    attemptOrdinal: replay.lineage.attemptOrdinal,
    attemptNonce: replay.lineage.attemptNonce,
    envelopeDigest: `sha256:${"1".repeat(64)}`,
  });

  const duplicateStage = structuredClone(validInput);
  duplicateStage.stageOrder[4] = duplicateStage.stageOrder[3];

  const outOfOrderStage = structuredClone(validInput);
  [outOfOrderStage.stageOrder[1], outOfOrderStage.stageOrder[2]] = [
    outOfOrderStage.stageOrder[2],
    outOfOrderStage.stageOrder[1],
  ];

  const targetMismatch = structuredClone(validInput);
  targetMismatch.baseline.target.region = "westus3";

  const lineageMismatch = structuredClone(envelope);
  lineageMismatch.stages[1].predecessorDigest = `sha256:${"2".repeat(64)}`;
  lineageMismatch.stages[1].stageDigest = programLineageDigest(
    Object.fromEntries(
      Object.entries(lineageMismatch.stages[1]).filter(
        ([key]) => key !== "stageDigest",
      ),
    ),
  );

  const crossProgramSubstitution = structuredClone(validInput);
  crossProgramSubstitution.connectivity.planInput.integration.containerImageCicdPlanDigest =
    `sha256:${"3".repeat(64)}`;
  crossProgramSubstitution.connectivity.plan = planConnectivity(
    crossProgramSubstitution.connectivity.planInput,
  );

  const ownershipSubstitution = structuredClone(ownership);
  ownershipSubstitution.input.integration.connectivityPlanDigest =
    `sha256:${"4".repeat(64)}`;

  return [
    expectBlocked(
      "program-upstream-mutation",
      PROGRAM_LINEAGE_CHECK_IDS.digestsCurrent,
      () => build(upstreamMutation),
    ),
    expectBlocked(
      "program-stale-evidence",
      PROGRAM_LINEAGE_CHECK_IDS.evidenceCurrent,
      () => build(staleEvidence),
    ),
    expectBlocked(
      "program-artifact-omission",
      PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
      () => build(omittedArtifact),
    ),
    expectBlocked(
      "program-lineage-replay",
      PROGRAM_LINEAGE_CHECK_IDS.replayProtected,
      () => build(replay),
    ),
    expectBlocked(
      "program-duplicate-stage",
      PROGRAM_LINEAGE_CHECK_IDS.stageOrderValid,
      () => build(duplicateStage),
    ),
    expectBlocked(
      "program-out-of-order-stage",
      PROGRAM_LINEAGE_CHECK_IDS.stageOrderValid,
      () => build(outOfOrderStage),
    ),
    expectBlocked(
      "program-target-mismatch",
      PROGRAM_LINEAGE_CHECK_IDS.targetBound,
      () => build(targetMismatch),
    ),
    expectBlocked(
      "program-lineage-mismatch",
      PROGRAM_LINEAGE_CHECK_IDS.lineageBound,
      () => validateProgramLineageEnvelope(lineageMismatch),
    ),
    expectBlocked(
      "program-cross-artifact-substitution",
      PROGRAM_LINEAGE_CHECK_IDS.crossProgramBound,
      () => build(crossProgramSubstitution),
    ),
    expectBlocked(
      "program-ownership-artifact-substitution",
      PROGRAM_LINEAGE_CHECK_IDS.crossProgramBound,
      () =>
        buildProgramLineageEnvelope(validInput, {
          trustedPlannerDigests,
          ownership: ownershipSubstitution,
        }),
    ),
  ];
}

function runProgramLineageJourney(baseline, dependencies) {
  const input = createProgramLineageInput(baseline, dependencies);
  const trustedPlannerDigests = createTrustedPlannerDigests(input);
  const ownership = createOwnershipProgram(input, trustedPlannerDigests);
  const first = buildProgramLineageEnvelope(input, {
    trustedPlannerDigests,
    ownership,
  });
  const second = buildProgramLineageEnvelope(structuredClone(input), {
    trustedPlannerDigests,
    ownership: structuredClone(ownership),
  });
  assert.deepEqual(second, first, "Program lineage must be deterministic.");
  assert(
    first.stages.every(
      (stage) =>
        !stage.executionEnabled &&
        !stage.executionEligible &&
        !stage.executionAllowed,
    ),
    "Every program lineage stage must remain non-executable.",
  );
  return {
    input,
    trustedPlannerDigests,
    envelope: first,
    ownership,
    negativeJourneys: buildNegativeJourneys(
      input,
      first,
      trustedPlannerDigests,
      ownership,
    ),
  };
}

export {
  PROGRAM_GENERATED_AT,
  createProgramLineageInput,
  createOwnershipProgram,
  createTrustedPlannerDigests,
  runProgramLineageJourney,
};
