#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BASE_EVIDENCE_CAPABILITIES,
  ONLINE_EVIDENCE_CAPABILITIES,
  POSTGRESQL_EXECUTION_CHECK_ORDER,
  STAGE_CONTRACTS,
  attestationClaimsPayload,
  executionActionDigest,
  executionPrivilegeDigest,
  planPostgresqlExecution,
  postgresqlExecutionDigest,
  signedPayload,
} from "../scripts/startup-postgresql-execution-plan.mjs";
import {
  planPostgresqlMigration,
  postgresqlMigrationDigest,
} from "../scripts/startup-postgresql-migration-plan.mjs";
import {
  planPostgresqlRehearsal,
  postgresqlRehearsalDigest,
} from "../scripts/startup-postgresql-rehearsal-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(".");
const script = resolve(
  root,
  "scripts/startup-postgresql-execution-plan.mjs",
);
const migrationInputTemplate = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-migration-plan-input.json"),
    "utf8",
  ),
);
const rehearsalEvidenceTemplate = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-rehearsal-evidence.json"),
    "utf8",
  ),
);
const rehearsalLineage = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-rehearsal-lineage.json"),
    "utf8",
  ),
);
const scenarios = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/fixtures/postgresql-execution-planner/scenarios.json",
    ),
    "utf8",
  ),
);
const outputSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/postgresql-execution-plan.schema.json"),
    "utf8",
  ),
);
const AS_OF = "2026-08-12T12:50:00Z";
const TRUSTED_EVALUATION_TIME_DIGEST = postgresqlExecutionDigest({
  evaluatedAt: new Date(AS_OF).toISOString(),
});

function setPath(value, path, replacement) {
  const parts = path.split(".");
  const property = parts.pop();
  const parent = parts.reduce(
    (current, part) =>
      Array.isArray(current) ? current[Number(part)] : current[part],
    value,
  );
  parent[property] = structuredClone(replacement);
}

function getPath(value, path) {
  return path.split(".").reduce(
    (current, part) =>
      Array.isArray(current) ? current[Number(part)] : current[part],
    value,
  );
}

function signingIdentity(keyId, authorityReference, stage, evidenceKind) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    trustKey: {
      keyId,
      algorithm: "Ed25519",
      publicKeySpkiBase64: publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      authorityReference,
      allowedStages: stage ? [stage] : [],
      allowedEvidenceKinds: evidenceKind ? [evidenceKind] : [],
    },
  };
}

function canonicalSign(document, identity) {
  document.signature = signPayload(
    null,
    Buffer.from(canonicalJsonForTest(signedPayload(document))),
    identity.privateKey,
  ).toString("base64");
}

