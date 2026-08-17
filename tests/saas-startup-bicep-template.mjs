#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const template = JSON.parse(readFileSync(0, "utf8"));
const resources = Array.isArray(template.resources)
  ? template.resources
  : Object.values(template.resources);

assert.equal(template.parameters.deployPrivateEndpoints.defaultValue, false);
assert.equal(
  template.parameters.containerAppsInfrastructureSubnetId.defaultValue,
  "",
);
assert.equal(template.parameters.privateEndpointSubnetId.defaultValue, "");
assert.equal(template.parameters.vnetId.defaultValue, "");

assert.match(
  template.variables.privateNetworkResourceIdsValid,
  /containerAppsSubnetResourceIdValid.+privateEndpointSubnetResourceIdValid.+containerAppsSubnetVnetId.+vnetId.+privateEndpointSubnetVnetId/i,
);
assert.match(
  template.variables.containerAppsSubnetResourceIdValid,
  /containerAppsInfrastructureSubnetId/,
);
assert.match(
  template.variables.privateEndpointSubnetResourceIdValid,
  /privateEndpointSubnetId/,
);
const compiledTemplate = JSON.stringify(template);
for (const validationTerm of [
  "Microsoft.App/environments",
  "169.254.0.0/16",
  "100.100.192.0/19",
  "/27-or-larger IPv4 prefix",
  "not overlap the Private Endpoint subnet",
]) {
  assert.match(compiledTemplate, new RegExp(validationTerm.replace("/", "\\/")));
}

const environment = resources.find(
  (resource) => resource.type === "Microsoft.App/managedEnvironments",
);
assert(environment, "Compiled template must contain the Container Apps environment.");
assert.match(environment.properties, /deployPrivateEndpoints/);
assert.match(environment.properties, /vnetConfiguration/);
assert.match(environment.properties, /infrastructureSubnetId/);

const privateEndpoints = resources.filter(
  (resource) => resource.type === "Microsoft.Network/privateEndpoints",
);
assert.equal(privateEndpoints.length, 2);
for (const endpoint of privateEndpoints) {
  assert.equal(
    endpoint.condition,
    "[parameters('deployPrivateEndpoints')]",
  );
  assert.match(
    endpoint.properties.subnet.id,
    /Private endpoint mode requires valid, distinct subnet IDs/,
  );
}

const dnsLinks = resources.filter(
  (resource) =>
    resource.type === "Microsoft.Network/privateDnsZones/virtualNetworkLinks",
);
assert.equal(dnsLinks.length, 2);
for (const link of dnsLinks) {
  assert.equal(link.condition, "[parameters('deployPrivateEndpoints')]");
  assert.equal(link.properties.virtualNetwork.id, "[parameters('vnetId')]");
  assert.equal(link.properties.registrationEnabled, false);
}

const sql = resources.find(
  (resource) => resource.type === "Microsoft.Sql/servers",
);
const redis = resources.find(
  (resource) => resource.type === "Microsoft.Cache/redis",
);
assert.equal(
  sql.properties.publicNetworkAccess,
  "[if(parameters('deployPrivateEndpoints'), 'Disabled', 'Enabled')]",
);
assert.equal(
  redis.properties.publicNetworkAccess,
  "[if(parameters('deployPrivateEndpoints'), 'Disabled', 'Enabled')]",
);

assert.match(
  template.outputs.containerAppsInfrastructureSubnetId.value,
  /deployPrivateEndpoints.+containerAppsInfrastructureSubnetId.+Private endpoint mode requires valid, distinct subnet IDs/,
);
assert.match(
  template.outputs.privateDnsZoneIds.value,
  /deployPrivateEndpoints.+privatelink\.database\.windows\.net.+privatelink\.redis\.cache\.windows\.net/,
);

console.log(
  "Compiled SaaS startup template preserves public mode and validates the private runtime path.",
);
