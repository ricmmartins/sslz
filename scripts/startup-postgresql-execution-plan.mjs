#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalJson,
  postgresqlRehearsalDigest,
} from "./startup-postgresql-rehearsal-plan.mjs";
import { postgresqlMigrationDigest } from "./startup-postgresql-migration-plan.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PLANNER_VERSION = "1.0.0";

const POSTGRESQL_EXECUTION_CHECK_IDS = Object.freeze({
  artifactsBound: "execution.postgresql.artifacts-bound",
  lineageMonotonic: "execution.postgresql.lineage-monotonic",
  replayProtected: "execution.postgresql.replay-protected",
  evidenceCurrent: "execution.postgresql.evidence-current",
  targetBound: "execution.postgresql.target-bound",
  authoritiesBound: "execution.postgresql.authorities-bound",
  signaturesValid: "execution.postgresql.signatures-valid",
  approvalsComplete: "execution.postgresql.approvals-complete",
  approvalScopeExact: "execution.postgresql.approval-scope-exact",
  strategyBound: "execution.postgresql.strategy-bound",
  privilegesExact: "execution.postgresql.privileges-exact",
  stageOrderValid: "execution.postgresql.stage-order-valid",
  rollbackBoundariesComplete:
    "execution.postgresql.rollback-boundaries-complete",
  outputSanitized: "execution.postgresql.output-sanitized",
});
const POSTGRESQL_EXECUTION_CHECK_ORDER = Object.freeze(
  Object.values(POSTGRESQL_EXECUTION_CHECK_IDS),
);

const STAGE_CONTRACTS = Object.freeze([
  {
    stage: "rehearsal-execution",
    path: "forward",
    allowedOriginStates: ["rehearsal-reviewed"],
    triggerEvidenceRequired: false,
    capabilities: ["rehearsal-execute"],
    description:
      "Authorize one digest-bound rehearsal execution in the approved isolated environment.",
    predecessor: "rehearsal-reviewed",
    successor: "rehearsal-execution-evidenced",
    rollbackBoundary:
      "Stop before initial load; retain the source as the only authority and discard rehearsal-only target artifacts under separate cleanup authority.",
  },
  {
    stage: "initial-load",
    path: "forward",
    allowedOriginStates: ["rehearsal-execution-evidenced"],
    triggerEvidenceRequired: false,
    capabilities: ["initial-load-write"],
    description:
      "Authorize one strategy-bound initial load against the exact approved target.",
    predecessor: "rehearsal-execution-evidenced",
    successor: "initial-load-evidenced",
    rollbackBoundary:
      "Stop before catch-up or write freeze; preserve the source authority and require a separately approved target reset before retry.",
  },
  {
    stage: "cdc-catch-up",
    path: "forward",
    allowedOriginStates: ["initial-load-evidenced"],
    triggerEvidenceRequired: false,
    capabilities: ["cdc-catch-up"],
    description:
      "Authorize evidence-permitted logical replication catch-up only for the approved online strategy.",
    predecessor: "initial-load-evidenced",
    successor: "catch-up-evidenced",
    rollbackBoundary:
      "Stop replication before write freeze; keep the source authoritative and require a new nonce plus fresh lag evidence before retry.",
  },
  {
    stage: "write-freeze-connection-drain",
    path: "forward",
    allowedOriginStates: ["load-and-catch-up-evidenced"],
    triggerEvidenceRequired: false,
    capabilities: ["connection-drain", "write-freeze"],
    description:
      "Authorize the bounded application write freeze and connection drain for the approved maintenance window.",
    predecessor: "load-and-catch-up-evidenced",
    successor: "writes-frozen-and-drained",
    rollbackBoundary:
      "Resume source writes only under rollback authority before source-of-truth transfer; invalidate cutover-readiness evidence after any resume.",
  },
  {
    stage: "cutover-readiness",
    path: "forward",
    allowedOriginStates: ["writes-frozen-and-drained"],
    triggerEvidenceRequired: false,
    capabilities: ["cutover-readiness-declare"],
    description:
      "Authorize a readiness declaration after current validation, capacity, connectivity, DNS, application, and owner evidence pass.",
    predecessor: "writes-frozen-and-drained",
    successor: "cutover-ready",
    rollbackBoundary:
      "Do not transfer authority; a failed readiness check returns control to the write-freeze rollback boundary and requires fresh evidence.",
  },
  {
    stage: "source-of-truth-transfer",
    path: "forward",
    allowedOriginStates: ["cutover-ready"],
    triggerEvidenceRequired: false,
    capabilities: ["source-authority-transfer"],
    description:
      "Authorize one explicit source-of-truth transfer to the exact target after cutover readiness.",
    predecessor: "cutover-ready",
    successor: "target-authoritative",
    rollbackBoundary:
      "After transfer, only the separately approved rollback or failback path may restore source authority; dual writes remain prohibited.",
  },
  {
    stage: "rollback",
    path: "contingency",
    allowedOriginStates: [
      "writes-frozen-and-drained",
      "cutover-ready",
      "target-authoritative"
    ],
    triggerEvidenceRequired: true,
    capabilities: ["rollback-initiate"],
    description:
      "Authorize rollback within the exact retained-source and rollback-window boundary.",
    predecessor: "rollback-trigger-confirmed",
    successor: "source-authoritative",
    rollbackBoundary:
      "Rollback ends with the source authoritative and the target isolated; a new migration attempt requires advanced lineage and all-new approvals.",
  },
  {
    stage: "failback",
    path: "contingency",
    allowedOriginStates: ["target-authoritative"],
    triggerEvidenceRequired: true,
    capabilities: ["failback-initiate"],
    description:
      "Authorize failback only after target-authoritative operation and independently evidenced reverse recovery readiness.",
    predecessor: "failback-trigger-confirmed",
    successor: "source-authoritative",
    rollbackBoundary:
      "Failback ends with a single source authority; any later forward migration starts a new monotonic lineage attempt.",
  },
]);

