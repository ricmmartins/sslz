#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { loadRegionalAttempt } from "./regional-attempt.mjs";
import { validateAksIngressDecision } from "./aks-ingress-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function validateType(value, expected, path) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  let actual =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

  if (actual === "number" && Number.isInteger(value) && allowed.includes("integer")) {
    actual = "integer";
  }

  if (!allowed.includes(actual)) {
    fail(path, `expected ${allowed.join(" or ")}, got ${actual}`);
  }
}

function validateFormat(value, format, path) {
  if (format === "date-time" && Number.isNaN(Date.parse(value))) {
    fail(path, `invalid date-time: ${value}`);
  }

  if (format === "uri") {
    try {
      new URL(value);
    } catch {
      fail(path, `invalid URI: ${value}`);
    }
  }
}

function validate(schema, value, path, schemaDirectory) {
  if (schema.$ref) {
    if (schema.$ref.startsWith("#/$defs/")) {
      fail(path, "local references must be resolved by validateDocument");
    }

    const referenced = load(`agent/schemas/${schema.$ref}`);
    validateDocument(referenced, value, path);
    return;
  }

  if (schema.oneOf) {
    const successes = schema.oneOf.filter((candidate) => {
      try {
        validate(candidate, value, path, schemaDirectory);
        return true;
      } catch {
        return false;
      }
    });
    if (successes.length !== 1) {
      fail(path, `expected exactly one oneOf match, got ${successes.length}`);
    }
    return;
  }

  if (schema.allOf) {
    for (const candidate of schema.allOf) {
      validate(candidate, value, path, schemaDirectory);
    }
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    fail(path, `expected constant ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    fail(path, `unsupported value ${JSON.stringify(value)}`);
  }

  if (schema.type) {
    validateType(value, schema.type, path);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(path, `minimum length is ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      fail(path, `maximum length is ${schema.maxLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      fail(path, `does not match ${schema.pattern}`);
    }
    if (schema.format) {
      validateFormat(value, schema.format, path);
    }
  }

  if (typeof value === "number") {
    if (schema.type === "integer" && !Number.isInteger(value)) {
      fail(path, "expected integer");
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(path, `minimum value is ${schema.minimum}`);
    }
    if (
      schema.exclusiveMinimum !== undefined &&
      value <= schema.exclusiveMinimum
    ) {
      fail(path, `value must be greater than ${schema.exclusiveMinimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(path, `maximum value is ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(path, `minimum item count is ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(path, `maximum item count is ${schema.maxItems}`);
    }
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item));
      if (new Set(serialized).size !== serialized.length) {
        fail(path, "items must be unique");
      }
    }
    if (schema.items) {
      value.forEach((item, index) =>
        validate(schema.items, item, `${path}[${index}]`, schemaDirectory),
      );
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const propertyCount = Object.keys(value).length;
    if (
      schema.minProperties !== undefined &&
      propertyCount < schema.minProperties
    ) {
      fail(path, `minimum property count is ${schema.minProperties}`);
    }
    if (
      schema.maxProperties !== undefined &&
      propertyCount > schema.maxProperties
    ) {
      fail(path, `maximum property count is ${schema.maxProperties}`);
    }

    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) {
        fail(path, `missing required property ${required}`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const property of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, property)) {
          fail(path, `unexpected property ${property}`);
        }
      }
    }

    for (const [property, propertyValue] of Object.entries(value)) {
      const propertySchema = schema.properties?.[property];
      if (propertySchema) {
        validate(
          propertySchema,
          propertyValue,
          `${path}.${property}`,
          schemaDirectory,
        );
      } else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      ) {
        validate(
          schema.additionalProperties,
          propertyValue,
          `${path}.${property}`,
          schemaDirectory,
        );
      }
    }
  }
}

