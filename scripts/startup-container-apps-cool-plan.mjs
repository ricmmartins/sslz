#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  deriveResume,
  validateCoolFoundationPlan,
  validateStepStateSemantics,
} from "./startup-cool-foundation-plan.mjs";
import { hashBytes, hashCanonical } from "./terraform-plan-provenance.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_ROOT = resolve(root, ".sslz/generated");
const VERSION = "1.0.0";
const GENERATED_BY = "startup-container-apps-cool-plan.mjs";
const KEY_VAULT_SECRETS_USER_ROLE =
  "4633458b-17de-408a-b874-0445c86b69e6";

const GATE_IDS = Object.freeze({
  mode: "cool.container-apps.mode-nonprod-only",
  foundation: "cool.container-apps.foundation-bound",
  attestations: "cool.container-apps.attestations-current",
  image: "cool.container-apps.image-immutable",
  secrets: "cool.container-apps.secrets-reference-only",
  identity: "cool.container-apps.identity-rbac-scoped",
  network: "cool.container-apps.network-profile-matched",
  probes: "cool.container-apps.health-probes-approved",
  configuration: "cool.container-apps.configuration-parity",
  observability: "cool.container-apps.observability-bound",
  cost: "cool.container-apps.cost-within-ceiling",
  objectives: "cool.container-apps.recovery-objectives-matched",
  measuredRecovery: "cool.container-apps.measured-recovery-met",
  artifacts: "cool.container-apps.artifacts-exact",
  parity: "cool.container-apps.provider-parity",
  execution: "cool.container-apps.execution-disabled",
  exclusions: "cool.container-apps.failover-capabilities-excluded",
});

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const inputSchema = load(
  "agent/schemas/container-apps-cool-profile-input.schema.json",
);
const planSchema = load(
  "agent/schemas/container-apps-cool-profile-plan.schema.json",
);
const manifestSchema = load(
  "agent/schemas/container-apps-cool-profile-manifest.schema.json",
);

function repositoryRelative(path) {
  return relative(root, path).split(sep).join("/");
}

function assertNoSymlink(path) {
  let current = resolve(path);
  while (current.startsWith(root) && current !== root) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        `Planning paths cannot contain symbolic links: ${repositoryRelative(current)}.`,
      );
    }
    current = dirname(current);
  }
}

function generatedPath(requested, label) {
  if (!requested || isAbsolute(requested)) {
    throw new Error(`${label} must be relative to the repository.`);
  }
  const path = resolve(root, requested);
  const relation = relative(GENERATED_ROOT, path);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`${label} must stay under .sslz/generated.`);
  }
  assertNoSymlink(path);
  return path;
}

function writeGenerated(path, document) {
  assertNoSymlink(path);
  const content = `${JSON.stringify(document, null, 2)}\n`;
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8");
    if (existing === content) {
      return;
    }
    if (
      !existing.includes('"decisionDigest"') &&
      !existing.includes('"decision_digest"')
    ) {
      throw new Error(
        `Refusing to overwrite a non-generated file: ${repositoryRelative(path)}.`,
      );
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}

function digestDocument(document, digestField) {
  const payload = structuredClone(document);
  delete payload[digestField];
  return hashCanonical(payload);
}

function visitFiles(path, files) {
  assertNoSymlink(path);
  const metadata = statSync(path);
  if (metadata.isFile()) {
    files.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name === ".terraform") {
      continue;
    }
    visitFiles(resolve(path, entry.name), files);
  }
}

function sourceFiles(provider) {
  const configured =
    provider === "bicep"
      ? [
          "infra/bicep/cool-container-apps.bicep",
          "infra/bicep/modules/cool-container-apps.bicep",
          "infra/bicep/modules/cool-container-apps-rbac.bicep",
        ]
      : ["infra/terraform/cool-container-apps"];
  const files = [];
  configured.forEach((item) => visitFiles(resolve(root, item), files));
  return [...new Set(files)].sort((left, right) =>
    repositoryRelative(left).localeCompare(repositoryRelative(right)),
  );
}

function sourceDigest(provider) {
  return hashCanonical(
    sourceFiles(provider).map((path) => ({
      path: repositoryRelative(path),
      digest: hashBytes(readFileSync(path)),
    })),
  );
}

function freshness(item, evaluatedAt) {
  const issuedAt = Date.parse(item?.issuedAt);
  const expiresAt = Date.parse(item?.expiresAt);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt
  ) {
    return "invalid";
  }
  if (issuedAt > evaluatedAt) {
    return "future";
  }
  return expiresAt <= evaluatedAt ? "expired" : "current";
}

function cidrRange(cidr) {
  const match = String(cidr).match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/,
  );
  if (!match) {
    return null;
  }
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((item) => item > 255) || prefix < 0 || prefix > 32) {
    return null;
  }
  const value = octets.reduce((result, item) => result * 256 + item, 0);
  const block = 2 ** (32 - prefix);
  const start = Math.floor(value / block) * block;
  return { start, end: start + block - 1 };
}

function cidrsOverlap(first, second) {
  const left = cidrRange(first);
  const right = cidrRange(second);
  return (
    !left ||
    !right ||
    (left.start <= right.end && right.start <= left.end)
  );
}

