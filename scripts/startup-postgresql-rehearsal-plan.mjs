#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  planPostgresqlMigration,
  postgresqlMigrationDigest,
} from "./startup-postgresql-migration-plan.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PLANNER_VERSION = "1.0.0";
const POSTGRESQL_REHEARSAL_CHECK_IDS = Object.freeze({
  contractsBound: "rehearsal.postgresql.contracts-bound",
  evidenceCurrent: "rehearsal.postgresql.evidence-current",
  replayProtected: "rehearsal.postgresql.replay-protected",
  targetBound: "rehearsal.postgresql.target-bound",
  modelPrechecksComplete:
    "rehearsal.postgresql.model-prechecks-complete",
  initialLoadEvidenced: "rehearsal.postgresql.initial-load-evidenced",
  catchUpPermitted: "rehearsal.postgresql.catch-up-permitted",
  schemaCompatible: "rehearsal.postgresql.schema-compatible",
  rowCountsWithinBound: "rehearsal.postgresql.row-counts-within-bound",
  dataVerificationComplete:
    "rehearsal.postgresql.data-verification-complete",
  cutoverReady: "rehearsal.postgresql.cutover-ready",
  rollbackReady: "rehearsal.postgresql.rollback-ready",
  sourceOfTruthSafe: "rehearsal.postgresql.source-of-truth-safe",
  outputSanitized: "rehearsal.postgresql.output-sanitized",
});
const POSTGRESQL_REHEARSAL_CHECK_ORDER = Object.freeze(
  Object.values(POSTGRESQL_REHEARSAL_CHECK_IDS),
);
const STAGE_ORDER = Object.freeze([
  "assess",
  "prepare",
  "rehearse",
  "initial-load",
  "catch-up",
  "validate",
  "cutover-ready",
  "cutover",
  "verify",
  "rollback-required",
  "completed",
]);

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const sourceAssessmentSchema = load(
  "agent/schemas/postgresql-source-assessment.schema.json",
);
const migrationPlanSchema = load(
  "agent/schemas/postgresql-migration-plan.schema.json",
);
const migrationPlanInputSchema = load(
  "agent/schemas/postgresql-migration-plan-input.schema.json",
);
const rehearsalEvidenceSchema = load(
  "agent/schemas/postgresql-rehearsal-evidence.schema.json",
);
const rehearsalLineageSchema = load(
  "agent/schemas/postgresql-rehearsal-lineage.schema.json",
);
const outputSchema = load(
  "agent/schemas/postgresql-rehearsal-plan.schema.json",
);

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

function assertNonSecretMetadata(value, path = "$") {
  const sensitiveKey =
    /(?:password|passphrase|(?:access|refresh|identity)?token|connection.?string|private.?key|client.?secret|access.?key)/i;
  const sensitiveValue = [
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /\b(?:postgres|postgresql):\/\/[^/\s:@]+:[^@\s/]+@/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/i,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
    /\b(?:glpat|xox[baprs]|sk)-[A-Za-z0-9_-]{16,}\b/i,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\b[a-z][a-z0-9+.-]*:\/\/\S+/i,
    /\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?\b/i,
    /\b[a-z0-9-]*(?:[.-][a-z0-9-]+)+:\d{2,5}\b/i,
    /(?:^|[\s/])\[[0-9a-f:]+\](?::\d+)?(?:$|[\s/])/i,
    /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|cloud|dev|internal|local)\b/i,
    /(?:^|[?&;\s])(?:sig|signature)=.[^&;\s]{9,}/i,
    /(?:^|[\s;])(?:host|server|user|username|password|pwd)\s*=/i,
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
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
        value,
      )
    ) {
      return;
    }
    if (
      typeof value === "string" &&
      sensitiveValue.some((pattern) => pattern.test(value))
    ) {
      throw new Error(
        `postgresql.rehearsal.secret-material: ${path} contains secret or endpoint material; use an opaque reference.`,
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      throw new Error(
        `postgresql.rehearsal.secret-material: ${path}.${key} is not an allowed metadata field.`,
      );
    }
    assertNonSecretMetadata(child, `${path}.${key}`);
  }
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
  const components = [year, month, day, hour, minute, second].map(Number);
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber, secondNumber] =
    components;
  const calendar = new Date(0);
  calendar.setUTCFullYear(yearNumber, monthNumber - 1, dayNumber);
  calendar.setUTCHours(
    hourNumber,
    minuteNumber,
    secondNumber,
    Number(fraction.slice(0, 3).padEnd(3, "0")),
  );
  const calendarValid =
    yearNumber > 0 &&
    calendar.getUTCFullYear() === yearNumber &&
    calendar.getUTCMonth() === monthNumber - 1 &&
    calendar.getUTCDate() === dayNumber &&
    calendar.getUTCHours() === hourNumber &&
    calendar.getUTCMinutes() === minuteNumber &&
    calendar.getUTCSeconds() === secondNumber;
  const parsed = Date.parse(value);
  if (!calendarValid || !Number.isFinite(parsed)) {
    throw new Error(`${label} is not a valid RFC 3339 calendar date-time.`);
  }
  return parsed;
}

function freshnessAt(
  observedAtValue,
  expiresAtValue,
  maxAgeHours,
  asOf,
  label,
) {
  const evaluatedAt = parseRfc3339(asOf, "--as-of");
  const observedAt = parseRfc3339(observedAtValue, `${label}.observedAt`);
  const expiresAt = parseRfc3339(expiresAtValue, `${label}.expiresAt`);
  if (
    !Number.isFinite(evaluatedAt) ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(expiresAt) ||
    observedAt > evaluatedAt ||
    expiresAt <= evaluatedAt ||
    evaluatedAt - observedAt > maxAgeHours * 60 * 60 * 1000
  ) {
    return "stale";
  }
  return "current";
}

