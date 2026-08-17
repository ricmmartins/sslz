#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  planPostgresqlMigration,
  postgresqlMigrationDigest,
} from "./startup-postgresql-migration-plan.mjs";
import { planPostgresql } from "./startup-postgresql-plan.mjs";
import {
  planPostgresqlRehearsal,
  postgresqlRehearsalDigest,
} from "./startup-postgresql-rehearsal-plan.mjs";
import {
  planPostgresqlExecution,
  postgresqlExecutionDigest,
} from "./startup-postgresql-execution-plan.mjs";
import {
  planContainerImageCicd,
  containerImageCicdDigest,
} from "./startup-container-image-cicd-plan.mjs";
import {
  planConnectivity,
  connectivityPlanDigest,
} from "./startup-connectivity-plan.mjs";
import {
  controlPlaneOwnershipDigest,
  planControlPlaneOwnership,
} from "./startup-control-plane-ownership-plan.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PROGRAM_LINEAGE_CHECK_IDS = Object.freeze({
  artifactsComplete: "program.lineage.artifacts-complete",
  digestsCurrent: "program.lineage.digests-current",
  evidenceCurrent: "program.lineage.evidence-current",
  stageOrderValid: "program.lineage.stage-order-valid",
  replayProtected: "program.lineage.replay-protected",
  targetBound: "program.lineage.target-bound",
  lineageBound: "program.lineage.lineage-bound",
  crossProgramBound: "program.lineage.cross-program-bound",
  authoritySeparated: "program.lineage.authority-separated",
});
const PROGRAM_LINEAGE_CHECK_ORDER = Object.freeze(
  Object.values(PROGRAM_LINEAGE_CHECK_IDS),
);
const PROGRAM_STAGE_ORDER = Object.freeze([
  "postgresql-migration-planning",
  "postgresql-rehearsal-planning",
  "postgresql-execution-contract-planning",
  "container-image-cicd-planning",
  "dual-cloud-connectivity-planning",
]);
const FINAL_PROGRAM_STAGE_ORDER = Object.freeze([
  ...PROGRAM_STAGE_ORDER,
  "control-plane-ownership-planning",
]);
const EXCLUDED_AUTHORITIES = Object.freeze([
  "provider-registration",
  "platform-deployment",
  "container-image-promotion",
  "database-migration-writes",
  "dns-changes",
  "dual-cloud-network-operations",
  "egress-changes",
  "identity-changes",
  "migration-cutover",
  "migration-rollback-or-failback",
  "certificate-issuance-or-renewal",
  "secret-store-or-rotation-writes",
  "pipeline-or-artifact-promotion-writes",
  "application-configuration-or-feature-flag-writes",
  "traffic-database-or-application-writes",
  "backup-or-restore-operations",
]);
const FUTURE_AUTHORITIES = Object.freeze({
  "postgresql-migration-planning": "postgresql-migration-stage-approvals",
  "postgresql-rehearsal-planning": "postgresql-rehearsal-execution-approval",
  "postgresql-execution-contract-planning":
    "postgresql-stage-specific-signed-authorities",
  "container-image-cicd-planning":
    "container-promotion-and-pipeline-authorities",
  "dual-cloud-connectivity-planning":
    "connectivity-dns-identity-egress-authorities",
  "control-plane-ownership-planning":
    "capability-specific-live-control-plane-authorities",
});

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const inputSchema = load("agent/schemas/program-lineage-input.schema.json");
const outputSchema = load("agent/schemas/program-lineage-envelope.schema.json");
const trustedDigestsSchema = load(
  "agent/schemas/program-lineage-trusted-digests.schema.json",
);
const artifactSchemas = Object.freeze({
  migrationPlanInput: load(
    "agent/schemas/postgresql-migration-plan-input.schema.json",
  ),
  migrationPlan: load("agent/schemas/postgresql-migration-plan.schema.json"),
  rehearsalEvidence: load(
    "agent/schemas/postgresql-rehearsal-evidence.schema.json",
  ),
  rehearsalLineage: load(
    "agent/schemas/postgresql-rehearsal-lineage.schema.json",
  ),
  rehearsalPlan: load("agent/schemas/postgresql-rehearsal-plan.schema.json"),
  executionPlan: load("agent/schemas/postgresql-execution-plan.schema.json"),
  containerPlanInput: load(
    "agent/schemas/container-image-cicd-plan-input.schema.json",
  ),
  containerPlan: load("agent/schemas/container-image-cicd-plan.schema.json"),
  connectivityPlanInput: load(
    "agent/schemas/connectivity-plan-input.schema.json",
  ),
  connectivityPlan: load("agent/schemas/connectivity-plan.schema.json"),
});

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

class ProgramLineageError extends Error {
  constructor(checkId, message) {
    super(message);
    this.name = "ProgramLineageError";
    this.checkId = checkId;
  }
}

