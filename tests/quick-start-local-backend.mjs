#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("infra/terraform/main.tf", root), "utf8");
const backend = source.match(/  backend "azurerm" \{[^}]+\}/)?.[0];
assert(backend, "Exercise the actual root backend declaration.");
const directory = mkdtempSync(join(tmpdir(), "sslz-local-backend-"));
function terraform(args, expected = 0) {
  const result = spawnSync("terraform", args, {
    cwd: directory, encoding: "utf8", shell: false, timeout: 60000,
    env: { ...process.env, TF_IN_AUTOMATION: "1", TF_INPUT: "0" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${result.stdout}\n${result.stderr}`);
  return result;
}
try {
  // Keep this test provider-free: backend selection must not require Azure or downloads.
  writeFileSync(join(directory, "main.tf"), `terraform {\n${backend}\n}\n`);
  terraform(["init", "-backend=false", "-input=false", "-no-color"]);
  const disabled = terraform(["plan", "-input=false", "-no-color"], 1);
  assert.match(disabled.stderr, /Backend initialization required/);
  copyFileSync(new URL("infra/terraform/local-backend.tf.example", root), join(directory, "backend_override.tf"));
  terraform(["init", "-input=false", "-no-color"]);
  const metadata = JSON.parse(readFileSync(join(directory, ".terraform", "terraform.tfstate"), "utf8"));
  assert.equal(metadata.backend.type, "local");
  assert.deepEqual(metadata.backend.config, {
    path: "terraform.tfstate", workspace_dir: null,
  });
  terraform(["plan", "-out=tfplan", "-input=false", "-no-color"]);
  const plan = JSON.parse(terraform(["show", "-json", "tfplan"]).stdout);
  assert.equal(plan.errored, false);
  assert.equal(plan.resource_changes?.length ?? 0, 0);
  console.log("Actual Terraform rejected disabled initialization, selected the documented local override, and produced a provider-free plan. No Azure calls.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
