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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/startup-workload-plan.mjs");
const fixtureDirectory = resolve(root, "tests/fixtures/workload-planner");
const inputSchema = JSON.parse(
  readFileSync(resolve(root, "agent/schemas/startup-input.schema.json"), "utf8"),
);
const planSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/workload-profile-plan.schema.json"),
    "utf8",
  ),
);
const catalog = JSON.parse(
  readFileSync(resolve(root, "agent/checks/check-catalog.json"), "utf8"),
);
const baseInput = JSON.parse(
  readFileSync(resolve(root, "agent/examples/startup-input.json"), "utf8"),
);
const examplePlan = JSON.parse(
  readFileSync(resolve(root, "agent/examples/workload-profile-plan.json"), "utf8"),
);
const catalogIds = new Set(catalog.checks.map((check) => check.id));

function merge(base, overrides) {
  if (
    !base ||
    !overrides ||
    typeof base !== "object" ||
    typeof overrides !== "object" ||
    Array.isArray(base) ||
    Array.isArray(overrides)
  ) {
    return structuredClone(overrides);
  }

  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    result[key] =
      key in result && value && typeof value === "object" && !Array.isArray(value)
        ? merge(result[key], value)
        : structuredClone(value);
  }
  return result;
}

function assertRationale(plan) {
  const nondefaultDecisions = [
    ...(plan.computeProfile === "aks" ? ["aks"] : []),
    ...plan.profileExtensions,
  ];
  for (const decision of nondefaultDecisions) {
    const entry = plan.rationale.find((item) => item.decision === decision);
    assert(entry, `Missing rationale for nondefault decision: ${decision}`);
    assert(entry.reason.length > 0);
    assert(entry.sourceRequirements.length > 0);
  }
}

assert.deepEqual(
  planWorkload(baseInput),
  examplePlan,
  "The checked-in workload plan example must match planner output",
);

const fixtureFiles = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const fixtureFile of fixtureFiles) {
  const fixture = JSON.parse(
    readFileSync(resolve(fixtureDirectory, fixtureFile), "utf8"),
  );
  const input = merge(baseInput, fixture.overrides);
  validateDocument(inputSchema, input);

  const first = planWorkload(input);
  const second = planWorkload(structuredClone(input));
  assert.deepEqual(second, first, `${fixture.name}: output must be deterministic`);
  validateDocument(planSchema, first);
  assert.equal(first.profileVersion, "1.0.0");
  assert.equal(first.status, fixture.expected.status, fixture.name);
  assert.equal(first.computeProfile, fixture.expected.computeProfile, fixture.name);
  assert.deepEqual(
    first.profileExtensions,
    fixture.expected.profileExtensions,
    fixture.name,
  );
  assert.equal(first.iacGenerated, false);
  assert.equal(first.azureOperations, "none");
  assertRationale(first);

  for (const checkId of first.requiredChecks) {
    assert(catalogIds.has(checkId), `${fixture.name}: unknown check ${checkId}`);
  }
  if (fixture.expected.blockingDecision) {
    assert(
      first.unresolvedDecisions.some(
        (decision) =>
          decision.id === fixture.expected.blockingDecision &&
          decision.severity === "blocking",
      ),
      `${fixture.name}: missing blocking decision`,
    );
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "sslz-workload-plan-"));
  const inputPath = join(temporaryDirectory, "input.json");
  writeFileSync(inputPath, `${JSON.stringify(input)}\n`);
  const before = readdirSync(temporaryDirectory).sort();
  const result = spawnSync(
    process.execPath,
    [script, "plan", "--input", inputPath, "--output", "json"],
    {
      cwd: temporaryDirectory,
      encoding: "utf8",
    },
  );
  const after = readdirSync(temporaryDirectory).sort();

  assert.deepEqual(after, before, `${fixture.name}: planner wrote a file`);
  assert.equal(
    result.status,
    first.status === "ready" ? 0 : 1,
    `${fixture.name}: unexpected exit status\n${result.stderr}`,
  );
  assert.deepEqual(JSON.parse(result.stdout), first, fixture.name);
}

for (const requirement of [
  "kubernetes-api",
  "operator",
  "specialized-networking",
  "custom-scheduler",
  "service-mesh",
  "ecosystem-component",
]) {
  const plan = planWorkload(
    merge(baseInput, {
      workload: {
        requiresKubernetes: false,
        kubernetesRequirements: [requirement],
        incidentOwnerConfirmed: true,
      },
    }),
  );
  assert.equal(plan.computeProfile, "aks", requirement);
}

const customerManagedGpu = planWorkload(
  merge(baseInput, {
    workload: {
      requiresCustomerManagedGpu: true,
      managedModelFit: "no",
      incidentOwnerConfirmed: true,
    },
  }),
);
assert.equal(customerManagedGpu.computeProfile, "aks");
assert(customerManagedGpu.profileExtensions.includes("gpu"));

const unknownManagedModelFit = planWorkload(
  merge(baseInput, {
    workload: {
      requiresCustomerManagedGpu: true,
      managedModelFit: "unknown",
      incidentOwnerConfirmed: true,
    },
  }),
);
assert.equal(unknownManagedModelFit.status, "blocked");
assert(
  unknownManagedModelFit.unresolvedDecisions.some(
    (decision) => decision.id === "workload.managed-model-fit.required",
  ),
);

const source = readFileSync(script, "utf8");
assert.doesNotMatch(source, /node:(?:child_process|http|https)/);
assert.doesNotMatch(
  source,
  /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/,
);
assert.doesNotMatch(source, /(?:@azure|az\s+(?:account|provider|deployment|aks))/i);

console.log("Startup workload planner fixture tests passed.");
