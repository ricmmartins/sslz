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
  CONTROL_PLANE_CAPABILITIES,
  CONTROL_PLANE_OWNERSHIP_CHECK_ORDER,
  OWNERSHIP_STATE_ORDER,
  controlPlaneOwnershipDigest,
  planControlPlaneOwnership,
} from "../scripts/startup-control-plane-ownership-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";
import {
  createControlPlaneOwnershipFixture,
  finalizeIntegrity,
} from "./control-plane-ownership-fixture.mjs";

const root = resolve(".");
const outputSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/control-plane-ownership-plan.schema.json"),
    "utf8",
  ),
);
const scenarios = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/fixtures/control-plane-ownership-planner/scenarios.json",
    ),
    "utf8",
  ),
);

function setPath(value, path, replacement) {
  const parts = path.split(".");
  const property = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[property] = structuredClone(replacement);
}

function refreshHandoffDigest(input, transitionIndex, handoffIndex) {
  const transition = input.transitions[transitionIndex];
  const handoff = transition.handoffs[handoffIndex];
  handoff.evidenceDigest = controlPlaneOwnershipDigest({
    reference: handoff.reference,
    capabilityId: handoff.capabilityId,
    fromState: transition.fromState,
    toState: transition.toState,
    offeredBy: handoff.offeredBy,
    acceptedBy: handoff.acceptedBy,
    approvalAuthority: handoff.approvalAuthority,
    observedAt: handoff.observedAt,
    expiresAt: handoff.expiresAt,
    nonce: handoff.nonce,
  });
}

for (const provider of ["aws", "gcp", "generic"]) {
  const fixture = createControlPlaneOwnershipFixture(provider);
  const first = planControlPlaneOwnership(fixture.input, {
    trustedBindings: fixture.trustedBindings,
  });
  const second = planControlPlaneOwnership(structuredClone(fixture.input), {
    trustedBindings: structuredClone(fixture.trustedBindings),
  });
  assert.deepEqual(first, second, `${provider}: output must be deterministic`);
  validateDocument(outputSchema, first);
  assert.equal(first.status, "ready-for-human-review");
  assert(first.checks.every(({ classification }) => classification === "pass"));
  assert.deepEqual(
    first.authorityMatrix.map(({ state }) => state),
    OWNERSHIP_STATE_ORDER,
  );
  assert.deepEqual(
    first.authorityMatrix[0].assignments.map(({ capabilityId }) => capabilityId),
    CONTROL_PLANE_CAPABILITIES,
  );
  assert(first.plannedActions.every(({ executionAllowed }) => !executionAllowed));
  assert.equal(first.safety.executionEnabled, false);
  assert.equal(first.safety.executionEligible, false);
  assert.equal(first.safety.executionAllowed, false);
  assert.equal(first.safety.liveOperations, "disabled");
  assert.equal(first.safety.generatedCommands, "none");
}

const covered = new Set();
for (const scenario of scenarios) {
  const fixture = createControlPlaneOwnershipFixture("aws");
  for (const [path, replacement] of scenario.mutations ?? []) {
    setPath(fixture.input, path, replacement);
  }
  if (scenario.copyHandoffNonce) {
    const [[targetTransition, targetHandoff], [sourceTransition, sourceHandoff]] =
      scenario.copyHandoffNonce;
    fixture.input.transitions[targetTransition].handoffs[targetHandoff].nonce =
      fixture.input.transitions[sourceTransition].handoffs[sourceHandoff].nonce;
  }
  if (scenario.refreshHandoffDigest) {
    refreshHandoffDigest(fixture.input, ...scenario.refreshHandoffDigest);
  }
  if (scenario.refreshIntegrity) finalizeIntegrity(fixture.input);
  const plan = planControlPlaneOwnership(fixture.input, {
    trustedBindings: fixture.trustedBindings,
  });
  assert.equal(plan.status, "blocked", scenario.name);
  validateDocument(outputSchema, plan);
  for (const checkId of scenario.expectedChecks) {
    covered.add(checkId);
    assert.equal(
      plan.checks.find(({ id }) => id === checkId)?.classification,
      "fail",
      `${scenario.name}: ${checkId} must fail`,
    );
  }
}

assert.deepEqual(
  [...covered].sort(),
  [...CONTROL_PLANE_OWNERSHIP_CHECK_ORDER].sort(),
  "Every ownership check must have a fail-closed synthetic scenario",
);

const fixture = createControlPlaneOwnershipFixture("aws");
const substitutedBindings = structuredClone(fixture.trustedBindings);
substitutedBindings.connectivityPlanDigest =
  `sha256:${"f".repeat(64)}`;
const substitution = planControlPlaneOwnership(fixture.input, {
  trustedBindings: substitutedBindings,
});
assert.equal(substitution.status, "blocked");
assert.equal(
  substitution.checks.find(
    ({ id }) => id === "control.ownership.artifacts-bound",
  ).classification,
  "fail",
);

const scriptSource = readFileSync(
  resolve(root, "scripts/startup-control-plane-ownership-plan.mjs"),
  "utf8",
);
assert.doesNotMatch(scriptSource, /node:(?:child_process|http|https|net|tls)/);
assert.doesNotMatch(
  scriptSource,
  /\b(?:writeFile|appendFile|mkdir|rmSync|unlink|rename|copyFile|fetch)\w*\s*\(/,
);

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "sslz-control-plane-ownership-"),
);
const inputPath = join(temporaryDirectory, "input.json");
const bindingsPath = join(temporaryDirectory, "trusted-bindings.json");
writeFileSync(inputPath, `${JSON.stringify(fixture.input)}\n`);
writeFileSync(bindingsPath, `${JSON.stringify(fixture.trustedBindings)}\n`);
const before = readdirSync(temporaryDirectory).sort();
const cli = spawnSync(
  process.execPath,
  [
    resolve(root, "scripts/startup-control-plane-ownership-plan.mjs"),
    "plan",
    "--input",
    inputPath,
    "--trusted-bindings",
    bindingsPath,
    "--output",
    "json",
  ],
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);
assert.deepEqual(
  JSON.parse(cli.stdout),
  planControlPlaneOwnership(fixture.input, {
    trustedBindings: fixture.trustedBindings,
  }),
);

for (const forbidden of [
  /@[a-z0-9.-]+\.[a-z]{2,}/i,
  /\/subscriptions\//i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\b(?:az|terraform|kubectl|docker|psql|curl)\s+/i,
]) {
  assert.doesNotMatch(cli.stdout, forbidden);
}

console.log(
  `Control-plane ownership planning passed for AWS, GCP, generic, and ${scenarios.length} fail-closed scenarios.`,
);
