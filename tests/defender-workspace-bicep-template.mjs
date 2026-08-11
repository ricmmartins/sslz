#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { azureCliInvocation } from "../scripts/azure-cli-invocation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(resolve(tmpdir(), "sslz-defender-bicep-"));
const output = resolve(directory, "main.json");

function resources(template) {
  const found = [];
  const entries = Array.isArray(template.resources)
    ? template.resources
    : Object.values(template.resources ?? {});
  for (const resource of entries) {
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
  for (const parameter of [
    "configureDefenderWorkspace",
    "defenderWorkspaceAssociationManagedExternally",
    "defenderWorkspaceSharedSubscription",
    "existingLogAnalyticsWorkspaceId",
    "logAnalyticsWorkspaceLocation",
  ]) {
    assert(template.parameters[parameter], `Missing Bicep parameter: ${parameter}`);
  }

  const graph = resources(template);
  const workspaceSettings = graph.filter(
    (resource) => resource.type === "Microsoft.Security/workspaceSettings",
  );
  assert.equal(workspaceSettings.length, 1);
  assert.equal(workspaceSettings[0].apiVersion, "2017-08-01-preview");
  assert.match(
    String(workspaceSettings[0].condition),
    /configureDefenderWorkspace/,
  );
  assert.match(
    String(workspaceSettings[0].properties.workspaceId),
    /logAnalyticsWorkspaceId/,
  );

  const workspace = graph.filter(
    (resource) =>
      resource.type === "Microsoft.OperationalInsights/workspaces" &&
      resource.existing !== true,
  );
  assert.equal(workspace.length, 1);
  assert.match(String(workspace[0].location), /parameters\('location'\)/);
  const rootResources = Object.values(template.resources ?? {});
  const workspaceDeployment = rootResources.find(
    (resource) =>
      resource.type === "Microsoft.Resources/deployments" &&
      resources(resource.properties?.template ?? {}).some(
        (nested) =>
          nested.type === "Microsoft.OperationalInsights/workspaces",
      ),
  );
  assert(workspaceDeployment);
  assert.match(
    String(workspaceDeployment.properties.parameters.location.value),
    /logAnalyticsWorkspaceLocation/,
  );
  assert.match(
    JSON.stringify(template.variables.workspaceReferenceIsSameSubscription),
    /subscription\(\)\.subscriptionId/,
  );
  assert.match(
    JSON.stringify(template.variables.workspaceReferenceHasExactSegments),
    /length\(split/,
  );
  assert.match(
    JSON.stringify(template.variables.primaryRegionPolicyGuard),
    /allowedLocations/,
  );
  assert.match(
    JSON.stringify(template),
    /existingLogAnalyticsWorkspace.*actual location/,
  );
  assert.match(
    JSON.stringify(template.variables.sharedWorkspaceOwnershipGuard),
    /shared subscription requires one approved existing workspace/,
  );
  const existingWorkspace = graph.filter(
    (resource) =>
      resource.type === "Microsoft.OperationalInsights/workspaces" &&
      resource.existing === true,
  );
  assert.equal(existingWorkspace.length, 1);
  assert.match(String(existingWorkspace[0].condition), /useExisting/);

  const monitoringGroup = Object.entries(template.resources ?? {}).find(
    ([name]) => name === "rgMonitoringRes",
  )?.[1];
  assert(monitoringGroup);
  assert.match(
    String(monitoringGroup.condition),
    /useExistingLogAnalyticsWorkspace/,
  );

  console.log("Defender workspace Bicep compiled contract tests passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
