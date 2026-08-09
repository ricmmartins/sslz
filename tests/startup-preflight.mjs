#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/startup-preflight.mjs");
const mockAz = resolve(root, "tests/mock-az.mjs");
const prod = "22222222-2222-2222-2222-222222222222";
const nonprod = "33333333-3333-3333-3333-333333333333";
const preflightSchema = JSON.parse(
  readFileSync(resolve(root, "agent/schemas/preflight-result.schema.json"), "utf8"),
);

function run(fixture) {
  const trace = join(mkdtempSync(join(tmpdir(), "sslz-preflight-")), "az.trace");
  const result = spawnSync(
    process.execPath,
    [
      script,
      "inspect",
      "--prod-subscription",
      prod,
      "--nonprod-subscription",
      nonprod,
      "--output",
      "json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        AZURE_CLI_PATH: process.execPath,
        AZURE_CLI_PREFIX_ARGS: JSON.stringify([mockAz]),
        AZ_FIXTURE: fixture,
        AZ_TRACE_FILE: trace,
        PREFLIGHT_RUN_ID: "test-run",
        PREFLIGHT_GENERATED_AT: "2026-08-07T12:00:00.000Z",
      },
    },
  );
  return {
    ...result,
    json: result.stdout ? JSON.parse(result.stdout) : null,
    trace: readFileSync(trace, "utf8"),
  };
}

const success = run("az-success.json");
assert.equal(success.status, 1);
assert.equal(success.json.overallStatus, "blocked");
assert.equal(
  success.json.checks.find((check) => check.id === "billing.subscription.credit-association").status,
  "unknown",
);

const tenantMismatch = run("az-tenant-mismatch.json");
assert.equal(tenantMismatch.status, 1);
assert.equal(
  tenantMismatch.json.checks.find((check) => check.id === "account.subscription.tenant-match").status,
  "fail",
);

const denied = run("az-permission-denied.json");
assert.equal(denied.status, 1);
assert.equal(
  denied.json.checks.find((check) => check.id === "identity.deployment-role.sufficient").status,
  "unknown",
);
assert.doesNotMatch(denied.stdout, /fixture-secret|founder@startup\.example/);

const missingProvider = run("az-missing-provider.json");
assert.equal(missingProvider.status, 1);
assert.equal(
  missingProvider.json.checks.find((check) => check.id === "account.provider.required-registrations").status,
  "fail",
);
assert.equal(missingProvider.json.summary.actions.azureWrite, 1);

const throttled = run("az-throttled.json");
assert.equal(
  throttled.json.checks.find((check) => check.id === "region.services.available").error.class,
  "transient",
);

const billingUnavailable = run("az-billing-unavailable.json");
assert.equal(
  billingUnavailable.json.checks.find((check) => check.id === "billing.startup-credit.context-visible").status,
  "unknown",
);

const subscriptionMismatch = run("az-subscription-mismatch.json");
assert.equal(subscriptionMismatch.status, 1);
assert.equal(
  subscriptionMismatch.json.checks.find(
    (check) => check.id === "account.subscription.explicit-selection",
  ).status,
  "fail",
);

const invalidSubscription = spawnSync(
  process.execPath,
  [
    script,
    "inspect",
    "--prod-subscription",
    "not-a-subscription;provider register",
    "--nonprod-subscription",
    nonprod,
    "--output",
    "json",
  ],
  { encoding: "utf8" },
);
assert.equal(invalidSubscription.status, 2);
assert.match(invalidSubscription.stderr, /canonical UUIDs/);

for (const result of [
  success,
  tenantMismatch,
  denied,
  missingProvider,
  throttled,
  billingUnavailable,
  subscriptionMismatch,
]) {
  validateDocument(preflightSchema, result.json);
  assert.doesNotMatch(
    result.trace,
    /\b(create|delete|register|unregister|update|set|assign|remove|apply|deploy)\b/i,
  );
}

const source = readFileSync(script, "utf8");
assert.doesNotMatch(
  source,
  /\bazJson\(\[[^\]]*"(create|delete|register|unregister|update|set|assign|remove|apply|deploy)"/s,
);

const startupInputSchema = JSON.parse(
  readFileSync(resolve(root, "agent/schemas/startup-input.schema.json"), "utf8"),
);
const startupInput = JSON.parse(
  readFileSync(resolve(root, "agent/examples/startup-input.json"), "utf8"),
);
assert.throws(
  () =>
    validateDocument(startupInputSchema, {
      ...startupInput,
      company: { ...startupInput.company, engineeringTeamSize: 51 },
    }),
  /maximum value is 50/,
);

execFileSync(process.execPath, [resolve(root, "scripts/validate-agent-contracts.mjs")], {
  stdio: "inherit",
});
console.log("Startup preflight fixture tests passed.");
