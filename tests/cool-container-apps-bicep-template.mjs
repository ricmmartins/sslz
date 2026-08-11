#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = JSON.parse(readFileSync(0, "utf8"));

assert.equal(template.parameters.revisionMode.defaultValue, "Single");
assert.equal(template.parameters.minReplicas.defaultValue, 0);
assert.equal(template.parameters.maxReplicas.defaultValue, 1);
assert.equal(template.outputs.executionEnabled.value, false);
assert.equal(
  template.outputs.decisionDigest.value,
  "[parameters('decisionDigest')]",
);
assert.equal(
  template.outputs.sourceDigest.value,
  "[parameters('sourceDigest')]",
);
assert.match(
  template.variables.validatedImage,
  /64 lowercase hexadecimal characters/,
);
assert.match(template.variables.imageIsImmutable, /isLowerHexLength.+64/);
assert.match(
  template.variables.validatedSubnetResourceId,
  /dedicated Container Apps subnet/,
);
assert.match(
  template.variables.validatedSecondaryScope,
  /primaryScope and secondaryScope must be isolated/,
);
assert.match(
  template.variables.validatedSecondaryVnetCidr,
  /primaryVnetCidr and secondaryVnetCidr must not overlap/,
);
assert.match(
  template.variables.validatedSecretReferences,
  /versioned Key Vault URI reference.+secret material is prohibited/,
);
assert.equal(template.definitions.secretReference.additionalProperties, false);
assert.deepEqual(
  Object.keys(template.definitions.secretReference.properties),
  ["name", "keyVaultSecretUri", "identityResourceId"],
);
const bicepFunctions = template.functions.find(
  (item) => item.namespace === "__bicep",
).members;
assert.match(
  bicepFunctions.isLowerHexLength.output.value,
  /equals\(length\(parameters\('value'\)\), parameters\('expectedLength'\)\).+stripLowerHex/,
);
assert.match(
  bicepFunctions.isVersionedKeyVaultSecretUri.output.value,
  /equals\(length\(split\(parameters\('uri'\), '\/'\)\), 6\).+https:.+isKeyVaultHost.+secrets.+isLowerHexLength.+32/,
);
assert.match(
  template.variables.validatedProbes,
  /Startup, Readiness, and Liveness probe/,
);

const resources = Array.isArray(template.resources)
  ? template.resources
  : Object.values(template.resources);
const profileDeployment = resources.find(
  (resource) =>
    resource.type === "Microsoft.Resources/deployments" &&
    resource.name.includes("represent-cool-container-apps"),
);
assert(profileDeployment, "Compiled template must contain the profile module.");
assert.equal(
  profileDeployment.properties.parameters.revisionMode.value,
  "[parameters('revisionMode')]",
);
assert.equal(
  profileDeployment.properties.parameters.infrastructureSubnetResourceId.value,
  "[variables('validatedSubnetResourceId')]",
);

console.log("Compiled Container Apps cool profile contract passed.");
