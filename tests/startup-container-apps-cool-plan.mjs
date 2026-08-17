#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateIacPlan,
  readinessEvidenceDigest,
} from "../scripts/startup-iac-plan.mjs";
import {
  deriveResume,
  generateCoolFoundationPlan,
  validateStepStateSemantics,
} from "../scripts/startup-cool-foundation-plan.mjs";
import {
  GATE_IDS,
  configurationDigest,
  evaluateProfileGates,
  generateContainerAppsCoolPlan,
  parseArguments,
  validateContainerAppsCoolPlan,
} from "../scripts/startup-container-apps-cool-plan.mjs";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";
import { buildReadinessEvidence } from "./readiness-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evaluatedAt = Date.parse("2026-08-09T12:00:00Z");
const outputRelative = `.sslz/generated/container-apps-cool-tests-${process.pid}`;
const outputPath = resolve(root, outputRelative);
const baseline = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/cool-foundation-baseline.json"),
    "utf8",
  ),
);
const profileExample = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/container-apps-cool-profile-input.json"),
    "utf8",
  ),
);
const profileInputSchema = JSON.parse(
  readFileSync(
    resolve(
      root,
      "agent/schemas/container-apps-cool-profile-input.schema.json",
    ),
    "utf8",
  ),
);
const profilePlanSchema = JSON.parse(
  readFileSync(
    resolve(
      root,
      "agent/schemas/container-apps-cool-profile-plan.schema.json",
    ),
    "utf8",
  ),
);
const profileManifestSchema = JSON.parse(
  readFileSync(
    resolve(
      root,
      "agent/schemas/container-apps-cool-profile-manifest.schema.json",
    ),
    "utf8",
  ),
);

