#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ReadinessEvidenceError,
  assertReadinessEvidence,
  canonicalJson,
  planDigest,
} from "./startup-iac-plan.mjs";
import {
  azureCliConfigDirectory,
  azureCliInvocation as shellFreeAzureCliInvocation,
  sanitizedAzureCliEnvironment,
} from "./azure-cli-invocation.mjs";
import {
  hashCanonical as hashCanonicalProvenance,
  terraformExecutable,
  verifyTerraformProvenance,
} from "./terraform-plan-provenance.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";
import {
  assertFreshRegionalBindings,
  attemptIdentity,
  completeRegionalAttemptReservation,
  createRegionalAttempt,
  recordAttemptFailure,
  recordAttemptStarted,
  recordAttemptSuccess,
  releaseRegionalAttemptReservation,
  reserveRegionalAttempt,
} from "./regional-attempt.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_ROOT = resolve(root, ".sslz/generated");
const STATE_ROOT = resolve(root, ".sslz/deployment-state");
const VERSION = "1.0.0";
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOG_ANALYTICS_WORKSPACE_ID =
  /^\/subscriptions\/([0-9a-f-]{36})\/resourcegroups\/([^/]+)\/providers\/microsoft\.operationalinsights\/workspaces\/([^/]+)$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_COMMAND_TOKEN = /^[A-Za-z0-9._:/={}(),@-]+$/;
const SIGNING_DOMAIN = "sslz-deployment-approval-v1";
const TERRAFORM_CLI_CONFIG_PATH = resolve(
  root,
  "infra/terraform/sslz.deployment.tfrc",
);
const BICEP_EXECUTABLE = resolve(
  homedir(),
  ".azure",
  "bin",
  process.platform === "win32" ? "bicep.exe" : "bicep",
);
const EXPECTED_TERRAFORM_RESOURCES = new Map([
  [
    "data.azurerm_log_analytics_workspace.existing",
    "azurerm_log_analytics_workspace",
  ],
  [
    "terraform_data.log_analytics_workspace_placement_guard",
    "terraform_data",
  ],
  ["azurerm_consumption_budget_subscription.monthly", "azurerm_consumption_budget_subscription"],
  ["azurerm_monitor_diagnostic_setting.activity_log", "azurerm_monitor_diagnostic_setting"],
  ["azurerm_resource_group.monitoring", "azurerm_resource_group"],
  ["azurerm_resource_group.networking", "azurerm_resource_group"],
  ["module.log_analytics.azurerm_log_analytics_workspace.this", "azurerm_log_analytics_workspace"],
  ["module.networking.azurerm_network_security_group.aks", "azurerm_network_security_group"],
  ["module.networking.azurerm_network_security_group.app", "azurerm_network_security_group"],
  ["module.networking.azurerm_network_security_group.data", "azurerm_network_security_group"],
  ["module.networking.azurerm_network_security_group.shared", "azurerm_network_security_group"],
  ["module.networking.azurerm_subnet.aks", "azurerm_subnet"],
  ["module.networking.azurerm_subnet.app", "azurerm_subnet"],
  ["module.networking.azurerm_subnet.data", "azurerm_subnet"],
  ["module.networking.azurerm_subnet.shared", "azurerm_subnet"],
  [
    "module.networking.azurerm_subnet_network_security_group_association.aks",
    "azurerm_subnet_network_security_group_association",
  ],
  [
    "module.networking.azurerm_subnet_network_security_group_association.app",
    "azurerm_subnet_network_security_group_association",
  ],
  [
    "module.networking.azurerm_subnet_network_security_group_association.data",
    "azurerm_subnet_network_security_group_association",
  ],
  [
    "module.networking.azurerm_subnet_network_security_group_association.shared",
    "azurerm_subnet_network_security_group_association",
  ],
  ["module.networking.azurerm_virtual_network.this", "azurerm_virtual_network"],
  ["module.policy.azurerm_role_assignment.activity_log_diag_law", "azurerm_role_assignment"],
  ["module.policy.azurerm_role_assignment.activity_log_diag_monitor", "azurerm_role_assignment"],
  ["module.policy.azurerm_role_assignment.inherit_env_tag", "azurerm_role_assignment"],
  ["module.policy.azurerm_role_assignment.inherit_team_tag", "azurerm_role_assignment"],
  [
    "module.policy.azurerm_subscription_policy_assignment.activity_log_diag",
    "azurerm_subscription_policy_assignment",
  ],
  [
    "module.policy.azurerm_subscription_policy_assignment.allowed_locations",
    "azurerm_subscription_policy_assignment",
  ],
  [
    "module.policy.azurerm_subscription_policy_assignment.allowed_locations_rg",
    "azurerm_subscription_policy_assignment",
  ],
  [
    "module.policy.azurerm_subscription_policy_assignment.inherit_env_tag",
    "azurerm_subscription_policy_assignment",
  ],
  [
    "module.policy.azurerm_subscription_policy_assignment.inherit_team_tag",
    "azurerm_subscription_policy_assignment",
  ],
  [
    "module.policy.azurerm_subscription_policy_assignment.mcsb",
    "azurerm_subscription_policy_assignment",
  ],
  [
    "module.policy.azurerm_subscription_policy_assignment.require_env_tag",
    "azurerm_subscription_policy_assignment",
  ],
  [
    "module.policy.azurerm_subscription_policy_assignment.require_team_tag",
    "azurerm_subscription_policy_assignment",
  ],
  ["module.security.azurerm_security_center_contact.default", "azurerm_security_center_contact"],
  [
    "module.security.azurerm_security_center_subscription_pricing.arm",
    "azurerm_security_center_subscription_pricing",
  ],
  [
    "module.security.azurerm_security_center_subscription_pricing.containers",
    "azurerm_security_center_subscription_pricing",
  ],
  [
    "module.security.azurerm_security_center_subscription_pricing.cspm",
    "azurerm_security_center_subscription_pricing",
  ],
  [
    "module.security.azurerm_security_center_subscription_pricing.keyvault",
    "azurerm_security_center_subscription_pricing",
  ],
  [
    "module.security.azurerm_security_center_subscription_pricing.oss_db",
    "azurerm_security_center_subscription_pricing",
  ],
  [
    "module.security.azurerm_security_center_subscription_pricing.servers",
    "azurerm_security_center_subscription_pricing",
  ],
  ["azurerm_security_center_workspace.defender", "azurerm_security_center_workspace"],
  [
    "module.security.azurerm_security_center_subscription_pricing.sql",
    "azurerm_security_center_subscription_pricing",
  ],
  [
    "module.security.azurerm_security_center_subscription_pricing.storage",
    "azurerm_security_center_subscription_pricing",
  ],
]);
const EXPECTED_TERRAFORM_ROLES = new Map([
  ["module.policy.azurerm_role_assignment.activity_log_diag_law", "Log Analytics Contributor"],
  ["module.policy.azurerm_role_assignment.activity_log_diag_monitor", "Monitoring Contributor"],
  ["module.policy.azurerm_role_assignment.inherit_env_tag", "Tag Contributor"],
  ["module.policy.azurerm_role_assignment.inherit_team_tag", "Tag Contributor"],
]);
const EXPECTED_TERRAFORM_MODULES = new Map([
  ["log_analytics", "./modules/monitoring"],
  ["networking", "./modules/networking"],
  ["policy", "./modules/policy"],
  ["security", "./modules/security"],
]);
const EXPECTED_TERRAFORM_PRINCIPALS = new Map([
  [
    "module.policy.azurerm_role_assignment.activity_log_diag_law",
    "azurerm_subscription_policy_assignment.activity_log_diag",
  ],
  [
    "module.policy.azurerm_role_assignment.activity_log_diag_monitor",
    "azurerm_subscription_policy_assignment.activity_log_diag",
  ],
  [
    "module.policy.azurerm_role_assignment.inherit_env_tag",
    "azurerm_subscription_policy_assignment.inherit_env_tag",
  ],
  [
    "module.policy.azurerm_role_assignment.inherit_team_tag",
    "azurerm_subscription_policy_assignment.inherit_team_tag",
  ],
]);
const EXPECTED_BICEP_RESOURCE_COUNTS = new Map([
  ["Microsoft.Authorization/policyAssignments", 8],
  ["Microsoft.Authorization/roleAssignments", 4],
  ["Microsoft.Consumption/budgets", 1],
  ["Microsoft.Insights/diagnosticSettings", 1],
  ["Microsoft.Network/networkSecurityGroups", 4],
  ["Microsoft.Network/virtualNetworks", 1],
  ["Microsoft.OperationalInsights/workspaces", 1],
  ["Microsoft.Resources/deployments", 5],
  ["Microsoft.Resources/resourceGroups", 2],
  ["Microsoft.Security/pricings", 9],
  ["Microsoft.Security/securityContacts", 1],
  ["Microsoft.Security/workspaceSettings", 1],
]);
const EXPECTED_BICEP_ROLE_DEFINITIONS = new Map([
  ["tagContributor", "4a9ae827-6dc8-4573-8ac7-8239d42aa03f"],
  ["monitoringContributor", "749f88d5-cbae-40b8-bcfc-e573ddc772fa"],
  ["logAnalyticsContributor", "92aaf0da-9dab-42b6-94a3-d43ce8d16293"],
]);
const EXPECTED_BICEP_ROLE_BINDINGS = new Set([
  "tagContributor|[reference('inheritEnvironmentTag', '2024-04-01', 'full').identity.principalId]",
  "tagContributor|[reference('inheritTeamTag', '2024-04-01', 'full').identity.principalId]",
  "logAnalyticsContributor|[reference('activityLogDiagAssignment', '2024-04-01', 'full').identity.principalId]",
  "monitoringContributor|[reference('activityLogDiagAssignment', '2024-04-01', 'full').identity.principalId]",
]);
const EXPECTED_BICEP_OUTPUTS = new Map([
  [
    "root",
    [
      "logAnalyticsWorkspaceId",
      "logAnalyticsWorkspaceName",
      "resourceGroupMonitoring",
      "resourceGroupNetworking",
      "vnetId",
      "vnetName",
    ],
  ],
  ["logAnalytics", ["workspaceId", "workspaceName"]],
  [
    "networking",
    [
      "aksSubnetId",
      "appSubnetId",
      "dataSubnetId",
      "sharedSubnetId",
      "vnetId",
      "vnetName",
    ],
  ],
  ["defender", []],
  ["budgets", []],
  ["policies", []],
]);
const EXPECTED_BICEP_REFERENCES = new Set([
  "[if(parameters('deployNetworking'), reference('networking').outputs.vnetId.value, '')]",
  "[if(parameters('deployNetworking'), reference('networking').outputs.vnetName.value, '')]",
  "[reference('activityLogDiagAssignment', '2024-04-01', 'full').identity.principalId]",
  "[reference('inheritEnvironmentTag', '2024-04-01', 'full').identity.principalId]",
  "[reference('inheritTeamTag', '2024-04-01', 'full').identity.principalId]",
  "[reference('logAnalytics').outputs.workspaceId.value]",
  "[reference('logAnalytics').outputs.workspaceName.value]",
]);
const EXPECTED_BICEP_DEPLOYMENT_SCOPES = new Map([
  ["logAnalytics", "[variables('rgMonitoring')]"],
  ["networking", "[variables('rgNetworking')]"],
  ["defender", null],
  ["budgets", null],
  ["policies", null],
]);
const POLICY_NAMES = [
  "activity-log-diag",
  "allowed-locations",
  "allowed-locations-rg",
  "inherit-env-tag",
  "inherit-team-tag",
  "mcsb-audit",
  "require-env-tag-rg",
  "require-team-tag-rg",
].sort();
const EXPECTED_POLICY_DEFINITIONS = new Map([
  [
    "activity-log-diag",
    "/providers/microsoft.authorization/policydefinitions/2465583e-4e78-4c15-b6be-a36cbc7c8b0f",
  ],
  [
    "allowed-locations",
    "/providers/microsoft.authorization/policydefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c",
  ],
  [
    "allowed-locations-rg",
    "/providers/microsoft.authorization/policydefinitions/e765b5de-1225-4ba3-bd56-1ac6695af988",
  ],
  [
    "inherit-env-tag",
    "/providers/microsoft.authorization/policydefinitions/cd3aa116-8754-49c9-a813-ad46512ece54",
  ],
  [
    "inherit-team-tag",
    "/providers/microsoft.authorization/policydefinitions/cd3aa116-8754-49c9-a813-ad46512ece54",
  ],
  [
    "mcsb-audit",
    "/providers/microsoft.authorization/policysetdefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8",
  ],
  [
    "require-env-tag-rg",
    "/providers/microsoft.authorization/policydefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025",
  ],
  [
    "require-team-tag-rg",
    "/providers/microsoft.authorization/policydefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025",
  ],
]);
const ACTIVITY_LOG_CATEGORIES = [
  "Administrative",
  "Alert",
  "Autoscale",
  "Policy",
  "Recommendation",
  "ResourceHealth",
  "Security",
  "ServiceHealth",
].sort();
const VALIDATION_CHECK_IDS = [
  "deployment.platform.expected-resources",
  "deployment.platform.monitoring",
  "deployment.platform.activity-log-forwarding",
  "deployment.platform.policy",
  "deployment.platform.defender",
  "deployment.platform.budget",
  "deployment.platform.networking",
];

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function assertManifestRegionalBindingsFresh(manifest, approval = null) {
  const attempt = manifest.regionalAttempt;
  if (attempt.attemptNumber === 1) {
    return;
  }
  if (!attempt.previousBindings || !attempt.previousTargetRegion) {
    fail(
      "deployment.regional-attempt.predecessor-binding-missing",
      "The changed-region attempt is missing its reviewed predecessor bindings.",
    );
  }
  const freshBindings = {
    regionalEvidenceDigest: manifest.readinessEvidence.digest,
    planDigest: manifest.plan.digest,
    artifactDigest: hashCanonical(manifest.artifacts),
    manifestDigest: manifest.manifestDigest,
    ...(approval ? { approvalDigest: approvalArtifactDigest(approval) } : {}),
  };
  try {
    assertFreshRegionalBindings(
      attempt.previousBindings,
      freshBindings,
      attempt.targetRegion !== attempt.previousTargetRegion,
    );
  } catch (error) {
    fail(
      "deployment.regional-attempt.binding-reused",
      error.message,
    );
  }
}

const planSchema = load("agent/schemas/iac-plan-summary.schema.json");
const manifestSchema = load(
  "agent/schemas/deployment-execution-manifest.schema.json",
);
const approvalSchema = load("agent/schemas/deployment-approval.schema.json");
const resultSchema = load("agent/schemas/deployment-result.schema.json");
const provenanceSchema = load(
  "agent/schemas/terraform-plan-provenance.schema.json",
);

class DeploymentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new DeploymentError(code, message);
}

function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashCanonical(value) {
  return hashBytes(canonicalJson(value));
}

function relativePath(path) {
  return relative(root, path).split(sep).join("/");
}

function assertNoLinkedComponents(path, code = "deployment.artifact.symlink") {
  const relation = relative(root, path);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail(code, "The selected local path must stay inside the SSLZ repository.");
  }
  const segments = relation.split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      fail(code, "Deployment inputs and local state cannot contain symbolic links.");
    }
  }
}

function generatedFile(requestedPath, label) {
  if (!requestedPath) {
    fail("deployment.artifact.path", `${label} is required.`);
  }
  const path = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath);
  const relation = relative(GENERATED_ROOT, path);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail(
      "deployment.artifact.path",
      `${label} must be a file under .sslz/generated.`,
    );
  }
  assertNoLinkedComponents(path);
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail("deployment.artifact.missing", `${label} is not a regular file.`);
  }
  return path;
}

function fileDigest(path) {
  return hashBytes(readFileSync(path));
}

function assertPlanArtifact(plan, planPath) {
  const path = generatedFile(planPath, "The Phase 4 plan artifact");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(
      "deployment.plan.artifact-invalid",
      "The Phase 4 plan artifact is not valid JSON.",
    );
  }
  if (canonicalJson(parsed) !== canonicalJson(plan)) {
    fail(
      "deployment.plan.artifact-mismatch",
      "The supplied plan object does not match the reviewed plan artifact bytes.",
    );
  }
  return path;
}

function collectSourceFiles(directory, include) {
  assertNoLinkedComponents(directory);
  const collected = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const child = resolve(path, entry.name);
      if (entry.isSymbolicLink()) {
        fail(
          "deployment.source.symlink",
          "The existing SSLZ source tree cannot contain symbolic links.",
        );
      }
      if (entry.isDirectory()) {
        if (entry.name !== ".terraform") {
          visit(child);
        }
      } else if (entry.isFile() && include(child)) {
        collected.push(child);
      }
    }
  }
  visit(directory);
  return collected;
}

function sourceFiles(provider) {
  const directory = resolve(root, `infra/${provider}`);
  const files =
    provider === "bicep"
      ? collectSourceFiles(directory, (path) => path.endsWith(".bicep"))
      : collectSourceFiles(
          directory,
          (path) =>
            path.endsWith(".tf") ||
            path.endsWith(".terraform.lock.hcl") ||
            path.endsWith("sslz.deployment.tfrc"),
        );
  if (provider === "bicep") {
    files.push(resolve(root, "bicepconfig.json"));
  }
  return [...new Set(files)].sort((left, right) =>
    relativePath(left).localeCompare(relativePath(right)),
  );
}

function bicepTokens(content) {
  const tokens = [];
  let index = 0;
  while (index < content.length) {
    const character = content[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && content[index + 1] === "/") {
      index = content.indexOf("\n", index + 2);
      if (index === -1) {
        break;
      }
      continue;
    }
    if (character === "/" && content[index + 1] === "*") {
      const end = content.indexOf("*/", index + 2);
      if (end === -1) {
        fail(
          "deployment.bicep.source-syntax",
          "The Bicep source contains an unterminated block comment.",
        );
      }
      index = end + 2;
      continue;
    }
    if (content.startsWith("'''", index)) {
      const end = content.indexOf("'''", index + 3);
      if (end === -1) {
        fail(
          "deployment.bicep.source-syntax",
          "The Bicep source contains an unterminated multiline string.",
        );
      }
      tokens.push({ type: "string", value: content.slice(index + 3, end) });
      index = end + 3;
      continue;
    }
    if (character === "'") {
      let value = "";
      index += 1;
      let closed = false;
      while (index < content.length) {
        if (content[index] === "\\") {
          value += content.slice(index, index + 2);
          index += 2;
        } else if (content[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          value += content[index];
          index += 1;
        }
      }
      if (!closed) {
        fail(
          "deployment.bicep.source-syntax",
          "The Bicep source contains an unterminated string.",
        );
      }
      tokens.push({ type: "string", value });
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_]/.test(content[index] ?? "")) {
        index += 1;
      }
      tokens.push({
        type: "identifier",
        value: content.slice(start, index),
      });
      continue;
    }
    tokens.push({ type: "punctuation", value: character });
    index += 1;
  }
  return tokens;
}

function bicepSourceReferences(path, content) {
  const tokens = bicepTokens(content);
  const forbiddenFunctions = new Set([
    "loadfileasbase64",
    "loadjsoncontent",
    "loadtextcontent",
    "loadyamlcontent",
  ]);
  const modules = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const identifier =
      token.type === "identifier" ? token.value.toLowerCase() : null;
    if (
      forbiddenFunctions.has(identifier) &&
      tokens[index + 1]?.value === "("
    ) {
      fail(
        "deployment.bicep.external-source",
        "The approved Bicep path cannot load content from files.",
      );
    }
    if (identifier === "from" && tokens[index + 1]?.type === "string") {
      fail(
        "deployment.bicep.external-source",
        "The approved Bicep path cannot use imports or registry references.",
      );
    }
    if (identifier === "module") {
      if (
        tokens[index + 1]?.type !== "identifier" ||
        tokens[index + 2]?.type !== "string"
      ) {
        fail(
          "deployment.bicep.module-path",
          "Every Bicep module declaration must use a static local path.",
        );
      }
      modules.push(resolve(dirname(path), tokens[index + 2].value));
    }
  }
  return { modules, tokens };
}

function sourceArtifact(provider) {
  const files = sourceFiles(provider);
  if (provider === "bicep") {
    const sourceRoot = resolve(root, "infra/bicep");
    const included = new Set(files.map((path) => resolve(path)));
    for (const path of files) {
      const content = readFileSync(path, "utf8");
      const { modules } = bicepSourceReferences(path, content);
      for (const modulePath of modules) {
        const relation = relative(sourceRoot, modulePath);
        if (
          relation === ".." ||
          relation.startsWith(`..${sep}`) ||
          isAbsolute(relation) ||
          !included.has(modulePath)
        ) {
          fail(
            "deployment.bicep.module-path",
            "Every Bicep module must resolve to an approved file inside infra/bicep.",
          );
        }
      }
    }
  }
  const entries = files
    .sort((left, right) => relativePath(left).localeCompare(relativePath(right)))
    .map((path) => {
      assertNoLinkedComponents(path);
      if (!existsSync(path) || !statSync(path).isFile()) {
        fail(
          "deployment.source.missing",
          "The existing SSLZ source tree is incomplete.",
        );
      }
      return { path: relativePath(path), digest: fileDigest(path) };
    });
  return {
    path: `infra/${provider}`,
    digest: hashCanonical(entries),
    fileCount: entries.length,
  };
}

