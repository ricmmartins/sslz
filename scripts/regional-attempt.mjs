#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const SCHEMA_VERSION = "1.0.0";
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REGION = /^[a-z][a-z0-9]{1,31}$/;
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SENSITIVE_KEY = /(?:access.?token|refresh.?token|secret|password|credential|authorization|connection.?string|private.?key)/i;
const SENSITIVE_VALUE = /(?:bearer\s+[a-z0-9._~+/-]+=*|-----BEGIN [A-Z ]+PRIVATE KEY-----|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
const REGIONAL_ATTEMPT_CHECKS = Object.freeze({
  bindingCurrent: "regional.retry.binding-current",
  cleanupComplete: "regional.retry.cleanup-complete",
  providerParity: "regional.retry.provider-parity",
});

function regionalCheckError(message, checkId) {
  const error = new Error(message);
  error.code = checkId;
  error.checkId = checkId;
  return error;
}

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

function hashCanonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function assertDigest(value, label) {
  if (!DIGEST.test(value ?? "")) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
}

function normalizeRegion(value, label) {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, "");
  if (!REGION.test(normalized)) {
    throw new Error(`${label} must be a normalized Azure region name.`);
  }
  return normalized;
}

function assertIdentifier(value, label) {
  if (!IDENTIFIER.test(value ?? "")) {
    throw new Error(`${label} must be a lowercase kebab-case identifier.`);
  }
}

function attemptIdentity({
  chainId,
  originalRegion,
  targetRegion,
  attemptNumber,
  provider,
  environment,
  backendKeyPrefix,
  planId,
  planDigest = null,
}) {
  assertIdentifier(chainId, "chainId");
  assertIdentifier(planId, "planId");
  assertIdentifier(backendKeyPrefix, "backendKeyPrefix");
  if (!["bicep", "terraform"].includes(provider)) {
    throw new Error("provider must be bicep or terraform.");
  }
  if (!["prod", "nonprod"].includes(environment)) {
    throw new Error("environment must be prod or nonprod.");
  }
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > 99) {
    throw new Error("attemptNumber must be an integer from 1 through 99.");
  }
  assertDigest(planDigest, "planDigest");
  const identityDigest = hashCanonical({
    chainId,
    originalRegion,
    targetRegion,
    attemptNumber,
    environment,
  });
  const shortDigest = identityDigest.slice("sha256:".length, "sha256:".length + 10);
  const attemptKey = `a${String(attemptNumber).padStart(2, "0")}-${targetRegion}-${shortDigest}`;
  const resourceSuffix = attemptNumber === 1 ? "" : `-${attemptKey}`;
  const policyPrefix = attemptNumber === 1 ? "" : `${attemptKey}-`;
  return {
    identityDigest,
    attemptKey,
    resourceSuffix,
    deploymentName:
      attemptNumber === 1
        ? `sslz-${environment}-${planDigest.slice(7, 19)}`
        : `sslz-${environment}-${attemptKey}`,
    previewDeploymentName:
      attemptNumber === 1
        ? `sslz-preview-${environment}-${targetRegion}`
        : `sslz-preview-${environment}-${attemptKey}`,
    nestedDeploymentNames: {
      logAnalytics:
        attemptNumber === 1
          ? `deploy-log-analytics-${environment}`
          : `deploy-log-analytics-${environment}-${attemptKey}`,
      networking:
        attemptNumber === 1
          ? `deploy-networking-${environment}`
          : `deploy-networking-${environment}-${attemptKey}`,
      defender:
        attemptNumber === 1
          ? `deploy-defender-${environment}`
          : `deploy-defender-${environment}-${attemptKey}`,
      budgets:
        attemptNumber === 1
          ? `deploy-budgets-${environment}`
          : `deploy-budgets-${environment}-${attemptKey}`,
      policies:
        attemptNumber === 1
          ? `deploy-policies-${environment}`
          : `deploy-policies-${environment}-${attemptKey}`,
    },
    policyAssignmentNames: {
      mcsb: `${policyPrefix}mcsb-audit`,
      allowedLocations: `${policyPrefix}allowed-locations`,
      allowedLocationsResourceGroups: `${policyPrefix}allowed-locations-rg`,
      requireEnvironmentTag: `${policyPrefix}require-env-tag-rg`,
      requireTeamTag: `${policyPrefix}require-team-tag-rg`,
      inheritEnvironmentTag: `${policyPrefix}inherit-env-tag`,
      inheritTeamTag: `${policyPrefix}inherit-team-tag`,
      activityLogDiagnostics: `${policyPrefix}activity-log-diag`,
    },
    policyIdentityLifecycle: {
      type: "SystemAssigned",
      locationBound: true,
      mode: "cleanup-and-recreate",
      reuseAcrossChangedRegion: false,
    },
    stateKey: `${backendKeyPrefix}-${environment}-primary.tfstate`,
    workspaceName: `${chainId}-${environment}-${attemptKey}`,
    artifactRoot:
      `.sslz/generated/${planId}/${attemptKey}-` +
      `${planDigest.slice("sha256:".length, "sha256:".length + 10)}/${provider}`,
  };
}