function resolveLocalReferences(schema, node) {
  if (Array.isArray(node)) {
    return node.map((item) => resolveLocalReferences(schema, item));
  }

  if (!node || typeof node !== "object") {
    return node;
  }

  if (node.$ref?.startsWith("#/$defs/")) {
    const key = node.$ref.slice("#/$defs/".length);
    assert(schema.$defs?.[key], `Missing local definition: ${key}`);
    return resolveLocalReferences(schema, schema.$defs[key]);
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      resolveLocalReferences(schema, value),
    ]),
  );
}

function validateDocument(schema, value, path = "$") {
  const resolved = resolveLocalReferences(schema, schema);
  validate(resolved, value, path, resolve(root, "agent/schemas"));
}

function validateCatalog(catalog) {
  assert.equal(catalog.schemaVersion, "1.0.0");
  assert(Array.isArray(catalog.checks) && catalog.checks.length > 0);

  const ids = catalog.checks.map((check) => check.id);
  assert.equal(new Set(ids).size, ids.length, "Check catalog IDs must be unique");

  const categories = new Set([
    "account",
    "identity",
    "billing",
    "quota",
    "capacity",
    "region",
    "network",
    "workload",
    "security",
    "operations",
  ]);
  const severities = new Set(["blocking", "high", "medium", "low", "info"]);
  const automation = new Set([
    "readOnly",
    "manual",
    "support",
    "approvedWrite",
  ]);

  for (const check of catalog.checks) {
    assert.match(check.id, /^[a-z0-9]+([.-][a-z0-9]+)+$/);
    assert(categories.has(check.category), `Invalid category for ${check.id}`);
    assert(severities.has(check.severity), `Invalid severity for ${check.id}`);
    assert(automation.has(check.automation), `Invalid automation for ${check.id}`);
    assert(
      check.documentationUrl.startsWith("https://learn.microsoft.com/"),
      `Check ${check.id} must use official Microsoft Learn documentation`,
    );
  }
}

function validateExamplesAgainstCatalog(examples, catalog) {
  const catalogIds = new Set(catalog.checks.map((check) => check.id));
  for (const example of examples) {
    for (const check of example.checks) {
      assert(catalogIds.has(check.id), `Unknown check ID in example: ${check.id}`);
    }
  }
}

function validateProfileDefinitions(profiles, catalog) {
  const catalogIds = new Set(catalog.checks.map((check) => check.id));
  const profileIds = new Set();

  for (const profile of profiles) {
    assert.equal(profile.profileVersion, "1.0.0");
    assert.match(profile.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert(["compute", "extension"].includes(profile.kind));
    assert(!profileIds.has(profile.id), `Duplicate profile ID: ${profile.id}`);
    profileIds.add(profile.id);
    assert(
      Array.isArray(profile.providerNamespaces) &&
        profile.providerNamespaces.length > 0,
    );
    for (const namespace of profile.providerNamespaces) {
      assert.match(namespace, /^Microsoft\.[A-Za-z0-9]+$/);
    }
    assert(Array.isArray(profile.requiredChecks) && profile.requiredChecks.length > 0);
    assert(Array.isArray(profile.costAssumptions) && profile.costAssumptions.length > 0);
    assert(profile.regionalRequirements);
    assert(Array.isArray(profile.regionalRequirements.services));
    assert.equal(
      typeof profile.regionalRequirements.computeSkuEvidence,
      "boolean",
    );
    assert.equal(typeof profile.regionalRequirements.gpuSkuEvidence, "boolean");
    assert.equal(
      typeof profile.regionalRequirements.foundryDeploymentEvidence,
      "boolean",
    );
    for (const checkId of profile.requiredChecks) {
      assert(catalogIds.has(checkId), `Unknown check ID in ${profile.id}: ${checkId}`);
    }
  }
}

function validateWorkloadProfilePlan(plan, catalog) {
  const catalogIds = new Set(catalog.checks.map((check) => check.id));
  for (const checkId of plan.requiredChecks) {
    assert(catalogIds.has(checkId), `Unknown workload plan check ID: ${checkId}`);
  }
}

function validateSensitiveData(documents) {
  const text = JSON.stringify(documents);
  const forbidden = [
    /"accessToken"/i,
    /"refreshToken"/i,
    /"clientSecret"/i,
    /"connectionString"/i,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /@[a-z0-9.-]+\.[a-z]{2,}/i,
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `Sensitive-data pattern found: ${pattern}`);
  }
}