function fail(checkId, message) {
  throw new ProgramLineageError(checkId, message);
}

function withoutField(value, field) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validateWithCheck(schema, value, checkId, label) {
  try {
    validateDocument(schema, value);
  } catch (error) {
    fail(checkId, `${label} is incomplete or invalid: ${error.message}`);
  }
}

function requirePlanDigest(plan, digestFunction, label) {
  const actual = digestFunction(withoutField(plan, "planDigest"));
  if (plan.planDigest !== actual) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.digestsCurrent,
      `${label} digest does not match its canonical content.`,
    );
  }
}

function requireCurrent(value, label) {
  if (value !== "current") {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.evidenceCurrent,
      `${label} must be current before it can enter program lineage.`,
    );
  }
}

function requireNonExecutable(plan, label) {
  if (plan.safety?.executionEnabled !== false) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.authoritySeparated,
      `${label} must keep executionEnabled=false.`,
    );
  }
  if (plan.stages?.some((stage) => stage.executionAllowed !== false)) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.authoritySeparated,
      `${label} contains a stage that is execution-enabled.`,
    );
  }
}

function validateStageOrder(stageOrder, expectedOrder = PROGRAM_STAGE_ORDER) {
  if (
    stageOrder.length !== expectedOrder.length ||
    !same(stageOrder, expectedOrder)
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.stageOrderValid,
      "Program stages must be complete, unique, and in canonical order.",
    );
  }
}

function validateReplay(
  programId,
  lineage,
  trustedPreviousEnvelope = null,
  requireTrustedHistory = false,
) {
  const ordinals = lineage.acceptedAttempts.map(({ attemptOrdinal }) => attemptOrdinal);
  const nonces = lineage.acceptedAttempts.map(({ attemptNonce }) => attemptNonce);
  const envelopeDigests = lineage.acceptedAttempts.map(
    ({ envelopeDigest }) => envelopeDigest,
  );
  const continuous = ordinals.every((ordinal, index) => ordinal === index + 1);
  const latestAccepted = lineage.acceptedAttempts.at(-1) ?? null;
  let trustedHistoryValid = true;
  if (requireTrustedHistory && latestAccepted === null) {
    trustedHistoryValid = trustedPreviousEnvelope === null;
  } else if (requireTrustedHistory) {
    if (trustedPreviousEnvelope === null) {
      trustedHistoryValid = false;
    } else {
      validateProgramLineageEnvelope(trustedPreviousEnvelope);
      const expectedHistory = [
        ...trustedPreviousEnvelope.lineage.acceptedAttempts,
        {
          attemptOrdinal: trustedPreviousEnvelope.lineage.attemptOrdinal,
          attemptNonce: trustedPreviousEnvelope.lineage.attemptNonce,
          envelopeDigest: trustedPreviousEnvelope.envelopeDigest,
        },
      ];
      trustedHistoryValid =
        trustedPreviousEnvelope.programId === programId &&
        trustedPreviousEnvelope.lineage.lineageId === lineage.lineageId &&
        same(lineage.acceptedAttempts, expectedHistory);
    }
  }
  if (
    !continuous ||
    lineage.attemptOrdinal !== lineage.acceptedAttempts.length + 1 ||
    new Set(ordinals).size !== ordinals.length ||
    new Set(nonces).size !== nonces.length ||
    new Set(envelopeDigests).size !== envelopeDigests.length ||
    nonces.includes(lineage.attemptNonce) ||
    !trustedHistoryValid
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.replayProtected,
      "Program lineage attempt ordinal and nonce must be new and monotonic.",
    );
  }
}

function validateTemporalEvidence(value, evaluatedAt, path = "program") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateTemporalEvidence(item, evaluatedAt, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  const startsAt = value.observedAt ?? value.issuedAt;
  if (startsAt !== undefined && Object.hasOwn(value, "expiresAt")) {
    const observedAt = Date.parse(startsAt);
    const expiresAt = Date.parse(value.expiresAt);
    if (
      !Number.isFinite(observedAt) ||
      !Number.isFinite(expiresAt) ||
      observedAt > evaluatedAt ||
      expiresAt <= evaluatedAt
    ) {
      fail(
        PROGRAM_LINEAGE_CHECK_IDS.evidenceCurrent,
        `${path} evidence must be observed and unexpired at program generation time.`,
      );
    }
  }
  for (const [key, child] of Object.entries(value)) {
    validateTemporalEvidence(child, evaluatedAt, `${path}.${key}`);
  }
}