function attemptPayload(record) {
  const { recordDigest: omitted, ...payload } = record;
  return payload;
}

function withRecordDigest(record) {
  return { ...record, recordDigest: hashCanonical(attemptPayload(record)) };
}

function event(status, occurredAt, evidenceDigest = null) {
  return { sequence: 0, status, occurredAt, evidenceDigest };
}

function appendEvent(record, nextEvent) {
  return [
    ...record.events,
    { ...nextEvent, sequence: record.events.length + 1 },
  ];
}

function createRegionalAttempt({
  chainId,
  planId,
  originalRegion,
  targetRegion,
  alternateRegion = null,
  attemptNumber = 1,
  provider,
  environment,
  backendKeyPrefix,
  regionalEvidenceDigest,
  planDigest,
  artifactDigest,
  manifestDigest,
  approvalDigest,
  createdAt,
  previousAttemptDigest = null,
}) {
  const normalizedOriginal = normalizeRegion(originalRegion, "originalRegion");
  const normalizedTarget = normalizeRegion(targetRegion, "targetRegion");
  const normalizedAlternate =
    alternateRegion === null
      ? null
      : normalizeRegion(alternateRegion, "alternateRegion");
  for (const [label, digest] of Object.entries({
    regionalEvidenceDigest,
    planDigest,
    artifactDigest,
    manifestDigest,
    approvalDigest,
  })) {
    assertDigest(digest, label);
  }
  if (previousAttemptDigest !== null) {
    assertDigest(previousAttemptDigest, "previousAttemptDigest");
  }
  const identities = attemptIdentity({
    chainId,
    originalRegion: normalizedOriginal,
    targetRegion: normalizedTarget,
    attemptNumber,
    provider,
    environment,
    backendKeyPrefix,
    planId,
    planDigest,
  });
  const initialEvent = event(attemptNumber === 1 ? "planned" : "replanned", createdAt);
  initialEvent.sequence = 1;
  return withRecordDigest({
    schemaVersion: SCHEMA_VERSION,
    chainId,
    planId,
    backendKeyPrefix,
    attemptId: `${chainId}-${identities.attemptKey}`,
    attemptNumber,
    previousAttemptDigest,
    originalRegion: normalizedOriginal,
    targetRegion: normalizedTarget,
    alternateRegion: normalizedAlternate,
    provider,
    environment,
    status: initialEvent.status,
    bindings: {
      regionalEvidenceDigest,
      planDigest,
      artifactDigest,
      manifestDigest,
      approvalDigest,
    },
    identities,
    writeStarted: false,
    cleanup: {
      required: false,
      status: "not-required",
      evidenceDigest: null,
      completedAt: null,
      summary: null,
    },
    failureEvidence: [],
    events: [initialEvent],
    createdAt,
    updatedAt: createdAt,
  });
}

function assertCurrentRecord(record) {
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("Unsupported regional attempt schema version.");
  }
  if (hashCanonical(attemptPayload(record)) !== record.recordDigest) {
    throw new Error("Regional attempt record digest mismatch.");
  }
  const expectedIdentities = attemptIdentity({
    chainId: record.chainId,
    planId: record.planId,
    originalRegion: record.originalRegion,
    targetRegion: record.targetRegion,
    attemptNumber: record.attemptNumber,
    provider: record.provider,
    environment: record.environment,
    backendKeyPrefix: record.backendKeyPrefix,
    planDigest: record.bindings.planDigest,
  });
  if (
    record.attemptId !== `${record.chainId}-${expectedIdentities.attemptKey}` ||
    canonicalJson(record.identities) !== canonicalJson(expectedIdentities)
  ) {
    throw new Error("Regional attempt identity mismatch.");
  }
  if (
    record.events.length < 1 ||
    record.events.at(-1).status !== record.status ||
    record.events.some((item, index) => item.sequence !== index + 1) ||
    record.failureEvidence.some((item, index) => {
      const { evidenceDigest, ...payload } = item;
      return (
        item.sequence !== index + 1 ||
        hashCanonical(payload) !== evidenceDigest
      );
    })
  ) {
    throw new Error("Regional attempt event or failure evidence mismatch.");
  }
  if (
    (record.cleanup.required &&
      !["cleanup-required", "cleaned"].includes(record.status)) ||
    (!record.cleanup.required &&
      !["not-required"].includes(record.cleanup.status)) ||
    (record.cleanup.status === "succeeded" && record.status !== "cleaned") ||
    (record.cleanup.status === "failed" && record.status !== "cleanup-required")
  ) {
    throw new Error("Regional attempt cleanup state mismatch.");
  }
}