export { validateDocument };

function main() {
  const startupInputSchema = load("agent/schemas/startup-input.schema.json");
  const deploymentPlanSchema = load("agent/schemas/deployment-plan.schema.json");
  const workloadProfilePlanSchema = load(
    "agent/schemas/workload-profile-plan.schema.json",
  );
  const regionalPlanningInputSchema = load(
    "agent/schemas/regional-planning-input.schema.json",
  );
  const postgresqlRegionalPlanInputSchema = load(
    "agent/schemas/postgresql-regional-plan-input.schema.json",
  );
  const postgresqlRegionalPlanSchema = load(
    "agent/schemas/postgresql-regional-plan.schema.json",
  );
  const iacPlanInputSchema = load("agent/schemas/iac-plan-input.schema.json");
  const iacPlanInputV2Schema = load(
    "agent/schemas/iac-plan-input-v2.schema.json",
  );
  const iacPlanInputV3Schema = load(
    "agent/schemas/iac-plan-input-v3.schema.json",
  );
  const readinessEvidenceSchema = load(
    "agent/schemas/readiness-evidence.schema.json",
  );
  const aksIngressDecisionSchema = load(
    "agent/schemas/aks-ingress-decision.schema.json",
  );
  const aksIngressPostcheckSchema = load(
    "agent/schemas/aks-ingress-postcheck.schema.json",
  );
  const subscriptionTopologyDecisionSchema = load(
    "agent/schemas/subscription-topology-decision.schema.json",
  );
  const defenderWorkspacePlacementDecisionSchema = load(
    "agent/schemas/defender-workspace-placement-decision.schema.json",
  );
  const coolFoundationBaselineSchema = load(
    "agent/schemas/cool-foundation-baseline.schema.json",
  );
  const coolFoundationManifestSchema = load(
    "agent/schemas/cool-foundation-manifest.schema.json",
  );
  const coolFoundationPlanSchema = load(
    "agent/schemas/cool-foundation-plan.schema.json",
  );
  const containerAppsCoolProfileInputSchema = load(
    "agent/schemas/container-apps-cool-profile-input.schema.json",
  );
  const containerAppsCoolProfileManifestSchema = load(
    "agent/schemas/container-apps-cool-profile-manifest.schema.json",
  );
  const containerAppsCoolProfilePlanSchema = load(
    "agent/schemas/container-apps-cool-profile-plan.schema.json",
  );
  const iacPlanSummarySchema = load("agent/schemas/iac-plan-summary.schema.json");
  const providerRemediationApprovalSchema = load(
    "agent/schemas/provider-remediation-approval.schema.json",
  );
  const providerRemediationResultSchema = load(
    "agent/schemas/provider-remediation-result.schema.json",
  );
  const deploymentExecutionManifestSchema = load(
    "agent/schemas/deployment-execution-manifest.schema.json",
  );
  const deploymentApprovalSchema = load(
    "agent/schemas/deployment-approval.schema.json",
  );
  const deploymentResultSchema = load(
    "agent/schemas/deployment-result.schema.json",
  );
  const regionalAttemptSchema = load(
    "agent/schemas/regional-attempt.schema.json",
  );
  const terraformPlanProvenanceSchema = load(
    "agent/schemas/terraform-plan-provenance.schema.json",
  );
  const preflightResultSchema = load("agent/schemas/preflight-result.schema.json");
  const greenfieldJourneyReportSchema = load(
    "agent/schemas/greenfield-journey-report.schema.json",
  );
  const startupInput = load("agent/examples/startup-input.json");
  const workloadProfilePlan = load("agent/examples/workload-profile-plan.json");
  const regionalPlanningInput = load(
    "agent/examples/regional-planning-input.json",
  );
  const postgresqlRegionalPlanInput = load(
    "agent/examples/postgresql-regional-plan-input.json",
  );
  const readyExample = load("agent/examples/ready-container-apps.json");
  const blockedExample = load("agent/examples/blocked-billing.json");
  const providerRegistrationApproval = load(
    "agent/examples/provider-registration-approval.json",
  );
  const providerRegistrationDryRun = load(
    "agent/examples/provider-registration-dry-run.json",
  );
  const deploymentExecutionManifest = load(
    "agent/examples/deployment-execution-manifest.json",
  );
  const deploymentApproval = load("agent/examples/deployment-approval.json");
  const regionalAttempt = load("agent/examples/regional-attempt.json");
  const terraformPlanProvenance = load(
    "agent/examples/terraform-plan-provenance.json",
  );
  const readinessEvidence = load("agent/examples/readiness-evidence.json");
  const aksIngressPrivate = load("agent/examples/aks-ingress-private.json");
  const aksIngressPublic = load("agent/examples/aks-ingress-public.json");
  const defenderWorkspacePlacementDecision = load(
    "agent/examples/defender-workspace-placement-decision.json",
  );
  const coolFoundationBaseline = load(
    "agent/examples/cool-foundation-baseline.json",
  );
  const containerAppsCoolProfileInput = load(
    "agent/examples/container-apps-cool-profile-input.json",
  );
  const greenfieldJourneyReport = load(
    "agent/examples/greenfield-journey-report.json",
  );
  const catalog = load("agent/checks/check-catalog.json");
  const profiles = [
    load("agent/profiles/container-apps.json"),
    load("agent/profiles/aks.json"),
    load("agent/profiles/postgresql.json"),
    load("agent/profiles/foundry.json"),
    load("agent/profiles/gpu.json"),
  ];

  validateDocument(startupInputSchema, startupInput);
  validateDocument(workloadProfilePlanSchema, workloadProfilePlan);
  validateDocument(regionalPlanningInputSchema, regionalPlanningInput);
  validateDocument(
    postgresqlRegionalPlanInputSchema,
    postgresqlRegionalPlanInput,
  );
  assert.equal(
    postgresqlRegionalPlanSchema.$id,
    "https://aka.ms/sslz/schemas/postgresql-regional-plan.schema.json",
  );
  assert.equal(
    iacPlanInputSchema.$id,
    "https://aka.ms/sslz/schemas/iac-plan-input.schema.json",
  );
  assert.equal(
    iacPlanInputV2Schema.$id,
    "https://aka.ms/sslz/schemas/iac-plan-input-v2.schema.json",
  );
  assert.equal(
    iacPlanInputV3Schema.$id,
    "https://aka.ms/sslz/schemas/iac-plan-input-v3.schema.json",
  );
  assert.equal(
    readinessEvidenceSchema.$id,
    "https://aka.ms/sslz/schemas/readiness-evidence.schema.json",
  );
  assert.equal(
    subscriptionTopologyDecisionSchema.$id,
    "https://aka.ms/sslz/schemas/subscription-topology-decision.schema.json",
  );
  assert.equal(
    defenderWorkspacePlacementDecisionSchema.$id,
    "https://aka.ms/sslz/schemas/defender-workspace-placement-decision.schema.json",
  );
  assert.equal(
    iacPlanSummarySchema.$id,
    "https://aka.ms/sslz/schemas/iac-plan-summary.schema.json",
  );
  assert.equal(
    coolFoundationBaselineSchema.$id,
    "https://aka.ms/sslz/schemas/cool-foundation-baseline.schema.json",
  );
  assert.equal(
    coolFoundationManifestSchema.$id,
    "https://aka.ms/sslz/schemas/cool-foundation-manifest.schema.json",
  );
  assert.equal(
    coolFoundationPlanSchema.$id,
    "https://aka.ms/sslz/schemas/cool-foundation-plan.schema.json",
  );
  assert.equal(
    containerAppsCoolProfileInputSchema.$id,
    "https://aka.ms/sslz/schemas/container-apps-cool-profile-input.schema.json",
  );
  assert.equal(
    containerAppsCoolProfileManifestSchema.$id,
    "https://aka.ms/sslz/schemas/container-apps-cool-profile-manifest.schema.json",
  );
  assert.equal(
    containerAppsCoolProfilePlanSchema.$id,
    "https://aka.ms/sslz/schemas/container-apps-cool-profile-plan.schema.json",
  );
  validateDocument(deploymentPlanSchema, readyExample.deploymentPlan);
  validateDocument(preflightResultSchema, readyExample);
  validateDocument(preflightResultSchema, blockedExample);
  validateDocument(
    providerRemediationApprovalSchema,
    providerRegistrationApproval,
  );
  validateDocument(providerRemediationResultSchema, providerRegistrationDryRun);
  validateDocument(
    deploymentExecutionManifestSchema,
    deploymentExecutionManifest,
  );
  validateDocument(deploymentApprovalSchema, deploymentApproval);
  validateDocument(regionalAttemptSchema, regionalAttempt);
  loadRegionalAttempt(resolve(root, "agent/examples/regional-attempt.json"));
  validateDocument(terraformPlanProvenanceSchema, terraformPlanProvenance);
  validateDocument(readinessEvidenceSchema, readinessEvidence);
  validateDocument(aksIngressDecisionSchema, aksIngressPrivate);
  validateDocument(aksIngressDecisionSchema, aksIngressPublic);
  validateDocument(
    aksIngressPostcheckSchema,
    validateAksIngressDecision(aksIngressPrivate).postcheck,
  );
  validateDocument(
    aksIngressPostcheckSchema,
    validateAksIngressDecision(aksIngressPublic).postcheck,
  );
  validateDocument(
    defenderWorkspacePlacementDecisionSchema,
    defenderWorkspacePlacementDecision,
  );
  validateDocument(coolFoundationBaselineSchema, coolFoundationBaseline);
  validateDocument(
    containerAppsCoolProfileInputSchema,
    containerAppsCoolProfileInput,
  );
  validateDocument(greenfieldJourneyReportSchema, greenfieldJourneyReport);
  assert.throws(
    () =>
      validateDocument(greenfieldJourneyReportSchema, {
        ...greenfieldJourneyReport,
        bindings: {},
      }),
    /minimum property count is 1/,
  );
  assert.throws(
    () =>
      validateDocument(greenfieldJourneyReportSchema, {
        ...greenfieldJourneyReport,
        bindings: { invalid: "not-a-digest" },
      }),
    /does not match \^sha256:/,
  );
  assert.equal(
    deploymentResultSchema.$id,
    "https://aka.ms/sslz/schemas/deployment-result.schema.json",
  );
  validateCatalog(catalog);
  validateProfileDefinitions(profiles, catalog);
  validateWorkloadProfilePlan(workloadProfilePlan, catalog);
  validateExamplesAgainstCatalog([readyExample, blockedExample], catalog);
  validateSensitiveData([
    startupInput,
    workloadProfilePlan,
    regionalPlanningInput,
    postgresqlRegionalPlanInput,
    readyExample,
    blockedExample,
    providerRegistrationApproval,
    providerRegistrationDryRun,
    deploymentExecutionManifest,
    deploymentApproval,
    regionalAttempt,
    terraformPlanProvenance,
    readinessEvidence,
    aksIngressPrivate,
    aksIngressPublic,
    defenderWorkspacePlacementDecision,
    coolFoundationBaseline,
    containerAppsCoolProfileInput,
    greenfieldJourneyReport,
    profiles,
  ]);

  console.log("Agent contracts are valid.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