function approvalWindow(approval, evaluatedAt, prefix) {
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    approvedAt > evaluatedAt ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > MAX_APPROVAL_TTL_MS
  ) {
    fail(
      `${prefix}.window`,
      "The approval has an invalid, future, or overlong validity window.",
    );
  }
  if (expiresAt <= evaluatedAt) {
    fail(`${prefix}.expired`, "The approval has expired.");
  }
}

function validateReviewedPlan(plan, evaluatedAt) {
  validateDocument(planSchema, plan);
  if (plan.plannerVersion !== VERSION) {
    fail(
      "deployment.plan.version",
      "The reviewed Phase 4 plan version is not supported.",
    );
  }
  if (planDigest(plan.decisionModel) !== plan.planDigest) {
    fail(
      "deployment.plan.digest-mismatch",
      "The reviewed Phase 4 plan digest does not match its canonical decisions.",
    );
  }
  if (plan.inputContractVersion !== "3.0.0" || !plan.readinessEvidence) {
    fail(
      "deployment.readiness.required",
      "Deployment requires a Phase 4 v3 plan with bound readiness evidence.",
    );
  }
  const profile = plan.decisionModel.profile;
  const regional = plan.decisionModel.regional;
  try {
    assertReadinessEvidence(
      {
        schemaVersion: "3.0.0",
        planId: plan.planId,
        target: plan.decisionModel.target,
        workloadPlan: {
          profileVersion: profile.profileVersion,
          computeProfile: profile.computeProfile,
          profileExtensions: profile.profileExtensions,
        },
        regionalPlan: {
          requestedRegionalMode: regional.mode,
          selectedPrimary: regional.primary,
          secondaryRecommendation: regional.secondary,
          recoveryTargets: regional.recoveryTargets,
          costAssumptions: plan.decisionModel.costAssumptions.regional,
        },
        postgresqlPlan: plan.decisionModel.postgresql,
        deployment: {
          paidPlans: plan.decisionModel.paidPlans,
          defenderWorkspacePlacement:
            plan.readinessEvidence.codeEvidence.defenderWorkspacePlacement,
        },
        readinessEvidence: plan.readinessEvidence,
      },
      evaluatedAt,
    );
  } catch (error) {
    if (error instanceof ReadinessEvidenceError) {
      fail(error.code, error.message);
    }
    throw error;
  }
  if (
    canonicalJson(plan.decisionModel.readinessEvidence) !==
    canonicalJson({
      schemaVersion: plan.readinessEvidence.schemaVersion,
      evidenceId: plan.readinessEvidence.evidenceId,
      evidenceDigest: plan.readinessEvidence.evidenceDigest,
      issuedAt: plan.readinessEvidence.issuedAt,
      expiresAt: plan.readinessEvidence.expiresAt,
      topologyDecisionId:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.decisionId,
      topologyDecisionDigest:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.decisionDigest,
      topologyDecisionExpiresAt:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.expiresAt,
      defenderWorkspaceDecisionId:
        plan.readinessEvidence.codeEvidence.defenderWorkspacePlacement
          .decisionId,
      defenderWorkspaceDecisionDigest:
        plan.readinessEvidence.codeEvidence.defenderWorkspacePlacement
          .decisionDigest,
      defenderWorkspaceDecisionExpiresAt:
        plan.readinessEvidence.codeEvidence.defenderWorkspacePlacement
          .expiresAt,
      postgresqlDecisionDigest:
        plan.readinessEvidence.codeEvidence.postgresql?.decisionDigest ?? null,
      postgresqlSelectedEvidenceDigest:
        plan.readinessEvidence.codeEvidence.postgresql
          ?.selectedEvidenceDigest ?? null,
    })
  ) {
    fail(
      "deployment.readiness.binding-mismatch",
      "The Phase 4 readiness evidence does not match its canonical plan binding.",
    );
  }
  const readinessWorkspace =
    plan.readinessEvidence.codeEvidence.defenderWorkspacePlacement;
  const expectedWorkspace = {
    decisionId: readinessWorkspace.decisionId,
    decisionDigest: readinessWorkspace.decisionDigest,
    expiresAt: readinessWorkspace.expiresAt,
    status: readinessWorkspace.status,
    reasonCode: readinessWorkspace.reasonCode,
    required: readinessWorkspace.defenderWorkspaceRequired,
    targetSubscriptionIds: [...readinessWorkspace.targetSubscriptionIds],
    requiredByPlans: [...readinessWorkspace.requiredByPlans],
    paidPlanSelectionDigest: readinessWorkspace.paidPlanSelectionDigest,
    mode: readinessWorkspace.placement.mode,
    region:
      readinessWorkspace.placement.region ??
      plan.decisionModel.regional.primary.region,
    workspaceReference: readinessWorkspace.placement.workspaceReference,
    workspaceReferenceDigest:
      readinessWorkspace.placement.workspaceReferenceDigest,
    scopeDigest: readinessWorkspace.placement.scopeDigest,
    policyEvidenceDigest: readinessWorkspace.evidence.policyEvidenceDigest,
    policyEvidenceExpiresAt:
      readinessWorkspace.evidence.policyEvidenceExpiresAt,
    serviceSupportEvidenceDigest:
      readinessWorkspace.evidence.serviceSupportEvidenceDigest,
    serviceSupportEvidenceExpiresAt:
      readinessWorkspace.evidence.serviceSupportEvidenceExpiresAt,
    dataResidencyEvidenceDigest:
      readinessWorkspace.evidence.dataResidencyEvidenceDigest,
    dataResidencyEvidenceExpiresAt:
      readinessWorkspace.evidence.dataResidencyEvidenceExpiresAt,
    workspaceEvidenceDigest:
      readinessWorkspace.evidence.workspaceEvidenceDigest,
    workspaceEvidenceExpiresAt:
      readinessWorkspace.evidence.workspaceEvidenceExpiresAt,
    centralWorkspaceEvidenceDigest:
      readinessWorkspace.evidence.centralWorkspaceEvidenceDigest,
    centralWorkspaceEvidenceExpiresAt:
      readinessWorkspace.evidence.centralWorkspaceEvidenceExpiresAt,
  };
  if (
    canonicalJson(plan.decisionModel.defenderWorkspace) !==
    canonicalJson(expectedWorkspace)
  ) {
    fail(
      "deployment.workspace-binding-mismatch",
      "The reviewed IaC Defender workspace decision differs from readiness evidence.",
    );
  }
  const targetSubscriptions = new Set(
    plan.decisionModel.target.environments.map(
      (environment) => environment.subscriptionId,
    ),
  );
  if (
    targetSubscriptions.size === 1 &&
    expectedWorkspace.required &&
    expectedWorkspace.mode !== "existing"
  ) {
    fail(
      "deployment.workspace-shared-subscription-unsupported",
      "A shared prod/nonprod subscription requires one approved existing Defender workspace.",
    );
  }
  const planApproval = plan.approval;
  if (
    planApproval.status !== "approved" ||
    planApproval.reapprovalRequired ||
    planApproval.planId !== plan.planId ||
    planApproval.planDigest !== plan.planDigest ||
    planApproval.invalidationReason !== null ||
    !planApproval.approvedAt ||
    !planApproval.expiresAt
  ) {
    fail(
      "deployment.plan.not-approved",
      "Deployment requires the unchanged, explicitly approved Phase 4 plan.",
    );
  }
  approvalWindow(planApproval, evaluatedAt, "deployment.plan.approval");
  if (
    plan.decisionModel?.regional?.mode !== "single-region-ready" ||
    plan.decisionModel.regional.secondary !== null ||
    plan.artifacts.some((artifact) => artifact.regionRole !== "primary") ||
    plan.previews.some((preview) => preview.regionRole !== "primary")
  ) {
    fail(
      "deployment.regional.unsupported",
      "Phase 6 supports only the reviewed primary single-region baseline.",
    );
  }
  if (
    plan.decisionModel.paidPlans?.defenderForResourceManager !== true ||
    plan.decisionModel.paidPlans?.defenderForStorage !== true
  ) {
    fail(
      "deployment.defender.unsupported",
      "The current SSLZ roots require the reviewed Resource Manager and Storage Defender selections.",
    );
  }
}

function selectExecution(plan, provider, environment) {
  if (!["bicep", "terraform"].includes(provider)) {
    fail("deployment.provider", "Provider must be bicep or terraform.");
  }
  if (!["prod", "nonprod"].includes(environment)) {
    fail("deployment.environment", "Environment must be prod or nonprod.");
  }
  const artifacts = plan.artifacts.filter(
    (artifact) =>
      artifact.provider === provider &&
      artifact.environment === environment &&
      artifact.regionRole === "primary",
  );
  const previews = plan.previews.filter(
    (preview) =>
      preview.provider === provider &&
      preview.environment === environment &&
      preview.regionRole === "primary",
  );
  if (artifacts.length !== 1 || previews.length !== 1) {
    fail(
      "deployment.selection.ambiguous",
      "The reviewed plan must contain exactly one selected primary artifact and preview.",
    );
  }
  const artifact = artifacts[0];
  const preview = previews[0];
  const target = plan.decisionModel.target.environments.find(
    (item) => item.name === environment,
  );
  if (
    !target ||
    !UUID.test(target.subscriptionId) ||
    artifact.region !== plan.decisionModel.regional.primary.region ||
    preview.region !== artifact.region ||
    artifact.previewEligible !== true
  ) {
    fail(
      "deployment.selection.target-mismatch",
      "The selected artifact does not match the exact reviewed primary target.",
    );
  }
  if (
    preview.source !== "command" ||
    preview.status !== "succeeded" ||
    preview.destructiveChanges ||
    preview.changes.remove !== 0
  ) {
    fail(
      "deployment.preview.not-approved",
      "Deployment requires a successful non-destructive command preview from Phase 4.",
    );
  }
  return { artifact, preview, target };
}

function terraformSavedPlan(preview, environment) {
  if (!preview.rawArtifact) {
    fail(
      "deployment.terraform.plan-required",
      "Terraform deployment requires the saved plan produced by the reviewed Phase 4 preview.",
    );
  }
  const rawPath = generatedFile(
    preview.rawArtifact,
    "The Phase 4 Terraform preview artifact",
  );
  const expectedName = `terraform-${environment}-primary-plan.txt`;
  if (relativePath(rawPath).split("/").at(-1) !== expectedName) {
    fail(
      "deployment.terraform.preview-path",
      "The Terraform preview artifact path does not match the selected execution.",
    );
  }
  return generatedFile(
    resolve(dirname(rawPath), `${environment}-primary.tfplan`),
    "The reviewed saved Terraform plan",
  );
}