function planningTimeFreshness(planningAtValue, asOf, label) {
  return parseRfc3339(planningAtValue, label) <=
    parseRfc3339(asOf, "--as-of")
    ? "current"
    : "stale";
}

function evidenceFreshness(
  sourceAssessment,
  migrationPlanInput,
  targetMigrationEvidence,
  selectedRegionalEvidence,
  evidence,
  lineage,
  asOf,
) {
  const assessmentMaxAgeHours = migrationPlanInput.maxAssessmentAgeHours;
  const regionalMaxAgeHours =
    migrationPlanInput.target.regionalPlanningInput.maxEvidenceAgeHours;
  const operationalMaxAgeHours = Math.min(
    assessmentMaxAgeHours,
    regionalMaxAgeHours,
  );
  const migrationPlanningAt = parseRfc3339(
    migrationPlanInput.planningAt,
    "migration plan input.planningAt",
  );
  const regionalPlanningAt = parseRfc3339(
    migrationPlanInput.target.regionalPlanningInput.planningAt,
    "regional planning input.planningAt",
  );
  const migrationPlanning = planningTimeFreshness(
    migrationPlanInput.planningAt,
    asOf,
    "migration plan input.planningAt",
  );
  const regionalPlanning =
    planningTimeFreshness(
      migrationPlanInput.target.regionalPlanningInput.planningAt,
      asOf,
      "regional planning input.planningAt",
    ) === "current" && regionalPlanningAt <= migrationPlanningAt
      ? "current"
      : "stale";
  const rehearsalObservedAt = parseRfc3339(
    evidence.observedAt,
    "rehearsal evidence.observedAt",
  );
  const rehearsalAfterPlans =
    rehearsalObservedAt >=
      parseRfc3339(
        migrationPlanInput.planningAt,
        "migration plan input.planningAt",
      ) &&
    rehearsalObservedAt >=
      parseRfc3339(
        migrationPlanInput.target.regionalPlanningInput.planningAt,
        "regional planning input.planningAt",
      ) &&
    rehearsalObservedAt >=
      parseRfc3339(lineage.observedAt, "accepted lineage.observedAt");
  const rehearsalFreshness = freshnessAt(
    evidence.observedAt,
    evidence.expiresAt,
    operationalMaxAgeHours,
    asOf,
    "rehearsal evidence",
  );
  const details = {
    migrationPlanning,
    regionalPlanning,
    rehearsal:
      rehearsalFreshness === "current" && rehearsalAfterPlans
        ? "current"
        : "stale",
    sourceAssessment: freshnessAt(
      sourceAssessment.observedAt,
      sourceAssessment.expiresAt,
      assessmentMaxAgeHours,
      asOf,
      "source assessment",
    ),
    targetMigrationEvidence: freshnessAt(
      targetMigrationEvidence.observedAt,
      targetMigrationEvidence.expiresAt,
      assessmentMaxAgeHours,
      asOf,
      "target migration evidence",
    ),
    selectedRegionalEvidence: freshnessAt(
      selectedRegionalEvidence.source.observedAt,
      selectedRegionalEvidence.source.expiresAt,
      regionalMaxAgeHours,
      asOf,
      "selected regional evidence",
    ),
    acceptedLineage: freshnessAt(
      lineage.observedAt,
      lineage.expiresAt,
      operationalMaxAgeHours,
      asOf,
      "accepted lineage",
    ),
  };
  return {
    status: Object.values(details).every((value) => value === "current")
      ? "current"
      : "stale",
    details,
  };
}

function normalizeEvaluationTime(value) {
  return new Date(parseRfc3339(value, "--as-of")).toISOString();
}

function validateUpstreamTimestamps(
  sourceAssessment,
  migrationPlanInput,
  evidence,
  lineage,
) {
  parseRfc3339(sourceAssessment.observedAt, "source assessment.observedAt");
  parseRfc3339(sourceAssessment.expiresAt, "source assessment.expiresAt");
  parseRfc3339(migrationPlanInput.planningAt, "migration plan input.planningAt");
  parseRfc3339(
    migrationPlanInput.target.regionalPlanningInput.planningAt,
    "regional planning input.planningAt",
  );
  for (const [index, candidate] of migrationPlanInput.target.regionalPlanningInput.evidence.entries()) {
    parseRfc3339(
      candidate.source.observedAt,
      `regional planning input.evidence[${index}].source.observedAt`,
    );
    parseRfc3339(
      candidate.source.expiresAt,
      `regional planning input.evidence[${index}].source.expiresAt`,
    );
  }
  parseRfc3339(
    migrationPlanInput.target.migrationEvidence.observedAt,
    "target migration evidence.observedAt",
  );
  parseRfc3339(
    migrationPlanInput.target.migrationEvidence.expiresAt,
    "target migration evidence.expiresAt",
  );
  parseRfc3339(evidence.observedAt, "rehearsal evidence.observedAt");
  parseRfc3339(evidence.expiresAt, "rehearsal evidence.expiresAt");
  parseRfc3339(lineage.observedAt, "accepted lineage.observedAt");
  parseRfc3339(lineage.expiresAt, "accepted lineage.expiresAt");
}

function check(id, classification, freshness, summary, evidenceReferences) {
  return {
    id,
    classification:
      freshness === "stale" && classification === "pass"
        ? "unresolved"
        : classification,
    freshness,
    summary:
      freshness === "stale"
        ? `${summary} Supporting evidence is stale, future-dated, or expired.`
        : summary,
    evidenceReferences: [...new Set(evidenceReferences)].sort(),
  };
}

