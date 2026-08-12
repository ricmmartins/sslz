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
  POSTGRESQL_MIGRATION_CHECK_IDS,
  POSTGRESQL_MIGRATION_CHECK_ORDER,
  STAGE_ORDER,
  planPostgresqlMigration,
  postgresqlMigrationDigest,
} from "../scripts/startup-postgresql-migration-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(".");
const script = resolve(
  root,
  "scripts/startup-postgresql-migration-plan.mjs",
);
const base = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-migration-plan-input.json"),
    "utf8",
  ),
);
const scenarios = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/fixtures/postgresql-migration-planner/scenarios.json",
    ),
    "utf8",
  ),
);
const outputSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/postgresql-migration-plan.schema.json"),
    "utf8",
  ),
);

function setPath(value, path, replacement) {
  const parts = path.split(".");
  const property = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[property] = structuredClone(replacement);
}

function checkById(plan, id) {
  return plan.checks.find((check) => check.id === id);
}

function planWith(...mutations) {
  const input = structuredClone(base);
  for (const [path, value] of mutations) {
    setPath(input, path, value);
  }
  return planPostgresqlMigration(input);
}

for (const scenario of scenarios) {
  const input = structuredClone(base);
  for (const [path, value] of scenario.mutations) {
    setPath(input, path, value);
  }
  const first = planPostgresqlMigration(input);
  const second = planPostgresqlMigration(structuredClone(input));
  assert.deepEqual(second, first, `${scenario.name}: output must be deterministic`);
  validateDocument(outputSchema, first);
  assert.equal(first.status, scenario.expectedStatus, scenario.name);
  assert.equal(
    first.strategy.selected,
    scenario.expectedStrategy,
    scenario.name,
  );
  assert.deepEqual(first.requiredChecks, POSTGRESQL_MIGRATION_CHECK_ORDER);
  assert.deepEqual(
    first.checks.map(({ id }) => id),
    POSTGRESQL_MIGRATION_CHECK_ORDER,
  );
  for (const id of scenario.expectedChecks) {
    assert.notEqual(
      checkById(first, id).classification,
      "pass",
      `${scenario.name}: ${id} must block`,
    );
  }
  assert.equal(first.safety.executionEnabled, false);
  assert.equal(first.safety.sourceConnections, "none");
  assert.equal(first.safety.sourceWrites, "none");
  assert.equal(first.safety.azureOperations, "none");
  assert.equal(first.safety.azureWrites, "none");
  assert.equal(first.safety.migrationToolActions, "none");
  assert.equal(first.safety.dumpRestoreActions, "none");
  assert.equal(first.safety.cdcActions, "none");
  assert.equal(first.safety.dnsActions, "none");
  assert.deepEqual(
    first.stages.map(({ state }) => state),
    STAGE_ORDER,
  );
  assert(first.stages.every(({ executionAllowed }) => !executionAllowed));
  assert.equal(
    first.planDigest,
    postgresqlMigrationDigest(
      Object.fromEntries(
        Object.entries(first).filter(([key]) => key !== "planDigest"),
      ),
    ),
  );
}

const offline = planPostgresqlMigration(base);
assert.equal(offline.status, "ready");
assert.equal(offline.strategy.selected, "offline-dump-restore");
assert(
  offline.migrationPlan.initialLoad.some((step) =>
    step.includes("write freeze"),
  ),
);
assert(
  offline.migrationPlan.requiredTransformations.some((step) =>
    step.includes("roles and ownership"),
  ),
);
assert(
  offline.migrationPlan.requiredTransformations.some((step) =>
    step.includes("RLS"),
  ),
);
assert.equal(
  offline.identityBindings.readiness.migrationIdentityDigest,
  offline.identityBindings.migrationIdentityDigest,
);
assert.deepEqual(
  offline.identityBindings.readiness,
  offline.identityBindings.iac,
);
assert.deepEqual(
  offline.identityBindings.iac,
  offline.identityBindings.manifest,
);
assert.deepEqual(
  offline.identityBindings.manifest,
  offline.identityBindings.approval,
);
assert.equal(
  offline.identityBindings.approval.migrationExecutionEligible,
  false,
);

const online = planWith(
  ["sourceAssessment.provider", "google-cloud-sql"],
  ["sourceAssessment.size.allocatedGiB", 600],
  ["sourceAssessment.size.usedGiB", 500],
  ["sourceAssessment.size.monthlyGrowthGiB", 50],
  ["target.migrationEvidence.capacity.provisionedStorageGiB", 1024],
  ["sourceAssessment.governance.toleratedDowntimeMinutes", 15],
  ["sourceAssessment.identity.authenticationModes", ["cloud-iam"]],
);
assert.equal(online.strategy.selected, "online-logical-replication");
assert(
  online.migrationPlan.cdc.some((step) =>
    step.includes("logical publication"),
  ),
);
assert(
  online.migrationPlan.cutover.some((step) =>
    step.includes("replication lag"),
  ),
);