function baselineIntegration(input) {
  return {
    workloadProfilePlanDigest: input.baseline.bindings.workloadProfilePlanDigest,
    regionalPlanDigest: input.baseline.bindings.regionalPlanDigest,
    iacPlanDigest: input.baseline.bindings.iacPlanDigest,
    readinessEvidenceDigest: input.baseline.bindings.readinessEvidenceDigest,
    deploymentManifestDigest: input.baseline.bindings.deploymentManifestDigest,
    deploymentApprovalDigest: input.baseline.bindings.deploymentApprovalDigest,
    postgresqlMigrationIdentityDigest:
      input.postgresql.migrationPlan.identityBindings.migrationIdentityDigest,
  };
}

function validateArtifacts(input) {
  const pg = input.postgresql;
  validateWithCheck(
    artifactSchemas.migrationPlanInput,
    pg.migrationPlanInput,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "PostgreSQL migration input",
  );
  validateWithCheck(
    artifactSchemas.migrationPlan,
    pg.migrationPlan,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "PostgreSQL migration plan",
  );
  validateWithCheck(
    artifactSchemas.rehearsalEvidence,
    pg.rehearsalEvidence,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "PostgreSQL rehearsal evidence",
  );
  validateWithCheck(
    artifactSchemas.rehearsalLineage,
    pg.rehearsalLineage,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "PostgreSQL rehearsal lineage",
  );
  validateWithCheck(
    artifactSchemas.rehearsalPlan,
    pg.rehearsalPlan,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "PostgreSQL rehearsal plan",
  );
  validateWithCheck(
    artifactSchemas.executionPlan,
    pg.executionPlan,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "PostgreSQL execution contract plan",
  );
  validateWithCheck(
    artifactSchemas.containerPlanInput,
    input.container.planInput,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "Container image and CI/CD input",
  );
  validateWithCheck(
    artifactSchemas.containerPlan,
    input.container.plan,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "Container image and CI/CD plan",
  );
  validateWithCheck(
    artifactSchemas.connectivityPlanInput,
    input.connectivity.planInput,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "Connectivity input",
  );
  validateWithCheck(
    artifactSchemas.connectivityPlan,
    input.connectivity.plan,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "Connectivity plan",
  );
}

function validateDigests(input) {
  const pg = input.postgresql;
  requirePlanDigest(
    pg.migrationPlan,
    postgresqlMigrationDigest,
    "PostgreSQL migration plan",
  );
  requirePlanDigest(
    pg.rehearsalPlan,
    postgresqlRehearsalDigest,
    "PostgreSQL rehearsal plan",
  );
  requirePlanDigest(
    pg.executionPlan,
    postgresqlExecutionDigest,
    "PostgreSQL execution contract plan",
  );
  requirePlanDigest(
    input.container.plan,
    containerImageCicdDigest,
    "Container image and CI/CD plan",
  );
  requirePlanDigest(
    input.connectivity.plan,
    connectivityPlanDigest,
    "Connectivity plan",
  );
}

function validateFreshnessAndSafety(input) {
  const pg = input.postgresql;
  const evaluatedAt = Date.parse(input.generatedAt);
  validateTemporalEvidence(pg.migrationPlanInput, evaluatedAt, "postgresql");
  validateTemporalEvidence(
    pg.rehearsalEvidence,
    evaluatedAt,
    "postgresql.rehearsal",
  );
  validateTemporalEvidence(
    pg.executionDocuments,
    evaluatedAt,
    "postgresql.execution",
  );
  validateTemporalEvidence(input.container.planInput, evaluatedAt, "container");
  validateTemporalEvidence(
    input.connectivity.planInput,
    evaluatedAt,
    "connectivity",
  );
  const planningTimes = [
    pg.migrationPlanInput.planningAt,
    pg.rehearsalPlan.evaluatedAt,
    pg.executionPlan.evaluatedAt,
    input.container.planInput.planningAt,
    input.connectivity.planInput.planningAt,
  ].map(Date.parse);
  if (
    !Number.isFinite(evaluatedAt) ||
    Date.parse(pg.executionPlan.evaluatedAt) !== evaluatedAt ||
    planningTimes.some(
      (planningAt) =>
        !Number.isFinite(planningAt) || planningAt > evaluatedAt,
    )
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.evidenceCurrent,
      "Program generation time must be at or after every planner evaluation time.",
    );
  }
  const executionEvidenceCheck = pg.executionPlan.checks.find(
    ({ id }) => id === "execution.postgresql.evidence-current",
  );
  if (
    executionEvidenceCheck?.classification !== "pass" ||
    executionEvidenceCheck.freshness !== "current"
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.evidenceCurrent,
      "PostgreSQL execution evidence and approvals must satisfy the planner's current-age and temporal-order checks at program generation time.",
    );
  }
  if (
    pg.migrationPlan.status !== "ready" ||
    pg.rehearsalPlan.status !== "ready-for-cutover-review" ||
    input.container.plan.status !== "ready" ||
    input.connectivity.plan.status !== "ready"
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.evidenceCurrent,
      "Every migration and dual-cloud planning artifact must be ready before lineage is emitted.",
    );
  }

  requireCurrent(
    pg.migrationPlan.identityBindings.sourceAssessmentFreshness,
    "PostgreSQL source assessment",
  );
  requireCurrent(
    input.container.plan.identityBindings.sourceAssessmentFreshness,
    "Container source assessment",
  );
  requireCurrent(
    input.connectivity.plan.identityBindings.sourceAssessmentFreshness,
    "Connectivity source assessment",
  );
  requireNonExecutable(pg.migrationPlan, "PostgreSQL migration plan");
  requireNonExecutable(pg.rehearsalPlan, "PostgreSQL rehearsal plan");
  requireNonExecutable(input.container.plan, "Container image and CI/CD plan");
  requireNonExecutable(input.connectivity.plan, "Connectivity plan");
  if (
    pg.executionPlan.safety.executionEnabled !== false ||
    pg.executionPlan.executionEligibility.executionPerformed !== false
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.authoritySeparated,
      "PostgreSQL execution planning must perform no execution.",
    );
  }
}