function withoutDigest(document, field) {
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => key !== field),
  );
}

function migrationPlanDigestValid(migrationPlan) {
  return (
    postgresqlMigrationDigest(withoutDigest(migrationPlan, "planDigest")) ===
    migrationPlan.planDigest
  );
}

function sourceAssessmentDigestValid(sourceAssessment, migrationPlan) {
  return (
    digest(sourceAssessment) === migrationPlan.sourceAssessmentDigest &&
    canonicalJson(sourceAssessment) ===
      canonicalJson(migrationPlan.sourceAssessment)
  );
}

function migrationSafetyIsReadOnly(migrationPlan) {
  return (
    migrationPlan.safety.executionEnabled === false &&
    migrationPlan.safety.sourceConnections === "none" &&
    migrationPlan.safety.sourceWrites === "none" &&
    migrationPlan.safety.azureOperations === "none" &&
    migrationPlan.safety.azureWrites === "none" &&
    migrationPlan.safety.migrationToolActions === "none" &&
    migrationPlan.safety.dumpRestoreActions === "none" &&
    migrationPlan.safety.cdcActions === "none" &&
    migrationPlan.safety.dnsActions === "none"
  );
}

function migrationIdentityIsConsistent(migrationPlan) {
  const bindings = migrationPlan.identityBindings;
  const identity = Object.fromEntries(
    Object.entries(bindings).filter(
      ([key]) =>
        ![
          "migrationIdentityDigest",
          "readiness",
          "iac",
          "manifest",
          "approval",
        ].includes(key),
    ),
  );
  const artifactBinding = {
    migrationIdentityDigest: bindings.migrationIdentityDigest,
    sourceAssessmentDigest: bindings.sourceAssessmentDigest,
    targetPostgresqlDecisionDigest:
      bindings.targetPostgresqlDecisionDigest,
    targetPostgresqlSelectedEvidenceDigest:
      bindings.targetPostgresqlSelectedEvidenceDigest,
    targetMigrationEvidenceDigest: bindings.targetMigrationEvidenceDigest,
    strategy: bindings.strategy,
    scopeDigest: bindings.scopeDigest,
    ownerDigest: bindings.ownerDigest,
    recoveryObjectivesDigest: bindings.recoveryObjectivesDigest,
    validationPlanDigest: bindings.validationPlanDigest,
    rollbackPlanDigest: bindings.rollbackPlanDigest,
    requirementsDigest: bindings.requirementsDigest,
    decisionsDigest: bindings.decisionsDigest,
    migrationExecutionEligible: false,
  };
  return (
    postgresqlMigrationDigest(identity) === bindings.migrationIdentityDigest &&
    migrationPlan.target.region === bindings.targetRegion &&
    canonicalJson(migrationPlan.target.engine) ===
      canonicalJson(bindings.targetEngineVersion) &&
    migrationPlan.target.regionalPlanDecisionDigest ===
      bindings.targetPostgresqlDecisionDigest &&
    migrationPlan.target.selectedEvidenceDigest ===
      bindings.targetPostgresqlSelectedEvidenceDigest &&
    migrationPlan.target.migrationEvidenceDigest ===
      bindings.targetMigrationEvidenceDigest &&
    migrationPlan.strategy.selected === bindings.strategy &&
    ["readiness", "iac", "manifest", "approval"].every(
      (name) =>
        canonicalJson(bindings[name]) === canonicalJson(artifactBinding),
    )
  );
}

function exactBinding(sourceAssessment, migrationPlan, evidence, lineage) {
  const expected = evidence.bindings;
  const actual = migrationPlan.identityBindings;
  return (
    expected.sourceAssessmentDigest === digest(sourceAssessment) &&
    expected.migrationPlanDigest === migrationPlan.planDigest &&
    expected.migrationIdentityDigest === actual.migrationIdentityDigest &&
    expected.targetRegion === migrationPlan.target.region &&
    canonicalJson(expected.targetEngine) ===
      canonicalJson(migrationPlan.target.engine) &&
    expected.targetPostgresqlDecisionDigest ===
      actual.targetPostgresqlDecisionDigest &&
    expected.targetPostgresqlSelectedEvidenceDigest ===
      actual.targetPostgresqlSelectedEvidenceDigest &&
    expected.targetMigrationEvidenceDigest ===
      actual.targetMigrationEvidenceDigest &&
    expected.strategy === migrationPlan.strategy.selected &&
    expected.scopeDigest === actual.scopeDigest &&
    expected.validationPlanDigest === actual.validationPlanDigest &&
    expected.rollbackPlanDigest === actual.rollbackPlanDigest &&
    expected.acceptedLineageDigest === digest(lineage)
  );
}

function selectedRegionalEvidence(migrationPlanInput, canonicalMigrationPlan) {
  const matches =
    migrationPlanInput.target.regionalPlanningInput.evidence.filter(
      (candidate) =>
        candidate.region === canonicalMigrationPlan.target.region &&
        digest(candidate) === canonicalMigrationPlan.target.selectedEvidenceDigest,
    );
  if (matches.length !== 1) {
    throw new Error(
      "The selected regional evidence is missing, duplicated, or does not match its immutable digest.",
    );
  }
  return matches[0];
}

function prechecksComplete(evidence) {
  const prechecks = evidence.prechecks;
  return (
    prechecks.modelPrepared &&
    prechecks.schemaCompatibilityReviewed &&
    prechecks.requiredTransformationsReviewed &&
    prechecks.unsupportedObjectsResolved &&
    prechecks.evidenceReferences.length > 0
  );
}

