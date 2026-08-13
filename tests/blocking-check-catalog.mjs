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
import {
  CONTAINER_CICD_CHECK_ORDER,
  planContainerImageCicd,
} from "../scripts/startup-container-image-cicd-plan.mjs";
import {
  CONNECTIVITY_CHECK_ORDER,
  connectivityPlanDigest,
  planConnectivity,
} from "../scripts/startup-connectivity-plan.mjs";

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
const containerCicdInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/container-image-cicd-plan-input.json"),
    "utf8",
  ),
);
const containerCicdScenarios = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/container-image-cicd-planner/scenarios.json"),
    "utf8",
  ),
);
const containerCicdPlan = planContainerImageCicd(containerCicdInput);
const containerCicdRuntimeIds = new Set(
  containerCicdPlan.checks.map(({ id }) => id),
);
const connectivityInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/connectivity-plan-input.json"),
    "utf8",
  ),
);
const connectivityScenarios = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/connectivity-planner/scenarios.json"),
    "utf8",
  ),
);
const connectivityPlan = planConnectivity(connectivityInput);
const connectivityRuntimeIds = new Set(
  connectivityPlan.checks.map(({ id }) => id),
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

assert.deepEqual(
  containerCicdPlan.requiredChecks,
  CONTAINER_CICD_CHECK_ORDER,
  "Container image and CI/CD required checks must be emitted by the runtime planner",
);
assert.deepEqual(
  containerCicdPlan.checks.map(({ id }) => id),
  CONTAINER_CICD_CHECK_ORDER,
  "Container image and CI/CD runtime checks must exactly cover the catalog IDs",
);
const containerCicdMutationCheckIds = new Set();
for (const scenario of containerCicdScenarios) {
  const input = structuredClone(containerCicdInput);
  for (const [path, replacement] of scenario.mutations) {
    const parts = path.split(".");
    const property = parts.pop();
    const parent = parts.reduce((current, part) => current[part], input);
    parent[property] = structuredClone(replacement);
  }
  const plan = planContainerImageCicd(input);
  for (const id of scenario.expectedChecks) {
    containerCicdMutationCheckIds.add(id);
    assert.notEqual(
      plan.checks.find((check) => check.id === id)?.classification,
      "pass",
      `${scenario.name}: ${id} must have runtime blocking semantics`,
    );
    assert.equal(
      plan.status,
      "blocked",
      `${scenario.name}: a cataloged container image and CI/CD failure must block`,
    );
  }
}
assert.deepEqual(
  [...containerCicdMutationCheckIds].sort(),
  [...CONTAINER_CICD_CHECK_ORDER].sort(),
  "Every container image and CI/CD catalog check requires a blocking runtime scenario",
);

assert.deepEqual(
  connectivityPlan.requiredChecks,
  CONNECTIVITY_CHECK_ORDER,
  "Connectivity, DNS, identity, and egress required checks must be emitted by the runtime planner",
);
assert.deepEqual(
  connectivityPlan.checks.map(({ id }) => id),
  CONNECTIVITY_CHECK_ORDER,
  "Connectivity, DNS, identity, and egress runtime checks must exactly cover the catalog IDs",
);

function withFreshConnectivityDigests(input, scenario = {}) {
  if (!scenario.skipSourceDigestRecompute) {
    input.integrityClaims.sourceAssessmentDigestClaim = connectivityPlanDigest(
      input.sourceAssessment,
    );
  }
  if (!scenario.skipTargetDigestRecompute) {
    input.integrityClaims.targetEvidenceDigestClaim = connectivityPlanDigest(
      input.target,
    );
  }
  return input;
}

const connectivityMutationCheckIds = new Set();
for (const scenario of connectivityScenarios) {
  const input = structuredClone(connectivityInput);
  for (const [path, replacement] of scenario.mutations) {
    const parts = path.split(".");
    const property = parts.pop();
    const parent = parts.reduce((current, part) => current[part], input);
    parent[property] = structuredClone(replacement);
  }
  withFreshConnectivityDigests(input, scenario);
  const plan = planConnectivity(input);
  for (const id of scenario.expectedChecks) {
    connectivityMutationCheckIds.add(id);
    assert.notEqual(
      plan.checks.find((check) => check.id === id)?.classification,
      "pass",
      `${scenario.name}: ${id} must have runtime blocking semantics`,
    );
    assert.equal(
      plan.status,
      "blocked",
      `${scenario.name}: a cataloged connectivity, DNS, identity, or egress failure must block`,
    );
  }
}
assert.deepEqual(
  [...connectivityMutationCheckIds].sort(),
  [...CONNECTIVITY_CHECK_ORDER].sort(),
  "Every connectivity, DNS, identity, and egress catalog check requires a blocking runtime scenario",
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
  } else if (check.surface === "container-image-cicd-planner") {
    assert(
      containerCicdRuntimeIds.has(check.id),
      `${check.id}: container image and CI/CD planner did not emit a runtime check result`,
    );
  } else if (check.surface === "connectivity-planner") {
    assert(
      connectivityRuntimeIds.has(check.id),
      `${check.id}: connectivity, DNS, identity, and egress planner did not emit a runtime check result`,
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