function assertRegionalAttemptRecord(record) {
  assertCurrentRecord(record);
  return record;
}

function recordAttemptStarted(record, occurredAt) {
  assertCurrentRecord(record);
  if (!["planned", "replanned"].includes(record.status)) {
    throw new Error("Only a planned or replanned attempt can start.");
  }
  return withRecordDigest({
    ...record,
    status: "started",
    writeStarted: true,
    events: appendEvent(record, event("started", occurredAt)),
    updatedAt: occurredAt,
  });
}

function sanitizeDiagnostics(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeDiagnostics);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeDiagnostics(item),
      ]),
    );
  }
  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) {
    return "[REDACTED]";
  }
  return value;
}

function recordAttemptFailure(
  record,
  { code, summary, diagnostics, occurredAt, cleanupRequired = record.writeStarted },
) {
  assertCurrentRecord(record);
  if (!["started", "planned", "replanned"].includes(record.status)) {
    throw new Error("Failure evidence can only be appended to an active attempt.");
  }

  const sanitized = sanitizeDiagnostics(diagnostics ?? {});
  const failure = {
    sequence: record.failureEvidence.length + 1,
    code,
    summary: String(summary).slice(0, 300),
    occurredAt,
    diagnosticDigest: hashCanonical(sanitized),
    sanitized: true,
    sensitiveValuesRetained: false,
  };
  failure.evidenceDigest = hashCanonical(failure);
  const status = cleanupRequired ? "cleanup-required" : "failed";
  return withRecordDigest({
    ...record,
    status,
    cleanup: {
      required: cleanupRequired,
      status: cleanupRequired ? "pending" : "not-required",
      evidenceDigest: null,
      completedAt: null,
      summary: null,
    },
    failureEvidence: [...record.failureEvidence, failure],
    events: appendEvent(record, event(status, occurredAt, failure.evidenceDigest)),
    updatedAt: occurredAt,
  });
}

function recordAttemptSuccess(record, occurredAt) {
  assertCurrentRecord(record);
  if (record.status !== "started") {
    throw new Error("Only a started regional attempt can succeed.");
  }
  return withRecordDigest({
    ...record,
    status: "succeeded",
    events: appendEvent(record, event("succeeded", occurredAt)),
    updatedAt: occurredAt,
  });
}

function recordCleanupOutcome(
  record,
  { succeeded, evidenceDigest, occurredAt, summary },
) {
  assertCurrentRecord(record);
  if (record.status !== "cleanup-required" || !record.cleanup.required) {
    throw new Error("Cleanup can only be recorded for a cleanup-required attempt.");
  }
  assertDigest(evidenceDigest, "cleanup evidenceDigest");
  const cleanupStatus = succeeded ? "succeeded" : "failed";
  const status = succeeded ? "cleaned" : "cleanup-required";
  return withRecordDigest({
    ...record,
    status,
    cleanup: {
      required: true,
      status: cleanupStatus,
      evidenceDigest,
      completedAt: occurredAt,
      summary: String(sanitizeDiagnostics(String(summary))).slice(0, 300),
    },
    events: appendEvent(record, event(status, occurredAt, evidenceDigest)),
    updatedAt: occurredAt,
  });
}

function assertFreshRegionalBindings(
  previousBindings,
  freshBindings,
  changedRegion,
) {
  for (const [label, digest] of Object.entries(freshBindings)) {
    assertDigest(digest, label);
    if (changedRegion && digest === previousBindings[label]) {
      throw regionalCheckError(
        `Changed-region retry cannot reuse the prior ${label}.`,
        REGIONAL_ATTEMPT_CHECKS.bindingCurrent,
      );
    }
  }
}