function initialLoadEvidenced(migrationPlan, evidence) {
  const load = evidence.initialLoad;
  const expectedMethod =
    migrationPlan.strategy.selected === "online-logical-replication"
      ? "consistent-snapshot"
      : "offline-dump-restore";
  return (
    load.completed &&
    load.method === expectedMethod &&
    load.snapshotReference !== load.loadArtifactReference &&
    load.evidenceReferences.length > 0
  );
}

function catchUpPermitted(sourceAssessment, migrationPlan, evidence) {
  const catchUp = evidence.catchUp;
  const online =
    migrationPlan.strategy.selected === "online-logical-replication";
  if (!online) {
    return (
      catchUp.mode === "not-applicable" &&
      catchUp.explicitlyPermitted === false &&
      catchUp.completed === false &&
      catchUp.maxLagSeconds === null &&
      catchUp.finalLagSeconds === null
    );
  }
  const permittedLagSeconds =
    Math.min(
      migrationPlan.strategy.estimatedDataLossMinutes,
      sourceAssessment.governance.rpoMinutes,
    ) *
    60;
  return (
    catchUp.mode === "logical-replication" &&
    catchUp.explicitlyPermitted &&
    catchUp.completed &&
    catchUp.maxLagSeconds !== null &&
    catchUp.finalLagSeconds !== null &&
    catchUp.maxLagSeconds <= permittedLagSeconds &&
    catchUp.finalLagSeconds <= catchUp.maxLagSeconds &&
    catchUp.evidenceReferences.length > 0
  );
}

function expectedObjectCount(sourceAssessment) {
  const inventory = sourceAssessment.inventory;
  const constraints = inventory.constraints;
  return (
    sourceAssessment.databases.length +
    sourceAssessment.extensions.length +
    inventory.schemas.length +
    inventory.tables.length +
    inventory.partitions.reduce((total, item) => total + item.count, 0) +
    inventory.indexes.reduce((total, item) => total + item.count, 0) +
    Object.values(constraints).reduce((total, count) => total + count, 0) +
    inventory.sequences +
    inventory.functions.count +
    inventory.triggers +
    inventory.largeObjects.count +
    inventory.generatedColumns.length +
    sourceAssessment.security.roles.length +
    sourceAssessment.security.rowLevelSecurity.policyCount
  );
}

function rowCountEvaluation(sourceAssessment, evidence) {
  const assessedRows = new Map(
    sourceAssessment.inventory.tables.map(({ reference, rowCount }) => [
      reference,
      rowCount,
    ]),
  );
  const rows = evidence.validation.rowCounts.map((item) => {
    const difference = Math.abs(item.sourceRows - item.targetRows);
    const assessedSourceRows = assessedRows.get(item.tableReference);
    return {
      tableReference: item.tableReference,
      sourceRows: item.sourceRows,
      targetRows: item.targetRows,
      allowedDifferenceRows: 0,
      differenceRows: difference,
      withinBound:
        item.allowedDifferenceRows === 0 &&
        item.sourceRows === assessedSourceRows &&
        difference === 0,
    };
  });
  const expectedReferences = sourceAssessment.inventory.tables
    .map(({ reference }) => reference)
    .sort();
  const actualReferences = rows
    .map(({ tableReference }) => tableReference)
    .sort();
  return {
    tables: rows,
    passed:
      new Set(actualReferences).size === actualReferences.length &&
      canonicalJson(actualReferences) === canonicalJson(expectedReferences) &&
      rows.every(({ withinBound }) => withinBound),
  };
}

function dataVerificationComplete(sourceAssessment, evidence) {
  const verification = evidence.validation.dataVerification;
  const assessedRows = sourceAssessment.inventory.tables.reduce(
    (total, table) => total + table.rowCount,
    0,
  );
  if (!verification.passed || verification.evidenceReferences.length === 0) {
    return false;
  }
  if (["checksums", "chunked-checksums"].includes(verification.method)) {
    return (
      verification.coveragePercent === 100 &&
      verification.sampleRows === assessedRows &&
      verification.riskAcceptanceReference === null
    );
  }
  return (
    verification.method === "bounded-sampling" &&
    verification.coveragePercent > 0 &&
    verification.coveragePercent < 100 &&
    verification.sampleRows > 0 &&
    verification.sampleRows ===
      Math.ceil((assessedRows * verification.coveragePercent) / 100) &&
    verification.riskAcceptanceReference !== null
  );
}

function referencesFromPlan(migrationPlan, prefix) {
  return migrationPlan.migrationPlan.validation
    .filter((step) => step.startsWith(prefix) && step.endsWith("."))
    .map((step) => step.slice(prefix.length, -1))
    .sort();
}

function validationComplete(
  sourceAssessment,
  migrationPlan,
  evidence,
  rowCounts,
) {
  const expectedObjects = expectedObjectCount(sourceAssessment);
  const expectedQueries = referencesFromPlan(
    migrationPlan,
    "Run validation query ",
  );
  const expectedSmokeTests = referencesFromPlan(
    migrationPlan,
    "Run application smoke test ",
  );
  return (
    evidence.validation.schemaCompatibilityPassed &&
    evidence.validation.objectCounts.source === expectedObjects &&
    evidence.validation.objectCounts.target === expectedObjects &&
    rowCounts.passed &&
    dataVerificationComplete(sourceAssessment, evidence) &&
    evidence.validation.applicationSmokeTestsPassed &&
    canonicalJson([...evidence.validation.queryReferences].sort()) ===
      canonicalJson(expectedQueries) &&
    canonicalJson(
      [...evidence.validation.applicationSmokeTestReferences].sort(),
    ) === canonicalJson(expectedSmokeTests) &&
    evidence.validation.evidenceReferences.length > 0
  );
}