function terraformProvenanceArtifact(preview) {
  if (!preview.provenanceArtifact) {
    fail(
      "deployment.terraform.provenance-required",
      "Terraform deployment requires signed provenance from the trusted Phase 4 builder.",
    );
  }
  const path = generatedFile(
    preview.provenanceArtifact,
    "The signed Terraform plan provenance artifact",
  );
  try {
    return { path, document: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    fail(
      "deployment.terraform.provenance-invalid",
      "The Terraform plan provenance artifact is not valid JSON.",
    );
  }
}

function terraformPlanJsonArtifact(preview, environment) {
  if (!preview.planJsonArtifact) {
    fail(
      "deployment.terraform.plan-json-required",
      "Terraform deployment requires the signed JSON plan artifact produced by Phase 4.",
    );
  }
  const path = generatedFile(
    preview.planJsonArtifact,
    "The signed Terraform JSON plan artifact",
  );
  if (
    relativePath(path).split("/").at(-1) !==
    `${environment}-primary.plan.json`
  ) {
    fail(
      "deployment.terraform.plan-json-path",
      "The Terraform JSON plan path does not match the selected execution.",
    );
  }
  try {
    return { path, document: JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    fail(
      "deployment.terraform.plan-json-invalid",
      "The signed Terraform JSON plan artifact is not valid JSON.",
    );
  }
}

function accountArguments(subscriptionId) {
  return [
    "account",
    "show",
    "--subscription",
    subscriptionId,
    "--query",
    "{id:id,tenantId:tenantId,state:state}",
    "--output",
    "json",
  ];
}

function existingWorkspaceArguments(subscriptionId, workspaceResourceId) {
  return [
    "monitor",
    "log-analytics",
    "workspace",
    "show",
    "--ids",
    workspaceResourceId,
    "--subscription",
    subscriptionId,
    "--query",
    "{id:id,location:location,provisioningState:provisioningState}",
    "--output",
    "json",
    "--only-show-errors",
  ];
}

function assertExistingWorkspaceCurrent(plan, manifest, runner) {
  const workspace = plan.decisionModel.defenderWorkspace;
  if (!workspace.required || workspace.mode !== "existing") {
    return;
  }
  const observed = safeJson(
    runner(
      "az",
      existingWorkspaceArguments(
        manifest.execution.subscriptionId,
        workspace.workspaceReference,
      ),
    ),
  );
  if (
    observed?.id?.toLowerCase() !== workspace.workspaceReference.toLowerCase() ||
    observed?.location?.toLowerCase() !== workspace.region ||
    observed?.provisioningState !== "Succeeded"
  ) {
    fail(
      "deployment.workspace.live-mismatch",
      "The existing Defender workspace reference, region, or provisioning state differs from the reviewed evidence.",
    );
  }
}

function regionalAttemptBinding(plan, selection) {
  const attempt = plan.decisionModel.regionalAttempt;
  if (!attempt || attempt.targetRegion !== selection.artifact.region) {
    fail(
      "deployment.regional-attempt.missing",
      "The selected deployment is not bound to a current regional attempt.",
    );
  }
  const identity = attemptIdentity({
    chainId: attempt.chainId,
    planId: plan.planId,
    originalRegion: attempt.originalRegion,
    targetRegion: attempt.targetRegion,
    attemptNumber: attempt.attemptNumber,
    provider: selection.artifact.provider,
    environment: selection.target.name,
    backendKeyPrefix: plan.decisionModel.terraformBackend.keyPrefix,
    planDigest: plan.planDigest,
  });
  return {
    schemaVersion: attempt.schemaVersion,
    chainId: attempt.chainId,
    attemptId: `${attempt.chainId}-${identity.attemptKey}`,
    attemptNumber: attempt.attemptNumber,
    previousAttemptDigest:
      attempt.previousAttemptDigests[selection.target.name],
    originalRegion: attempt.originalRegion,
    targetRegion: attempt.targetRegion,
    cleanupEvidenceDigest:
      attempt.cleanupEvidenceDigests[selection.target.name],
    safeSameRegionRetry: attempt.safeSameRegionRetry,
    previousAttemptKey: attempt.previousAttemptKeys[selection.target.name],
    previousTargetRegion:
      attempt.previousTargetRegions[selection.target.name],
    previousBindings: attempt.previousBindings[selection.target.name],
    retiredPolicyAssignmentNames:
      attempt.retiredPolicyAssignmentNames[selection.target.name],
    identityDigest: identity.identityDigest,
    attemptKey: identity.attemptKey,
    resourceSuffix: identity.resourceSuffix,
    deploymentName: identity.deploymentName,
    previewDeploymentName: identity.previewDeploymentName,
    stateKey:
      attempt.attemptNumber === 1
        ? `${plan.decisionModel.terraformBackend.keyPrefix}-${selection.target.name}-primary.tfstate`
        : identity.stateKey,
    workspaceName: identity.workspaceName,
    artifactRoot: identity.artifactRoot,
    policyIdentityLifecycle: identity.policyIdentityLifecycle,
  };
}

function deploymentRegionalAttemptRecord(manifest, approval, occurredAt) {
  const attempt = manifest.regionalAttempt;
  assertManifestRegionalBindingsFresh(manifest, approval);
  const stateSuffix =
    `-${manifest.execution.environment}-primary.tfstate`;
  if (!attempt.stateKey.endsWith(stateSuffix)) {
    fail(
      "deployment.regional-attempt.state-mismatch",
      "The regional attempt state key does not match its environment and identity.",
    );
  }
  const record = createRegionalAttempt({
    chainId: attempt.chainId,
    planId: manifest.plan.id,
    originalRegion: attempt.originalRegion,
    targetRegion: attempt.targetRegion,
    attemptNumber: attempt.attemptNumber,
    provider: manifest.execution.provider,
    environment: manifest.execution.environment,
    backendKeyPrefix: attempt.stateKey.slice(0, -stateSuffix.length),
    regionalEvidenceDigest: manifest.readinessEvidence.digest,
    planDigest: manifest.plan.digest,
    artifactDigest: hashCanonical(manifest.artifacts),
    manifestDigest: manifest.manifestDigest,
    approvalDigest: approvalArtifactDigest(approval),
    previousAttemptDigest: attempt.previousAttemptDigest,
    createdAt: new Date(occurredAt).toISOString(),
  });
  if (
    record.attemptId !== attempt.attemptId ||
    record.identities.identityDigest !== attempt.identityDigest ||
    record.identities.attemptKey !== attempt.attemptKey ||
    record.identities.resourceSuffix !== attempt.resourceSuffix ||
    record.identities.deploymentName !== attempt.deploymentName ||
    record.identities.previewDeploymentName !== attempt.previewDeploymentName ||
    record.identities.stateKey !== attempt.stateKey ||
    record.identities.workspaceName !== attempt.workspaceName ||
    record.identities.artifactRoot !== attempt.artifactRoot ||
    canonicalJson(record.identities.policyIdentityLifecycle) !==
      canonicalJson(attempt.policyIdentityLifecycle)
  ) {
    fail(
      "deployment.regional-attempt.binding-mismatch",
      "The regional attempt ledger identity does not match the reviewed manifest.",
    );
  }
  return record;
}

function bicepPreviewArguments(plan, selection) {
  const attempt = regionalAttemptBinding(plan, selection);
  return [
    "deployment",
    "sub",
    "what-if",
    "--subscription",
    selection.target.subscriptionId,
    "--location",
    selection.artifact.region,
    "--template-file",
    "infra/bicep/main.bicep",
    "--parameters",
    selection.artifact.path,
    "--name",
    attempt.attemptNumber === 1
      ? `sslz-preview-${selection.target.name}-${selection.artifact.region}`
      : attempt.previewDeploymentName,
    "--result-format",
    "ResourceIdOnly",
    "--output",
    "json",
  ];
}

function bicepBuildParametersArguments(parameterPath, bicepPath) {
  return [
    "build-params",
    parameterPath,
    "--bicep-file",
    bicepPath,
    "--stdout",
    "--no-restore",
  ];
}

function bicepDeploymentArguments(plan, selection) {
  const attempt = regionalAttemptBinding(plan, selection);
  return [
    "deployment",
    "sub",
    "create",
    "--subscription",
    selection.target.subscriptionId,
    "--location",
    selection.artifact.region,
    "--template-file",
    "infra/bicep/main.bicep",
    "--parameters",
    selection.artifact.path,
    "--name",
    attempt.attemptNumber === 1
      ? `sslz-${selection.target.name}-${plan.planDigest.slice(7, 19)}`
      : attempt.deploymentName,
    "--output",
    "none",
  ];
}

function terraformBackendArguments(plan, selection, authMode) {
  const backend = plan.decisionModel.terraformBackend;
  const attempt = regionalAttemptBinding(plan, selection);
  return [
    `-backend-config=subscription_id=${backend.subscriptionId}`,
    `-backend-config=resource_group_name=${backend.resourceGroupName}`,
    `-backend-config=storage_account_name=${backend.storageAccountName}`,
    `-backend-config=container_name=${backend.containerName}`,
    `-backend-config=key=${attempt.stateKey}`,
    `-backend-config=use_oidc=${authMode === "oidc"}`,
    `-backend-config=use_cli=${authMode === "cli"}`,
    "-backend-config=use_azuread_auth=true",
  ];
}

function terraformPreparationArguments(plan, selection, authMode) {
  return [
    "-chdir=infra/terraform",
    "init",
    "-input=false",
    "-reconfigure",
    "-lockfile=readonly",
    ...terraformBackendArguments(plan, selection, authMode),
  ];
}

function terraformPath(path) {
  return relative(resolve(root, "infra/terraform"), path).split(sep).join("/");
}

function terraformDeploymentArguments(savedPlanPath) {
  return [
    "-chdir=infra/terraform",
    "apply",
    "-input=false",
    "-no-color",
    terraformPath(savedPlanPath),
  ];
}

function commandPreview(executable, args) {
  if (
    !["az", "terraform"].includes(executable) ||
    args.some((argument) => !SAFE_COMMAND_TOKEN.test(argument))
  ) {
    fail(
      "deployment.command.invalid",
      "The reviewed execution cannot be represented as a fixed safe argument array.",
    );
  }
  return [executable, ...args].join(" ");
}

function sanitizedTerraformEnvironment(
  extra = {},
  cliConfigPath = TERRAFORM_CLI_CONFIG_PATH,
  authMode = null,
) {
  const environment = {};
  const allowed = [
    "ALL_PROXY",
    "ARM_CLIENT_ID",
    "ARM_TENANT_ID",
    "ARM_USE_AZUREAD",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "PATH",
    "SYSTEMROOT",
  ];
  if (authMode === "oidc") {
    allowed.push(
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_URL",
      "ARM_OIDC_REQUEST_TOKEN",
      "ARM_OIDC_REQUEST_URL",
    );
  }
  const sourceKeys = new Map(
    Object.keys(process.env).map((key) => [key.toUpperCase(), key]),
  );
  for (const key of allowed) {
    const sourceKey = sourceKeys.get(key);
    if (sourceKey && process.env[sourceKey] !== undefined) {
      environment[key] = process.env[sourceKey];
    }
  }
  if (authMode === "cli") {
    environment.ARM_USE_CLI = "true";
    environment.ARM_USE_OIDC = "false";
    environment.AZURE_CONFIG_DIR = azureCliConfigDirectory();
  } else if (authMode === "oidc") {
    environment.ARM_USE_CLI = "false";
    environment.ARM_USE_OIDC = "true";
  }
  return {
    ...environment,
    ...extra,
    ...(extra.TF_DATA_DIR
      ? {
          TEMP: extra.TF_DATA_DIR,
          TMP: extra.TF_DATA_DIR,
          TMPDIR: extra.TF_DATA_DIR,
        }
      : {}),
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    TF_CLI_CONFIG_FILE: cliConfigPath,
  };
}

function azureCliInvocation(args) {
  try {
    return shellFreeAzureCliInvocation(args);
  } catch {
    fail(
      "deployment.azure-cli.missing",
      "Azure CLI could not be located without a command shell.",
    );
  }
}

function defaultRunner(executable, args, options = {}) {
  const trustedTerraform =
    executable === "terraform" && !options.terraformExecutablePath
      ? terraformExecutable()
      : null;
  const invocation =
    executable === "az"
      ? azureCliInvocation(args)
      : {
          executable:
            executable === "bicep"
              ? BICEP_EXECUTABLE
              : options.terraformExecutablePath ??
                trustedTerraform?.path ??
                executable,
          arguments: args,
        };
  return spawnSync(invocation.executable, invocation.arguments, {
    cwd: root,
    encoding: "utf8",
    env:
      executable === "terraform"
        ? sanitizedTerraformEnvironment(
            options.environment,
            options.terraformCliConfigPath ?? TERRAFORM_CLI_CONFIG_PATH,
            options.terraformAuthMode ?? null,
          )
        : executable === "az"
          ? sanitizedAzureCliEnvironment()
          : process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function safeJson(execution) {
  if (execution.status !== 0) {
    return null;
  }
  try {
    return JSON.parse(execution.stdout);
  } catch {
    return null;
  }
}

function assertTerraformExecutor(manifest, runner) {
  if (manifest.execution.provider !== "terraform") {
    return;
  }
  const identity = safeJson(
    runner("terraform", ["version", "-json"], {
      environment: {},
      terraformAuthMode: manifest.execution.terraformAuthMode,
    }),
  );
  if (
    identity?.terraform_version !== manifest.preview.terraformVersion ||
    identity?.platform !== manifest.preview.terraformPlatform ||
    terraformExecutable().digest !==
      manifest.preview.terraformExecutableDigest
  ) {
    fail(
      "deployment.terraform.executor-mismatch",
      "The local Terraform executable does not match the signed plan version and platform.",
    );
  }
}

function summarizeBicepPreview(
  execution,
  subscriptionId,
  expectedResourceGroups,
) {
  const document = safeJson(execution);
  if (!document || !Array.isArray(document.changes)) {
    fail(
      "deployment.preview.bicep-failed",
      "The exact Bicep what-if could not be classified safely.",
    );
  }
  const changes = { create: 0, modify: 0, remove: 0 };
  for (const change of document.changes) {
    const resourceIdSegments = String(change?.resourceId ?? "")
      .split("/")
      .filter(Boolean);
    const resourceGroupIndex = resourceIdSegments.findIndex(
      (segment) => segment.toLowerCase() === "resourcegroups",
    );
    if (
      resourceGroupIndex !== -1 &&
      !expectedResourceGroups.has(
        resourceIdSegments[resourceGroupIndex + 1]?.toLowerCase(),
      )
    ) {
      fail(
        "deployment.preview.bicep-scope",
        "The Bicep what-if contained a resource outside the exact reviewed resource groups.",
      );
    }
    const resourceType = bicepResourceTypeFromId(
      change?.resourceId,
      subscriptionId,
    );
    if (!EXPECTED_BICEP_RESOURCE_COUNTS.has(resourceType)) {
      fail(
        "deployment.preview.bicep-resource",
        "The Bicep what-if contained a resource type outside the reviewed SSLZ baseline.",
      );
    }
    const type = String(change?.changeType ?? "").toLowerCase();
    if (type === "create") {
      changes.create += 1;
    } else if (["modify", "deploy"].includes(type)) {
      changes.modify += 1;
    } else if (type === "delete") {
      changes.remove += 1;
    } else if (!["ignore", "nochange"].includes(type)) {
      fail(
        "deployment.preview.bicep-unknown",
        "The Bicep what-if contained an unsupported change classification.",
      );
    }
  }
  if (changes.remove > 0) {
    fail(
      "deployment.preview.destructive",
      "The exact Bicep what-if contains destructive changes.",
    );
  }
  return {
    status: "succeeded",
    changes,
    rawOutputDigest: hashBytes(execution.stdout),
    terraformVersion: null,
    terraformPlatform: null,
    terraformExecutableDigest: null,
  };
}

function bicepResourceTypeFromId(resourceId, subscriptionId) {
  if (typeof resourceId !== "string") {
    return null;
  }
  const segments = resourceId.split("/").filter(Boolean);
  if (
    segments[0]?.toLowerCase() !== "subscriptions" ||
    segments[1]?.toLowerCase() !== subscriptionId
  ) {
    return null;
  }
  const providerIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "providers",
  );
  if (
    providerIndex === -1 &&
    segments.length === 4 &&
    segments[0].toLowerCase() === "subscriptions" &&
    segments[2].toLowerCase() === "resourcegroups"
  ) {
    return "Microsoft.Resources/resourceGroups";
  }
  if (
    providerIndex === -1 ||
    providerIndex + 2 >= segments.length ||
    (segments.length - providerIndex - 2) % 2 !== 0
  ) {
    return null;
  }
  const namespace = segments[providerIndex + 1];
  const typeSegments = [];
  for (let index = providerIndex + 2; index < segments.length; index += 2) {
    typeSegments.push(segments[index]);
  }
  const candidate = `${namespace}/${typeSegments.join("/")}`;
  return (
    [...EXPECTED_BICEP_RESOURCE_COUNTS.keys()].find(
      (type) => type.toLowerCase() === candidate.toLowerCase(),
    ) ?? null
  );
}

function bicepResourceEntries(resources) {
  if (Array.isArray(resources)) {
    return resources.map((resource, index) => [`resource${index}`, resource]);
  }
  if (resources && typeof resources === "object") {
    return Object.entries(resources);
  }
  return [];
}

function containsForbiddenBicepKey(value) {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenBicepKey);
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const forbidden = new Set([
    "copy",
    "parameterslink",
    "primaryscripturi",
    "scriptcontent",
    "supportingscripturis",
    "templatelink",
  ]);
  return Object.entries(value).some(
    ([key, nested]) =>
      forbidden.has(key.toLowerCase()) || containsForbiddenBicepKey(nested),
  );
}

function unsafeBicepRuntimeExpression(value) {
  if (Array.isArray(value)) {
    return value.some(unsafeBicepRuntimeExpression);
  }
  if (typeof value === "string") {
    if (/\blist[a-z0-9]*\s*\(/i.test(value)) {
      return true;
    }
    return (
      /\breference\s*\(/i.test(value) &&
      !EXPECTED_BICEP_REFERENCES.has(value)
    );
  }
  return (
    value &&
    typeof value === "object" &&
    Object.values(value).some(unsafeBicepRuntimeExpression)
  );
}

function summarizeBicepTemplate(document, subscriptionId) {
  if (
    !document ||
    document.$schema !==
      "https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#" ||
    document.languageVersion !== "2.0" ||
    containsForbiddenBicepKey(document) ||
    unsafeBicepRuntimeExpression(document)
  ) {
    fail(
      "deployment.bicep.template-invalid",
      "The compiled Bicep template is invalid, externally linked, or contains script content.",
    );
  }
  const counts = new Map();
  const roleBindings = new Set();
  const graph = [];
  const subscriptionScope = `/subscriptions/${subscriptionId}`;
  const visit = (
    template,
    effectiveScope,
    rootTemplate = false,
    templateName = "root",
  ) => {
    if (
      canonicalJson(Object.keys(template?.outputs ?? {}).sort()) !==
      canonicalJson(EXPECTED_BICEP_OUTPUTS.get(templateName))
    ) {
      fail(
        "deployment.bicep.outputs",
        "The compiled Bicep template contains unexpected deployment outputs.",
      );
    }
    for (const [symbolicName, resource] of bicepResourceEntries(
      template?.resources,
    )) {
      const type = [...EXPECTED_BICEP_RESOURCE_COUNTS.keys()].find(
        (item) => item.toLowerCase() === String(resource?.type).toLowerCase(),
      );
      if (
        !type ||
        ["scope", "subscriptionId"].some((field) =>
          Object.hasOwn(resource, field),
        )
      ) {
        fail(
          "deployment.bicep.resource-graph",
          "The compiled Bicep template contains an unexpected resource type or scope.",
        );
      }
      counts.set(type, (counts.get(type) ?? 0) + 1);
      const graphEntry = {
        type,
        scope: effectiveScope,
      };
      if (type === "Microsoft.Resources/deployments") {
        const expectedResourceGroup = rootTemplate
          ? EXPECTED_BICEP_DEPLOYMENT_SCOPES.get(symbolicName)
          : undefined;
        if (
          !rootTemplate ||
          !EXPECTED_BICEP_DEPLOYMENT_SCOPES.has(symbolicName) ||
          (resource.resourceGroup ?? null) !== expectedResourceGroup ||
          resource.properties?.mode !== "Incremental" ||
          resource.properties?.expressionEvaluationOptions?.scope !== "inner" ||
          !resource.properties?.template ||
          resource.properties?.templateLink ||
          resource.properties?.parametersLink
        ) {
          fail(
            "deployment.bicep.nested-deployment",
            "Bicep modules must compile to inline incremental deployments.",
          );
        }
        const targetScope = expectedResourceGroup
          ? `${subscriptionScope}/resourceGroups/${expectedResourceGroup}`
          : subscriptionScope;
        graphEntry.targetScope = targetScope;
        visit(
          resource.properties.template,
          targetScope,
          false,
          symbolicName,
        );
      } else if (Object.hasOwn(resource, "resourceGroup")) {
        fail(
          "deployment.bicep.resource-graph",
          "Only the exact reviewed module deployments may set resource-group scope.",
        );
      }
      if (type === "Microsoft.Authorization/roleAssignments") {
        const match = String(
          resource.properties?.roleDefinitionId ?? "",
        ).match(/^\[variables\('roleDefinitions'\)\.([A-Za-z]+)\]$/);
        const alias = match?.[1];
        const expectedRoleId = EXPECTED_BICEP_ROLE_DEFINITIONS.get(alias);
        const compiledRoleId = template?.variables?.roleDefinitions?.[alias];
        const principalId = resource.properties?.principalId;
        const binding = `${alias}|${principalId}`;
        if (
          !expectedRoleId ||
          typeof compiledRoleId !== "string" ||
          compiledRoleId.toLowerCase() !==
            `/providers/microsoft.authorization/roledefinitions/${expectedRoleId}` ||
          resource.properties?.principalType !== "ServicePrincipal" ||
          !EXPECTED_BICEP_ROLE_BINDINGS.has(binding) ||
          roleBindings.has(binding)
        ) {
          fail(
            "deployment.bicep.role-assignment",
            "The compiled Bicep template contains an unexpected role or principal binding.",
          );
        }
        roleBindings.add(binding);
        graphEntry.role = alias;
        graphEntry.principalDigest = hashBytes(principalId);
      }
      graph.push(graphEntry);
    }
  };
  visit(document, subscriptionScope, true);
  const expectedCounts = [...EXPECTED_BICEP_RESOURCE_COUNTS].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const actualCounts = [...counts].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (
    canonicalJson(actualCounts) !== canonicalJson(expectedCounts) ||
    canonicalJson([...roleBindings].sort()) !==
      canonicalJson([...EXPECTED_BICEP_ROLE_BINDINGS].sort())
  ) {
    fail(
      "deployment.bicep.resource-graph",
      "The compiled Bicep resource graph does not exactly match the reviewed SSLZ baseline.",
    );
  }
  return {
    compiledTemplateDigest: hashCanonical(document),
    resourceGraphDigest: hashCanonical(graph),
  };
}

function expectedAllowedLocations(plan) {
  const workspace = plan.decisionModel.defenderWorkspace;
  return [
    ...new Set([
      plan.decisionModel.regional.primary.region,
      ...(plan.decisionModel.regional.secondary
        ? [plan.decisionModel.regional.secondary.region]
        : []),
      ...(workspace.required ? [workspace.region] : []),
    ]),
  ].sort();
}

function managesDefenderWorkspaceAssociation(plan, selection) {
  if (!plan.decisionModel.defenderWorkspace.required) {
    return false;
  }
  const subscriptionEnvironments = plan.decisionModel.target.environments
    .filter(
      (environment) =>
        environment.subscriptionId.toLowerCase() ===
        selection.target.subscriptionId.toLowerCase(),
    )
    .sort((left, right) => {
      if (left.name === "prod") return -1;
      if (right.name === "prod") return 1;
      return left.name.localeCompare(right.name);
    });
  return subscriptionEnvironments[0]?.name === selection.target.name;
}

function defenderWorkspaceUsesSharedSubscription(plan, selection) {
  return (
    plan.decisionModel.target.environments.filter(
      (environment) =>
        environment.subscriptionId.toLowerCase() ===
        selection.target.subscriptionId.toLowerCase(),
    ).length > 1
  );
}

function expectedBicepParameters(plan, selection) {
  const configuration = plan.decisionModel.configuration;
  const paidPlans = plan.decisionModel.paidPlans;
  const workspace = plan.decisionModel.defenderWorkspace;
  const managesWorkspaceAssociation = managesDefenderWorkspaceAssociation(
    plan,
    selection,
  );
  const attempt = regionalAttemptBinding(plan, selection);
  return {
    location: selection.artifact.region,
    companyName: configuration.companyName,
    environment: selection.target.name,
    monthlyBudgetAmount:
      configuration.monthlyBudgetAmounts[selection.target.name],
    budgetAlertEmails: ["budget-alerts@example.invalid"],
    deployNetworking: configuration.deployNetworking,
    vnetAddressPrefix: plan.decisionModel.regional.primary.vnetCidr,
    appSubnetDelegation: configuration.appSubnetDelegation,
    enableDefenderForServers: paidPlans.defenderForServers,
    enableDefenderForContainers: paidPlans.defenderForContainers,
    enableDefenderForDatabases: paidPlans.defenderForDatabases,
    enableDefenderForKeyVault: paidPlans.defenderForKeyVault,
    configureDefenderWorkspace: managesWorkspaceAssociation,
    defenderWorkspaceAssociationManagedExternally:
      workspace.required && !managesWorkspaceAssociation,
    defenderWorkspaceSharedSubscription:
      defenderWorkspaceUsesSharedSubscription(plan, selection),
    logAnalyticsWorkspaceLocation: workspace.region,
    existingLogAnalyticsWorkspaceId:
      workspace.mode === "existing" ? workspace.workspaceReference : "",
    securityContactEmail: "security-alerts@example.invalid",
    budgetStartDate: configuration.budgetStartDate,
    allowedLocations: expectedAllowedLocations(plan),
    logRetentionInDays: configuration.logRetentionInDays,
    logDailyQuotaGb: configuration.logDailyQuotaGb,
    ...(attempt.attemptNumber > 1
      ? {
          regionalAttemptSuffix: attempt.resourceSuffix,
          policyAssignmentPrefix: `${attempt.attemptKey}-`,
        }
      : {}),
  };
}

function safeNotificationEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
      value,
    )
  );
}

function notificationContactsDigest(budgetAlertEmails, securityContactEmail) {
  if (
    !Array.isArray(budgetAlertEmails) ||
    budgetAlertEmails.length < 1 ||
    budgetAlertEmails.length > 5 ||
    new Set(budgetAlertEmails).size !== budgetAlertEmails.length ||
    !budgetAlertEmails.every(safeNotificationEmail) ||
    !safeNotificationEmail(securityContactEmail)
  ) {
    fail(
      "deployment.notification-contacts.invalid",
      "Notification contacts must be one to five unique safe email addresses plus one safe security contact.",
    );
  }
  return hashCanonical({
    budgetAlertEmails,
    securityContactEmail,
  });
}

function assertBicepNotificationBindings(template) {
  const defender = template.resources?.defender;
  const budgets = template.resources?.budgets;
  const defenderResources = Object.values(
    defender?.properties?.template?.resources ?? {},
  );
  const budgetResources = Object.values(
    budgets?.properties?.template?.resources ?? {},
  );
  const securityContact = defenderResources.find(
    (resource) => resource.type === "Microsoft.Security/securityContacts",
  );
  const budget = budgetResources.find(
    (resource) => resource.type === "Microsoft.Consumption/budgets",
  );
  const notifications = Object.values(budget?.properties?.notifications ?? {});
  if (
    defender?.properties?.parameters?.securityContactEmail?.value !==
      "[parameters('securityContactEmail')]" ||
    budgets?.properties?.parameters?.contactEmails?.value !==
      "[parameters('budgetAlertEmails')]" ||
    securityContact?.properties?.emails !==
      "[parameters('securityContactEmail')]" ||
    notifications.length !== 4 ||
    notifications.some(
      (notification) =>
        notification?.contactEmails !== "[parameters('contactEmails')]",
    )
  ) {
    fail(
      "deployment.bicep.notification-bindings",
      "The compiled Bicep resources do not consume the approved notification-contact parameters exactly.",
    );
  }
}

function summarizeBicepBuild(
  execution,
  plan,
  selection,
  parameterPath,
  expectedTemplatePath = resolve(root, "infra/bicep/main.bicep"),
) {
  const build = safeJson(execution);
  let template;
  let parameters;
  try {
    template = JSON.parse(build?.templateJson);
    parameters = JSON.parse(build?.parametersJson);
  } catch {
    fail(
      "deployment.bicep.build-failed",
      "The Bicep template and parameters could not be compiled safely.",
    );
  }
  if (
    build?.templateSpecId !== null ||
    parameters?.$schema !==
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#" ||
    parameters?.contentVersion !== "1.0.0.0"
  ) {
    fail(
      "deployment.bicep.parameters-invalid",
      "The compiled Bicep parameters are not a direct local deployment artifact.",
    );
  }
  const parameterSource = readFileSync(parameterPath, "utf8");
  const parameterTokens = bicepTokens(parameterSource);
  const usingIndex = parameterTokens.findIndex(
    (token) =>
      token.type === "identifier" && token.value.toLowerCase() === "using",
  );
  const usingPath = parameterTokens[usingIndex + 1];
  const readsEnvironment = parameterTokens.some(
    (token, index) =>
      token.type === "identifier" &&
      token.value.toLowerCase() === "readenvironmentvariable" &&
      parameterTokens[index + 1]?.value === "(",
  );
  if (
    usingIndex === -1 ||
    usingPath?.type !== "string" ||
    resolve(dirname(parameterPath), usingPath.value) !==
      expectedTemplatePath ||
    readsEnvironment
  ) {
    fail(
      "deployment.bicep.parameter-source",
      "The Bicep parameter artifact must directly reference the approved root and cannot read the environment.",
    );
  }
  const compiledValues = Object.fromEntries(
    Object.entries(parameters.parameters ?? {}).map(([name, value]) => {
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).length !== 1 ||
        !Object.hasOwn(value, "value")
      ) {
        fail(
          "deployment.bicep.parameters-invalid",
          "Every compiled Bicep parameter must be a concrete literal value.",
        );
      }
      return [name, value.value];
    }),
  );
  const expectedValues = expectedBicepParameters(plan, selection);
  const expectedKeys = Object.keys(expectedValues).sort();
  const compiledKeys = Object.keys(compiledValues).sort();
  const budgetAlertEmails = compiledValues.budgetAlertEmails;
  const securityContactEmail = compiledValues.securityContactEmail;
  const contactsDigest = notificationContactsDigest(
    budgetAlertEmails,
    securityContactEmail,
  );
  assertBicepNotificationBindings(template);
  const withoutContacts = (values) =>
    Object.fromEntries(
      Object.entries(values).filter(
        ([name]) =>
          name !== "budgetAlertEmails" && name !== "securityContactEmail",
      ),
    );
  if (
    canonicalJson(compiledKeys) !== canonicalJson(expectedKeys) ||
    canonicalJson(withoutContacts(compiledValues)) !==
      canonicalJson(withoutContacts(expectedValues))
  ) {
    fail(
      "deployment.bicep.parameters-mismatch",
      "The compiled Bicep parameters do not match the reviewed plan or safe notification-contact constraints.",
    );
  }
  return {
    attestation: {
      ...summarizeBicepTemplate(template, selection.target.subscriptionId),
      compiledParametersDigest: hashCanonical(parameters),
      notificationContactsDigest: contactsDigest,
    },
    template,
    parameters,
  };
}

