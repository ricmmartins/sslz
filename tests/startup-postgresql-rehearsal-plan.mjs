#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  POSTGRESQL_REHEARSAL_CHECK_ORDER,
  STAGE_ORDER,
  planPostgresqlRehearsal,
  postgresqlRehearsalDigest,
} from "../scripts/startup-postgresql-rehearsal-plan.mjs";
import {
  planPostgresqlMigration,
  postgresqlMigrationDigest,
} from "../scripts/startup-postgresql-migration-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(".");
const script = resolve(
  root,
  "scripts/startup-postgresql-rehearsal-plan.mjs",
);
const migrationInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-migration-plan-input.json"),
    "utf8",
  ),
);
const evidenceTemplate = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-rehearsal-evidence.json"),
    "utf8",
  ),
);
const acceptedLineage = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-rehearsal-lineage.json"),
    "utf8",
  ),
);
const AS_OF = "2026-08-12T12:30:00Z";
const scenarios = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/fixtures/postgresql-rehearsal-planner/scenarios.json",
    ),
    "utf8",
  ),
);
const invariantScenarios = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/fixtures/postgresql-rehearsal-planner/invariants.json",
    ),
    "utf8",
  ),
);
const outputSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/postgresql-rehearsal-plan.schema.json"),
    "utf8",
  ),
);

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

function deletePath(value, path) {
  const parts = path.split(".");
  const property = parts.pop();
  const parent = parts.reduce(
    (current, part) =>
      Array.isArray(current) ? current[Number(part)] : current[part],
    value,
  );
  delete parent[property];
}

function checkById(plan, id) {
  return plan.checks.find((check) => check.id === id);
}

function rehearse(
  source,
  plan,
  evidence,
  lineage = acceptedLineage,
  asOf = AS_OF,
  planInput = migrationInput,
  trustedMigrationPlanInputDigest = postgresqlMigrationDigest(planInput),
  trustedMigrationPlanDigest = plan.planDigest,
  trustedLineageDigest = postgresqlRehearsalDigest(lineage),
) {
  return planPostgresqlRehearsal(
    source,
    planInput,
    plan,
    evidence,
    lineage,
    asOf,
    trustedMigrationPlanInputDigest,
    trustedMigrationPlanDigest,
    trustedLineageDigest,
  );
}

function evidenceFor(
  sourceAssessment,
  migrationPlan,
  template = evidenceTemplate,
  lineage = acceptedLineage,
) {
  const evidence = structuredClone(template);
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
  assert.deepEqual(sourceAssessment, migrationPlan.sourceAssessment);
  return evidence;
}

const offlineMigrationPlan = planPostgresqlMigration(migrationInput);
const sourceAssessment = structuredClone(migrationInput.sourceAssessment);
const baseEvidence = evidenceFor(sourceAssessment, offlineMigrationPlan);

for (const scenario of scenarios) {
  const evidence = structuredClone(baseEvidence);
  for (const [path, value] of scenario.mutations) {
    setPath(evidence, path, value);
  }
  const first = rehearse(
    sourceAssessment,
    offlineMigrationPlan,
    evidence,
  );
  const second = rehearse(
    structuredClone(sourceAssessment),
    structuredClone(offlineMigrationPlan),
    structuredClone(evidence),
  );
  assert.deepEqual(second, first, `${scenario.name}: deterministic output`);
  validateDocument(outputSchema, first);
  assert.equal(first.status, scenario.expectedStatus, scenario.name);
  assert.deepEqual(first.requiredChecks, POSTGRESQL_REHEARSAL_CHECK_ORDER);
  assert.deepEqual(
    first.checks.map(({ id }) => id),
    POSTGRESQL_REHEARSAL_CHECK_ORDER,
  );
  for (const id of scenario.expectedChecks) {
    assert.notEqual(
      checkById(first, id).classification,
      "pass",
      `${scenario.name}: ${id} must not pass`,
    );
  }
  assert.deepEqual(
    first.stages.map(({ state }) => state),
    STAGE_ORDER,
  );
  assert(first.stages.every(({ executionAllowed }) => !executionAllowed));
  assert(first.stages.every(({ transitionApplied }) => !transitionApplied));
  assert.equal(first.transition.transitionApplied, false);
  assert.equal(first.safety.executionEnabled, false);
  assert.equal(first.safety.sourceConnections, "none");
  assert.equal(first.safety.targetConnections, "none");
  assert.equal(first.safety.sourceWrites, "none");
  assert.equal(first.safety.targetWrites, "none");
  assert.equal(first.safety.cloudOperations, "none");
  assert.equal(first.safety.cloudWrites, "none");
  assert.equal(first.safety.migrationToolActions, "none");
  assert.equal(first.safety.dumpRestoreActions, "none");
  assert.equal(first.safety.cdcActions, "none");
  assert.equal(first.safety.dnsActions, "none");
  assert.equal(first.safety.generatedCommands, "none");
  assert.equal(first.safety.transitionWrites, "none");
  assert.equal(
    first.planDigest,
    postgresqlRehearsalDigest(
      Object.fromEntries(
        Object.entries(first).filter(([key]) => key !== "planDigest"),
      ),
    ),
  );
}