function validateCanonicalPlannerOutputs(input, trustedPlannerDigests) {
  const pg = input.postgresql;
  const expectedTrustedDigests = {
    postgresqlMigrationPlanInputDigest: postgresqlMigrationDigest(
      pg.migrationPlanInput,
    ),
    postgresqlMigrationPlanDigest: pg.migrationPlan.planDigest,
    postgresqlRehearsalLineageDigest: postgresqlRehearsalDigest(
      pg.rehearsalLineage,
    ),
    postgresqlExecutionTrustManifestDigest: postgresqlExecutionDigest(
      pg.executionDocuments.trust,
    ),
    postgresqlExecutionEvaluationTimeDigest: postgresqlExecutionDigest({
      evaluatedAt: input.generatedAt,
    }),
  };
  if (!same(trustedPlannerDigests, expectedTrustedDigests)) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.digestsCurrent,
      "Externally protected planner digests must exactly bind the supplied planner artifacts and evaluation time.",
    );
  }
  let expectedMigrationPlan;
  let expectedRehearsalPlan;
  let expectedExecutionPlan;
  let expectedContainerPlan;
  let expectedConnectivityPlan;
  try {
    expectedMigrationPlan = planPostgresqlMigration(pg.migrationPlanInput);
    expectedRehearsalPlan = planPostgresqlRehearsal(
      pg.migrationPlanInput.sourceAssessment,
      pg.migrationPlanInput,
      pg.migrationPlan,
      pg.rehearsalEvidence,
      pg.rehearsalLineage,
      pg.rehearsalPlan.evaluatedAt,
      trustedPlannerDigests.postgresqlMigrationPlanInputDigest,
      trustedPlannerDigests.postgresqlMigrationPlanDigest,
      trustedPlannerDigests.postgresqlRehearsalLineageDigest,
    );
    expectedExecutionPlan = planPostgresqlExecution(
      pg.executionDocuments,
      input.generatedAt,
      trustedPlannerDigests.postgresqlExecutionTrustManifestDigest,
      trustedPlannerDigests.postgresqlExecutionEvaluationTimeDigest,
    );
    expectedContainerPlan = planContainerImageCicd(input.container.planInput);
    expectedConnectivityPlan = planConnectivity(input.connectivity.planInput);
  } catch (error) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.digestsCurrent,
      `Protected planner inputs do not reproduce canonical outputs: ${error.message}`,
    );
  }
  if (
    !same(pg.migrationPlan, expectedMigrationPlan) ||
    !same(pg.rehearsalPlan, expectedRehearsalPlan) ||
    !same(pg.executionPlan, expectedExecutionPlan) ||
    !same(input.container.plan, expectedContainerPlan) ||
    !same(input.connectivity.plan, expectedConnectivityPlan)
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.digestsCurrent,
      "Every planner artifact must equal the canonical output of its supplied planner input.",
    );
  }
}

function validateTargets(input) {
  const baseline = input.baseline;
  const pg = input.postgresql;
  const regions = [
    pg.migrationPlan.target.region,
    pg.rehearsalPlan.target.region,
    pg.executionPlan.target.region,
    input.container.plan.target.region,
    input.connectivity.plan.target.region,
  ];
  const containerEnvironments = input.container.plan.sourceAssessment.cicd.environments.map(
    ({ name }) => name,
  );
  const connectivityEnvironments =
    input.connectivity.plan.sourceAssessment.identity.environments.map(
      ({ name }) => name,
    );
  if (
    regions.some((region) => region !== baseline.target.region) ||
    !containerEnvironments.includes(baseline.target.environment) ||
    !connectivityEnvironments.includes(baseline.target.environment) ||
    pg.executionPlan.target.environmentReference !==
      baseline.target.environmentReference ||
    pg.executionPlan.target.targetReference !== baseline.target.targetReference
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.targetBound,
      "All program artifacts must bind the exact baseline region, environment, and PostgreSQL target aliases.",
    );
  }
}

