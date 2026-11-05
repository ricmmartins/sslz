#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generated = resolve(root, ".sslz/generated");
mkdirSync(generated, { recursive: true });
const fixture = mkdtempSync(resolve(generated, "executor-readiness-tests-"));
const store = resolve(fixture, ".sslz/deployment-state");
const marker = resolve(store, ".durable-store.json");
const key = resolve(fixture, "test-only-public.pem");
const imageKey = resolve(fixture, "test-only-image-public.pem");
const backendFile = resolve(fixture, "backend.json");
const backend = {
  type: "azurerm",
  subscriptionId: "11111111-1111-4111-8111-111111111111",
  resourceGroupName: "test-state-rg",
  storageAccountName: "teststate",
  containerName: "tfstate",
  keyPrefix: "sslz",
};
const env = {
  ...process.env,
  SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE: key,
  SSLZ_PROVIDER_APPROVAL_PUBLIC_KEY_FILE: key,
  SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE: key,
  SSLZ_WORKLOAD_APPROVAL_PUBLIC_KEY_FILE: key,
  SSLZ_WORKLOAD_IMAGE_PROVENANCE_PUBLIC_KEY_FILE: imageKey,
  // Only test path/digest resolution; the checker must never launch this binary.
  SSLZ_TERRAFORM_EXECUTABLE: process.execPath,
};
function fingerprintTree(path) {
  if (!existsSync(path)) return null;
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const child = resolve(path, entry.name);
      return [entry.name, statSync(child).mode, entry.isDirectory()
        ? fingerprintTree(child)
        : createHash("sha256").update(readFileSync(child)).digest("hex")];
    });
}
function run(provider = "bicep", overrides = {}, extra = []) {
  const before = fingerprintTree(fixture);
  const result = spawnSync(process.execPath, [
    resolve(fixture, "scripts/production-executor-readiness.mjs"),
    "--provider", provider,
    ...(provider === "terraform" ? ["--backend-file", backendFile] : []),
    ...extra,
  ], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 30000 });
  assert.ifError(result.error);
  assert.deepEqual(fingerprintTree(fixture), before, "checker must not write or repair files");
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}
function failed(result, id) {
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.productionReady, false);
  assert.equal(result.report.checks.find((check) => check.id === id)?.status, "failed");
}
function writeMarker(value = {
  schemaVersion: "1.0.0", durable: true,
  storeId: "77777777-7777-4777-8777-777777777777",
}) {
  writeFileSync(marker, JSON.stringify(value), { mode: 0o600 });
}
function protectStore() {
  if (process.platform !== "win32") return;
  const user = spawnSync("whoami.exe", [], { encoding: "utf8" }).stdout.trim();
  const acl = spawnSync("icacls.exe", [
    store, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`,
  ], { encoding: "utf8" });
  assert.equal(acl.status, 0, acl.stderr);
}

try {
  // Synthetic isolated checkout only: never provision the actual executor's store or keys.
  mkdirSync(resolve(fixture, "scripts"), { recursive: true });
  for (const name of readdirSync(resolve(root, "scripts"))) {
    if (name.endsWith(".mjs") && !name.startsWith("startup-provider-remediation")) {
      cpSync(resolve(root, "scripts", name), resolve(fixture, "scripts", name));
    }
  }
  cpSync(resolve(root, "agent"), resolve(fixture, "agent"), {
    recursive: true,
    filter: (source) => !source.includes("provider-remediation"),
  });
  mkdirSync(store, { recursive: true, mode: 0o700 });
  protectStore();
  writeMarker();
  writeFileSync(key, generateKeyPairSync("ed25519").publicKey.export({
    type: "spki", format: "pem",
  }));
  writeFileSync(imageKey, generateKeyPairSync("ed25519").publicKey.export({
    type: "spki", format: "pem",
  }));
  writeFileSync(backendFile, JSON.stringify(backend));

  for (const provider of ["bicep", "terraform"]) {
    const result = run(provider);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.report.status, "local-prerequisites-present");
    assert.equal(result.report.productionReady, false);
    assert(result.report.externalChecksRequired.length >= 7);
    assert.equal(result.report.safety.azureCalls, 0);
    assert.equal(result.report.safety.writes, 0);
    assert.equal(result.report.safety.deploymentExecutablesLaunched, 0);
    assert(result.report.checks.every((check) => check.status === "passed"));
  }
  const workload = run("bicep", {}, ["--workload", "greenfield-acceptance"]);
  assert.equal(workload.status, 0, workload.stderr || workload.stdout);
  assert.equal(workload.report.workload, "greenfield-acceptance");
  assert.equal(workload.report.productionReady, false);
  failed(run("bicep", { SSLZ_WORKLOAD_APPROVAL_PUBLIC_KEY_FILE: "" }, ["--workload", "greenfield-acceptance"]), "workload-approval-public-key");
  failed(run("bicep", { SSLZ_WORKLOAD_IMAGE_PROVENANCE_PUBLIC_KEY_FILE: key }, ["--workload", "greenfield-acceptance"]), "workload-independent-image-authority");
  assert.equal(run("terraform", {}, ["--workload", "greenfield-acceptance"]).status, 2);
  failed(run("bicep", { SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE: "" }), "deployment-approval-public-key");
  failed(run("bicep", { SSLZ_PROVIDER_APPROVAL_PUBLIC_KEY_FILE: "" }), "provider-approval-public-key");
  failed(run("bicep", { SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE: "relative.pem" }), "deployment-approval-public-key");
  writeFileSync(key, "not a public key");
  failed(run(), "deployment-approval-public-key");
  writeFileSync(key, generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({
    type: "spki", format: "pem",
  }));
  failed(run(), "deployment-approval-public-key");
  writeFileSync(key, generateKeyPairSync("ed25519").privateKey.export({
    type: "pkcs8", format: "pem",
  }));
  failed(run(), "deployment-approval-public-key");
  writeFileSync(key, generateKeyPairSync("ed25519").publicKey.export({
    type: "spki", format: "pem",
  }));
  failed(run("terraform", { SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE: "" }), "terraform-provenance-public-key");
  failed(run("terraform", { SSLZ_TERRAFORM_EXECUTABLE: resolve(fixture, "absent-terraform") }), "terraform-executable");
  for (const value of [
    {}, { ...backend, type: "local" }, { ...backend, subscriptionId: undefined },
    { ...backend, subscriptionId: "invalid" }, { ...backend, access_key: "forbidden" },
  ]) {
    writeFileSync(backendFile, JSON.stringify(value));
    failed(run("terraform"), "terraform-remote-backend-coordinates");
  }
  writeFileSync(backendFile, JSON.stringify(backend));
  rmSync(marker);
  failed(run(), "fixed-durable-replay-store");
  writeMarker({ schemaVersion: "1.0.0", durable: true, storeId: "invalid" });
  failed(run(), "fixed-durable-replay-store");
  writeMarker({ schemaVersion: "1.0.0", durable: false, storeId: backend.subscriptionId });
  failed(run(), "fixed-durable-replay-store");
  writeMarker({ schemaVersion: "1.0.0", durable: true, storeId: backend.subscriptionId, extra: true });
  failed(run(), "fixed-durable-replay-store");
  writeMarker();
  if (process.platform !== "win32") {
    chmodSync(marker, 0o644);
    failed(run(), "fixed-durable-replay-store");
    chmodSync(marker, 0o600);
    chmodSync(store, 0o755);
    failed(run(), "fixed-durable-replay-store");
    chmodSync(store, 0o700);
    renameSync(marker, `${marker}-original`);
    symlinkSync(`${marker}-original`, marker);
    failed(run(), "fixed-durable-replay-store");
    rmSync(marker);
    renameSync(`${marker}-original`, marker);
    const linkedKey = resolve(fixture, "linked-key.pem");
    symlinkSync(key, linkedKey);
    failed(run("bicep", { SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE: linkedKey }), "deployment-approval-public-key");
    rmSync(linkedKey);
  } else {
    const acl = spawnSync("icacls.exe", [marker, "/grant", "*S-1-1-0:(W)"], { encoding: "utf8" });
    assert.equal(acl.status, 0, acl.stderr);
    failed(run(), "fixed-durable-replay-store");
    assert.equal(spawnSync("icacls.exe", [marker, "/remove:g", "*S-1-1-0"]).status, 0);
  }
  const effectiveStoreId = run().report.checks.find((check) => check.id === "fixed-durable-replay-store").effectiveStoreId;
  renameSync(store, `${store}-original`);
  failed(run(), "fixed-durable-replay-store");
  mkdirSync(store, { mode: 0o700 });
  protectStore();
  cpSync(resolve(`${store}-original`, ".durable-store.json"), marker);
  // A copied marker cannot preserve an old approval's effective store identity.
  const replaced = run().report.checks.find((check) => check.id === "fixed-durable-replay-store");
  assert.equal(replaced.status, "passed");
  assert.notEqual(replaced.effectiveStoreId, effectiveStoreId);
  assert.equal(run("bicep", {}, ["--identity-verified", "true"]).status, 2);
  assert.equal(run("bicep", {}, ["--provider", "terraform"]).status, 2);
  assert.equal(run("invalid").status, 2);
  console.log("Production executor readiness offline tests passed (synthetic prerequisites only; no external readiness claim).");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