function canonicalJsonForTest(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonForTest).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJsonForTest(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function upstream(strategy) {
  const migrationInput = structuredClone(migrationInputTemplate);
  if (strategy === "online-logical-replication") {
    migrationInput.sourceAssessment.provider = "google-cloud-sql";
    migrationInput.sourceAssessment.size.allocatedGiB = 600;
    migrationInput.sourceAssessment.size.usedGiB = 500;
    migrationInput.sourceAssessment.size.monthlyGrowthGiB = 50;
    migrationInput.sourceAssessment.governance.toleratedDowntimeMinutes = 15;
    migrationInput.sourceAssessment.identity.authenticationModes = [
      "cloud-iam",
    ];
    migrationInput.target.migrationEvidence.capacity.provisionedStorageGiB =
      1024;
  }
  const migrationPlan = planPostgresqlMigration(migrationInput);
  assert.equal(migrationPlan.strategy.selected, strategy);
  const rehearsalEvidence = structuredClone(rehearsalEvidenceTemplate);
  rehearsalEvidence.bindings = {
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
    strategy,
    scopeDigest: migrationPlan.identityBindings.scopeDigest,
    validationPlanDigest:
      migrationPlan.identityBindings.validationPlanDigest,
    rollbackPlanDigest: migrationPlan.identityBindings.rollbackPlanDigest,
    acceptedLineageDigest: postgresqlRehearsalDigest(rehearsalLineage),
  };
  if (strategy === "online-logical-replication") {
    rehearsalEvidence.initialLoad.method = "consistent-snapshot";
    rehearsalEvidence.catchUp = {
      mode: "logical-replication",
      explicitlyPermitted: true,
      completed: true,
      maxLagSeconds: 30,
      finalLagSeconds: 0,
      evidenceReferences: ["evidence.rehearsal.orders.catch-up"],
    };
  }
  const rehearsalPlan = planPostgresqlRehearsal(
    migrationInput.sourceAssessment,
    migrationInput,
    migrationPlan,
    rehearsalEvidence,
    rehearsalLineage,
    "2026-08-12T12:30:00Z",
    postgresqlMigrationDigest(migrationInput),
    migrationPlan.planDigest,
    postgresqlRehearsalDigest(rehearsalLineage),
  );
  assert.equal(rehearsalPlan.status, "ready-for-cutover-review");
  return {
    sourceAssessment: structuredClone(migrationInput.sourceAssessment),
    migrationPlanInput: migrationInput,
    migrationPlan,
    rehearsalEvidence,
    rehearsalPlan,
  };
}

function buildDocuments(
  strategy = "offline-dump-restore",
  priorAttemptCompleted = false,
) {
  const documents = upstream(strategy);
  const priorConsumedNonces = [
    ...Object.keys({
      ...BASE_EVIDENCE_CAPABILITIES,
      ...(strategy === "online-logical-replication"
        ? ONLINE_EVIDENCE_CAPABILITIES
        : {}),
    }).map(
      (kind) => `nonce.evidence.${kind}.attempt-1`,
    ),
    ...STAGE_CONTRACTS.map(
      ({ stage }) => `nonce.approval.${stage}.attempt-1`,
    ),
  ];
  const lineage = {
    schemaVersion: "1.0.0",
    lineageId: "lineage.execution.orders",
    observedAt: "2026-08-12T12:31:00Z",
    expiresAt: "2026-08-13T12:31:00Z",
    environmentReference: "environment.production.orders",
    targetReference: "target.postgresql.orders.flexible",
    currentOrdinal: priorAttemptCompleted ? 1 : 0,
    currentState: "rehearsal-reviewed",
    acceptedExecutions: priorAttemptCompleted
      ? [
          {
            executionId: "execution.orders.attempt-1",
            attemptOrdinal: 1,
            idempotencyKey: "idempotency.execution.orders.attempt-1",
            planDigest: `sha256:${"3".repeat(64)}`,
            predecessorState: "rehearsal-reviewed",
            successorState: "rehearsal-reviewed",
            consumedNonces: [...priorConsumedNonces],
          },
        ]
      : [],
    consumedNonces: priorAttemptCompleted ? [...priorConsumedNonces] : [],
  };
  const attemptOrdinal = lineage.currentOrdinal + 1;
  const request = {
    schemaVersion: "1.0.0",
    executionId: `execution.orders.attempt-${attemptOrdinal}`,
    attemptOrdinal,
    requestedAt: "2026-08-12T12:39:30Z",
    environmentReference: lineage.environmentReference,
    sourceReference: "source.postgresql.orders.primary",
    targetReference: lineage.targetReference,
    strategy,
    idempotencyKey: `idempotency.execution.orders.attempt-${attemptOrdinal}`,
    predecessorState: "rehearsal-reviewed",
    successorState: "execution-planned",
    stageAuthorities: STAGE_CONTRACTS.map((contract) => ({
      stage: contract.stage,
      authorityReference: `authority.stage.${contract.stage}`,
      requiredCapabilities:
        contract.stage === "cdc-catch-up" &&
        strategy === "offline-dump-restore"
          ? []
          : [...contract.capabilities],
    })),
  };
  const evidenceCapabilityMap = {
    ...BASE_EVIDENCE_CAPABILITIES,
    ...(strategy === "online-logical-replication"
      ? ONLINE_EVIDENCE_CAPABILITIES
      : {}),
  };
  const identities = [];
  const liveBindings = {
    sourceAssessmentDigest: documents.migrationPlan.sourceAssessmentDigest,
    migrationPlanDigest: documents.migrationPlan.planDigest,
    rehearsalPlanDigest: documents.rehearsalPlan.planDigest,
    currentLineageDigest: postgresqlExecutionDigest(lineage),
    environmentReference: request.environmentReference,
    sourceReference: request.sourceReference,
    targetReference: request.targetReference,
    targetRegion: documents.migrationPlan.target.region,
    targetEngine: structuredClone(documents.migrationPlan.target.engine),
  };
  const liveEvidence = {
    schemaVersion: "1.0.0",
    bundleId: `evidence.execution.orders.${strategy}.attempt-${attemptOrdinal}`,
    bindings: liveBindings,
    attestations: Object.entries(evidenceCapabilityMap).map(
      ([kind, capabilities], index) => {
        const authorityReference = `authority.evidence.${kind}`;
        const identity = signingIdentity(
          `key.evidence.${kind}`,
          authorityReference,
          null,
          kind,
        );
        identities.push(identity);
        const attestation = {
          evidenceId: `evidence.live.${kind}.attempt-${attemptOrdinal}`,
          kind,
          observedAt: `2026-08-12T12:${String(32 + index).padStart(2, "0")}:00Z`,
          expiresAt: `2026-08-13T12:${String(32 + index).padStart(2, "0")}:00Z`,
          nonce: `nonce.evidence.${kind}.attempt-${attemptOrdinal}`,
          authorityReference,
          signerKeyId: identity.trustKey.keyId,
          status: "confirmed",
          capabilities: [...capabilities],
          evidenceReference: `record.evidence.${kind}.attempt-${attemptOrdinal}`,
          bindingDigest: "sha256:pending",
          claimsDigest: "sha256:pending",
          signature: "pending",
        };
        attestation.bindingDigest = postgresqlExecutionDigest(
          liveBindings,
        );
        attestation.claimsDigest = postgresqlExecutionDigest(
          attestationClaimsPayload(attestation),
        );
        canonicalSign(attestation, identity);
        return attestation;
      },
    ),
  };
  const fixedArtifactBindings = {
    sourceAssessmentDigest: postgresqlExecutionDigest(
      documents.sourceAssessment,
    ),
    migrationPlanInputDigest: postgresqlExecutionDigest(
      documents.migrationPlanInput,
    ),
    migrationPlanDigest: documents.migrationPlan.planDigest,
    rehearsalEvidenceDigest: postgresqlExecutionDigest(
      documents.rehearsalEvidence,
    ),
    rehearsalPlanDigest: documents.rehearsalPlan.planDigest,
    currentLineageDigest: postgresqlExecutionDigest(lineage),
    liveEvidenceDigest: postgresqlExecutionDigest(liveEvidence),
    evaluationTimeDigest: TRUSTED_EVALUATION_TIME_DIGEST,
  };
  const approvals = {
    schemaVersion: "1.0.0",
    approvalSetId: `approvals.execution.orders.${strategy}.attempt-${attemptOrdinal}`,
    approvals: STAGE_CONTRACTS.map((contract, index) => {
      const authorityReference = `authority.stage.${contract.stage}`;
      const identity = signingIdentity(
        `key.stage.${contract.stage}`,
        authorityReference,
        contract.stage,
        null,
      );
      identities.push(identity);
      const capabilities =
        contract.stage === "cdc-catch-up" &&
        strategy === "offline-dump-restore"
          ? []
          : [...contract.capabilities];
      const approval = {
        approvalId: `approval.stage.${contract.stage}.attempt-${attemptOrdinal}`,
        stage: contract.stage,
        decision: capabilities.length === 0 ? "not-applicable" : "approve",
        issuedAt: `2026-08-12T12:${String(40 + index).padStart(2, "0")}:00Z`,
        expiresAt: `2026-08-13T12:${String(40 + index).padStart(2, "0")}:00Z`,
        nonce: `nonce.approval.${contract.stage}.attempt-${attemptOrdinal}`,
        authorityReference,
        signerKeyId: identity.trustKey.keyId,
        environmentReference: request.environmentReference,
        targetReference: request.targetReference,
        strategy,
        predecessorState: request.predecessorState,
        successorState: request.successorState,
        idempotencyKey: request.idempotencyKey,
        bindings: {
          sourceAssessmentDigest:
            documents.migrationPlan.sourceAssessmentDigest,
          migrationPlanDigest: documents.migrationPlan.planDigest,
          rehearsalPlanDigest: documents.rehearsalPlan.planDigest,
          liveEvidenceDigest: postgresqlExecutionDigest(liveEvidence),
          currentLineageDigest: postgresqlExecutionDigest(lineage),
          requestDigest: postgresqlExecutionDigest(request),
          actionDigest: executionActionDigest(
            request,
            contract.stage,
            fixedArtifactBindings,
          ),
          privilegeDigest: executionPrivilegeDigest(
            contract.stage,
            capabilities,
          ),
        },
        grantedCapabilities: capabilities,
        signature: "pending",
      };
      canonicalSign(approval, identity);
      return approval;
    }),
  };
  const trust = {
    schemaVersion: "1.0.0",
    manifestId: `trust.execution.orders.${strategy}`,
    artifactDigests: {
      sourceAssessment: postgresqlExecutionDigest(documents.sourceAssessment),
      migrationPlanInput: postgresqlExecutionDigest(
        documents.migrationPlanInput,
      ),
      migrationPlan: postgresqlExecutionDigest(documents.migrationPlan),
      rehearsalEvidence: postgresqlExecutionDigest(
        documents.rehearsalEvidence,
      ),
      rehearsalPlan: postgresqlExecutionDigest(documents.rehearsalPlan),
      currentLineage: postgresqlExecutionDigest(lineage),
    },
    evidenceDigests: liveEvidence.attestations.map((item) => ({
      id: item.evidenceId,
      digest: postgresqlExecutionDigest(signedPayload(item)),
    })),
    approvalDigests: approvals.approvals.map((item) => ({
      id: item.approvalId,
      digest: postgresqlExecutionDigest(signedPayload(item)),
    })),
    keys: identities.map(({ trustKey }) => trustKey),
  };
  return {
    ...documents,
    request,
    liveEvidence,
    approvals,
    lineage,
    trust,
  };
}

function checkById(plan, id) {
  return plan.checks.find((check) => check.id === id);
}

for (const strategy of [
  "offline-dump-restore",
  "online-logical-replication",
]) {
  const documents = buildDocuments(strategy);
  const trustedTrustManifestDigest = postgresqlExecutionDigest(
    documents.trust,
  );
  const first = planPostgresqlExecution(
    documents,
    AS_OF,
    trustedTrustManifestDigest,
    TRUSTED_EVALUATION_TIME_DIGEST,
  );
  const second = planPostgresqlExecution(
    structuredClone(documents),
    AS_OF,
    trustedTrustManifestDigest,
    TRUSTED_EVALUATION_TIME_DIGEST,
  );
  assert.deepEqual(second, first, `${strategy}: deterministic output`);
  validateDocument(outputSchema, first);
  assert.equal(first.status, "execution-contract-satisfied");
  assert.equal(first.executionEligibility.eligible, true);
  assert.equal(first.executionEligibility.executionPerformed, false);
  assert.deepEqual(first.requiredChecks, POSTGRESQL_EXECUTION_CHECK_ORDER);
  assert.deepEqual(
    first.checks.map(({ id }) => id),
    POSTGRESQL_EXECUTION_CHECK_ORDER,
  );
  assert(first.checks.every(({ classification }) => classification === "pass"));
  assert.deepEqual(
    first.plannedActions.map(({ stage }) => stage),
    STAGE_CONTRACTS.map(({ stage }) => stage),
  );
  assert(first.plannedActions.every(({ executionPerformed }) => !executionPerformed));
  const forward = first.plannedActions.filter(({ path }) => path === "forward");
  const contingencies = first.plannedActions.filter(
    ({ path }) => path === "contingency",
  );
  assert(
    forward.every(
      ({ disposition, executionEligible }) =>
        executionEligible === (disposition !== "not-applicable"),
    ),
  );
  assert(contingencies.every(({ executionEligible }) => !executionEligible));
  assert(contingencies.every(({ triggerEvidenceRequired }) => triggerEvidenceRequired));
  assert(
    forward.every(
      (action, index) =>
        index === 0 || forward[index - 1].successor === action.predecessor,
    ),
  );
  assert.deepEqual(
    contingencies.map(({ stage }) => stage),
    ["rollback", "failback"],
  );
  assert.equal(first.outstandingPrerequisites.length, 2);
  assert.equal(first.lineageTransition.transitionApplied, false);
  assert.equal(first.safety.executionEnabled, false);
  assert(Object.values(first.safety).every((value) => value === false || value === "none" || value === "stdout-only"));
  const cdc = first.plannedActions.find(({ stage }) => stage === "cdc-catch-up");
  assert.equal(
    cdc.disposition,
    strategy === "offline-dump-restore" ? "not-applicable" : "planned",
  );
  assert.equal(
    first.planDigest,
    postgresqlExecutionDigest(
      Object.fromEntries(
        Object.entries(first).filter(([key]) => key !== "planDigest"),
      ),
    ),
  );
}

const positive = buildDocuments();
const positiveTrustDigest = postgresqlExecutionDigest(positive.trust);
const ready = planPostgresqlExecution(
  positive,
  AS_OF,
  positiveTrustDigest,
  TRUSTED_EVALUATION_TIME_DIGEST,
);
assert.throws(
  () =>
    planPostgresqlExecution(
      positive,
      AS_OF,
      positiveTrustDigest,
      `sha256:${"0".repeat(64)}`,
    ),
  /trusted-evaluation-time-digest/,
);
const secondAttemptDocuments = buildDocuments(
  "offline-dump-restore",
  true,
);
const secondAttempt = planPostgresqlExecution(
  secondAttemptDocuments,
  AS_OF,
  postgresqlExecutionDigest(secondAttemptDocuments.trust),
  TRUSTED_EVALUATION_TIME_DIGEST,
);
assert.equal(secondAttempt.status, "execution-contract-satisfied");
assert.equal(secondAttempt.attemptOrdinal, 2);
assert.equal(secondAttempt.lineageTransition.fromOrdinal, 1);
assert.equal(secondAttempt.lineageTransition.toOrdinal, 2);
const missingBinding = structuredClone(ready);
delete missingBinding.artifactBindings.currentLineageDigest;
assert.throws(
  () => validateDocument(outputSchema, missingBinding),
  /missing required property currentLineageDigest/,
);
const substitutedCheck = structuredClone(ready);
[
  substitutedCheck.checks[0],
  substitutedCheck.checks[1],
] = [
  substitutedCheck.checks[1],
  substitutedCheck.checks[0],
];
assert.throws(
  () => validateDocument(outputSchema, substitutedCheck),
  /expected constant .*execution\.postgresql\.artifacts-bound/,
);
const incompleteCheck = structuredClone(ready);
delete incompleteCheck.checks[0].classification;
assert.throws(
  () => validateDocument(outputSchema, incompleteCheck),
  /missing required property classification/,
);
const incompleteAction = structuredClone(ready);
delete incompleteAction.plannedActions[0].authorityReference;
assert.throws(
  () => validateDocument(outputSchema, incompleteAction),
  /missing required property authorityReference/,
);
assert.throws(
  () =>
    validateDocument(
      {
        type: "object",
        properties: { forbidden: false },
      },
      { forbidden: true },
    ),
  /value is not allowed/,
);

for (const foreignKey of [
  { type: "rsa", options: { modulusLength: 2048 } },
  { type: "ec", options: { namedCurve: "prime256v1" } },
]) {
  const documents = buildDocuments();
  const { publicKey, privateKey } = generateKeyPairSync(
    foreignKey.type,
    foreignKey.options,
  );
  const approval = documents.approvals.approvals[0];
  const trustKey = documents.trust.keys.find(
    ({ keyId }) => keyId === approval.signerKeyId,
  );
  trustKey.publicKeySpkiBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  canonicalSign(approval, { privateKey });
  documents.trust.approvalDigests.find(
    ({ id }) => id === approval.approvalId,
  ).digest = postgresqlExecutionDigest(signedPayload(approval));
  const result = planPostgresqlExecution(
    documents,
    AS_OF,
    postgresqlExecutionDigest(documents.trust),
    TRUSTED_EVALUATION_TIME_DIGEST,
  );
  assert.equal(
    checkById(result, "execution.postgresql.signatures-valid").classification,
    "fail",
    `${foreignKey.type} SPKI labeled Ed25519 must be rejected`,
  );
}

for (const scenario of scenarios) {
  if (scenario.kind === "no-operation-source") {
    continue;
  }
  const documents =
    scenario.kind === "reordered-ledger"
      ? buildDocuments("offline-dump-restore", true)
      : buildDocuments();
  const trustedTrustManifestDigest = postgresqlExecutionDigest(
    documents.trust,
  );
  if (scenario.kind === "mutate") {
    setPath(
      documents[scenario.document],
      scenario.path,
      scenario.value,
    );
  } else if (scenario.kind === "omit-array-item") {
    getPath(documents[scenario.document], scenario.path).splice(
      scenario.index,
      1,
    );
  } else if (scenario.kind === "duplicate-array-item") {
    const array = getPath(documents[scenario.document], scenario.path);
    array[scenario.targetIndex] = structuredClone(array[scenario.sourceIndex]);
  } else if (scenario.kind === "swap-array-items") {
    const array = getPath(documents[scenario.document], scenario.path);
    [array[scenario.firstIndex], array[scenario.secondIndex]] = [
      array[scenario.secondIndex],
      array[scenario.firstIndex],
    ];
  } else if (scenario.kind === "accepted-execution-replay") {
    const consumedNonces = [
      ...documents.liveEvidence.attestations.map(({ nonce }) => nonce),
      ...documents.approvals.approvals.map(({ nonce }) => nonce),
    ];
    documents.lineage.currentOrdinal = 1;
    documents.lineage.currentState = "execution-planned";
    documents.lineage.consumedNonces = consumedNonces;
    documents.lineage.acceptedExecutions.push({
      executionId: documents.request.executionId,
      attemptOrdinal: 1,
      idempotencyKey: documents.request.idempotencyKey,
      planDigest: `sha256:${"1".repeat(64)}`,
      predecessorState: "rehearsal-reviewed",
      successorState: "execution-planned",
      consumedNonces,
    });
  } else if (scenario.kind === "lineage-rewind") {
    const consumedNonces = Array.from(
      { length: 15 },
      (_, index) => `nonce.previous.${index + 1}`,
    );
    documents.lineage.currentOrdinal = 1;
    documents.lineage.currentState = "rehearsal-reviewed";
    documents.lineage.consumedNonces = consumedNonces;
    documents.lineage.acceptedExecutions.push({
      executionId: "execution.orders.previous",
      attemptOrdinal: 1,
      idempotencyKey: "idempotency.execution.orders.previous",
      planDigest: `sha256:${"2".repeat(64)}`,
      predecessorState: "rehearsal-reviewed",
      successorState: "execution-planned",
      consumedNonces,
    });
  } else if (scenario.kind === "duplicate-key-material") {
    documents.trust.keys[1].publicKeySpkiBase64 =
      documents.trust.keys[0].publicKeySpkiBase64;
  } else if (scenario.kind === "reordered-ledger") {
    documents.lineage.consumedNonces.reverse();
  }
  if (scenario.expectedError) {
    assert.throws(
      () =>
        planPostgresqlExecution(
          documents,
          AS_OF,
          trustedTrustManifestDigest,
          TRUSTED_EVALUATION_TIME_DIGEST,
        ),
      new RegExp(scenario.expectedError.replaceAll(".", "\\.")),
      scenario.name,
    );
    continue;
  }
  const result = planPostgresqlExecution(
    documents,
    AS_OF,
    trustedTrustManifestDigest,
    TRUSTED_EVALUATION_TIME_DIGEST,
  );
  assert.equal(result.executionEligibility.eligible, false, scenario.name);
  assert.equal(result.status === "execution-contract-satisfied", false);
  assert(result.plannedActions.every(({ executionEligible }) => !executionEligible));
  for (const id of scenario.expectedChecks) {
    assert.notEqual(
      checkById(result, id).classification,
      "pass",
      `${scenario.name}: ${id} must not pass`,
    );
  }
}

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "sslz-postgresql-execution-plan-"),
);
const paths = {};
for (const [name, value] of Object.entries(positive)) {
  paths[name] = join(temporaryDirectory, `${name}.json`);
  writeFileSync(paths[name], `${JSON.stringify(value)}\n`);
}
const before = readdirSync(temporaryDirectory).sort();
const cliArguments = [
  script,
  "plan",
  "--source-assessment",
  paths.sourceAssessment,
  "--migration-plan-input",
  paths.migrationPlanInput,
  "--migration-plan",
  paths.migrationPlan,
  "--rehearsal-evidence",
  paths.rehearsalEvidence,
  "--rehearsal-plan",
  paths.rehearsalPlan,
  "--execution-request",
  paths.request,
  "--live-evidence",
  paths.liveEvidence,
  "--approvals",
  paths.approvals,
  "--current-lineage",
  paths.lineage,
  "--trust-manifest",
  paths.trust,
  "--as-of",
  AS_OF,
  "--trusted-trust-manifest-digest",
  positiveTrustDigest,
  "--trusted-evaluation-time-digest",
  TRUSTED_EVALUATION_TIME_DIGEST,
  "--output",
  "json",
];
const cli = spawnSync(
  process.execPath,
  cliArguments,
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);
assert.deepEqual(JSON.parse(cli.stdout), ready);