function validatePostgresqlLineage(input) {
  const pg = input.postgresql;
  const regionalPlan = planPostgresql(
    pg.migrationPlanInput.target.regionalPlanningInput,
  );
  const expectedMigrationInputDigest = postgresqlMigrationDigest(
    pg.migrationPlanInput,
  );
  const expectedRehearsalEvidenceDigest = postgresqlRehearsalDigest(
    pg.rehearsalEvidence,
  );
  const expectedRehearsalLineageDigest = postgresqlRehearsalDigest(
    pg.rehearsalLineage,
  );
  const bindings = pg.executionPlan.artifactBindings;
  const migrationBindings = pg.migrationPlan.identityBindings;
  if (
    migrationBindings.sourceAssessmentDigest !==
      postgresqlMigrationDigest(pg.migrationPlanInput.sourceAssessment) ||
    migrationBindings.targetPostgresqlDecisionDigest !==
      regionalPlan.decisionDigest ||
    migrationBindings.targetPostgresqlDecisionDigest !==
      input.baseline.bindings.postgresqlDecisionDigest ||
    pg.rehearsalEvidence.bindings.acceptedLineageDigest !==
      expectedRehearsalLineageDigest ||
    pg.rehearsalPlan.acceptedLineageDigest !== expectedRehearsalLineageDigest ||
    pg.rehearsalPlan.migrationPlanInputDigest !==
      expectedMigrationInputDigest ||
    pg.rehearsalPlan.migrationPlanDigest !== pg.migrationPlan.planDigest ||
    bindings.sourceAssessmentDigest !== pg.migrationPlan.sourceAssessmentDigest ||
    bindings.migrationPlanInputDigest !== expectedMigrationInputDigest ||
    bindings.migrationPlanDigest !== pg.migrationPlan.planDigest ||
    bindings.rehearsalEvidenceDigest !== expectedRehearsalEvidenceDigest ||
    bindings.rehearsalPlanDigest !== pg.rehearsalPlan.planDigest
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.lineageBound,
      "PostgreSQL assessment, migration, rehearsal, and execution-contract lineage must link exactly.",
    );
  }
}

function validatePlannerInputBindings(input) {
  const containerInput = input.container.planInput;
  const containerBindings = input.container.plan.identityBindings;
  const connectivityInput = input.connectivity.planInput;
  const connectivityBindings = input.connectivity.plan.identityBindings;
  if (
    containerBindings.sourceAssessmentDigest !==
      containerImageCicdDigest(containerInput.sourceAssessment) ||
    containerBindings.registryEvidenceDigest !==
      containerImageCicdDigest(containerInput.target.registryTargetEvidence) ||
    containerBindings.cicdEvidenceDigest !==
      containerImageCicdDigest(containerInput.target.cicdTargetEvidence) ||
    containerBindings.regionPolicyDigest !==
      containerImageCicdDigest(containerInput.target.regionPolicy) ||
    containerBindings.requirementsDigest !==
      containerImageCicdDigest(containerInput.requirements) ||
    containerBindings.transitionDigest !==
      containerImageCicdDigest(containerInput.transition) ||
    containerBindings.scopeDigest !==
      containerImageCicdDigest(containerInput.scope) ||
    containerBindings.ownerDigest !==
      containerImageCicdDigest(containerInput.sourceAssessment.governance.owner) ||
    containerBindings.lineageDigest !==
      containerImageCicdDigest(containerInput.lineage) ||
    containerBindings.integrationDigest !==
      containerImageCicdDigest(containerInput.integration) ||
    connectivityBindings.sourceAssessmentDigest !==
      connectivityPlanDigest(connectivityInput.sourceAssessment) ||
    connectivityBindings.connectivityEvidenceDigest !==
      connectivityPlanDigest(
        connectivityInput.target.connectivityTargetEvidence,
      ) ||
    connectivityBindings.dnsEvidenceDigest !==
      connectivityPlanDigest(connectivityInput.target.dnsTargetEvidence) ||
    connectivityBindings.identityEvidenceDigest !==
      connectivityPlanDigest(connectivityInput.target.identityTargetEvidence) ||
    connectivityBindings.egressEvidenceDigest !==
      connectivityPlanDigest(connectivityInput.target.egressTargetEvidence) ||
    connectivityBindings.regionPolicyDigest !==
      connectivityPlanDigest(connectivityInput.target.regionPolicy) ||
    connectivityBindings.requirementsDigest !==
      connectivityPlanDigest(connectivityInput.requirements) ||
    connectivityBindings.transitionDigest !==
      connectivityPlanDigest(connectivityInput.transition) ||
    connectivityBindings.ownerDigest !==
      connectivityPlanDigest(
        connectivityInput.sourceAssessment.governance.owner,
      ) ||
    connectivityBindings.lineageDigest !==
      connectivityPlanDigest(connectivityInput.lineage) ||
    connectivityBindings.integrationDigest !==
      connectivityPlanDigest(connectivityInput.integration)
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.lineageBound,
      "Every planner output must bind the exact planner input artifacts.",
    );
  }
}