const BASE_EVIDENCE_CAPABILITIES = Object.freeze({
  "source-catalog": [
    "source-assessment-current",
    "source-authority-confirmed",
  ],
  "target-region-capacity": [
    "target-capacity-confirmed",
    "target-region-confirmed",
  ],
  "secret-reference-metadata": [
    "secret-references-versioned",
    "secret-values-excluded",
  ],
  "private-connectivity": [
    "network-path-reviewed",
    "private-connectivity-confirmed",
  ],
  "dns-application-readiness": [
    "application-pool-drain-ready",
    "dns-change-ready",
  ],
  "recovery-maintenance-owners": [
    "maintenance-window-confirmed",
    "on-call-owner-confirmed",
    "rpo-rto-confirmed",
  ],
  "provider-iac-readiness": [
    "iac-artifacts-reviewed",
    "privilege-boundary-reviewed",
    "provider-readiness-confirmed",
  ],
});
const ONLINE_EVIDENCE_CAPABILITIES = Object.freeze({
  "logical-replication-readiness": [
    "cdc-permission-confirmed",
    "logical-replication-ready",
    "replica-identity-reviewed",
  ],
});

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const schemas = Object.freeze({
  sourceAssessment: load(
    "agent/schemas/postgresql-source-assessment.schema.json",
  ),
  migrationPlanInput: load(
    "agent/schemas/postgresql-migration-plan-input.schema.json",
  ),
  migrationPlan: load(
    "agent/schemas/postgresql-migration-plan.schema.json",
  ),
  rehearsalEvidence: load(
    "agent/schemas/postgresql-rehearsal-evidence.schema.json",
  ),
  rehearsalPlan: load(
    "agent/schemas/postgresql-rehearsal-plan.schema.json",
  ),
  request: load("agent/schemas/postgresql-execution-request.schema.json"),
  liveEvidence: load(
    "agent/schemas/postgresql-execution-evidence.schema.json",
  ),
  approvals: load(
    "agent/schemas/postgresql-execution-approval.schema.json",
  ),
  lineage: load("agent/schemas/postgresql-execution-lineage.schema.json"),
  trust: load("agent/schemas/postgresql-execution-trust.schema.json"),
  output: load("agent/schemas/postgresql-execution-plan.schema.json"),
});

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function withoutField(value, field) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function sorted(values) {
  return [...values].sort();
}

function parseRfc3339(value, label) {
  const match =
    typeof value === "string"
      ? value.match(
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/,
        )
      : null;
  if (!match) {
    throw new Error(
      `${label} must be an RFC 3339 date-time with Z or an explicit offset.`,
    );
  }
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const calendar = new Date(0);
  calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  calendar.setUTCHours(
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.slice(0, 3).padEnd(3, "0")),
  );
  const valid =
    Number(year) > 0 &&
    calendar.getUTCFullYear() === Number(year) &&
    calendar.getUTCMonth() === Number(month) - 1 &&
    calendar.getUTCDate() === Number(day) &&
    calendar.getUTCHours() === Number(hour) &&
    calendar.getUTCMinutes() === Number(minute) &&
    calendar.getUTCSeconds() === Number(second) &&
    Number.isFinite(Date.parse(value));
  if (!valid) {
    throw new Error(`${label} is not a valid RFC 3339 calendar date-time.`);
  }
  return Date.parse(value);
}

function normalizeEvaluationTime(value) {
  return new Date(parseRfc3339(value, "--as-of")).toISOString();
}

function current(observedAt, expiresAt, asOf, maxAgeHours, label) {
  const observed = parseRfc3339(observedAt, `${label}.observedAt`);
  const expires = parseRfc3339(expiresAt, `${label}.expiresAt`);
  const evaluated = parseRfc3339(asOf, "--as-of");
  return (
    observed <= evaluated &&
    expires > evaluated &&
    evaluated - observed <= maxAgeHours * 60 * 60 * 1000
  );
}

function assertNonSecretMetadata(value, path = "$") {
  const sensitiveKey =
    /(?:password|passphrase|(?:access|refresh|identity)?token|connection.?string|private.?key|client.?secret|access.?key)/i;
  const opaqueNamespace =
    "(?:approval|approvals|artifact|assessment|attestation|authority|boundary|capacity|certificate|column|database|dns|environment|evidence|execution|fixture|idempotency|identity|key|keyvaultref|lineage|mapping|migration|network|nonce|observability|owner|publication|quota|record|region|rehearsal|rollback|runbook|schema|slot|snapshot|source|table|target|trust|validation|window|workload)";
  const sensitiveValue = [
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /^(?!sha256:[0-9a-f]{64}$)[a-z][a-z0-9+.-]*:/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
    /\b(?:glpat|xox[baprs]|sk)-[A-Za-z0-9_-]{16,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?\b/i,
    /(?:^|[\s/])\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?(?::\d+)?(?:$|[\s/])/i,
    /\b[a-z0-9-]*(?:[.-][a-z0-9-]+)+:\d{2,5}\b/i,
    new RegExp(
      `^(?!${opaqueNamespace}\\.)[a-z][a-z0-9-]*(?:\\.[a-z0-9-]+)+(?:[/:][a-z0-9._/-]*)?$`,
      "i",
    ),
    new RegExp(
      `^(?!${opaqueNamespace}\\.)[a-z0-9._-]+(?:/[a-z0-9._-]+)+$`,
      "i",
    ),
  ];
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNonSecretMetadata(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      !/^\d{4}-\d{2}-\d{2}T/.test(value) &&
      sensitiveValue.some((pattern) => pattern.test(value))
    ) {
      throw new Error(
        `postgresql.execution.secret-material: ${path} contains secret or endpoint material; use an opaque reference.`,
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      throw new Error(
        `postgresql.execution.secret-material: ${path}.${key} is not an allowed metadata field.`,
      );
    }
    assertNonSecretMetadata(child, `${path}.${key}`);
  }
}

function signedPayload(document) {
  return withoutField(document, "signature");
}

function attestationClaimsPayload(attestation) {
  return withoutField(signedPayload(attestation), "claimsDigest");
}

function executionPrivilegeDigest(stage, capabilities) {
  return digest({ stage, capabilities: sorted(capabilities) });
}

function effectiveStageContract(contract, strategy) {
  if (
    contract.stage === "cdc-catch-up" &&
    strategy === "offline-dump-restore"
  ) {
    return {
      ...contract,
      predecessor: "initial-load-evidenced",
      successor: "initial-load-evidenced",
      allowedOriginStates: ["initial-load-evidenced"],
      disposition: "not-applicable",
    };
  }
  if (contract.stage === "write-freeze-connection-drain") {
    return {
      ...contract,
      predecessor:
        strategy === "online-logical-replication"
          ? "catch-up-evidenced"
          : "initial-load-evidenced",
      allowedOriginStates: [
        strategy === "online-logical-replication"
          ? "catch-up-evidenced"
          : "initial-load-evidenced",
      ],
      disposition: "planned",
    };
  }
  return { ...contract, disposition: "planned" };
}

function executionActionDigest(request, stage, artifactBindings) {
  const baseContract = STAGE_CONTRACTS.find((item) => item.stage === stage);
  if (!baseContract) {
    throw new Error(`Unknown PostgreSQL execution stage: ${stage}`);
  }
  const contract = effectiveStageContract(baseContract, request.strategy);
  const authority = request.stageAuthorities.find(
    (item) => item.stage === stage,
  );
  const actionArtifactBindings = {
    sourceAssessmentDigest: artifactBindings.sourceAssessmentDigest,
    migrationPlanInputDigest: artifactBindings.migrationPlanInputDigest,
    migrationPlanDigest: artifactBindings.migrationPlanDigest,
    rehearsalEvidenceDigest: artifactBindings.rehearsalEvidenceDigest,
    rehearsalPlanDigest: artifactBindings.rehearsalPlanDigest,
    currentLineageDigest: artifactBindings.currentLineageDigest,
    liveEvidenceDigest: artifactBindings.liveEvidenceDigest,
    evaluationTimeDigest: artifactBindings.evaluationTimeDigest,
  };
  return digest({
    executionId: request.executionId,
    attemptOrdinal: request.attemptOrdinal,
    requestedAt: request.requestedAt,
    requestDigest: digest(request),
    stage,
    path: contract.path,
    disposition: contract.disposition,
    stagePredecessor: contract.predecessor,
    stageSuccessor: contract.successor,
    stageDescription: contract.description,
    rollbackBoundary: contract.rollbackBoundary,
    allowedOriginStates: sorted(contract.allowedOriginStates),
    triggerEvidenceRequired: contract.triggerEvidenceRequired,
    environmentReference: request.environmentReference,
    sourceReference: request.sourceReference,
    targetReference: request.targetReference,
    strategy: request.strategy,
    idempotencyKey: request.idempotencyKey,
    predecessorState: request.predecessorState,
    successorState: request.successorState,
    authorityReference: authority?.authorityReference ?? null,
    requiredCapabilities: sorted(authority?.requiredCapabilities ?? []),
    artifactBindings: actionArtifactBindings,
  });
}

function keyMap(trust) {
  return new Map(trust.keys.map((key) => [key.keyId, key]));
}

function trustKeysIndependent(trust) {
  try {
    const fingerprints = trust.keys.map((key) => {
      const publicKey = createPublicKey({
        key: Buffer.from(key.publicKeySpkiBase64, "base64"),
        format: "der",
        type: "spki",
      });
      if (publicKey.asymmetricKeyType !== "ed25519") {
        return null;
      }
      return createHash("sha256")
        .update(publicKey.export({ format: "der", type: "spki" }))
        .digest("hex");
    });
    return (
      fingerprints.every((fingerprint) => fingerprint !== null) &&
      unique(fingerprints)
    );
  } catch {
    return false;
  }
}

function verifyDocument(document, key) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(key.publicKeySpkiBase64, "base64"),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ed25519") {
      return false;
    }
    return verifySignature(
      null,
      Buffer.from(canonicalJson(signedPayload(document))),
      publicKey,
      Buffer.from(document.signature, "base64"),
    );
  } catch {
    return false;
  }
}