function expectedTerraformVariables(plan, selection) {
  const configuration = plan.decisionModel.configuration;
  const paidPlans = plan.decisionModel.paidPlans;
  const workspace = plan.decisionModel.defenderWorkspace;
  const managesWorkspaceAssociation = managesDefenderWorkspaceAssociation(
    plan,
    selection,
  );
  const attempt = regionalAttemptBinding(plan, selection);
  return {
    subscription_id: selection.target.subscriptionId,
    resource_provider_registrations: "none",
    resource_providers_to_register: [],
    location: selection.artifact.region,
    company_name: configuration.companyName,
    environment: selection.target.name,
    monthly_budget_amount:
      configuration.monthlyBudgetAmounts[selection.target.name],
    deploy_networking: configuration.deployNetworking,
    vnet_address_prefix: plan.decisionModel.regional.primary.vnetCidr,
    app_subnet_delegation: configuration.appSubnetDelegation,
    enable_defender_for_servers: paidPlans.defenderForServers,
    enable_defender_for_containers: paidPlans.defenderForContainers,
    enable_defender_for_databases: paidPlans.defenderForDatabases,
    enable_defender_for_key_vault: paidPlans.defenderForKeyVault,
    configure_defender_workspace: managesWorkspaceAssociation,
    defender_workspace_association_managed_externally:
      workspace.required && !managesWorkspaceAssociation,
    defender_workspace_shared_subscription:
      defenderWorkspaceUsesSharedSubscription(plan, selection),
    log_analytics_workspace_location: workspace.region,
    existing_log_analytics_workspace_id:
      workspace.mode === "existing" ? workspace.workspaceReference : "",
    budget_start_date: configuration.budgetStartDate,
    allowed_locations: expectedAllowedLocations(plan),
    log_retention_in_days: configuration.logRetentionInDays,
    log_daily_quota_gb: configuration.logDailyQuotaGb,
    ...(attempt.attemptNumber > 1
      ? {
          regional_attempt_suffix: attempt.resourceSuffix,
          policy_assignment_prefix: `${attempt.attemptKey}-`,
        }
      : {}),
  };
}

function terraformNotificationContacts(variables) {
  return {
    budgetAlertEmails: variables.budget_alert_emails?.value,
    securityContactEmail: variables.security_contact_email?.value,
  };
}

function terraformPlannedNotificationContacts(plannedByAddress) {
  const budget = plannedByAddress.get(
    "azurerm_consumption_budget_subscription.monthly",
  );
  const securityContact = plannedByAddress.get(
    "module.security.azurerm_security_center_contact.default",
  );
  const notifications = budget?.values?.notification;
  const budgetContacts =
    Array.isArray(notifications) && notifications.length === 4
      ? notifications[0]?.contact_emails
      : null;
  if (
    !Array.isArray(notifications) ||
    notifications.length !== 4 ||
    notifications.some(
      (notification) =>
        notification?.enabled !== true ||
        canonicalJson(notification?.contact_emails) !==
          canonicalJson(budgetContacts),
    ) ||
    typeof securityContact?.values?.email !== "string"
  ) {
    fail(
      "deployment.terraform.notification-bindings",
      "The saved Terraform resources do not contain consistent inspectable notification contacts.",
    );
  }
  return {
    budgetAlertEmails: budgetContacts,
    securityContactEmail: securityContact.values.email,
  };
}

function assertNoForeignTerraformSubscription(value, subscriptionId) {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoForeignTerraformSubscription(item, subscriptionId);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      assertNoForeignTerraformSubscription(nested, subscriptionId);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  for (const match of value.matchAll(
    /\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/gi,
  )) {
    if (match[1].toLowerCase() !== subscriptionId) {
      fail(
        "deployment.preview.terraform-subscription",
        "The saved Terraform plan contains a resolved resource ID or scope in another subscription.",
      );
    }
  }
}

function assertTerraformProvenance(
  provenance,
  publicKey,
  plan,
  selection,
  source,
  parameterDigest,
  savedPlanDigest,
  planJsonDigest,
  freshPreview,
  terraformAuthMode,
) {
  validateDocument(provenanceSchema, provenance);
  if (!publicKey) {
    fail(
      "deployment.terraform.provenance-trust-anchor",
      "Terraform deployment requires a protected provenance public key.",
    );
  }
  let verified = false;
  try {
    verified = verifyTerraformProvenance(provenance, publicKey);
  } catch {
    verified = false;
  }
  if (!verified) {
    fail(
      "deployment.terraform.provenance-signature",
      "The Terraform plan provenance signature is invalid.",
    );
  }
  const expected = {
    sourceDigest: source.digest,
    parameterDigest,
    backendDigest: hashCanonicalProvenance({
      backend: plan.decisionModel.terraformBackend,
      arguments: terraformBackendArguments(
        plan,
        selection,
        terraformAuthMode,
      ),
    }),
    providerLockDigest: fileDigest(
      resolve(root, "infra/terraform/.terraform.lock.hcl"),
    ),
    savedPlanDigest,
    planJsonDigest,
    configurationDigest:
      freshPreview.terraformAttestation.configurationDigest,
    plannedValuesDigest:
      freshPreview.terraformAttestation.plannedValuesDigest,
    providerConfigurationDigest:
      freshPreview.terraformAttestation.providerConfigurationDigest,
    resourceChangesDigest:
      freshPreview.terraformAttestation.resourceChangesDigest,
    variablesDigest: freshPreview.terraformAttestation.variablesDigest,
    terraformVersion: freshPreview.terraformVersion,
    terraformPlatform: freshPreview.terraformPlatform,
    terraformExecutableDigest: freshPreview.terraformExecutableDigest,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (provenance[field] !== expectedValue) {
      fail(
        "deployment.terraform.provenance-mismatch",
        "The signed Terraform provenance does not match the exact reviewed source, parameters, backend, providers, semantics, and saved plan.",
      );
    }
  }
}

function normalizedTerraformAddress(address) {
  return String(address).replace(/\[[0-9]+\]/g, "");
}

function expectedTerraformResourceGraph() {
  return [...EXPECTED_TERRAFORM_RESOURCES].map(([address, type]) => ({
    address,
    type,
  }));
}

function collectTerraformConfigurationResources(module, prefix = "") {
  const resources = [];
  for (const resource of module?.resources ?? []) {
    resources.push({
      ...resource,
      address: normalizedTerraformAddress(`${prefix}${resource.address}`),
    });
  }
  for (const [name, call] of Object.entries(module?.module_calls ?? {})) {
    resources.push(
      ...collectTerraformConfigurationResources(
        call?.module,
        `${prefix}module.${name}.`,
      ),
    );
  }
  return resources;
}

function assertTerraformModuleGraph(rootModule) {
  const moduleCalls = rootModule?.module_calls ?? {};
  if (
    Object.keys(moduleCalls).length !== EXPECTED_TERRAFORM_MODULES.size ||
    [...EXPECTED_TERRAFORM_MODULES].some(
      ([name, source]) => moduleCalls[name]?.source !== source,
    ) ||
    Object.values(moduleCalls).some(
      (call) => Object.keys(call?.module?.module_calls ?? {}).length !== 0,
    )
  ) {
    fail(
      "deployment.preview.terraform-module",
      "The saved Terraform plan contains an unexpected or external module source.",
    );
  }
}

function hasTerraformExecutionHook(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      ["action", "actions", "connection", "provisioner", "provisioners"].includes(
        key,
      ) &&
      child !== null &&
      (!Array.isArray(child) || child.length > 0)
    ) {
      return true;
    }
    if (hasTerraformExecutionHook(child)) {
      return true;
    }
  }
  return false;
}

function assertTerraformPrincipalExpressions(resources) {
  for (const resource of resources) {
    const expectedPrincipal = EXPECTED_TERRAFORM_PRINCIPALS.get(
      resource.address,
    );
    if (!expectedPrincipal) {
      continue;
    }
    const references = resource.expressions?.principal_id?.references;
    if (
      !Array.isArray(references) ||
      references.length !== 1 ||
      references[0] !== `${expectedPrincipal}.identity[0].principal_id`
    ) {
      fail(
        "deployment.preview.terraform-principal",
        "The saved Terraform plan role principals do not come from the expected policy managed identities.",
      );
    }
  }
}

function collectTerraformPlannedResources(module) {
  const resources = [...(module?.resources ?? [])];
  for (const child of module?.child_modules ?? []) {
    resources.push(...collectTerraformPlannedResources(child));
  }
  return resources;
}

function assertTerraformResource(
  resource,
  configurationAddresses,
  selection,
  requireValues,
) {
  const address = normalizedTerraformAddress(resource.address);
  const expectedType = EXPECTED_TERRAFORM_RESOURCES.get(address);
  const expectedProvider =
    resource.type === "terraform_data"
      ? "terraform.io/builtin/terraform"
      : "registry.terraform.io/hashicorp/azurerm";
  if (
    typeof resource.address !== "string" ||
    typeof resource.type !== "string" ||
    !configurationAddresses.has(address) ||
    resource.type !== expectedType ||
    resource.provider_name !== expectedProvider
  ) {
    fail(
      "deployment.preview.terraform-resource",
      "The saved Terraform plan graph does not match the exact allowlisted SSLZ configuration.",
    );
  }
  if (!requireValues) {
    return;
  }
  const values = resource.values;
  const scope = `/subscriptions/${selection.target.subscriptionId}`;
  if (!values || typeof values !== "object") {
    fail(
      "deployment.preview.terraform-values",
      "The saved Terraform plan omits required planned resource values.",
    );
  }
  if (
    resource.type === "azurerm_role_assignment" &&
    (values.scope !== scope ||
      values.role_definition_name !== EXPECTED_TERRAFORM_ROLES.get(address))
  ) {
    fail(
      "deployment.preview.terraform-scope",
      "The saved Terraform plan contains an unexpected role or role-assignment scope.",
    );
  }
  if (
    resource.type === "azurerm_subscription_policy_assignment" &&
    values.subscription_id !== scope
  ) {
    fail(
      "deployment.preview.terraform-scope",
      "The saved Terraform plan contains a policy assignment outside the reviewed subscription scope.",
    );
  }
  if (
    resource.type === "azurerm_consumption_budget_subscription" &&
    values.subscription_id !== scope
  ) {
    fail(
      "deployment.preview.terraform-scope",
      "The saved Terraform plan contains a budget outside the reviewed subscription scope.",
    );
  }
  if (
    resource.type === "azurerm_monitor_diagnostic_setting" &&
    values.target_resource_id !== scope
  ) {
    fail(
      "deployment.preview.terraform-scope",
      "The saved Terraform plan contains an Activity Log destination outside the reviewed subscription scope.",
    );
  }
}

function summarizeTerraformPreview(execution, plan, selection, terraformPlatform) {
  const document = safeJson(execution);
  if (
    !document ||
    !Array.isArray(document.resource_changes) ||
    !document.variables ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(
      document.terraform_version ?? "",
    )
  ) {
    fail(
      "deployment.preview.terraform-failed",
      "The saved Terraform plan could not be classified safely.",
    );
  }
  const expectedVariables = expectedTerraformVariables(plan, selection);
  const expectedVariableNames = [
    ...Object.keys(expectedVariables),
    "budget_alert_emails",
    "security_contact_email",
  ].sort();
  if (
    canonicalJson(Object.keys(document.variables).sort()) !==
    canonicalJson(expectedVariableNames)
  ) {
    fail(
      "deployment.terraform.variables-mismatch",
      "The saved Terraform plan contains missing or unexpected variables.",
    );
  }
  for (const [name, expected] of Object.entries(expectedVariables)) {
    if (
      !Object.hasOwn(document.variables, name) ||
      canonicalJson(document.variables[name]?.value) !== canonicalJson(expected)
    ) {
      fail(
        "deployment.terraform.variables-mismatch",
        "The saved Terraform plan variables do not match the reviewed Phase 4 decisions.",
      );
    }
  }
  const contacts = terraformNotificationContacts(document.variables);
  const expectedContactsDigest = notificationContactsDigest(
    contacts.budgetAlertEmails,
    contacts.securityContactEmail,
  );
  const configuration = document.configuration;
  if (
    !configuration ||
    typeof configuration !== "object" ||
    !configuration.provider_config ||
    !configuration.root_module
  ) {
    fail(
      "deployment.preview.terraform-configuration",
      "The saved Terraform plan does not contain an inspectable configuration graph.",
    );
  }
  const providerConfigurations = configuration.provider_config;
  const azurermProvider = providerConfigurations.azurerm;
  const defenderWorkspaceProvider =
    providerConfigurations["azurerm.defender_workspace"];
  const terraformProvider = providerConfigurations.terraform;
  if (
    Object.keys(providerConfigurations).length !== 3 ||
    azurermProvider?.full_name !==
      "registry.terraform.io/hashicorp/azurerm" ||
    defenderWorkspaceProvider?.full_name !==
      "registry.terraform.io/hashicorp/azurerm" ||
    defenderWorkspaceProvider?.alias !== "defender_workspace" ||
    terraformProvider?.full_name !== "terraform.io/builtin/terraform" ||
    Object.hasOwn(terraformProvider ?? {}, "expressions") ||
    canonicalJson(
      azurermProvider?.expressions?.subscription_id,
    ) !== canonicalJson({ references: ["var.subscription_id"] }) ||
    canonicalJson(
      azurermProvider?.expressions
        ?.resource_provider_registrations,
    ) !==
      canonicalJson({
        references: ["var.resource_provider_registrations"],
      }) ||
    canonicalJson(
      azurermProvider?.expressions
        ?.resource_providers_to_register,
    ) !==
      canonicalJson({
        references: ["var.resource_providers_to_register"],
      }) ||
    canonicalJson(
      defenderWorkspaceProvider?.expressions?.subscription_id,
    ) !== canonicalJson({ references: ["var.subscription_id"] }) ||
    canonicalJson(
      defenderWorkspaceProvider?.expressions
        ?.resource_provider_registrations,
    ) !==
      canonicalJson({
        references: ["var.resource_provider_registrations"],
      }) ||
    canonicalJson(
      defenderWorkspaceProvider?.expressions
        ?.resource_providers_to_register,
    ) !==
      canonicalJson({
        references: ["var.resource_providers_to_register"],
      })
  ) {
    fail(
      "deployment.preview.terraform-provider",
      "The saved Terraform plan contains an unexpected provider configuration or permits automatic provider registration.",
    );
  }
  assertNoForeignTerraformSubscription(
    {
      plannedValues: document.planned_values,
      resourceChanges: document.resource_changes,
    },
    selection.target.subscriptionId,
  );
  assertTerraformModuleGraph(configuration.root_module);
  if (
    hasTerraformExecutionHook(configuration) ||
    (Array.isArray(document.action_invocations) &&
      document.action_invocations.length > 0)
  ) {
    fail(
      "deployment.preview.terraform-execution-hook",
      "The saved Terraform plan contains a provisioner, connection, or action hook.",
    );
  }
  const configuredResources = collectTerraformConfigurationResources(
    configuration.root_module,
  );
  const configuredGraph = new Map(
    configuredResources.map((resource) => [resource.address, resource.type]),
  );
  if (
    configuredResources.length !== EXPECTED_TERRAFORM_RESOURCES.size ||
    configuredGraph.size !== EXPECTED_TERRAFORM_RESOURCES.size ||
    [...EXPECTED_TERRAFORM_RESOURCES].some(
      ([address, type]) => configuredGraph.get(address) !== type,
    ) ||
    configuredResources.some(
      (resource) =>
        resource.provider_config_key !==
          (resource.type === "terraform_data"
            ? "terraform"
            : resource.type === "azurerm_security_center_workspace"
              ? "azurerm.defender_workspace"
              : "azurerm") ||
        typeof resource.address !== "string",
    )
  ) {
    fail(
      "deployment.preview.terraform-resource",
      "The saved Terraform plan contains an unexpected resource or provider binding.",
    );
  }
  const placementGuardCheck = Array.isArray(document.checks)
    ? document.checks.find(
        (check) =>
          check.address?.kind === "resource" &&
          check.address?.mode === "managed" &&
          check.address?.type === "terraform_data" &&
          check.address?.to_display ===
            "terraform_data.log_analytics_workspace_placement_guard",
      )
    : null;
  if (
    placementGuardCheck?.status !== "pass" ||
    !Array.isArray(placementGuardCheck.instances) ||
    placementGuardCheck.instances.length !== 1 ||
    placementGuardCheck.instances[0]?.status !== "pass" ||
    placementGuardCheck.instances[0]?.address?.to_display !==
      "terraform_data.log_analytics_workspace_placement_guard"
  ) {
    fail(
      "deployment.preview.terraform-placement-guard",
      "The saved Terraform plan does not contain a passing Defender workspace placement guard.",
    );
  }
  const configurationAddresses = new Set(
    configuredResources.map((resource) => resource.address),
  );
  assertTerraformPrincipalExpressions(configuredResources);
  if (!document.planned_values?.root_module) {
    fail(
      "deployment.preview.terraform-values",
      "The saved Terraform plan does not contain inspectable planned values.",
    );
  }
  const plannedResources = collectTerraformPlannedResources(
    document.planned_values.root_module,
  );
  for (const resource of plannedResources) {
    assertTerraformResource(resource, configurationAddresses, selection, true);
  }
  const plannedByAddress = new Map(
    plannedResources.map((resource) => [
      normalizedTerraformAddress(resource.address),
      resource,
    ]),
  );
  const changesByAddress = new Map(
    document.resource_changes.map((change) => [
      normalizedTerraformAddress(change.address),
      change.change,
    ]),
  );
  const plannedContacts = terraformPlannedNotificationContacts(
    plannedByAddress,
  );
  const contactsDigest = notificationContactsDigest(
    plannedContacts.budgetAlertEmails,
    plannedContacts.securityContactEmail,
  );
  if (contactsDigest !== expectedContactsDigest) {
    fail(
      "deployment.terraform.notification-bindings",
      "The saved Terraform resources do not consume the approved notification-contact variables exactly.",
    );
  }
  for (const [roleAddress, principalAddress] of EXPECTED_TERRAFORM_PRINCIPALS) {
    const rolePrincipal =
      plannedByAddress.get(roleAddress)?.values?.principal_id;
    const policyPrincipal = plannedByAddress.get(
      `module.policy.${principalAddress}`,
    )?.values?.identity?.[0]?.principal_id;
    const rolePrincipalUnknown =
      changesByAddress.get(roleAddress)?.after_unknown?.principal_id === true;
    const policyPrincipalUnknown =
      changesByAddress.get(`module.policy.${principalAddress}`)?.after_unknown
        ?.identity?.[0]?.principal_id === true;
    const resolved =
      typeof rolePrincipal === "string" &&
      typeof policyPrincipal === "string" &&
      rolePrincipal === policyPrincipal;
    const safelyDeferred =
      rolePrincipal == null &&
      policyPrincipal == null &&
      rolePrincipalUnknown &&
      policyPrincipalUnknown;
    if (
      !resolved &&
      !safelyDeferred
    ) {
      fail(
        "deployment.preview.terraform-principal",
        "Every saved Terraform plan role principal must resolve exactly to its expected policy managed identity or be explicitly deferred by the initial create plan.",
      );
    }
  }
  const changes = { create: 0, modify: 0, remove: 0 };
  for (const change of document.resource_changes) {
    const actions = change?.change?.actions;
    if (!Array.isArray(actions) || actions.some((action) => typeof action !== "string")) {
      fail(
        "deployment.preview.terraform-unknown",
        "The Terraform plan contained an unsupported change classification.",
      );
    }
    assertTerraformResource(change, configurationAddresses, selection, false);
    if (actions.includes("delete")) {
      changes.remove += 1;
    } else if (actions.includes("create")) {
      changes.create += 1;
    } else if (actions.includes("update")) {
      changes.modify += 1;
    } else if (!actions.every((action) => ["no-op", "read"].includes(action))) {
      fail(
        "deployment.preview.terraform-unknown",
        "The Terraform plan contained an unsupported change classification.",
      );
    }
  }
  if (changes.remove > 0) {
    fail(
      "deployment.preview.destructive",
      "The exact saved Terraform plan contains destructive changes.",
    );
  }
  return {
    status: "succeeded",
    changes,
    rawOutputDigest: hashBytes(execution.stdout),
    terraformVersion: document.terraform_version,
    terraformPlatform,
    terraformExecutableDigest: null,
    terraformAttestation: {
      configurationDigest: hashCanonical(document.configuration),
      plannedValuesDigest: hashCanonical(document.planned_values),
      providerConfigurationDigest: hashCanonical(
        document.configuration.provider_config,
      ),
      resourceChangesDigest: hashCanonical(document.resource_changes),
      resourceGraphDigest: hashCanonical(
        plannedResources.map((resource) => ({
          address: normalizedTerraformAddress(resource.address),
          type: resource.type,
          provider: resource.provider_name,
          scope:
            resource.values?.scope ??
            resource.values?.subscription_id ??
            resource.values?.target_resource_id ??
            null,
          role: resource.values?.role_definition_name ?? null,
        })),
      ),
      variablesDigest: hashCanonical(document.variables),
      notificationContactsDigest: contactsDigest,
    },
  };
}

function manifestPayload(manifest) {
  const { manifestDigest: omitted, ...payload } = manifest;
  return payload;
}