const largeObjects = planWith(
  ["sourceAssessment.inventory.largeObjects.count", 25],
  ["sourceAssessment.inventory.largeObjects.totalGiB", 1.5],
  ["decisions.largeObjectHandling", "offline-window"],
);
assert.equal(largeObjects.status, "ready");
assert(
  largeObjects.migrationPlan.requiredTransformations.some((step) =>
    step.includes("25 large objects"),
  ),
);

const targetRegionMutation = planWith([
  "target.migrationEvidence.region",
  "eastus2",
]);
assert.equal(
  checkById(
    targetRegionMutation,
    POSTGRESQL_MIGRATION_CHECK_IDS.targetBound,
  ).classification,
  "fail",
);
assert.notEqual(targetRegionMutation.planDigest, offline.planDigest);
assert.notEqual(
  targetRegionMutation.identityBindings.migrationIdentityDigest,
  offline.identityBindings.migrationIdentityDigest,
);

const targetVersionMutation = planWith([
  "target.migrationEvidence.engine.minor",
  5,
]);
assert.equal(
  checkById(
    targetVersionMutation,
    POSTGRESQL_MIGRATION_CHECK_IDS.targetBound,
  ).classification,
  "fail",
);
assert.notEqual(targetVersionMutation.planDigest, offline.planDigest);

const requirementsMutation = planWith([
  "requirements.minimumStorageHeadroomPercent",
  40,
]);
assert.notEqual(requirementsMutation.planDigest, offline.planDigest);
assert.notEqual(
  requirementsMutation.identityBindings.migrationIdentityDigest,
  offline.identityBindings.migrationIdentityDigest,
);
assert.notDeepEqual(
  requirementsMutation.identityBindings.approval,
  offline.identityBindings.approval,
);

const decisionsMutation = planWith([
  "decisions.dnsCutoverReference",
  "runbook.dns.orders.v2",
]);
assert.notEqual(decisionsMutation.planDigest, offline.planDigest);
assert.notEqual(
  decisionsMutation.identityBindings.migrationIdentityDigest,
  offline.identityBindings.migrationIdentityDigest,
);
assert.notDeepEqual(
  decisionsMutation.identityBindings.approval,
  offline.identityBindings.approval,
);

const impossibleOnlineTool = planWith(
  ["sourceAssessment.size.allocatedGiB", 600],
  ["sourceAssessment.size.usedGiB", 500],
  ["sourceAssessment.size.monthlyGrowthGiB", 50],
  ["target.migrationEvidence.capacity.provisionedStorageGiB", 1024],
  ["sourceAssessment.governance.toleratedDowntimeMinutes", 15],
  [
    "target.migrationEvidence.migrationTools",
    [
      {
        name: "pg-dump-restore",
        available: true,
        supportsOnline: true,
      },
    ],
  ],
);
assert.equal(impossibleOnlineTool.status, "blocked");
assert.equal(
  checkById(
    impossibleOnlineTool,
    POSTGRESQL_MIGRATION_CHECK_IDS.migrationToolAvailable,
  ).classification,
  "fail",
);

const contradictorySourceType = structuredClone(base);
contradictorySourceType.sourceAssessment.sourceType = "self-managed";
assert.throws(
  () => planPostgresqlMigration(contradictorySourceType),
  /expected exactly one oneOf match/,
);

const secretKey = structuredClone(base);
secretKey.sourceAssessment.identity.password = "not-allowed";
assert.throws(
  () => planPostgresqlMigration(secretKey),
  /postgresql\.migration\.secret-material/,
);
const secretValue = structuredClone(base);
secretValue.sourceAssessment.identity.secretReferences[0] =
  `postgresql://migration-user:${["raw", "password"].join("-")}@source.example/database`;
assert.throws(
  () => planPostgresqlMigration(secretValue),
  /postgresql\.migration\.secret-material/,
);

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "sslz-postgresql-migration-plan-"),
);
const inputPath = join(temporaryDirectory, "input.json");
writeFileSync(inputPath, `${JSON.stringify(base)}\n`);
const before = readdirSync(temporaryDirectory).sort();
const cli = spawnSync(
  process.execPath,
  [script, "plan", "--input", inputPath, "--output", "json"],
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);
assert.deepEqual(JSON.parse(cli.stdout), offline);

const source = readFileSync(script, "utf8");
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
  JSON.stringify(offline),
  /migration-user|BEGIN [A-Z ]+PRIVATE KEY/,
);

console.log(
  `PostgreSQL migration planner tests passed for ${scenarios.length} synthetic scenarios.`,
);