function check(id, classification, freshness, summary, references = []) {
  return {
    id,
    classification:
      freshness === "stale" && classification === "pass"
        ? "unresolved"
        : classification,
    freshness,
    summary,
    references: sorted([...new Set(references)]),
  };
}

function selectedRegionalEvidence(migrationPlanInput, migrationPlan) {
  const matches =
    migrationPlanInput.target.regionalPlanningInput.evidence.filter(
      (candidate) =>
        candidate.region === migrationPlan.target.region &&
        digest(candidate) === migrationPlan.target.selectedEvidenceDigest,
    );
  return matches.length === 1 ? matches[0] : null;
}

function artifactEvaluation(documents, trust, trustedTrustManifestDigest) {
  const {
    sourceAssessment,
    migrationPlanInput,
    migrationPlan,
    rehearsalEvidence,
    rehearsalPlan,
    lineage,
  } = documents;
  const actual = {
    sourceAssessment: digest(sourceAssessment),
    migrationPlanInput: digest(migrationPlanInput),
    migrationPlan: digest(migrationPlan),
    rehearsalEvidence: digest(rehearsalEvidence),
    rehearsalPlan: digest(rehearsalPlan),
    currentLineage: digest(lineage),
  };
  const trustPinned = digest(trust) === trustedTrustManifestDigest;
  const migrationDigestValid =
    postgresqlMigrationDigest(withoutField(migrationPlan, "planDigest")) ===
    migrationPlan.planDigest;
  const rehearsalDigestValid =
    postgresqlRehearsalDigest(withoutField(rehearsalPlan, "planDigest")) ===
    rehearsalPlan.planDigest;
  const exactRelationships =
    same(sourceAssessment, migrationPlanInput.sourceAssessment) &&
    same(sourceAssessment, migrationPlan.sourceAssessment) &&
    migrationPlan.sourceAssessmentDigest === actual.sourceAssessment &&
    rehearsalPlan.sourceAssessmentDigest === actual.sourceAssessment &&
    rehearsalPlan.migrationPlanInputDigest === actual.migrationPlanInput &&
    rehearsalPlan.migrationPlanDigest === migrationPlan.planDigest &&
    rehearsalPlan.identityBindings.rehearsalEvidenceDigest ===
      actual.rehearsalEvidence &&
    rehearsalPlan.acceptedLineageDigest ===
      rehearsalEvidence.bindings.acceptedLineageDigest &&
    migrationPlan.status === "ready" &&
    rehearsalPlan.status === "ready-for-cutover-review" &&
    migrationPlan.safety.executionEnabled === false &&
    rehearsalPlan.safety.executionEnabled === false;
  return {
    actual,
    passed:
      trustPinned &&
      same(actual, trust.artifactDigests) &&
      migrationDigestValid &&
      rehearsalDigestValid &&
      exactRelationships,
  };
}

function lineageEvaluation(request, lineage) {
  const executions = lineage.acceptedExecutions;
  const ordinals = executions.map(({ attemptOrdinal }) => attemptOrdinal);
  const expectedOrdinals = executions.map((_, index) => index + 1);
  const executionIds = executions.map(({ executionId }) => executionId);
  const idempotencyKeys = executions.map(({ idempotencyKey }) => idempotencyKey);
  const historicalNonces = executions.flatMap(
    ({ consumedNonces }) => consumedNonces,
  );
  const allowedAttemptOutcomes = new Set([
    "execution-planned",
    "completed",
    "rolled-back",
    "rehearsal-reviewed",
  ]);
  const chainValid = executions.every(
    (item, index) =>
      item.predecessorState === "rehearsal-reviewed" &&
      allowedAttemptOutcomes.has(item.successorState) &&
      (index === 0
        ? item.predecessorState === "rehearsal-reviewed"
        : executions[index - 1].successorState === "rehearsal-reviewed"),
  );
  const currentStateValid =
    executions.length === 0
      ? lineage.currentState === "rehearsal-reviewed" &&
        lineage.currentOrdinal === 0
      : lineage.currentState === executions.at(-1).successorState &&
        lineage.currentOrdinal === executions.at(-1).attemptOrdinal;
  return (
    lineage.currentOrdinal === executions.length &&
    same(ordinals, expectedOrdinals) &&
    unique(executionIds) &&
    unique(idempotencyKeys) &&
    unique(historicalNonces) &&
    same(historicalNonces, lineage.consumedNonces) &&
    chainValid &&
    currentStateValid &&
    request.attemptOrdinal === lineage.currentOrdinal + 1 &&
    request.predecessorState === lineage.currentState &&
    request.environmentReference === lineage.environmentReference &&
    request.targetReference === lineage.targetReference &&
    !executionIds.includes(request.executionId) &&
    !idempotencyKeys.includes(request.idempotencyKey)
  );
}

