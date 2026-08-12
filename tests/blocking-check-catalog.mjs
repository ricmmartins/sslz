#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POSTGRESQL_CHECK_ORDER,
  planPostgresql,
} from "../scripts/startup-postgresql-plan.mjs";
import {
  POSTGRESQL_MIGRATION_CHECK_ORDER,
  planPostgresqlMigration,
  postgresqlMigrationDigest,
} from "../scripts/startup-postgresql-migration-plan.mjs";
import {
  POSTGRESQL_REHEARSAL_CHECK_ORDER,
  planPostgresqlRehearsal,
  postgresqlRehearsalDigest,
} from "../scripts/startup-postgresql-rehearsal-plan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  readFileSync(resolve(root, "agent/checks/check-catalog.json"), "utf8"),
);
const fixture = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/blocking-check-semantics.json"),
    "utf8",
  ),
);
const postgresqlPlan = planPostgresql(
  JSON.parse(
    readFileSync(
      resolve(root, "agent/examples/postgresql-regional-plan-input.json"),
      "utf8",
    ),
  ),
);
const postgresqlRuntimeIds = new Set(
  postgresqlPlan.candidates.flatMap((candidate) =>
    candidate.checks.map(({ id }) => id),
  ),
);
const postgresqlMigrationInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-migration-plan-input.json"),
    "utf8",
  ),
);
const postgresqlMigrationScenarios = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/fixtures/postgresql-migration-planner/scenarios.json",
    ),
    "utf8",
  ),
);
const postgresqlMigrationPlan = planPostgresqlMigration(
  postgresqlMigrationInput,
);
const postgresqlMigrationRuntimeIds = new Set(
  postgresqlMigrationPlan.checks.map(({ id }) => id),
);
const postgresqlRehearsalEvidence = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-rehearsal-evidence.json"),
    "utf8",
  ),
);
const postgresqlRehearsalLineage = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-rehearsal-lineage.json"),
    "utf8",
  ),
);
const postgresqlRehearsalPlan = planPostgresqlRehearsal(
  postgresqlMigrationInput.sourceAssessment,
  postgresqlMigrationInput,
  postgresqlMigrationPlan,
  postgresqlRehearsalEvidence,
  postgresqlRehearsalLineage,
  "2026-08-12T12:30:00Z",
  postgresqlMigrationDigest(postgresqlMigrationInput),
  postgresqlMigrationPlan.planDigest,
  postgresqlRehearsalDigest(postgresqlRehearsalLineage),
);
const postgresqlRehearsalRuntimeIds = new Set(
  postgresqlRehearsalPlan.checks.map(({ id }) => id),
);
assert.deepEqual(
  postgresqlPlan.requiredChecks,
  POSTGRESQL_CHECK_ORDER,
  "PostgreSQL required checks must be emitted by the runtime planner",
);
for (const candidate of postgresqlPlan.candidates) {
  assert.deepEqual(
    candidate.checks.map(({ id }) => id),
    POSTGRESQL_CHECK_ORDER,
    `${candidate.region}: PostgreSQL runtime checks must exactly cover the catalog IDs`,
  );
}
assert.deepEqual(
  postgresqlMigrationPlan.requiredChecks,
  POSTGRESQL_MIGRATION_CHECK_ORDER,
  "PostgreSQL migration required checks must be emitted by the runtime planner",
);
assert.deepEqual(
  postgresqlMigrationPlan.checks.map(({ id }) => id),
  POSTGRESQL_MIGRATION_CHECK_ORDER,
  "PostgreSQL migration runtime checks must exactly cover the catalog IDs",
);
assert.deepEqual(
  postgresqlRehearsalPlan.requiredChecks,
  POSTGRESQL_REHEARSAL_CHECK_ORDER,
  "PostgreSQL rehearsal required checks must be emitted by the runtime planner",
);
assert.deepEqual(
  postgresqlRehearsalPlan.checks.map(({ id }) => id),
  POSTGRESQL_REHEARSAL_CHECK_ORDER,
  "PostgreSQL rehearsal runtime checks must exactly cover the catalog IDs",
);
const mutationCheckIds = new Set();
for (const scenario of postgresqlMigrationScenarios) {
  const input = structuredClone(postgresqlMigrationInput);
  for (const [path, replacement] of scenario.mutations) {
    const parts = path.split(".");
    const property = parts.pop();
    const parent = parts.reduce((current, part) => current[part], input);
    parent[property] = structuredClone(replacement);
  }
  const plan = planPostgresqlMigration(input);
  for (const id of scenario.expectedChecks) {
    mutationCheckIds.add(id);
    assert.notEqual(
      plan.checks.find((check) => check.id === id)?.classification,
      "pass",
      `${scenario.name}: ${id} must have runtime blocking semantics`,
    );
    assert.equal(
      plan.status,
      "blocked",
      `${scenario.name}: a cataloged migration failure must block`,
    );
  }
}
assert.deepEqual(
  [...mutationCheckIds].sort(),
  [...POSTGRESQL_MIGRATION_CHECK_ORDER].sort(),
  "Every PostgreSQL migration catalog check requires a blocking runtime scenario",
);

assert.equal(fixture.schemaVersion, "1.0.0");
const blockingIds = catalog.checks
  .filter((check) => check.severity === "blocking")
  .map((check) => check.id)
  .sort();
const fixtureIds = fixture.checks.map((check) => check.id).sort();

assert.equal(
  new Set(fixtureIds).size,
  fixtureIds.length,
  "Blocking-check semantic fixture IDs must be unique",
);
assert.deepEqual(
  fixtureIds,
  blockingIds,
  "Every blocking catalog ID requires an explicit semantic fixture",
);

const sourceCache = new Map();
for (const check of fixture.checks) {
  assert.match(check.id, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
  assert.equal(typeof check.surface, "string");
  assert.equal(typeof check.source, "string");
  assert.equal(typeof check.passState, "string");
  assert(check.blockingStates.length > 0, `${check.id}: missing blocking states`);
  assert.equal(
    new Set(check.blockingStates).size,
    check.blockingStates.length,
    `${check.id}: duplicate blocking states`,
  );
  assert(
    !check.blockingStates.includes(check.passState),
    `${check.id}: pass state cannot block`,
  );

  if (check.surface === "postgresql-regional-planner") {
    assert(
      postgresqlRuntimeIds.has(check.id),
      `${check.id}: PostgreSQL planner did not emit a runtime check result`,
    );
  } else if (check.surface === "postgresql-migration-planner") {
    assert(
      postgresqlMigrationRuntimeIds.has(check.id),
      `${check.id}: PostgreSQL migration planner did not emit a runtime check result`,
    );
  } else if (check.surface === "postgresql-rehearsal-planner") {
    assert(
      postgresqlRehearsalRuntimeIds.has(check.id),
      `${check.id}: PostgreSQL rehearsal planner did not emit a runtime check result`,
    );
  } else {
    const source =
      sourceCache.get(check.source) ??
      readFileSync(resolve(root, check.source), "utf8");
    sourceCache.set(check.source, source);
    assert(
      source.includes(check.id),
      `${check.id}: producer surface ${check.source} does not reference the check`,
    );
  }

  const isBlocking = (state) => check.blockingStates.includes(state);
  assert.equal(isBlocking(check.passState), false, `${check.id}: pass must proceed`);
  for (const state of check.blockingStates) {
    assert.equal(isBlocking(state), true, `${check.id}: ${state} must block`);
  }
}

console.log(
  `Blocking-check catalog coverage passed for ${blockingIds.length} checks.`,
);