function cutoverReady(evidence) {
  const readiness = evidence.cutoverReadiness;
  return (
    readiness.writeFreezeRehearsed &&
    readiness.connectionDrainRehearsed &&
    readiness.dnsChangeReviewed &&
    readiness.applicationChangeReviewed &&
    readiness.validationOwnerConfirmed &&
    readiness.cutoverOwnerConfirmed &&
    readiness.evidenceReferences.length > 0
  );
}

function rollbackReady(evidence) {
  const readiness = evidence.rollbackReadiness;
  return (
    readiness.sourceRetained &&
    readiness.failbackRehearsed &&
    readiness.rollbackWindowConfirmed &&
    readiness.rollbackOwnerConfirmed &&
    readiness.evidenceReferences.length > 0
  );
}

function sourceOfTruthSafe(evidence) {
  return (
    evidence.sourceOfTruth.owner === "source" &&
    evidence.sourceOfTruth.dualWritesObserved === false &&
    evidence.sourceOfTruth.transferAuthorized === false &&
    evidence.sourceOfTruth.evidenceReferences.length > 0
  );
}

function replayProtected(evidence, lineage) {
  const acceptedIds = lineage.acceptedEvidenceSets
    .map(({ evidenceSetId }) => evidenceSetId)
    .sort();
  const suppliedPriorIds = [
    ...evidence.replayProtection.priorEvidenceSetIds,
  ].sort();
  return (
    new Set(acceptedIds).size === acceptedIds.length &&
    !acceptedIds.includes(evidence.evidenceSetId) &&
    canonicalJson(acceptedIds) === canonicalJson(suppliedPriorIds) &&
    evidence.replayProtection.attemptOrdinal ===
      acceptedIds.length + 1 &&
    evidence.bindings.acceptedLineageDigest === digest(lineage)
  );
}

