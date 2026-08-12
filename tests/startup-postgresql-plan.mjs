#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  planPostgresql,
  postgresqlDecisionDigest,
} from "../scripts/startup-postgresql-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(".");
const script = resolve(root, "scripts/startup-postgresql-plan.mjs");
const base = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/postgresql-regional-plan-input.json"),
    "utf8",
  ),
);
const scenarios = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/postgresql-planner/scenarios.json"),
    "utf8",
  ),
);
const outputSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/postgresql-regional-plan.schema.json"),
    "utf8",
  ),
);

function setPath(value, path, replacement) {
  const parts = path.split(".");
  const property = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[property] = structuredClone(replacement);
}

function reasonCodes(plan) {
  return new Set(
    plan.candidates.flatMap((candidate) =>
      candidate.reasons.map((reason) => reason.code),
    ),
  );
}

for (const scenario of scenarios) {
  const input = structuredClone(base);
  for (const [path, value] of scenario.mutations) {
    setPath(input, path, value);
  }
  const first = planPostgresql(input);
  const second = planPostgresql(structuredClone(input));
  assert.deepEqual(second, first, `${scenario.name}: result must be deterministic`);
  validateDocument(outputSchema, first);
  assert.equal(first.status, scenario.expectedStatus, scenario.name);
  assert.equal(first.selectedRegion, scenario.expectedRegion, scenario.name);
  for (const code of scenario.expectedCodes) {
    assert(reasonCodes(first).has(code), `${scenario.name}: missing ${code}`);
  }
  assert.equal(first.azureOperations, "none");
  assert.equal(first.deploymentBoundary, "planning-only");
  assert.equal(first.capacityReservationClaimed, false);
}

const fallback = planPostgresql(base);
assert.equal(fallback.status, "fallback-required");
assert.deepEqual(fallback.fallback, {
  required: true,
  fromRegion: "eastus2",
  toRegion: "centralus",
  rationale: [
    "postgresql.edition.unsupported",
    "postgresql.version.unsupported",
  ],
  requiresNewPlanArtifactsManifestApproval: true,
});
assert.deepEqual(
  {
    deploymentBoundary: fallback.providerParameters.bicep.deploymentBoundary,
    location: fallback.providerParameters.bicep.location,
    tier: fallback.providerParameters.bicep.tier,
    sku: fallback.providerParameters.bicep.sku,
    engineMajorVersion:
      fallback.providerParameters.bicep.engineMajorVersion,
    engineMinorVersion:
      fallback.providerParameters.bicep.engineMinorVersion,
    extensions: fallback.providerParameters.bicep.extensions,
    zoneRedundant: fallback.providerParameters.bicep.zoneRedundant,
    evidenceDigest: fallback.providerParameters.bicep.evidenceDigest,
    capacityReservationClaimed:
      fallback.providerParameters.bicep.capacityReservationClaimed,
  },
  Object.fromEntries(
    Object.entries(fallback.providerParameters.terraform).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
      value,
    ]),
  ),
  "Bicep and Terraform planning parameters must be semantically equivalent",
);
assert.equal(
  fallback.decisionDigest,
  postgresqlDecisionDigest(
    Object.fromEntries(
      Object.entries(fallback).filter(([key]) => key !== "decisionDigest"),
    ),
  ),
);

const ranking = structuredClone(base);
ranking.evidence[0] = structuredClone(ranking.evidence[1]);
ranking.evidence[0].region = "westus3";
ranking.evidence[0].preferenceRank = 2;
ranking.evidence[0].estimatedMonthlyCost = 620;
ranking.evidence[0].source.reference = "fixture.postgresql.westus3.valid";
ranking.allowedLocations.push("westus3");
const ranked = planPostgresql(ranking);
assert.deepEqual(
  ranked.candidates.filter((candidate) => candidate.disposition === "eligible")
    .map((candidate) => candidate.region),
  ["centralus", "westus3"],
  "Equal candidates must use region name as a stable final tie-breaker",
);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "sslz-postgresql-plan-"));
const inputPath = join(temporaryDirectory, "input.json");
writeFileSync(inputPath, `${JSON.stringify(base)}\n`);
const before = readdirSync(temporaryDirectory).sort();
const result = spawnSync(
  process.execPath,
  [script, "plan", "--input", inputPath, "--output", "json"],
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(result.status, 1, result.stderr);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);
assert.deepEqual(JSON.parse(result.stdout), fallback);

const source = readFileSync(script, "utf8");
assert.doesNotMatch(source, /node:(?:child_process|http|https)/);
assert.doesNotMatch(
  source,
  /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/,
);
assert.doesNotMatch(
  source,
  /(?:@azure|az\s+(?:account|provider|deployment)|terraform\s+(?:apply|plan)|provider\s+register)/i,
);
assert.doesNotMatch(JSON.stringify(fallback), /token|secret|password|credential/i);

console.log("PostgreSQL regional fallback fixture tests passed.");