const ready = rehearse(
  sourceAssessment,
  offlineMigrationPlan,
  baseEvidence,
);
assert.equal(ready.status, "ready-for-cutover-review");
assert.equal(ready.target.region, "centralus");
assert.equal(ready.target.strategy, "offline-dump-restore");
assert.equal(
  checkById(
    ready,
    "rehearsal.postgresql.catch-up-permitted",
  ).classification,
  "pass",
);
assert.equal(
  ready.stages.find(({ state }) => state === "catch-up").status,
  "not-applicable",
);
assert(
  ready.rehearsalPlan.catchUp.some((step) =>
    step.includes("offline-first"),
  ),
);

const zeroTableInput = structuredClone(migrationInput);
zeroTableInput.sourceAssessment.inventory.tables = [];
zeroTableInput.sourceAssessment.inventory.partitions = [];
zeroTableInput.sourceAssessment.inventory.indexes = [];
zeroTableInput.sourceAssessment.inventory.constraints = {
  primaryKeys: 0,
  foreignKeys: 0,
  unique: 0,
  check: 0,
};
zeroTableInput.sourceAssessment.inventory.generatedColumns = [];
const zeroTableMigrationPlan = planPostgresqlMigration(zeroTableInput);
const zeroTableEvidence = evidenceFor(
  zeroTableInput.sourceAssessment,
  zeroTableMigrationPlan,
);
zeroTableEvidence.validation.objectCounts = { source: 15, target: 15 };
zeroTableEvidence.validation.rowCounts = [];
zeroTableEvidence.validation.dataVerification.sampleRows = 0;
const zeroTableResult = rehearse(
  zeroTableInput.sourceAssessment,
  zeroTableMigrationPlan,
  zeroTableEvidence,
  acceptedLineage,
  AS_OF,
  zeroTableInput,
);
assert.equal(zeroTableResult.status, "ready-for-cutover-review");
assert.deepEqual(zeroTableResult.validationSummary.rowCounts, []);

const onlineInput = structuredClone(migrationInput);
onlineInput.sourceAssessment.provider = "google-cloud-sql";
onlineInput.sourceAssessment.size.allocatedGiB = 600;
onlineInput.sourceAssessment.size.usedGiB = 500;
onlineInput.sourceAssessment.size.monthlyGrowthGiB = 50;
onlineInput.sourceAssessment.governance.toleratedDowntimeMinutes = 15;
onlineInput.sourceAssessment.identity.authenticationModes = ["cloud-iam"];
onlineInput.target.migrationEvidence.capacity.provisionedStorageGiB = 1024;
const onlineMigrationPlan = planPostgresqlMigration(onlineInput);
assert.equal(
  onlineMigrationPlan.strategy.selected,
  "online-logical-replication",
);
const onlineEvidence = evidenceFor(
  onlineInput.sourceAssessment,
  onlineMigrationPlan,
);
onlineEvidence.initialLoad.method = "consistent-snapshot";
onlineEvidence.catchUp = {
  mode: "logical-replication",
  explicitlyPermitted: true,
  completed: true,
  maxLagSeconds: 30,
  finalLagSeconds: 0,
  evidenceReferences: ["evidence.rehearsal.orders.catch-up"],
};
const online = rehearse(
  onlineInput.sourceAssessment,
  onlineMigrationPlan,
  onlineEvidence,
  acceptedLineage,
  AS_OF,
  onlineInput,
);
assert.equal(online.status, "ready-for-cutover-review");
assert.equal(online.target.strategy, "online-logical-replication");
assert(
  online.rehearsalPlan.catchUp.some((step) =>
    step.includes("selected and permitted"),
  ),
);

const onlineWithoutPermission = structuredClone(onlineEvidence);
onlineWithoutPermission.catchUp.explicitlyPermitted = false;
const onlineBlocked = rehearse(
  onlineInput.sourceAssessment,
  onlineMigrationPlan,
  onlineWithoutPermission,
  acceptedLineage,
  AS_OF,
  onlineInput,
);
assert.equal(onlineBlocked.status, "blocked");
assert.equal(
  checkById(
    onlineBlocked,
    "rehearsal.postgresql.catch-up-permitted",
  ).classification,
  "fail",
);

