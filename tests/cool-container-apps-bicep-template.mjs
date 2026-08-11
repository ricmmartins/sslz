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
  /image must be an immutable digest reference/,
);
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
  /bound managed identity/,
);
assert.match(
  template.variables.validatedProbes,
  /Startup, Readiness, and Liveness probe/,
);

const profileDeployment = template.resources.find(
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