function evaluate(
  sourceAssessment,
  migrationPlanInput,
  migrationPlan,
  evidence,
  lineage,
  asOf,
  trustedMigrationPlanInputDigest,
  trustedMigrationPlanDigest,
  trustedLineageDigest,
) {
  const recomputedMigrationPlan =
    planPostgresqlMigration(migrationPlanInput);
  const regionalEvidence = selectedRegionalEvidence(
    migrationPlanInput,
    recomputedMigrationPlan,
  );
  const freshness = evidenceFreshness(
    sourceAssessment,
    migrationPlanInput,
    migrationPlanInput.target.migrationEvidence,
    regionalEvidence,
    evidence,
    lineage,
    asOf,
  );
  const contractsBound =
    canonicalJson(sourceAssessment) ===
      canonicalJson(migrationPlanInput.sourceAssessment) &&
    digest(migrationPlanInput) === trustedMigrationPlanInputDigest &&
    canonicalJson(recomputedMigrationPlan) === canonicalJson(migrationPlan) &&
    migrationPlan.planDigest === trustedMigrationPlanDigest &&
    digest(lineage) === trustedLineageDigest &&
    sourceAssessmentDigestValid(sourceAssessment, migrationPlan) &&
    migrationPlanDigestValid(migrationPlan) &&
    migrationIdentityIsConsistent(migrationPlan) &&
    migrationPlan.schemaVersion === "1.0.0" &&
    migrationPlan.plannerVersion === "1.0.0" &&
    migrationPlan.status === "ready" &&
    migrationPlan.checks.every(
      ({ classification }) => classification === "pass",
    ) &&
    migrationSafetyIsReadOnly(migrationPlan);
  const targetBound = exactBinding(
    sourceAssessment,
    migrationPlan,
    evidence,
    lineage,
  ) &&
    evidence.maxEvidenceAgeHours ===
      Math.min(
        migrationPlanInput.maxAssessmentAgeHours,
        migrationPlanInput.target.regionalPlanningInput.maxEvidenceAgeHours,
      );
  const rows = rowCountEvaluation(sourceAssessment, evidence);
  const evidenceReference = evidence.evidenceReferences[0];
  const checks = [
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.contractsBound,
      contractsBound ? "pass" : "fail",
      "not-applicable",
      contractsBound
        ? "The exact versioned assessment and ready, execution-disabled migration plan are internally consistent."
        : "The assessment or migration plan is invalid, downgraded, tampered, blocked, or write-capable.",
      [migrationPlan.planId],
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.evidenceCurrent,
      freshness.status === "current" ? "pass" : "unresolved",
      freshness.status,
      freshness.status === "current"
        ? "The rehearsal, source, selected-region, target, and accepted-lineage evidence are current and expiry-bounded at the explicit evaluation time."
        : "The rehearsal, source, selected-region, target, or accepted-lineage evidence is not current at the explicit evaluation time.",
      [evidenceReference],
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.replayProtected,
      replayProtected(evidence, lineage) ? "pass" : "fail",
      "not-applicable",
      replayProtected(evidence, lineage)
        ? "The evidence-set identifier and ordinal are unique within the bound accepted-lineage manifest."
        : "The evidence set is replayed or disagrees with the bound accepted-lineage manifest.",
      [evidence.evidenceSetId],
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.targetBound,
      targetBound ? "pass" : "fail",
      freshness.status,
      targetBound
        ? "The rehearsal binds the exact approved Azure PostgreSQL target, region, engine, and immutable digests."
        : "The rehearsal target or digest bindings do not match the migration plan.",
      [migrationPlan.target.evidenceReference],
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.modelPrechecksComplete,
      prechecksComplete(evidence) ? "pass" : "fail",
      freshness.status,
      prechecksComplete(evidence)
        ? "Model preparation and compatibility prechecks are explicitly evidenced."
        : "Model preparation or compatibility prechecks are incomplete.",
      evidence.prechecks.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.initialLoadEvidenced,
      initialLoadEvidenced(migrationPlan, evidence) ? "pass" : "fail",
      freshness.status,
      initialLoadEvidenced(migrationPlan, evidence)
        ? "The initial load evidence matches the selected migration strategy."
        : "The initial load evidence is incomplete or does not match the selected strategy.",
      evidence.initialLoad.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.catchUpPermitted,
      catchUpPermitted(sourceAssessment, migrationPlan, evidence)
        ? "pass"
        : "fail",
      freshness.status,
      catchUpPermitted(sourceAssessment, migrationPlan, evidence)
        ? migrationPlan.strategy.selected === "online-logical-replication"
          ? "Logical-replication catch-up is explicitly permitted by the bound migration plan and evidence."
          : "Catch-up is explicitly not applicable to the offline-first strategy."
        : "Catch-up is inconsistent with the bound strategy or lacks explicit online permission.",
      evidence.catchUp.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.schemaCompatible,
      evidence.validation.schemaCompatibilityPassed ? "pass" : "fail",
      freshness.status,
      evidence.validation.schemaCompatibilityPassed
        ? "Schema compatibility validation passed."
        : "Schema compatibility validation did not pass.",
      evidence.validation.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.rowCountsWithinBound,
      rows.passed ? "pass" : "fail",
      freshness.status,
      rows.passed
        ? "Every assessed table has exact source/target row-count parity."
        : "At least one assessed table is missing, duplicated, non-identical, or requests an unbound tolerance.",
      evidence.validation.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.dataVerificationComplete,
      dataVerificationComplete(sourceAssessment, evidence) ? "pass" : "fail",
      freshness.status,
      dataVerificationComplete(sourceAssessment, evidence)
        ? "Checksums or an explicitly bounded and risk-accepted alternative passed."
        : "Data verification is incomplete, unbounded, or lacks required risk acceptance.",
      evidence.validation.dataVerification.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.cutoverReady,
      validationComplete(sourceAssessment, migrationPlan, evidence, rows) &&
      cutoverReady(evidence)
        ? "pass"
        : "fail",
      freshness.status,
      validationComplete(sourceAssessment, migrationPlan, evidence, rows) &&
      cutoverReady(evidence)
        ? "Validation and cutover-readiness evidence are complete."
        : "Validation or cutover-readiness evidence is incomplete.",
      evidence.cutoverReadiness.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.rollbackReady,
      rollbackReady(evidence) ? "pass" : "fail",
      freshness.status,
      rollbackReady(evidence)
        ? "Rollback ownership, source retention, window, and failback rehearsal are evidenced."
        : "Rollback readiness is incomplete.",
      evidence.rollbackReadiness.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.sourceOfTruthSafe,
      sourceOfTruthSafe(evidence) ? "pass" : "fail",
      freshness.status,
      sourceOfTruthSafe(evidence)
        ? "The source remains authoritative, dual writes are absent, and authority transfer is not pre-authorized."
        : "Source-of-truth ownership is unsafe or ambiguous.",
      evidence.sourceOfTruth.evidenceReferences,
    ),
    check(
      POSTGRESQL_REHEARSAL_CHECK_IDS.outputSanitized,
      evidence.redaction.sanitized ? "pass" : "fail",
      "not-applicable",
      evidence.redaction.sanitized
        ? "The evidence is explicitly attested as sanitized and passed structural secret screening."
        : "The evidence lacks a positive sanitization attestation.",
      [evidenceReference],
    ),
  ];
  return { checks, freshness, rows, contractsBound, targetBound };
}

function stages(status, strategy) {
  const ready = status === "ready-for-cutover-review";
  return STAGE_ORDER.map((state) => {
    let stageStatus;
    if (state === "catch-up" && strategy === "offline-dump-restore") {
      stageStatus = "not-applicable";
    } else if (
      ["assess", "prepare", "rehearse", "initial-load", "catch-up", "validate", "cutover-ready"].includes(
        state,
      )
    ) {
      stageStatus = ready ? "pass" : "blocked";
    } else if (state === "rollback-required") {
      stageStatus = "not-triggered";
    } else {
      stageStatus = ready ? "pending-human-confirmation" : "blocked";
    }
    return {
      state,
      status: stageStatus,
      gate:
        state === "cutover-ready"
          ? "All bound rehearsal checks must pass with current evidence; a human cutover decision remains separate."
          : `${state} requires exact digest bindings, prior-stage evidence, and explicit human/live confirmation.`,
      transitionApplied: false,
      executionAllowed: false,
    };
  });
}