function gate(id, passed, evidenceReferences, passMessage, blockMessage) {
  return {
    id,
    status: passed ? "pass" : "blocked",
    evidenceReferences: [...new Set(evidenceReferences.filter(Boolean))].sort(),
    message: passed ? passMessage : blockMessage,
  };
}

function assertNoSecretMaterial(input) {
  const forbiddenKeys = new Set([
    "value",
    "secretValue",
    "password",
    "token",
    "connectionString",
    "clientSecret",
  ]);
  function inspect(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(`Secret material is prohibited at ${path}.${key}.`);
      }
      inspect(item, `${path}.${key}`);
    }
  }
  inspect(input, "$");
}

function configurationDigest(input) {
  return hashCanonical({
    domain: "sslz.cool-container-apps.configuration.v1",
    profileId: input.profileId,
    environment: input.environment,
    foundation: {
      subscriptionId: input.foundationBinding.subscriptionId,
      secondaryRegion: input.foundationBinding.secondaryRegion,
      secondaryScope: input.foundationBinding.secondaryScope,
      secondaryVnetCidr: input.foundationBinding.secondaryVnetCidr,
      vnetResourceId: input.foundationBinding.vnetResourceId,
      infrastructureSubnetResourceId:
        input.foundationBinding.infrastructureSubnetResourceId,
      logAnalyticsWorkspaceResourceId:
        input.foundationBinding.logAnalyticsWorkspaceResourceId,
    },
    configuration: input.configuration,
  });
}

function profileDecisions(input) {
  return {
    domain: "sslz.cool-container-apps.provider-decisions.v1",
    profileId: input.profileId,
    environment: input.environment,
    foundationBinding: input.foundationBinding,
    configuration: input.configuration,
    recoveryTargets: {
      targetRtoMinutes: input.recovery.targetRtoMinutes,
      targetRpoMinutes: input.recovery.targetRpoMinutes,
      exerciseCadence: input.recovery.exerciseCadence,
      accountableRoleReference: input.recovery.accountableRoleReference,
    },
    costAssumptions: {
      currency: input.cost.currency,
      projectedMonthlyCost: input.cost.projectedMonthlyCost,
      ceilingPercent: input.cost.ceilingPercent,
      minimumScaleAssumption: input.cost.minimumScaleAssumption,
    },
    safety: input.safety,
  };
}

function expectedFoundationBinding(foundationPlan, input) {
  const foundation = foundationPlan.foundation;
  const subscription = foundation.secondary.subscriptionId;
  const networkScope = foundation.isolation.scope;
  const vnetResourceId = `${networkScope}/providers/Microsoft.Network/virtualNetworks/${foundation.secondary.resourceNames.vnet}`;
  const monitoringScope = networkScope.replace(
    /-networking$/,
    "-monitoring",
  );
  const companyMatch =
    foundation.secondary.resourceNames.vnet.match(
      /^vnet-([a-z0-9]+)-nonprod-cool-/,
    );
  const company = companyMatch?.[1];
  const primaryScope = company
    ? `/subscriptions/${subscription}/resourceGroups/rg-${company}-nonprod-primary/providers/Microsoft.Resources/deployments/primary`
    : "";
  const secondaryScope = `/subscriptions/${subscription}/resourceGroups/${input.configuration.resourceGroupName}/providers/Microsoft.Resources/deployments/profile`;
  const terraformStateKey = foundation.isolation.terraformState.replace(
    "-nonprod-secondary.tfstate",
    "-nonprod-secondary-container-apps.tfstate",
  );
  return {
    planId: foundationPlan.planId,
    planDigest: foundationPlan.planDigest,
    readinessEvidenceDigest:
      foundationPlan.approvalBinding.readinessEvidenceDigest,
    subscriptionId: subscription,
    secondaryRegion: foundation.secondary.region,
    primaryScope,
    secondaryScope,
    primaryVnetCidr: foundation.primary.vnetCidr,
    secondaryVnetCidr: foundation.secondary.vnetCidr,
    vnetResourceId,
    infrastructureSubnetResourceId: `${vnetResourceId}/subnets/snet-container-apps`,
    logAnalyticsWorkspaceResourceId: `${monitoringScope}/providers/Microsoft.OperationalInsights/workspaces/${foundation.secondary.resourceNames.workspace}`,
    terraformStateKey,
  };
}

function identityGatePassed(input) {
  const configuration = input.configuration;
  const expectedRoleSuffix = `/providers/Microsoft.Authorization/roleDefinitions/${KEY_VAULT_SECRETS_USER_ROLE}`;
  return (
    configuration.secretReferences.every(
      (item) =>
        item.identityResourceId ===
        configuration.managedIdentity.resourceId,
    ) &&
    configuration.roleAssignments.length === 1 &&
    configuration.roleAssignments.every(
      (item) =>
        item.principalId === configuration.managedIdentity.principalId &&
        item.scope === configuration.keyVault.resourceId &&
        item.roleDefinitionId.endsWith(expectedRoleSuffix),
    ) &&
    configuration.keyVault.subscriptionId ===
      input.foundationBinding.subscriptionId &&
    input.attestations.identityRbac.status === "approved"
  );
}

