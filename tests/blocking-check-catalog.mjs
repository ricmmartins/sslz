#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

  const source =
    sourceCache.get(check.source) ??
    readFileSync(resolve(root, check.source), "utf8");
  sourceCache.set(check.source, source);
  assert(
    source.includes(check.id),
    `${check.id}: producer surface ${check.source} does not reference the check`,
  );

  const isBlocking = (state) => check.blockingStates.includes(state);
  assert.equal(isBlocking(check.passState), false, `${check.id}: pass must proceed`);
  for (const state of check.blockingStates) {
    assert.equal(isBlocking(state), true, `${check.id}: ${state} must block`);
  }
}

console.log(
  `Blocking-check catalog coverage passed for ${blockingIds.length} checks.`,
);