function replanRegionalAttempt(previous, input) {
  assertCurrentRecord(previous);
  const targetRegion = normalizeRegion(input.targetRegion, "targetRegion");
  const changedRegion = targetRegion !== previous.targetRegion;
  if (previous.cleanup.required && previous.cleanup.status !== "succeeded") {
    throw regionalCheckError(
      "Cleanup failure or pending cleanup blocks regional replan.",
      REGIONAL_ATTEMPT_CHECKS.cleanupComplete,
    );
  }
  if (!["failed", "cleaned"].includes(previous.status)) {
    throw new Error("A concurrent, successful, or active regional attempt blocks replan.");
  }
  if (
    input.backendKeyPrefix !== previous.backendKeyPrefix ||
    input.planId !== previous.planId ||
    input.environment !== previous.environment
  ) {
    throw new Error("A regional retry cannot change its plan, environment, or state chain.");
  }
  if (changedRegion && previous.status !== "cleaned" && previous.writeStarted) {
    throw new Error("A changed target region requires successful cleanup of the started attempt.");
  }
  if (
    !changedRegion &&
    previous.writeStarted &&
    previous.status !== "cleaned" &&
    input.safeSameRegionRetry !== true
  ) {
    throw new Error("A started same-region retry requires cleanup or explicit safe retry evidence.");
  }
  const freshBindings = {
    regionalEvidenceDigest: input.regionalEvidenceDigest,
    planDigest: input.planDigest,
    artifactDigest: input.artifactDigest,
    manifestDigest: input.manifestDigest,
    approvalDigest: input.approvalDigest,
  };
  assertFreshRegionalBindings(previous.bindings, freshBindings, changedRegion);
  return createRegionalAttempt({
    ...input,
    chainId: previous.chainId,
    originalRegion: previous.originalRegion,
    attemptNumber: previous.attemptNumber + 1,
    backendKeyPrefix: previous.backendKeyPrefix,
    previousAttemptDigest: previous.recordDigest,
  });
}

function assertAttemptExecutable(record, expected) {
  assertCurrentRecord(record);
  if (!["planned", "replanned"].includes(record.status)) {
    throw new Error("The regional attempt is not executable.");
  }
  for (const [key, value] of Object.entries(expected)) {
    const actual = record.bindings[key] ?? record[key] ?? record.identities[key];
    if (actual !== value) {
      throw new Error(`Regional attempt ${key} binding mismatch.`);
    }
  }
}

function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporaryPath, path);
}

function regionalStatePaths(record, stateDirectory) {
  const directory = resolve(stateDirectory);
  const chainKey = hashCanonical(record.chainId).slice("sha256:".length);
  const attemptKey = hashCanonical(record.attemptId).slice("sha256:".length);
  return {
    directory,
    completedPath: resolve(directory, `${attemptKey}.json`),
    lockPath: resolve(directory, `chain-${chainKey}.lock`),
  };
}

function persistedPredecessorMatches(
  record,
  previousAttemptKey,
  previousTargetRegion,
  stateDirectory,
) {
  if (record.attemptNumber === 1) {
    return previousAttemptKey === null;
  }
  try {
    assertIdentifier(previousAttemptKey, "previousAttemptKey");
    const previousAttemptId = `${record.chainId}-${previousAttemptKey}`;
    const previousPath = resolve(
      stateDirectory,
      `${hashCanonical(previousAttemptId).slice("sha256:".length)}.json`,
    );
    if (!existsSync(previousPath) || !statSync(previousPath).isFile()) {
      return false;
    }
    const previous = JSON.parse(readFileSync(previousPath, "utf8"));
    assertCurrentRecord(previous);
    return (
      previous.attemptId === previousAttemptId &&
      previous.recordDigest === record.previousAttemptDigest &&
      previous.attemptNumber === record.attemptNumber - 1 &&
      previous.targetRegion === previousTargetRegion &&
      previous.chainId === record.chainId &&
      previous.environment === record.environment &&
      previous.backendKeyPrefix === record.backendKeyPrefix &&
      previous.identities.stateKey === record.identities.stateKey &&
      ["failed", "cleaned"].includes(previous.status)
    );
  } catch {
    return false;
  }
}

function reserveRegionalAttempt(
  record,
  stateDirectory,
  { previousAttemptKey = null, previousTargetRegion = null } = {},
) {
  assertCurrentRecord(record);
  const { directory, completedPath, lockPath } = regionalStatePaths(
    record,
    stateDirectory,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(completedPath)) {
    return { status: statSync(completedPath).isFile() ? "replayed" : "concurrent" };
  }
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      return { status: "concurrent" };
    }
    throw error;
  }
  const reservation = {
    status: "reserved",
    descriptor,
    lockPath,
    completedPath,
    record,
  };
  if (existsSync(completedPath)) {
    const status = statSync(completedPath).isFile() ? "replayed" : "concurrent";
    if (!releaseRegionalAttemptReservation(reservation)) {
      return { status: "concurrent" };
    }
    return { status };
  }
  if (
    !persistedPredecessorMatches(
      record,
      previousAttemptKey,
      previousTargetRegion,
      directory,
    )
  ) {
    if (!releaseRegionalAttemptReservation(reservation)) {
      return { status: "concurrent" };
    }
    return { status: "predecessor-mismatch" };
  }
  return reservation;
}