function replayEvaluation(request, liveEvidence, approvals, lineage) {
  const nonces = [
    ...liveEvidence.attestations.map(({ nonce }) => nonce),
    ...approvals.approvals.map(({ nonce }) => nonce),
  ];
  return (
    unique(nonces) &&
    nonces.every((nonce) => !lineage.consumedNonces.includes(nonce)) &&
    !lineage.acceptedExecutions.some(
      ({ executionId, idempotencyKey }) =>
        executionId === request.executionId ||
        idempotencyKey === request.idempotencyKey,
    )
  );
}

function evidenceCapabilities(strategy) {
  return {
    ...BASE_EVIDENCE_CAPABILITIES,
    ...(strategy === "online-logical-replication"
      ? ONLINE_EVIDENCE_CAPABILITIES
      : {}),
  };
}

function liveEvidenceEvaluation(
  request,
  migrationPlan,
  rehearsalPlan,
  lineage,
  liveEvidence,
  trust,
  asOf,
) {
  const expected = evidenceCapabilities(request.strategy);
  const attestationsByKind = new Map(
    liveEvidence.attestations.map((item) => [item.kind, item]),
  );
  const kinds = liveEvidence.attestations.map(({ kind }) => kind);
  const expectedKinds = Object.keys(expected);
  const keys = keyMap(trust);
  const trustedDigests = new Map(
    trust.evidenceDigests.map(({ id, digest: value }) => [id, value]),
  );
  const maxAgeHours = 24;
  const exactSet =
    unique(kinds) && same(sorted(kinds), sorted(expectedKinds));
  const details = expectedKinds.map((kind) => {
    const attestation = attestationsByKind.get(kind);
    const key = attestation ? keys.get(attestation.signerKeyId) : null;
    const payloadDigest = attestation
      ? digest(signedPayload(attestation))
      : null;
    const claimsValid =
      Boolean(attestation) &&
      attestation.claimsDigest ===
        digest(attestationClaimsPayload(attestation));
    const bindingValid =
      Boolean(attestation) &&
      attestation.bindingDigest === digest(liveEvidence.bindings);
    const scopeValid =
      attestation &&
      same(sorted(attestation.capabilities), sorted(expected[kind])) &&
      key?.authorityReference === attestation.authorityReference &&
      same(key?.allowedEvidenceKinds ?? [], [kind]) &&
      (key?.allowedStages.length ?? 0) === 0;
    const fresh =
      attestation &&
      current(
        attestation.observedAt,
        attestation.expiresAt,
        asOf,
        maxAgeHours,
        `live evidence ${kind}`,
      );
    const signatureValid =
      attestation && key ? verifyDocument(attestation, key) : false;
    const independentlyTrusted =
      attestation &&
      trustedDigests.get(attestation.evidenceId) === payloadDigest;
    return {
      kind,
      claimsValid,
      bindingValid,
      scopeValid,
      fresh,
      signatureValid,
      independentlyTrusted,
      evidenceId: attestation?.evidenceId,
      authorityReference: attestation?.authorityReference,
    };
  });
  const bindings = liveEvidence.bindings;
  const targetBound =
    bindings.sourceAssessmentDigest === migrationPlan.sourceAssessmentDigest &&
    bindings.migrationPlanDigest === migrationPlan.planDigest &&
    bindings.rehearsalPlanDigest === rehearsalPlan.planDigest &&
    bindings.currentLineageDigest === digest(lineage) &&
    bindings.environmentReference === request.environmentReference &&
    bindings.sourceReference === request.sourceReference &&
    bindings.targetReference === request.targetReference &&
    bindings.targetRegion === migrationPlan.target.region &&
    same(bindings.targetEngine, migrationPlan.target.engine);
  return {
    exactSet,
    details,
    targetBound,
    signaturesValid: details.every(({ signatureValid }) => signatureValid),
    scopesValid: details.every(
      ({ claimsValid, bindingValid, scopeValid }) =>
        claimsValid && bindingValid && scopeValid,
    ),
    current: details.every(({ fresh }) => fresh),
    independentlyTrusted: details.every(
      ({ independentlyTrusted }) => independentlyTrusted,
    ),
  };
}

