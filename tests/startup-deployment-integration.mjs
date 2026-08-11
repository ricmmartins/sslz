#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  approvalArtifactDigest,
  approvalReplayKey,
  approvalSigningMessage,
  azureCliInvocation,
  buildDeploymentManifest,
  expectedTerraformResourceGraph,
  keyFingerprint,
  manifestDigest,
  runDeploymentIntegration,
  sanitizedTerraformEnvironment,
} from "../scripts/startup-deployment-integration.mjs";
import { sanitizedAzureCliEnvironment } from "../scripts/azure-cli-invocation.mjs";
import {
  generateIacPlan,
  planDigest,
} from "../scripts/startup-iac-plan.mjs";
import {
  hashBytes as provenanceHashBytes,
  hashCanonical as provenanceHashCanonical,
  signTerraformProvenance,
  terraformRuntimePlatform,
} from "../scripts/terraform-plan-provenance.mjs";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";
import { buildReadinessEvidence } from "./readiness-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previousTerraformExecutable = process.env.SSLZ_TERRAFORM_EXECUTABLE;
const testTerraformExecutable = resolve(
  tmpdir(),
  `sslz-test-terraform-${process.pid}${process.platform === "win32" ? ".exe" : ""}`,
);
writeFileSync(testTerraformExecutable, "trusted terraform fixture", {
  flag: "wx",
  mode: 0o500,
});
process.env.SSLZ_TERRAFORM_EXECUTABLE = testTerraformExecutable;
const terraformExecutableDigest = provenanceHashBytes(
  readFileSync(testTerraformExecutable),
);
const evaluatedAt = Date.parse("2026-08-09T12:00:00Z");
const tenantId = "11111111-1111-1111-1111-111111111111";
const prod = "22222222-2222-2222-2222-222222222222";
const nonprod = "33333333-3333-3333-3333-333333333333";
const policyPrincipals = {
  activity: "44444444-4444-4444-4444-444444444444",
  environment: "55555555-5555-5555-5555-555555555555",
  team: "66666666-6666-6666-6666-666666666666",
};
const outputRelative = `.sslz/generated/deployment-tests-${process.pid}`;
const outputPath = resolve(root, outputRelative);
const stateRelative = ".sslz/deployment-state";
const statePath = resolve(root, stateRelative);
const stateStoreId = "77777777-7777-4777-8777-777777777777";
const script = resolve(root, "scripts/startup-deployment-integration.mjs");
const regionalInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/regional-planning-input.json"),
    "utf8",
  ),
);
const manifestSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/deployment-execution-manifest.schema.json"),
    "utf8",
  ),
);
const resultSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/deployment-result.schema.json"),
    "utf8",
  ),
);

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const otherPublicKeyPem = generateKeyPairSync("ed25519").publicKey.export({
  type: "spki",
  format: "pem",
});
const {
  publicKey: provenancePublicKey,
  privateKey: provenancePrivateKey,
} = generateKeyPairSync("ed25519");
const provenancePublicKeyPem = provenancePublicKey.export({
  type: "spki",
  format: "pem",
});

function createInput({ regionalMode = "single-region-ready" } = {}) {
  const planningInput = structuredClone(regionalInput);
  planningInput.startupInput.reliability.regionalMode = regionalMode;
  planningInput.startupInput.reliability.failoverOwnerConfirmed =
    regionalMode !== "single-region-ready";
  planningInput.startupInput.reliability.rtoMinutes = 60;
  planningInput.startupInput.reliability.rpoMinutes = 15;
  planningInput.workloadPlan = planWorkload(planningInput.startupInput);
  const regionalPlan = planRegions(planningInput);
  const input = {
    schemaVersion: "3.0.0",
    planId: "phase-six-test",
    target: {
      tenantId,
      environments: [
        { name: "prod", subscriptionId: prod },
        { name: "nonprod", subscriptionId: nonprod },
      ],
    },
    workloadPlan: planningInput.workloadPlan,
    regionalPlan,
    deployment: {
      companyName: "contoso",
      budgetStartDate: "2026-08-01T00:00:00Z",
      monthlyBudgetAmounts: { prod: 500, nonprod: 200 },
      deployNetworking: true,
      logRetentionInDays: 90,
      logDailyQuotaGb: 5,
      paidPlans: {
        defenderForServers: true,
        defenderForContainers: false,
        defenderForDatabases: true,
        defenderForKeyVault: true,
        defenderForResourceManager: true,
        defenderForStorage: true,
      },
      services: [
        {
          type: "Microsoft.App/managedEnvironments",
          purpose: "application compute",
        },
        {
          type: "Microsoft.DBforPostgreSQL/flexibleServers",
          purpose: "relational data",
        },
      ],
      proposedActions: [],
      terraformBackend: {
        type: "azurerm",
        subscriptionId: prod,
        resourceGroupName: "rg-terraform-state",
        storageAccountName: "stsslzfixture",
        containerName: "tfstate",
        keyPrefix: "phase-six",
      },
    },
    approval: null,
  };
  input.readinessEvidence = buildReadinessEvidence(input);
  return input;
}

function terraformPlanDocument(
  environment = "prod",
  { unknownPrincipals = false } = {},
) {
  const document = resolvedTerraformPlanDocument(environment);
  if (!unknownPrincipals) {
    return document;
  }
  const resources =
    document.planned_values.root_module.child_modules.find(
      (module) => module.address === "module.policy",
    ).resources;
  const principalAddresses = new Set([
    "azurerm_subscription_policy_assignment.activity_log_diag",
    "azurerm_subscription_policy_assignment.inherit_env_tag",
    "azurerm_subscription_policy_assignment.inherit_team_tag",
    "azurerm_role_assignment.activity_log_diag_law",
    "azurerm_role_assignment.activity_log_diag_monitor",
    "azurerm_role_assignment.inherit_env_tag",
    "azurerm_role_assignment.inherit_team_tag",
  ]);
  for (const resource of resources) {
    const localAddress = resource.address.replace("module.policy.", "");
    if (!principalAddresses.has(localAddress)) {
      continue;
    }
    if (resource.type === "azurerm_role_assignment") {
      delete resource.values.principal_id;
      document.resource_changes.push({
        address: resource.address,
        type: resource.type,
        provider_name: resource.provider_name,
        change: {
          actions: ["create"],
          after_unknown: { principal_id: true },
        },
      });
    } else {
      delete resource.values.identity[0].principal_id;
      document.resource_changes.push({
        address: resource.address,
        type: resource.type,
        provider_name: resource.provider_name,
        change: {
          actions: ["create"],
          after_unknown: { identity: [{ principal_id: true }] },
        },
      });
    }
  }
  return document;
}

function writeReviewedPlan(
  input = createInput(),
  suffix = "reviewed",
  { unknownTerraformPrincipals = false } = {},
) {
  const directory = `${outputRelative}/${suffix}`;
  const plan = generateIacPlan(input, {
    outputPath: directory,
    providers: ["bicep", "terraform"],
    evaluatedAt,
  });
  plan.approval = {
    required: true,
    status: "approved",
    planId: plan.planId,
    planDigest: plan.planDigest,
    approvedAt: "2026-08-09T11:00:00Z",
    expiresAt: "2026-08-09T13:00:00Z",
    reapprovalRequired: false,
    invalidationReason: null,
  };
  plan.safety.rawArtifacts = "explicit-local-path";
  for (const preview of plan.previews) {
    preview.source = "command";
    preview.status = "succeeded";
    preview.changes = { create: 2, modify: 1, remove: 0 };
    preview.destructiveChanges = false;
    preview.errorClass = null;
    preview.message = "Preview completed; only sanitized change counts were retained.";
    if (preview.provider === "terraform") {
      const rawRelative = `${directory}/raw/terraform-${preview.environment}-primary-plan.txt`;
      const savedRelative = `${directory}/raw/${preview.environment}-primary.tfplan`;
      mkdirSync(dirname(resolve(root, rawRelative)), { recursive: true });
      writeFileSync(resolve(root, rawRelative), "sanitized preview output\n", {
        mode: 0o600,
      });
      writeFileSync(
        resolve(root, savedRelative),
        `saved-plan-${preview.environment}\n`,
        { mode: 0o600 },
      );
      preview.rawArtifact = rawRelative;
      const parameter = plan.artifacts.find(
        (artifact) =>
          artifact.provider === "terraform" &&
          artifact.environment === preview.environment &&
          artifact.regionRole === "primary",
      );
      const document = terraformPlanDocument(preview.environment, {
        unknownPrincipals: unknownTerraformPrincipals,
      });
      const planJsonRelative = `${directory}/raw/${preview.environment}-primary.plan.json`;
      writeFileSync(
        resolve(root, planJsonRelative),
        `${JSON.stringify(document, null, 2)}\n`,
        { mode: 0o600 },
      );
      preview.planJsonArtifact = planJsonRelative;
      const backend = plan.decisionModel.terraformBackend;
      const provenance = signTerraformProvenance(
        {
          sourceDigest: terraformSourceDigest(),
          parameterDigest: provenanceHashBytes(
            readFileSync(resolve(root, parameter.path)),
          ),
          backendDigest: provenanceHashCanonical({
            backend,
            arguments: [
              `-backend-config=subscription_id=${backend.subscriptionId}`,
              `-backend-config=resource_group_name=${backend.resourceGroupName}`,
              `-backend-config=storage_account_name=${backend.storageAccountName}`,
              `-backend-config=container_name=${backend.containerName}`,
              `-backend-config=key=${backend.keyPrefix}-${preview.environment}-primary.tfstate`,
              "-backend-config=use_oidc=true",
              "-backend-config=use_cli=false",
              "-backend-config=use_azuread_auth=true",
            ],
          }),
          providerLockDigest: provenanceHashBytes(
            readFileSync(resolve(root, "infra/terraform/.terraform.lock.hcl")),
          ),
          savedPlanDigest: provenanceHashBytes(
            readFileSync(resolve(root, savedRelative)),
          ),
          planJsonDigest: provenanceHashCanonical(document),
          configurationDigest: provenanceHashCanonical(
            document.configuration,
          ),
          plannedValuesDigest: provenanceHashCanonical(
            document.planned_values,
          ),
          providerConfigurationDigest: provenanceHashCanonical(
            document.configuration.provider_config,
          ),
          resourceChangesDigest: provenanceHashCanonical(
            document.resource_changes,
          ),
          variablesDigest: provenanceHashCanonical(document.variables),
          terraformVersion: document.terraform_version,
          terraformPlatform: terraformRuntimePlatform(),
          terraformExecutableDigest,
        },
        provenancePrivateKey,
      );
      const provenanceRelative = `${directory}/raw/${preview.environment}-primary.provenance.json`;
      writeFileSync(
        resolve(root, provenanceRelative),
        `${JSON.stringify(provenance, null, 2)}\n`,
        { mode: 0o600 },
      );
      preview.provenanceArtifact = provenanceRelative;
    }
  }
  const planPath = resolve(root, directory, "plan-summary.json");
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  return { plan, planPath, directory };
}