function persistRegionalAttemptCleanup(previousRecord, cleanedRecord, stateDirectory) {
  assertCurrentRecord(previousRecord);
  assertCurrentRecord(cleanedRecord);
  if (
    previousRecord.attemptId !== cleanedRecord.attemptId ||
    previousRecord.status !== "cleanup-required" ||
    cleanedRecord.status !== "cleaned" ||
    canonicalJson(previousRecord.failureEvidence) !==
      canonicalJson(cleanedRecord.failureEvidence) ||
    canonicalJson(cleanedRecord.events.slice(0, previousRecord.events.length)) !==
      canonicalJson(previousRecord.events)
  ) {
    throw new Error("Invalid regional cleanup record transition.");
  }
  const { directory, completedPath, lockPath } = regionalStatePaths(
    previousRecord,
    stateDirectory,
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
  const reservation = {
    status: "reserved",
    descriptor,
    lockPath,
    completedPath,
    record: previousRecord,
  };
  try {
    if (!existsSync(completedPath) || !statSync(completedPath).isFile()) {
      return false;
    }
    const persisted = JSON.parse(readFileSync(completedPath, "utf8"));
    assertCurrentRecord(persisted);
    if (persisted.recordDigest !== previousRecord.recordDigest) {
      return false;
    }
    writeJsonAtomic(completedPath, cleanedRecord);
    return true;
  } finally {
    releaseRegionalAttemptReservation(reservation);
  }
}

function completeRegionalAttemptReservation(reservation, finalRecord) {
  if (reservation.status !== "reserved") {
    throw new Error("Only a reserved regional attempt can be completed.");
  }
  assertCurrentRecord(finalRecord);
  if (finalRecord.attemptId !== reservation.record.attemptId) {
    throw new Error("Cannot complete a reservation with another attempt.");
  }
  try {
    writeJsonAtomic(reservation.completedPath, finalRecord);
  } catch (error) {
    reservation.finalizationError = error.code ?? "write-failed";
    if (reservation.descriptor !== null) {
      try {
        closeSync(reservation.descriptor);
      } catch (closeError) {
        reservation.finalizationError =
          closeError.code ?? reservation.finalizationError;
      } finally {
        reservation.descriptor = null;
      }
    }
    reservation.status = "finalization-failed";
    return false;
  }
  reservation.status = "finalizing";
  if (!releaseRegionalAttemptReservation(reservation)) {
    return false;
  }
  reservation.status = "completed";
  return true;
}

function releaseRegionalAttemptReservation(reservation) {
  let releaseError = null;
  if (reservation.descriptor !== null) {
    try {
      closeSync(reservation.descriptor);
    } catch (error) {
      releaseError = error;
    } finally {
      reservation.descriptor = null;
    }
  }
  if (existsSync(reservation.lockPath)) {
    try {
      unlinkSync(reservation.lockPath);
    } catch (error) {
      releaseError ??= error;
    }
  }
  if (releaseError) {
    reservation.status = "release-failed";
    reservation.finalizationError ??= releaseError.code ?? "release-failed";
    return false;
  }
  reservation.status = "released";
  return true;
}

function loadRegionalAttempt(path) {
  const record = JSON.parse(readFileSync(path, "utf8"));
  assertCurrentRecord(record);
  return record;
}

export {
  SCHEMA_VERSION,
  REGIONAL_ATTEMPT_CHECKS,
  assertAttemptExecutable,
  assertFreshRegionalBindings,
  assertRegionalAttemptRecord,
  attemptIdentity,
  canonicalJson,
  completeRegionalAttemptReservation,
  createRegionalAttempt,
  hashCanonical,
  loadRegionalAttempt,
  persistRegionalAttemptCleanup,
  recordAttemptFailure,
  recordAttemptSuccess,
  recordAttemptStarted,
  recordCleanupOutcome,
  releaseRegionalAttemptReservation,
  replanRegionalAttempt,
  reserveRegionalAttempt,
  sanitizeDiagnostics,
};