function manifestDigest(manifest) {
  return hashCanonical(manifestPayload(manifest));
}

function defenderWorkspacePlacementBinding(plan) {
  const workspace = plan.decisionModel.defenderWorkspace;
  if (!workspace) {
    fail(
      "deployment.workspace-binding-missing",
      "The reviewed IaC plan omits the Defender workspace placement decision.",
      "Regenerate and review the IaC plan with current workspace placement evidence.",
    );
  }
  if (
    workspace.required &&
    (workspace.status !== "ready" ||
      !workspace.region ||
      !workspace.scopeDigest ||
      !workspace.policyEvidenceDigest)
  ) {
    fail(
      "deployment.workspace-binding-invalid",
      "The reviewed IaC plan does not contain a complete ready Defender workspace placement binding.",
      "Regenerate the IaC plan after resolving workspace policy, region, scope, and service support checks.",
    );
  }
  return {
    decisionId: workspace.decisionId,
    decisionDigest: workspace.decisionDigest,
    status: workspace.status,
    placementMode: workspace.mode,
    workspaceRegion: workspace.required ? workspace.region : null,
    workspaceScopeDigest: workspace.required ? workspace.scopeDigest : null,
    workspaceReferenceDigest: workspace.required
      ? workspace.workspaceReferenceDigest
      : null,
    policyEvidenceDigest: workspace.required
      ? workspace.policyEvidenceDigest
      : null,
    policyEvidenceFreshness: workspace.required ? "current" : "not-required",
    paidPlanSelectionDigest: workspace.paidPlanSelectionDigest,
  };
}

function buildDeploymentManifest(
  plan,
  {
    provider,
    environment,
    planPath,
    terraformAuthMode = "cli",
    provenancePublicKey = null,
    statePath = ".sslz/deployment-state",
    evaluatedAt = Date.now(),
    runner = defaultRunner,
  },
) {
  validateReviewedPlan(plan, evaluatedAt);
  if (!["cli", "oidc"].includes(terraformAuthMode)) {
    fail(
      "deployment.terraform.auth-mode",
      "Terraform authentication mode must be cli or oidc.",
    );
  }
  const planArtifactPath = assertPlanArtifact(plan, planPath);
  const stateStoreId = requireDurableStateStore(statePath).storeId;
  const selection = selectExecution(plan, provider, environment);
  if (
    provider === "terraform" &&
    (plan.inputContractVersion !== "3.0.0" ||
      !UUID.test(plan.decisionModel.terraformBackend?.subscriptionId ?? ""))
  ) {
    fail(
      "deployment.terraform.backend-subscription-required",
      "Approved Terraform deployment requires a Phase 4 v2 plan with an explicit backend subscription.",
    );
  }
  const parameterPath = generatedFile(
    selection.artifact.path,
    "The selected Phase 4 parameter artifact",
  );
  const source = sourceArtifact(provider);
  const savedPlanPath =
    provider === "terraform"
      ? terraformSavedPlan(selection.preview, environment)
      : null;
  const provenanceArtifact =
    provider === "terraform"
      ? terraformProvenanceArtifact(selection.preview)
      : null;
  const planJsonArtifact =
    provider === "terraform"
      ? terraformPlanJsonArtifact(selection.preview, environment)
      : null;
  const bicepAttestation =
    provider === "bicep"
      ? summarizeBicepBuild(
          runner(
            "bicep",
            bicepBuildParametersArguments(
              parameterPath,
              resolve(root, "infra/bicep/main.bicep"),
            ),
          ),
          plan,
          selection,
          parameterPath,
        ).attestation
      : null;
  const previewExecution =
    provider === "bicep"
      ? runner("az", bicepPreviewArguments(plan, selection))
      : {
          status: 0,
          stdout: JSON.stringify(planJsonArtifact.document),
          stderr: "",
        };
  const regionalAttempt = regionalAttemptBinding(plan, selection);
  const resourcePrefix =
    `${plan.decisionModel.configuration.companyName}-` +
    `${selection.target.name}${regionalAttempt.resourceSuffix}`;
  const freshPreview =
    provider === "bicep"
      ? summarizeBicepPreview(
          previewExecution,
          selection.target.subscriptionId,
          new Set([
            `rg-${resourcePrefix}-monitoring`.toLowerCase(),
            `rg-${resourcePrefix}-networking`.toLowerCase(),
          ]),
        )
      : summarizeTerraformPreview(
          previewExecution,
          plan,
          selection,
          provenanceArtifact.document.terraformPlatform,
        );
  if (freshPreview.terraformVersion) {
    freshPreview.terraformExecutableDigest =
      provenanceArtifact.document.terraformExecutableDigest;
  }
  const parameterDigest = fileDigest(parameterPath);
  const savedPlanDigest = savedPlanPath ? fileDigest(savedPlanPath) : null;
  const planJsonDigest = planJsonArtifact
    ? hashCanonicalProvenance(planJsonArtifact.document)
    : null;
  if (provenanceArtifact) {
    assertTerraformProvenance(
      provenanceArtifact.document,
      provenancePublicKey,
      plan,
      selection,
      source,
      parameterDigest,
      savedPlanDigest,
      planJsonDigest,
      freshPreview,
      terraformAuthMode,
    );
  }
  const terraformAttestation = freshPreview.terraformAttestation
    ? {
        ...freshPreview.terraformAttestation,
        backendDigest: hashCanonical(plan.decisionModel.terraformBackend),
        sourceDigest: source.digest,
        parameterDigest,
        savedPlanDigest,
        planJsonDigest,
        provenanceDigest: provenanceArtifact
          ? hashCanonicalProvenance(provenanceArtifact.document)
          : null,
      }
    : null;
  if (terraformAttestation) {
    terraformAttestation.attestationDigest = hashCanonical(
      terraformAttestation,
    );
  }
  const deploymentArguments =
    provider === "bicep"
      ? bicepDeploymentArguments(plan, selection)
      : terraformDeploymentArguments(savedPlanPath);
  const preparationArguments =
    provider === "terraform"
      ? terraformPreparationArguments(plan, selection, terraformAuthMode)
      : null;
  const defenderWorkspacePlacement = defenderWorkspacePlacementBinding(plan);
  const manifest = {
    schemaVersion: VERSION,
    manifestVersion: VERSION,
    generatedBy: "startup-deployment-integration.mjs",
    manifestDigest:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    plan: {
      version: plan.plannerVersion,
      id: plan.planId,
      digest: plan.planDigest,
      artifactPath: relativePath(planArtifactPath),
      artifactDigest: fileDigest(planArtifactPath),
      approvalExpiresAt: plan.approval.expiresAt,
    },
    readinessEvidence: {
      version: plan.readinessEvidence.schemaVersion,
      id: plan.readinessEvidence.evidenceId,
      digest: plan.readinessEvidence.evidenceDigest,
      expiresAt: plan.readinessEvidence.expiresAt,
      topologyDecisionId:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.decisionId,
      topologyDecisionDigest:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.decisionDigest,
      topologyDecisionExpiresAt:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.expiresAt,
      postgresqlDecisionDigest:
        plan.readinessEvidence.codeEvidence.postgresql?.decisionDigest ?? null,
      postgresqlSelectedEvidenceDigest:
        plan.readinessEvidence.codeEvidence.postgresql
          ?.selectedEvidenceDigest ?? null,
    },
    regionalAttempt: regionalAttemptBinding(plan, selection),
    defenderWorkspacePlacement,
    execution: {
      operation: "platform-baseline.deploy",
      provider,
      environment,
      regionRole: "primary",
      tenantId: plan.decisionModel.target.tenantId,
      subscriptionId: selection.target.subscriptionId,
      scope: `/subscriptions/${selection.target.subscriptionId}`,
      region: selection.artifact.region,
      stateStoreId,
      terraformAuthMode: provider === "terraform" ? terraformAuthMode : null,
    },
    artifacts: {
      parameter: {
        path: relativePath(parameterPath),
        digest: parameterDigest,
      },
      source,
      savedPlan: savedPlanPath
        ? {
            path: relativePath(savedPlanPath),
            digest: savedPlanDigest,
          }
        : null,
      provenance: provenanceArtifact
        ? {
            path: relativePath(provenanceArtifact.path),
            digest: fileDigest(provenanceArtifact.path),
          }
        : null,
      planJson: planJsonArtifact
        ? {
            path: relativePath(planJsonArtifact.path),
            digest: fileDigest(planJsonArtifact.path),
          }
        : null,
    },
    preview: {
      reviewedSummaryDigest: hashCanonical(selection.preview),
      source: "command",
      status: freshPreview.status,
      changes: freshPreview.changes,
      rawOutputDigest: freshPreview.rawOutputDigest,
      terraformVersion: freshPreview.terraformVersion,
      terraformPlatform: freshPreview.terraformPlatform,
      terraformExecutableDigest: freshPreview.terraformExecutableDigest,
      bicepAttestation,
      terraformAttestation,
    },
    commands: {
      preparation: preparationArguments
        ? {
            executable: "terraform",
            arguments: preparationArguments,
          }
        : null,
      deployment: {
        executable: provider === "bicep" ? "az" : "terraform",
        arguments: deploymentArguments,
      },
    },
    validationCheckIds: VALIDATION_CHECK_IDS,
    safety: {
      previewWrites: 0,
      bicepMode: provider === "bicep" ? "Incremental" : null,
      terraformSavedPlanOnly: provider === "terraform",
      secondaryRegionDeployment: false,
      workloadDeployment: false,
      rawOutputRetained: false,
      personalDataRetained: false,
    },
  };
  manifest.manifestDigest = manifestDigest(manifest);
  assertManifestRegionalBindingsFresh(manifest);
  validateDocument(manifestSchema, manifest);
  return manifest;
}

function assertManifestCurrent(
  plan,
  manifest,
  planPath,
  evaluatedAt,
  provenancePublicKey,
) {
  validateReviewedPlan(plan, evaluatedAt);
  validateDocument(manifestSchema, manifest);
  if (manifest.manifestVersion !== VERSION) {
    fail(
      "deployment.manifest.version",
      "The reviewed deployment manifest version is not supported.",
    );
  }
  if (manifestDigest(manifest) !== manifest.manifestDigest) {
    fail(
      "deployment.manifest.digest-mismatch",
      "The deployment manifest digest does not match its canonical content.",
    );
  }
  assertManifestRegionalBindingsFresh(manifest);
  const planArtifactPath = assertPlanArtifact(plan, planPath);
  const selection = selectExecution(
    plan,
    manifest.execution.provider,
    manifest.execution.environment,
  );
  const parameterPath = generatedFile(
    selection.artifact.path,
    "The selected Phase 4 parameter artifact",
  );
  const source = sourceArtifact(manifest.execution.provider);
  if (
    manifest.artifacts.source.path !==
      `infra/${manifest.execution.provider}` ||
    (manifest.execution.provider === "terraform" &&
      (!manifest.artifacts.savedPlan ||
        !manifest.artifacts.provenance ||
        !manifest.artifacts.planJson ||
        !manifest.preview.terraformAttestation ||
        manifest.preview.bicepAttestation)) ||
    (manifest.execution.provider === "bicep" &&
      (manifest.artifacts.savedPlan ||
        manifest.artifacts.provenance ||
        manifest.artifacts.planJson ||
        manifest.preview.terraformAttestation ||
        !manifest.preview.bicepAttestation))
  ) {
    fail(
      "deployment.manifest.binding-mismatch",
      "The reviewed manifest provider and immutable artifact bindings do not match.",
    );
  }
  const savedPlanPath =
    manifest.execution.provider === "terraform"
      ? terraformSavedPlan(selection.preview, selection.target.name)
      : null;
  const provenanceArtifact =
    manifest.execution.provider === "terraform"
      ? terraformProvenanceArtifact(selection.preview)
      : null;
  const planJsonArtifact =
    manifest.execution.provider === "terraform"
      ? terraformPlanJsonArtifact(selection.preview, selection.target.name)
      : null;
  const freshTerraformPreview = planJsonArtifact
    ? summarizeTerraformPreview(
        {
          status: 0,
          stdout: JSON.stringify(planJsonArtifact.document),
          stderr: "",
        },
        plan,
        selection,
        provenanceArtifact.document.terraformPlatform,
      )
    : null;
  if (provenanceArtifact) {
    freshTerraformPreview.terraformExecutableDigest =
      provenanceArtifact.document.terraformExecutableDigest;
    assertTerraformProvenance(
      provenanceArtifact.document,
      provenancePublicKey,
      plan,
      selection,
      source,
      fileDigest(parameterPath),
      fileDigest(savedPlanPath),
      hashCanonicalProvenance(planJsonArtifact.document),
      freshTerraformPreview,
      manifest.execution.terraformAuthMode,
    );
    const semanticFields = [
      "configurationDigest",
      "plannedValuesDigest",
      "providerConfigurationDigest",
      "resourceChangesDigest",
      "resourceGraphDigest",
      "variablesDigest",
      "notificationContactsDigest",
    ];
    if (
      manifest.preview.terraformVersion !==
        freshTerraformPreview.terraformVersion ||
      manifest.preview.terraformPlatform !==
        freshTerraformPreview.terraformPlatform ||
      manifest.preview.terraformExecutableDigest !==
        provenanceArtifact.document.terraformExecutableDigest ||
      semanticFields.some(
        (field) =>
          manifest.preview.terraformAttestation[field] !==
          freshTerraformPreview.terraformAttestation[field],
      )
    ) {
      fail(
        "deployment.manifest.semantic-mismatch",
        "The reviewed manifest does not match the independently revalidated saved Terraform plan semantics.",
      );
    }
  }
  const expected = {
    plan: {
      version: plan.plannerVersion,
      id: plan.planId,
      digest: plan.planDigest,
      artifactPath: relativePath(planArtifactPath),
      artifactDigest: fileDigest(planArtifactPath),
      approvalExpiresAt: plan.approval.expiresAt,
    },
    readinessEvidence: {
      version: plan.readinessEvidence.schemaVersion,
      id: plan.readinessEvidence.evidenceId,
      digest: plan.readinessEvidence.evidenceDigest,
      expiresAt: plan.readinessEvidence.expiresAt,
      topologyDecisionId:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.decisionId,
      topologyDecisionDigest:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.decisionDigest,
      topologyDecisionExpiresAt:
        plan.readinessEvidence.codeEvidence.subscriptionTopology.expiresAt,
      postgresqlDecisionDigest:
        plan.readinessEvidence.codeEvidence.postgresql?.decisionDigest ?? null,
      postgresqlSelectedEvidenceDigest:
        plan.readinessEvidence.codeEvidence.postgresql
          ?.selectedEvidenceDigest ?? null,
    },
    regionalAttempt: regionalAttemptBinding(plan, selection),
    defenderWorkspacePlacement: defenderWorkspacePlacementBinding(plan),
    execution: {
      operation: "platform-baseline.deploy",
      provider: manifest.execution.provider,
      environment: selection.target.name,
      regionRole: "primary",
      tenantId: plan.decisionModel.target.tenantId,
      subscriptionId: selection.target.subscriptionId,
      scope: `/subscriptions/${selection.target.subscriptionId}`,
      region: selection.artifact.region,
      stateStoreId: manifest.execution.stateStoreId,
      terraformAuthMode:
        manifest.execution.provider === "terraform"
          ? manifest.execution.terraformAuthMode
          : null,
    },
    artifacts: {
      parameter: {
        path: relativePath(parameterPath),
        digest: fileDigest(parameterPath),
      },
      source,
      savedPlan: savedPlanPath
        ? {
            path: relativePath(savedPlanPath),
            digest: fileDigest(savedPlanPath),
          }
        : null,
      provenance: provenanceArtifact
        ? {
            path: relativePath(provenanceArtifact.path),
            digest: fileDigest(provenanceArtifact.path),
          }
        : null,
      planJson: planJsonArtifact
        ? {
            path: relativePath(planJsonArtifact.path),
            digest: fileDigest(planJsonArtifact.path),
          }
        : null,
    },
    reviewedSummaryDigest: hashCanonical(selection.preview),
    commands: {
      preparation:
        manifest.execution.provider === "terraform"
          ? {
              executable: "terraform",
              arguments: terraformPreparationArguments(
                plan,
                selection,
                manifest.execution.terraformAuthMode,
              ),
            }
          : null,
      deployment: {
        executable:
          manifest.execution.provider === "bicep" ? "az" : "terraform",
        arguments:
          manifest.execution.provider === "bicep"
            ? bicepDeploymentArguments(plan, selection)
            : terraformDeploymentArguments(savedPlanPath),
      },
    },
  };
  if (
    canonicalJson(manifest.plan) !== canonicalJson(expected.plan) ||
    canonicalJson(manifest.readinessEvidence) !==
      canonicalJson(expected.readinessEvidence) ||
    canonicalJson(manifest.regionalAttempt) !==
      canonicalJson(expected.regionalAttempt) ||
    canonicalJson(manifest.defenderWorkspacePlacement) !==
      canonicalJson(expected.defenderWorkspacePlacement) ||
    canonicalJson(manifest.execution) !== canonicalJson(expected.execution) ||
    canonicalJson(manifest.artifacts) !== canonicalJson(expected.artifacts) ||
    manifest.preview.reviewedSummaryDigest !== expected.reviewedSummaryDigest ||
    canonicalJson(manifest.commands) !== canonicalJson(expected.commands) ||
    canonicalJson(manifest.validationCheckIds) !==
      canonicalJson(VALIDATION_CHECK_IDS)
  ) {
    fail(
      "deployment.manifest.binding-mismatch",
      "The reviewed manifest does not match every current plan, target, artifact, and command binding.",
    );
  }
  return { selection, savedPlanPath };
}

function approvalPayload(approval) {
  const { signature: omitted, ...payload } = approval;
  return payload;
}

function approvalSigningMessage(approval) {
  return Buffer.from(
    `${SIGNING_DOMAIN}\0${canonicalJson(approvalPayload(approval))}`,
    "utf8",
  );
}

function keyFingerprint(publicKey) {
  const key =
    publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") {
    fail(
      "deployment.approval.key-type",
      "The trusted deployment approval key must be Ed25519.",
    );
  }
  return hashBytes(key.export({ type: "spki", format: "der" }));
}

function approvalArtifactDigest(approval) {
  return hashCanonical(approval);
}

function approvalReplayKey(approval) {
  return hashCanonical({
    domain: SIGNING_DOMAIN,
    keyId: approval.keyId,
    nonce: approval.nonce,
    stateStoreId: approval.stateStoreId,
  });
}

function validateApproval(approval, manifest, publicKey, evaluatedAt) {
  validateDocument(approvalSchema, approval);
  if (approval.status !== "approved") {
    fail(
      `deployment.approval.${approval.status}`,
      `The deployment approval is ${approval.status} and cannot authorize apply.`,
    );
  }
  approvalWindow(approval, evaluatedAt, "deployment.approval");
  if (
    Date.parse(approval.expiresAt) >
    Date.parse(manifest.readinessEvidence.expiresAt)
  ) {
    fail(
      "deployment.approval.readiness-window",
      "The deployment approval cannot outlive its bound readiness evidence.",
    );
  }
  const expectedKeyId = keyFingerprint(publicKey);
  if (approval.keyId !== expectedKeyId) {
    fail(
      "deployment.approval.key-mismatch",
      "The approval was not issued by the provisioned trusted deployment key.",
    );
  }
  let verified = false;
  let signature;
  try {
    signature = Buffer.from(approval.signature, "base64");
    if (
      signature.length !== 64 ||
      signature.toString("base64") !== approval.signature
    ) {
      fail(
        "deployment.approval.signature-encoding",
        "The deployment approval signature encoding is not canonical Ed25519 Base64.",
      );
    }
    verified = verifySignature(
      null,
      approvalSigningMessage(approval),
      createPublicKey(publicKey),
      signature,
    );
  } catch (error) {
    if (error instanceof DeploymentError) {
      throw error;
    }
    verified = false;
  }
  if (!verified) {
    fail(
      "deployment.approval.signature-invalid",
      "The deployment approval signature is invalid.",
    );
  }
  const binding = {
    manifestVersion: manifest.manifestVersion,
    manifestDigest: manifest.manifestDigest,
    planVersion: manifest.plan.version,
    planId: manifest.plan.id,
    planDigest: manifest.plan.digest,
    regionalAttemptId: manifest.regionalAttempt.attemptId,
    regionalAttemptDigest: hashCanonical(manifest.regionalAttempt),
    regionalAttemptNumber: manifest.regionalAttempt.attemptNumber,
    originalRegion: manifest.regionalAttempt.originalRegion,
    targetRegion: manifest.regionalAttempt.targetRegion,
    regionalStateKey: manifest.regionalAttempt.stateKey,
    readinessEvidenceVersion: manifest.readinessEvidence.version,
    readinessEvidenceId: manifest.readinessEvidence.id,
    readinessEvidenceDigest: manifest.readinessEvidence.digest,
    readinessEvidenceExpiresAt: manifest.readinessEvidence.expiresAt,
    topologyDecisionId: manifest.readinessEvidence.topologyDecisionId,
    topologyDecisionDigest: manifest.readinessEvidence.topologyDecisionDigest,
    topologyDecisionExpiresAt:
      manifest.readinessEvidence.topologyDecisionExpiresAt,
    postgresqlDecisionDigest:
      manifest.readinessEvidence.postgresqlDecisionDigest,
    postgresqlSelectedEvidenceDigest:
      manifest.readinessEvidence.postgresqlSelectedEvidenceDigest,
    defenderWorkspacePlacementDecisionId:
      manifest.defenderWorkspacePlacement.decisionId,
    defenderWorkspacePlacementDecisionDigest:
      manifest.defenderWorkspacePlacement.decisionDigest,
    defenderWorkspaceRegion:
      manifest.defenderWorkspacePlacement.workspaceRegion,
    defenderWorkspaceScopeDigest:
      manifest.defenderWorkspacePlacement.workspaceScopeDigest,
    defenderWorkspaceReferenceDigest:
      manifest.defenderWorkspacePlacement.workspaceReferenceDigest,
    defenderWorkspacePolicyEvidenceDigest:
      manifest.defenderWorkspacePlacement.policyEvidenceDigest,
    defenderWorkspacePolicyEvidenceFreshness:
      manifest.defenderWorkspacePlacement.policyEvidenceFreshness,
    defenderPaidPlanSelectionDigest:
      manifest.defenderWorkspacePlacement.paidPlanSelectionDigest,
    operation: manifest.execution.operation,
    provider: manifest.execution.provider,
    environment: manifest.execution.environment,
    regionRole: manifest.execution.regionRole,
    tenantId: manifest.execution.tenantId,
    subscriptionId: manifest.execution.subscriptionId,
    scope: manifest.execution.scope,
    region: manifest.execution.region,
    stateStoreId: manifest.execution.stateStoreId,
    parameterDigest: manifest.artifacts.parameter.digest,
    sourceDigest: manifest.artifacts.source.digest,
    savedPlanDigest: manifest.artifacts.savedPlan?.digest ?? null,
    planJsonDigest: manifest.artifacts.planJson?.digest ?? null,
    notificationContactsDigest:
      manifest.preview.bicepAttestation?.notificationContactsDigest ??
      manifest.preview.terraformAttestation?.notificationContactsDigest,
    terraformAuthMode: manifest.execution.terraformAuthMode,
  };
  for (const [field, expected] of Object.entries(binding)) {
    if (approval[field] !== expected) {
      fail(
        "deployment.approval.binding-mismatch",
        "The signed approval does not match every immutable manifest and execution field.",
      );
    }
  }
}

