#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, closeSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync,
  readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { azureCliInvocation, sanitizedAzureCliEnvironment } from "./azure-cli-invocation.mjs";
import { canonicalJson } from "./startup-iac-plan.mjs";
import { planWorkload } from "./startup-workload-plan.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";
import {
  keyFingerprint, readTrustedPublicKey, requireDurableStateStore,
} from "./startup-deployment-integration.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = "examples/greenfield-acceptance";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IMAGE = /^ghcr\.io\/ricmmartins\/sslz-acceptance@sha256:[0-9a-f]{64}$/;
const APPROVAL_DOMAIN = "sslz-greenfield-workload-approval-v1";
const IMAGE_DOMAIN = "sslz-greenfield-image-provenance-v1";
const sourceFiles = ["main.bicep", "workload.bicep"];
const requestSchema = JSON.parse(readFileSync(resolve(root, "agent/schemas/greenfield-workload-request.schema.json"), "utf8"));

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function exact(value, fields, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) fail(code);
}

function sourceDigest() {
  return digest(Object.fromEntries(sourceFiles.map(name => [
    name, readFileSync(resolve(root, profilePath, name), "utf8").replace(/\r\n/g, "\n"),
  ])));
}

function validateRequest(request, now) {
  try { validateDocument(requestSchema, request); }
  catch { fail("workload.request.invalid"); }
  exact(request, [
    "schemaVersion", "tenantId", "subscriptionId", "runName", "location", "image",
    "attemptId", "requirementsDigest", "planDigest", "expiresAt", "maximumCostUsd", "maximumActiveHours",
  ], "workload.request.shape");
  if (request.schemaVersion !== "1.0.0" ||
      ![request.tenantId, request.subscriptionId, request.attemptId].every(v => typeof v === "string" && UUID.test(v)) ||
      !/^[a-z][a-z0-9]{5,15}$/.test(request.runName) ||
      !/^[a-z][a-z0-9]{2,30}$/.test(request.location) ||
      !IMAGE.test(request.image) ||
      ![request.requirementsDigest, request.planDigest].every(v => typeof v === "string" && DIGEST.test(v)) ||
      !Number.isFinite(request.maximumCostUsd) || request.maximumCostUsd <= 0 || request.maximumCostUsd > 20 ||
      !Number.isFinite(request.maximumActiveHours) || request.maximumActiveHours <= 0 || request.maximumActiveHours > 4) {
    fail("workload.request.invalid");
  }
  const expiry = Date.parse(request.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry - now > 4 * 60 * 60 * 1000) fail("workload.request.expiry");
}

function validatePlanning(request, requirements, workloadPlan) {
  let actual;
  try { actual = planWorkload(requirements); }
  catch { fail("workload.requirements.invalid"); }
  if (digest(requirements) !== request.requirementsDigest ||
      digest(workloadPlan) !== request.planDigest || digest(actual) !== digest(workloadPlan) ||
      actual.status !== "ready" || actual.computeProfile !== "container-apps" ||
      actual.profileExtensions.length !== 0 ||
      requirements.reliability.regionalMode !== "single-region-ready" ||
      requirements.subscriptions.nonprodSubscriptionId !== request.subscriptionId) {
    fail("workload.plan.unsupported");
  }
}

