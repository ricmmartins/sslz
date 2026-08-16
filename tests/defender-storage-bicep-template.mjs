#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { azureCliInvocation } from "../scripts/azure-cli-invocation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(resolve(tmpdir(), "sslz-defender-storage-"));
const output = resolve(directory, "main.json");

function resources(template) {
  const found = [];
  for (const resource of Object.values(template.resources ?? {})) {
    found.push(resource);
    if (
      resource.type === "Microsoft.Resources/deployments" &&
      resource.properties?.template
    ) {
      found.push(...resources(resource.properties.template));
    }
  }
  return found;
}

try {
  const invocation = azureCliInvocation([
    "bicep",
    "build",
    "--file",
    resolve(root, "infra/bicep/main.bicep"),
    "--outfile",
    output,
  ]);
  const execution = spawnSync(invocation.executable, invocation.arguments, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(execution.status, 0, execution.stderr);

  const template = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(template.parameters.enableDefenderForStorage.type, "bool");
  assert.equal(template.parameters.enableDefenderForStorage.defaultValue, false);
  assert.match(
    String(template.outputs.defenderForStorageEnabled.value),
    /defenderForStorageEnabled/,
  );
  assert(template.outputs.defenderForStorageTier);
  assert(template.outputs.defenderForStorageSubPlan);
  assert.equal(
    template.outputs.defenderForStorageSubPlan.nullable,
    true,
  );

  const storagePlans = resources(template).filter(
    (resource) =>
      resource.type === "Microsoft.Security/pricings" &&
      String(resource.name).includes("StorageAccounts"),
  );
  assert.equal(storagePlans.length, 1);
  const properties = JSON.stringify(storagePlans[0].properties);
  assert.match(properties, /enableDefenderForStorage/);
  assert.match(properties, /Standard/);
  assert.match(properties, /DefenderForStorageV2/);
  assert.match(properties, /Free/);

  console.log("Defender for Storage Bicep compiled contract tests passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