function requireDurableStateStore(requestedPath) {
  if (requestedPath !== ".sslz/deployment-state") {
    fail(
      "deployment.state.path",
      "The deployment state directory must be the fixed .sslz/deployment-state path.",
    );
  }
  const path = resolve(root, requestedPath);
  if (path !== STATE_ROOT) {
    fail(
      "deployment.state.durable-required",
      "Apply requires the canonical pre-provisioned durable state store.",
    );
  }
  const markerPath = resolve(path, ".durable-store.json");
  assertNoLinkedComponents(markerPath, "deployment.state.symlink");
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    fail(
      "deployment.state.durable-required",
      "Apply requires a valid durable state store marker.",
    );
  }
  if (
    canonicalJson(Object.keys(marker).sort()) !==
      canonicalJson(["durable", "schemaVersion", "storeId"]) ||
    marker.schemaVersion !== VERSION ||
    marker.durable !== true ||
    !UUID.test(marker.storeId)
  ) {
    fail(
      "deployment.state.durable-required",
      "The deployment state store marker is invalid.",
    );
  }
  if (process.platform === "win32") {
    const systemRoot = process.env.SYSTEMROOT ?? String.raw`C:\Windows`;
    const whoami = spawnSync(
      resolve(systemRoot, "System32/whoami.exe"),
      ["/user", "/fo", "csv", "/nh"],
      {
        encoding: "utf8",
        env: { SYSTEMROOT: systemRoot },
        shell: false,
        windowsHide: true,
      },
    );
    const username = /^"([^"]+)"/.exec(whoami.stdout ?? "")?.[1]?.toLowerCase();
    if (!username) {
      fail(
        "deployment.state.permissions",
        "The deployment state owner could not be verified.",
      );
    }
    for (const protectedPath of [path, markerPath]) {
      const acl = spawnSync(
        resolve(systemRoot, "System32/icacls.exe"),
        [protectedPath],
        {
          encoding: "utf8",
          env: { SYSTEMROOT: systemRoot },
          shell: false,
          windowsHide: true,
        },
      );
      const allowed = [
        username,
        String.raw`nt authority\system`,
        String.raw`builtin\administrators`,
      ];
      if (
        acl.status !== 0 ||
        String(acl.stdout)
          .split(/\r?\n/)
          .filter((line) => /\((?:F|M|W)\)/i.test(line))
          .some(
            (line) =>
              !allowed.some((principal) =>
                line.toLowerCase().includes(principal),
              ),
          )
      ) {
        fail(
          "deployment.state.permissions",
          "The deployment state directory and marker must be writable only by the executor, SYSTEM, and administrators.",
        );
      }
    }
  } else {
    const currentUser = process.getuid?.();
    const directoryMetadata = statSync(path);
    const markerMetadata = statSync(markerPath);
    if (
      currentUser === undefined ||
      directoryMetadata.uid !== currentUser ||
      markerMetadata.uid !== currentUser ||
      (directoryMetadata.mode & 0o077) !== 0 ||
      (directoryMetadata.mode & 0o700) !== 0o700 ||
      (markerMetadata.mode & 0o077) !== 0 ||
      (markerMetadata.mode & 0o400) !== 0o400
    ) {
      fail(
        "deployment.state.permissions",
        "The deployment state directory and marker must be owned by and accessible only to the executor.",
      );
    }
  }
  const directoryIdentity = statSync(path, { bigint: true });
  const markerIdentity = statSync(markerPath, { bigint: true });
  if (directoryIdentity.ino === 0n || markerIdentity.ino === 0n) {
    fail(
      "deployment.state.identity-unavailable",
      "The deployment state store does not expose a stable filesystem identity.",
    );
  }
  const identity = createHash("sha256")
    .update(
      canonicalJson({
        markerStoreId: marker.storeId,
        directoryDevice: directoryIdentity.dev.toString(),
        directoryInode: directoryIdentity.ino.toString(),
        markerDevice: markerIdentity.dev.toString(),
        markerInode: markerIdentity.ino.toString(),
      }),
    )
    .digest();
  identity[6] = (identity[6] & 0x0f) | 0x50;
  identity[8] = (identity[8] & 0x3f) | 0x80;
  const hex = identity.subarray(0, 16).toString("hex");
  const storeId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
  return { storeId, directory: path };
}

function writeState(path, state) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, path);
}

function writeSnapshotFile(snapshotRoot, sourcePath) {
  assertNoLinkedComponents(sourcePath, "deployment.snapshot.source");
  let sourceDescriptor;
  let content;
  try {
    sourceDescriptor = openSync(
      sourcePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    if (!fstatSync(sourceDescriptor).isFile()) {
      fail(
        "deployment.snapshot.source",
        "A protected execution snapshot input is not a regular file.",
      );
    }
    content = readFileSync(sourceDescriptor);
  } catch (error) {
    if (error instanceof DeploymentError) {
      throw error;
    }
    fail(
      "deployment.snapshot.source",
      "A protected execution snapshot input could not be opened safely.",
    );
  } finally {
    if (sourceDescriptor !== undefined) {
      closeSync(sourceDescriptor);
    }
  }
  const logicalPath = relativePath(sourcePath);
  const destination = resolve(snapshotRoot, logicalPath);
  const relation = relative(snapshotRoot, destination);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail(
      "deployment.snapshot.path",
      "A verified artifact could not be placed in the protected execution snapshot.",
    );
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const descriptor = openSync(destination, "wx", 0o400);
  try {
    writeFileSync(descriptor, content);
  } finally {
    closeSync(descriptor);
  }
  return {
    path: destination,
    logicalPath,
    digest: hashBytes(content),
  };
}

function setSnapshotMode(path, directoryMode, fileMode) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) {
      fail(
        "deployment.snapshot.symlink",
        "The protected execution snapshot cannot contain symbolic links.",
      );
    }
    if (entry.isDirectory()) {
      setSnapshotMode(child, directoryMode, fileMode);
    } else if (entry.isFile()) {
      chmodSync(child, fileMode);
    }
  }
  chmodSync(path, directoryMode);
}