function probeGatePassed(input) {
  const probes = input.configuration.probes;
  return (
    probes.length === 3 &&
    new Set(probes.map((item) => item.type)).size === 3 &&
    ["Startup", "Readiness", "Liveness"].every((type) =>
      probes.some((item) => item.type === type),
    ) &&
    probes.every(
      (item) =>
        item.transport === "HTTP" &&
        item.port === input.configuration.targetPort,
    ) &&
    input.attestations.health.status === "pass"
  );
}

function evaluateProfileGates(
  foundationPlan,
  input,
  artifacts,
  evaluatedAt,
) {
  const expectedBinding = expectedFoundationBinding(foundationPlan, input);
  const attestationState = freshness(input.attestations, evaluatedAt);
  const configDigest = configurationDigest(input);
  const costPercent =
    input.cost.primaryMonthlyCost > 0
      ? (input.cost.projectedMonthlyCost / input.cost.primaryMonthlyCost) * 100
      : Number.POSITIVE_INFINITY;
  const measured = input.recovery.measuredResult;
  const measuredAt = Date.parse(measured.measuredAt);
  const artifactDigestsMatch = artifacts.every((artifact) => {
    const path = resolve(root, artifact.path);
    return (
      existsSync(path) &&
      statSync(path).isFile() &&
      hashBytes(readFileSync(path)) === artifact.digest
    );
  });
  const references = Object.values(input.attestations)
    .filter((item) => item && typeof item === "object")
    .map((item) => item.reference);

  return [
    gate(
      GATE_IDS.mode,
      foundationPlan.environment === "nonprod" &&
        foundationPlan.mode === "cool-infrastructure" &&
        input.environment === "nonprod",
      [foundationPlan.planId],
      "The profile is restricted to the nonproduction secondary cool foundation.",
      "Production or a non-cool foundation cannot host this profile.",
    ),
    gate(
      GATE_IDS.foundation,
      foundationPlan.status === "ready-for-review" &&
        foundationPlan.gateResults.every((item) => item.status === "pass") &&
        hashCanonical(input.foundationBinding) ===
          hashCanonical(expectedBinding),
      [
        foundationPlan.planDigest,
        foundationPlan.approvalBinding.readinessEvidenceDigest,
      ],
      "The exact review-ready foundation, region, scope, network, and state binding match.",
      "The foundation is blocked, mutated, replayed, or bound to different profile infrastructure.",
    ),
    gate(
      GATE_IDS.attestations,
      attestationState === "current" &&
        references.length === 6 &&
        references.every(Boolean),
      references,
      "All profile attestations are explicit and current.",
      "One or more profile attestations are missing, stale, future-dated, or invalid.",
    ),
    gate(
      GATE_IDS.image,
      /^[a-z0-9.-]+\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/.test(
        input.configuration.image,
      ) && input.attestations.image.status === "approved",
      [input.attestations.image.reference, input.configuration.image],
      "The reviewed image is bound to an immutable digest.",
      "The image is mutable or lacks an explicit approval attestation.",
    ),
    gate(
      GATE_IDS.secrets,
      input.configuration.secretReferences.length > 0 &&
        input.configuration.secretReferences.every(
          (item) =>
            /^https:\/\/[a-z0-9-]+\.vault\.azure\.net\/secrets\/[A-Za-z0-9-]+\/[0-9a-f]{32}$/.test(
              item.keyVaultSecretUri,
            ),
        ) &&
        input.configuration.secretEnvironmentVariables.every((item) =>
          input.configuration.secretReferences.some(
            (secret) => secret.name === item.secretRef,
          ),
        ),
      input.configuration.secretReferences.map((item) => item.keyVaultSecretUri),
      "Only versioned Key Vault secret references are represented.",
      "Secret material, unversioned references, or unresolved secret names are prohibited.",
    ),
    gate(
      GATE_IDS.identity,
      identityGatePassed(input),
      [
        input.attestations.identityRbac.reference,
        input.configuration.managedIdentity.resourceId,
        input.configuration.keyVault.resourceId,
      ],
      "Managed identity and Key Vault RBAC are bound to the expected principal and scope.",
      "Managed identity, principal, role, secret identity, or RBAC scope is mismatched.",
    ),
    gate(
      GATE_IDS.network,
      input.attestations.networking.status === "approved" &&
        input.foundationBinding.secondaryRegion ===
          foundationPlan.foundation.secondary.region &&
        input.foundationBinding.infrastructureSubnetResourceId.endsWith(
          "/subnets/snet-container-apps",
        ) &&
        input.foundationBinding.primaryScope !==
          input.foundationBinding.secondaryScope &&
        !cidrsOverlap(
          input.foundationBinding.primaryVnetCidr,
          input.foundationBinding.secondaryVnetCidr,
        ),
      [
        input.attestations.networking.reference,
        input.foundationBinding.infrastructureSubnetResourceId,
      ],
      "The internal profile uses the dedicated secondary subnet and isolated scope.",
      "Region, profile subnet, scope, or address-space isolation is mismatched.",
    ),
    gate(
      GATE_IDS.probes,
      probeGatePassed(input),
      [input.attestations.health.reference],
      "Startup, readiness, and liveness probes are complete and approved healthy.",
      "Probe coverage, target port, or health evidence is incomplete or unhealthy.",
    ),
    gate(
      GATE_IDS.configuration,
      input.attestations.configurationParity.status === "approved" &&
        input.attestations.configurationParity.primaryDigest === configDigest &&
        input.attestations.configurationParity.secondaryDigest === configDigest,
      [
        input.attestations.configurationParity.reference,
        configDigest,
      ],
      "Primary and secondary reviewed configuration digests match.",
      "Configuration parity is pending, rejected, or bound to different decisions.",
    ),
    gate(
      GATE_IDS.observability,
      input.attestations.observability.status === "confirmed" &&
        input.configuration.observability.logAnalyticsWorkspaceResourceId ===
          input.foundationBinding.logAnalyticsWorkspaceResourceId &&
        hashCanonical(
          [...input.configuration.observability.requiredLogCategories].sort(),
        ) ===
          hashCanonical(
            ["ContainerAppConsoleLogs", "ContainerAppSystemLogs"].sort(),
          ),
      [
        input.attestations.observability.reference,
        input.foundationBinding.logAnalyticsWorkspaceResourceId,
      ],
      "Container Apps diagnostics are bound to the secondary foundation workspace.",
      "Observability evidence, workspace binding, or required log categories are incomplete.",
    ),
    gate(
      GATE_IDS.cost,
      input.cost.status === "confirmed" &&
        input.cost.ceilingPercent === 30 &&
        costPercent <= input.cost.ceilingPercent &&
        input.cost.minimumScaleAssumption ===
          (input.configuration.minReplicas === 0
            ? "scale-to-zero"
            : "one-idle-replica"),
      [input.cost.reference, input.cost.evidenceDigest],
      "The minimum-scale assumption is explicit and projected cost is within the provisional ceiling.",
      "Cost evidence, minimum-scale assumptions, or the 30% provisional ceiling are violated.",
    ),
    gate(
      GATE_IDS.objectives,
      input.recovery.targetRtoMinutes === 240 &&
        input.recovery.targetRpoMinutes === 60 &&
        input.recovery.exerciseCadence === "quarterly" &&
        input.recovery.accountableRoleReference ===
          "Platform Operations Owner",
      [input.recovery.accountableRoleReference],
      "The profile matches the provisional noncritical nonproduction recovery baseline.",
      "RTO, RPO, cadence, or accountable role differs from the provisional profile baseline.",
    ),
    gate(
      GATE_IDS.measuredRecovery,
      measured.status === "met" &&
        Number.isFinite(measuredAt) &&
        measuredAt >= Date.parse(input.attestations.issuedAt) &&
        measuredAt <= evaluatedAt &&
        measuredAt < Date.parse(input.attestations.expiresAt) &&
        measured.measuredRtoMinutes !== null &&
        measured.measuredRpoMinutes !== null &&
        measured.measuredRtoMinutes <= input.recovery.targetRtoMinutes &&
        measured.measuredRpoMinutes <= input.recovery.targetRpoMinutes,
      [measured.reference, measured.evidenceDigest],
      "A current measured profile recovery result meets the provisional targets.",
      "The measured-recovery placeholder cannot pass without explicit current RTO/RPO evidence.",
    ),
    gate(
      GATE_IDS.artifacts,
      artifacts.length === 2 &&
        artifactDigestsMatch &&
        artifacts.every(
          (artifact) => artifact.sourceDigest === sourceDigest(artifact.provider),
        ),
      artifacts.map((item) => item.digest),
      "Exact Bicep and Terraform profile inputs and sources are digest-bound.",
      "Profile artifacts are missing, mutated, replayed, or bound to different sources.",
    ),
    gate(
      GATE_IDS.parity,
      artifacts.length === 2 &&
        new Set(artifacts.map((item) => item.provider)).size === 2 &&
        artifacts[0].decisionDigest === artifacts[1].decisionDigest,
      artifacts.map((item) => item.decisionDigest),
      "Bicep and Terraform represent the same Container Apps decisions.",
      "Bicep and Terraform decisions differ or a provider representation is missing.",
    ),
    gate(
      GATE_IDS.execution,
      input.safety.executionEnabled === false &&
        input.safety.azureOperations === "none" &&
        input.safety.providerRegistration === false,
      ["safety.execution-disabled"],
      "This profile has no execution, preview, apply, or provider-registration path.",
      "Execution or Azure operations must remain disabled.",
    ),
    gate(
      GATE_IDS.exclusions,
      [
        input.safety.productionExecution,
        input.safety.globalIngress,
        input.safety.dnsCutover,
        input.safety.dataReplication,
        input.safety.dataFailover,
      ].every((item) => item === false) &&
        input.configuration.ingressExternal === false,
      ["safety.profile-failover-excluded"],
      "Production, global ingress, DNS cutover, replication, and data failover remain excluded.",
      "The profile cannot include production or global/data failover capabilities.",
    ),
  ];
}