function validateCrossProgramBindings(input) {
  const baseline = baselineIntegration(input);
  const containerIntegration = input.container.planInput.integration;
  const connectivityIntegration = input.connectivity.planInput.integration;
  if (
    !same(containerIntegration, baseline) ||
    !same(connectivityIntegration, {
      ...baseline,
      containerImageCicdPlanDigest: input.container.plan.planDigest,
    })
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.crossProgramBound,
      "Container and connectivity planners must bind the exact baseline and preceding program artifacts.",
    );
  }
}

function stageArtifactDigests(input) {
  return [
    input.postgresql.migrationPlan.planDigest,
    input.postgresql.rehearsalPlan.planDigest,
    input.postgresql.executionPlan.planDigest,
    input.container.plan.planDigest,
    input.connectivity.plan.planDigest,
  ];
}

function buildStages(input, baselineBindingDigest) {
  let predecessorDigest = baselineBindingDigest;
  return PROGRAM_STAGE_ORDER.map((id, index) => {
    const stage = {
      id,
      status:
        id === "postgresql-execution-contract-planning"
          ? "future-authorities-required"
          : "ready-for-human-review",
      evidenceMode: input.evidenceMode,
      artifactDigest: stageArtifactDigests(input)[index],
      predecessorDigest,
      executionEnabled: false,
      executionEligible: false,
      executionAllowed: false,
      requiredFutureAuthority: FUTURE_AUTHORITIES[id],
    };
    stage.stageDigest = digest(stage);
    predecessorDigest = stage.stageDigest;
    return stage;
  });
}

function validateProgramLineageEnvelope(envelope) {
  validateWithCheck(
    outputSchema,
    envelope,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "Program lineage envelope",
  );
  const envelopeStageOrder = envelope.stages.map(({ id }) => id);
  validateStageOrder(
    envelopeStageOrder,
    envelopeStageOrder.length === FINAL_PROGRAM_STAGE_ORDER.length
      ? FINAL_PROGRAM_STAGE_ORDER
      : PROGRAM_STAGE_ORDER,
  );
  if (
    !same(
      envelope.checks.map(({ id, classification }) => ({
        id,
        classification,
      })),
      PROGRAM_LINEAGE_CHECK_ORDER.map((id) => ({
        id,
        classification: "pass",
      })),
    ) ||
    !same(envelope.authorityBoundary.excludedAuthorities, EXCLUDED_AUTHORITIES) ||
    envelope.readiness.baselineGreenfieldDeployment.evidenceMode !==
      envelope.baseline.evidenceMode ||
    envelope.readiness.migrationAndDualCloudPlanning.evidenceMode !==
      envelope.evidenceMode
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.authoritySeparated,
      "Program checks, evidence modes, and excluded authorities must match the canonical non-executable contract.",
    );
  }
  const baselineBindingDigest = digest({
    journeyId: envelope.baseline.journeyId,
    evidenceMode: envelope.baseline.evidenceMode,
    target: envelope.baseline.target,
    bindings: envelope.baseline.bindings,
  });
  if (envelope.baseline.bindingDigest !== baselineBindingDigest) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.crossProgramBound,
      "Program baseline digest does not match its canonical identities.",
    );
  }
  const lineage = {
    lineageId: envelope.lineage.lineageId,
    attemptOrdinal: envelope.lineage.attemptOrdinal,
    attemptNonce: envelope.lineage.attemptNonce,
    acceptedAttempts: envelope.lineage.acceptedAttempts,
  };
  validateReplay(envelope.programId, lineage);
  if (
    envelope.lineage.acceptedAttemptCount !==
      envelope.lineage.acceptedAttempts.length ||
    envelope.lineage.lineageDigest !== digest(lineage)
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.replayProtected,
      "Program lineage history does not match its canonical digest.",
    );
  }
  if (
    envelope.stages.some(
      (stage) =>
        stage.executionEnabled ||
        stage.executionEligible ||
        stage.executionAllowed,
    )
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.authoritySeparated,
      "Program lineage cannot grant execution authority.",
    );
  }
  let predecessorDigest = baselineBindingDigest;
  for (const stage of envelope.stages) {
    if (
      stage.predecessorDigest !== predecessorDigest ||
      stage.stageDigest !== digest(withoutField(stage, "stageDigest")) ||
      stage.evidenceMode !== envelope.evidenceMode ||
      stage.requiredFutureAuthority !== FUTURE_AUTHORITIES[stage.id] ||
      stage.status !==
        (stage.id === "postgresql-execution-contract-planning"
          ? "future-authorities-required"
          : "ready-for-human-review")
    ) {
      fail(
        PROGRAM_LINEAGE_CHECK_IDS.lineageBound,
        "Program stage predecessor and content digests must form one exact chain.",
      );
    }
    predecessorDigest = stage.stageDigest;
  }
  const expectedIdentityDigest = digest({
    programId: envelope.programId,
    baselineBindingDigest: envelope.baseline.bindingDigest,
    lineageDigest: envelope.lineage.lineageDigest,
    finalStageDigest: predecessorDigest,
  });
  if (envelope.programIdentityDigest !== expectedIdentityDigest) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.lineageBound,
      "Program identity digest does not match the final stage chain.",
    );
  }
  if (
    envelope.envelopeDigest !==
    digest(withoutField(envelope, "envelopeDigest"))
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.digestsCurrent,
      "Program envelope digest does not match its canonical content.",
    );
  }
  return envelope;
}