function buildPlan(sourceAssessment, migrationPlan, evidence, evaluation) {
  const online =
    migrationPlan.strategy.selected === "online-logical-replication";
  return {
    modelPreparation: [
      "Review the exact source model, target model, unsupported-object list, and required transformations bound by digest.",
      "Record only opaque evidence references for schema, roles, ownership, RLS, extensions, collation, and generated-column checks.",
    ],
    initialLoad: [
      online
        ? "Review the consistent-snapshot boundary and initial-load evidence."
        : "Review the offline dump/restore artifact boundaries and initial-load evidence.",
      "Compare the exact source assessment, migration plan, snapshot, load artifact, and target bindings before accepting evidence.",
    ],
    catchUp: online
      ? [
          "Represent logical-replication catch-up only because the bound migration plan selected and permitted it.",
          "Require explicit maximum and final lag evidence within the digest-bound data-loss and RPO limits before cutover review.",
        ]
      : [
          "Keep CDC and logical replication not applicable for the offline-first strategy.",
        ],
    validation: [
      "Review schema compatibility and catalog object-count parity.",
      "Require exact per-table row-count parity; this contract accepts no evidence-defined tolerance.",
      "Require full or chunked checksums, or an explicitly bounded sampling alternative with recorded risk acceptance.",
      "Review bound application smoke-test and validation-query evidence.",
    ],
    cutoverReadiness: [
      "Require separate human confirmation of current target capacity, private connectivity, DNS, application change, write freeze, and connection draining.",
      "Do not authorize cutover, DNS changes, credential rotation, or source-of-truth transfer from this output.",
    ],
    rollbackReadiness: [
      "Keep the source retained and authoritative through the approved rollback window.",
      "Require separately approved failback authority and evidence before any rollback action.",
    ],
    sourceOfTruth: [
      "The source remains authoritative throughout rehearsal and cutover review.",
      "Never permit dual writes or infer target authority from a passing rehearsal.",
      "Authority transfer requires a separate live approval and is never applied by this planner.",
    ],
    unresolvedChecks: evaluation.checks
      .filter(({ classification }) => classification !== "pass")
      .map(({ id }) => id)
      .sort(),
  };
}

function identityBindings(
  sourceAssessment,
  migrationPlanInput,
  migrationPlan,
  evidence,
  lineage,
  asOf,
) {
  const evidenceDigest = digest(evidence);
  const canonicalMigrationPlan = planPostgresqlMigration(migrationPlanInput);
  const regionalEvidence = selectedRegionalEvidence(
    migrationPlanInput,
    canonicalMigrationPlan,
  );
  const identity = {
    evaluatedAt: asOf,
    sourceAssessmentDigest: digest(sourceAssessment),
    migrationPlanInputDigest: digest(migrationPlanInput),
    migrationPlanDigest: migrationPlan.planDigest,
    migrationIdentityDigest:
      migrationPlan.identityBindings.migrationIdentityDigest,
    rehearsalEvidenceDigest: evidenceDigest,
    targetRegion: migrationPlan.target.region,
    targetEngine: migrationPlan.target.engine,
    targetPostgresqlDecisionDigest:
      migrationPlan.identityBindings.targetPostgresqlDecisionDigest,
    targetPostgresqlSelectedEvidenceDigest:
      migrationPlan.identityBindings.targetPostgresqlSelectedEvidenceDigest,
    selectedRegionalEvidenceReference: regionalEvidence.source.reference,
    selectedRegionalEvidenceObservedAt: regionalEvidence.source.observedAt,
    selectedRegionalEvidenceExpiresAt: regionalEvidence.source.expiresAt,
    targetMigrationEvidenceDigest:
      migrationPlan.identityBindings.targetMigrationEvidenceDigest,
    targetMigrationEvidenceObservedAt:
      migrationPlanInput.target.migrationEvidence.observedAt,
    targetMigrationEvidenceExpiresAt:
      migrationPlanInput.target.migrationEvidence.expiresAt,
    acceptedLineageDigest: digest(lineage),
    strategy: migrationPlan.strategy.selected,
    validationPlanDigest:
      migrationPlan.identityBindings.validationPlanDigest,
    rollbackPlanDigest: migrationPlan.identityBindings.rollbackPlanDigest,
  };
  return {
    ...identity,
    rehearsalIdentityDigest: digest(identity),
  };
}