function defaultRunner(args) {
  const invocation = azureCliInvocation(args);
  return spawnSync(invocation.executable, invocation.arguments, {
    env: sanitizedAzureCliEnvironment(), encoding: "utf8", shell: false,
    windowsHide: true, timeout: 45 * 60 * 1000, maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function jsonCall(runner, args, code) {
  const response = runner(args);
  if (response.error || response.status !== 0 || typeof response.stdout !== "string") fail(code);
  try { return JSON.parse(response.stdout); } catch { fail(code); }
}

function readArgs(request, args) {
  return [...args, "--subscription", request.subscriptionId, "--output", "json"];
}

function assertTarget(request, runner) {
  const account = jsonCall(runner, readArgs(request, ["account", "show"]), "workload.target.read");
  if (account.id?.toLowerCase() !== request.subscriptionId ||
      account.tenantId?.toLowerCase() !== request.tenantId ||
      account.state !== "Enabled" || account.environmentName !== "AzureCloud") fail("workload.target.mismatch");
  for (const name of [`rg-sslz-${request.runName}`, `ME_sslz_${request.runName}`]) {
    if (jsonCall(runner, readArgs(request, ["group", "exists", "--name", name]), "workload.inventory.read") !== false) {
      fail("workload.inventory.existing-group");
    }
    const deployments = jsonCall(runner, readArgs(request, [
      "deployment", "sub", "list", "--query", `[?name=='sslz-${request.runName}'].name`,
    ]), "workload.inventory.deployment-read");
    if (!Array.isArray(deployments) || deployments.length !== 0) fail("workload.inventory.existing-deployment");
  }
}

function parameters(request) {
  return {
    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: Object.fromEntries(["runName", "location", "image", "attemptId"].map(name => [name, { value: request[name] }])),
  };
}

function snapshot(template, parameterValues) {
  const directory = mkdtempSync(join(tmpdir(), "sslz-workload-"));
  chmodSync(directory, 0o700);
  const templatePath = join(directory, "main.json");
  const parameterPath = join(directory, "parameters.json");
  writeFileSync(templatePath, JSON.stringify(template), { mode: 0o400, flag: "wx" });
  writeFileSync(parameterPath, JSON.stringify(parameterValues), { mode: 0o400, flag: "wx" });
  return { directory, templatePath, parameterPath };
}

function deploymentArgs(mode, request, files) {
  return readArgs(request, [
    "deployment", "sub", mode, "--name", `sslz-${request.runName}`,
    "--location", request.location, "--template-file", files.templatePath,
    "--parameters", files.parameterPath,
    ...(mode === "what-if" ? ["--result-format", "FullResourcePayloads", "--no-pretty-print"] : []),
  ]);
}

function validateChanges(preview, request) {
  if (!preview || !Array.isArray(preview.changes) || preview.changes.length === 0 ||
      preview.status !== "Succeeded") fail("workload.preview.invalid");
  const groupId = `/subscriptions/${request.subscriptionId}/resourceGroups/rg-sslz-${request.runName}`.toLowerCase();
  for (const change of preview.changes) {
    const id = typeof change.resourceId === "string" ? change.resourceId.toLowerCase() : "";
    if (change.changeType !== "Create" || (id !== groupId && !id.startsWith(`${groupId}/`))) {
      fail("workload.preview.non-create");
    }
  }
  if (!preview.changes.some(change => change.resourceId?.toLowerCase() === groupId)) {
    fail("workload.preview.group-missing");
  }
}

function manifestPayload(manifest) {
  const { manifestDigest: omitted, ...payload } = manifest;
  return payload;
}

function signingMessage(domain, artifact) {
  const { signature: omitted, ...payload } = artifact;
  return Buffer.from(`${domain}\0${canonicalJson(payload)}`, "utf8");
}

function assertSignature(artifact, publicKey, domain, code) {
  try {
    if (typeof publicKey !== "string" || publicKey.includes("PRIVATE KEY")) fail(code);
    const key = createPublicKey(publicKey);
    if (key.asymmetricKeyType !== "ed25519" || artifact.keyId !== keyFingerprint(publicKey) ||
        typeof artifact.signature !== "string") fail(code);
    const signature = Buffer.from(artifact.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== artifact.signature ||
        !verify(null, signingMessage(domain, artifact), key, signature)) fail(code);
  } catch { fail(code); }
}

function validateAuthority(manifest, approval, provenance, authority, now) {
  exact(approval, ["schemaVersion", "manifestDigest", "stateStoreId", "nonce", "approvedAt", "expiresAt", "keyId", "signature"], "workload.approval.shape");
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (approval.schemaVersion !== "1.0.0" || approval.manifestDigest !== manifest.manifestDigest ||
      approval.stateStoreId !== authority.storeId || !UUID.test(approval.nonce) ||
      !Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) ||
      approvedAt > now || expiresAt <= now || expiresAt <= approvedAt ||
      expiresAt - approvedAt > 4 * 60 * 60 * 1000 || expiresAt > Date.parse(manifest.request.expiresAt)) {
    fail("workload.approval.binding");
  }
  assertSignature(approval, authority.approvalPublicKey, APPROVAL_DOMAIN, "workload.approval.signature");
  exact(provenance, ["schemaVersion", "image", "applicationSourceDigest", "issuedAt", "expiresAt", "keyId", "signature"], "workload.image-provenance.shape");
  const issuedAt = Date.parse(provenance.issuedAt);
  const imageExpiry = Date.parse(provenance.expiresAt);
  if (provenance.schemaVersion !== "1.0.0" || provenance.image !== manifest.request.image ||
      provenance.applicationSourceDigest !== manifest.applicationSourceDigest ||
      !Number.isFinite(issuedAt) || issuedAt > now || !Number.isFinite(imageExpiry) || imageExpiry <= now ||
      imageExpiry <= issuedAt || imageExpiry - issuedAt > 24 * 60 * 60 * 1000 ||
      keyFingerprint(authority.imagePublicKey) === keyFingerprint(authority.approvalPublicKey)) {
    fail("workload.image-provenance.binding");
  }
  assertSignature(provenance, authority.imagePublicKey, IMAGE_DOMAIN, "workload.image-provenance.signature");
}

function validateManifest(manifest, now) {
  exact(manifest, [
    "schemaVersion", "profile", "request", "sourceDigest", "applicationSourceDigest",
    "template", "parameters", "preview", "createdAt", "stateStoreId", "manifestDigest",
    "requirements", "workloadPlan",
  ], "workload.manifest.shape");
  validateRequest(manifest.request, now);
  validatePlanning(manifest.request, manifest.requirements, manifest.workloadPlan);
  if (manifest.schemaVersion !== "1.0.0" || manifest.profile !== "container-apps-private-blob-v1" ||
      manifest.sourceDigest !== sourceDigest() || !DIGEST.test(manifest.applicationSourceDigest) ||
      !DIGEST.test(manifest.manifestDigest) || !UUID.test(manifest.stateStoreId) ||
      !Number.isFinite(Date.parse(manifest.createdAt)) || Date.parse(manifest.createdAt) > now ||
      manifest.manifestDigest !== digest(manifestPayload(manifest)) ||
      canonicalJson(manifest.parameters) !== canonicalJson(parameters(manifest.request))) fail("workload.manifest.binding");
  validateChanges(manifest.preview, manifest.request);
}

function applicationSourceDigest() {
  const appRoot = resolve(root, profilePath, "app");
  function sources(directory) {
    if (lstatSync(resolve(appRoot, directory)).isSymbolicLink()) fail("workload.source.symlink");
    return readdirSync(resolve(appRoot, directory), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap(entry => {
        const path = `${directory}/${entry.name}`;
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) fail("workload.source.symlink");
        return entry.isDirectory() ? sources(path) : [path];
      });
  }
  const files = ["Dockerfile", ".dockerignore", "package.json", "package-lock.json", ...sources("src")];
  return digest(Object.fromEntries(files.map(name => {
    const path = resolve(appRoot, name);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) fail("workload.source.symlink");
    return [name, readFileSync(path, "utf8").replace(/\r\n/g, "\n")];
  })));
}

function createWorkloadPreview(request, {
  runner = defaultRunner, now = Date.now(), storeId, requirements, workloadPlan,
} = {}) {
  validateRequest(request, now);
  validatePlanning(request, requirements, workloadPlan);
  if (!UUID.test(storeId)) fail("workload.state.binding");
  assertTarget(request, runner);
  const source = sourceDigest();
  const template = jsonCall(runner, [
    "bicep", "build", "--file", resolve(root, profilePath, "main.bicep"), "--stdout",
  ], "workload.template.compile");
  if (source !== sourceDigest()) fail("workload.source.changed");
  const parameterValues = parameters(request);
  const files = snapshot(template, parameterValues);
  try {
    const preview = jsonCall(runner, deploymentArgs("what-if", request, files), "workload.preview.failed");
    validateChanges(preview, request);
    const manifest = {
      schemaVersion: "1.0.0", profile: "container-apps-private-blob-v1",
      requirements, workloadPlan,
      request, sourceDigest: source, applicationSourceDigest: applicationSourceDigest(),
      template, parameters: parameterValues, preview, createdAt: new Date(now).toISOString(),
      stateStoreId: storeId,
    };
    return { ...manifest, manifestDigest: digest(manifest) };
  } finally { rmSync(files.directory, { recursive: true, force: true }); }
}

function syncStateDirectory(statePath) {
  if (process.platform === "win32") return;
  const descriptor = openSync(statePath, "r");
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function reserve(manifest, approval, statePath, consumption) {
  const keys = [
    `workload-nonce-${digest({ keyId: approval.keyId, nonce: approval.nonce, storeId: approval.stateStoreId }).slice(7)}`,
    `workload-target-${digest({ subscriptionId: manifest.request.subscriptionId, runName: manifest.request.runName }).slice(7)}`,
  ];
  const records = [];
  try {
    for (const key of keys) {
      const path = resolve(statePath, `${key}.json`);
      const descriptor = openSync(path, "wx", 0o600);
      consumption.approvalConsumed = true;
      try {
        writeFileSync(descriptor, JSON.stringify({
          schemaVersion: "1.0.0", status: "reserved", manifestDigest: manifest.manifestDigest,
          attemptId: manifest.request.attemptId, code: "workload.reserved",
        }));
        fsyncSync(descriptor);
      } finally { closeSync(descriptor); }
      records.push(path);
    }
    syncStateDirectory(statePath);
  } catch (error) {
    if (error.code === "EEXIST") {
      consumption.approvalConsumed = true;
      fail("workload.approval.replayed");
    }
    fail("workload.state.write");
  }
  return {
    complete(code, status) {
      for (const path of records) {
        const descriptor = openSync(`${path}.result`, "wx", 0o600);
        try {
          writeFileSync(descriptor, JSON.stringify({ manifestDigest: manifest.manifestDigest, code, status }));
          fsyncSync(descriptor);
        } finally { closeSync(descriptor); }
      }
      syncStateDirectory(statePath);
    },
  };
}

async function defaultHealthCheck(url) {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("application/json")) fail("workload.health.failed");
    const reader = response.body.getReader();
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += Buffer.from(chunk.value).toString("utf8");
        if (Buffer.byteLength(text) > 4096) fail("workload.health.failed");
      }
    } finally { await reader.cancel(); }
    return JSON.parse(text);
  } catch { fail("workload.health.failed"); }
}

