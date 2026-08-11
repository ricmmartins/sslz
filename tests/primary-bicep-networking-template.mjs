#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = JSON.parse(readFileSync(0, "utf8"));
const networkingDeployment = template.resources.networking;

assert(networkingDeployment, "Primary template must contain networking.");
assert.equal(
  networkingDeployment.properties.parameters.includeContainerAppsSubnet.value,
  false,
);

const nested = networkingDeployment.properties.template;
assert.match(nested.variables.subnets, /includeContainerAppsSubnet/);
assert.match(nested.variables.subnets, /union\(variables\('baseSubnets'\)/);
const resources = Array.isArray(nested.resources)
  ? nested.resources
  : Object.values(nested.resources);
const containerAppsNsg = resources.find(
  (resource) =>
    resource.type === "Microsoft.Network/networkSecurityGroups" &&
    resource.name.includes("containerApps"),
);
assert(containerAppsNsg, "Shared module must retain the guarded profile NSG.");
assert.equal(
  containerAppsNsg.condition,
  "[parameters('includeContainerAppsSubnet')]",
);

const vnet = resources.find(
  (resource) => resource.type === "Microsoft.Network/virtualNetworks",
);
assert(vnet, "Shared module must contain the virtual network.");
assert.match(vnet.properties.subnets, /includeContainerAppsSubnet/);
assert.match(vnet.properties.subnets, /createArray\(\)\)\)\]$/);
assert.match(
  nested.outputs.containerAppsSubnetId.value,
  /if\(parameters\('includeContainerAppsSubnet'\).+resourceId\(.+, ''\)\]/,
);

console.log(
  "Compiled primary Bicep excludes Container Apps networking by default.",
);
