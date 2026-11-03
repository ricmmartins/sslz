#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  planPostgresql,
  postgresqlDecisionDigest,
} from "./startup-postgresql-plan.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PLANNER_VERSION = "1.0.0";
const POSTGRESQL_MIGRATION_CHECK_IDS = Object.freeze({
  assessmentCurrent: "migration.postgresql.assessment-current",
  targetBound: "migration.postgresql.target-bound",
  engineCompatible: "migration.postgresql.engine-compatible",
  extensionsCompatible: "migration.postgresql.extensions-compatible",
  encodingCollationCompatible:
    "migration.postgresql.encoding-collation-compatible",
  capacityHeadroom: "migration.postgresql.capacity-headroom",
  availabilityCompatible: "migration.postgresql.availability-compatible",
  privateConnectivityReady:
    "migration.postgresql.private-connectivity-ready",
  identityAuthMapped: "migration.postgresql.identity-auth-mapped",
  migrationToolAvailable: "migration.postgresql.tool-available",
  logicalReplicationReady:
    "migration.postgresql.logical-replication-ready",
  objectsMappable: "migration.postgresql.objects-mappable",
  downtimeCompatible: "migration.postgresql.downtime-compatible",
  sourceOfTruthExplicit: "migration.postgresql.source-of-truth-explicit",
  validationComplete: "migration.postgresql.validation-complete",
  rollbackComplete: "migration.postgresql.rollback-complete",
});
const POSTGRESQL_MIGRATION_CHECK_ORDER = Object.freeze(
  Object.values(POSTGRESQL_MIGRATION_CHECK_IDS),
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

const inputSchema = load(
  "agent/schemas/postgresql-migration-plan-input.schema.json",
);
const outputSchema = load(
  "agent/schemas/postgresql-migration-plan.schema.json",
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
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
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
      sensitiveValue.some((pattern) => pattern.test(value))
    ) {
      throw new Error(
        `postgresql.migration.secret-material: ${path} contains secret material; use an opaque reference.`,
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      throw new Error(
        `postgresql.migration.secret-material: ${path}.${key} is not an allowed metadata field.`,
      );
    }
    assertNonSecretMetadata(child, `${path}.${key}`);
  }
}

function evidenceFreshness(observedAt, expiresAt, input) {
  const planningAt = Date.parse(input.planningAt);
  const observed = Date.parse(observedAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(planningAt) ||
    !Number.isFinite(observed) ||
    !Number.isFinite(expires) ||
    observed > planningAt ||
    expires <= planningAt ||
    planningAt - observed >
      input.maxAssessmentAgeHours * 60 * 60 * 1000
  ) {
    return "stale";
  }
  return "current";
}

function resultCheck(id, classification, freshness, summary, evidenceReferences) {
  return {
    id,
    classification:
      freshness === "stale" && classification === "pass"
        ? "unresolved"
        : classification,
    freshness,
    summary:
      freshness === "stale"
        ? `${summary} The supporting evidence is stale, future-dated, or expired.`
        : summary,
    evidenceReferences: [...new Set(evidenceReferences)].sort(),
  };
}

function selectedCandidate(regionalPlan) {
  return regionalPlan.candidates.find(
    (candidate) => candidate.region === regionalPlan.selectedRegion,
  );
}

function exactTargetBinding(input, regionalPlan, candidate) {
  const migrationEvidence = input.target.migrationEvidence;
  const regionalPayload = Object.fromEntries(
    Object.entries(regionalPlan).filter(([key]) => key !== "decisionDigest"),
  );
  const digestValid =
    postgresqlDecisionDigest(regionalPayload) === regionalPlan.decisionDigest;
  const targetChecksPass =
    candidate?.checks.every(({ classification }) => classification === "pass") ??
    false;
  const exactSelectionMatches =
    migrationEvidence.region === regionalPlan.selectedRegion &&
    migrationEvidence.engine.major ===
      regionalPlan.requirements.engineVersion.major &&
    migrationEvidence.engine.minor ===
      regionalPlan.requirements.engineVersion.minor &&
    regionalPlan.selectedEvidenceDigest === candidate?.evidenceDigest;
  const requiredExtensionsPresent = regionalPlan.requirements.extensions.every(
    (name) =>
      migrationEvidence.extensions.some((extension) => extension.name === name),
  );
  return (
    digestValid &&
    regionalPlan.status !== "blocked" &&
    candidate?.disposition === "eligible" &&
    targetChecksPass &&
    exactSelectionMatches &&
    requiredExtensionsPresent
  );
}