function createExecutionSnapshot(manifest) {
  const snapshotRoot = mkdtempSync(
    resolve(tmpdir(), "sslz-deployment-snapshot-"),
  );
  chmodSync(snapshotRoot, 0o700);
  try {
    const sourceEntries = sourceFiles(manifest.execution.provider).map((path) =>
      writeSnapshotFile(snapshotRoot, path),
    );
    const sourceDigest = hashCanonical(
      sourceEntries.map(({ logicalPath: path, digest }) => ({ path, digest })),
    );
    if (
      sourceEntries.length !== manifest.artifacts.source.fileCount ||
      sourceDigest !== manifest.artifacts.source.digest
    ) {
      fail(
        "deployment.snapshot.source-mismatch",
        "The protected source snapshot does not match the approved source digest.",
      );
    }
    const parameter = writeSnapshotFile(
      snapshotRoot,
      resolve(root, manifest.artifacts.parameter.path),
    );
    if (parameter.digest !== manifest.artifacts.parameter.digest) {
      fail(
        "deployment.snapshot.parameter-mismatch",
        "The protected parameter snapshot does not match the approved artifact.",
      );
    }
    const savedPlan = manifest.artifacts.savedPlan
      ? writeSnapshotFile(
          snapshotRoot,
          resolve(root, manifest.artifacts.savedPlan.path),
        )
      : null;
    if (
      savedPlan &&
      savedPlan.digest !== manifest.artifacts.savedPlan.digest
    ) {
      fail(
        "deployment.snapshot.saved-plan-mismatch",
        "The protected Terraform plan snapshot does not match the approved artifact.",
      );
    }
    const planJson = manifest.artifacts.planJson
      ? writeSnapshotFile(
          snapshotRoot,
          resolve(root, manifest.artifacts.planJson.path),
        )
      : null;
    if (
      planJson &&
      planJson.digest !== manifest.artifacts.planJson.digest
    ) {
      fail(
        "deployment.snapshot.plan-json-mismatch",
        "The protected Terraform JSON plan snapshot does not match the approved artifact.",
      );
    }
    let terraformExecutablePath = null;
    if (manifest.execution.provider === "terraform") {
      const trustedTerraform = terraformExecutable();
      const executableBytes = readFileSync(trustedTerraform.path);
      if (
        hashBytes(executableBytes) !== trustedTerraform.digest ||
        trustedTerraform.digest !==
          manifest.preview.terraformExecutableDigest
      ) {
        fail(
          "deployment.terraform.executable-mismatch",
          "The trusted Terraform executable does not match the approved builder executable.",
        );
      }
      terraformExecutablePath = resolve(
        snapshotRoot,
        process.platform === "win32" ? "terraform.exe" : "terraform",
      );
      const descriptor = openSync(terraformExecutablePath, "wx", 0o500);
      try {
        writeFileSync(descriptor, executableBytes);
      } finally {
        closeSync(descriptor);
      }
    }
    setSnapshotMode(snapshotRoot, 0o500, 0o400);
    if (terraformExecutablePath) {
      chmodSync(terraformExecutablePath, 0o500);
    }
    return {
      root: snapshotRoot,
      sourceEntries,
      sourceDirectory: resolve(
        snapshotRoot,
        manifest.artifacts.source.path,
      ),
      parameter,
      savedPlan,
      planJson,
      terraformExecutablePath,
      terraformCliConfigPath:
        manifest.execution.provider === "terraform"
          ? resolve(snapshotRoot, "infra/terraform/sslz.deployment.tfrc")
          : null,
    };
  } catch (error) {
    setSnapshotMode(snapshotRoot, 0o700, 0o600);
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

function verifyExecutionSnapshot(snapshot, manifest) {
  const sourceDigest = hashCanonical(
    snapshot.sourceEntries.map(({ logicalPath: path }) => ({
      path,
      digest: fileDigest(resolve(snapshot.root, path)),
    })),
  );
  if (
    sourceDigest !== manifest.artifacts.source.digest ||
    fileDigest(snapshot.parameter.path) !== manifest.artifacts.parameter.digest ||
    (snapshot.savedPlan &&
      fileDigest(snapshot.savedPlan.path) !==
        manifest.artifacts.savedPlan.digest) ||
    (snapshot.planJson &&
      fileDigest(snapshot.planJson.path) !==
        manifest.artifacts.planJson.digest)
  ) {
    fail(
      "deployment.snapshot.changed",
      "The protected execution snapshot changed after approval.",
    );
  }
}

function verifyBicepSnapshot(snapshot, manifest, plan, selection, runner) {
  if (manifest.execution.provider !== "bicep") {
    return;
  }
  const build = summarizeBicepBuild(
    runner(
      "bicep",
      bicepBuildParametersArguments(
        snapshot.parameter.path,
        resolve(snapshot.sourceDirectory, "main.bicep"),
      ),
    ),
    plan,
    selection,
    snapshot.parameter.path,
    resolve(snapshot.sourceDirectory, "main.bicep"),
  );
  if (
    canonicalJson(build.attestation) !==
    canonicalJson(manifest.preview.bicepAttestation)
  ) {
    fail(
      "deployment.bicep.attestation-mismatch",
      "The protected Bicep snapshot no longer compiles to the approved template and resource graph.",
    );
  }
  chmodSync(snapshot.root, 0o700);
  const compiledDirectory = resolve(snapshot.root, "compiled-bicep");
  mkdirSync(compiledDirectory, { mode: 0o700 });
  snapshot.compiledTemplatePath = resolve(compiledDirectory, "main.json");
  snapshot.compiledParametersPath = resolve(
    compiledDirectory,
    "parameters.json",
  );
  writeFileSync(
    snapshot.compiledTemplatePath,
    `${JSON.stringify(build.template)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  writeFileSync(
    snapshot.compiledParametersPath,
    `${JSON.stringify(build.parameters)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  setSnapshotMode(snapshot.root, 0o500, 0o400);
}

function snapshotCommands(manifest, snapshot) {
  if (manifest.execution.provider === "bicep") {
    const deployment = [...manifest.commands.deployment.arguments];
    deployment[deployment.indexOf("--template-file") + 1] =
      snapshot.compiledTemplatePath;
    deployment[deployment.indexOf("--parameters") + 1] =
      snapshot.compiledParametersPath;
    return { preparation: null, deployment };
  }
  const preparation = [...manifest.commands.preparation.arguments];
  preparation[0] = `-chdir=${snapshot.sourceDirectory}`;
  const deployment = [...manifest.commands.deployment.arguments];
  deployment[0] = `-chdir=${snapshot.sourceDirectory}`;
  deployment[deployment.length - 1] = snapshot.savedPlan.path;
  return { preparation, deployment };
}

function reserveApproval(approval, manifest, evaluatedAt, directory) {
  const artifactDigest = approvalArtifactDigest(approval);
  const key = approvalReplayKey(approval).slice("sha256:".length);
  const statePath = resolve(directory, `${key}.json`);
  const lockPath = resolve(directory, `${key}.lock`);
  if (existsSync(statePath)) {
    return { status: "consumed" };
  }
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      return { status: "race" };
    }
    throw error;
  }
  if (existsSync(statePath)) {
    closeSync(descriptor);
    unlinkSync(lockPath);
    return { status: "consumed" };
  }
  const state = {
    schemaVersion: VERSION,
    status: "running",
    phase: "reserved",
    artifactDigest,
    manifestDigest: manifest.manifestDigest,
    planDigest: manifest.plan.digest,
    regionalAttemptId: manifest.regionalAttempt.attemptId,
    regionalAttemptNumber: manifest.regionalAttempt.attemptNumber,
    originalRegion: manifest.regionalAttempt.originalRegion,
    targetRegion: manifest.regionalAttempt.targetRegion,
    regionalStateKey: manifest.regionalAttempt.stateKey,
    operation: manifest.execution.operation,
    provider: manifest.execution.provider,
    environment: manifest.execution.environment,
    subscriptionId: manifest.execution.subscriptionId,
    scope: manifest.execution.scope,
    stateStoreId: manifest.execution.stateStoreId,
    startedAt: new Date(evaluatedAt).toISOString(),
    completedAt: null,
    code: "deployment.running",
    workloadDeploymentAllowed: false,
  };
  writeState(statePath, state);
  return { status: "reserved", descriptor, lockPath, statePath, state };
}

function updateReservation(reservation, changes) {
  reservation.state = { ...reservation.state, ...changes };
  writeState(reservation.statePath, reservation.state);
}

function completeReservation(
  reservation,
  status,
  phase,
  code,
  workloadDeploymentAllowed,
  evaluatedAt,
) {
  updateReservation(reservation, {
    status,
    phase,
    completedAt: new Date(evaluatedAt).toISOString(),
    code,
    workloadDeploymentAllowed,
  });
}

function releaseReservation(reservation) {
  closeSync(reservation.descriptor);
  unlinkSync(reservation.lockPath);
}

function approvalAudit(approval) {
  const statuses = new Set(["pending", "approved", "declined", "consumed"]);
  return {
    provided: Boolean(approval),
    status: statuses.has(approval?.status) ? approval.status : "invalid",
    consumed: approval?.status === "consumed",
    expiresAt:
      typeof approval?.expiresAt === "string" &&
      Number.isFinite(Date.parse(approval.expiresAt))
        ? approval.expiresAt
        : null,
    artifactDigest: approval ? approvalArtifactDigest(approval) : null,
    keyId: typeof approval?.keyId === "string" && DIGEST.test(approval.keyId)
      ? approval.keyId
      : null,
  };
}

function baseResult(mode, evaluatedAt) {
  return {
    schemaVersion: VERSION,
    executorVersion: VERSION,
    generatedBy: "startup-deployment-integration.mjs",
    generatedAt: new Date(evaluatedAt).toISOString(),
    mode,
    status: "error",
    code: "deployment.error",
    message: "The deployment integration could not complete safely.",
    manifest: null,
    approval: {
      provided: false,
      status: "notProvided",
      consumed: false,
      expiresAt: null,
      artifactDigest: null,
      keyId: null,
    },
    commands: {
      preparation: null,
      deployment: {
        executable: null,
        arguments: [],
        preview: null,
        executed: false,
      },
    },
    verification: {
      performed: false,
      healthy: false,
      attempts: 0,
      checks: VALIDATION_CHECK_IDS.map((id) => ({
        id,
        status: "not-run",
      })),
      workloadDeploymentAllowed: false,
    },
    rollback: {
      required: false,
      guidanceCode: "deployment.rollback.not-required",
    },
    safety: {
      deploymentWrites: 0,
      localState: "none",
      rawOutputRetained: false,
      personalDataRetained: false,
      secondaryRegionDeployment: false,
      workloadDeployment: false,
    },
  };
}

function validatedResult(result) {
  validateDocument(resultSchema, result);
  return result;
}

function rejectedResult(
  result,
  code,
  message,
  { approvalStatus = "invalid", consumed = false } = {},
) {
  result.status = "rejected";
  result.code = code;
  result.message = message;
  if (result.approval.provided) {
    result.approval.status = approvalStatus;
    result.approval.consumed = consumed;
  }
  return validatedResult(result);
}

function readResult(runner, args) {
  return safeJson(runner("az", args));
}

function check(id, passed) {
  return { id, status: passed ? "pass" : "fail" };
}

function normalizedSecurityRule(rule) {
  const destinationPortRanges = Array.isArray(rule?.destinationPortRanges)
    ? [...rule.destinationPortRanges]
    : rule?.destinationPortRange
      ? [rule.destinationPortRange]
      : [];
  return {
    name: rule?.name ?? null,
    priority: rule?.priority ?? null,
    direction: rule?.direction ?? null,
    access: rule?.access ?? null,
    protocol: rule?.protocol ?? null,
    sourceAddressPrefix: rule?.sourceAddressPrefix ?? null,
    sourcePortRange: rule?.sourcePortRange ?? null,
    destinationAddressPrefix: rule?.destinationAddressPrefix ?? null,
    destinationPortRanges: destinationPortRanges.sort(),
  };
}

function expectedNetworkTopology(decision, subscriptionId, resourceGroupName) {
  const match = /^([0-9]{1,3})\.([0-9]{1,3})\.0\.0\/16$/.exec(
    decision.vnetAddressPrefix,
  );
  if (!match) {
    return null;
  }
  const base = `${match[1]}.${match[2]}`;
  const prefixes = {
    "snet-aks": `${base}.0.0/20`,
    "snet-app": `${base}.16.0/22`,
    "snet-data": `${base}.20.0/22`,
    "snet-shared": `${base}.24.0/24`,
  };
  const denyAll = {
    name: "DenyAllInbound",
    priority: 4096,
    direction: "Inbound",
    access: "Deny",
    protocol: "*",
    sourceAddressPrefix: "*",
    sourcePortRange: "*",
    destinationAddressPrefix: "*",
    destinationPortRanges: ["*"],
  };
  const rules = {
    "nsg-snet-aks": [
      {
        name: "AllowAzureLoadBalancerInbound",
        priority: 110,
        direction: "Inbound",
        access: "Allow",
        protocol: "*",
        sourceAddressPrefix: "AzureLoadBalancer",
        sourcePortRange: "*",
        destinationAddressPrefix: "*",
        destinationPortRanges: ["*"],
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
        destinationPortRanges: ["*"],
      },
      denyAll,
    ],
    "nsg-snet-app": [denyAll],
    "nsg-snet-data": [
      {
        name: "AllowFromAksSubnet",
        priority: 110,
        direction: "Inbound",
        access: "Allow",
        protocol: "Tcp",
        sourceAddressPrefix: prefixes["snet-aks"],
        sourcePortRange: "*",
        destinationAddressPrefix: "*",
        destinationPortRanges: ["1433", "5432", "6380", "443"].sort(),
      },
      {
        name: "AllowFromAppSubnet",
        priority: 120,
        direction: "Inbound",
        access: "Allow",
        protocol: "Tcp",
        sourceAddressPrefix: prefixes["snet-app"],
        sourcePortRange: "*",
        destinationAddressPrefix: "*",
        destinationPortRanges: ["1433", "5432", "6380", "443"].sort(),
      },
      denyAll,
    ],
    "nsg-snet-shared": [denyAll],
  };
  return {
    prefixes,
    subnets: Object.keys(prefixes)
      .sort()
      .map((name) => ({
        name,
        addressPrefix: prefixes[name],
        networkSecurityGroupId:
          (
            `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}` +
            `/providers/Microsoft.Network/networkSecurityGroups/nsg-${name}`
          ).toLowerCase(),
        delegations:
          name === "snet-app" ? [decision.appSubnetDelegation] : [],
        provisioningState: "Succeeded",
      })),
    networkSecurityGroups: Object.keys(rules)
      .sort()
      .map((name) => ({
        name,
        location: decision.region,
        provisioningState: "Succeeded",
        securityRules: rules[name]
          .map(normalizedSecurityRule)
          .sort((left, right) => left.name.localeCompare(right.name)),
      })),
  };
}

function postDeploymentChecks(manifest, runner) {
  const subscriptionId = manifest.execution.subscriptionId;
  const decision = manifest.planDecision;
  const prefix =
    `${decision.companyName}-${manifest.execution.environment}` +
    manifest.regionalAttempt.resourceSuffix;
  const monitoringRg = `rg-${prefix}-monitoring`;
  const networkingRg = `rg-${prefix}-networking`;
  const workspacePlacement = decision.defenderWorkspace;
  const existingWorkspace =
    workspacePlacement.mode === "existing"
      ? workspacePlacement.workspaceReference.match(LOG_ANALYTICS_WORKSPACE_ID)
      : null;
  const workspaceSubscriptionId = existingWorkspace?.[1] ?? subscriptionId;
  const workspaceResourceGroup = existingWorkspace?.[2] ?? monitoringRg;
  const workspaceName = existingWorkspace?.[3] ?? `law-${prefix}`;
  const expectedWorkspaceId = existingWorkspace
    ? workspacePlacement.workspaceReference
    : `/subscriptions/${subscriptionId}/resourceGroups/${monitoringRg}/providers/Microsoft.OperationalInsights/workspaces/${workspaceName}`;
  const workspace = readResult(runner, [
    "monitor",
    "log-analytics",
    "workspace",
    "show",
    "--subscription",
    workspaceSubscriptionId,
    "--resource-group",
    workspaceResourceGroup,
    "--workspace-name",
    workspaceName,
    "--query",
    "{id:id,name:name,location:location,retentionInDays:retentionInDays,dailyQuotaGb:workspaceCapping.dailyQuotaGb,provisioningState:provisioningState}",
    "--output",
    "json",
  ]);
  const monitoringGroup = existingWorkspace
    ? null
    : readResult(runner, [
        "group",
        "show",
        "--subscription",
        subscriptionId,
        "--name",
        monitoringRg,
        "--query",
        "{name:name,location:location,provisioningState:properties.provisioningState}",
        "--output",
        "json",
      ]);
  const networkingGroup = decision.deployNetworking
    ? readResult(runner, [
        "group",
        "show",
        "--subscription",
        subscriptionId,
        "--name",
        networkingRg,
        "--query",
        "{name:name,location:location,provisioningState:properties.provisioningState}",
        "--output",
        "json",
      ])
    : null;
  const expectedResources =
    (existingWorkspace ||
      (monitoringGroup?.name === monitoringRg &&
        monitoringGroup?.location === manifest.execution.region &&
        monitoringGroup?.provisioningState === "Succeeded")) &&
    (!decision.deployNetworking ||
      (networkingGroup?.name === networkingRg &&
        networkingGroup?.location === manifest.execution.region &&
        networkingGroup?.provisioningState === "Succeeded"));
  const monitoring =
    workspace?.name === workspaceName &&
    workspace?.location === workspacePlacement.region &&
    workspace?.provisioningState === "Succeeded" &&
    (existingWorkspace ||
      (workspace?.retentionInDays === decision.logRetentionInDays &&
        workspace?.dailyQuotaGb === decision.logDailyQuotaGb)) &&
    typeof workspace?.id === "string" &&
    workspace.id.toLowerCase() === expectedWorkspaceId.toLowerCase();
  const diagnostics = readResult(runner, [
    "monitor",
    "diagnostic-settings",
    "subscription",
    "list",
    "--subscription",
    subscriptionId,
    "--query",
    "[].{name:name,workspaceId:workspaceId,logs:logs}",
    "--output",
    "json",
  ]);
  const diagnostic = Array.isArray(diagnostics)
    ? diagnostics.find((item) => item.name === "diag-activity-log-to-law")
    : null;
  const enabledCategories = Array.isArray(diagnostic?.logs)
    ? diagnostic.logs
        .filter((item) => item.enabled === true)
        .map((item) => item.category)
        .sort()
    : [];
  const activityLog =
    monitoring &&
    diagnostic?.workspaceId?.toLowerCase() === workspace.id.toLowerCase() &&
    canonicalJson(enabledCategories) === canonicalJson(ACTIVITY_LOG_CATEGORIES);
  const policies = readResult(runner, [
    "policy",
    "assignment",
    "list",
    "--subscription",
    subscriptionId,
    "--scope",
    `/subscriptions/${subscriptionId}`,
    "--query",
    "[].{name:name,scope:scope,enforcementMode:enforcementMode,policyDefinitionId:policyDefinitionId,location:location,parameters:parameters,principalId:identity.principalId}",
    "--output",
    "json",
  ]);
  const policyMap = new Map(
    Array.isArray(policies) ? policies.map((item) => [item.name, item]) : [],
  );
  const policyPrefix =
    manifest.regionalAttempt.attemptNumber === 1
      ? ""
      : `${manifest.regionalAttempt.attemptKey}-`;
  const expectedPolicyNames = POLICY_NAMES.map((name) => `${policyPrefix}${name}`);
  const expectedPolicyParameters = new Map([
    [`${policyPrefix}mcsb-audit`, {}],
    [
      `${policyPrefix}allowed-locations`,
      {
        listOfAllowedLocations: {
          value: [
            ...new Set([
              manifest.execution.region,
              ...(workspacePlacement.required
                ? [workspacePlacement.region]
                : []),
            ]),
          ].sort(),
        },
      },
    ],
    [
      `${policyPrefix}allowed-locations-rg`,
      {
        listOfAllowedLocations: {
          value: [
            ...new Set([
              manifest.execution.region,
              ...(workspacePlacement.required
                ? [workspacePlacement.region]
                : []),
            ]),
          ].sort(),
        },
      },
    ],
    [`${policyPrefix}require-env-tag-rg`, { tagName: { value: "environment" } }],
    [`${policyPrefix}require-team-tag-rg`, { tagName: { value: "team" } }],
    [`${policyPrefix}inherit-env-tag`, { tagName: { value: "environment" } }],
    [`${policyPrefix}inherit-team-tag`, { tagName: { value: "team" } }],
    [
      `${policyPrefix}activity-log-diag`,
      { logAnalytics: { value: workspace?.id } },
    ],
  ]);
  const expectedRoleAssignments = [
    {
      assignment: `${policyPrefix}inherit-env-tag`,
      role: EXPECTED_BICEP_ROLE_DEFINITIONS.get("tagContributor"),
    },
    {
      assignment: `${policyPrefix}inherit-team-tag`,
      role: EXPECTED_BICEP_ROLE_DEFINITIONS.get("tagContributor"),
    },
    {
      assignment: `${policyPrefix}activity-log-diag`,
      role: EXPECTED_BICEP_ROLE_DEFINITIONS.get("logAnalyticsContributor"),
    },
    {
      assignment: `${policyPrefix}activity-log-diag`,
      role: EXPECTED_BICEP_ROLE_DEFINITIONS.get("monitoringContributor"),
    },
  ];
  const expectedPrincipalIds = new Set(
    expectedRoleAssignments.map(
      ({ assignment }) => policyMap.get(assignment)?.principalId,
    ),
  );
  const liveRoleAssignments = readResult(runner, [
    "role",
    "assignment",
    "list",
    "--subscription",
    subscriptionId,
    "--scope",
    `/subscriptions/${subscriptionId}`,
    "--all",
    "--include-inherited",
    "--query",
    "[].{scope:scope,principalId:principalId,roleDefinitionId:roleDefinitionId}",
    "--output",
    "json",
  ]);
  const expectedRoleTuples = expectedRoleAssignments
    .map(({ assignment, role }) => {
      const principalId = policyMap.get(assignment)?.principalId;
      return `${principalId}|${role}|/subscriptions/${subscriptionId}`;
    })
    .sort();
  const actualRoleTuples = Array.isArray(liveRoleAssignments)
    ? liveRoleAssignments
        .filter((item) => expectedPrincipalIds.has(item?.principalId))
        .map((item) => {
          const role = String(item?.roleDefinitionId ?? "")
            .split("/")
            .filter(Boolean)
            .at(-1)
            ?.toLowerCase();
          return `${item?.principalId}|${role}|${String(item?.scope).toLowerCase()}`;
        })
        .sort()
    : [];
  const rolesHealthy =
    !expectedPrincipalIds.has(undefined) &&
    canonicalJson(actualRoleTuples) === canonicalJson(expectedRoleTuples);
  const policyHealthy =
    manifest.regionalAttempt.retiredPolicyAssignmentNames.every(
      (name) => !policyMap.has(name),
    ) &&
    canonicalJson(
      [...policyMap.keys()]
        .filter((name) => expectedPolicyNames.includes(name))
        .sort(),
    ) === canonicalJson(expectedPolicyNames) &&
    expectedPolicyNames.every(
      (name) =>
        policyMap.get(name)?.scope?.toLowerCase() ===
          `/subscriptions/${subscriptionId}`.toLowerCase() &&
        policyMap.get(name)?.enforcementMode === "Default" &&
        policyMap.get(name)?.policyDefinitionId?.toLowerCase() ===
          EXPECTED_POLICY_DEFINITIONS.get(name.slice(policyPrefix.length)) &&
        canonicalJson(policyMap.get(name)?.parameters ?? {}) ===
          canonicalJson(expectedPolicyParameters.get(name)) &&
        (![
          `${policyPrefix}activity-log-diag`,
          `${policyPrefix}inherit-env-tag`,
          `${policyPrefix}inherit-team-tag`,
        ].includes(name) ||
          policyMap.get(name)?.location === manifest.execution.region),
    ) &&
    rolesHealthy;
  const expectedDefender = {
    CloudPosture: "Free",
    VirtualMachines: decision.paidPlans.defenderForServers ? "Standard" : "Free",
    Containers: decision.paidPlans.defenderForContainers ? "Standard" : "Free",
    SqlServers: decision.paidPlans.defenderForDatabases ? "Standard" : "Free",
    OpenSourceRelationalDatabases: decision.paidPlans.defenderForDatabases
      ? "Standard"
      : "Free",
    KeyVaults: decision.paidPlans.defenderForKeyVault ? "Standard" : "Free",
    Arm: "Standard",
    StorageAccounts: "Standard",
  };
  const defenderMap = new Map(
    Object.keys(expectedDefender).map((name) => [
      name,
      readResult(runner, [
        "security",
        "pricing",
        "show",
        "--subscription",
        subscriptionId,
        "--name",
        name,
        "--query",
        "{name:name,pricingTier:pricingTier,subPlan:subPlan}",
        "--output",
        "json",
      ]),
    ]),
  );
  const defenderPricingHealthy = Object.entries(expectedDefender).every(
    ([name, tier]) =>
      defenderMap.get(name)?.pricingTier === tier &&
      (name !== "VirtualMachines" ||
        tier !== "Standard" ||
        defenderMap.get(name)?.subPlan === "P2") &&
      (name !== "StorageAccounts" ||
        tier !== "Standard" ||
        defenderMap.get(name)?.subPlan === "DefenderForStorageV2"),
  );
  const defenderWorkspaceSetting = decision.paidPlans.defenderForServers
    ? readResult(runner, [
        "security",
        "workspace-setting",
        "show",
        "--subscription",
        subscriptionId,
        "--name",
        "default",
        "--query",
        "{name:name,workspaceId:workspaceId}",
        "--output",
        "json",
      ])
    : null;
  const defenderWorkspaceHealthy =
    !decision.paidPlans.defenderForServers ||
    (defenderWorkspaceSetting?.name === "default" &&
      defenderWorkspaceSetting?.workspaceId?.toLowerCase() ===
        expectedWorkspaceId.toLowerCase());
  const budget = readResult(runner, [
    "consumption",
    "budget",
    "show",
    "--subscription",
    subscriptionId,
    "--budget-name",
    `budget-${prefix}-monthly`,
    "--query",
    "{name:name,amount:amount,timeGrain:timeGrain,notifications:notifications}",
    "--output",
    "json",
  ]);
  const notifications = Object.values(budget?.notifications ?? {});
  const notificationTuples = notifications
    .filter(
      (item) =>
        item?.enabled === true &&
        Array.isArray(item.contactEmails) &&
        item.contactEmails.length > 0,
    )
    .map((item) => `${item.thresholdType}:${item.threshold}`)
    .sort();
  const budgetContactLists = notifications.map((item) => item?.contactEmails);
  const consistentBudgetContacts =
    notifications.length === 4 &&
    Array.isArray(budgetContactLists[0]) &&
    budgetContactLists.every(
      (contacts) =>
        canonicalJson(contacts) === canonicalJson(budgetContactLists[0]),
    );
  const securityContact = readResult(runner, [
    "security",
    "contact",
    "show",
    "--subscription",
    subscriptionId,
    "--name",
    "default",
    "--query",
    "{emails:emails,isEnabled:isEnabled,notificationsByRole:notificationsByRole}",
    "--output",
    "json",
  ]);
  let liveContactsDigest = null;
  if (consistentBudgetContacts && typeof securityContact?.emails === "string") {
    try {
      liveContactsDigest = notificationContactsDigest(
        budgetContactLists[0],
        securityContact.emails,
      );
    } catch {
      liveContactsDigest = null;
    }
  }
  const contactsHealthy =
    liveContactsDigest ===
      (manifest.preview.bicepAttestation?.notificationContactsDigest ??
        manifest.preview.terraformAttestation?.notificationContactsDigest) &&
    securityContact?.isEnabled === true &&
    securityContact?.notificationsByRole?.state === "On";
  const defenderHealthy =
    defenderPricingHealthy && defenderWorkspaceHealthy && contactsHealthy;
  const budgetHealthy =
    budget?.name === `budget-${prefix}-monthly` &&
    budget?.amount === decision.monthlyBudgetAmount &&
    budget?.timeGrain === "Monthly" &&
    contactsHealthy &&
    canonicalJson(notificationTuples) ===
      canonicalJson(["Actual:100", "Actual:50", "Actual:80", "Forecasted:100"]);
  const vnet = decision.deployNetworking
    ? readResult(runner, [
        "network",
        "vnet",
        "show",
        "--subscription",
        subscriptionId,
        "--resource-group",
        networkingRg,
        "--name",
        `vnet-${prefix}`,
        "--query",
        "{name:name,location:location,provisioningState:provisioningState,addressPrefixes:addressSpace.addressPrefixes}",
        "--output",
        "json",
      ])
    : null;
  const subnets = decision.deployNetworking
    ? readResult(runner, [
        "network",
        "vnet",
        "subnet",
        "list",
        "--subscription",
        subscriptionId,
        "--resource-group",
        networkingRg,
        "--vnet-name",
        `vnet-${prefix}`,
        "--query",
        "[].{name:name,addressPrefix:addressPrefix,networkSecurityGroupId:networkSecurityGroup.id,delegations:delegations[].serviceName,provisioningState:provisioningState}",
        "--output",
        "json",
      ])
    : null;
  const networkSecurityGroups = decision.deployNetworking
    ? readResult(runner, [
        "network",
        "nsg",
        "list",
        "--subscription",
        subscriptionId,
        "--resource-group",
        networkingRg,
        "--query",
        "[].{name:name,location:location,provisioningState:provisioningState,securityRules:securityRules[].{name:name,priority:priority,direction:direction,access:access,protocol:protocol,sourceAddressPrefix:sourceAddressPrefix,sourcePortRange:sourcePortRange,destinationAddressPrefix:destinationAddressPrefix,destinationPortRange:destinationPortRange,destinationPortRanges:destinationPortRanges}}",
        "--output",
        "json",
      ])
    : null;
  const expectedTopology = decision.deployNetworking
    ? expectedNetworkTopology(
        { ...decision, region: manifest.execution.region },
        subscriptionId,
        networkingRg,
      )
    : null;
  const actualSubnets = Array.isArray(subnets)
    ? subnets
        .map((subnet) => ({
          name: subnet?.name ?? null,
          addressPrefix: subnet?.addressPrefix ?? null,
          networkSecurityGroupId:
            subnet?.networkSecurityGroupId?.toLowerCase() ?? null,
          delegations: Array.isArray(subnet?.delegations)
            ? [...subnet.delegations].sort()
            : [],
          provisioningState: subnet?.provisioningState ?? null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    : null;
  const actualNetworkSecurityGroups = Array.isArray(networkSecurityGroups)
    ? networkSecurityGroups
        .map((nsg) => ({
          name: nsg?.name ?? null,
          location: nsg?.location ?? null,
          provisioningState: nsg?.provisioningState ?? null,
          securityRules: Array.isArray(nsg?.securityRules)
            ? nsg.securityRules
                .map(normalizedSecurityRule)
                .sort((left, right) => left.name.localeCompare(right.name))
            : [],
        }))
        .sort((left, right) => left.name.localeCompare(right.name))
    : null;
  const networkingHealthy =
    !decision.deployNetworking ||
    (vnet?.name === `vnet-${prefix}` &&
      vnet?.location === manifest.execution.region &&
      vnet?.provisioningState === "Succeeded" &&
      canonicalJson(vnet?.addressPrefixes) ===
        canonicalJson([decision.vnetAddressPrefix]) &&
      expectedTopology !== null &&
      canonicalJson(actualSubnets) ===
        canonicalJson(expectedTopology.subnets) &&
      canonicalJson(actualNetworkSecurityGroups) ===
        canonicalJson(expectedTopology.networkSecurityGroups));
  return [
    check("deployment.platform.expected-resources", expectedResources),
    check("deployment.platform.monitoring", monitoring),
    check("deployment.platform.activity-log-forwarding", activityLog),
    check("deployment.platform.policy", policyHealthy),
    check("deployment.platform.defender", defenderHealthy),
    check("deployment.platform.budget", budgetHealthy),
    check("deployment.platform.networking", networkingHealthy),
  ];
}

function verificationDecision(manifest) {
  return {
    companyName: manifest.planDecision.companyName,
    monthlyBudgetAmount: manifest.planDecision.monthlyBudgetAmount,
    deployNetworking: manifest.planDecision.deployNetworking,
    vnetAddressPrefix: manifest.planDecision.vnetAddressPrefix,
    appSubnetDelegation: manifest.planDecision.appSubnetDelegation,
    logRetentionInDays: manifest.planDecision.logRetentionInDays,
    logDailyQuotaGb: manifest.planDecision.logDailyQuotaGb,
    paidPlans: manifest.planDecision.paidPlans,
  };
}

function withVerificationDecision(manifest, plan) {
  const environment = manifest.execution.environment;
  return {
    ...manifest,
    planDecision: {
      companyName: plan.decisionModel.configuration.companyName,
      monthlyBudgetAmount:
        plan.decisionModel.configuration.monthlyBudgetAmounts[environment],
      deployNetworking: plan.decisionModel.configuration.deployNetworking,
      vnetAddressPrefix: plan.decisionModel.regional.primary.vnetCidr,
      appSubnetDelegation:
        plan.decisionModel.configuration.appSubnetDelegation,
      logRetentionInDays: plan.decisionModel.configuration.logRetentionInDays,
      logDailyQuotaGb: plan.decisionModel.configuration.logDailyQuotaGb,
      paidPlans: plan.decisionModel.paidPlans,
      defenderWorkspace: plan.decisionModel.defenderWorkspace,
    },
  };
}

function runPostDeploymentValidation(
  manifest,
  plan,
  runner,
  maximumAttempts,
  sleep,
) {
  const internalManifest = withVerificationDecision(manifest, plan);
  verificationDecision(internalManifest);
  let checks = VALIDATION_CHECK_IDS.map((id) => ({ id, status: "not-run" }));
  let attempts = 0;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    attempts = attempt;
    checks = postDeploymentChecks(internalManifest, runner);
    if (checks.every((item) => item.status === "pass")) {
      return { attempts, checks, healthy: true };
    }
    if (attempt < maximumAttempts) {
      sleep();
    }
  }
  return { attempts, checks, healthy: false };
}

function defaultSleep() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
}

function runDeploymentIntegration(
  plan,
  manifest,
  approval,
  publicKey,
  {
    mode = "preview",
    planPath,
    evaluatedAt = Date.now(),
    clock = () => Date.now(),
    runner = defaultRunner,
    provenancePublicKey = null,
    statePath = ".sslz/deployment-state",
    regionalStatePath = null,
    maximumValidationAttempts = 3,
    sleep = defaultSleep,
  } = {},
) {
  const result = baseResult(mode, evaluatedAt);
  let reservation = null;
  let regionalReservation = null;
  let activeRegionalAttempt = null;
  let snapshot = null;
  let terraformRuntimeDirectory = null;
  let selection = null;
  let stateStore = null;
  try {
    if (!["preview", "apply"].includes(mode)) {
      fail("deployment.mode", "Mode must be preview or apply.");
    }
    if (mode === "preview") {
      fail(
        "deployment.preview.api",
        "Use buildDeploymentManifest for the zero-write preview operation.",
      );
    }
    if (
      !Number.isInteger(maximumValidationAttempts) ||
      maximumValidationAttempts < 1 ||
      maximumValidationAttempts > 5
    ) {
      fail(
        "deployment.validation.attempts",
        "Validation attempts must be an integer between one and five.",
      );
    }
    ({ selection } = assertManifestCurrent(
      plan,
      manifest,
      planPath,
      evaluatedAt,
      provenancePublicKey,
    ));
    result.manifest = manifest;
    result.commands = {
      preparation: manifest.commands.preparation
        ? {
            ...manifest.commands.preparation,
            preview: commandPreview(
              manifest.commands.preparation.executable,
              manifest.commands.preparation.arguments,
            ),
            executed: false,
          }
        : null,
      deployment: {
        ...manifest.commands.deployment,
        preview: commandPreview(
          manifest.commands.deployment.executable,
          manifest.commands.deployment.arguments,
        ),
        executed: false,
      },
    };
    if (!approval) {
      return rejectedResult(
        result,
        "deployment.approval.required",
        "Apply requires an explicit signed deployment approval artifact.",
      );
    }
    result.approval = approvalAudit(approval);
    try {
      validateApproval(approval, manifest, publicKey, evaluatedAt);
    } catch (error) {
      if (error instanceof DeploymentError) {
        const status = ["pending", "declined", "consumed"].includes(
          approval.status,
        )
          ? approval.status
          : error.code.endsWith(".expired")
            ? "expired"
            : "invalid";
        return rejectedResult(result, error.code, error.message, {
          approvalStatus: status,
          consumed: status === "consumed",
        });
      }
      return rejectedResult(
        result,
        "deployment.approval.malformed",
        "The deployment approval artifact is malformed.",
      );
    }
    result.approval.status = "approved";
    if (
      (stateStore = requireDurableStateStore(statePath)).storeId !==
      manifest.execution.stateStoreId
    ) {
      fail(
        "deployment.state.store-mismatch",
        "The signed deployment is bound to a different durable state store.",
      );
    }
    assertTerraformExecutor(manifest, runner);
    reservation = reserveApproval(
      approval,
      manifest,
      evaluatedAt,
      stateStore.directory,
    );
    if (reservation.status === "consumed") {
      return rejectedResult(
        result,
        "deployment.approval.replayed",
        "The signed deployment approval has already been consumed on this executor.",
        { approvalStatus: "consumed", consumed: true },
      );
    }
    if (reservation.status === "race") {
      return rejectedResult(
        result,
        "deployment.approval.race",
        "The signed deployment approval is already reserved by another local apply.",
        { approvalStatus: "consumed", consumed: true },
      );
    }
    result.safety.localState = "reserved";
    snapshot = createExecutionSnapshot(manifest);
    let runtimeCommands =
      manifest.execution.provider === "terraform"
        ? snapshotCommands(manifest, snapshot)
        : null;
    if (manifest.commands.preparation) {
      terraformRuntimeDirectory = mkdtempSync(
        resolve(tmpdir(), "sslz-terraform-runtime-"),
      );
      chmodSync(terraformRuntimeDirectory, 0o700);
      result.commands.preparation.executed = true;
      const prepared = runner(
        manifest.commands.preparation.executable,
        runtimeCommands.preparation,
        {
          environment: { TF_DATA_DIR: terraformRuntimeDirectory },
          terraformCliConfigPath: snapshot.terraformCliConfigPath,
          terraformAuthMode: manifest.execution.terraformAuthMode,
          terraformExecutablePath: snapshot.terraformExecutablePath,
        },
      );
      if (prepared.status !== 0) {
        completeReservation(
          reservation,
          "failed",
          "preparation-failed",
          "deployment.terraform.init-failed",
          false,
          clock(),
        );
        result.status = "error";
        result.code = "deployment.terraform.init-failed";
        result.message =
          "Terraform initialization failed; the saved plan was not applied.";
        result.approval.consumed = true;
        result.safety.localState = "consumed";
        return validatedResult(result);
      }
    }
    assertManifestCurrent(
      plan,
      manifest,
      planPath,
      clock(),
      provenancePublicKey,
    );
    validateApproval(approval, manifest, publicKey, clock());
    verifyExecutionSnapshot(snapshot, manifest);
    verifyBicepSnapshot(snapshot, manifest, plan, selection, runner);
    runtimeCommands ??= snapshotCommands(manifest, snapshot);
    const account = safeJson(
      runner("az", accountArguments(manifest.execution.subscriptionId)),
    );
    if (
      account?.id?.toLowerCase() !== manifest.execution.subscriptionId ||
      account?.tenantId?.toLowerCase() !== manifest.execution.tenantId ||
      account?.state !== "Enabled"
    ) {
      completeReservation(
        reservation,
        "failed",
        "target-mismatch",
        "deployment.target.mismatch",
        false,
        clock(),
      );
      result.status = "error";
      result.code = "deployment.target.mismatch";
      result.message =
        "The live Azure tenant, subscription, or state does not match the reviewed manifest.";
      result.approval.consumed = true;
      result.safety.localState = "consumed";
      return validatedResult(result);
    }
    assertExistingWorkspaceCurrent(plan, manifest, runner);
    approvalWindow(approval, clock(), "deployment.approval");
    const plannedRegionalAttempt = deploymentRegionalAttemptRecord(
      manifest,
      approval,
      clock(),
    );
    regionalReservation = reserveRegionalAttempt(
      plannedRegionalAttempt,
      regionalStatePath ?? resolve(stateStore.directory, "regional-attempts"),
      {
        previousAttemptKey: manifest.regionalAttempt.previousAttemptKey,
        previousTargetRegion: manifest.regionalAttempt.previousTargetRegion,
      },
    );
    if (regionalReservation.status === "replayed") {
      completeReservation(
        reservation,
        "failed",
        "regional-attempt-replayed",
        "deployment.regional-attempt.replayed",
        false,
        clock(),
      );
      result.status = "error";
      result.code = "deployment.regional-attempt.replayed";
      result.message =
        "The regional deployment attempt has already completed on this executor.";
      result.approval.consumed = true;
      result.safety.localState = "consumed";
      return validatedResult(result);
    }
    if (regionalReservation.status === "concurrent") {
      completeReservation(
        reservation,
        "failed",
        "regional-attempt-concurrent",
        "deployment.regional-attempt.concurrent",
        false,
        clock(),
      );
      result.status = "error";
      result.code = "deployment.regional-attempt.concurrent";
      result.message =
        "Another deployment in this regional attempt chain is already running.";
      result.approval.consumed = true;
      result.safety.localState = "consumed";
      return validatedResult(result);
    }
    if (regionalReservation.status === "predecessor-mismatch") {
      completeReservation(
        reservation,
        "failed",
        "regional-predecessor-mismatch",
        "deployment.regional-attempt.predecessor-mismatch",
        false,
        clock(),
      );
      result.status = "error";
      result.code = "deployment.regional-attempt.predecessor-mismatch";
      result.message =
        "The persisted predecessor attempt is missing, nonterminal, or differs from the reviewed cleanup chain.";
      result.approval.consumed = true;
      result.safety.localState = "consumed";
      return validatedResult(result);
    }
    activeRegionalAttempt = recordAttemptStarted(
      plannedRegionalAttempt,
      new Date(clock()).toISOString(),
    );
    updateReservation(reservation, {
      phase: "deployment-started",
      code: "deployment.started",
    });
    result.commands.deployment.executed = true;
    result.safety.deploymentWrites = 1;
    const deployment = runner(
      manifest.commands.deployment.executable,
      runtimeCommands.deployment,
      manifest.execution.provider === "terraform"
        ? {
            environment: { TF_DATA_DIR: terraformRuntimeDirectory },
            terraformCliConfigPath: snapshot.terraformCliConfigPath,
            terraformAuthMode: manifest.execution.terraformAuthMode,
            terraformExecutablePath: snapshot.terraformExecutablePath,
          }
        : {},
    );
    if (deployment.status !== 0) {
      activeRegionalAttempt = recordAttemptFailure(activeRegionalAttempt, {
        code: "deployment.execution.failed",
        summary: "The reviewed platform deployment command failed.",
        diagnostics: {
          status: deployment.status,
          stderr: deployment.stderr ?? "",
          stdout: deployment.stdout ?? "",
        },
        occurredAt: new Date(clock()).toISOString(),
      });
      const regionalFailureRecorded = completeRegionalAttemptReservation(
        regionalReservation,
        activeRegionalAttempt,
      );
      completeReservation(
        reservation,
        "failed",
        "deployment-failed",
        "deployment.execution.failed",
        false,
        clock(),
      );
      result.status = "error";
      result.code = "deployment.execution.failed";
      result.message =
        "The exact reviewed platform deployment failed; no workload deployment was attempted." +
        (regionalFailureRecorded
          ? ""
          : " The cleanup-required ledger could not be finalized; the chain remains blocked.");
      result.approval.consumed = true;
      result.safety.localState = "consumed";
      result.rollback.required = true;
      result.rollback.guidanceCode = "deployment.rollback.review-required";
      return validatedResult(result);
    }
    updateReservation(reservation, {
      phase: "deployment-succeeded",
      code: "deployment.validation.running",
    });
    const verification = runPostDeploymentValidation(
      manifest,
      plan,
      runner,
      maximumValidationAttempts,
      sleep,
    );
    result.verification = {
      performed: true,
      healthy: verification.healthy,
      attempts: verification.attempts,
      checks: verification.checks,
      workloadDeploymentAllowed: verification.healthy,
    };
    result.approval.consumed = true;
    result.safety.localState = "consumed";
    if (!verification.healthy) {
      activeRegionalAttempt = recordAttemptFailure(activeRegionalAttempt, {
        code: "deployment.validation.failed",
        summary: "The deployment completed but post-deployment validation failed.",
        diagnostics: {
          checks: verification.checks,
          attempts: verification.attempts,
        },
        occurredAt: new Date(clock()).toISOString(),
      });
      const regionalFailureRecorded = completeRegionalAttemptReservation(
        regionalReservation,
        activeRegionalAttempt,
      );
      completeReservation(
        reservation,
        "failed",
        "validation-failed",
        "deployment.validation.failed",
        false,
        clock(),
      );
      result.status = "error";
      result.code = "deployment.validation.failed";
      result.message =
        "The platform deployment completed, but the baseline is unhealthy; workload deployment is blocked." +
        (regionalFailureRecorded
          ? ""
          : " The cleanup-required ledger could not be finalized; the chain remains blocked.");
      result.rollback.required = true;
      result.rollback.guidanceCode = "deployment.rollback.review-required";
      return validatedResult(result);
    }
    activeRegionalAttempt = recordAttemptSuccess(
      activeRegionalAttempt,
      new Date(clock()).toISOString(),
    );
    const regionalSuccessRecorded = completeRegionalAttemptReservation(
      regionalReservation,
      activeRegionalAttempt,
    );
    if (!regionalSuccessRecorded) {
      completeReservation(
        reservation,
        "failed",
        "regional-attempt-finalization-failed",
        "deployment.regional-attempt.finalization-failed",
        false,
        clock(),
      );
      result.status = "error";
      result.code = "deployment.regional-attempt.finalization-failed";
      result.message =
        "The deployment passed validation, but durable regional-attempt finalization failed; workload deployment remains blocked.";
      result.verification.workloadDeploymentAllowed = false;
      result.rollback.required = true;
      result.rollback.guidanceCode = "deployment.rollback.review-required";
      return validatedResult(result);
    }
    completeReservation(
      reservation,
      "succeeded",
      "verified",
      "deployment.succeeded",
      true,
      clock(),
    );
    result.status = "succeeded";
    result.code = "deployment.succeeded";
    result.message =
      "The reviewed platform baseline was deployed and every required post-deployment check passed.";
    return validatedResult(result);
  } catch (error) {
    const code =
      error instanceof DeploymentError
        ? error.code
        : "deployment.input.malformed";
    const message =
      error instanceof DeploymentError
        ? error.message
        : "The plan, manifest, approval, or trusted key input is malformed.";
    if (
      regionalReservation?.status === "reserved" &&
      activeRegionalAttempt?.status === "started"
    ) {
      activeRegionalAttempt = recordAttemptFailure(activeRegionalAttempt, {
        code,
        summary: message,
        diagnostics: { code },
        occurredAt: new Date(clock()).toISOString(),
      });
      completeRegionalAttemptReservation(
        regionalReservation,
        activeRegionalAttempt,
      );
    }
    if (reservation?.status === "reserved") {
      completeReservation(
        reservation,
        "failed",
        "rejected-after-reservation",
        code,
        false,
        clock(),
      );
      result.approval.consumed = true;
      result.safety.localState = "consumed";
      result.status = "error";
      result.code = code;
      result.message = message;
      return validatedResult(result);
    }
    return rejectedResult(result, code, message);
  } finally {
    if (snapshot?.root && existsSync(snapshot.root)) {
      setSnapshotMode(snapshot.root, 0o700, 0o600);
      rmSync(snapshot.root, { recursive: true, force: true });
    }
    if (terraformRuntimeDirectory && existsSync(terraformRuntimeDirectory)) {
      rmSync(terraformRuntimeDirectory, { recursive: true, force: true });
    }
    if (reservation?.status === "reserved") {
      releaseReservation(reservation);
    }
    if (
      regionalReservation &&
      ["reserved", "finalizing", "release-failed"].includes(
        regionalReservation.status,
      )
    ) {
      releaseRegionalAttemptReservation(regionalReservation);
    }
  }
}

function previewResult(manifest, evaluatedAt) {
  const result = baseResult("preview", evaluatedAt);
  result.status = "planned";
  result.code = "deployment.preview.ready";
  result.message =
    "Preview completed with zero writes; apply requires this exact manifest and a trusted signed approval.";
  result.manifest = manifest;
  result.commands = {
    preparation: manifest.commands.preparation
      ? {
          ...manifest.commands.preparation,
          preview: commandPreview(
            manifest.commands.preparation.executable,
            manifest.commands.preparation.arguments,
          ),
          executed: false,
        }
      : null,
    deployment: {
      ...manifest.commands.deployment,
      preview: commandPreview(
        manifest.commands.deployment.executable,
        manifest.commands.deployment.arguments,
      ),
      executed: false,
    },
  };
  return validatedResult(result);
}

function usage() {
  return [
    "Usage:",
    "  startup-deployment-integration.mjs preview --plan <path> --provider bicep|terraform --environment prod|nonprod",
    "    [--terraform-auth cli|oidc] [--output json|text]",
    "  startup-deployment-integration.mjs apply --plan <path> --manifest <path> --approval <path>",
    "    [--output json|text]",
    "",
    "Preview performs read-only IaC inspection and zero writes.",
    "Preview and apply require the fixed pre-provisioned .sslz/deployment-state replay store.",
    "Terraform requires SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE.",
    "Apply also requires SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE and executes only the reviewed primary baseline.",
  ].join("\n");
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  if (!["preview", "apply"].includes(args[0])) {
    throw new Error("The command must be preview or apply.");
  }
  const options = {
    mode: args[0],
    output: "json",
    terraformAuthMode: "cli",
  };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--plan") {
      options.planPath = args[++index];
    } else if (argument === "--manifest") {
      options.manifestPath = args[++index];
    } else if (argument === "--approval") {
      options.approvalPath = args[++index];
    } else if (argument === "--provider") {
      options.provider = args[++index];
    } else if (argument === "--environment") {
      options.environment = args[++index];
    } else if (argument === "--terraform-auth") {
      options.terraformAuthMode = args[++index];
    } else if (argument === "--output") {
      options.output = args[++index];
    } else {
      throw new Error("An unsupported argument was supplied.");
    }
  }
  if (!options.planPath) {
    throw new Error("--plan is required.");
  }
  if (options.mode === "preview") {
    if (!options.provider || !options.environment) {
      throw new Error("Preview requires --provider and --environment.");
    }
    if (options.manifestPath || options.approvalPath) {
      throw new Error("Preview does not accept manifest or approval artifacts.");
    }
  } else if (!options.manifestPath || !options.approvalPath) {
    throw new Error("Apply requires --manifest and --approval.");
  }
  if (!["json", "text"].includes(options.output)) {
    throw new Error("--output must be json or text.");
  }
  return { help: false, ...options };
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

function readTrustedPublicKey(
  environmentName,
  code,
  message,
) {
  const requestedPath = process.env[environmentName];
  if (!requestedPath || !isAbsolute(requestedPath)) {
    fail(code, message);
  }
  const path = resolve(requestedPath);
  let current = path;
  const filesystemRoot = parse(path).root;
  while (current !== filesystemRoot) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      fail(
        code,
        "The trusted public-key path cannot contain symbolic links.",
      );
    }
    current = dirname(current);
  }
  if (
    !existsSync(path) ||
    lstatSync(path).isSymbolicLink() ||
    !statSync(path).isFile()
  ) {
    fail(
      code,
      "The provisioned trusted public-key path is not a regular non-linked file.",
    );
  }
  return readFileSync(path, "utf8");
}