async function applyWorkload(manifest, approval, provenance, {
  runner = defaultRunner, now = Date.now(), authority, statePath,
  healthCheck = defaultHealthCheck, clock = () => Date.now(),
} = {}) {
  let reservation;
  let files;
  let attemptedWrites = 0;
  let code = "workload.input.invalid";
  let status = "blocked";
  const consumption = { approvalConsumed: false };
  try {
    validateManifest(manifest, now);
    if (manifest.applicationSourceDigest !== applicationSourceDigest() ||
        manifest.stateStoreId !== authority.storeId) fail("workload.source.changed");
    validateAuthority(manifest, approval, provenance, authority, now);
    reservation = reserve(manifest, approval, statePath, consumption);
    assertTarget(manifest.request, runner);
    // Recompile before accepting the signed snapshot; no caller-supplied template can replace this profile.
    const compiled = jsonCall(runner, [
      "bicep", "build", "--file", resolve(root, profilePath, "main.bicep"), "--stdout",
    ], "workload.template.compile");
    if (digest(compiled) !== digest(manifest.template) || sourceDigest() !== manifest.sourceDigest) fail("workload.template.changed");
    files = snapshot(manifest.template, manifest.parameters);
    const preview = jsonCall(runner, deploymentArgs("what-if", manifest.request, files), "workload.preview.failed");
    validateChanges(preview, manifest.request);
    if (digest(preview.changes) !== digest(manifest.preview.changes)) fail("workload.preview.changed");
    assertTarget(manifest.request, runner);
    validateRequest(manifest.request, clock());
    validateAuthority(manifest, approval, provenance, authority, clock());
    attemptedWrites = 1;
    const deployment = jsonCall(runner, deploymentArgs("create", manifest.request, files), "workload.deployment.failed");
    if (deployment.properties?.provisioningState !== "Succeeded") fail("workload.deployment.failed");
    const app = jsonCall(runner, readArgs(manifest.request, [
      "containerapp", "show", "--resource-group", `rg-sslz-${manifest.request.runName}`,
      "--name", `app-${manifest.request.runName}`,
    ]), "workload.postcheck.read");
    const hostname = app.properties?.configuration?.ingress?.fqdn;
    const containers = app.properties?.template?.containers;
    const resourceGroupId = `/subscriptions/${manifest.request.subscriptionId}/resourceGroups/rg-sslz-${manifest.request.runName}`;
    const identityId = `${resourceGroupId}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-${manifest.request.runName}`;
    if (app.properties?.provisioningState !== "Succeeded" ||
        !Array.isArray(containers) || containers.length !== 1 || containers[0].image !== manifest.request.image ||
        app.id?.toLowerCase() !== `${resourceGroupId}/providers/Microsoft.App/containerApps/app-${manifest.request.runName}`.toLowerCase() ||
        app.identity?.type !== "UserAssigned" ||
        canonicalJson(Object.keys(app.identity.userAssignedIdentities ?? {}).map(v => v.toLowerCase())) !== canonicalJson([identityId.toLowerCase()]) ||
        app.properties.managedEnvironmentId?.toLowerCase() !== `${resourceGroupId}/providers/Microsoft.App/managedEnvironments/env-${manifest.request.runName}`.toLowerCase() ||
        app.properties.configuration.ingress.allowInsecure !== false ||
        app.properties.configuration.ingress.targetPort !== 8080 ||
        typeof hostname !== "string" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.azurecontainerapps\.io$/.test(hostname)) {
      fail("workload.postcheck.invalid");
    }
    const identity = jsonCall(runner, readArgs(manifest.request, [
      "identity", "show", "--resource-group", `rg-sslz-${manifest.request.runName}`, "--name", `id-${manifest.request.runName}`,
    ]), "workload.postcheck.identity-read");
    const env = containers[0].env;
    if (!Array.isArray(env) || env.length !== 3 || new Set(env.map(v => v.name)).size !== 3 ||
        env.some(v => typeof v.value !== "string" || v.secretRef !== undefined)) fail("workload.postcheck.environment");
    const values = Object.fromEntries(env.map(v => [v.name, v.value]));
    const storageMatch = /^https:\/\/([a-z0-9]{3,24})\.blob\.core\.windows\.net\/?$/.exec(values.BLOB_ACCOUNT_URL ?? "");
    if (!UUID.test(identity.clientId) || !UUID.test(identity.principalId) ||
        identity.id?.toLowerCase() !== identityId.toLowerCase() ||
        identity.clientId !== values.AZURE_CLIENT_ID || values.BLOB_CONTAINER !== "acceptance" || !storageMatch) {
      fail("workload.postcheck.environment");
    }
    const storage = jsonCall(runner, readArgs(manifest.request, [
      "storage", "account", "show", "--resource-group", `rg-sslz-${manifest.request.runName}`, "--name", storageMatch[1],
    ]), "workload.postcheck.storage-read");
    if (storage.id?.toLowerCase() !== `${resourceGroupId}/providers/Microsoft.Storage/storageAccounts/${storageMatch[1]}`.toLowerCase() ||
        storage.publicNetworkAccess !== "Disabled" || storage.allowSharedKeyAccess !== false || storage.allowBlobPublicAccess !== false) {
      fail("workload.postcheck.storage");
    }
    const health = await healthCheck(`https://${hostname}/readyz`);
    if (health?.status !== "ready") fail("workload.health.failed");
    status = "succeeded";
    code = "workload.acceptance.healthy";
  } catch (error) {
    status = attemptedWrites ? "cleanup-required" : "blocked";
    code = error.code?.startsWith("workload.") ? error.code : "workload.execution.failed";
  } finally {
    try { reservation?.complete(code, status); }
    catch { status = "blocked"; code = "workload.state.finalize"; }
    if (files) rmSync(files.directory, { recursive: true, force: true });
  }
  return {
    schemaVersion: "1.0.0", status, code, attemptedWrites, productionReady: false,
    cleanupRequired: attemptedWrites > 0, approvalConsumed: consumption.approvalConsumed,
    limits: "Initial acceptance workload only. No update, restore, rollback, alert-delivery or cleanup execution is implied.",
  };
}