const uncArguments = [...cliArguments];
uncArguments[uncArguments.indexOf("--source-assessment") + 1] =
  "\\\\server\\share\\source.json";
const uncCli = spawnSync(
  process.execPath,
  uncArguments,
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(uncCli.status, 2);
assert.match(uncCli.stderr, /local regular-file paths/);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);

const actualDirectory = join(temporaryDirectory, "actual");
const linkedDirectory = join(temporaryDirectory, "linked");
mkdirSync(actualDirectory);
writeFileSync(
  join(actualDirectory, "sourceAssessment.json"),
  `${JSON.stringify(positive.sourceAssessment)}\n`,
);
symlinkSync(
  actualDirectory,
  linkedDirectory,
  process.platform === "win32" ? "junction" : "dir",
);
const linkedArguments = [...cliArguments];
linkedArguments[linkedArguments.indexOf("--source-assessment") + 1] = join(
  linkedDirectory,
  "sourceAssessment.json",
);
const linkedCli = spawnSync(
  process.execPath,
  linkedArguments,
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(linkedCli.status, 2);
assert.match(linkedCli.stderr, /local regular files/);

const source = readFileSync(script, "utf8");
assert(
  scenarios.some(({ kind }) => kind === "no-operation-source"),
  "No-operation source invariant must be fixture-driven.",
);
assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls|dgram)/);
assert.doesNotMatch(
  source,
  /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/,
);
assert.doesNotMatch(
  source,
  /\b(?:pg_dump|pg_restore|psql|az|terraform|gcloud|aws)\b/,
);
assert.doesNotMatch(
  JSON.stringify(ready),
  /(?:migration-user|BEGIN [A-Z ]+PRIVATE KEY|postgresql:\/\/|@[a-z0-9.-]+\.[a-z]{2,})/i,
);

console.log(
  `PostgreSQL execution contract tests passed for offline and online positive planning plus ${scenarios.length} fail-closed scenarios.`,
);