function printText(result) {
  process.stdout.write(
    [
      `SSLZ deployment integration: ${result.status.toUpperCase()}`,
      `Code: ${result.code}`,
      `Message: ${result.message}`,
      ...(result.manifest
        ? [
            `Plan: ${result.manifest.plan.id}`,
            `Provider: ${result.manifest.execution.provider}`,
            `Environment: ${result.manifest.execution.environment}`,
            `Scope: ${result.manifest.execution.scope}`,
            `Command: ${result.commands.deployment.preview}`,
          ]
        : []),
      `Deployment writes: ${result.safety.deploymentWrites}`,
      `Baseline healthy: ${result.verification.healthy}`,
      `Workload deployment allowed: ${result.verification.workloadDeploymentAllowed}`,
      "",
    ].join("\n"),
  );
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
  } catch (error) {
    process.stderr.write(`Deployment integration usage error: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  let result;
  const evaluatedAt = Date.now();
  try {
    const plan = readJson(options.planPath);
    if (options.mode === "preview") {
      const provenancePublicKey =
        options.provider === "terraform"
          ? readTrustedPublicKey(
              "SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE",
              "deployment.terraform.provenance-trust-anchor",
              "Terraform preview requires an absolute protected provenance public-key path.",
            )
          : null;
      const manifest = buildDeploymentManifest(plan, {
        provider: options.provider,
        environment: options.environment,
        planPath: options.planPath,
        terraformAuthMode: options.terraformAuthMode,
        provenancePublicKey,
        evaluatedAt,
      });
      result = previewResult(manifest, evaluatedAt);
    } else {
      const manifest = readJson(options.manifestPath);
      const provenancePublicKey =
        manifest.execution?.provider === "terraform"
          ? readTrustedPublicKey(
              "SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE",
              "deployment.terraform.provenance-trust-anchor",
              "Terraform apply requires an absolute protected provenance public-key path.",
            )
          : null;
      result = runDeploymentIntegration(
        plan,
        manifest,
        readJson(options.approvalPath),
        readTrustedPublicKey(
          "SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE",
          "deployment.approval.trust-anchor",
          "Apply requires an absolute protected trusted public-key path from environment provisioning.",
        ),
        {
          mode: "apply",
          planPath: options.planPath,
          evaluatedAt,
          provenancePublicKey,
        },
      );
    }
  } catch (error) {
    const code =
      error instanceof DeploymentError
        ? error.code
        : "deployment.input.malformed";
    const message =
      error instanceof DeploymentError
        ? error.message
        : "The plan, manifest, approval, or trusted key input is malformed.";
    result = rejectedResult(baseResult(options.mode, evaluatedAt), code, message);
  }
  if (options.output === "text") {
    printText(result);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  process.exitCode = ["planned", "succeeded"].includes(result.status) ? 0 : 1;
}

export {
  approvalArtifactDigest,
  approvalReplayKey,
  approvalPayload,
  approvalSigningMessage,
  azureCliInvocation,
  buildDeploymentManifest,
  keyFingerprint,
  manifestDigest,
  expectedTerraformResourceGraph,
  runDeploymentIntegration,
  sanitizedTerraformEnvironment,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