function approvalEvaluation(
  request,
  migrationPlan,
  rehearsalPlan,
  lineage,
  liveEvidence,
  approvals,
  trust,
  artifactBindings,
  asOf,
) {
  const approvalsByStage = new Map(
    approvals.approvals.map((approval) => [approval.stage, approval]),
  );
  const stages = approvals.approvals.map(({ stage }) => stage);
  const expectedStages = STAGE_CONTRACTS.map(({ stage }) => stage);
  const keys = keyMap(trust);
  const trustedDigests = new Map(
    trust.approvalDigests.map(({ id, digest: value }) => [id, value]),
  );
  const liveEvidenceDigest = digest(liveEvidence);
  const lineageDigest = digest(lineage);
  const authorities = new Map(
    request.stageAuthorities.map((item) => [item.stage, item]),
  );
  const newestEvidenceTime = Math.max(
    parseRfc3339(rehearsalPlan.evaluatedAt, "rehearsal plan.evaluatedAt"),
    parseRfc3339(lineage.observedAt, "execution lineage.observedAt"),
    ...liveEvidence.attestations.map(({ observedAt, kind }) =>
      parseRfc3339(observedAt, `live evidence ${kind}.observedAt`),
    ),
  );
  const details = STAGE_CONTRACTS.map((contract) => {
    const approval = approvalsByStage.get(contract.stage);
    const authority = authorities.get(contract.stage);
    const key = approval ? keys.get(approval.signerKeyId) : null;
    const expectedCapabilities =
      contract.stage === "cdc-catch-up" &&
      request.strategy === "offline-dump-restore"
        ? []
        : contract.capabilities;
    const expectedDecision =
      expectedCapabilities.length === 0 ? "not-applicable" : "approve";
    const expectedBindings = {
      sourceAssessmentDigest: migrationPlan.sourceAssessmentDigest,
      migrationPlanDigest: migrationPlan.planDigest,
      rehearsalPlanDigest: rehearsalPlan.planDigest,
      liveEvidenceDigest,
      currentLineageDigest: lineageDigest,
      requestDigest: digest(request),
      actionDigest: executionActionDigest(
        request,
        contract.stage,
        artifactBindings,
      ),
      privilegeDigest: executionPrivilegeDigest(
        contract.stage,
        expectedCapabilities,
      ),
    };
    const scopeValid =
      approval &&
      approval.decision === expectedDecision &&
      approval.authorityReference === authority?.authorityReference &&
      approval.environmentReference === request.environmentReference &&
      approval.targetReference === request.targetReference &&
      approval.strategy === request.strategy &&
      approval.predecessorState === request.predecessorState &&
      approval.successorState === request.successorState &&
      approval.idempotencyKey === request.idempotencyKey &&
      same(approval.bindings, expectedBindings);
    const privilegesExact =
      approval &&
      same(sorted(approval.grantedCapabilities), sorted(expectedCapabilities)) &&
      same(
        sorted(authority?.requiredCapabilities ?? []),
        sorted(expectedCapabilities),
      );
    const authorityValid =
      approval &&
      key?.authorityReference === approval.authorityReference &&
      same(key?.allowedStages ?? [], [contract.stage]) &&
      (key?.allowedEvidenceKinds.length ?? 0) === 0;
    const issuedAt = approval
      ? parseRfc3339(approval.issuedAt, `approval ${contract.stage}.issuedAt`)
      : Number.NaN;
    const fresh =
      approval &&
      issuedAt >= newestEvidenceTime &&
      issuedAt >= parseRfc3339(request.requestedAt, "request.requestedAt") &&
      current(
        approval.issuedAt,
        approval.expiresAt,
        asOf,
        24,
        `approval ${contract.stage}`,
      );
    const payloadDigest = approval ? digest(signedPayload(approval)) : null;
    return {
      stage: contract.stage,
      approvalId: approval?.approvalId,
      complete: Boolean(approval),
      scopeValid: Boolean(scopeValid),
      privilegesExact: Boolean(privilegesExact),
      authorityValid: Boolean(authorityValid),
      fresh: Boolean(fresh),
      signatureValid:
        approval && key ? verifyDocument(approval, key) : false,
      independentlyTrusted:
        approval &&
        trustedDigests.get(approval.approvalId) === payloadDigest,
    };
  });
  return {
    exactSet:
      unique(stages) && same(stages, expectedStages),
    details,
    complete: details.every(({ complete }) => complete),
    scopeValid: details.every(({ scopeValid }) => scopeValid),
    privilegesExact: details.every(
      ({ privilegesExact }) => privilegesExact,
    ),
    authoritiesValid: details.every(
      ({ authorityValid }) => authorityValid,
    ),
    current: details.every(({ fresh }) => fresh),
    signaturesValid: details.every(
      ({ signatureValid }) => signatureValid,
    ),
    independentlyTrusted: details.every(
      ({ independentlyTrusted }) => independentlyTrusted,
    ),
  };
}

function upstreamCurrent(documents, asOf) {
  const { sourceAssessment, migrationPlanInput, rehearsalEvidence, rehearsalPlan, lineage } =
    documents;
  const regionalEvidence = selectedRegionalEvidence(
    migrationPlanInput,
    documents.migrationPlan,
  );
  if (!regionalEvidence) {
    return false;
  }
  const assessmentAge = migrationPlanInput.maxAssessmentAgeHours;
  const regionalAge =
    migrationPlanInput.target.regionalPlanningInput.maxEvidenceAgeHours;
  const planningAt = parseRfc3339(
    migrationPlanInput.planningAt,
    "migration plan input.planningAt",
  );
  const regionalPlanningAt = parseRfc3339(
    migrationPlanInput.target.regionalPlanningInput.planningAt,
    "regional planning input.planningAt",
  );
  const rehearsalAt = parseRfc3339(
    rehearsalPlan.evaluatedAt,
    "rehearsal plan.evaluatedAt",
  );
  const requestAt = parseRfc3339(
    documents.request.requestedAt,
    "request.requestedAt",
  );
  const evaluated = parseRfc3339(asOf, "--as-of");
  return (
    regionalPlanningAt <= planningAt &&
    planningAt <= rehearsalAt &&
    rehearsalAt <= requestAt &&
    requestAt <= evaluated &&
    current(
      sourceAssessment.observedAt,
      sourceAssessment.expiresAt,
      asOf,
      assessmentAge,
      "source assessment",
    ) &&
    current(
      migrationPlanInput.target.migrationEvidence.observedAt,
      migrationPlanInput.target.migrationEvidence.expiresAt,
      asOf,
      assessmentAge,
      "target migration evidence",
    ) &&
    current(
      regionalEvidence.source.observedAt,
      regionalEvidence.source.expiresAt,
      asOf,
      regionalAge,
      "selected regional evidence",
    ) &&
    current(
      rehearsalEvidence.observedAt,
      rehearsalEvidence.expiresAt,
      asOf,
      Math.min(assessmentAge, regionalAge),
      "rehearsal evidence",
    ) &&
    current(
      lineage.observedAt,
      lineage.expiresAt,
      asOf,
      24,
      "execution lineage",
    )
  );
}

function requestAuthoritiesValid(request) {
  const stages = request.stageAuthorities.map(({ stage }) => stage);
  const authorities = request.stageAuthorities.map(
    ({ authorityReference }) => authorityReference,
  );
  return (
    same(stages, STAGE_CONTRACTS.map(({ stage }) => stage)) &&
    unique(authorities) &&
    request.stageAuthorities.every((authority) => {
      const contract = STAGE_CONTRACTS.find(
        ({ stage }) => stage === authority.stage,
      );
      const expected =
        authority.stage === "cdc-catch-up" &&
        request.strategy === "offline-dump-restore"
          ? []
          : contract.capabilities;
      return same(
        sorted(authority.requiredCapabilities),
        sorted(expected),
      );
    })
  );
}