function extensionCompatibility(sourceExtensions, targetExtensions) {
  return sourceExtensions.map((source) => {
    const target = targetExtensions.find(({ name }) => name === source.name);
    return {
      name: source.name,
      sourceVersion: source.version,
      supported: target?.versions.includes(source.version) ?? false,
      targetVersions: target?.versions ? [...target.versions].sort() : [],
    };
  });
}

function capacityEvaluation(input) {
  const source = input.sourceAssessment;
  const target = input.target.migrationEvidence.capacity;
  const requirements = input.requirements;
  const requiredStorageGiB =
    (source.size.usedGiB + source.size.monthlyGrowthGiB) *
    (1 + requirements.minimumStorageHeadroomPercent / 100);
  const requiredIops =
    source.workload.peakIops *
    (1 + requirements.minimumIopsHeadroomPercent / 100);
  const requiredConnections =
    source.workload.peakConnections *
    (1 + requirements.minimumConnectionHeadroomPercent / 100);
  return {
    requiredStorageGiB: Number(requiredStorageGiB.toFixed(2)),
    provisionedStorageGiB: target.provisionedStorageGiB,
    maxStorageGiB: target.maxStorageGiB,
    requiredIops: Number(requiredIops.toFixed(2)),
    availableIops: target.maxIops,
    requiredConnections: Math.ceil(requiredConnections),
    availableConnections: target.maxConnections,
    sufficient:
      target.provisionedStorageGiB >= requiredStorageGiB &&
      target.maxStorageGiB >= requiredStorageGiB &&
      target.maxIops >= requiredIops &&
      target.maxConnections >= requiredConnections,
  };
}

function validateAssessmentScope(input) {
  const assessedDatabaseReferences = new Set(
    input.sourceAssessment.databases.map(({ reference }) => reference),
  );
  const scopedDatabaseReferences = new Set(input.scope.databaseReferences);
  const allExtensionReferencesValid =
    input.sourceAssessment.extensions.every(({ databaseReferences }) =>
      databaseReferences.every(
        (reference) =>
          assessedDatabaseReferences.has(reference) &&
          scopedDatabaseReferences.has(reference),
      ),
    );
  return (
    assessedDatabaseReferences.size === scopedDatabaseReferences.size &&
    [...assessedDatabaseReferences].every((reference) =>
      scopedDatabaseReferences.has(reference),
    ) &&
    allExtensionReferencesValid
  );
}

function objectCompatibility(input) {
  const source = input.sourceAssessment;
  const target = input.target.migrationEvidence;
  const decisions = input.decisions;
  const unsupported = [];
  const transformations = [];

  if (
    source.inventory.generatedColumns.length > 0 &&
    !target.features.generatedColumns
  ) {
    unsupported.push("generated-columns");
  }
  if (
    source.security.rowLevelSecurity.policyCount > 0 &&
    !target.features.rowLevelSecurity
  ) {
    unsupported.push("row-level-security");
  }
  if (source.inventory.largeObjects.count > 0) {
    if (!input.scope.includeLargeObjects) {
      unsupported.push("large-objects-omitted-from-scope");
    } else if (!target.features.largeObjects) {
      unsupported.push("large-objects");
    } else if (decisions.largeObjectHandling === "unresolved") {
      unsupported.push("large-object-handling-unresolved");
    } else {
      transformations.push(
        `Preserve ${source.inventory.largeObjects.count} large objects using ${decisions.largeObjectHandling}.`,
      );
    }
  }
  if (
    source.security.roles.length > 0 &&
    (!input.scope.includeRoles || decisions.roleMappingReference === null)
  ) {
    unsupported.push("roles-or-role-mapping");
  } else if (source.security.roles.length > 0) {
    transformations.push(
      `Map roles and ownership using ${decisions.roleMappingReference}.`,
    );
  }
  if (
    source.security.ownership.ownedObjectCount > 0 &&
    !input.scope.includeOwnership
  ) {
    unsupported.push("ownership-omitted-from-scope");
  } else if (
    source.security.ownership.ownedObjectCount > 0 &&
    (source.security.roles.length === 0 ||
      decisions.roleMappingReference === null)
  ) {
    unsupported.push("ownership-role-mapping-incomplete");
  }
  if (
    source.security.rowLevelSecurity.policyCount > 0 &&
    (!input.scope.includeRowLevelSecurity ||
      decisions.rowLevelSecurityValidationReference === null)
  ) {
    unsupported.push("row-level-security-validation");
  } else if (source.security.rowLevelSecurity.policyCount > 0) {
    transformations.push(
      `Recreate and validate RLS policies using ${decisions.rowLevelSecurityValidationReference}.`,
    );
  }
  return {
    supported: unsupported.length === 0 && validateAssessmentScope(input),
    unsupported,
    transformations,
  };
}