function bicepParameters(input, decisionDigest, bicepSourceDigest) {
  const configuration = input.configuration;
  const role = configuration.roleAssignments[0];
  return {
    $schema:
      "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      location: { value: input.foundationBinding.secondaryRegion },
      resourceGroupName: { value: configuration.resourceGroupName },
      managedEnvironmentName: { value: configuration.managedEnvironmentName },
      containerAppName: { value: configuration.containerAppName },
      managedIdentityResourceId: {
        value: configuration.managedIdentity.resourceId,
      },
      managedIdentityPrincipalId: {
        value: configuration.managedIdentity.principalId,
      },
      keyVaultSubscriptionId: {
        value: configuration.keyVault.subscriptionId,
      },
      keyVaultResourceGroupName: {
        value: configuration.keyVault.resourceGroupName,
      },
      keyVaultName: { value: configuration.keyVault.name },
      keyVaultRoleDefinitionId: { value: role.roleDefinitionId },
      infrastructureSubnetResourceId: {
        value: input.foundationBinding.infrastructureSubnetResourceId,
      },
      logAnalyticsWorkspaceResourceId: {
        value: input.foundationBinding.logAnalyticsWorkspaceResourceId,
      },
      primaryScope: { value: input.foundationBinding.primaryScope },
      secondaryScope: { value: input.foundationBinding.secondaryScope },
      primaryVnetCidr: {
        value: input.foundationBinding.primaryVnetCidr,
      },
      secondaryVnetCidr: {
        value: input.foundationBinding.secondaryVnetCidr,
      },
      image: { value: configuration.image },
      revisionMode: { value: configuration.revisionMode },
      targetPort: { value: configuration.targetPort },
      transport: { value: configuration.transport },
      minReplicas: { value: configuration.minReplicas },
      maxReplicas: { value: configuration.maxReplicas },
      cpu: { value: String(configuration.cpu) },
      memory: { value: configuration.memory },
      secretReferences: { value: configuration.secretReferences },
      secretEnvironmentVariables: {
        value: configuration.secretEnvironmentVariables,
      },
      probes: { value: configuration.probes },
      diagnosticSettingName: {
        value: configuration.observability.diagnosticSettingName,
      },
      decisionDigest: { value: decisionDigest },
      sourceDigest: { value: bicepSourceDigest },
    },
  };
}