async function main() {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "--help") {
      console.log("greenfield-workload-execution.mjs preview --request <json> --requirements <json> --plan <workload-plan.json>\ngreenfield-workload-execution.mjs apply --manifest <json> --approval <json> --image-provenance <json>\nProtected fixed replay store and independent approval/image public keys are required. Initial new-group nonproduction Bicep acceptance only.");
      return;
    }
    if (!["preview", "apply"].includes(mode) || args.length % 2 !== 0) fail("workload.cli.arguments");
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const flag = args[i];
      if (!(mode === "preview" ? ["--request", "--requirements", "--plan"] : ["--manifest", "--approval", "--image-provenance"]).includes(flag) ||
          Object.hasOwn(options, flag) || !args[i + 1]) fail("workload.cli.arguments");
      options[flag] = JSON.parse(readFileSync(resolve(args[i + 1]), "utf8"));
    }
    if (Object.keys(options).length !== 3) fail("workload.cli.arguments");
    const store = requireDurableStateStore(".sslz/deployment-state");
    if (mode === "preview") {
      console.log(JSON.stringify(createWorkloadPreview(options["--request"], {
        storeId: store.storeId, requirements: options["--requirements"], workloadPlan: options["--plan"],
      }), null, 2));
    } else {
      const authority = {
        storeId: store.storeId,
        approvalPublicKey: readTrustedPublicKey("SSLZ_WORKLOAD_APPROVAL_PUBLIC_KEY_FILE", "workload.approval.trust", "A protected workload approval key is required."),
        imagePublicKey: readTrustedPublicKey("SSLZ_WORKLOAD_IMAGE_PROVENANCE_PUBLIC_KEY_FILE", "workload.image.trust", "A protected image builder key is required."),
      };
      const result = await applyWorkload(options["--manifest"], options["--approval"], options["--image-provenance"], {
        authority, statePath: resolve(root, ".sslz/deployment-state"),
      });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === "succeeded" ? 0 : 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      status: "blocked",
      code: error.code?.startsWith("workload.") || error.code?.startsWith("deployment.") ? error.code : "workload.cli.input",
      attemptedWrites: 0,
    }));
    process.exitCode = 1;
  }
}

export {
  applyWorkload, applicationSourceDigest, createWorkloadPreview, digest,
  signingMessage, sourceDigest, defaultHealthCheck, APPROVAL_DOMAIN, IMAGE_DOMAIN,
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