const onlineExcessiveLag = structuredClone(onlineEvidence);
onlineExcessiveLag.catchUp.maxLagSeconds = 3600;
onlineExcessiveLag.catchUp.finalLagSeconds = 3600;
const onlineLagBlocked = rehearse(
  onlineInput.sourceAssessment,
  onlineMigrationPlan,
  onlineExcessiveLag,
  acceptedLineage,
  AS_OF,
  onlineInput,
);
assert.equal(onlineLagBlocked.status, "blocked");
assert.equal(
  checkById(
    onlineLagBlocked,
    "rehearsal.postgresql.catch-up-permitted",
  ).classification,
  "fail",
);

for (const scenario of invariantScenarios) {
  if (scenario.kind === "no-write-source") {
    continue;
  }
  const candidateSource = structuredClone(sourceAssessment);
  const candidatePlanInput = structuredClone(migrationInput);
  const candidatePlan = structuredClone(offlineMigrationPlan);
  const candidateEvidence = structuredClone(baseEvidence);
  const candidateLineage = structuredClone(acceptedLineage);
  let candidateAsOf = AS_OF;
  if (scenario.kind === "tampered-plan") {
    setPath(candidatePlan, scenario.path, scenario.value);
  } else if (scenario.kind === "coherent-target-tamper") {
    setPath(candidatePlan, scenario.path, scenario.value);
    candidatePlan.planDigest = postgresqlMigrationDigest(
      Object.fromEntries(
        Object.entries(candidatePlan).filter(([key]) => key !== "planDigest"),
      ),
    );
    candidateEvidence.bindings.targetRegion = scenario.value;
    candidateEvidence.bindings.migrationPlanDigest =
      candidatePlan.planDigest;
  } else if (scenario.kind === "coherent-bundle-tamper") {
    candidatePlanInput.validationPlan.queryReferences = [
      "validation.unrelated.query",
    ];
    const replacementPlan = planPostgresqlMigration(candidatePlanInput);
    Object.assign(candidatePlan, replacementPlan);
    Object.assign(
      candidateEvidence,
      evidenceFor(candidateSource, replacementPlan),
    );
  } else if (scenario.kind === "mismatched-source") {
    setPath(candidateSource, scenario.path, scenario.value);
  } else if (scenario.kind === "exact-replay") {
    candidateLineage.acceptedEvidenceSets.push({
      evidenceSetId: candidateEvidence.evidenceSetId,
      evidenceDigest: postgresqlRehearsalDigest(candidateEvidence),
      rehearsalIdentityDigest: `sha256:${"0".repeat(64)}`,
    });
  } else if (scenario.kind === "evaluation-time") {
    candidateAsOf = scenario.value;
  } else if (scenario.kind === "migration-input") {
    setPath(candidatePlanInput, scenario.path, scenario.value);
  } else if (scenario.kind === "evidence-values") {
    for (const [path, value] of scenario.mutations) {
      setPath(candidateEvidence, path, value);
    }
  } else if (scenario.kind === "omission") {
    deletePath(candidateEvidence, scenario.path);
  } else {
    setPath(candidateEvidence, scenario.path, scenario.value);
  }
  if (scenario.expectedError) {
    assert.throws(
      () =>
        rehearse(
          candidateSource,
          candidatePlan,
          candidateEvidence,
          candidateLineage,
          candidateAsOf,
          candidatePlanInput,
          postgresqlMigrationDigest(migrationInput),
          offlineMigrationPlan.planDigest,
          postgresqlRehearsalDigest(acceptedLineage),
        ),
      new RegExp(scenario.expectedError.replaceAll(".", "\\.")),
      scenario.name,
    );
    continue;
  }
  const result = rehearse(
    candidateSource,
    candidatePlan,
    candidateEvidence,
    candidateLineage,
    candidateAsOf,
    candidatePlanInput,
    postgresqlMigrationDigest(migrationInput),
    offlineMigrationPlan.planDigest,
    postgresqlRehearsalDigest(acceptedLineage),
  );
  assert.equal(
    result.status,
    scenario.expectedStatus ?? "blocked",
    scenario.name,
  );
  if (scenario.expectedStaleEvidence) {
    assert.deepEqual(
      Object.entries(result.validationSummary.evidenceFreshness)
        .filter(([, freshness]) => freshness === "stale")
        .map(([name]) => name)
        .sort(),
      [...scenario.expectedStaleEvidence].sort(),
      scenario.name,
    );
  }
  for (const id of scenario.expectedChecks) {
    assert.notEqual(
      checkById(result, id).classification,
      "pass",
      `${scenario.name}: ${id} must not pass`,
    );
  }
}