function terraformVariables(input, decisionDigest, terraformSourceDigest) {
  const configuration = input.configuration;
  const role = configuration.roleAssignments[0];
  return {
    subscription_id: input.foundationBinding.subscriptionId,
    location: input.foundationBinding.secondaryRegion,
    resource_group_name: configuration.resourceGroupName,
    managed_environment_name: configuration.managedEnvironmentName,
    container_app_name: configuration.containerAppName,
    managed_identity_resource_id: configuration.managedIdentity.resourceId,
    managed_identity_principal_id: configuration.managedIdentity.principalId,
    key_vault_resource_id: configuration.keyVault.resourceId,
    key_vault_role_definition_id: role.roleDefinitionId,
    infrastructure_subnet_resource_id:
      input.foundationBinding.infrastructureSubnetResourceId,
    log_analytics_workspace_resource_id:
      input.foundationBinding.logAnalyticsWorkspaceResourceId,
    primary_scope: input.foundationBinding.primaryScope,
    secondary_scope: input.foundationBinding.secondaryScope,
    primary_vnet_cidr: input.foundationBinding.primaryVnetCidr,
    secondary_vnet_cidr: input.foundationBinding.secondaryVnetCidr,
    image: configuration.image,
    revision_mode: configuration.revisionMode,
    target_port: configuration.targetPort,
    transport: configuration.transport,
    min_replicas: configuration.minReplicas,
    max_replicas: configuration.maxReplicas,
    cpu: configuration.cpu,
    memory: configuration.memory,
    secret_references: configuration.secretReferences.map((item) => ({
      name: item.name,
      key_vault_secret_uri: item.keyVaultSecretUri,
      identity_resource_id: item.identityResourceId,
    })),
    secret_environment_variables:
      configuration.secretEnvironmentVariables.map((item) => ({
        name: item.name,
        secret_ref: item.secretRef,
      })),
    probes: configuration.probes.map((item) => ({
      type: item.type,
      transport: item.transport,
      path: item.path,
      port: item.port,
      initial_delay_seconds: item.initialDelaySeconds,
      interval_seconds: item.intervalSeconds,
      timeout_seconds: item.timeoutSeconds,
      failure_threshold: item.failureThreshold,
    })),
    diagnostic_setting_name:
      configuration.observability.diagnosticSettingName,
    decision_digest: decisionDigest,
    source_digest: terraformSourceDigest,
  };
}