function buildPredecessorProgramLineageEnvelope(
  input,
  {
    trustedPlannerDigests,
    trustedPreviousEnvelope = null,
  } = {},
) {
  validateWithCheck(
    inputSchema,
    input,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "Program lineage input",
  );
  validateWithCheck(
    trustedDigestsSchema,
    trustedPlannerDigests,
    PROGRAM_LINEAGE_CHECK_IDS.artifactsComplete,
    "Protected planner digests",
  );
  validateStageOrder(input.stageOrder);
  validateReplay(
    input.programId,
    input.lineage,
    trustedPreviousEnvelope,
    true,
  );
  validateArtifacts(input);
  validateDigests(input);
  validateFreshnessAndSafety(input);
  validateCanonicalPlannerOutputs(input, trustedPlannerDigests);
  validateTargets(input);
  validatePostgresqlLineage(input);
  validatePlannerInputBindings(input);
  validateCrossProgramBindings(input);

  const baselineBindingDigest = digest(input.baseline);
  const lineageDigest = digest(input.lineage);
  const stages = buildStages(input, baselineBindingDigest);
  const output = {
    schemaVersion: SCHEMA_VERSION,
    programId: input.programId,
    generatedAt: input.generatedAt,
    mode: "validation-only",
    evidenceMode: input.evidenceMode,
    status: "ready-for-human-review",
    readiness: {
      baselineGreenfieldDeployment: {
        status: "ready",
        evidenceMode: input.baseline.evidenceMode,
        authority: "signed-baseline-deployment-approval-only",
      },
      migrationAndDualCloudPlanning: {
        status: "ready-for-human-review",
        evidenceMode: input.evidenceMode,
        executionAuthority: "not-granted",
      },
    },
    authorityBoundary: {
      baselineApprovalScope: "greenfield-platform-deployment-only",
      excludedAuthorities: [
        ...EXCLUDED_AUTHORITIES,
      ],
      futureApprovalRequired: true,
    },
    baseline: {
      journeyId: input.baseline.journeyId,
      evidenceMode: input.baseline.evidenceMode,
      target: structuredClone(input.baseline.target),
      bindings: structuredClone(input.baseline.bindings),
      bindingDigest: baselineBindingDigest,
    },
    lineage: {
      lineageId: input.lineage.lineageId,
      attemptOrdinal: input.lineage.attemptOrdinal,
      attemptNonce: input.lineage.attemptNonce,
      acceptedAttempts: structuredClone(input.lineage.acceptedAttempts),
      acceptedAttemptCount: input.lineage.acceptedAttempts.length,
      lineageDigest,
    },
    checks: PROGRAM_LINEAGE_CHECK_ORDER.map((id) => ({
      id,
      classification: "pass",
    })),
    stages,
    safety: {
      executionEnabled: false,
      executionEligible: false,
      executionAllowed: false,
      networkCalls: "none",
      cloudOperations: "none",
      databaseOperations: "none",
      imageOperations: "none",
      dnsOperations: "none",
      identityOperations: "none",
      iacOperations: "none",
      generatedCommands: "none",
      generatedArtifacts: "stdout-only",
    },
    programIdentityDigest: digest({
      programId: input.programId,
      baselineBindingDigest,
      lineageDigest,
      finalStageDigest: stages.at(-1).stageDigest,
    }),
  };
  output.envelopeDigest = digest(output);
  validateProgramLineageEnvelope(output);
  return output;
}

