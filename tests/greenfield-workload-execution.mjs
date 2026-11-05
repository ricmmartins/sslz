#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import {
  applyWorkload, createWorkloadPreview, digest, signingMessage, defaultHealthCheck,
  APPROVAL_DOMAIN, IMAGE_DOMAIN,
} from "../scripts/greenfield-workload-execution.mjs";
import { keyFingerprint } from "../scripts/startup-deployment-integration.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";

const now = Date.parse("2026-11-03T22:00:00Z");
const tenantId = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const clientId = "44444444-4444-4444-8444-444444444444";
const principalId = "55555555-5555-4555-8555-555555555555";
const approvalKeys = generateKeyPairSync("ed25519");
const imageKeys = generateKeyPairSync("ed25519");
const pem = key => key.export({ type: "spki", format: "pem" });
const authority = {
  storeId, approvalPublicKey: pem(approvalKeys.publicKey), imagePublicKey: pem(imageKeys.publicKey),
};
const directory = mkdtempSync(join(tmpdir(), "sslz-workload-tests-"));
after(() => rmSync(directory, { recursive: true, force: true }));
let counter = 0;
const freshState = () => mkdtempSync(join(directory, "state-"));
const template = { resources: [{ type: "Microsoft.Resources/resourceGroups", name: "[variables('groupName')]" }] };
const requirements = JSON.parse(readFileSync(new URL("../agent/examples/startup-input.json", import.meta.url), "utf8"));
requirements.workload.requiresRelationalDatabase = false;
requirements.subscriptions.nonprodSubscriptionId = subscriptionId;
const workloadPlan = planWorkload(requirements);
const planning = { requirements, workloadPlan };

function request(overrides = {}) {
  return {
    schemaVersion: "1.0.0", tenantId, subscriptionId, runName: `fixture${++counter}`,
    location: "eastus2", image: `ghcr.io/ricmmartins/sslz-acceptance@sha256:${"a".repeat(64)}`,
    attemptId: randomUUID(), requirementsDigest: digest(requirements),
    planDigest: digest(workloadPlan), expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    maximumCostUsd: 20, maximumActiveHours: 4, ...overrides,
  };
}

function runtime(input, options = {}) {
  const calls = [];
  const groupId = `/subscriptions/${subscriptionId}/resourceGroups/rg-sslz-${input.runName}`;
  const identityId = `${groupId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-${input.runName}`;
  const changes = options.changes ?? [{ changeType: "Create", resourceId: groupId }];
  const result = value => ({ status: 0, stdout: JSON.stringify(value), stderr: "" });
  const runner = args => {
    calls.push([...args]);
    if (args[0] !== "bicep") assert.equal(args[args.indexOf("--subscription") + 1], subscriptionId);
    if (args[0] === "account") return result({
      id: subscriptionId, tenantId: options.wrongTenant ? clientId : tenantId,
      state: "Enabled", environmentName: options.cloud ?? "AzureCloud",
    });
    if (args[0] === "group") return result(options.existingGroup === true);
    if (args[0] === "deployment" && args[2] === "list") return result(options.existingDeployment ? [`sslz-${input.runName}`] : []);
    if (args[0] === "bicep") return result(options.template ?? template);
    if (args[0] === "deployment" && args[2] === "what-if") {
      return result({ status: "Succeeded", changes });
    }
    if (args[0] === "deployment" && args[2] === "create") {
      if (options.deploymentFailure) return { status: 1, stderr: "Authorization: Bearer secret-fixture", stdout: "" };
      return result({ properties: { provisioningState: "Succeeded" } });
    }
    if (args[0] === "containerapp") return result({
      id: `${groupId}/providers/Microsoft.App/containerApps/app-${input.runName}`,
      identity: { type: "UserAssigned", userAssignedIdentities: { [identityId]: {} } },
      properties: {
        provisioningState: "Succeeded",
        managedEnvironmentId: `${groupId}/providers/Microsoft.App/managedEnvironments/env-${input.runName}`,
        configuration: { ingress: { fqdn: options.hostname ?? "app-fixture.example.eastus2.azurecontainerapps.io", targetPort: 8080, allowInsecure: false } },
        template: { containers: [{
          image: options.observedImage ?? input.image,
          env: [
            { name: "AZURE_CLIENT_ID", value: clientId },
            { name: "BLOB_ACCOUNT_URL", value: "https://sslzfixture.blob.core.windows.net/" },
            { name: "BLOB_CONTAINER", value: "acceptance" },
          ],
        }] },
      },
    });
    if (args[0] === "identity") return result({ id: identityId, clientId, principalId });
    if (args[0] === "storage") return result({
      id: `${groupId}/providers/Microsoft.Storage/storageAccounts/sslzfixture`,
      publicNetworkAccess: options.publicStorage ? "Enabled" : "Disabled",
      allowSharedKeyAccess: false, allowBlobPublicAccess: false,
    });
    assert.fail(`Unexpected command ${JSON.stringify(args)}`);
  };
  return { calls, runner };
}