function buildArtifacts(input, outputDirectory) {
  const decisionDigest = hashCanonical(profileDecisions(input));
  const definitions = [
    {
      provider: "bicep",
      sourcePath: "infra/bicep/cool-container-apps.bicep",
      filename: "bicep-cool-container-apps.parameters.json",
      sourceDigest: sourceDigest("bicep"),
    },
    {
      provider: "terraform",
      sourcePath: "infra/terraform/cool-container-apps",
      filename: "terraform-cool-container-apps.auto.tfvars.json",
      sourceDigest: sourceDigest("terraform"),
    },
  ];
  return definitions.map((definition) => {
    const document =
      definition.provider === "bicep"
        ? bicepParameters(input, decisionDigest, definition.sourceDigest)
        : terraformVariables(input, decisionDigest, definition.sourceDigest);
    const path = resolve(outputDirectory, definition.filename);
    writeGenerated(path, document);
    return {
      provider: definition.provider,
      path: repositoryRelative(path),
      digest: hashBytes(readFileSync(path)),
      decisionDigest,
      sourcePath: definition.sourcePath,
      sourceDigest: definition.sourceDigest,
    };
  });
}

function postchecks() {
  return [
    ["scope", "Confirm the profile exists only in the bound secondary nonproduction resource group."],
    ["network", "Confirm the environment is internal and uses only the dedicated secondary subnet."],
    ["image", "Confirm the active revision uses the exact reviewed image digest."],
    ["identity", "Confirm the app uses only the bound managed identity and scoped Key Vault role."],
    ["secrets", "Confirm configuration exposes only Key Vault references and named secret bindings."],
    ["probes", "Confirm startup, readiness, and liveness probes report healthy."],
    ["observability", "Confirm required Container Apps logs reach the bound secondary workspace."],
    ["exclusions", "Confirm no production, global ingress, DNS, replication, or data failover resources exist."],
  ].map(([name, description]) => ({
    id: `cool.container-apps.postcheck.${name}`,
    status: "not-run",
    readOnly: true,
    blocking: true,
    description,
  }));
}

function stepDefinitions(provider, foundationPlanDigest, artifactDigest) {
  const definitions = [
    ["validate-bindings", "Revalidate foundation, readiness, approval, manifest, source, and parameter digests.", true, []],
    ["prepare-context", "Prepare an isolated provider context without provider registration.", true, []],
    ["identity-rbac", "Represent the existing identity and exact Key Vault role assignment.", true, ["identity"]],
    ["environment-network", "Represent the internal Container Apps environment on the dedicated subnet.", true, ["scope", "network"]],
    ["secrets-configuration", "Represent only versioned Key Vault references and configuration parity.", true, ["secrets"]],
    ["container-app", "Represent the digest-pinned single-revision Container App and minimum scale.", true, ["image"]],
    ["observability", "Represent secondary workspace diagnostics.", true, ["observability"]],
    ["health-postchecks", "Run only the bound read-only health and exclusion checks.", false, ["probes", "exclusions"]],
    ["activation", "Plan internal nonproduction activation only after every signed gate passes.", false, ["scope", "network", "image", "identity", "secrets", "probes", "observability", "exclusions"]],
    ["measured-recovery", "Record explicit measured RTO/RPO evidence; this step cannot infer success.", false, []],
    ["rollback-readiness", "Verify the reviewed rollback and cleanup plan before any future activation.", false, []],
  ];
  return definitions.map(([name, intent, retryable, checkNames], index) => ({
    order: index + 1,
    id: `cool.container-apps.${name}`,
    intent,
    state: "pending",
    attempt: 0,
    maxAttempts: retryable ? 3 : 1,
    retryable,
    idempotencyKey: hashCanonical({
      domain: "sslz.cool-container-apps.step.v1",
      provider,
      foundationPlanDigest,
      artifactDigest,
      order: index + 1,
      name,
    }),
    postcheckIds: checkNames.map(
      (check) => `cool.container-apps.postcheck.${check}`,
    ),
  }));
}

function rollbackPlan() {
  return {
    intent: "review-only",
    approvalRequired: true,
    status: "not-run",
    orderedActions: [
      "Stop internal activation and preserve the last known healthy revision evidence.",
      "Route no global or public traffic; retain the primary region as the only executable production mode.",
      "Reconcile the failed step and mark partial resources cleanup-required.",
      "Obtain separate approval before removing only digest-bound secondary profile resources.",
    ],
  };
}

function teardownPlan() {
  return {
    intent: "review-only",
    approvalRequired: true,
    status: "not-run",
    triggers: [
      "A partial activation enters cleanup-required state.",
      "Any startup, readiness, or liveness probe is unhealthy.",
      "Cost, configuration parity, identity, network, or measured recovery evidence is rejected.",
    ],
    orderedActions: [
      "Capture read-only inventory, revision, probe, identity, RBAC, and diagnostic evidence.",
      "Disable any internal activation without changing primary traffic or DNS.",
      "Review dependencies and obtain separate teardown approval.",
      "Remove only the digest-bound secondary profile resource group and scoped role assignment, then verify absence.",
    ],
  };
}

function safety() {
  return {
    executionEnabled: false,
    azureOperations: "none",
    providerRegistration: false,
    productionExecution: false,
    globalIngress: false,
    dnsCutover: false,
    dataReplication: false,
    dataFailover: false,
    endToEndRecoveryClaim: false,
  };
}

