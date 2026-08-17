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
assert.deepEqual(
  nested.variables.privateAksRules.map((rule) => rule.name),
  ["AllowVNetInbound", "DenyAllInbound"],
);
assert.equal(
  nested.variables.privateAksRules.some((rule) =>
    ["Internet", "AzureLoadBalancer"].includes(
      rule.properties.sourceAddressPrefix,
    ),
  ),
  false,
);
assert.deepEqual(
  nested.variables.publicAksRules.map((rule) => [
    rule.name,
    rule.properties.priority,
    rule.properties.protocol,
    rule.properties.destinationPortRange,
  ]),
  [
    [
      "AllowAzureLoadBalancerHealthProbe",
      100,
      "Tcp",
      "[string(parameters('aksIngressBackendNodePort'))]",
    ],
    [
      "AllowApprovedPublicIngress",
      110,
      "Tcp",
      "[string(parameters('aksIngressBackendNodePort'))]",
    ],
    ["AllowVNetInbound", 120, "*", "*"],
    ["DenyAllInbound", 4096, "*", "*"],
  ],
);
assert.equal(
  nested.variables.publicAksRules[0].properties.sourceAddressPrefix,
  "AzureLoadBalancer",
);
assert.match(
  nested.variables.publicAksRules[1].properties.sourceAddressPrefixes,
  /sort\(parameters\('aksIngressSourcePrefixes'\)/,
);
assert.equal(
  nested.variables.legacyAksRules[0].properties.sourceAddressPrefix,
  "AzureLoadBalancer",
);
assert.equal(
  nested.outputs.aksIngressNsgRules.value,
  "[variables('aksSecurityRules')]",
);
assert.match(
  nested.variables.aksIngressPriorityCollision,
  /aksIngressReservedNsgPriorities.+120.+4096.+100.+110/,
);
assert.match(
  nested.variables.parsedAksSourcePrefixes,
  /parseCidr/,
);
assert.match(
  nested.variables.publicAksIngressShapeValid,
  /aksIngressFrontendPort.+aksIngressBackendNodePort.+30000.+32767.+aksIngressSourcePrefixes.+aksIngressHealthProbeSourcePrefix.+AzureLoadBalancer/,
);
assert.match(
  nested.variables.aksIngressGuard,
  /aksIngressShapeValid.+aksIngressPriorityCollision.+fail/,
);
assert.equal(
  template.outputs.aksIngressNsgRules.value,
  "[if(parameters('deployNetworking'), reference('networking').outputs.aksIngressNsgRules.value, createArray())]",
);

console.log(
  "Compiled primary Bicep preserves profile isolation and exact AKS ingress rules.",
);