function planPostgresqlRehearsal(
  sourceAssessment,
  migrationPlanInput,
  migrationPlan,
  evidence,
  acceptedLineage,
  asOf,
  trustedMigrationPlanInputDigest,
  trustedMigrationPlanDigest,
  trustedLineageDigest,
) {
  const evaluatedAt = normalizeEvaluationTime(asOf);
  for (const [name, value] of [
    [
      "--trusted-migration-plan-input-digest",
      trustedMigrationPlanInputDigest,
    ],
    ["--trusted-migration-plan-digest", trustedMigrationPlanDigest],
    ["--trusted-lineage-digest", trustedLineageDigest],
  ]) {
    if (!/^sha256:[0-9a-f]{64}$/.test(value ?? "")) {
      throw new Error(`${name} must be an explicit SHA-256 digest.`);
    }
  }
  assertNonSecretMetadata({
    sourceAssessment,
    migrationPlanInput,
    migrationPlan,
    evidence,
    acceptedLineage,
  });
  validateDocument(sourceAssessmentSchema, sourceAssessment);
  validateDocument(migrationPlanInputSchema, migrationPlanInput);
  validateDocument(migrationPlanSchema, migrationPlan);
  validateDocument(rehearsalEvidenceSchema, evidence);
  validateDocument(rehearsalLineageSchema, acceptedLineage);
  validateUpstreamTimestamps(
    sourceAssessment,
    migrationPlanInput,
    evidence,
    acceptedLineage,
  );
  const evaluation = evaluate(
    sourceAssessment,
    migrationPlanInput,
    migrationPlan,
    evidence,
    acceptedLineage,
    evaluatedAt,
    trustedMigrationPlanInputDigest,
    trustedMigrationPlanDigest,
    trustedLineageDigest,
  );
  const allPassed = evaluation.checks.every(
    ({ classification }) => classification === "pass",
  );
  const status = allPassed
    ? "ready-for-cutover-review"
    : evaluation.checks.some(({ classification }) => classification === "fail")
      ? "blocked"
      : "manual-review-required";
  const bindings = identityBindings(
    sourceAssessment,
    migrationPlanInput,
    migrationPlan,
    evidence,
    acceptedLineage,
    evaluatedAt,
  );
  const output = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    evaluatedAt,
    rehearsalId: evidence.rehearsalId,
    evidenceSetId: evidence.evidenceSetId,
    acceptedLineageDigest: bindings.acceptedLineageDigest,
    status,
    sourceAssessmentDigest: bindings.sourceAssessmentDigest,
    migrationPlanInputDigest: bindings.migrationPlanInputDigest,
    migrationPlanDigest: bindings.migrationPlanDigest,
    target: {
      region: migrationPlan.target.region,
      engine: structuredClone(migrationPlan.target.engine),
      strategy: migrationPlan.strategy.selected,
      evidenceReference: migrationPlan.target.evidenceReference,
    },
    requiredChecks: [...POSTGRESQL_REHEARSAL_CHECK_ORDER],
    checks: evaluation.checks,
    transition: {
      from: evidence.transition.from,
      requested: evidence.transition.requested,
      disposition: allPassed ? "eligible-for-human-review" : "blocked",
      transitionApplied: false,
    },
    stages: stages(status, migrationPlan.strategy.selected),
    rehearsalPlan: buildPlan(
      sourceAssessment,
      migrationPlan,
      evidence,
      evaluation,
    ),
    validationSummary: {
      evidenceFreshness: structuredClone(evaluation.freshness.details),
      schemaCompatibilityPassed:
        evidence.validation.schemaCompatibilityPassed,
      objectCountsMatch:
        evidence.validation.objectCounts.source ===
          expectedObjectCount(sourceAssessment) &&
        evidence.validation.objectCounts.target ===
          expectedObjectCount(sourceAssessment),
      rowCountsPassed: evaluation.rows.passed,
      rowCounts: evaluation.rows.tables,
      dataVerificationMethod:
        evidence.validation.dataVerification.method,
      dataVerificationPassed: dataVerificationComplete(
        sourceAssessment,
        evidence,
      ),
      applicationSmokeTestsPassed:
        evidence.validation.applicationSmokeTestsPassed,
    },
    identityBindings: bindings,
    humanConfirmationRequired: [
      "Current source catalog and target capacity evidence from live owners",
      "Current private connectivity, DNS, and application connection readiness",
      "Write-freeze and connection-drain authority",
      "Cutover approval and source-of-truth transfer authority",
      "Rollback owner, retained source, rollback window, and failback authority",
    ],
    safety: {
      executionEnabled: false,
      sourceConnections: "none",
      targetConnections: "none",
      sourceWrites: "none",
      targetWrites: "none",
      cloudOperations: "none",
      cloudWrites: "none",
      migrationToolActions: "none",
      dumpRestoreActions: "none",
      cdcActions: "none",
      dnsActions: "none",
      generatedCommands: "none",
      transitionWrites: "none",
      generatedArtifacts: "stdout-only",
    },
    planDigest: "sha256:pending",
  };
  output.planDigest = digest(withoutDigest(output, "planDigest"));
  validateDocument(outputSchema, output);
  return output;
}

function parseArguments(args) {
  if (args[0] !== "plan") {
    throw new Error(
      "Usage: startup-postgresql-rehearsal-plan.mjs plan --source-assessment <path> --migration-plan-input <path> --migration-plan <path> --evidence <path> --accepted-lineage <path> --as-of <date-time> --trusted-migration-plan-input-digest <sha256> --trusted-migration-plan-digest <sha256> --trusted-lineage-digest <sha256> [--output json]",
    );
  }
  const parsed = {
    sourceAssessmentPath: null,
    migrationPlanInputPath: null,
    migrationPlanPath: null,
    evidencePath: null,
    acceptedLineagePath: null,
    asOf: null,
    trustedMigrationPlanInputDigest: null,
    trustedMigrationPlanDigest: null,
    trustedLineageDigest: null,
  };
  const options = new Map([
    ["--source-assessment", "sourceAssessmentPath"],
    ["--migration-plan-input", "migrationPlanInputPath"],
    ["--migration-plan", "migrationPlanPath"],
    ["--evidence", "evidencePath"],
    ["--accepted-lineage", "acceptedLineagePath"],
    ["--as-of", "asOf"],
    [
      "--trusted-migration-plan-input-digest",
      "trustedMigrationPlanInputDigest",
    ],
    ["--trusted-migration-plan-digest", "trustedMigrationPlanDigest"],
    ["--trusted-lineage-digest", "trustedLineageDigest"],
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
      "All source, migration-input, migration-plan, evidence, accepted-lineage, evaluation-time, and trusted-digest arguments are required.",
    );
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function main() {
  try {
    const paths = parseArguments(process.argv.slice(2));
    const plan = planPostgresqlRehearsal(
      readJson(paths.sourceAssessmentPath),
      readJson(paths.migrationPlanInputPath),
      readJson(paths.migrationPlanPath),
      readJson(paths.evidencePath),
      readJson(paths.acceptedLineagePath),
      paths.asOf,
      paths.trustedMigrationPlanInputDigest,
      paths.trustedMigrationPlanDigest,
      paths.trustedLineageDigest,
    );
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = plan.status === "ready-for-cutover-review" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  POSTGRESQL_REHEARSAL_CHECK_IDS,
  POSTGRESQL_REHEARSAL_CHECK_ORDER,
  STAGE_ORDER,
  canonicalJson,
  digest as postgresqlRehearsalDigest,
  planPostgresqlRehearsal,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