function buildManifest(
  foundationPlan,
  input,
  artifact,
  outputDirectory,
) {
  const configuration = input.configuration;
  const foundationIdentifier = foundationPlan.foundation.isolation.terraformState;
  const identifier =
    artifact.provider === "terraform"
      ? input.foundationBinding.terraformStateKey
      : `deployment:cool-container-apps-nonprod-${input.foundationBinding.secondaryRegion}`;
  const primaryIdentifier =
    artifact.provider === "terraform"
      ? input.foundationBinding.terraformStateKey.replace(
          "-secondary-container-apps.tfstate",
          "-primary-container-apps.tfstate",
        )
      : `deployment:primary-container-apps-nonprod-${foundationPlan.foundation.primary.region}`;
  const steps = stepDefinitions(
    artifact.provider,
    foundationPlan.planDigest,
    artifact.digest,
  );
  const document = {
    schemaVersion: VERSION,
    manifestVersion: VERSION,
    generatedBy: GENERATED_BY,
    manifestDigest: hashCanonical({ placeholder: artifact.provider }),
    provider: artifact.provider,
    mode: "cool-container-apps",
    environment: "nonprod",
    source: {
      foundationPlanId: foundationPlan.planId,
      foundationPlanDigest: foundationPlan.planDigest,
      readinessEvidenceDigest:
        foundationPlan.approvalBinding.readinessEvidenceDigest,
      profileDecisionDigest: artifact.decisionDigest,
    },
    target: {
      subscriptionId: input.foundationBinding.subscriptionId,
      region: input.foundationBinding.secondaryRegion,
      scope: input.foundationBinding.secondaryScope,
      primaryScope: input.foundationBinding.primaryScope,
      primaryVnetCidr: input.foundationBinding.primaryVnetCidr,
      secondaryVnetCidr: input.foundationBinding.secondaryVnetCidr,
      resourceNames: {
        resourceGroup: configuration.resourceGroupName,
        managedEnvironment: configuration.managedEnvironmentName,
        containerApp: configuration.containerAppName,
        managedIdentity: configuration.managedIdentity.name,
      },
    },
    artifacts: {
      parameterPath: artifact.path,
      parameterDigest: artifact.digest,
      decisionDigest: artifact.decisionDigest,
      sourcePath: artifact.sourcePath,
      sourceDigest: artifact.sourceDigest,
    },
    stateIsolation: {
      kind:
        artifact.provider === "terraform"
          ? "terraform-remote-state"
          : "arm-deployment-history",
      identifier,
      primaryIdentifier,
      foundationIdentifier,
      isolated:
        identifier !== primaryIdentifier &&
        identifier !== foundationIdentifier,
    },
    steps,
    resume: deriveResume(steps),
    postchecks: postchecks(),
    rollback: rollbackPlan(),
    teardown: teardownPlan(),
    safety: safety(),
  };
  document.manifestDigest = digestDocument(document, "manifestDigest");
  validateDocument(manifestSchema, document);
  validateStepStateSemantics(document);
  const path = resolve(
    outputDirectory,
    `${artifact.provider}-cool-container-apps-manifest.json`,
  );
  writeGenerated(path, document);
  return { document, path };
}

function generateContainerAppsCoolPlan(
  foundationPlan,
  input,
  {
    outputPath = ".sslz/generated/cool-container-apps",
    evaluatedAt = Date.now(),
  } = {},
) {
  validateCoolFoundationPlan(foundationPlan);
  validateDocument(inputSchema, input);
  assertNoSecretMaterial(input);
  if (input.configuration.maxReplicas < input.configuration.minReplicas) {
    throw new Error("maxReplicas must be greater than or equal to minReplicas.");
  }
  const outputDirectory = generatedPath(outputPath, "Output directory");
  const artifacts = buildArtifacts(input, outputDirectory);
  const gates = evaluateProfileGates(
    foundationPlan,
    input,
    artifacts,
    evaluatedAt,
  );
  const manifests = artifacts.map((artifact) =>
    buildManifest(foundationPlan, input, artifact, outputDirectory),
  );
  const decisionDigest = artifacts[0].decisionDigest;
  const payload = {
    schemaVersion: VERSION,
    plannerVersion: VERSION,
    generatedBy: GENERATED_BY,
    planId: `${foundationPlan.planId}-container-apps`,
    evaluatedAt: new Date(evaluatedAt).toISOString(),
    status: gates.every((item) => item.status === "pass")
      ? "ready-for-review"
      : "blocked",
    mode: "cool-container-apps",
    environment: "nonprod",
    source: {
      foundationPlanId: foundationPlan.planId,
      foundationPlanDigest: foundationPlan.planDigest,
      readinessEvidenceDigest:
        foundationPlan.approvalBinding.readinessEvidenceDigest,
      profileDecisionDigest: decisionDigest,
    },
    readinessBinding: {
      foundationStatus: foundationPlan.status,
      foundationGateDigest: hashCanonical(foundationPlan.gateResults),
      attestationFreshness: freshness(input.attestations, evaluatedAt),
      attestationDigest: hashCanonical(input.attestations),
      measuredRecoveryStatus: input.recovery.measuredResult.status,
    },
    gateResults: gates,
    profile: {
      configuration: input.configuration,
      recovery: input.recovery,
      cost: input.cost,
      excludedCapabilities: [
        "data-failover",
        "data-replication",
        "dns-cutover",
        "global-ingress",
        "production-execution",
        "traffic-failover",
      ],
    },
    artifacts,
    manifests: manifests.map(({ document, path }) => ({
      provider: document.provider,
      path: repositoryRelative(path),
      digest: document.manifestDigest,
    })),
    deploymentStateContract: {
      states: [
        "pending",
        "running",
        "succeeded",
        "failed",
        "cleanup-required",
      ],
      ordered: true,
      singleActiveStep: true,
      idempotencyRequired: true,
      resumeRequiresArtifactDigestMatch: true,
      partialFailure: "fail-closed",
    },
    safety: safety(),
  };
  const planDigest = hashCanonical(payload);
  const document = {
    ...payload,
    planDigest,
    approvalBinding: {
      required: true,
      status: "pending",
      signingDomain: "sslz.cool-container-apps.approval.v1",
      planDigest,
      foundationPlanDigest: foundationPlan.planDigest,
      profileDecisionDigest: decisionDigest,
      manifestDigests: manifests
        .map(({ document: manifest }) => manifest.manifestDigest)
        .sort(),
      executionApprovalAccepted: false,
    },
  };
  validateDocument(planSchema, document);
  const path = resolve(outputDirectory, "cool-container-apps-plan.json");
  writeGenerated(path, document);
  return document;
}