function createPhaseFourInput() {
  const planningInput = JSON.parse(
    readFileSync(
      resolve(root, "agent/examples/regional-planning-input.json"),
      "utf8",
    ),
  );
  planningInput.startupInput.reliability.regionalMode = "cool-infrastructure";
  planningInput.startupInput.reliability.failoverOwnerConfirmed = true;
  planningInput.startupInput.reliability.rtoMinutes = 240;
  planningInput.startupInput.reliability.rpoMinutes = 60;
  planningInput.regionalRequirements.secondaryBaseline.minimum = 30;
  planningInput.regionalRequirements.secondaryBaseline.maximum = 60;
  planningInput.workloadPlan = planWorkload(planningInput.startupInput);
  const regionalPlan = planRegions(planningInput);
  const input = {
    schemaVersion: "3.0.0",
    planId: "phase-seven-container-apps-test",
    target: {
      tenantId: "11111111-1111-1111-1111-111111111111",
      environments: [
        {
          name: "prod",
          subscriptionId:
            planningInput.startupInput.subscriptions.prodSubscriptionId,
        },
        {
          name: "nonprod",
          subscriptionId:
            planningInput.startupInput.subscriptions.nonprodSubscriptionId,
        },
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
      proposedActions: [
        {
          id: "operations.preview.review",
          type: "information",
          region: null,
          scope: null,
          summary: "Review the sanitized preview before later execution.",
        },
      ],
      terraformBackend: {
        type: "azurerm",
        subscriptionId:
          planningInput.startupInput.subscriptions.prodSubscriptionId,
        resourceGroupName: "rg-terraform-state",
        storageAccountName: "stsslzfixture",
        containerName: "tfstate",
        keyPrefix: "phase-seven-container-apps",
      },
    },
    approval: null,
  };
  input.readinessEvidence = buildReadinessEvidence(input);
  return input;
}

function createFoundation() {
  const input = createPhaseFourInput();
  const pending = generateIacPlan(input, {
    outputPath: `${outputRelative}/phase4-pending`,
    evaluatedAt,
  });
  input.approval = {
    status: "approved",
    planId: input.planId,
    planDigest: pending.planDigest,
    approvedAt: "2026-08-09T11:00:00Z",
    expiresAt: "2026-08-09T13:00:00Z",
  };
  const sourcePlan = generateIacPlan(input, {
    outputPath: `${outputRelative}/phase4-approved`,
    evaluatedAt,
  });
  return generateCoolFoundationPlan(sourcePlan, baseline, {
    outputPath: `${outputRelative}/foundation`,
    evaluatedAt,
  });
}

function bindProfile(foundation, { measured = true } = {}) {
  const input = structuredClone(profileExample);
  const subscriptionId = foundation.foundation.secondary.subscriptionId;
  const region = foundation.foundation.secondary.region;
  const networkScope = foundation.foundation.isolation.scope;
  const monitoringScope = networkScope.replace(/-networking$/, "-monitoring");
  const vnetResourceId = `${networkScope}/providers/Microsoft.Network/virtualNetworks/${foundation.foundation.secondary.resourceNames.vnet}`;
  const profileResourceGroup = `rg-contoso-nonprod-cool-${region}-container-apps`;
  const profileScope = `/subscriptions/${subscriptionId}/resourceGroups/${profileResourceGroup}/providers/Microsoft.Resources/deployments/profile`;
  const primaryScope = `/subscriptions/${subscriptionId}/resourceGroups/rg-contoso-nonprod-primary/providers/Microsoft.Resources/deployments/primary`;
  const identityId = `/subscriptions/${subscriptionId}/resourceGroups/${profileResourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-contoso-nonprod-cool-${region}`;
  const keyVaultId = `/subscriptions/${subscriptionId}/resourceGroups/rg-contoso-nonprod-security/providers/Microsoft.KeyVault/vaults/kv-contoso-nonprod`;

  input.foundationBinding = {
    planId: foundation.planId,
    planDigest: foundation.planDigest,
    readinessEvidenceDigest:
      foundation.approvalBinding.readinessEvidenceDigest,
    subscriptionId,
    secondaryRegion: region,
    primaryScope,
    secondaryScope: profileScope,
    primaryVnetCidr: foundation.foundation.primary.vnetCidr,
    secondaryVnetCidr: foundation.foundation.secondary.vnetCidr,
    vnetResourceId,
    infrastructureSubnetResourceId: `${vnetResourceId}/subnets/snet-container-apps`,
    logAnalyticsWorkspaceResourceId: `${monitoringScope}/providers/Microsoft.OperationalInsights/workspaces/${foundation.foundation.secondary.resourceNames.workspace}`,
    terraformStateKey: foundation.foundation.isolation.terraformState.replace(
      "-nonprod-secondary.tfstate",
      "-nonprod-secondary-container-apps.tfstate",
    ),
  };
  input.configuration.resourceGroupName = profileResourceGroup;
  input.configuration.managedEnvironmentName = `cae-contoso-nonprod-cool-${region}`;
  input.configuration.containerAppName = `ca-contoso-nonprod-cool-${region}`;
  input.configuration.managedIdentity = {
    name: `id-contoso-nonprod-cool-${region}`,
    resourceId: identityId,
    principalId: "44444444-4444-4444-4444-444444444444",
  };
  input.configuration.keyVault = {
    resourceId: keyVaultId,
    subscriptionId,
    resourceGroupName: "rg-contoso-nonprod-security",
    name: "kv-contoso-nonprod",
  };
  input.configuration.secretReferences[0].identityResourceId = identityId;
  input.configuration.roleAssignments = [
    {
      principalId: input.configuration.managedIdentity.principalId,
      roleDefinitionId: `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6`,
      scope: keyVaultId,
    },
  ];
  input.configuration.observability.logAnalyticsWorkspaceResourceId =
    input.foundationBinding.logAnalyticsWorkspaceResourceId;
  input.attestations.configurationParity.primaryDigest =
    configurationDigest(input);
  input.attestations.configurationParity.secondaryDigest =
    configurationDigest(input);
  if (measured) {
    input.recovery.measuredResult = {
      status: "met",
      reference: "measurement.container-apps.exercise-001",
      evidenceDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      measuredAt: "2026-08-09T11:30:00Z",
      measuredRtoMinutes: 180,
      measuredRpoMinutes: 45,
    };
  }
  return input;
}

function gateStatus(gates, id) {
  return gates.find((item) => item.id === id).status;
}

function reevaluate(foundation, input, artifacts) {
  return evaluateProfileGates(foundation, input, artifacts, evaluatedAt);
}

try {
  validateDocument(profileInputSchema, profileExample);
  const foundation = createFoundation();
  const placeholderInput = bindProfile(foundation, { measured: false });
  const placeholder = generateContainerAppsCoolPlan(
    foundation,
    placeholderInput,
    {
      outputPath: `${outputRelative}/profile-placeholder`,
      evaluatedAt,
    },
  );
  assert.equal(placeholder.status, "blocked");
  assert.equal(
    gateStatus(placeholder.gateResults, GATE_IDS.measuredRecovery),
    "blocked",
  );
  assert.equal(placeholder.safety.executionEnabled, false);
  assert.equal(placeholder.approvalBinding.executionApprovalAccepted, false);

  const input = bindProfile(foundation);
  const plan = generateContainerAppsCoolPlan(foundation, input, {
    outputPath: `${outputRelative}/profile-ready`,
    evaluatedAt,
  });
  validateDocument(profilePlanSchema, plan);
  validateContainerAppsCoolPlan(plan);
  assert.equal(plan.status, "ready-for-review");
  assert(plan.gateResults.every((item) => item.status === "pass"));
  assert.equal(plan.environment, "nonprod");
  assert.equal(plan.mode, "cool-container-apps");
  assert.equal(plan.artifacts.length, 2);
  assert.equal(plan.manifests.length, 2);
  assert.equal(plan.safety.azureOperations, "none");
  assert.equal(plan.safety.productionExecution, false);
  assert.equal(plan.safety.globalIngress, false);
  assert.equal(plan.safety.dnsCutover, false);
  assert.equal(plan.safety.dataReplication, false);
  assert.equal(plan.safety.dataFailover, false);
  assert.equal(plan.safety.endToEndRecoveryClaim, false);
  assert.deepEqual(plan.profile.excludedCapabilities, [
    "data-failover",
    "data-replication",
    "dns-cutover",
    "global-ingress",
    "production-execution",
    "traffic-failover",
  ]);
  assert.notEqual(
    input.foundationBinding.primaryScope,
    input.foundationBinding.secondaryScope,
  );
  assert.notEqual(
    input.foundationBinding.primaryVnetCidr,
    input.foundationBinding.secondaryVnetCidr,
  );

  const bicepArtifact = plan.artifacts.find(
    (item) => item.provider === "bicep",
  );
  const terraformArtifact = plan.artifacts.find(
    (item) => item.provider === "terraform",
  );
  const bicepParameters = JSON.parse(
    readFileSync(resolve(root, bicepArtifact.path), "utf8"),
  ).parameters;
  const terraformVariables = JSON.parse(
    readFileSync(resolve(root, terraformArtifact.path), "utf8"),
  );
  assert.equal(bicepParameters.image.value, terraformVariables.image);
  assert.equal(
    bicepParameters.resourceGroupName.value,
    terraformVariables.resource_group_name,
  );
  assert.equal(
    bicepParameters.infrastructureSubnetResourceId.value,
    terraformVariables.infrastructure_subnet_resource_id,
  );
  assert.equal(
    bicepParameters.decisionDigest.value,
    terraformVariables.decision_digest,
  );
  assert.equal(
    bicepParameters.secretReferences.value[0].keyVaultSecretUri,
    terraformVariables.secret_references[0].key_vault_secret_uri,
  );
  assert.equal(
    Object.hasOwn(bicepParameters.secretReferences.value[0], "value"),
    false,
  );
  assert.equal(
    Object.hasOwn(terraformVariables.secret_references[0], "value"),
    false,
  );
  assert.equal(
    bicepParameters.probes.value[0].initialDelaySeconds,
    terraformVariables.probes[0].initial_delay_seconds,
  );
  assert.equal(
    bicepParameters.probes.value[1].intervalSeconds,
    terraformVariables.probes[1].interval_seconds,
  );
  assert.equal(
    bicepParameters.probes.value[2].failureThreshold,
    terraformVariables.probes[2].failure_threshold,
  );

  const manifests = plan.manifests.map((binding) =>
    JSON.parse(readFileSync(resolve(root, binding.path), "utf8")),
  );
  manifests.forEach((manifest) => {
    validateDocument(profileManifestSchema, manifest);
    validateStepStateSemantics(manifest);
    assert.equal(manifest.resume.action, "start");
    assert.equal(manifest.resume.allowed, false);
    assert.equal(manifest.rollback.intent, "review-only");
    assert.equal(manifest.teardown.intent, "review-only");
    assert.equal(manifest.safety.executionEnabled, false);
    assert.notEqual(
      manifest.stateIsolation.identifier,
      manifest.stateIsolation.primaryIdentifier,
    );
    assert.notEqual(
      manifest.stateIsolation.identifier,
      manifest.stateIsolation.foundationIdentifier,
    );
    assert(
      manifest.steps.some(
        (item) => item.id === "cool.container-apps.activation",
      ),
    );
    assert(
      manifest.steps.some(
        (item) => item.id === "cool.container-apps.measured-recovery",
      ),
    );
    assert(manifest.postchecks.every((item) => item.status === "not-run"));
  });
  assert.equal(
    manifests[0].source.profileDecisionDigest,
    manifests[1].source.profileDecisionDigest,
  );

  const stateManifest = structuredClone(manifests[0]);
  stateManifest.steps[0].state = "succeeded";
  stateManifest.steps[0].attempt = 1;
  stateManifest.resume = deriveResume(stateManifest.steps);
  assert.equal(stateManifest.resume.action, "resume");
  assert.equal(stateManifest.resume.allowed, true);
  validateStepStateSemantics(stateManifest);
  stateManifest.steps[1].state = "failed";
  stateManifest.steps[1].attempt = 1;
  stateManifest.resume = deriveResume(stateManifest.steps);
  assert.equal(stateManifest.resume.action, "retry");
  assert.equal(stateManifest.resume.allowed, true);
  validateStepStateSemantics(stateManifest);
  stateManifest.steps[1].state = "cleanup-required";
  stateManifest.resume = deriveResume(stateManifest.steps);
  assert.equal(stateManifest.resume.action, "cleanup");
  assert.equal(stateManifest.resume.allowed, false);
  validateStepStateSemantics(stateManifest);

  const stale = structuredClone(input);
  stale.attestations.expiresAt = "2026-08-09T11:59:59Z";
  assert.equal(
    gateStatus(reevaluate(foundation, stale, plan.artifacts), GATE_IDS.attestations),
    "blocked",
  );

  const missing = structuredClone(input);
  delete missing.attestations.image;
  assert.throws(
    () => generateContainerAppsCoolPlan(foundation, missing),
    /missing required property image/,
  );

  const mutableImage = structuredClone(input);
  mutableImage.configuration.image = "contoso.azurecr.io/api:latest";
  assert.throws(
    () => generateContainerAppsCoolPlan(foundation, mutableImage),
    /does not match/,
  );

  const secretMaterial = structuredClone(input);
  secretMaterial.configuration.secretReferences[0].value = "forbidden";
  assert.throws(
    () => generateContainerAppsCoolPlan(foundation, secretMaterial),
    /unexpected property value|Secret material is prohibited/,
  );

  for (const [mutate, gateId] of [
    [
      (item) => {
        item.configuration.roleAssignments[0].principalId =
          "55555555-5555-5555-5555-555555555555";
      },
      GATE_IDS.identity,
    ],
    [
      (item) => {
        item.foundationBinding.secondaryRegion = "eastus2";
      },
      GATE_IDS.foundation,
    ],
    [
      (item) => {
        item.foundationBinding.infrastructureSubnetResourceId =
          item.foundationBinding.infrastructureSubnetResourceId.replace(
            "snet-container-apps",
            "snet-app",
          );
      },
      GATE_IDS.network,
    ],
    [
      (item) => {
        item.configuration.probes[1].port = 9090;
      },
      GATE_IDS.probes,
    ],
    [
      (item) => {
        item.cost.projectedMonthlyCost = 80;
      },
      GATE_IDS.cost,
    ],
    [
      (item) => {
        item.recovery.measuredResult.measuredRtoMinutes = 300;
      },
      GATE_IDS.measuredRecovery,
    ],
    [
      (item) => {
        item.recovery.measuredResult.measuredAt = "2026-08-09T12:00:01Z";
      },
      GATE_IDS.measuredRecovery,
    ],
    [
      (item) => {
        item.recovery.targetRtoMinutes = 300;
      },
      GATE_IDS.objectives,
    ],
    [
      (item) => {
        item.recovery.targetRpoMinutes = 120;
      },
      GATE_IDS.objectives,
    ],
    [
      (item) => {
        item.attestations.configurationParity.secondaryDigest =
          `sha256:${"0".repeat(64)}`;
      },
      GATE_IDS.configuration,
    ],
    [
      (item) => {
        item.attestations.health.status = "fail";
      },
      GATE_IDS.probes,
    ],
  ]) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.equal(
      gateStatus(reevaluate(foundation, changed, plan.artifacts), gateId),
      "blocked",
      gateId,
    );
  }

  const replayedFoundation = structuredClone(input);
  replayedFoundation.foundationBinding.planDigest =
    `sha256:${"0".repeat(64)}`;
  assert.equal(
    gateStatus(
      reevaluate(foundation, replayedFoundation, plan.artifacts),
      GATE_IDS.foundation,
    ),
    "blocked",
  );

  for (const mutate of [
    (item) => {
      item.environment = "prod";
    },
    (item) => {
      item.configuration.ingressExternal = true;
    },
    (item) => {
      item.safety.productionExecution = true;
    },
    (item) => {
      item.safety.globalIngress = true;
    },
    (item) => {
      item.safety.dataFailover = true;
    },
  ]) {
    const prohibited = structuredClone(input);
    mutate(prohibited);
    assert.throws(
      () => generateContainerAppsCoolPlan(foundation, prohibited),
      /expected constant/,
    );
  }

  const parityMismatch = structuredClone(plan.artifacts);
  parityMismatch[1].decisionDigest = `sha256:${"f".repeat(64)}`;
  assert.equal(
    gateStatus(
      reevaluate(foundation, input, parityMismatch),
      GATE_IDS.parity,
    ),
    "blocked",
  );

  const parameterPath = resolve(root, plan.artifacts[0].path);
  const originalParameter = readFileSync(parameterPath, "utf8");
  writeFileSync(parameterPath, `${originalParameter}\n`);
  try {
    assert.equal(
      gateStatus(
        reevaluate(foundation, input, plan.artifacts),
        GATE_IDS.artifacts,
      ),
      "blocked",
    );
    assert.throws(
      () => validateContainerAppsCoolPlan(plan),
      /Artifact digest mismatch/,
    );
  } finally {
    writeFileSync(parameterPath, originalParameter);
  }

  const bicepSource = readFileSync(
    resolve(root, "infra/bicep/cool-container-apps.bicep"),
    "utf8",
  );
  const terraformSource = ["main.tf", "variables.tf", "outputs.tf"]
    .map((file) =>
      readFileSync(
        resolve(root, "infra/terraform/cool-container-apps", file),
        "utf8",
      ),
    )
    .join("\n");
  for (const source of [bicepSource, terraformSource]) {
    assert.match(source, /sha256/i);
    assert.match(source, /container.?apps/i);
    assert.match(source, /key.?vault/i);
    assert.match(source, /managed.?identity/i);
    assert.match(source, /diagnostic/i);
    assert.doesNotMatch(
      source,
      /front\s*door|traffic\s*manager|dns.?cutover|data.?replication|terraform\s+apply|az\s+deployment|provider\s+register/i,
    );
  }
  const bicepNetworkingSource = readFileSync(
    resolve(root, "infra/bicep/modules/networking.bicep"),
    "utf8",
  );
  const terraformNetworkingSource = readFileSync(
    resolve(root, "infra/terraform/modules/networking/main.tf"),
    "utf8",
  );
  for (const source of [bicepNetworkingSource, terraformNetworkingSource]) {
    assert.match(source, /AllowAzureLoadBalancerInbound/);
    assert.match(source, /AllowVNetInbound/);
    assert.match(source, /DenyAllInbound/);
  }

  for (const workflow of ["deploy-bicep.yml", "deploy-terraform.yml"]) {
    const source = readFileSync(
      resolve(root, ".github/workflows", workflow),
      "utf8",
    );
    assert.doesNotMatch(source, /cool-container-apps/);
  }

  assert.deepEqual(
    parseArguments([
      "generate",
      "--foundation-plan",
      ".sslz/generated/my-plan/cool-foundation/cool-foundation-plan.json",
      "--profile-input",
      "agent/examples/container-apps-cool-profile-input.json",
      "--output-dir",
      ".sslz/generated/my-plan/cool-container-apps",
    ]),
    {
      command: "generate",
      foundationPlanPath:
        ".sslz/generated/my-plan/cool-foundation/cool-foundation-plan.json",
      profileInputPath:
        "agent/examples/container-apps-cool-profile-input.json",
      outputPath: ".sslz/generated/my-plan/cool-container-apps",
    },
  );

  console.log("Container Apps cool profile planning tests passed.");
} finally {
  rmSync(outputPath, { recursive: true, force: true });
}