function buildProgramLineageEnvelope(input, options = {}) {
  const predecessorEnvelope = buildPredecessorProgramLineageEnvelope(
    input,
    options,
  );
  if (!options.ownership) return predecessorEnvelope;

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
  let canonicalOwnershipPlan;
  try {
    canonicalOwnershipPlan = planControlPlaneOwnership(
      options.ownership.input,
      { trustedBindings },
    );
  } catch (error) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.crossProgramBound,
      `Control-plane ownership input is not bound to the predecessor program: ${error.message}`,
    );
  }
  if (
    canonicalOwnershipPlan.status !== "ready-for-human-review" ||
    (options.ownership.plan &&
      !same(options.ownership.plan, canonicalOwnershipPlan)) ||
    options.ownership.input.target.region !== input.baseline.target.region ||
    options.ownership.input.evidenceMode !== input.evidenceMode ||
    options.ownership.input.safety.executionEnabled !== false ||
    options.ownership.input.safety.executionEligible !== false ||
    options.ownership.input.safety.executionAllowed !== false
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.crossProgramBound,
      "Control-plane ownership must reproduce a ready, exact-target, execution-disabled plan bound to the predecessor envelope.",
    );
  }
  if (
    canonicalOwnershipPlan.planDigest !==
    controlPlaneOwnershipDigest(
      withoutField(canonicalOwnershipPlan, "planDigest"),
    )
  ) {
    fail(
      PROGRAM_LINEAGE_CHECK_IDS.digestsCurrent,
      "Control-plane ownership plan digest does not match canonical content.",
    );
  }

  const output = structuredClone(predecessorEnvelope);
  const ownershipStage = {
    id: "control-plane-ownership-planning",
    status: "ready-for-human-review",
    evidenceMode: input.evidenceMode,
    artifactDigest: canonicalOwnershipPlan.planDigest,
    predecessorDigest: output.stages.at(-1).stageDigest,
    executionEnabled: false,
    executionEligible: false,
    executionAllowed: false,
    requiredFutureAuthority:
      FUTURE_AUTHORITIES["control-plane-ownership-planning"],
  };
  ownershipStage.stageDigest = digest(ownershipStage);
  output.stages.push(ownershipStage);
  output.programIdentityDigest = digest({
    programId: output.programId,
    baselineBindingDigest: output.baseline.bindingDigest,
    lineageDigest: output.lineage.lineageDigest,
    finalStageDigest: ownershipStage.stageDigest,
  });
  output.envelopeDigest = digest(withoutField(output, "envelopeDigest"));
  validateProgramLineageEnvelope(output);
  return output;
}

function parseArguments(args) {
  if (args[0] !== "build") {
    throw new Error(
      "Usage: startup-program-lineage.mjs build --input <path> --trusted-planner-digests <path> [--trusted-previous-envelope <path>] [--output json]",
    );
  }
  let inputPath = null;
  let trustedPlannerDigestsPath = null;
  let trustedPreviousEnvelopePath = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--input") {
      inputPath = args[index + 1];
      index += 1;
    } else if (args[index] === "--output" && args[index + 1] === "json") {
      index += 1;
    } else if (args[index] === "--trusted-planner-digests") {
      trustedPlannerDigestsPath = args[index + 1];
      index += 1;
    } else if (args[index] === "--trusted-previous-envelope") {
      trustedPreviousEnvelopePath = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${args[index]}`);
    }
  }
  if (!inputPath) throw new Error("--input is required.");
  if (!trustedPlannerDigestsPath) {
    throw new Error("--trusted-planner-digests is required.");
  }
  return {
    inputPath,
    trustedPlannerDigestsPath,
    trustedPreviousEnvelopePath,
  };
}

function main() {
  try {
    const {
      inputPath,
      trustedPlannerDigestsPath,
      trustedPreviousEnvelopePath,
    } = parseArguments(process.argv.slice(2));
    const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    const trustedPlannerDigests = JSON.parse(
      readFileSync(resolve(trustedPlannerDigestsPath), "utf8"),
    );
    const trustedPreviousEnvelope = trustedPreviousEnvelopePath
      ? JSON.parse(readFileSync(resolve(trustedPreviousEnvelopePath), "utf8"))
      : null;
    const envelope = buildProgramLineageEnvelope(input, {
      trustedPlannerDigests,
      trustedPreviousEnvelope,
    });
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.checkId ? `${error.checkId}: ` : ""}${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  FINAL_PROGRAM_STAGE_ORDER,
  PROGRAM_LINEAGE_CHECK_IDS,
  PROGRAM_LINEAGE_CHECK_ORDER,
  PROGRAM_STAGE_ORDER,
  ProgramLineageError,
  buildPredecessorProgramLineageEnvelope,
  buildProgramLineageEnvelope,
  canonicalJson,
  digest as programLineageDigest,
  validateProgramLineageEnvelope,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