function validateContainerAppsCoolPlan(document) {
  validateDocument(planSchema, document);
  const payload = structuredClone(document);
  delete payload.planDigest;
  delete payload.approvalBinding;
  if (hashCanonical(payload) !== document.planDigest) {
    throw new Error(
      "The Container Apps cool plan digest does not match its canonical content.",
    );
  }
  if (
    document.approvalBinding.planDigest !== document.planDigest ||
    document.approvalBinding.foundationPlanDigest !==
      document.source.foundationPlanDigest ||
    document.approvalBinding.profileDecisionDigest !==
      document.source.profileDecisionDigest
  ) {
    throw new Error("The approval binding does not match the profile plan.");
  }
  for (const artifact of document.artifacts) {
    const path = resolve(root, artifact.path);
    if (
      hashBytes(readFileSync(path)) !== artifact.digest ||
      sourceDigest(artifact.provider) !== artifact.sourceDigest ||
      artifact.decisionDigest !== document.source.profileDecisionDigest
    ) {
      throw new Error(`Artifact digest mismatch: ${artifact.provider}.`);
    }
  }
  for (const binding of document.manifests) {
    const path = resolve(root, binding.path);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    validateDocument(manifestSchema, manifest);
    if (
      digestDocument(manifest, "manifestDigest") !== manifest.manifestDigest ||
      manifest.manifestDigest !== binding.digest ||
      manifest.source.profileDecisionDigest !==
        document.source.profileDecisionDigest
    ) {
      throw new Error(`Manifest digest mismatch: ${binding.provider}.`);
    }
    validateStepStateSemantics(manifest);
  }
  return document;
}

function usage() {
  return [
    "Usage:",
    "  startup-container-apps-cool-plan.mjs generate",
    "    --foundation-plan <cool-foundation-plan.json>",
    "    --profile-input <container-apps-profile-input.json>",
    "    [--output-dir .sslz/generated/<name>]",
    "  startup-container-apps-cool-plan.mjs validate --plan <profile-plan.json>",
    "",
    "This command generates or validates local planning artifacts only.",
    "It has no preview, apply, provider-registration, workflow-write, or Azure operation.",
  ].join("\n");
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  const command = args[0];
  if (!["generate", "validate"].includes(command)) {
    throw new Error("The supported commands are generate and validate.");
  }
  const options = {
    command,
    outputPath: ".sslz/generated/cool-container-apps",
  };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--foundation-plan") {
      options.foundationPlanPath = args[++index];
    } else if (argument === "--profile-input") {
      options.profileInputPath = args[++index];
    } else if (argument === "--plan") {
      options.planPath = args[++index];
    } else if (argument === "--output-dir") {
      options.outputPath = args[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (command === "generate") {
    if (!options.foundationPlanPath) {
      throw new Error("--foundation-plan is required for generation.");
    }
    if (!options.profileInputPath) {
      throw new Error("--profile-input is required for generation.");
    }
  } else if (!options.planPath) {
    throw new Error("--plan is required for validation.");
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result =
      options.command === "generate"
        ? generateContainerAppsCoolPlan(
            readJson(options.foundationPlanPath),
            readJson(options.profileInputPath),
            { outputPath: options.outputPath },
          )
        : validateContainerAppsCoolPlan(readJson(options.planPath));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "blocked" ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `Container Apps cool planning failed: ${error.message}\n`,
    );
    process.exitCode = 2;
  }
}

export {
  GATE_IDS,
  configurationDigest,
  evaluateProfileGates,
  generateContainerAppsCoolPlan,
  parseArguments,
  validateContainerAppsCoolPlan,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