function artifacts(input = request()) {
  const azure = runtime(input);
  const manifest = createWorkloadPreview(input, { runner: azure.runner, now, storeId, ...planning });
  const approval = {
    schemaVersion: "1.0.0", manifestDigest: manifest.manifestDigest, stateStoreId: storeId,
    nonce: randomUUID(), approvedAt: new Date(now - 60000).toISOString(),
    expiresAt: input.expiresAt, keyId: keyFingerprint(authority.approvalPublicKey),
  };
  approval.signature = sign(null, signingMessage(APPROVAL_DOMAIN, approval), approvalKeys.privateKey).toString("base64");
  const provenance = {
    schemaVersion: "1.0.0", image: input.image, applicationSourceDigest: manifest.applicationSourceDigest,
    issuedAt: new Date(now - 60000).toISOString(), expiresAt: input.expiresAt,
    keyId: keyFingerprint(authority.imagePublicKey),
  };
  provenance.signature = sign(null, signingMessage(IMAGE_DOMAIN, provenance), imageKeys.privateKey).toString("base64");
  return { manifest, approval, provenance, input };
}

async function apply(bundle, options = {}) {
  const azure = runtime(bundle.input, options.runtime);
  let healthReads = 0;
  const result = await applyWorkload(bundle.manifest, bundle.approval, bundle.provenance, {
    runner: azure.runner, now, clock: options.clock ?? (() => now), authority: options.authority ?? authority,
    statePath: options.statePath ?? freshState(),
    healthCheck: async url => {
      healthReads++;
      assert.equal(url, "https://app-fixture.example.eastus2.azurecontainerapps.io/readyz");
      if (options.healthError) throw new Error("Authorization: Bearer secret-fixture");
      return { status: options.unhealthy ? "not-ready" : "ready" };
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-fixture|Bearer|fixture@example/);
  return { result, calls: azure.calls, healthReads };
}

test("preview compiles fixed profile and performs no deployment writes", () => {
  const input = request();
  const azure = runtime(input);
  const preview = createWorkloadPreview(input, { runner: azure.runner, now, storeId, ...planning });
  assert.equal(preview.request.image, input.image);
  assert.ok(preview.manifestDigest.startsWith("sha256:"));
  assert.equal(azure.calls.some(args => args[2] === "create"), false);
});

test("requirements and official planner result cannot be replaced with supplied digests", () => {
  const input = request();
  const azure = runtime(input);
  const tampered = { ...workloadPlan, computeProfile: "aks" };
  input.planDigest = digest(tampered);
  assert.throws(() => createWorkloadPreview(input, {
    runner: azure.runner, now, storeId, requirements, workloadPlan: tampered,
  }), /workload.plan.unsupported/);
  assert.equal(azure.calls.length, 0);
  const wrongRequirements = structuredClone(requirements);
  wrongRequirements.subscriptions.nonprodSubscriptionId = tenantId;
  const wrongPlan = planWorkload(wrongRequirements);
  input.requirementsDigest = digest(wrongRequirements);
  input.planDigest = digest(wrongPlan);
  assert.throws(() => createWorkloadPreview(input, {
    runner: azure.runner, now, storeId, requirements: wrongRequirements, workloadPlan: wrongPlan,
  }), /workload.plan.unsupported/);
  assert.equal(azure.calls.length, 0);
});

for (const [label, overrides] of [
  ["mutable image tag", { image: "ghcr.io/ricmmartins/sslz-acceptance:latest" }],
  ["foreign registry", { image: `evil.example/app@sha256:${"a".repeat(64)}` }],
  ["cost over ceiling", { maximumCostUsd: 21 }],
  ["duration over ceiling", { maximumActiveHours: 5 }],
  ["expired request", { expiresAt: new Date(now).toISOString() }],
  ["extra command field", { command: "az group delete" }],
  ["invalid name", { runName: "name;whoami" }],
]) {
  test(`preview rejects ${label} before any Azure call`, () => {
    const input = request(overrides);
    const azure = runtime(input);
    assert.throws(() => createWorkloadPreview(input, { runner: azure.runner, now, storeId, ...planning }), /workload.request/);
    assert.equal(azure.calls.length, 0);
  });
}

for (const [label, options] of [
  ["existing resource group", { existingGroup: true }],
  ["existing subscription deployment", { existingDeployment: true }],
  ["wrong tenant", { wrongTenant: true }],
  ["other Azure cloud", { cloud: "AzureUSGovernment" }],
  ["modification", { changes: [{ changeType: "Modify", resourceId: `/subscriptions/${subscriptionId}/resourceGroups/existing` }] }],
  ["out-of-scope creation", { changes: [{ changeType: "Create", resourceId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/policyAssignments/other` }] }],
]) {
  test(`preview rejects ${label}`, () => {
    const input = request();
    const azure = runtime(input, options);
    assert.throws(() => createWorkloadPreview(input, { runner: azure.runner, now, storeId, ...planning }), /workload./);
    assert.equal(azure.calls.some(args => args[2] === "create"), false);
  });
}

test("signed synthetic journey performs one mocked write and consumes injected readiness", async () => {
  const statePath = freshState();
  const bundle = artifacts();
  const { result, calls, healthReads } = await apply(bundle, { statePath });
  assert.equal(result.status, "succeeded", result.code);
  assert.equal(result.productionReady, false);
  assert.equal(result.cleanupRequired, true);
  assert.equal(result.approvalConsumed, true);
  assert.equal(calls.filter(args => args[2] === "create").length, 1);
  assert.equal(healthReads, 1);
  for (const name of readdirSync(statePath)) assert.doesNotThrow(() => JSON.parse(readFileSync(join(statePath, name), "utf8")));
});

test("manifest tampering is rejected without Azure calls", async () => {
  const bundle = artifacts();
  bundle.manifest.request.location = "westus";
  const { result, calls } = await apply(bundle);
  assert.equal(result.code, "workload.manifest.binding");
  assert.equal(calls.length, 0);
});

test("even resigned arbitrary template is rejected against fixed source compilation", async () => {
  const bundle = artifacts();
  bundle.manifest.template = { resources: [{ type: "Microsoft.Resources/deploymentScripts" }] };
  const { manifestDigest: omitted, ...payload } = bundle.manifest;
  bundle.manifest.manifestDigest = digest(payload);
  bundle.approval.manifestDigest = bundle.manifest.manifestDigest;
  bundle.approval.signature = sign(null, signingMessage(APPROVAL_DOMAIN, bundle.approval), approvalKeys.privateKey).toString("base64");
  const { result, calls } = await apply(bundle);
  assert.equal(result.code, "workload.template.changed");
  assert.equal(calls.some(args => args[2] === "create"), false);
});

for (const mutation of ["signature", "store", "domain", "image-source", "missing-provenance", "same-authority", "private-approval-key", "private-builder-key"]) {
  test(`rejects invalid ${mutation} authority before Azure calls`, async () => {
    const bundle = artifacts();
    let chosenAuthority = authority;
    if (mutation === "signature") bundle.approval.signature = Buffer.alloc(64).toString("base64");
    if (mutation === "store") bundle.approval.stateStoreId = tenantId;
    if (mutation === "domain") bundle.approval.signature = sign(null, signingMessage(IMAGE_DOMAIN, bundle.approval), approvalKeys.privateKey).toString("base64");
    if (mutation === "image-source") bundle.provenance.applicationSourceDigest = `sha256:${"e".repeat(64)}`;
    if (mutation === "missing-provenance") bundle.provenance = null;
    if (mutation === "same-authority") chosenAuthority = { ...authority, imagePublicKey: authority.approvalPublicKey };
    if (mutation === "private-approval-key") chosenAuthority = {
      ...authority, approvalPublicKey: approvalKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
    };
    if (mutation === "private-builder-key") chosenAuthority = {
      ...authority, imagePublicKey: imageKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
    };
    const { result, calls } = await apply(bundle, { authority: chosenAuthority });
    assert.equal(result.status, "blocked");
    assert.equal(result.approvalConsumed, false);
    assert.equal(calls.length, 0);
  });
}

test("approval expiring during preview cannot authorize the subsequent write", async () => {
  const { result, calls } = await apply(artifacts(), { clock: () => now + 2 * 60 * 60 * 1000 });
  assert.equal(result.code, "workload.request.expiry");
  assert.equal(calls.some(args => args[2] === "create"), false);
});

test("changed create-only preview cannot be silently reapproved at apply", async () => {
  const bundle = artifacts();
  const groupId = `/subscriptions/${subscriptionId}/resourceGroups/rg-sslz-${bundle.input.runName}`;
  const { result, calls } = await apply(bundle, {
    runtime: { changes: [
      { changeType: "Create", resourceId: groupId },
      { changeType: "Create", resourceId: `${groupId}/providers/Microsoft.Network/virtualNetworks/unreviewed` },
    ] },
  });
  assert.equal(result.code, "workload.preview.changed");
  assert.equal(calls.some(args => args[2] === "create"), false);
});

for (const [label, runtimeOptions, extra, code] of [
  ["deployment failure", { deploymentFailure: true }, {}, "workload.deployment.failed"],
  ["wrong running image", { observedImage: "other:latest" }, {}, "workload.postcheck.invalid"],
  ["public storage", { publicStorage: true }, {}, "workload.postcheck.storage"],
  ["redirect/invalid health host", { hostname: "attacker.example" }, {}, "workload.postcheck.invalid"],
  ["unhealthy data path", {}, { unhealthy: true }, "workload.health.failed"],
  ["health transport failure", {}, { healthError: true }, "workload.execution.failed"],
]) {
  test(`${label} requires cleanup and cannot replay or reapprove the target`, async () => {
    const statePath = freshState();
    const bundle = artifacts();
    const first = await apply(bundle, { statePath, runtime: runtimeOptions, ...extra });
    assert.equal(first.result.code, code);
    assert.equal(first.result.status, "cleanup-required");
    assert.equal(first.result.attemptedWrites, 1);
    assert.equal(first.result.approvalConsumed, true);
    const replay = await apply(bundle, { statePath });
    assert.equal(replay.result.code, "workload.approval.replayed");
    assert.equal(replay.result.approvalConsumed, true);
    assert.equal(replay.calls.length, 0);
    const reapproval = artifacts(bundle.input);
    const retry = await apply(reapproval, { statePath });
    assert.equal(retry.result.code, "workload.approval.replayed");
    assert.equal(retry.result.approvalConsumed, true);
    assert.equal(retry.calls.length, 0);
  });
}

test("parallel attempts for one target cannot both write", async () => {
  const bundle = artifacts();
  const statePath = freshState();
  const results = await Promise.all([apply(bundle, { statePath }), apply(bundle, { statePath })]);
  assert.equal(results.filter(v => v.result.status === "succeeded").length, 1);
  assert.equal(results.filter(v => v.result.code === "workload.approval.replayed").length, 1);
  assert.equal(results.flatMap(v => v.calls).filter(args => args[2] === "create").length, 1);
});

test("the default HTTP adapter rejects redirects, oversized and invalid responses", async t => {
  let response = new Response('{"status":"ready"}', { headers: { "content-type": "application/json" } });
  let throwTransport = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    if (throwTransport) throw new Error("secret-fixture");
    return response;
  });

  assert.deepEqual(await defaultHealthCheck("https://example.test/readyz"), { status: "ready" });
  for (const invalid of [
    new Response("redirect", { status: 302 }),
    new Response('{"status":"ready"}', { status: 503, headers: { "content-type": "application/json" } }),
    new Response("<html>ready</html>", { headers: { "content-type": "text/html" } }),
    new Response("x".repeat(4097), { headers: { "content-type": "application/json" } }),
    new Response("not JSON", { headers: { "content-type": "application/json" } }),
    new Response(null, { status: 204, headers: { "content-type": "application/json" } }),
  ]) {
    response = invalid;
    await assert.rejects(() => defaultHealthCheck("https://example.test/readyz"), /workload.health.failed/);
  }
  throwTransport = true;
  await assert.rejects(() => defaultHealthCheck("https://example.test/readyz"), /workload.health.failed/);
});

test("CLI cannot override protected keys, replay path or approval checks", () => {
  for (const flag of ["--public-key", "--state-path", "--allow-all", "--skip-approval"]) {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("../scripts/greenfield-workload-execution.mjs", import.meta.url)),
      "apply", flag, "not-authority",
    ], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stderr);
    assert.equal(report.code, "workload.cli.arguments");
    assert.equal(report.attemptedWrites, 0);
  }
});