function compatibilityChecks(input, regionalPlan) {
  const source = input.sourceAssessment;
  const target = input.target.migrationEvidence;
  const sourceFreshness = evidenceFreshness(
    source.observedAt,
    source.expiresAt,
    input,
  );
  const migrationTargetFreshness = evidenceFreshness(
    target.observedAt,
    target.expiresAt,
    input,
  );
  const selectedRegionalEvidence =
    input.target.regionalPlanningInput.evidence.find(
      ({ region }) => region === regionalPlan.selectedRegion,
    );
  const regionalEvidenceFreshness = selectedRegionalEvidence
    ? evidenceFreshness(
        selectedRegionalEvidence.source.observedAt,
        selectedRegionalEvidence.source.expiresAt,
        input,
      )
    : "stale";
  const targetFreshness =
    migrationTargetFreshness === "current" &&
    regionalEvidenceFreshness === "current"
      ? "current"
      : "stale";
  const candidate = selectedCandidate(regionalPlan);
  const exactBinding = exactTargetBinding(input, regionalPlan, candidate);
  const engineCompatible =
    source.engine.major === target.engine.major &&
    target.engine.major === regionalPlan.requirements.engineVersion.major;
  const extensions = extensionCompatibility(
    source.extensions,
    target.extensions,
  );
  const missingExtensions = extensions
    .filter(({ supported }) => !supported)
    .map(({ name }) => name)
    .sort();
  const unsupportedEncodings = source.databases
    .filter(({ encoding }) => !target.supportedEncodings.includes(encoding))
    .map(({ reference }) => reference)
    .sort();
  const unsupportedCollations = source.databases
    .filter(
      ({ collation }) => !target.supportedCollations.includes(collation),
    )
    .map(({ reference }) => reference)
    .sort();
  const collationCompatible =
    unsupportedEncodings.length === 0 &&
    (unsupportedCollations.length === 0 ||
      input.decisions.collationMappingReference !== null);
  const capacity = capacityEvaluation(input);
  const availabilityCompatible =
    (!regionalPlan.requirements.zoneRedundant ||
      (target.availability.highAvailability === "zone-redundant" &&
        target.availability.zones.length >=
          regionalPlan.requirements.minimumZones)) &&
    candidate?.evidence.recovery.minimumRtoMinutes <=
      source.governance.rtoMinutes &&
    candidate?.evidence.recovery.minimumRpoMinutes <=
      source.governance.rpoMinutes;
  const privateConnectivityReady =
    source.network.connectivity === "available" &&
    (!input.requirements.requirePrivateConnectivity ||
      (target.network.privateConnectivity === "ready" &&
        target.network.privateDns === "ready"));
  const directlySupportedAuthentication = new Set(
    target.identity.authenticationModes,
  );
  const unsupportedAuthenticationModes =
    source.identity.authenticationModes.filter(
      (mode) => !directlySupportedAuthentication.has(mode),
    );
  const identityMapped =
    target.identity.authenticationModes.includes("postgresql-native") &&
    (unsupportedAuthenticationModes.length === 0 ||
      input.decisions.authenticationMappingReference !== null);
  const offlineToolAvailable = target.migrationTools.some(
    ({ name, available, supportsOnline }) =>
      name === "pg-dump-restore" && available && !supportsOnline,
  );
  const onlineToolAvailable = target.migrationTools.some(
    ({ name, available, supportsOnline }) =>
      ["azure-dms", "native-logical-replication"].includes(name) &&
      available &&
      supportsOnline,
  );
  const logicalReplicationReady =
    target.features.logicalReplication &&
    source.replication.logicalReplicationEnabled &&
    source.replication.walLevel === "logical" &&
    source.replication.availableReplicationSlots >= 1 &&
    source.replication.replicaIdentityReady;
  const offlineDowntimeMinutes = estimateOfflineDowntimeMinutes(input);
  const onlineDowntimeMinutes = Math.max(
    5,
    Math.ceil(source.workload.peakTps / 2000) + 5,
  );
  const toleratedDowntimeMinutes =
    source.governance.toleratedDowntimeMinutes;
  const logicalReplicationRequired =
    input.requirements.strategy === "online-logical-replication" ||
    (input.requirements.strategy === "auto" &&
      offlineDowntimeMinutes > toleratedDowntimeMinutes);
  const migrationToolAvailable =
    input.requirements.strategy === "offline-dump-restore"
      ? offlineToolAvailable
      : input.requirements.strategy === "online-logical-replication"
        ? onlineToolAvailable
        : (offlineDowntimeMinutes <= toleratedDowntimeMinutes &&
            offlineToolAvailable) ||
          (onlineDowntimeMinutes <= toleratedDowntimeMinutes &&
            logicalReplicationReady &&
            onlineToolAvailable);
  const objects = objectCompatibility(input);
  const downtimeCompatible =
    input.requirements.strategy === "offline-dump-restore"
      ? offlineDowntimeMinutes <= toleratedDowntimeMinutes
      : input.requirements.strategy === "online-logical-replication"
        ? logicalReplicationReady &&
          onlineDowntimeMinutes <= toleratedDowntimeMinutes
        : offlineDowntimeMinutes <= toleratedDowntimeMinutes ||
          (logicalReplicationReady &&
            onlineDowntimeMinutes <= toleratedDowntimeMinutes);
  const sourceOfTruthExplicit =
    source.governance.sourceOfTruth === "source";
  const validationComplete =
    input.validationPlan.queryReferences.length > 0 &&
    input.validationPlan.rowCounts &&
    input.validationPlan.objectCounts &&
    input.validationPlan.applicationSmokeTestReferences.length > 0;
  const rollbackComplete =
    input.rollbackPlan !== null &&
    input.rollbackPlan.conditions.length > 0 &&
    input.rollbackPlan.stepReferences.length > 0 &&
    input.rollbackPlan.failbackSourceOfTruth === "source";
  const sourceReference = source.governance.evidenceReferences[0];
  const targetReference = target.reference;
  const checks = [
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.assessmentCurrent,
      sourceFreshness === "current" ? "pass" : "unresolved",
      sourceFreshness,
      sourceFreshness === "current"
        ? "The source assessment is current and bounded by an explicit expiry."
        : "The source assessment is not current.",
      [sourceReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.targetBound,
      exactBinding ? "pass" : "fail",
      targetFreshness,
      exactBinding
        ? "The migration target exactly matches the selected regional PostgreSQL decision and evidence digests."
        : "The migration target does not exactly match the selected regional PostgreSQL decision, evidence, region, version, extensions, or checks.",
      [targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.engineCompatible,
      engineCompatible ? "pass" : "fail",
      targetFreshness,
      engineCompatible
        ? `Source PostgreSQL ${source.engine.major}.${source.engine.minor} is compatible with exact target ${target.engine.major}.${target.engine.minor}.`
        : "A major-version transition requires blocked/manual architecture review.",
      [sourceReference, targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.extensionsCompatible,
      missingExtensions.length === 0 ? "pass" : "fail",
      targetFreshness,
      missingExtensions.length === 0
        ? "Every source extension and exact version is supported by the target evidence."
        : `Unsupported source extensions or versions: ${missingExtensions.join(", ")}.`,
      [sourceReference, targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.encodingCollationCompatible,
      collationCompatible ? "pass" : "fail",
      targetFreshness,
      collationCompatible
        ? "Database encoding and collation are supported or have an explicit transformation reference."
        : `Unsupported encoding/collation remains unresolved for: ${[
            ...unsupportedEncodings,
            ...unsupportedCollations,
          ].join(", ")}.`,
      [sourceReference, targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.capacityHeadroom,
      capacity.sufficient ? "pass" : "fail",
      targetFreshness,
      capacity.sufficient
        ? "Target storage, IOPS, and connection limits meet the configured headroom."
        : "Target storage, IOPS, or connection capacity is below the configured headroom.",
      [sourceReference, targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.availabilityCompatible,
      availabilityCompatible ? "pass" : "fail",
      targetFreshness,
      availabilityCompatible
        ? "Target HA, zones, and observed recovery bounds meet the source RTO/RPO."
        : "Target HA, zones, or observed recovery bounds do not meet the source RTO/RPO.",
      [sourceReference, targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.privateConnectivityReady,
      privateConnectivityReady ? "pass" : "fail",
      targetFreshness,
      privateConnectivityReady
        ? "Required private connectivity and private DNS are ready."
        : "Required private connectivity or private DNS is missing, planned, or unknown.",
      [target.network.connectivityReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.identityAuthMapped,
      identityMapped ? "pass" : "fail",
      targetFreshness,
      identityMapped
        ? "Source authentication and role semantics have an explicit target mapping."
        : "Source authentication or role semantics lack an explicit target mapping.",
      [
        source.identity.identityProviderReference,
        target.identity.configurationReference,
        ...(input.decisions.authenticationMappingReference
          ? [input.decisions.authenticationMappingReference]
          : []),
      ],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.migrationToolAvailable,
      migrationToolAvailable ? "pass" : "fail",
      targetFreshness,
      migrationToolAvailable
        ? "An available migration tool supports at least one strategy that fits the downtime constraint."
        : "No available migration tool supports a strategy that fits the downtime constraint.",
      [targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.logicalReplicationReady,
      !logicalReplicationRequired || logicalReplicationReady ? "pass" : "fail",
      sourceFreshness === "current" && targetFreshness === "current"
        ? "current"
        : "stale",
      !logicalReplicationRequired
        ? "Logical replication is not required because the selected offline path fits the tolerated downtime."
        : logicalReplicationReady
          ? "Source WAL, slots, replica identity, target features, and an online migration tool support logical replication."
          : "Logical replication prerequisites or online migration-tool evidence are missing.",
      [sourceReference, targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.objectsMappable,
      objects.supported ? "pass" : "fail",
      sourceFreshness,
      objects.supported
        ? "Schemas, partitions, indexes, constraints, sequences, generated columns, functions, triggers, large objects, roles, ownership, and RLS are in scope and mappable."
        : `Unsupported or omitted objects: ${objects.unsupported.join(", ")}.`,
      [sourceReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.downtimeCompatible,
      downtimeCompatible ? "pass" : "fail",
      sourceFreshness === "current" && targetFreshness === "current"
        ? "current"
        : "stale",
      downtimeCompatible
        ? "At least one evidence-backed strategy fits the tolerated downtime."
        : "No evidence-backed strategy fits the tolerated downtime.",
      [sourceReference, targetReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.sourceOfTruthExplicit,
      sourceOfTruthExplicit ? "pass" : "fail",
      sourceFreshness,
      sourceOfTruthExplicit
        ? "The source remains authoritative until an approved cutover completes."
        : "The source of truth is ambiguous or prematurely assigned to the target.",
      [sourceReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.validationComplete,
      validationComplete ? "pass" : "fail",
      "not-applicable",
      validationComplete
        ? "Validation binds queries, row counts, object counts, and application smoke tests."
        : "The validation plan is incomplete.",
      [input.validationPlan.ownerReference],
    ),
    resultCheck(
      POSTGRESQL_MIGRATION_CHECK_IDS.rollbackComplete,
      rollbackComplete ? "pass" : "fail",
      "not-applicable",
      rollbackComplete
        ? "Rollback has an owner, bounded window, explicit conditions, failback authority, and steps."
        : "Rollback is missing or incomplete.",
      input.rollbackPlan ? [input.rollbackPlan.ownerReference] : [],
    ),
  ];
  return {
    checks,
    details: {
      sourceFreshness,
      targetFreshness,
      exactTargetBinding: exactBinding,
      extensionCompatibility: extensions,
      unsupportedEncodings,
      unsupportedCollations,
      capacity,
      objects,
      logicalReplicationReady,
      offlineToolAvailable,
      onlineToolAvailable,
    },
  };
}

function estimateOfflineDowntimeMinutes(input) {
  const transferMinutes =
    (input.sourceAssessment.size.usedGiB *
      1024 *
      2) /
    input.target.migrationEvidence.capacity.initialLoadMiBPerSecond /
    60;
  return Math.ceil(transferMinutes + 10);
}

function selectStrategy(input, compatibility) {
  const offlineDowntimeMinutes = estimateOfflineDowntimeMinutes(input);
  const onlineDowntimeMinutes = Math.max(
    5,
    Math.ceil(input.sourceAssessment.workload.peakTps / 2000) + 5,
  );
  const tolerated = input.sourceAssessment.governance.toleratedDowntimeMinutes;
  const requested = input.requirements.strategy;
  const failedChecks = compatibility.checks.filter(
    ({ classification }) => classification !== "pass",
  );
  const logicalFailure = POSTGRESQL_MIGRATION_CHECK_IDS.logicalReplicationReady;
  const nonLogicalFailures = failedChecks.filter(({ id }) => id !== logicalFailure);
  let selected = "blocked-manual-architecture-review";
  const rationale = [];

  if (nonLogicalFailures.length > 0) {
    rationale.push(
      ...nonLogicalFailures.map(({ id }) => `${id} did not pass.`),
    );
  } else if (requested === "offline-dump-restore") {
    if (
      offlineDowntimeMinutes <= tolerated &&
      compatibility.details.offlineToolAvailable
    ) {
      selected = "offline-dump-restore";
      rationale.push(
        "Offline dump/restore fits the documented tolerated downtime.",
      );
    } else {
      rationale.push(
        "The requested offline strategy exceeds the tolerated downtime.",
      );
    }
  } else if (requested === "online-logical-replication") {
    if (
      compatibility.details.logicalReplicationReady &&
      compatibility.details.onlineToolAvailable &&
      onlineDowntimeMinutes <= tolerated
    ) {
      selected = "online-logical-replication";
      rationale.push(
        "Logical replication evidence is complete and the estimated cutover fits the tolerated downtime.",
      );
    } else {
      rationale.push(
        "The requested online strategy lacks replication prerequisites or exceeds tolerated downtime.",
      );
    }
  } else if (
    offlineDowntimeMinutes <= tolerated &&
    compatibility.details.offlineToolAvailable
  ) {
    selected = "offline-dump-restore";
    rationale.push(
      "Auto-selection chose offline dump/restore because it fits the tolerated downtime.",
    );
  } else if (
    compatibility.details.logicalReplicationReady &&
    compatibility.details.onlineToolAvailable &&
    onlineDowntimeMinutes <= tolerated
  ) {
    selected = "online-logical-replication";
    rationale.push(
      "Auto-selection chose online logical replication because offline downtime is excessive and online prerequisites pass.",
    );
  } else {
    rationale.push(
      "No evidence-backed strategy meets the downtime and replication constraints.",
    );
  }

  return {
    requested,
    selected,
    rationale,
    estimatedDowntimeMinutes:
      selected === "online-logical-replication"
        ? onlineDowntimeMinutes
        : offlineDowntimeMinutes,
    estimatedDataLossMinutes:
      selected === "online-logical-replication"
        ? Math.min(1, input.sourceAssessment.governance.rpoMinutes)
        : input.sourceAssessment.governance.rpoMinutes,
    offlineEstimateMinutes: offlineDowntimeMinutes,
    onlineEstimateMinutes: onlineDowntimeMinutes,
    toleratedDowntimeMinutes: tolerated,
  };
}

function planSteps(input, strategy, compatibility) {
  const source = input.sourceAssessment;
  const online = strategy.selected === "online-logical-replication";
  const blocked =
    strategy.selected === "blocked-manual-architecture-review";
  const unsupportedObjects = [
    ...compatibility.details.extensionCompatibility
      .filter(({ supported }) => !supported)
      .map(({ name }) => `extension:${name}`),
    ...compatibility.details.objects.unsupported,
    ...compatibility.details.unsupportedEncodings.map(
      (reference) => `encoding:${reference}`,
    ),
    ...compatibility.details.unsupportedCollations.map(
      (reference) => `collation:${reference}`,
    ),
  ].sort();
  const requiredTransformations = [
    ...compatibility.details.objects.transformations,
  ];
  if (compatibility.details.unsupportedCollations.length > 0) {
    requiredTransformations.push(
      `Apply the reviewed collation mapping ${input.decisions.collationMappingReference}.`,
    );
  }
  if (
    source.identity.authenticationModes.some(
      (mode) =>
        !input.target.migrationEvidence.identity.authenticationModes.includes(
          mode,
        ),
    )
  ) {
    requiredTransformations.push(
      `Map source authentication semantics using ${input.decisions.authenticationMappingReference}.`,
    );
  }
  return {
    prerequisites: [
      "Reconfirm source assessment and target evidence freshness.",
      "Recompute and compare every migration identity digest.",
      "Obtain human confirmation for connectivity, ownership, maintenance window, application readiness, and migration-tool availability.",
      "Complete a representative rehearsal before declaring cutover-ready.",
    ],
    unsupportedObjects,
    requiredTransformations: requiredTransformations.sort(),
    schemaPreparation: [
      "Create target databases with reviewed encoding, locale, and collation.",
      "Create supported extensions at the exact reviewed versions.",
      "Prepare schemas, tables, partitions, indexes, constraints, sequences, generated columns, functions, and triggers without omitting unsupported objects.",
      "Apply reviewed role, ownership, and row-level-security mappings.",
    ],
    initialLoad: online
      ? [
          "Run an initial consistent snapshot through the reviewed online migration tool.",
          "Record source snapshot identity, target load identity, row counts, object counts, and load boundaries.",
        ]
      : [
          "Enter the approved write freeze before taking the final logical dump.",
          "Restore schema and data to the exact reviewed target, including large objects when in scope.",
          "Record dump and restore artifact references, counts, and boundaries.",
        ],
    cdc: online
      ? [
          "Create only the reviewed logical publication and replication slot after explicit live approval.",
          "Start change capture from the recorded snapshot boundary.",
          "Monitor lag until the approved catch-up threshold is met.",
        ]
      : [
          "CDC is not used; keep the source write freeze until validation and cutover complete.",
        ],
    validation: [
      ...input.validationPlan.queryReferences.map(
        (reference) => `Run validation query ${reference}.`,
      ),
      input.validationPlan.checksums
        ? "Compare approved checksums for selected immutable or chunked datasets."
        : "Checksums are not selected; retain the documented rationale.",
      "Compare per-table row counts and catalog object counts.",
      ...input.validationPlan.applicationSmokeTestReferences.map(
        (reference) => `Run application smoke test ${reference}.`,
      ),
    ],
    cutover: [
      "Obtain cutover-ready approval after rehearsal evidence and all checks pass.",
      online
        ? "Start the bounded final write freeze and wait for replication lag to reach the approved threshold."
        : "Maintain the bounded write freeze established before the final dump.",
      `Apply DNS changes only through ${input.decisions.dnsCutoverReference}.`,
      `Apply application connection changes only through ${input.decisions.applicationConnectionChangeReference}.`,
      `Rotate credentials using opaque references: ${input.decisions.secretRotationReferences.join(", ")}.`,
      "Run the bound validation plan before declaring the target authoritative.",
    ],
    rollback: input.rollbackPlan
      ? [
          `Keep the source authoritative and available for ${input.rollbackPlan.rollbackWindowMinutes} minutes after cutover.`,
          ...input.rollbackPlan.conditions.map(
            (reference) => `Evaluate rollback condition ${reference}.`,
          ),
          ...input.rollbackPlan.stepReferences.map(
            (reference) => `Execute only the separately approved failback procedure ${reference}.`,
          ),
          "If rollback is required, restore source application connectivity before releasing any source write freeze.",
        ]
      : ["Rollback is missing; migration remains blocked."],
    sourceOfTruthRules: [
      "The source is authoritative before cutover.",
      "The target becomes authoritative only after write freeze, catch-up when applicable, validation, and explicit cutover approval.",
      "Never permit simultaneous writes to source and target.",
      "During rollback, the source becomes authoritative only under the reviewed failback rules.",
    ],
    cleanup: [
      "Retain source, migration artifacts, and rollback capability for the approved rollback window.",
      "After the rollback window, remove migration slots, publications, temporary access, and tool resources only through a separate approved change.",
      "Do not decommission the source until retention, backup, audit, compliance, and owner confirmations are complete.",
    ],
    unresolvedDecisions: blocked
      ? [
          ...compatibility.checks
            .filter(({ classification }) => classification !== "pass")
            .map(({ id }) => id),
          ...(strategy.estimatedDowntimeMinutes >
          source.governance.toleratedDowntimeMinutes
            ? ["migration.postgresql.downtime.exceeded"]
            : []),
        ].sort()
      : [],
  };
}

function stageGates(status, strategy) {
  const blocked = status === "blocked";
  return STAGE_ORDER.map((state) => ({
    state,
    status:
      state === "assess"
        ? blocked
          ? "blocked"
          : "pass"
        : state === "rollback-required"
          ? "not-triggered"
          : blocked
            ? "blocked"
            : "pending-human-confirmation",
    gate:
      state === "assess"
        ? "All cataloged compatibility checks and strategy constraints must pass."
        : `${state} requires fresh bound evidence, prior-stage proof, and explicit human/live confirmation.`,
    executionAllowed: false,
    strategy: strategy.selected,
  }));
}

function identityBindings(input, regionalPlan, compatibility, strategy) {
  const sourceAssessmentDigest = digest(input.sourceAssessment);
  const targetMigrationEvidenceDigest = digest(
    input.target.migrationEvidence,
  );
  const scopeDigest = digest(input.scope);
  const ownerDigest = digest(input.sourceAssessment.governance.owner);
  const recoveryObjectivesDigest = digest({
    toleratedDowntimeMinutes:
      input.sourceAssessment.governance.toleratedDowntimeMinutes,
    rtoMinutes: input.sourceAssessment.governance.rtoMinutes,
    rpoMinutes: input.sourceAssessment.governance.rpoMinutes,
  });
  const validationPlanDigest = digest(input.validationPlan);
  const rollbackPlanDigest = digest(input.rollbackPlan);
  const requirementsDigest = digest(input.requirements);
  const decisionsDigest = digest(input.decisions);
  const identity = {
    sourceAssessmentDigest,
    sourceAssessmentObservedAt: input.sourceAssessment.observedAt,
    sourceAssessmentExpiresAt: input.sourceAssessment.expiresAt,
    sourceAssessmentFreshness: compatibility.details.sourceFreshness,
    targetPostgresqlDecisionDigest: regionalPlan.decisionDigest,
    targetPostgresqlSelectedEvidenceDigest:
      regionalPlan.selectedEvidenceDigest,
    targetMigrationEvidenceDigest,
    targetRegion: regionalPlan.selectedRegion,
    targetEngineVersion: input.target.migrationEvidence.engine,
    strategy: strategy.selected,
    scopeDigest,
    ownerDigest,
    recoveryObjectivesDigest,
    validationPlanDigest,
    rollbackPlanDigest,
    requirementsDigest,
    decisionsDigest,
  };
  const migrationIdentityDigest = digest(identity);
  const binding = {
    migrationIdentityDigest,
    sourceAssessmentDigest,
    targetPostgresqlDecisionDigest: regionalPlan.decisionDigest,
    targetPostgresqlSelectedEvidenceDigest:
      regionalPlan.selectedEvidenceDigest,
    targetMigrationEvidenceDigest,
    strategy: strategy.selected,
    scopeDigest,
    ownerDigest,
    recoveryObjectivesDigest,
    validationPlanDigest,
    rollbackPlanDigest,
    requirementsDigest,
    decisionsDigest,
    migrationExecutionEligible: false,
  };
  return {
    ...identity,
    migrationIdentityDigest,
    readiness: binding,
    iac: binding,
    manifest: binding,
    approval: binding,
  };
}

function planPostgresqlMigration(input) {
  assertNonSecretMetadata(input);
  validateDocument(inputSchema, input);
  const regionalPlan = planPostgresql(input.target.regionalPlanningInput);
  const compatibility = compatibilityChecks(input, regionalPlan);
  const strategy = selectStrategy(input, compatibility);
  const status =
    compatibility.checks.every(({ classification }) => classification === "pass") &&
    strategy.selected !== "blocked-manual-architecture-review"
      ? "ready"
      : "blocked";
  const migrationPlan = planSteps(
    input,
    strategy,
    compatibility,
  );
  const output = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    planId: input.planId,
    status,
    sourceAssessment: structuredClone(input.sourceAssessment),
    sourceAssessmentDigest: digest(input.sourceAssessment),
    target: {
      region: regionalPlan.selectedRegion,
      engine: structuredClone(input.target.migrationEvidence.engine),
      regionalPlanStatus: regionalPlan.status,
      regionalPlanDecisionDigest: regionalPlan.decisionDigest,
      selectedEvidenceDigest: regionalPlan.selectedEvidenceDigest,
      migrationEvidenceDigest: digest(input.target.migrationEvidence),
      migrationEvidenceFreshness: compatibility.details.targetFreshness,
      evidenceReference: input.target.migrationEvidence.reference,
    },
    requiredChecks: [...POSTGRESQL_MIGRATION_CHECK_ORDER],
    checks: compatibility.checks,
    strategy,
    stages: stageGates(status, strategy),
    migrationPlan,
    identityBindings: identityBindings(
      input,
      regionalPlan,
      compatibility,
      strategy,
    ),
    humanConfirmationRequired: [
      "Current source catalog accuracy and maintenance-window availability",
      "Current target service capacity, migration-tool availability, and private connectivity",
      "Application write-freeze behavior and connection-pool draining",
      "Role, ownership, RLS, collation, extension, and large-object transformations",
      "Rehearsal results, validation thresholds, cutover authorization, and rollback authority",
    ],
    safety: {
      executionEnabled: false,
      sourceConnections: "none",
      sourceWrites: "none",
      azureOperations: "none",
      azureWrites: "none",
      migrationToolActions: "none",
      dumpRestoreActions: "none",
      cdcActions: "none",
      dnsActions: "none",
      generatedArtifacts: "stdout-only",
    },
    planDigest: "sha256:pending",
  };
  output.planDigest = digest(
    Object.fromEntries(
      Object.entries(output).filter(([key]) => key !== "planDigest"),
    ),
  );
  validateDocument(outputSchema, output);
  return output;
}

function parseArguments(args) {
  if (args[0] !== "plan") {
    throw new Error(
      "Usage: startup-postgresql-migration-plan.mjs plan --input <path> [--output json]",
    );
  }
  let inputPath = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--input") {
      inputPath = args[index + 1];
      index += 1;
    } else if (args[index] === "--output" && args[index + 1] === "json") {
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${args[index]}`);
    }
  }
  if (!inputPath) {
    throw new Error("--input is required.");
  }
  return { inputPath };
}

function main() {
  try {
    const { inputPath } = parseArguments(process.argv.slice(2));
    const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    const plan = planPostgresqlMigration(input);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = plan.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  POSTGRESQL_MIGRATION_CHECK_IDS,
  POSTGRESQL_MIGRATION_CHECK_ORDER,
  STAGE_ORDER,
  canonicalJson,
  digest as postgresqlMigrationDigest,
  planPostgresqlMigration,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