const reversedPlanningInput = structuredClone(migrationInput);
reversedPlanningInput.target.regionalPlanningInput.planningAt =
  "2026-08-12T12:10:00Z";
const reversedPlanningPlan = planPostgresqlMigration(reversedPlanningInput);
const reversedPlanningEvidence = evidenceFor(
  reversedPlanningInput.sourceAssessment,
  reversedPlanningPlan,
);
const reversedPlanningResult = rehearse(
  reversedPlanningInput.sourceAssessment,
  reversedPlanningPlan,
  reversedPlanningEvidence,
  acceptedLineage,
  AS_OF,
  reversedPlanningInput,
);
assert.equal(reversedPlanningResult.status, "manual-review-required");
assert.equal(
  reversedPlanningResult.validationSummary.evidenceFreshness.regionalPlanning,
  "stale",
);

const splitFreshnessInput = structuredClone(migrationInput);
splitFreshnessInput.maxAssessmentAgeHours = 20;
splitFreshnessInput.target.regionalPlanningInput.maxEvidenceAgeHours = 48;
const splitFreshnessPlan = planPostgresqlMigration(splitFreshnessInput);
const splitFreshnessEvidence = evidenceFor(
  splitFreshnessInput.sourceAssessment,
  splitFreshnessPlan,
);
splitFreshnessEvidence.maxEvidenceAgeHours = 20;
const splitFreshnessResult = rehearse(
  splitFreshnessInput.sourceAssessment,
  splitFreshnessPlan,
  splitFreshnessEvidence,
  acceptedLineage,
  "2026-08-13T07:00:00Z",
  splitFreshnessInput,
);
assert.equal(splitFreshnessResult.status, "manual-review-required");
assert.equal(
  splitFreshnessResult.validationSummary.evidenceFreshness.sourceAssessment,
  "stale",
);
assert.equal(
  splitFreshnessResult.validationSummary.evidenceFreshness
    .targetMigrationEvidence,
  "stale",
);
assert.equal(
  splitFreshnessResult.validationSummary.evidenceFreshness
    .selectedRegionalEvidence,
  "current",
);

const futureLineage = structuredClone(acceptedLineage);
futureLineage.observedAt = "2026-08-12T12:20:00Z";
const futureLineageEvidence = evidenceFor(
  sourceAssessment,
  offlineMigrationPlan,
  evidenceTemplate,
  futureLineage,
);
const futureLineageResult = rehearse(
  sourceAssessment,
  offlineMigrationPlan,
  futureLineageEvidence,
  futureLineage,
  AS_OF,
);
assert.equal(futureLineageResult.status, "manual-review-required");
assert.equal(
  futureLineageResult.validationSummary.evidenceFreshness.rehearsal,
  "stale",
);

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "sslz-postgresql-rehearsal-plan-"),
);
const sourcePath = join(temporaryDirectory, "source.json");
const migrationInputPath = join(temporaryDirectory, "migration-input.json");
const migrationPath = join(temporaryDirectory, "migration.json");
const evidencePath = join(temporaryDirectory, "evidence.json");
const lineagePath = join(temporaryDirectory, "lineage.json");
writeFileSync(sourcePath, `${JSON.stringify(sourceAssessment)}\n`);
writeFileSync(migrationInputPath, `${JSON.stringify(migrationInput)}\n`);
writeFileSync(migrationPath, `${JSON.stringify(offlineMigrationPlan)}\n`);
writeFileSync(evidencePath, `${JSON.stringify(baseEvidence)}\n`);
writeFileSync(lineagePath, `${JSON.stringify(acceptedLineage)}\n`);
const before = readdirSync(temporaryDirectory).sort();
const cli = spawnSync(
  process.execPath,
  [
    script,
    "plan",
    "--source-assessment",
    sourcePath,
    "--migration-plan-input",
    migrationInputPath,
    "--migration-plan",
    migrationPath,
    "--evidence",
    evidencePath,
    "--accepted-lineage",
    lineagePath,
    "--as-of",
    AS_OF,
    "--trusted-migration-plan-input-digest",
    postgresqlMigrationDigest(migrationInput),
    "--trusted-migration-plan-digest",
    offlineMigrationPlan.planDigest,
    "--trusted-lineage-digest",
    postgresqlRehearsalDigest(acceptedLineage),
    "--output",
    "json",
  ],
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);
assert.deepEqual(JSON.parse(cli.stdout), ready);

const source = readFileSync(script, "utf8");
assert(
  invariantScenarios.some(({ kind }) => kind === "no-write-source"),
  "No-write source invariant must be fixture-driven.",
);
assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls)/);
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
  `PostgreSQL rehearsal planner tests passed for ${scenarios.length + invariantScenarios.length} synthetic scenarios plus online catch-up.`,
);