function stageGraphValid(request, approvalEvaluationResult) {
  const contracts = STAGE_CONTRACTS.map((contract) =>
    effectiveStageContract(contract, request.strategy),
  );
  const forward = contracts.filter(({ path }) => path === "forward");
  const forwardChainValid = forward.every((contract, index) => {
    if (index === 0) {
      return contract.predecessor === "rehearsal-reviewed";
    }
    return forward[index - 1].successor === contract.predecessor;
  });
  const contingencyValid = contracts
    .filter(({ path }) => path === "contingency")
    .every(
      ({
        stage,
        successor,
        allowedOriginStates,
        triggerEvidenceRequired,
      }) => {
      if (stage === "rollback") {
        return (
          same(sorted(allowedOriginStates), [
            "cutover-ready",
            "target-authoritative",
            "writes-frozen-and-drained",
          ]) &&
          triggerEvidenceRequired &&
          successor === "source-authoritative"
        );
      }
      return (
        stage === "failback" &&
        same(allowedOriginStates, ["target-authoritative"]) &&
        triggerEvidenceRequired &&
        successor === "source-authoritative"
      );
      },
    );
  return (
    approvalEvaluationResult.exactSet &&
    forwardChainValid &&
    contingencyValid
  );
}

function strategyBound(documents, liveEvaluation) {
  const { request, migrationPlan, rehearsalPlan, approvals } = documents;
  return (
    request.strategy === migrationPlan.strategy.selected &&
    request.strategy === rehearsalPlan.target.strategy &&
    approvals.approvals.every(
      ({ strategy }) => strategy === request.strategy,
    ) &&
    (request.strategy === "offline-dump-restore"
      ? !liveEvaluation.details.some(
          ({ kind }) => kind === "logical-replication-readiness",
        )
      : liveEvaluation.details.some(
          ({ kind, claimsValid, scopeValid }) =>
            kind === "logical-replication-readiness" &&
            claimsValid &&
            scopeValid,
        ))
  );
}

function buildChecks(
  documents,
  artifact,
  lineagePassed,
  replayPassed,
  upstreamFresh,
  live,
  approvals,
  authoritiesPassed,
  strategyPassed,
  stageGraphPassed,
) {
  const allEvidenceCurrent =
    upstreamFresh && live.current && approvals.current;
  const allSignatures =
    live.signaturesValid &&
    live.independentlyTrusted &&
    approvals.signaturesValid &&
    approvals.independentlyTrusted;
  const independentKeys = trustKeysIndependent(documents.trust);
  return [
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.artifactsBound,
      artifact.passed ? "pass" : "fail",
      "not-applicable",
      artifact.passed
        ? "The exact source assessment, migration input and plan, rehearsal evidence and report, and current lineage match independently supplied protected digests."
        : "An upstream artifact is omitted, stale-bound, tampered, downgraded, or not equal to its protected digest.",
      [documents.migrationPlan.planId, documents.rehearsalPlan.rehearsalId],
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.lineageMonotonic,
      lineagePassed ? "pass" : "fail",
      "not-applicable",
      lineagePassed
        ? "The execution attempt advances the exact current lineage by one ordinal from the required predecessor."
        : "The lineage is stale, non-monotonic, mismatched, duplicated, or out of order.",
      [documents.lineage.lineageId],
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.replayProtected,
      replayPassed ? "pass" : "fail",
      "not-applicable",
      replayPassed
        ? "Execution, idempotency, approval, and evidence identities are unique and unconsumed."
        : "A nonce, execution identity, or idempotency identity is duplicated or already consumed.",
      [documents.request.executionId, documents.request.idempotencyKey],
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.evidenceCurrent,
      allEvidenceCurrent ? "pass" : "unresolved",
      allEvidenceCurrent ? "current" : "stale",
      allEvidenceCurrent
        ? "Every upstream artifact, live attestation, approval, and lineage snapshot is current at the explicit evaluation time."
        : "At least one required artifact, attestation, approval, or lineage snapshot is stale, future-dated, or expired.",
      [
        documents.liveEvidence.bundleId,
        documents.approvals.approvalSetId,
      ],
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.targetBound,
      live.targetBound ? "pass" : "fail",
      live.current ? "current" : "stale",
      live.targetBound
        ? "The exact environment, source, target, region, engine, capacity evidence, and lineage are bound."
        : "The environment, source, target, region, engine, evidence, or lineage binding does not match.",
      [documents.request.targetReference],
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.authoritiesBound,
      authoritiesPassed &&
      approvals.authoritiesValid &&
      independentKeys
        ? "pass"
        : "fail",
      "not-applicable",
      authoritiesPassed && approvals.authoritiesValid && independentKeys
        ? "Each stage has a distinct explicit authority and unique Ed25519 key whose trust entry is restricted to that stage."
        : "A stage authority is missing, substituted, duplicated, broader than its approved stage, or reuses signing key material from another authority.",
      documents.request.stageAuthorities.map(
        ({ authorityReference }) => authorityReference,
      ),
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.signaturesValid,
      allSignatures ? "pass" : "fail",
      allEvidenceCurrent ? "current" : "stale",
      allSignatures
        ? "Every live attestation and stage approval has a valid Ed25519 signature and independently supplied protected digest."
        : "A signature, signer restriction, or independent protected digest is missing or invalid.",
      documents.trust.keys.map(({ keyId }) => keyId),
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.approvalsComplete,
      approvals.complete && approvals.exactSet ? "pass" : "fail",
      approvals.current ? "current" : "stale",
      approvals.complete && approvals.exactSet
        ? "All eight stage approvals are present exactly once and in canonical order."
        : "A required stage approval is missing, duplicated, additional, or out of order.",
      documents.approvals.approvals.map(({ approvalId }) => approvalId),
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.approvalScopeExact,
      approvals.scopeValid ? "pass" : "fail",
      approvals.current ? "current" : "stale",
      approvals.scopeValid
        ? "Every approval binds the exact artifacts, evidence, lineage, action, environment, target, strategy, and idempotency identity."
        : "An approval is substituted or does not bind the exact execution scope.",
      documents.approvals.approvals.map(({ approvalId }) => approvalId),
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.strategyBound,
      strategyPassed ? "pass" : "fail",
      live.current ? "current" : "stale",
      strategyPassed
        ? requestStrategySummary(documents.request.strategy)
        : "The strategy is downgraded, mismatched, or lacks the required independently signed logical-replication evidence.",
      [documents.request.strategy],
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.privilegesExact,
      approvals.privilegesExact && live.scopesValid && live.exactSet
        ? "pass"
        : "fail",
      live.current && approvals.current ? "current" : "stale",
      approvals.privilegesExact && live.scopesValid && live.exactSet
        ? "Approval and evidence capabilities exactly equal the stage allowlists; no privilege widening is accepted."
        : "A capability is missing, substituted, duplicated, or broader than the exact allowlist.",
      documents.request.stageAuthorities.map(({ stage }) => stage),
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.stageOrderValid,
      stageGraphPassed ? "pass" : "fail",
      "not-applicable",
      stageGraphPassed
        ? "The strategy-specific forward path and alternative rollback/failback branches follow the canonical predecessor and successor graph."
        : "The stage sequence or strategy-specific state graph is partial, duplicated, discontinuous, or out of order.",
      STAGE_CONTRACTS.map(({ stage }) => stage),
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.rollbackBoundariesComplete,
      STAGE_CONTRACTS.every(({ rollbackBoundary }) => rollbackBoundary.length > 0)
        ? "pass"
        : "fail",
      "not-applicable",
      "Every planned stage has an explicit stop, rollback, or failback boundary without executable instructions.",
      ["boundary.rollback", "boundary.failback"],
    ),
    check(
      POSTGRESQL_EXECUTION_CHECK_IDS.outputSanitized,
      documents.liveEvidence.attestations.every(
        ({ evidenceReference }) => evidenceReference.length > 0,
      )
        ? "pass"
        : "fail",
      "not-applicable",
      "Only opaque references, digests, signatures, decisions, and sanitized descriptions are emitted.",
      [documents.liveEvidence.bundleId],
    ),
  ];
}

