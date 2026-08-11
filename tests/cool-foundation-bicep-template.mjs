#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = JSON.parse(readFileSync(0, "utf8"));
const variables = template.variables;

assert.equal(
  variables.primaryRange,
  "[parseCidr(parameters('primaryVnetAddressPrefix'))]",
);
assert.equal(
  variables.secondaryRange,
  "[parseCidr(parameters('secondaryVnetAddressPrefix'))]",
);
assert.match(
  variables.primaryNetworkOctets,
  /fail\('primaryVnetAddressPrefix must be a valid IPv4 CIDR\.'\)/,
);
assert.match(
  variables.primaryBroadcastOctets,
  /^\[if\(.+split\(variables\('primaryRange'\)\.broadcast, '\.'\).+fail\('primaryVnetAddressPrefix must be a valid IPv4 CIDR\.'\)\)\]$/,
);
assert.match(
  variables.secondaryNetworkOctets,
  /fail\('secondaryVnetAddressPrefix must be a valid IPv4 CIDR\.'\)/,
);
assert.match(
  variables.secondaryBroadcastOctets,
  /^\[if\(.+split\(variables\('secondaryRange'\)\.broadcast, '\.'\).+fail\('secondaryVnetAddressPrefix must be a valid IPv4 CIDR\.'\)\)\]$/,
);
assert.match(variables.addressSpacesOverlap, /lessOrEquals/);
assert.match(variables.addressSpacesOverlap, /primaryNetworkValue/);
assert.match(variables.addressSpacesOverlap, /secondaryBroadcastValue/);
assert.match(variables.addressSpacesOverlap, /secondaryNetworkValue/);
assert.match(variables.addressSpacesOverlap, /primaryBroadcastValue/);
assert.match(
  variables.validatedSecondaryVnetAddressPrefix,
  /fail\('primaryVnetAddressPrefix and secondaryVnetAddressPrefix must not overlap\.'\)/,
);

const networkingDeployment = template.resources.find(
  (resource) =>
    resource.type === "Microsoft.Resources/deployments" &&
    resource.name.includes("deploy-cool-networking"),
);
assert(networkingDeployment, "Compiled template must contain the networking module.");
assert.equal(
  networkingDeployment.properties.parameters.vnetAddressPrefix.value,
  "[variables('validatedSecondaryVnetAddressPrefix')]",
);
assert.equal(
  networkingDeployment.properties.parameters.includeContainerAppsSubnet.value,
  true,
);

const containerAppsNsg =
  networkingDeployment.properties.template.resources.find(
    (resource) =>
      resource.type === "Microsoft.Network/networkSecurityGroups" &&
      resource.name.includes("containerApps"),
  );
assert(
  containerAppsNsg,
  "Compiled foundation must contain the Container Apps subnet NSG.",
);
assert.match(
  networkingDeployment.properties.template.variables.subnets,
  /includeContainerAppsSubnet/,
);
const containerAppsRules =
  containerAppsNsg.properties.securityRules.map((rule) => rule.name);
assert.deepEqual(containerAppsRules, [
  "AllowAzureLoadBalancerInbound",
  "AllowVNetInbound",
  "DenyAllInbound",
]);
assert.equal(
  containerAppsNsg.condition,
  "[parameters('includeContainerAppsSubnet')]",
);

console.log("Compiled cool foundation Bicep validation contract passed.");