function assertRejectedSignedTerraformPlan(plan, planPath, mutate, expected) {
  const preview = plan.previews.find(
    (item) => item.provider === "terraform" && item.environment === "prod",
  );
  const planJsonPath = resolve(root, preview.planJsonArtifact);
  const provenancePath = resolve(root, preview.provenanceArtifact);
  const originalPlanJson = readFileSync(planJsonPath);
  const originalProvenance = readFileSync(provenancePath);
  try {
    const document = JSON.parse(originalPlanJson);
    mutate(document);
    writeFileSync(planJsonPath, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
    });
    const provenance = JSON.parse(originalProvenance);
    const resigned = signTerraformProvenance(
      {
        ...provenance,
        planJsonDigest: provenanceHashCanonical(document),
        configurationDigest: provenanceHashCanonical(document.configuration),
        plannedValuesDigest: provenanceHashCanonical(document.planned_values),
        providerConfigurationDigest: provenanceHashCanonical(
          document.configuration.provider_config,
        ),
        resourceChangesDigest: provenanceHashCanonical(
          document.resource_changes,
        ),
        variablesDigest: provenanceHashCanonical(document.variables),
      },
      provenancePrivateKey,
    );
    writeFileSync(
      provenancePath,
      `${JSON.stringify(resigned, null, 2)}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        buildDeploymentManifest(plan, {
          provider: "terraform",
          environment: "prod",
          planPath,
          evaluatedAt,
          runner: mockRuntime().runner,
          provenancePublicKey: provenancePublicKeyPem,
        }),
      expected,
    );
  } finally {
    writeFileSync(planJsonPath, originalPlanJson);
    writeFileSync(provenancePath, originalProvenance);
  }
}

function terraformVariables(environment = "prod") {
  return {
    subscription_id: { value: environment === "prod" ? prod : nonprod },
    resource_provider_registrations: { value: "none" },
    resource_providers_to_register: { value: [] },
    location: { value: "eastus2" },
    company_name: { value: "contoso" },
    environment: { value: environment },
    monthly_budget_amount: { value: environment === "prod" ? 500 : 200 },
    deploy_networking: { value: true },
    vnet_address_prefix: { value: "10.20.0.0/16" },
    app_subnet_delegation: { value: "Microsoft.App/environments" },
    enable_defender_for_servers: { value: true },
    enable_defender_for_containers: { value: false },
    enable_defender_for_databases: { value: true },
    enable_defender_for_key_vault: { value: true },
    budget_start_date: { value: "2026-08-01T00:00:00Z" },
    allowed_locations: { value: ["eastus2"] },
    log_retention_in_days: { value: 90 },
    log_daily_quota_gb: { value: 5 },
    budget_alert_emails: { value: ["budget-alerts@example.invalid"] },
    security_contact_email: { value: "security-alerts@example.invalid" },
  };
}

function terraformConfigurationResources() {
  const principals = {
    "module.policy.azurerm_role_assignment.activity_log_diag_law":
      "azurerm_subscription_policy_assignment.activity_log_diag",
    "module.policy.azurerm_role_assignment.activity_log_diag_monitor":
      "azurerm_subscription_policy_assignment.activity_log_diag",
    "module.policy.azurerm_role_assignment.inherit_env_tag":
      "azurerm_subscription_policy_assignment.inherit_env_tag",
    "module.policy.azurerm_role_assignment.inherit_team_tag":
      "azurerm_subscription_policy_assignment.inherit_team_tag",
  };
  return expectedTerraformResourceGraph().map((resource) => ({
    ...resource,
    provider_config_key: "azurerm",
    ...(principals[resource.address]
      ? {
          expressions: {
            principal_id: {
              references: [
                `${principals[resource.address]}.identity[0].principal_id`,
              ],
            },
          },
        }
      : {}),
  }));
}

function terraformRootConfiguration() {
  const resources = terraformConfigurationResources();
  const modules = [
    ["log_analytics", "./modules/monitoring"],
    ["networking", "./modules/networking"],
    ["policy", "./modules/policy"],
    ["security", "./modules/security"],
  ];
  return {
    resources: resources.filter(
      (resource) => !resource.address.startsWith("module."),
    ),
    module_calls: Object.fromEntries(
      modules.map(([name, source]) => {
        const prefix = `module.${name}.`;
        return [
          name,
          {
            source,
            module: {
              resources: resources
                .filter((resource) => resource.address.startsWith(prefix))
                .map((resource) => ({
                  ...resource,
                  address: resource.address.slice(prefix.length),
                })),
              module_calls: {},
            },
          },
        ];
      }),
    ),
  };
}

function terraformPolicyPlannedResources(environment = "prod") {
  const providerName = "registry.terraform.io/hashicorp/azurerm";
  const scope = `/subscriptions/${environment === "prod" ? prod : nonprod}`;
  return [
    [
      "module.policy.azurerm_subscription_policy_assignment.activity_log_diag",
      "azurerm_subscription_policy_assignment",
      {
        subscription_id: scope,
        identity: [{ principal_id: policyPrincipals.activity }],
      },
    ],
    [
      "module.policy.azurerm_subscription_policy_assignment.inherit_env_tag",
      "azurerm_subscription_policy_assignment",
      {
        subscription_id: scope,
        identity: [{ principal_id: policyPrincipals.environment }],
      },
    ],
    [
      "module.policy.azurerm_subscription_policy_assignment.inherit_team_tag",
      "azurerm_subscription_policy_assignment",
      {
        subscription_id: scope,
        identity: [{ principal_id: policyPrincipals.team }],
      },
    ],
    [
      "module.policy.azurerm_role_assignment.activity_log_diag_law",
      "azurerm_role_assignment",
      {
        scope,
        role_definition_name: "Log Analytics Contributor",
        principal_id: policyPrincipals.activity,
      },
    ],
    [
      "module.policy.azurerm_role_assignment.activity_log_diag_monitor",
      "azurerm_role_assignment",
      {
        scope,
        role_definition_name: "Monitoring Contributor",
        principal_id: policyPrincipals.activity,
      },
    ],
    [
      "module.policy.azurerm_role_assignment.inherit_env_tag",
      "azurerm_role_assignment",
      {
        scope,
        role_definition_name: "Tag Contributor",
        principal_id: policyPrincipals.environment,
      },
    ],
    [
      "module.policy.azurerm_role_assignment.inherit_team_tag",
      "azurerm_role_assignment",
      {
        scope,
        role_definition_name: "Tag Contributor",
        principal_id: policyPrincipals.team,
      },
    ],
  ].map(([address, type, values]) => ({
    address,
    type,
    provider_name: providerName,
    values,
  }));
}

function resolvedTerraformPlanDocument(environment = "prod") {
  return {
    format_version: "1.2",
    terraform_version: "1.9.8",
    variables: terraformVariables(environment),
    configuration: {
      provider_config: {
        azurerm: {
          full_name: "registry.terraform.io/hashicorp/azurerm",
          expressions: {
            subscription_id: {
              references: ["var.subscription_id"],
            },
            resource_provider_registrations: {
              references: ["var.resource_provider_registrations"],
            },
            resource_providers_to_register: {
              references: ["var.resource_providers_to_register"],
            },
          },
        },
      },
      root_module: terraformRootConfiguration(),
    },
    planned_values: {
      root_module: {
        resources: [
          {
            address: "azurerm_resource_group.monitoring",
            type: "azurerm_resource_group",
            provider_name: "registry.terraform.io/hashicorp/azurerm",
            values: {},
          },
          {
            address: "azurerm_resource_group.networking[0]",
            type: "azurerm_resource_group",
            provider_name: "registry.terraform.io/hashicorp/azurerm",
            values: {},
          },
          {
            address: "azurerm_consumption_budget_subscription.monthly",
            type: "azurerm_consumption_budget_subscription",
            provider_name: "registry.terraform.io/hashicorp/azurerm",
            values: {
              subscription_id: `/subscriptions/${
                environment === "prod" ? prod : nonprod
              }`,
              notification: Array.from({ length: 4 }, () => ({
                enabled: true,
                contact_emails: ["budget-alerts@example.invalid"],
              })),
            },
          },
        ],
        child_modules: [
          {
            address: "module.policy",
            resources: terraformPolicyPlannedResources(environment),
          },
          {
            address: "module.security",
            resources: [
              {
                address:
                  "module.security.azurerm_security_center_contact.default",
                type: "azurerm_security_center_contact",
                provider_name: "registry.terraform.io/hashicorp/azurerm",
                values: {
                  email: "security-alerts@example.invalid",
                },
              },
            ],
          },
        ],
      },
    },
    resource_changes: [
      {
        address: "azurerm_resource_group.monitoring",
        type: "azurerm_resource_group",
        provider_name: "registry.terraform.io/hashicorp/azurerm",
        change: { actions: ["create"] },
      },
      {
        address: "azurerm_resource_group.networking[0]",
        type: "azurerm_resource_group",
        provider_name: "registry.terraform.io/hashicorp/azurerm",
        change: { actions: ["update"] },
      },
    ],
  };
}

function terraformSourceDigest() {
  const files = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== ".terraform") {
          visit(child);
        }
      } else if (
        entry.isFile() &&
        (child.endsWith(".tf") ||
          child.endsWith(".terraform.lock.hcl") ||
          child.endsWith("sslz.deployment.tfrc"))
      ) {
        files.push(child);
      }
    }
  }
  visit(resolve(root, "infra/terraform"));
  return provenanceHashCanonical(
    files
      .sort((left, right) => left.localeCompare(right))
      .map((path) => ({
        path: path.slice(root.length + 1).replaceAll("\\", "/"),
        digest: provenanceHashBytes(readFileSync(path)),
      })),
  );
}

function bicepCompiledTemplate() {
  const resource = (type, properties = {}) => ({
    type,
    apiVersion: "2024-01-01",
    name: `[uniqueString('${type}', resourceGroup().id)]`,
    properties,
  });
  const resources = (entries) =>
    Object.fromEntries(
      entries.map((item, index) => [`resource${index}`, item]),
    );
  const nested = (entries, variables = {}, parameters = {}) =>
    resource("Microsoft.Resources/deployments", {
      mode: "Incremental",
      expressionEvaluationOptions: { scope: "inner" },
      parameters,
      template: {
        languageVersion: "2.0",
        contentVersion: "1.0.0.0",
        variables,
        resources: resources(entries),
        outputs: {},
      },
    });
  const scopedNested = (entries, resourceGroup, variables = {}) => ({
    ...nested(entries, variables),
    ...(resourceGroup ? { resourceGroup } : {}),
  });
  const roleDefinitions = {
    tagContributor:
      "/providers/Microsoft.Authorization/roleDefinitions/4a9ae827-6dc8-4573-8ac7-8239d42aa03f",
    logAnalyticsContributor:
      "/providers/Microsoft.Authorization/roleDefinitions/92aaf0da-9dab-42b6-94a3-d43ce8d16293",
    monitoringContributor:
      "/providers/Microsoft.Authorization/roleDefinitions/749f88d5-cbae-40b8-bcfc-e573ddc772fa",
  };
  const role = (alias, principal) =>
    resource("Microsoft.Authorization/roleAssignments", {
      roleDefinitionId: `[variables('roleDefinitions').${alias}]`,
      principalId: `[reference('${principal}', '2024-04-01', 'full').identity.principalId]`,
      principalType: "ServicePrincipal",
    });
  const policyResources = [
    ...Array.from({ length: 8 }, () =>
      resource("Microsoft.Authorization/policyAssignments"),
    ),
    role("tagContributor", "inheritEnvironmentTag"),
    role("tagContributor", "inheritTeamTag"),
    role("logAnalyticsContributor", "activityLogDiagAssignment"),
    role("monitoringContributor", "activityLogDiagAssignment"),
  ];
  const template = {
    $schema:
      "https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#",
    languageVersion: "2.0",
    contentVersion: "1.0.0.0",
    resources: {
      rgMonitoringRes: resource("Microsoft.Resources/resourceGroups"),
      rgNetworkingRes: resource("Microsoft.Resources/resourceGroups"),
      activityLogDiag: resource("Microsoft.Insights/diagnosticSettings"),
      logAnalytics: scopedNested(
        [resource("Microsoft.OperationalInsights/workspaces")],
        "[variables('rgMonitoring')]",
      ),
      networking: scopedNested([
        ...Array.from({ length: 4 }, () =>
          resource("Microsoft.Network/networkSecurityGroups"),
        ),
        resource("Microsoft.Network/virtualNetworks"),
      ], "[variables('rgNetworking')]"),
      defender: nested(
        [
          ...Array.from({ length: 9 }, () =>
            resource("Microsoft.Security/pricings"),
          ),
          resource("Microsoft.Security/securityContacts", {
            emails: "[parameters('securityContactEmail')]",
          }),
        ],
        {},
        {
          securityContactEmail: {
            value: "[parameters('securityContactEmail')]",
          },
        },
      ),
      budgets: nested(
        [
          resource("Microsoft.Consumption/budgets", {
            notifications: Object.fromEntries(
              ["fifty", "eighty", "hundred", "forecast"].map((name) => [
                name,
                { contactEmails: "[parameters('contactEmails')]" },
              ]),
            ),
          }),
        ],
        {},
        {
          contactEmails: { value: "[parameters('budgetAlertEmails')]" },
        },
      ),
      policies: nested(policyResources, { roleDefinitions }),
    },
    outputs: Object.fromEntries(
      [
        "logAnalyticsWorkspaceId",
        "logAnalyticsWorkspaceName",
        "resourceGroupMonitoring",
        "resourceGroupNetworking",
        "vnetId",
        "vnetName",
      ].map((name) => [name, { type: "string", value: "fixture" }]),
    ),
  };
  template.resources.logAnalytics.properties.template.outputs = {
    workspaceId: { type: "string", value: "fixture" },
    workspaceName: { type: "string", value: "fixture" },
  };
  template.resources.networking.properties.template.outputs =
    Object.fromEntries(
      [
        "aksSubnetId",
        "appSubnetId",
        "dataSubnetId",
        "sharedSubnetId",
        "vnetId",
        "vnetName",
      ].map((name) => [name, { type: "string", value: "fixture" }]),
    );
  return template;
}

function bicepCompiledParameters(environment = "prod") {
  return {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: Object.fromEntries(
      Object.entries({
        location: "eastus2",
        companyName: "contoso",
        environment,
        monthlyBudgetAmount: environment === "prod" ? 500 : 200,
        budgetAlertEmails: ["budget-alerts@example.invalid"],
        deployNetworking: true,
        vnetAddressPrefix: "10.20.0.0/16",
        appSubnetDelegation: "Microsoft.App/environments",
        enableDefenderForServers: true,
        enableDefenderForContainers: false,
        enableDefenderForDatabases: true,
        enableDefenderForKeyVault: true,
        securityContactEmail: "security-alerts@example.invalid",
        budgetStartDate: "2026-08-01T00:00:00Z",
        allowedLocations: ["eastus2"],
        logRetentionInDays: 90,
        logDailyQuotaGb: 5,
      }).map(([name, value]) => [name, { value }]),
    ),
  };
}

function mockRuntime({
  accountId = prod,
  accountTenantId = tenantId,
  accountState = "Enabled",
  deploymentStatus = 0,
  unhealthyCheck = null,
  unhealthyAttempts = 0,
  previewStatus = 0,
  rawError = "",
  unexpectedRole = false,
  terraformVersion = "1.9.8",
  terraformPlatform = terraformRuntimePlatform(),
  mutateBicepTemplate = null,
} = {}) {
  const calls = [];
  let budgetReads = 0;
  const runner = (executable, args, options = {}) => {
    calls.push({
      executable,
      args: [...args],
      environmentKeys: Object.keys(options.environment ?? {}).sort(),
      terraformCliConfigPath: options.terraformCliConfigPath ?? null,
    });
    if (executable === "terraform" && args[0] === "version") {
      return {
        status: 0,
        stdout: JSON.stringify({
          terraform_version: terraformVersion,
          platform: terraformPlatform,
        }),
        stderr: "",
      };
    }
    if (executable === "terraform" && args[1] === "init") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (executable === "terraform" && args[1] === "apply") {
      return { status: deploymentStatus, stdout: "", stderr: rawError };
    }
    if (
      executable === "bicep" &&
      args[0] === "build-params"
    ) {
      const template = bicepCompiledTemplate();
      mutateBicepTemplate?.(template);
      return {
        status: 0,
        stdout: JSON.stringify({
          parametersJson: JSON.stringify(bicepCompiledParameters()),
          templateJson: JSON.stringify(template),
          templateSpecId: null,
        }),
        stderr: "",
      };
    }
    if (
      executable === "az" &&
      args[0] === "deployment" &&
      args[2] === "what-if"
    ) {
      return {
        status: previewStatus,
        stdout:
          previewStatus === 0
            ? JSON.stringify({
                changes: [
                  {
                    changeType: "Create",
                    resourceId: `/subscriptions/${prod}/resourceGroups/rg-contoso-prod-monitoring`,
                  },
                  {
                    changeType: "Modify",
                    resourceId: `/subscriptions/${prod}/resourceGroups/rg-contoso-prod-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-contoso-prod`,
                  },
                ],
              })
            : "",
        stderr: rawError,
      };
    }
    if (
      executable === "az" &&
      args[0] === "deployment" &&
      args[2] === "create"
    ) {
      return { status: deploymentStatus, stdout: "", stderr: rawError };
    }
    if (executable === "az" && args[0] === "account") {
      return {
        status: 0,
        stdout: JSON.stringify({
          id: accountId,
          tenantId: accountTenantId,
          state: accountState,
        }),
        stderr: "",
      };
    }
    if (executable === "az" && args[0] === "group") {
      const name = args[args.indexOf("--name") + 1];
      return {
        status: 0,
        stdout: JSON.stringify({
          name,
          location: "eastus2",
          provisioningState: "Succeeded",
        }),
        stderr: "",
      };
    }
    if (args[0] === "monitor" && args[1] === "log-analytics") {
      return {
        status: 0,
        stdout: JSON.stringify({
          id: `/subscriptions/${prod}/resourceGroups/rg-contoso-prod-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-contoso-prod`,
          name: "law-contoso-prod",
          location: "eastus2",
          retentionInDays: 90,
          dailyQuotaGb: 5,
          provisioningState: "Succeeded",
        }),
        stderr: "",
      };
    }
    if (args[0] === "monitor" && args[1] === "diagnostic-settings") {
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            name: "diag-activity-log-to-law",
            workspaceId: `/subscriptions/${prod}/resourceGroups/rg-contoso-prod-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-contoso-prod`,
            logs: [
              "Administrative",
              "Security",
              "Alert",
              "Policy",
              "ServiceHealth",
              "Recommendation",
              "Autoscale",
              "ResourceHealth",
            ].map((category) => ({ category, enabled: true })),
          },
        ]),
        stderr: "",
      };
    }
    if (args[0] === "policy") {
      const scope = `/subscriptions/${prod}`;
      const policyDefinitions = {
        "activity-log-diag":
          "/providers/Microsoft.Authorization/policyDefinitions/2465583e-4e78-4c15-b6be-a36cbc7c8b0f",
        "allowed-locations":
          "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c",
        "allowed-locations-rg":
          "/providers/Microsoft.Authorization/policyDefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988",
        "inherit-env-tag":
          "/providers/Microsoft.Authorization/policyDefinitions/cd3aa116-8754-49c9-a813-ad46512ece54",
        "inherit-team-tag":
          "/providers/Microsoft.Authorization/policyDefinitions/cd3aa116-8754-49c9-a813-ad46512ece54",
        "mcsb-audit":
          "/providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8",
        "require-env-tag-rg":
          "/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025",
        "require-team-tag-rg":
          "/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025",
      };
      const policies = [
        "activity-log-diag",
        "allowed-locations",
        "allowed-locations-rg",
        "inherit-env-tag",
        "inherit-team-tag",
        "mcsb-audit",
        "require-env-tag-rg",
        "require-team-tag-rg",
      ].map((name) => ({
        name,
        scope,
        enforcementMode: "Default",
        policyDefinitionId:
          unhealthyCheck === "policy-definition" &&
          name === "allowed-locations"
            ? policyDefinitions["mcsb-audit"]
            : policyDefinitions[name],
        location: [
          "activity-log-diag",
          "inherit-env-tag",
          "inherit-team-tag",
        ].includes(name)
          ? "eastus2"
          : null,
        principalId:
          name === "activity-log-diag"
            ? policyPrincipals.activity
            : name === "inherit-env-tag"
              ? policyPrincipals.environment
              : name === "inherit-team-tag"
                ? policyPrincipals.team
                : null,
        parameters:
          name === "allowed-locations" || name === "allowed-locations-rg"
            ? { listOfAllowedLocations: { value: ["eastus2"] } }
            : name === "activity-log-diag"
              ? {
                  logAnalytics: {
                    value: `/subscriptions/${prod}/resourceGroups/rg-contoso-prod-monitoring/providers/Microsoft.OperationalInsights/workspaces/law-contoso-prod`,
                  },
                }
              : name === "require-env-tag-rg" ||
                  name === "inherit-env-tag"
                ? { tagName: { value: "environment" } }
                : name === "require-team-tag-rg" ||
                    name === "inherit-team-tag"
                  ? { tagName: { value: "team" } }
                  : {},
      }));
      return { status: 0, stdout: JSON.stringify(policies), stderr: "" };
    }
    if (args[0] === "role" && args[1] === "assignment") {
      const scope = `/subscriptions/${prod}`;
      const roleDefinitionId = (id) =>
        `${scope}/providers/Microsoft.Authorization/roleDefinitions/${id}`;
      return {
        status: 0,
        stdout: JSON.stringify([
          {
            scope,
            principalId: policyPrincipals.environment,
            roleDefinitionId: roleDefinitionId(
              "4a9ae827-6dc8-4573-8ac7-8239d42aa03f",
            ),
          },
          {
            scope,
            principalId: policyPrincipals.team,
            roleDefinitionId: roleDefinitionId(
              "4a9ae827-6dc8-4573-8ac7-8239d42aa03f",
            ),
          },
          {
            scope,
            principalId: policyPrincipals.activity,
            roleDefinitionId: roleDefinitionId(
              "92aaf0da-9dab-42b6-94a3-d43ce8d16293",
            ),
          },
          {
            scope,
            principalId: policyPrincipals.activity,
            roleDefinitionId: roleDefinitionId(
              "749f88d5-cbae-40b8-bcfc-e573ddc772fa",
            ),
          },
          ...(unexpectedRole
            ? [
                {
                  scope,
                  principalId: policyPrincipals.activity,
                  roleDefinitionId: roleDefinitionId(
                    "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
                  ),
                },
              ]
            : []),
        ]),
        stderr: "",
      };
    }
    if (args[0] === "security") {
      if (args[1] === "contact") {
        return {
          status: 0,
          stdout: JSON.stringify({
            emails:
              unhealthyCheck === "contacts"
                ? "attacker@example.com"
                : "security-alerts@example.invalid",
            isEnabled: true,
            notificationsByRole: { state: "On" },
          }),
          stderr: "",
        };
      }
      const tiers = {
        CloudPosture: ["Free", null],
        VirtualMachines: ["Standard", "P2"],
        Containers: ["Free", null],
        SqlServers: ["Standard", null],
        OpenSourceRelationalDatabases: ["Standard", null],
        KeyVaults: ["Standard", null],
        Arm: ["Standard", null],
        StorageAccounts: [
          "Standard",
          unhealthyCheck === "storage-subplan"
            ? "DefenderForStorage"
            : "DefenderForStorageV2",
        ],
      };
      const name = args[args.indexOf("--name") + 1];
      const [pricingTier, subPlan] = tiers[name] ?? [];
      return {
        status: pricingTier ? 0 : 1,
        stdout: pricingTier
          ? JSON.stringify({ name, pricingTier, subPlan })
          : "",
        stderr: "",
      };
    }
    if (args[0] === "consumption") {
      budgetReads += 1;
      const unhealthy =
        unhealthyCheck === "budget" &&
        (unhealthyAttempts === 0 || budgetReads <= unhealthyAttempts);
      return {
        status: 0,
        stdout: JSON.stringify({
          name: "budget-contoso-prod-monthly",
          amount: unhealthy ? 999 : 500,
          timeGrain: "Monthly",
          notifications: {
            fifty: {
              enabled: true,
              threshold: 50,
              thresholdType: "Actual",
              contactEmails: ["budget-alerts@example.invalid"],
            },
            eighty: {
              enabled: true,
              threshold: 80,
              thresholdType: "Actual",
              contactEmails: ["budget-alerts@example.invalid"],
            },
            hundred: {
              enabled: true,
              threshold: 100,
              thresholdType: "Actual",
              contactEmails: ["budget-alerts@example.invalid"],
            },
            forecast: {
              enabled: true,
              threshold: 100,
              thresholdType: "Forecasted",
              contactEmails: ["budget-alerts@example.invalid"],
            },
          },
        }),
        stderr: "",
      };
    }
    if (args[0] === "network") {
      if (args[1] === "vnet" && args[2] === "subnet") {
        const resourceGroup = "rg-contoso-prod-networking";
        const nsgId = (name) =>
          `/subscriptions/${prod}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkSecurityGroups/nsg-${name}`;
        const subnets = [
          {
            name: "snet-aks",
            addressPrefix: "10.20.0.0/20",
            networkSecurityGroupId: nsgId("snet-aks"),
            delegations: [],
            provisioningState: "Succeeded",
          },
          {
            name: "snet-app",
            addressPrefix: "10.20.16.0/22",
            networkSecurityGroupId: nsgId("snet-app"),
            delegations: ["Microsoft.App/environments"],
            provisioningState: "Succeeded",
          },
          {
            name: "snet-data",
            addressPrefix: "10.20.20.0/22",
            networkSecurityGroupId: nsgId("snet-data"),
            delegations: [],
            provisioningState: "Succeeded",
          },
          {
            name: "snet-shared",
            addressPrefix: "10.20.24.0/24",
            networkSecurityGroupId: nsgId("snet-shared"),
            delegations: [],
            provisioningState: "Succeeded",
          },
        ];
        return {
          status: 0,
          stdout: JSON.stringify(
            unhealthyCheck === "networking" ? subnets.slice(0, 3) : subnets,
          ),
          stderr: "",
        };
      }
      if (args[1] === "nsg") {
        const denyAll = {
          name: "DenyAllInbound",
          priority: 4096,
          direction: "Inbound",
          access: "Deny",
          protocol: "*",
          sourceAddressPrefix: "*",
          sourcePortRange: "*",
          destinationAddressPrefix: "*",
          destinationPortRange: "*",
          destinationPortRanges: null,
        };
        const nsg = (name, securityRules) => ({
          name,
          location: "eastus2",
          provisioningState: "Succeeded",
          securityRules,
        });
        return {
          status: 0,
          stdout: JSON.stringify([
            nsg("nsg-snet-aks", [
              {
                name: "AllowAzureLoadBalancerInbound",
                priority: 110,
                direction: "Inbound",
                access: "Allow",
                protocol: "*",
                sourceAddressPrefix: "AzureLoadBalancer",
                sourcePortRange: "*",
                destinationAddressPrefix: "*",
                destinationPortRange: "*",
                destinationPortRanges: null,
              },
              {
                name: "AllowVNetInbound",
                priority: 120,
                direction: "Inbound",
                access: "Allow",
                protocol: "*",
                sourceAddressPrefix: "VirtualNetwork",
                sourcePortRange: "*",
                destinationAddressPrefix: "VirtualNetwork",
                destinationPortRange: "*",
                destinationPortRanges: null,
              },
              denyAll,
            ]),
            nsg("nsg-snet-app", [denyAll]),
            nsg("nsg-snet-data", [
              {
                name: "AllowFromAksSubnet",
                priority: 110,
                direction: "Inbound",
                access: "Allow",
                protocol: "Tcp",
                sourceAddressPrefix: "10.20.0.0/20",
                sourcePortRange: "*",
                destinationAddressPrefix: "*",
                destinationPortRange: null,
                destinationPortRanges: ["1433", "5432", "6380", "443"],
              },
              {
                name: "AllowFromAppSubnet",
                priority: 120,
                direction: "Inbound",
                access: "Allow",
                protocol: "Tcp",
                sourceAddressPrefix: "10.20.16.0/22",
                sourcePortRange: "*",
                destinationAddressPrefix: "*",
                destinationPortRange: null,
                destinationPortRanges: ["1433", "5432", "6380", "443"],
              },
              denyAll,
            ]),
            nsg("nsg-snet-shared", [denyAll]),
          ]),
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          name: "vnet-contoso-prod",
          location: "eastus2",
          provisioningState: "Succeeded",
          addressPrefixes: ["10.20.0.0/16"],
        }),
        stderr: "",
      };
    }
    return { status: 2, stdout: "", stderr: rawError };
  };
  return { calls, runner };
}

function createApproval(manifest, overrides = {}, signingKey = privateKey) {
  const approval = {
    schemaVersion: "1.0.0",
    status: "approved",
    manifestVersion: manifest.manifestVersion,
    manifestDigest: manifest.manifestDigest,
    planVersion: manifest.plan.version,
    planId: manifest.plan.id,
    planDigest: manifest.plan.digest,
    readinessEvidenceVersion: manifest.readinessEvidence.version,
    readinessEvidenceId: manifest.readinessEvidence.id,
    readinessEvidenceDigest: manifest.readinessEvidence.digest,
    readinessEvidenceExpiresAt: manifest.readinessEvidence.expiresAt,
    operation: manifest.execution.operation,
    provider: manifest.execution.provider,
    environment: manifest.execution.environment,
    regionRole: manifest.execution.regionRole,
    tenantId: manifest.execution.tenantId,
    subscriptionId: manifest.execution.subscriptionId,
    scope: manifest.execution.scope,
    region: manifest.execution.region,
    parameterDigest: manifest.artifacts.parameter.digest,
    sourceDigest: manifest.artifacts.source.digest,
    savedPlanDigest: manifest.artifacts.savedPlan?.digest ?? null,
    planJsonDigest: manifest.artifacts.planJson?.digest ?? null,
    notificationContactsDigest:
      manifest.preview.bicepAttestation?.notificationContactsDigest ??
      manifest.preview.terraformAttestation?.notificationContactsDigest,
    terraformAuthMode: manifest.execution.terraformAuthMode,
    stateStoreId: manifest.execution.stateStoreId,
    nonce: "a".repeat(64),
    approvedAt: "2026-08-09T11:30:00Z",
    expiresAt: "2026-08-09T12:30:00Z",
    signatureAlgorithm: "Ed25519",
    keyId: keyFingerprint(
      signingKey === privateKey
        ? publicKeyPem
        : generateKeyPairSync("ed25519").publicKey,
    ),
    ...overrides,
  };
  if (overrides.keyId === undefined && signingKey !== privateKey) {
    approval.keyId = keyFingerprint(otherPublicKeyPem);
  }
  approval.signature = sign(
    null,
    approvalSigningMessage(approval),
    signingKey,
  ).toString("base64");
  return approval;
}

function resign(approval, overrides) {
  const changed = { ...approval, ...overrides };
  delete changed.signature;
  changed.signature = sign(
    null,
    approvalSigningMessage(changed),
    privateKey,
  ).toString("base64");
  return changed;
}

function apply(
  plan,
  planPath,
  manifest,
  approval,
  runtime,
  suffix,
  options = {},
) {
  const result = runDeploymentIntegration(
    plan,
    manifest,
    approval,
    publicKeyPem,
    {
      mode: "apply",
      planPath,
      evaluatedAt,
      clock: () => evaluatedAt,
      runner: runtime.runner,
      provenancePublicKey: provenancePublicKeyPem,
      statePath: stateRelative,
      maximumValidationAttempts: options.maximumValidationAttempts ?? 1,
      sleep: () => {},
    },
  );
  validateDocument(resultSchema, result);
  return result;
}

function assertSanitized(value) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /fixture-secret|founder@startup\.example|attacker@example\.com|authorization:\s*bearer|private-key/i,
  );
}

let ownsStatePath = false;
try {
  if (existsSync(statePath)) {
    throw new Error(
      "Refusing to run deployment integration tests over an existing replay store.",
    );
  }
  mkdirSync(statePath, { recursive: true, mode: 0o700 });
  chmodSync(statePath, 0o700);
  ownsStatePath = true;
  writeFileSync(
    resolve(statePath, ".durable-store.json"),
    `${JSON.stringify(
      { schemaVersion: "1.0.0", durable: true, storeId: stateStoreId },
      null,
      2,
    )}\n`,
    { mode: 0o400 },
  );
  if (process.platform === "win32") {
    const invocation = azureCliInvocation(["version"]);
    assert.match(invocation.executable, /python\.exe$/i);
    assert.deepEqual(invocation.arguments.slice(0, 3), [
      "-IBm",
      "azure.cli",
      "version",
    ]);
  }
  const { plan, planPath } = writeReviewedPlan();
  const previewRuntime = mockRuntime();
  const bicepManifest = buildDeploymentManifest(plan, {
    provider: "bicep",
    environment: "prod",
    planPath,
    evaluatedAt,
    runner: previewRuntime.runner,
  });
  validateDocument(manifestSchema, bicepManifest);
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: mockRuntime({
          mutateBicepTemplate: (template) => {
            template.outputs.exfiltrated = {
              type: "string",
              value:
                "[listKeys(resourceId('Microsoft.Storage/storageAccounts', 'attacker'), '2023-01-01').keys[0].value]",
            };
          },
        }).runner,
      }),
    /runtime data access|unexpected deployment outputs|invalid/,
  );
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: mockRuntime({
          mutateBicepTemplate: (template) => {
            template.outputs.exfiltrated = {
              type: "string",
              value: "[parameters('companyName')]",
            };
          },
        }).runner,
      }),
    /unexpected deployment outputs/,
  );
  assert.equal(bicepManifest.safety.previewWrites, 0);
  assert.equal(bicepManifest.safety.bicepMode, "Incremental");
  assert.match(
    bicepManifest.preview.bicepAttestation.compiledTemplateDigest,
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.match(
    bicepManifest.preview.bicepAttestation.compiledParametersDigest,
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.match(
    bicepManifest.preview.bicepAttestation.resourceGraphDigest,
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.equal(bicepManifest.execution.regionRole, "primary");
  assert.equal(bicepManifest.safety.secondaryRegionDeployment, false);
  assert.equal(bicepManifest.safety.workloadDeployment, false);
  assert.deepEqual(readdirSync(statePath), [".durable-store.json"]);
  assert.equal(
    previewRuntime.calls.filter(
      (call) =>
        call.executable === "az" &&
        call.args[0] === "deployment" &&
        call.args[2] === "what-if",
    ).length,
    1,
  );

  const deterministicManifest = buildDeploymentManifest(plan, {
    provider: "bicep",
    environment: "prod",
    planPath,
    evaluatedAt,
    runner: mockRuntime().runner,
  });
  assert.deepEqual(deterministicManifest, bicepManifest);

  const contactOverrideRuntime = mockRuntime();
  const contactOverrideRunner = contactOverrideRuntime.runner;
  contactOverrideRuntime.runner = (executable, args, options) => {
    const response = contactOverrideRunner(executable, args, options);
    if (executable === "bicep" && args[0] === "build-params") {
      const build = JSON.parse(response.stdout);
      const parameters = JSON.parse(build.parametersJson);
      parameters.parameters.budgetAlertEmails.value = [
        "platform@example.com",
        "cto@example.com",
      ];
      parameters.parameters.securityContactEmail.value =
        "security@example.com";
      build.parametersJson = JSON.stringify(parameters);
      response.stdout = JSON.stringify(build);
    }
    return response;
  };
  const contactOverrideManifest = buildDeploymentManifest(plan, {
    provider: "bicep",
    environment: "prod",
    planPath,
    evaluatedAt,
    runner: contactOverrideRuntime.runner,
  });
  assert.notEqual(
    contactOverrideManifest.preview.bicepAttestation
      .compiledParametersDigest,
    bicepManifest.preview.bicepAttestation.compiledParametersDigest,
  );

  const unsafeContactRuntime = mockRuntime();
  const unsafeContactRunner = unsafeContactRuntime.runner;
  unsafeContactRuntime.runner = (executable, args, options) => {
    const response = unsafeContactRunner(executable, args, options);
    if (executable === "bicep" && args[0] === "build-params") {
      const build = JSON.parse(response.stdout);
      const parameters = JSON.parse(build.parametersJson);
      parameters.parameters.securityContactEmail.value =
        "security@example.com\ninjected";
      build.parametersJson = JSON.stringify(parameters);
      response.stdout = JSON.stringify(build);
    }
    return response;
  };
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: unsafeContactRuntime.runner,
      }),
    /unique safe email addresses/,
  );

  const bicepBuildMutation = (mutate) => {
    const runtime = mockRuntime();
    const originalRunner = runtime.runner;
    runtime.runner = (executable, args, options) => {
      const response = originalRunner(executable, args, options);
      if (executable === "bicep" && args[0] === "build-params") {
        const build = JSON.parse(response.stdout);
        const document = JSON.parse(build.templateJson);
        mutate(document);
        build.templateJson = JSON.stringify(document);
        response.stdout = JSON.stringify(build);
      }
      return response;
    };
    return runtime;
  };
  const ownerRoleBuild = bicepBuildMutation((document) => {
    document.resources.policies.properties.template.variables.roleDefinitions.tagContributor =
      "/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
  });
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: ownerRoleBuild.runner,
      }),
    /unexpected role or principal/,
  );
  const hardcodedBicepContact = bicepBuildMutation((document) => {
    document.resources.defender.properties.template.resources.resource9.properties.emails =
      "attacker@example.com";
  });
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: hardcodedBicepContact.runner,
      }),
    /do not consume the approved notification-contact parameters/,
  );
  const scriptBuild = bicepBuildMutation((document) => {
    document.resources.logAnalytics.properties.template.resources.resource0.type =
      "Microsoft.Resources/deploymentScripts";
  });
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: scriptBuild.runner,
      }),
    /unexpected resource type or scope/,
  );
  const copiedResourceBuild = bicepBuildMutation((document) => {
    document.resources.logAnalytics.copy = {
      name: "duplicateBaseline",
      count: 2,
    };
  });
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: copiedResourceBuild.runner,
      }),
    /invalid, externally linked, or contains script content/,
  );
  const linkedTemplateBuild = bicepBuildMutation((document) => {
    const properties = document.resources.logAnalytics.properties;
    delete properties.template;
    properties.templateLink = { uri: "https://example.invalid/template.json" };
  });
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: linkedTemplateBuild.runner,
      }),
    /externally linked/,
  );
  const scopedResourceBuild = bicepBuildMutation((document) => {
    document.resources.rgMonitoringRes.scope = `[subscriptionResourceId('Microsoft.Resources/resourceGroups', 'other')]`;
  });
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: scopedResourceBuild.runner,
      }),
    /unexpected resource type or scope/,
  );
  const unexpectedWhatIf = mockRuntime();
  const unexpectedWhatIfRunner = unexpectedWhatIf.runner;
  unexpectedWhatIf.runner = (executable, args, options) => {
    const response = unexpectedWhatIfRunner(executable, args, options);
    if (executable === "az" && args[0] === "deployment") {
      response.stdout = JSON.stringify({
        changes: [
          {
            changeType: "Create",
            resourceId: `/subscriptions/${prod}/providers/Microsoft.Resources/deploymentScripts/run-anything`,
          },
        ],
      });
    }
    return response;
  };
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: unexpectedWhatIf.runner,
      }),
    /resource type outside/,
  );
  const crossSubscriptionWhatIf = mockRuntime();
  const crossSubscriptionWhatIfRunner = crossSubscriptionWhatIf.runner;
  crossSubscriptionWhatIf.runner = (executable, args, options) => {
    const response = crossSubscriptionWhatIfRunner(
      executable,
      args,
      options,
    );
    if (executable === "az" && args[0] === "deployment") {
      response.stdout = JSON.stringify({
        changes: [
          {
            changeType: "Create",
            resourceId: `/subscriptions/${nonprod}/resourceGroups/rg-cross-scope`,
          },
        ],
      });
    }
    return response;
  };
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: crossSubscriptionWhatIf.runner,
      }),
    /exact reviewed resource groups/,
  );
  const reviewedBicepParameterPath = resolve(
    root,
    bicepManifest.artifacts.parameter.path,
  );
  const reviewedBicepParameter = readFileSync(
    reviewedBicepParameterPath,
    "utf8",
  );
  try {
    writeFileSync(
      reviewedBicepParameterPath,
      `${reviewedBicepParameter}\nparam companyName = readEnvironmentVariable('UNREVIEWED_COMPANY')\n`,
    );
    assert.throws(
      () =>
        buildDeploymentManifest(plan, {
          provider: "bicep",
          environment: "prod",
          planPath,
          evaluatedAt,
          runner: mockRuntime().runner,
        }),
      /cannot read the environment/,
    );
  } finally {
    writeFileSync(reviewedBicepParameterPath, reviewedBicepParameter);
  }
  const reviewedBicepSourcePath = resolve(root, "infra/bicep/main.bicep");
  const reviewedBicepSource = readFileSync(reviewedBicepSourcePath, "utf8");
  try {
    writeFileSync(
      reviewedBicepSourcePath,
      `${reviewedBicepSource}\nmodule escaped '../outside.bicep' = { name: 'escaped' }\n`,
    );
    assert.throws(
      () =>
        buildDeploymentManifest(plan, {
          provider: "bicep",
          environment: "prod",
          planPath,
          evaluatedAt,
          runner: mockRuntime().runner,
        }),
      /inside infra\/bicep/,
    );
  } finally {
    writeFileSync(reviewedBicepSourcePath, reviewedBicepSource);
  }
  try {
    writeFileSync(
      reviewedBicepSourcePath,
      `${reviewedBicepSource}\nvar escaped = loadTextContent/* bypass */('../secret.txt')\n`,
    );
    assert.throws(
      () =>
        buildDeploymentManifest(plan, {
          provider: "bicep",
          environment: "prod",
          planPath,
          evaluatedAt,
          runner: mockRuntime().runner,
        }),
      /cannot load content/,
    );
  } finally {
    writeFileSync(reviewedBicepSourcePath, reviewedBicepSource);
  }

  const approval = createApproval(bicepManifest);
  const missingDurableRuntime = mockRuntime();
  const missingDurableState = runDeploymentIntegration(
    plan,
    bicepManifest,
    approval,
    publicKeyPem,
    {
      mode: "apply",
      planPath,
      evaluatedAt,
      clock: () => evaluatedAt,
      runner: missingDurableRuntime.runner,
      statePath: `${stateRelative}/mismatched-store`,
    },
  );
  validateDocument(resultSchema, missingDurableState);
  assert.equal(
    missingDurableState.code,
    "deployment.state.path",
  );
  assert.equal(missingDurableRuntime.calls.length, 0);
  const originalStatePath = `${statePath}-original`;
  renameSync(statePath, originalStatePath);
  try {
    mkdirSync(statePath, { recursive: true, mode: 0o700 });
    chmodSync(statePath, 0o700);
    writeFileSync(
      resolve(statePath, ".durable-store.json"),
      readFileSync(resolve(originalStatePath, ".durable-store.json")),
      { mode: 0o400 },
    );
    const copiedStoreState = runDeploymentIntegration(
      plan,
      bicepManifest,
      approval,
      publicKeyPem,
      {
        mode: "apply",
        planPath,
        evaluatedAt,
        clock: () => evaluatedAt,
        runner: missingDurableRuntime.runner,
        statePath: stateRelative,
      },
    );
    assert.equal(copiedStoreState.code, "deployment.state.store-mismatch");
  } finally {
    rmSync(statePath, { recursive: true, force: true });
    renameSync(originalStatePath, statePath);
  }
  const noApproval = apply(
    plan,
    planPath,
    bicepManifest,
    null,
    mockRuntime(),
    "no-approval",
  );
  assert.equal(noApproval.code, "deployment.approval.required");

  for (const status of ["pending", "declined", "consumed"]) {
    const artifact = resign(approval, { status });
    const runtime = mockRuntime();
    const result = apply(
      plan,
      planPath,
      bicepManifest,
      artifact,
      runtime,
      `status-${status}`,
    );
    assert.equal(result.status, "rejected");
    assert.equal(result.approval.status, status);
    assert.equal(runtime.calls.length, 0);
  }

  for (const [name, artifact, code] of [
    [
      "expired",
      resign(approval, {
        approvedAt: "2026-08-09T10:00:00Z",
        expiresAt: "2026-08-09T11:00:00Z",
      }),
      "deployment.approval.expired",
    ],
    [
      "future",
      resign(approval, {
        approvedAt: "2026-08-09T12:10:00Z",
        expiresAt: "2026-08-09T13:00:00Z",
      }),
      "deployment.approval.window",
    ],
    [
      "overlong",
      resign(approval, {
        approvedAt: "2026-08-08T11:00:00Z",
        expiresAt: "2026-08-09T12:30:00Z",
      }),
      "deployment.approval.window",
    ],
  ]) {
    assert.equal(
      apply(
        plan,
        planPath,
        bicepManifest,
        artifact,
        mockRuntime(),
        name,
      ).code,
      code,
    );
  }

  const invalidSignature = { ...approval, signature: "A".repeat(86) + "==" };
  assert.equal(
    apply(
      plan,
      planPath,
      bicepManifest,
      invalidSignature,
      mockRuntime(),
      "invalid-signature",
    ).code,
    "deployment.approval.signature-invalid",
  );
  const lastSignatureCharacter = approval.signature.at(-3);
  const noncanonicalReplacement = {
    A: "B",
    Q: "R",
    g: "h",
    w: "x",
  }[lastSignatureCharacter];
  assert(noncanonicalReplacement);
  const noncanonicalSignature = {
    ...approval,
    signature: `${approval.signature.slice(0, -3)}${noncanonicalReplacement}==`,
  };
  assert.equal(
    apply(
      plan,
      planPath,
      bicepManifest,
      noncanonicalSignature,
      mockRuntime(),
      "noncanonical-signature",
    ).code,
    "deployment.approval.signature-encoding",
  );
  const rsaKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
  assert.throws(() => keyFingerprint(rsaKey), /must be Ed25519/);
  const wrongKey = generateKeyPairSync("ed25519");
  const wrongKeyApproval = createApproval(
    bicepManifest,
    { keyId: keyFingerprint(wrongKey.publicKey) },
    wrongKey.privateKey,
  );
  assert.equal(
    apply(
      plan,
      planPath,
      bicepManifest,
      wrongKeyApproval,
      mockRuntime(),
      "wrong-key",
    ).code,
    "deployment.approval.key-mismatch",
  );

  const boundMutations = {
    manifestVersion: "2.0.0",
    manifestDigest: `sha256:${"b".repeat(64)}`,
    planVersion: "2.0.0",
    planId: "other-plan",
    planDigest: `sha256:${"c".repeat(64)}`,
    readinessEvidenceVersion: "9.0.0",
    readinessEvidenceId: "readiness.other-plan.001",
    readinessEvidenceDigest: `sha256:${"9".repeat(64)}`,
    readinessEvidenceExpiresAt: "2026-08-09T11:59:59Z",
    operation: "platform-baseline.other",
    provider: "terraform",
    environment: "nonprod",
    regionRole: "secondary",
    tenantId: "44444444-4444-4444-4444-444444444444",
    subscriptionId: nonprod,
    scope: `/subscriptions/${nonprod}`,
    region: "westus2",
    stateStoreId: "99999999-9999-4999-8999-999999999999",
    parameterDigest: `sha256:${"d".repeat(64)}`,
    sourceDigest: `sha256:${"e".repeat(64)}`,
    savedPlanDigest: `sha256:${"f".repeat(64)}`,
    planJsonDigest: `sha256:${"1".repeat(64)}`,
    notificationContactsDigest: `sha256:${"2".repeat(64)}`,
    terraformAuthMode: "cli",
  };
  for (const [field, value] of Object.entries(boundMutations)) {
    const result = apply(
      plan,
      planPath,
      bicepManifest,
      resign(approval, { [field]: value, nonce: "b".repeat(64) }),
      mockRuntime(),
      `bound-${field}`,
    );
    assert(
      [
        "deployment.approval.binding-mismatch",
        "deployment.approval.malformed",
        "deployment.input.malformed",
      ].includes(result.code),
      `${field} was not rejected: ${result.code}`,
    );
  }

  const omittedApprovalEvidence = { ...approval };
  delete omittedApprovalEvidence.readinessEvidenceDigest;
  assert.equal(
    apply(
      plan,
      planPath,
      bicepManifest,
      omittedApprovalEvidence,
      mockRuntime(),
      "approval-readiness-omitted",
    ).code,
    "deployment.approval.malformed",
  );

  const omittedManifestEvidence = structuredClone(bicepManifest);
  delete omittedManifestEvidence.readinessEvidence;
  assert.equal(
    apply(
      plan,
      planPath,
      omittedManifestEvidence,
      approval,
      mockRuntime(),
      "manifest-readiness-omitted",
    ).code,
    "deployment.input.malformed",
  );

  const changedManifest = structuredClone(bicepManifest);
  changedManifest.execution.provider = "terraform";
  changedManifest.manifestDigest = manifestDigest(changedManifest);
  const changedManifestApproval = createApproval(changedManifest);
  assert.equal(
    apply(
      plan,
      planPath,
      changedManifest,
      changedManifestApproval,
      mockRuntime(),
      "wrong-provider",
    ).code,
    "deployment.manifest.binding-mismatch",
  );

  const changedBackendPlan = structuredClone(plan);
  changedBackendPlan.decisionModel.terraformBackend.subscriptionId = nonprod;
  changedBackendPlan.planDigest = planDigest(changedBackendPlan.decisionModel);
  changedBackendPlan.approval.planDigest = changedBackendPlan.planDigest;
  const changedBackendPlanPath = resolve(
    root,
    outputRelative,
    "changed-backend-plan.json",
  );
  writeFileSync(
    changedBackendPlanPath,
    `${JSON.stringify(changedBackendPlan, null, 2)}\n`,
    { mode: 0o600 },
  );
  assert.equal(
    apply(
      changedBackendPlan,
      changedBackendPlanPath,
      bicepManifest,
      resign(approval, { nonce: "7".repeat(64) }),
      mockRuntime(),
      "changed-backend-subscription",
    ).code,
    "deployment.manifest.binding-mismatch",
  );

  const changedBicepAttestation = structuredClone(bicepManifest);
  changedBicepAttestation.preview.bicepAttestation.resourceGraphDigest =
    `sha256:${"8".repeat(64)}`;
  changedBicepAttestation.manifestDigest = manifestDigest(
    changedBicepAttestation,
  );
  const changedBicepAttestationApproval = createApproval(
    changedBicepAttestation,
    { nonce: "b".repeat(64) },
  );
  assert.equal(
    apply(
      plan,
      planPath,
      changedBicepAttestation,
      changedBicepAttestationApproval,
      mockRuntime(),
      "changed-bicep-attestation",
    ).code,
    "deployment.bicep.attestation-mismatch",
  );

  const parameterPath = resolve(root, bicepManifest.artifacts.parameter.path);
  const originalParameter = readFileSync(parameterPath, "utf8");
  writeFileSync(parameterPath, `${originalParameter}// changed after review\n`);
  assert.equal(
    apply(
      plan,
      planPath,
      bicepManifest,
      approval,
      mockRuntime(),
      "changed-parameter",
    ).code,
    "deployment.manifest.binding-mismatch",
  );
  writeFileSync(parameterPath, originalParameter);

  const originalPlanArtifact = readFileSync(planPath, "utf8");
  writeFileSync(planPath, `${originalPlanArtifact.trimEnd()}\n\n`);
  assert.equal(
    apply(
      plan,
      planPath,
      bicepManifest,
      approval,
      mockRuntime(),
      "changed-plan-artifact",
    ).code,
    "deployment.manifest.binding-mismatch",
  );
  writeFileSync(planPath, originalPlanArtifact);

  const targetMismatch = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "c".repeat(64) }),
    mockRuntime({ accountId: nonprod }),
    "subscription-mismatch",
  );
  assert.equal(targetMismatch.code, "deployment.target.mismatch");
  assert.equal(targetMismatch.safety.deploymentWrites, 0);
  const tenantMismatch = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "d".repeat(64) }),
    mockRuntime({
      accountTenantId: "44444444-4444-4444-4444-444444444444",
    }),
    "tenant-mismatch",
  );
  assert.equal(tenantMismatch.code, "deployment.target.mismatch");

  const successRuntime = mockRuntime();
  const successApproval = resign(approval, { nonce: "e".repeat(64) });
  const success = apply(
    plan,
    planPath,
    bicepManifest,
    successApproval,
    successRuntime,
    "success-replay",
  );
  assert.equal(success.status, "succeeded", JSON.stringify(success, null, 2));
  assert.equal(success.verification.healthy, true);
  assert.equal(success.verification.workloadDeploymentAllowed, true);
  const bicepDeployCalls = successRuntime.calls.filter(
    (call) =>
      call.executable === "az" &&
      call.args[0] === "deployment" &&
      call.args[2] === "create",
  );
  assert.equal(bicepDeployCalls.length, 1);
  assert.equal(bicepManifest.safety.bicepMode, "Incremental");
  assert.equal(bicepDeployCalls[0].args.includes("--mode"), false);
  const deployedTemplatePath =
    bicepDeployCalls[0].args[
      bicepDeployCalls[0].args.indexOf("--template-file") + 1
    ];
  assert.match(deployedTemplatePath, /sslz-deployment-snapshot-/);
  assert.notEqual(
    deployedTemplatePath,
    resolve(root, "infra/bicep/main.bicep"),
    "Deployment must not use the mutable worktree source.",
  );
  assert.equal(existsSync(deployedTemplatePath), false);
  assert(
    successRuntime.calls
      .filter(
        (call) =>
          call.executable === "az" && call.args[0] !== "bicep",
      )
      .every((call) => call.args.includes("--subscription")),
  );
  assert(
    successRuntime.calls.some(
      (call) =>
        call.executable === "az" &&
        call.args[0] === "role" &&
        call.args.includes("--include-inherited"),
    ),
  );
  const raceProtectedRuntime = mockRuntime();
  const raceProtectedRunner = raceProtectedRuntime.runner;
  const raceParameterContent = readFileSync(parameterPath, "utf8");
  const bicepSourcePath = resolve(root, "infra/bicep/main.bicep");
  const bicepSourceContent = readFileSync(bicepSourcePath);
  raceProtectedRuntime.runner = (executable, args, options) => {
    if (executable === "az" && args[0] === "account") {
      writeFileSync(parameterPath, `${raceParameterContent}// raced\n`);
      writeFileSync(
        bicepSourcePath,
        Buffer.concat([bicepSourceContent, Buffer.from("\n// raced\n")]),
      );
    }
    return raceProtectedRunner(executable, args, options);
  };
  let raceProtected;
  try {
    raceProtected = apply(
      plan,
      planPath,
      bicepManifest,
      resign(approval, { nonce: "7".repeat(64) }),
      raceProtectedRuntime,
      "snapshot-race-protected",
    );
  } finally {
    writeFileSync(parameterPath, raceParameterContent);
    writeFileSync(bicepSourcePath, bicepSourceContent);
  }
  assert.equal(raceProtected.status, "succeeded");
  const protectedDeployment = raceProtectedRuntime.calls.find(
    (call) =>
      call.executable === "az" &&
      call.args[0] === "deployment" &&
      call.args[2] === "create",
  );
  assert.match(
    protectedDeployment.args[
      protectedDeployment.args.indexOf("--parameters") + 1
    ],
    /sslz-deployment-snapshot-/,
  );
  const replayRuntime = mockRuntime();
  const replay = apply(
    plan,
    planPath,
    bicepManifest,
    successApproval,
    replayRuntime,
    "success-replay",
  );
  assert.equal(replay.code, "deployment.approval.replayed");
  assert.equal(replayRuntime.calls.length, 0);
  const replayWithResignedArtifact = apply(
    plan,
    planPath,
    bicepManifest,
    resign(successApproval, {
      approvedAt: "2026-08-09T11:31:00Z",
      expiresAt: "2026-08-09T12:31:00Z",
    }),
    mockRuntime(),
    "success-replay",
  );
  assert.equal(
    replayWithResignedArtifact.code,
    "deployment.approval.replayed",
  );

  const raceApproval = resign(approval, { nonce: "f".repeat(64) });
  writeFileSync(
    resolve(
      statePath,
      `${approvalReplayKey(raceApproval).slice(7)}.lock`,
    ),
    "",
    { mode: 0o600 },
  );
  const raceRuntime = mockRuntime();
  const race = apply(
    plan,
    planPath,
    bicepManifest,
    raceApproval,
    raceRuntime,
    "race",
  );
  assert.equal(race.code, "deployment.approval.race");
  assert.equal(raceRuntime.calls.length, 0);

  const deploymentFailureRuntime = mockRuntime({
    deploymentStatus: 1,
    rawError: "Authorization: Bearer fixture-secret founder@startup.example",
  });
  const deploymentFailure = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "1".repeat(64) }),
    deploymentFailureRuntime,
    "deployment-failure",
  );
  assert.equal(deploymentFailure.code, "deployment.execution.failed");
  assert.equal(deploymentFailure.verification.performed, false);
  assert.equal(deploymentFailure.verification.workloadDeploymentAllowed, false);
  assertSanitized(deploymentFailure);

  const validationFailure = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "2".repeat(64) }),
    mockRuntime({ unhealthyCheck: "budget" }),
    "validation-failure",
  );
  assert.equal(validationFailure.code, "deployment.validation.failed");
  assert.equal(validationFailure.verification.healthy, false);
  assert.equal(validationFailure.verification.workloadDeploymentAllowed, false);
  assert.equal(validationFailure.rollback.required, true);
  assertSanitized(validationFailure);

  const contactValidationFailure = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "0f".repeat(32) }),
    mockRuntime({ unhealthyCheck: "contacts" }),
    "contact-validation-failure",
  );
  assert.equal(
    contactValidationFailure.code,
    "deployment.validation.failed",
  );
  assert.equal(
    contactValidationFailure.verification.workloadDeploymentAllowed,
    false,
  );
  assertSanitized(contactValidationFailure);

  const storageSubplanFailure = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "0e".repeat(32) }),
    mockRuntime({ unhealthyCheck: "storage-subplan" }),
    "storage-subplan-validation-failure",
  );
  assert.equal(storageSubplanFailure.code, "deployment.validation.failed");
  assert.equal(
    storageSubplanFailure.verification.workloadDeploymentAllowed,
    false,
  );

  const networkingValidationFailure = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "0d".repeat(32) }),
    mockRuntime({ unhealthyCheck: "networking" }),
    "networking-validation-failure",
  );
  assert.equal(networkingValidationFailure.code, "deployment.validation.failed");
  assert.equal(
    networkingValidationFailure.verification.workloadDeploymentAllowed,
    false,
  );

  const policyDefinitionFailure = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "0b".repeat(32) }),
    mockRuntime({ unhealthyCheck: "policy-definition" }),
    "policy-definition-validation-failure",
  );
  assert.equal(policyDefinitionFailure.code, "deployment.validation.failed");
  assert.equal(
    policyDefinitionFailure.verification.workloadDeploymentAllowed,
    false,
  );

  const unexpectedEffectiveRole = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "9".repeat(64) }),
    mockRuntime({ unexpectedRole: true }),
    "unexpected-effective-role",
  );
  assert.equal(
    unexpectedEffectiveRole.code,
    "deployment.validation.failed",
  );
  assert.equal(
    unexpectedEffectiveRole.verification.workloadDeploymentAllowed,
    false,
  );

  const eventuallyHealthy = apply(
    plan,
    planPath,
    bicepManifest,
    resign(approval, { nonce: "3".repeat(64) }),
    mockRuntime({ unhealthyCheck: "budget", unhealthyAttempts: 1 }),
    "eventual-consistency",
    { maximumValidationAttempts: 2 },
  );
  assert.equal(eventuallyHealthy.status, "succeeded");
  assert.equal(eventuallyHealthy.verification.attempts, 2);

  const terraformPreviewRuntime = mockRuntime();
  const {
    plan: initialTerraformPlan,
    planPath: initialTerraformPlanPath,
  } = writeReviewedPlan(createInput(), "terraform-initial-create", {
    unknownTerraformPrincipals: true,
  });
  const initialTerraformManifest = buildDeploymentManifest(
    initialTerraformPlan,
    {
      provider: "terraform",
      environment: "prod",
      planPath: initialTerraformPlanPath,
      terraformAuthMode: "oidc",
      provenancePublicKey: provenancePublicKeyPem,
      evaluatedAt,
      runner: terraformPreviewRuntime.runner,
    },
  );
  validateDocument(manifestSchema, initialTerraformManifest);
  const legacyInput = createInput();
  legacyInput.schemaVersion = "1.0.0";
  const {
    plan: legacyTerraformPlan,
    planPath: legacyTerraformPlanPath,
  } = writeReviewedPlan(legacyInput, "legacy-v1");
  assert.throws(
    () =>
      buildDeploymentManifest(legacyTerraformPlan, {
        provider: "terraform",
        environment: "prod",
        planPath: legacyTerraformPlanPath,
        terraformAuthMode: "oidc",
        provenancePublicKey: provenancePublicKeyPem,
        evaluatedAt,
        runner: terraformPreviewRuntime.runner,
      }),
    /requires a Phase 4 v3 plan/,
  );
  const terraformManifest = buildDeploymentManifest(plan, {
    provider: "terraform",
    environment: "prod",
    planPath,
    terraformAuthMode: "oidc",
    provenancePublicKey: provenancePublicKeyPem,
    evaluatedAt,
    runner: terraformPreviewRuntime.runner,
  });
  validateDocument(manifestSchema, terraformManifest);
  assert.equal(terraformManifest.safety.terraformSavedPlanOnly, true);
  assert.equal(terraformManifest.preview.terraformVersion, "1.9.8");
  assert.match(
    terraformManifest.preview.terraformAttestation.attestationDigest,
    /^sha256:[0-9a-f]{64}$/,
  );
  const provenancePath = resolve(
    root,
    terraformManifest.artifacts.provenance.path,
  );
  const originalProvenance = readFileSync(provenancePath, "utf8");
  const provenanceDocument = JSON.parse(originalProvenance);
  const {
    schemaVersion: omittedSchemaVersion,
    generatedBy: omittedGenerator,
    signatureAlgorithm: omittedAlgorithm,
    keyId: omittedKeyId,
    signature: omittedSignature,
    ...provenancePayload
  } = provenanceDocument;
  const wrongSourceProvenance = signTerraformProvenance(
    {
      ...provenancePayload,
      sourceDigest: `sha256:${"9".repeat(64)}`,
    },
    provenancePrivateKey,
  );
  writeFileSync(
    provenancePath,
    `${JSON.stringify(wrongSourceProvenance, null, 2)}\n`,
  );
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "terraform",
        environment: "prod",
        planPath,
        terraformAuthMode: "oidc",
        provenancePublicKey: provenancePublicKeyPem,
        evaluatedAt,
        runner: mockRuntime().runner,
      }),
    /provenance does not match/,
  );
  writeFileSync(provenancePath, originalProvenance);
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "terraform",
        environment: "prod",
        planPath,
        terraformAuthMode: "oidc",
        provenancePublicKey: generateKeyPairSync("ed25519").publicKey,
        evaluatedAt,
        runner: mockRuntime().runner,
      }),
    /provenance signature is invalid/,
  );
  const terraformRuntime = mockRuntime();
  const terraformApproval = createApproval(terraformManifest, {
    nonce: "4".repeat(64),
  });
  const fabricatedTerraformSemantics = structuredClone(terraformManifest);
  fabricatedTerraformSemantics.preview.terraformAttestation.resourceGraphDigest =
    `sha256:${"0".repeat(64)}`;
  fabricatedTerraformSemantics.manifestDigest = manifestDigest(
    fabricatedTerraformSemantics,
  );
  const fabricatedSemanticsResult = runDeploymentIntegration(
    plan,
    fabricatedTerraformSemantics,
    createApproval(fabricatedTerraformSemantics, {
      nonce: "0c".repeat(32),
    }),
    publicKeyPem,
    {
      mode: "apply",
      planPath,
      evaluatedAt,
      clock: () => evaluatedAt,
      runner: mockRuntime().runner,
      provenancePublicKey: provenancePublicKeyPem,
      statePath: stateRelative,
    },
  );
  assert.equal(
    fabricatedSemanticsResult.code,
    "deployment.manifest.semantic-mismatch",
  );
  const wrongTerraformExecutor = mockRuntime({
    terraformVersion: "1.9.7",
  });
  const wrongTerraformExecutorResult = apply(
    plan,
    planPath,
    terraformManifest,
    resign(terraformApproval, { nonce: "7".repeat(64) }),
    wrongTerraformExecutor,
    "wrong-terraform-executor",
  );
  assert.equal(
    wrongTerraformExecutorResult.code,
    "deployment.terraform.executor-mismatch",
  );
  assert.equal(wrongTerraformExecutorResult.approval.consumed, false);
  assert.equal(wrongTerraformExecutorResult.safety.localState, "none");
  assert.equal(
    wrongTerraformExecutor.calls.some(
      (call) =>
        call.executable === "terraform" &&
        ["init", "apply"].includes(call.args[1]),
    ),
    false,
  );
  writeFileSync(
    provenancePath,
    `${JSON.stringify(
      {
        ...provenanceDocument,
        signature: `${"A".repeat(86)}==`,
      },
      null,
      2,
    )}\n`,
  );
  const changedProvenanceApply = apply(
    plan,
    planPath,
    terraformManifest,
    resign(terraformApproval, { nonce: "9".repeat(64) }),
    mockRuntime(),
    "changed-provenance",
  );
  writeFileSync(provenancePath, originalProvenance);
  assert.equal(
    changedProvenanceApply.code,
    "deployment.terraform.provenance-signature",
  );
  const terraformSuccess = apply(
    plan,
    planPath,
    terraformManifest,
    terraformApproval,
    terraformRuntime,
    "terraform-success",
  );
  assert.equal(terraformSuccess.status, "succeeded");
  assert.equal(
    terraformRuntime.calls.filter(
      (call) => call.executable === "terraform" && call.args[1] === "apply",
    ).length,
    1,
  );
  assert.equal(
    terraformRuntime.calls.some(
      (call) => call.executable === "terraform" && call.args.includes("plan"),
    ),
    false,
  );
  assert.equal(
    terraformRuntime.calls.filter(
      (call) => call.executable === "terraform" && call.args[1] === "init",
    ).length,
    1,
  );
  const terraformApplyCall = terraformRuntime.calls.find(
    (call) => call.executable === "terraform" && call.args[1] === "apply",
  );
  assert.match(terraformApplyCall.args.at(-1), /sslz-deployment-snapshot-/);
  assert.equal(existsSync(terraformApplyCall.args.at(-1)), false);
  const terraformInitCall = terraformRuntime.calls.find(
    (call) => call.executable === "terraform" && call.args[1] === "init",
  );
  assert.match(terraformInitCall.args[0], /sslz-deployment-snapshot-/);
  assert(
    terraformInitCall.args.includes(
      `-backend-config=subscription_id=${prod}`,
    ),
  );
  assert(
    terraformInitCall.args.includes(
      "-backend-config=use_azuread_auth=true",
    ),
  );
  assert.match(
    terraformInitCall.terraformCliConfigPath,
    /sslz-deployment-snapshot-.*sslz\.deployment\.tfrc$/,
  );

  const savedPlanPath = resolve(root, terraformManifest.artifacts.savedPlan.path);
  const originalSavedPlan = readFileSync(savedPlanPath);
  const terraformRaceRuntime = mockRuntime();
  const terraformRaceRunner = terraformRaceRuntime.runner;
  terraformRaceRuntime.runner = (executable, args, options) => {
    if (executable === "az" && args[0] === "account") {
      writeFileSync(savedPlanPath, "raced saved plan\n");
    }
    return terraformRaceRunner(executable, args, options);
  };
  let terraformRaceResult;
  try {
    terraformRaceResult = apply(
      plan,
      planPath,
      terraformManifest,
      resign(terraformApproval, { nonce: "8".repeat(64) }),
      terraformRaceRuntime,
      "terraform-snapshot-race",
    );
  } finally {
    writeFileSync(savedPlanPath, originalSavedPlan);
  }
  assert.equal(terraformRaceResult.status, "succeeded");
  assert.match(
    terraformRaceRuntime.calls.find(
      (call) => call.executable === "terraform" && call.args[1] === "apply",
    ).args.at(-1),
    /sslz-deployment-snapshot-/,
  );
  writeFileSync(savedPlanPath, "substituted plan\n");
  assert.equal(
    apply(
      plan,
      planPath,
      terraformManifest,
      resign(terraformApproval, { nonce: "5".repeat(64) }),
      mockRuntime(),
      "saved-plan-substitution",
    ).code,
    "deployment.terraform.provenance-mismatch",
  );
  writeFileSync(savedPlanPath, originalSavedPlan);

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.variables.subscription_id.value = nonprod;
    },
    /saved Terraform plan variables/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.variables.security_contact_email.value =
        "security@example.com\ninjected";
    },
    /unique safe email addresses/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.variables.unreviewed_variable = { value: "unexpected" };
    },
    /missing or unexpected variables/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.planned_values.root_module.child_modules
        .find((module) => module.address === "module.security")
        .resources[0].values.email = "attacker@example.com";
    },
    /do not consume the approved notification-contact variables/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.planned_values.root_module.resources
        .find(
          (resource) =>
            resource.address ===
            "azurerm_consumption_budget_subscription.monthly",
        )
        .values.notification[0].contact_emails = ["attacker@example.com"];
    },
    /consistent inspectable notification contacts/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.configuration.root_module.resources.push({
        address: "azurerm_role_assignment.owner",
        type: "azurerm_role_assignment",
        provider_config_key: "azurerm",
      });
      document.resource_changes.push({
        address: "azurerm_role_assignment.owner",
        type: "azurerm_role_assignment",
        provider_name: "registry.terraform.io/hashicorp/random",
        change: { actions: ["create"] },
      });
    },
    /unexpected resource|graph/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.planned_values.root_module.resources.push({
        address: "module.policy.azurerm_role_assignment.inherit_env_tag",
        type: "azurerm_role_assignment",
        provider_name: "registry.terraform.io/hashicorp/azurerm",
        values: {
          scope: `/subscriptions/${prod}`,
          role_definition_name: "Owner",
        },
      });
    },
    /unexpected role/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      delete document.planned_values.root_module.child_modules[0].resources.find(
        (resource) =>
          resource.address ===
          "module.policy.azurerm_role_assignment.inherit_env_tag",
      ).values.principal_id;
    },
    /must resolve exactly/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.configuration.root_module.resources[0].provisioners = [
        { type: "local-exec" },
      ];
    },
    /provisioner/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.configuration.provider_config.azurerm.expressions.resource_provider_registrations.constant_value =
        "legacy";
    },
    /automatic provider registration/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.configuration.provider_config.azurerm.expressions.subscription_id =
        { constant_value: nonprod };
    },
    /unexpected provider configuration/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.planned_values.root_module.resources[0].values.id =
        `/subscriptions/${nonprod}/resourceGroups/rg-foreign`;
    },
    /another subscription/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.configuration.provider_config.azurerm.expressions.resource_providers_to_register.constant_value =
        ["Microsoft.Network"];
    },
    /automatic provider registration/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.configuration.root_module.module_calls.security.source =
        "git::https://example.invalid/security";
    },
    /module source/,
  );

  assertRejectedSignedTerraformPlan(
    plan,
    planPath,
    (document) => {
      document.configuration.root_module.module_calls.policy.module.resources.find(
        (resource) =>
          resource.address ===
          "azurerm_role_assignment.inherit_env_tag",
      ).expressions.principal_id.references = ["var.arbitrary_principal_id"];
    },
    /role principals/,
  );

  const terraformCliConfigPath = resolve(
    root,
    "infra/terraform/sslz.deployment.tfrc",
  );
  const originalTerraformCliConfig = readFileSync(terraformCliConfigPath);
  writeFileSync(
    terraformCliConfigPath,
    `${originalTerraformCliConfig}\n# changed after approval\n`,
  );
  assert.equal(
    apply(
      plan,
      planPath,
      terraformManifest,
      resign(terraformApproval, { nonce: "6".repeat(64) }),
      mockRuntime(),
      "changed-terraform-cli-config",
    ).code,
    "deployment.terraform.provenance-mismatch",
  );
  writeFileSync(terraformCliConfigPath, originalTerraformCliConfig);

  const fixturePreviewPlan = structuredClone(plan);
  fixturePreviewPlan.previews.find(
    (item) => item.provider === "bicep" && item.environment === "prod",
  ).source = "fixture";
  writeFileSync(planPath, `${JSON.stringify(fixturePreviewPlan, null, 2)}\n`);
  assert.throws(
    () =>
      buildDeploymentManifest(fixturePreviewPlan, {
        provider: "bicep",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: mockRuntime().runner,
      }),
    /command preview/,
  );
  writeFileSync(planPath, originalPlanArtifact);

  const secondaryInput = createInput({ regionalMode: "cool-infrastructure" });
  const secondary = writeReviewedPlan(secondaryInput, "secondary");
  assert.throws(
    () =>
      buildDeploymentManifest(secondary.plan, {
        provider: "bicep",
        environment: "prod",
        planPath: secondary.planPath,
        evaluatedAt,
        runner: mockRuntime().runner,
      }),
    /primary single-region baseline/,
  );

  const expiredPlan = structuredClone(plan);
  expiredPlan.approval.expiresAt = "2026-08-09T11:59:59Z";
  const expiredPlanPath = resolve(root, outputRelative, "expired-plan.json");
  writeFileSync(expiredPlanPath, `${JSON.stringify(expiredPlan, null, 2)}\n`);
  assert.throws(
    () =>
      buildDeploymentManifest(expiredPlan, {
        provider: "bicep",
        environment: "prod",
        planPath: expiredPlanPath,
        evaluatedAt,
        runner: mockRuntime().runner,
      }),
    /expired/,
  );

  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep\nrole-assignment",
        environment: "prod",
        planPath,
        evaluatedAt,
        runner: mockRuntime().runner,
      }),
    /Provider must be/,
  );
  assert.throws(
    () =>
      buildDeploymentManifest(plan, {
        provider: "bicep",
        environment: "prod; az group delete",
        planPath,
        evaluatedAt,
        runner: mockRuntime().runner,
      }),
    /Environment must be/,
  );

  process.env.TF_VAR_fixture = "fixture-secret";
  process.env.TF_CLI_ARGS_apply = "-destroy";
  process.env.TF_CLI_CONFIG_FILE = "fixture-secret";
  process.env.tF_rEaTtAcH_pRoViDeRs = "fixture-secret";
  process.env.APPDATA = "fixture-secret";
  process.env.HOME = "fixture-secret";
  process.env.AZURE_CONFIG_DIR = "fixture-secret";
  process.env.ARM_USE_OIDC = "true";
  process.env.ARM_OIDC_REQUEST_TOKEN = "fixture-arm-token";
  process.env.ARM_OIDC_REQUEST_URL = "https://arm-token.example";
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "fixture-token";
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://token.actions.example";
  const sanitizedEnvironment = sanitizedTerraformEnvironment({
    TF_DATA_DIR: "safe-data",
  });
  assert.equal(sanitizedEnvironment.TF_VAR_fixture, undefined);
  assert.equal(sanitizedEnvironment.TF_CLI_ARGS_apply, undefined);
  assert.equal(sanitizedEnvironment.tF_rEaTtAcH_pRoViDeRs, undefined);
  assert.match(
    sanitizedEnvironment.TF_CLI_CONFIG_FILE,
    /infra[\\/]terraform[\\/]sslz\.deployment\.tfrc$/,
  );
  assert.equal(sanitizedEnvironment.APPDATA, undefined);
  assert.equal(sanitizedEnvironment.HOME, undefined);
  assert.equal(sanitizedEnvironment.ARM_USE_OIDC, undefined);
  assert.equal(sanitizedEnvironment.ARM_OIDC_REQUEST_TOKEN, undefined);
  assert.equal(sanitizedEnvironment.ARM_OIDC_REQUEST_URL, undefined);
  assert.equal(sanitizedEnvironment.TF_DATA_DIR, "safe-data");
  assert.equal(sanitizedEnvironment.TEMP, "safe-data");
  assert.equal(sanitizedEnvironment.TMP, "safe-data");
  assert.equal(sanitizedEnvironment.TMPDIR, "safe-data");
  const cliEnvironment = sanitizedTerraformEnvironment(
    { TF_DATA_DIR: "safe-data" },
    undefined,
    "cli",
  );
  assert.match(cliEnvironment.AZURE_CONFIG_DIR, /[\\/]\.azure$/);
  assert.doesNotMatch(cliEnvironment.AZURE_CONFIG_DIR, /fixture-secret/);
  const azureEnvironment = sanitizedAzureCliEnvironment({
    AZURE_CONFIG_DIR: "fixture-secret",
    PATH: "fixture-secret",
  });
  assert.match(azureEnvironment.AZURE_CONFIG_DIR, /[\\/]\.azure$/);
  assert.doesNotMatch(
    `${azureEnvironment.AZURE_CONFIG_DIR};${azureEnvironment.PATH}`,
    /fixture-secret/,
  );
  assert.equal(cliEnvironment.ARM_USE_CLI, "true");
  assert.equal(cliEnvironment.ARM_USE_OIDC, "false");
  assert.equal(cliEnvironment.ARM_OIDC_REQUEST_TOKEN, undefined);
  assert.equal(cliEnvironment.ARM_OIDC_REQUEST_URL, undefined);
  assert.equal(cliEnvironment.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert.equal(cliEnvironment.ACTIONS_ID_TOKEN_REQUEST_URL, undefined);
  const oidcEnvironment = sanitizedTerraformEnvironment(
    { TF_DATA_DIR: "safe-data" },
    undefined,
    "oidc",
  );
  assert.equal(oidcEnvironment.AZURE_CONFIG_DIR, undefined);
  assert.equal(oidcEnvironment.ARM_USE_CLI, "false");
  assert.equal(oidcEnvironment.ARM_USE_OIDC, "true");
  assert.equal(oidcEnvironment.ARM_OIDC_REQUEST_TOKEN, "fixture-arm-token");
  assert.equal(
    oidcEnvironment.ARM_OIDC_REQUEST_URL,
    "https://arm-token.example",
  );
  assert.equal(
    oidcEnvironment.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    "fixture-token",
  );
  assert.equal(
    oidcEnvironment.ACTIONS_ID_TOKEN_REQUEST_URL,
    "https://token.actions.example",
  );
  delete process.env.TF_VAR_fixture;
  delete process.env.TF_CLI_ARGS_apply;
  delete process.env.TF_CLI_CONFIG_FILE;
  delete process.env.tF_rEaTtAcH_pRoViDeRs;
  delete process.env.APPDATA;
  delete process.env.HOME;
  delete process.env.AZURE_CONFIG_DIR;
  delete process.env.ARM_USE_OIDC;
  delete process.env.ARM_OIDC_REQUEST_TOKEN;
  delete process.env.ARM_OIDC_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;

  for (const file of readdirSync(statePath, { recursive: true })) {
    if (String(file).endsWith(".json")) {
      assertSanitized(readFileSync(resolve(statePath, file), "utf8"));
    }
  }

  const bicepWorkflow = readFileSync(
    resolve(root, ".github/workflows/deploy-bicep.yml"),
    "utf8",
  );
  const terraformWorkflow = readFileSync(
    resolve(root, ".github/workflows/deploy-terraform.yml"),
    "utf8",
  );
  assert.match(bicepWorkflow, /workflow_dispatch:/);
  assert.match(terraformWorkflow, /workflow_dispatch:/);
  for (const workflow of [bicepWorkflow, terraformWorkflow]) {
    assert.match(workflow, /startup-deployment-integration\.sh apply/);
    assert.match(workflow, /--manifest "\$MANIFEST_PATH"/);
    assert.match(workflow, /--approval "\$APPROVAL_PATH"/);
    assert.match(workflow, /runs-on: \[self-hosted, sslz-deployment\]/);
    assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
    assert.doesNotMatch(workflow, /\baz deployment sub create\b/);
    assert.doesNotMatch(workflow, /\bterraform apply\b/);
  }

  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(
    source,
    /\b(provider unregister|feature register|role assignment create|az account set|billing|entitlement|domain verification)\b/i,
  );
  assert.doesNotMatch(source, /\b(examples\/|cool-infrastructure|warm-workload)\b/i);
  assert.match(source, /bicepMode:\s*provider === "bicep" \? "Incremental"/);
  assert.doesNotMatch(source, /["']Complete["']/);
  assert.match(source, /"apply",[\s\S]*relativePath\(savedPlanPath\)/);
  assert.doesNotMatch(source, /["']plan["']/);
  assert.doesNotMatch(source, /shell:\s*true/);

  const cliUnsupported = spawnSync(
    process.execPath,
    [
      script,
      "preview",
      "--plan",
      planPath,
      "--provider",
      "bicep",
      "--environment",
      "prod",
      "--fixture-secret",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(cliUnsupported.status, 2);
  assert.doesNotMatch(cliUnsupported.stderr, /fixture-secret/);
  assertSanitized(success);
  assertSanitized(terraformSuccess);

  console.log("Startup deployment integration fixture tests passed.");
} finally {
  rmSync(outputPath, { recursive: true, force: true });
  if (ownsStatePath) {
    rmSync(statePath, { recursive: true, force: true });
  }
  if (previousTerraformExecutable === undefined) {
    delete process.env.SSLZ_TERRAFORM_EXECUTABLE;
  } else {
    process.env.SSLZ_TERRAFORM_EXECUTABLE = previousTerraformExecutable;
  }
  rmSync(testTerraformExecutable, { force: true });
}