function requestStrategySummary(strategy) {
  return strategy === "online-logical-replication"
    ? "The evidence-permitted online logical-replication strategy exactly matches every bound artifact and approval."
    : "The offline dump/restore strategy exactly matches every bound artifact, with a separately signed not-applicable CDC decision.";
}

function buildActions(request, approvals, artifactBindings, eligible) {
  const approvalMap = new Map(
    approvals.approvals.map((approval) => [approval.stage, approval]),
  );
  return STAGE_CONTRACTS.map((contract, index) => {
    const effective = effectiveStageContract(contract, request.strategy);
    const approval = approvalMap.get(contract.stage);
    const notApplicable =
      contract.stage === "cdc-catch-up" &&
      request.strategy === "offline-dump-restore";
    return {
      ordinal: index + 1,
      stage: contract.stage,
      path: effective.path,
      authorityReference:
        approval?.authorityReference ?? "authority.missing",
      approvalId: approval?.approvalId ?? "approval.missing",
      disposition: eligible
        ? effective.path === "contingency"
          ? "contingency"
          : notApplicable
            ? "not-applicable"
            : "planned"
        : "blocked",
      description: contract.description,
      predecessor: effective.predecessor,
      successor: effective.successor,
      allowedOriginStates: [...effective.allowedOriginStates],
      triggerEvidenceRequired: effective.triggerEvidenceRequired,
      idempotencyIdentityDigest: digest({
        executionId: request.executionId,
        attemptOrdinal: request.attemptOrdinal,
        idempotencyKey: request.idempotencyKey,
        stage: contract.stage,
        actionDigest: executionActionDigest(
          request,
          contract.stage,
          artifactBindings,
        ),
      }),
      rollbackBoundary: contract.rollbackBoundary,
      executionEligible:
        eligible && effective.path === "forward" && !notApplicable,
      executionPerformed: false,
    };
  });
}

function validateInputs(documents) {
  for (const [name, schema] of [
    ["sourceAssessment", schemas.sourceAssessment],
    ["migrationPlanInput", schemas.migrationPlanInput],
    ["migrationPlan", schemas.migrationPlan],
    ["rehearsalEvidence", schemas.rehearsalEvidence],
    ["rehearsalPlan", schemas.rehearsalPlan],
    ["request", schemas.request],
    ["liveEvidence", schemas.liveEvidence],
    ["approvals", schemas.approvals],
    ["lineage", schemas.lineage],
    ["trust", schemas.trust],
  ]) {
    validateDocument(schema, documents[name]);
  }
}

function planPostgresqlExecution(
  documents,
  asOf,
  trustedTrustManifestDigest,
  trustedEvaluationTimeDigest,
) {
  const evaluatedAt = normalizeEvaluationTime(asOf);
  if (!/^sha256:[0-9a-f]{64}$/.test(trustedTrustManifestDigest ?? "")) {
    throw new Error(
      "--trusted-trust-manifest-digest must be an explicit SHA-256 digest supplied outside the artifact bundle.",
    );
  }
  const evaluationTimeDigest = digest({ evaluatedAt });
  if (trustedEvaluationTimeDigest !== evaluationTimeDigest) {
    throw new Error(
      "--trusted-evaluation-time-digest must match the independently protected digest of the normalized evaluation time.",
    );
  }
  assertNonSecretMetadata(documents);
  validateInputs(documents);
  const artifact = artifactEvaluation(
    documents,
    documents.trust,
    trustedTrustManifestDigest,
  );
  const artifactBindings = {
    sourceAssessmentDigest: artifact.actual.sourceAssessment,
    migrationPlanInputDigest: artifact.actual.migrationPlanInput,
    migrationPlanDigest: documents.migrationPlan.planDigest,
    rehearsalEvidenceDigest: artifact.actual.rehearsalEvidence,
    rehearsalPlanDigest: documents.rehearsalPlan.planDigest,
    currentLineageDigest: artifact.actual.currentLineage,
    liveEvidenceDigest: digest(documents.liveEvidence),
    approvalSetDigest: digest(documents.approvals),
    trustManifestDigest: digest(documents.trust),
    evaluationTimeDigest,
  };
  const lineagePassed = lineageEvaluation(
    documents.request,
    documents.lineage,
  );
  const replayPassed = replayEvaluation(
    documents.request,
    documents.liveEvidence,
    documents.approvals,
    documents.lineage,
  );
  const live = liveEvidenceEvaluation(
    documents.request,
    documents.migrationPlan,
    documents.rehearsalPlan,
    documents.lineage,
    documents.liveEvidence,
    documents.trust,
    evaluatedAt,
  );
  const approval = approvalEvaluation(
    documents.request,
    documents.migrationPlan,
    documents.rehearsalPlan,
    documents.lineage,
    documents.liveEvidence,
    documents.approvals,
    documents.trust,
    artifactBindings,
    evaluatedAt,
  );
  const upstreamFresh = upstreamCurrent(
    { ...documents, request: documents.request },
    evaluatedAt,
  );
  const authoritiesPassed = requestAuthoritiesValid(documents.request);
  const strategyPassed = strategyBound(documents, live);
  const stageGraphPassed = stageGraphValid(documents.request, approval);
  const checks = buildChecks(
    documents,
    artifact,
    lineagePassed,
    replayPassed,
    upstreamFresh,
    live,
    approval,
    authoritiesPassed,
    strategyPassed,
    stageGraphPassed,
  );
  const eligible = checks.every(
    ({ classification }) => classification === "pass",
  );
  const status = eligible
    ? "execution-contract-satisfied"
    : checks.some(({ classification }) => classification === "fail")
      ? "blocked"
      : "manual-review-required";
  const failed = checks
    .filter(({ classification }) => classification !== "pass")
    .map(({ summary }) => summary);
  const output = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    evaluatedAt,
    executionId: documents.request.executionId,
    attemptOrdinal: documents.request.attemptOrdinal,
    status,
    executionEligibility: {
      eligible,
      executionPerformed: false,
      reason: eligible
        ? "Every independently supplied live condition, protected digest, restricted signer, separate stage approval, nonce, lineage, target, and capability binding passed. This planner still cannot execute any operation."
        : "Execution eligibility is false because one or more fail-closed contract checks did not pass.",
    },
    strategy: documents.request.strategy,
    target: {
      environmentReference: documents.request.environmentReference,
      sourceReference: documents.request.sourceReference,
      targetReference: documents.request.targetReference,
      region: documents.migrationPlan.target.region,
      engine: structuredClone(documents.migrationPlan.target.engine),
    },
    artifactBindings,
    requiredChecks: [...POSTGRESQL_EXECUTION_CHECK_ORDER],
    checks,
    plannedActions: buildActions(
      documents.request,
      documents.approvals,
      artifactBindings,
      eligible,
    ),
    lineageTransition: {
      lineageDigest: artifact.actual.currentLineage,
      fromOrdinal: documents.lineage.currentOrdinal,
      toOrdinal: documents.request.attemptOrdinal,
      predecessorState: documents.request.predecessorState,
      successorState: documents.request.successorState,
      transitionApplied: false,
    },
    outstandingPrerequisites: sorted([
      ...new Set([
        ...failed,
        ...(eligible
          ? [
              "Rollback remains ineligible until current signed trigger evidence binds an allowed forward state, lineage, and rollback action.",
              "Failback remains ineligible until current signed trigger evidence binds target-authoritative state, lineage, and failback action.",
            ]
          : []),
      ]),
    ]),
    safety: {
      executionEnabled: false,
      sourceConnections: "none",
      targetConnections: "none",
      databaseOperations: "none",
      dumpRestoreOperations: "none",
      replicationOperations: "none",
      cloudOperations: "none",
      iacOperations: "none",
      networkOperations: "none",
      dnsOperations: "none",
      cutoverOperations: "none",
      rollbackOperations: "none",
      failbackOperations: "none",
      generatedCommands: "none",
      stateWrites: "none",
      generatedArtifacts: "stdout-only",
    },
    planDigest: "sha256:pending",
  };
  output.planDigest = digest(withoutField(output, "planDigest"));
  validateDocument(schemas.output, output);
  assertNonSecretMetadata(output);
  return output;
}

function parseArguments(args) {
  if (args[0] !== "plan") {
    throw new Error(
      "Usage: startup-postgresql-execution-plan.mjs plan --source-assessment <path> --migration-plan-input <path> --migration-plan <path> --rehearsal-evidence <path> --rehearsal-plan <path> --execution-request <path> --live-evidence <path> --approvals <path> --current-lineage <path> --trust-manifest <path> --trusted-trust-manifest-digest <sha256> --as-of <date-time> --trusted-evaluation-time-digest <sha256> [--output json]",
    );
  }
  const parsed = {
    sourceAssessment: null,
    migrationPlanInput: null,
    migrationPlan: null,
    rehearsalEvidence: null,
    rehearsalPlan: null,
    request: null,
    liveEvidence: null,
    approvals: null,
    lineage: null,
    trust: null,
    asOf: null,
    trustedTrustManifestDigest: null,
    trustedEvaluationTimeDigest: null,
  };
  const options = new Map([
    ["--source-assessment", "sourceAssessment"],
    ["--migration-plan-input", "migrationPlanInput"],
    ["--migration-plan", "migrationPlan"],
    ["--rehearsal-evidence", "rehearsalEvidence"],
    ["--rehearsal-plan", "rehearsalPlan"],
    ["--execution-request", "request"],
    ["--live-evidence", "liveEvidence"],
    ["--approvals", "approvals"],
    ["--current-lineage", "lineage"],
    ["--trust-manifest", "trust"],
    ["--as-of", "asOf"],
    [
      "--trusted-trust-manifest-digest",
      "trustedTrustManifestDigest",
    ],
    [
      "--trusted-evaluation-time-digest",
      "trustedEvaluationTimeDigest",
    ],
  ]);
  for (let index = 1; index < args.length; index += 1) {
    const property = options.get(args[index]);
    if (property) {
      parsed[property] = args[index + 1];
      index += 1;
    } else if (args[index] === "--output" && args[index + 1] === "json") {
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${args[index]}`);
    }
  }
  if (Object.values(parsed).some((value) => value === null)) {
    throw new Error(
      "All upstream artifacts, execution contracts, trust manifest, and evaluation time are required.",
    );
  }
  return parsed;
}

function readJson(path) {
  if (/^[\\/]{2}/.test(path)) {
    throw new Error("Input artifacts must use local regular-file paths.");
  }
  const localPath = resolve(path);
  const pathChain = [];
  for (let candidate = localPath; ; candidate = dirname(candidate)) {
    pathChain.unshift(candidate);
    if (dirname(candidate) === candidate) {
      break;
    }
  }
  let metadata;
  for (const candidate of pathChain) {
    metadata = lstatSync(candidate);
    if (metadata.isSymbolicLink()) {
      throw new Error("Input artifacts must be local regular files.");
    }
  }
  if (!metadata.isFile()) {
    throw new Error("Input artifacts must be local regular files.");
  }

  const descriptor = openSync(
    localPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino
    ) {
      throw new Error("Input artifact changed during validation.");
    }
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    const documents = Object.fromEntries(
      Object.entries(args)
        .filter(
          ([name]) =>
            ![
              "asOf",
              "trustedTrustManifestDigest",
              "trustedEvaluationTimeDigest",
            ].includes(name),
        )
        .map(([name, path]) => [name, readJson(path)]),
    );
    const plan = planPostgresqlExecution(
      documents,
      args.asOf,
      args.trustedTrustManifestDigest,
      args.trustedEvaluationTimeDigest,
    );
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode =
      plan.status === "execution-contract-satisfied" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  BASE_EVIDENCE_CAPABILITIES,
  ONLINE_EVIDENCE_CAPABILITIES,
  POSTGRESQL_EXECUTION_CHECK_IDS,
  POSTGRESQL_EXECUTION_CHECK_ORDER,
  STAGE_CONTRACTS,
  attestationClaimsPayload,
  digest as postgresqlExecutionDigest,
  executionActionDigest,
  executionPrivilegeDigest,
  planPostgresqlExecution,
  signedPayload,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
