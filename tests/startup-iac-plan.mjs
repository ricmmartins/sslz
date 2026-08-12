#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { azureCliInvocation } from "../scripts/azure-cli-invocation.mjs";
import {
  assertArtifactDestinationsAvailable,
  buildDecisionModel,
  canonicalJson,
  generateIacPlan,
  planDigest,
  readinessEvidenceDigest,
  sanitizedTerraformEnvironment as sanitizedPlannerTerraformEnvironment,
  summarizePreview,
  writeExclusiveArtifacts,
} from "../scripts/startup-iac-plan.mjs";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import {
  postgresqlDecisionDigest,
} from "../scripts/startup-postgresql-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";
import {
  buildDefenderWorkspaceDecision,
  digest as defenderWorkspaceDigest,
  evidenceDigest as defenderEvidenceDigest,
} from "../scripts/defender-workspace-placement.mjs";
import {
  createRegionalAttempt,
  recordAttemptFailure,
  recordAttemptStarted,
  recordCleanupOutcome,
} from "../scripts/regional-attempt.mjs";
import { buildReadinessEvidence } from "./readiness-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/startup-iac-plan.mjs");
const summarySchema = JSON.parse(
  readFileSync(resolve(root, "agent/schemas/iac-plan-summary.schema.json"), "utf8"),
);
const regionalInput = JSON.parse(
  readFileSync(resolve(root, "agent/examples/regional-planning-input.json"), "utf8"),
);
const successFixture = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/iac-planner/preview-success.json"),
    "utf8",
  ),
);
const failureFixture = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/iac-planner/preview-failure.json"),
    "utf8",
  ),
);
const outputRelative = `.sslz/generated/tests-${process.pid}`;
const outputPath = resolve(root, outputRelative);
const terraformVariables = readFileSync(
  resolve(root, "infra/terraform/variables.tf"),
  "utf8",
);
assert.match(
  terraformVariables,
  /variable "resource_provider_registrations" \{[\s\S]*?default\s+=\s+"legacy"/,
);

function createInput({
  regionalMode = "cool-infrastructure",
  defenderForServers = true,
  existingWorkspaceId = null,
  workspaceRegion = null,
  oneSubscription = false,
} = {}) {
  const planningInput = structuredClone(regionalInput);
  planningInput.startupInput.reliability.regionalMode = regionalMode;
  planningInput.startupInput.reliability.failoverOwnerConfirmed =
    regionalMode !== "single-region-ready";
  planningInput.startupInput.reliability.rtoMinutes = 240;
  planningInput.startupInput.reliability.rpoMinutes = 60;
  planningInput.regionalRequirements.secondaryBaseline.minimum = 30;
  planningInput.regionalRequirements.secondaryBaseline.maximum = 60;
  planningInput.workloadPlan = planWorkload(planningInput.startupInput);
  const regionalPlan = planRegions(planningInput);

  const input = {
    schemaVersion: "3.0.0",
    planId: "phase-four-test",
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
          subscriptionId: oneSubscription
            ? planningInput.startupInput.subscriptions.prodSubscriptionId
            : planningInput.startupInput.subscriptions.nonprodSubscriptionId,
        },
      ],
    },
    workloadPlan: planningInput.workloadPlan,
    regionalPlan,
    deployment: {
      companyName: "contoso",
      budgetStartDate: "2026-08-01T00:00:00Z",
      monthlyBudgetAmounts: {
        prod: 500,
        nonprod: 200,
      },
      deployNetworking: true,
      logRetentionInDays: 90,
      logDailyQuotaGb: 5,
      paidPlans: {
        defenderForServers,
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
          summary: "Review the sanitized preview before any later execution phase.",
        },
      ],
      terraformBackend: {
        type: "azurerm",
        subscriptionId:
          planningInput.startupInput.subscriptions.prodSubscriptionId,
        resourceGroupName: "rg-terraform-state",
        storageAccountName: "stsslzfixture",
        containerName: "tfstate",
        keyPrefix: "phase-four",
      },
    },
    approval: null,
  };
  if (existingWorkspaceId) {
    const effectiveWorkspaceRegion =
      workspaceRegion ?? regionalPlan.selectedPrimary.region;
    const observedAt = "2026-08-08T10:00:00Z";
    const expiresAt = "2026-08-12T13:00:00Z";
    const evidence = (values) => {
      const item = { observedAt, expiresAt, ...values };
      item.evidenceDigest = defenderEvidenceDigest(item);
      return item;
    };
    input.deployment.defenderWorkspacePlacement =
      buildDefenderWorkspaceDecision({
        decisionId: `workspace.${input.planId}.prod`,
        generatedAt: observedAt,
        expiresAt,
        planningAt: Date.parse(observedAt),
        tenantId: input.target.tenantId,
        subscriptionId:
          planningInput.startupInput.subscriptions.prodSubscriptionId,
        targetSubscriptionIds: input.target.environments.map(
          ({ subscriptionId }) => subscriptionId,
        ),
        primaryRegion: regionalPlan.selectedPrimary.region,
        paidPlans: input.deployment.paidPlans,
        placement: {
          mode: "existing",
          region: effectiveWorkspaceRegion,
          tenantId: input.target.tenantId,
          workspaceResourceId: existingWorkspaceId,
        },
        policyEvidence: evidence({
          tenantId: input.target.tenantId,
          targetSubscriptionIds: input.target.environments.map(
            ({ subscriptionId }) => subscriptionId,
          ),
          allowedLocations: [
            regionalPlan.selectedPrimary.region,
            effectiveWorkspaceRegion,
          ],
        }),
        serviceSupportEvidence: evidence({
          supportedRegions: [
            regionalPlan.selectedPrimary.region,
            effectiveWorkspaceRegion,
          ],
        }),
        dataResidencyEvidence: evidence({
          tenantId: input.target.tenantId,
          targetSubscriptionIds: input.target.environments.map(
            ({ subscriptionId }) => subscriptionId,
          ),
          allowedRegions: [
            regionalPlan.selectedPrimary.region,
            effectiveWorkspaceRegion,
          ],
        }),
        workspaceEvidence: evidence({
          tenantId: input.target.tenantId,
          subscriptionId:
            planningInput.startupInput.subscriptions.prodSubscriptionId,
          workspaceResourceId: existingWorkspaceId,
          location: effectiveWorkspaceRegion,
          provisioningState: "Succeeded",
        }),
        centralWorkspaceEvidence: evidence({
          tenantId: input.target.tenantId,
          subscriptionId:
            planningInput.startupInput.subscriptions.prodSubscriptionId,
          workspaceReferenceDigest: defenderWorkspaceDigest(
            existingWorkspaceId.toLowerCase(),
          ),
          targetSubscriptionIds: input.target.environments
            .map(({ subscriptionId }) => subscriptionId)
            .sort(),
        }),
      });
  }
  input.readinessEvidence = buildReadinessEvidence(input);
  return input;
}

function parseLiteral(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith("[")) {
    return [...trimmed.matchAll(/'((?:''|[^'])*)'/g)].map((match) =>
      match[1].replaceAll("''", "'"),
    );
  }
  if (trimmed === "true" || trimmed === "false") {
    return trimmed === "true";
  }
  return Number(trimmed);
}

function parseBicepParameters(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter((line) => line.startsWith("param "))
      .map((line) => {
        const match = line.match(/^param ([A-Za-z0-9]+) = (.+)$/);
        assert(match, line);
        return [match[1], parseLiteral(match[2])];
      }),
  );
}

function parseTerraformVariables(content) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const match = line.match(/^([a-z0-9_]+) = (.+)$/);
        assert(match, line);
        return [match[1], JSON.parse(match[2])];
      }),
  );
}

function snakeToCamel(name) {
  return name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map(reverseObjectKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
}

function assertDigestChanges(base, mutate, label) {
  const changed = structuredClone(base);
  mutate(changed);
  assert.notEqual(planDigest(base), planDigest(changed), label);
}

try {
  if (process.platform === "win32") {
    const invocation = azureCliInvocation(["version", "--output", "none"]);
    const execution = spawnSync(invocation.executable, invocation.arguments, {
      cwd: root,
      encoding: "utf8",
      shell: false,
    });
    assert.equal(execution.status, 0, execution.stderr);
  }
  const input = createInput();
  const first = generateIacPlan(input, {
    outputPath: outputRelative,
    previewFixtures: successFixture,
  });
  validateDocument(summarySchema, first);
  assert.match(first.planDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.artifacts.length, 6);
  assert.equal(first.previews.length, 6);
  assert(
    first.previews
      .filter((preview) => preview.regionRole === "primary")
      .every((preview) => preview.status === "succeeded"),
  );
  assert(
    first.previews
      .filter((preview) => preview.regionRole === "secondary")
      .every((preview) => preview.status === "representation-only"),
  );
  assert(first.previews.every((preview) => preview.rawArtifact === null));
  assert.equal(first.approval.status, "pending");
  assert.equal(
    first.decisionModel.postgresql.decisionDigest,
    input.postgresqlPlan.decisionDigest,
  );

  const omittedPostgresql = structuredClone(input);
  delete omittedPostgresql.postgresqlPlan;
  assert.throws(
    () =>
      generateIacPlan(omittedPostgresql, {
        outputPath: `${outputRelative}-postgresql-omitted`,
        previewFixtures: successFixture,
      }),
    /PostgreSQL profile requires a deterministic regional decision/,
  );

  const mutatedPostgresql = structuredClone(input);
  mutatedPostgresql.postgresqlPlan.providerParameters.bicep.version = "15.8";
  assert.throws(
    () =>
      generateIacPlan(mutatedPostgresql, {
        outputPath: `${outputRelative}-postgresql-mutated`,
        previewFixtures: successFixture,
      }),
    /PostgreSQL regional decision digest does not match/,
  );

  const stalePostgresql = structuredClone(input);
  const staleCandidate = stalePostgresql.postgresqlPlan.candidates.find(
    ({ region }) => region === stalePostgresql.postgresqlPlan.selectedRegion,
  );
  staleCandidate.evidence.source.expiresAt = "2026-08-09T11:59:59Z";
  staleCandidate.evidenceDigest = postgresqlDecisionDigest(
    staleCandidate.evidence,
  );
  stalePostgresql.postgresqlPlan.selectedEvidenceDigest =
    staleCandidate.evidenceDigest;
  const stalePayload = Object.fromEntries(
    Object.entries(stalePostgresql.postgresqlPlan).filter(
      ([key]) => key !== "decisionDigest",
    ),
  );
  stalePostgresql.postgresqlPlan.decisionDigest =
    postgresqlDecisionDigest(stalePayload);
  stalePostgresql.readinessEvidence = buildReadinessEvidence(stalePostgresql);
  assert.throws(
    () =>
      generateIacPlan(stalePostgresql, {
        outputPath: `${outputRelative}-postgresql-stale`,
        previewFixtures: successFixture,
        evaluatedAt: Date.parse("2026-08-09T12:00:00Z"),
      }),
    (error) => {
      assert.equal(error.code, "readiness.evidence.stale");
      assert.equal(error.checkId, "readiness.postgresql.selection-current");
      assert.match(
        error.message,
        /PostgreSQL selected regional evidence is future-dated, stale, expired/,
      );
      return true;
    },
  );

  const targetMismatchedPostgresql = structuredClone(input);
  targetMismatchedPostgresql.readinessEvidence.codeEvidence.postgresql.selectedRegion =
    "centralus";
  targetMismatchedPostgresql.readinessEvidence.evidenceDigest =
    readinessEvidenceDigest(targetMismatchedPostgresql.readinessEvidence);
  assert.throws(
    () =>
      generateIacPlan(targetMismatchedPostgresql, {
        outputPath: `${outputRelative}-postgresql-target-mismatch`,
        previewFixtures: successFixture,
      }),
    /PostgreSQL readiness binding does not match/,
  );

  const failedRuntimeCheckPostgresql = structuredClone(input);
  const selectedPostgresqlCandidate =
    failedRuntimeCheckPostgresql.postgresqlPlan.candidates.find(
      ({ region }) =>
        region === failedRuntimeCheckPostgresql.postgresqlPlan.selectedRegion,
    );
  selectedPostgresqlCandidate.checks.find(
    ({ id }) => id === "workload.postgresql.provider-parity",
  ).classification = "fail";
  const failedCheckPayload = Object.fromEntries(
    Object.entries(failedRuntimeCheckPostgresql.postgresqlPlan).filter(
      ([key]) => key !== "decisionDigest",
    ),
  );
  failedRuntimeCheckPostgresql.postgresqlPlan.decisionDigest =
    postgresqlDecisionDigest(failedCheckPayload);
  failedRuntimeCheckPostgresql.readinessEvidence = buildReadinessEvidence(
    failedRuntimeCheckPostgresql,
  );
  assert.throws(
    () =>
      generateIacPlan(failedRuntimeCheckPostgresql, {
        outputPath: `${outputRelative}-postgresql-runtime-check-failed`,
        previewFixtures: successFixture,
      }),
    /does not emit a passing runtime result for every required catalog check/,
  );

  const alternateInput = structuredClone(input);
  const originalPrimary = alternateInput.regionalPlan.selectedPrimary;
  alternateInput.regionalPlan.selectedPrimary =
    alternateInput.regionalPlan.secondaryRecommendation;
  alternateInput.regionalPlan.secondaryRecommendation = originalPrimary;
  const primaryAttempt = (
    environment,
    provider,
    character,
    regionalEvidenceDigest = input.readinessEvidence.evidenceDigest,
  ) =>
    createRegionalAttempt({
      chainId: input.planId,
      planId: input.planId,
      originalRegion: originalPrimary.region,
      targetRegion: originalPrimary.region,
      attemptNumber: 1,
      provider,
      environment,
      backendKeyPrefix: input.deployment.terraformBackend.keyPrefix,
      regionalEvidenceDigest,
      planDigest: first.planDigest,
      artifactDigest: `sha256:${character.repeat(64)}`,
      manifestDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      approvalDigest:
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      createdAt: "2026-08-08T10:00:00Z",
    });
  const cleanedAttempt = (
    environment,
    provider,
    character,
    regionalEvidenceDigest,
  ) => {
    const attempt = primaryAttempt(
      environment,
      provider,
      character,
      regionalEvidenceDigest,
    );
    const failedPrimaryAttempt = recordAttemptFailure(
      recordAttemptStarted(attempt, "2026-08-08T10:01:00Z"),
      {
        code: "deployment.execution.failed",
        summary: `Synthetic ${environment} primary failure.`,
        diagnostics: { status: "failed" },
        occurredAt: "2026-08-08T10:02:00Z",
      },
    );
    return recordCleanupOutcome(failedPrimaryAttempt, {
      succeeded: true,
      evidenceDigest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      occurredAt: "2026-08-08T10:03:00Z",
      summary: "Synthetic bounded cleanup completed.",
    });
  };
  const cleanedProdAttempt = cleanedAttempt("prod", "terraform", "a");
  const cleanedNonprodAttempt = cleanedAttempt("nonprod", "bicep", "e");
  alternateInput.regionalAttempt = {
    chainId: input.planId,
    attemptNumber: 2,
    originalRegion: originalPrimary.region,
    targetRegion: alternateInput.regionalPlan.selectedPrimary.region,
    previousAttempts: {
      prod: cleanedProdAttempt,
      nonprod: cleanedNonprodAttempt,
    },
    safeSameRegionRetry: false,
  };
  delete alternateInput.deployment.defenderWorkspacePlacement;
  alternateInput.readinessEvidence = buildReadinessEvidence(alternateInput);
  const staleRegionEvidenceRetry = structuredClone(alternateInput);
  staleRegionEvidenceRetry.readinessEvidence = structuredClone(
    input.readinessEvidence,
  );
  assert.throws(
    () =>
      generateIacPlan(staleRegionEvidenceRetry, {
        outputPath: `${outputRelative}-stale-region-evidence`,
        previewFixtures: successFixture,
      }),
    /exact plan, target, profiles, and regions|selected regional scope|target region/i,
  );
  const reusedRegionalDigestRetry = structuredClone(alternateInput);
  reusedRegionalDigestRetry.regionalAttempt.previousAttempts = {
    prod: cleanedAttempt(
      "prod",
      "terraform",
      "a",
      alternateInput.readinessEvidence.evidenceDigest,
    ),
    nonprod: cleanedAttempt(
      "nonprod",
      "bicep",
      "e",
      alternateInput.readinessEvidence.evidenceDigest,
    ),
  };
  assert.throws(
    () =>
      generateIacPlan(reusedRegionalDigestRetry, {
        outputPath: `${outputRelative}-reused-regional-evidence`,
        previewFixtures: successFixture,
      }),
    /cannot reuse the prior regionalEvidenceDigest/,
  );
  const alternate = generateIacPlan(alternateInput, {
    outputPath: `${outputRelative}-alternate`,
    previewFixtures: successFixture,
  });
  const alternateBicep = alternate.artifacts.find(
    (artifact) =>
      artifact.provider === "bicep" &&
      artifact.environment === "prod" &&
      artifact.regionRole === "primary",
  );
  const alternateTerraform = alternate.artifacts.find(
    (artifact) =>
      artifact.provider === "terraform" &&
      artifact.environment === "prod" &&
      artifact.regionRole === "primary",
  );
  const alternateBicepParameters = parseBicepParameters(
    readFileSync(resolve(root, alternateBicep.path), "utf8"),
  );
  const alternateTerraformParameters = parseTerraformVariables(
    readFileSync(resolve(root, alternateTerraform.path), "utf8"),
  );
  assert.equal(alternate.decisionModel.regionalAttempt.attemptNumber, 2);
  assert.match(alternateBicep.path, /a02-[a-z0-9]+-[0-9a-f]{10}/);
  assert.equal(
    alternateTerraform.stateKey,
    first.artifacts.find(
      (artifact) =>
        artifact.provider === "terraform" &&
        artifact.environment === "prod" &&
        artifact.regionRole === "primary",
    ).stateKey,
  );
  assert.match(
    alternate.decisionModel.regionalAttempt.previousAttemptKeys.prod,
    /^a01-/,
  );
  assert.match(alternateBicepParameters.regionalAttemptSuffix, /^-a02-/);
  assert.match(alternateBicepParameters.policyAssignmentPrefix, /^a02-.*-$/);
  assert.equal(
    alternateTerraformParameters.regional_attempt_suffix,
    alternateBicepParameters.regionalAttemptSuffix,
  );
  assert.equal(
    alternateTerraformParameters.policy_assignment_prefix,
    alternateBicepParameters.policyAssignmentPrefix,
  );
  assert.notEqual(alternate.planDigest, first.planDigest);
  const nonterminalRetry = structuredClone(alternateInput);
  nonterminalRetry.regionalAttempt.previousAttempts.prod = primaryAttempt(
    "prod",
    "terraform",
    "a",
  );
  assert.throws(
    () =>
      generateIacPlan(nonterminalRetry, {
        outputPath: `${outputRelative}-nonterminal-retry`,
      }),
    /predecessor must be terminal and retryable/,
  );
  const switchedStateRetry = structuredClone(alternateInput);
  switchedStateRetry.deployment.terraformBackend.keyPrefix = "replacement-state";
  assert.throws(
    () =>
      generateIacPlan(switchedStateRetry, {
        outputPath: `${outputRelative}-switched-state`,
      }),
    /predecessor chain does not match/,
  );

  const primaryBicep = first.artifacts.find(
    (artifact) =>
      artifact.provider === "bicep" &&
      artifact.environment === "prod" &&
      artifact.regionRole === "primary",
  );
  const primaryTerraform = first.artifacts.find(
    (artifact) =>
      artifact.provider === "terraform" &&
      artifact.environment === "prod" &&
      artifact.regionRole === "primary",
  );
  const bicepParameters = parseBicepParameters(
    readFileSync(resolve(root, primaryBicep.path), "utf8"),
  );
  const terraformParameters = parseTerraformVariables(
    readFileSync(resolve(root, primaryTerraform.path), "utf8"),
  );
  const terraformSubscriptionId = terraformParameters.subscription_id;
  delete terraformParameters.subscription_id;
  assert.equal(terraformParameters.resource_provider_registrations, "none");
  assert.deepEqual(terraformParameters.resource_providers_to_register, []);
  delete terraformParameters.resource_provider_registrations;
  delete terraformParameters.resource_providers_to_register;
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(terraformParameters).map(([name, value]) => [
        snakeToCamel(name),
        value,
      ]),
    ),
    bicepParameters,
    "Bicep and Terraform parameter files must represent equivalent decisions",
  );
  assert.equal(
    terraformSubscriptionId,
    first.decisionModel.target.environments.find(
      (environment) => environment.name === "prod",
    ).subscriptionId,
  );
  assert.equal(bicepParameters.configureDefenderWorkspace, true);
  assert.equal(bicepParameters.logAnalyticsWorkspaceLocation, "eastus2");
  assert.equal(bicepParameters.existingLogAnalyticsWorkspaceId, "");

  const existingWorkspaceId =
    `/subscriptions/${terraformSubscriptionId}` +
    "/resourceGroups/rg-shared-monitoring/providers/" +
    "Microsoft.OperationalInsights/workspaces/law-approved-centralus";
  const existingPlan = generateIacPlan(
    createInput({
      existingWorkspaceId,
      workspaceRegion: "centralus",
      oneSubscription: true,
    }),
    {
      providers: ["bicep", "terraform"],
      outputPath: `${outputRelative}/existing-workspace`,
      previewFixtures: successFixture,
    },
  );
  const existingBicep = parseBicepParameters(
    readFileSync(
      resolve(
        root,
        existingPlan.artifacts.find(
          (artifact) =>
            artifact.provider === "bicep" &&
            artifact.environment === "prod" &&
            artifact.regionRole === "primary",
        ).path,
      ),
      "utf8",
    ),
  );
  const existingTerraform = parseTerraformVariables(
    readFileSync(
      resolve(
        root,
        existingPlan.artifacts.find(
          (artifact) =>
            artifact.provider === "terraform" &&
            artifact.environment === "prod" &&
            artifact.regionRole === "primary",
        ).path,
      ),
      "utf8",
    ),
  );
  assert.equal(existingPlan.decisionModel.defenderWorkspace.mode, "existing");
  assert.equal(
    existingBicep.existingLogAnalyticsWorkspaceId,
    existingWorkspaceId.toLowerCase(),
  );
  assert.equal(
    existingTerraform.existing_log_analytics_workspace_id,
    existingWorkspaceId.toLowerCase(),
  );
  assert.equal(existingBicep.configureDefenderWorkspace, true);
  assert.equal(existingTerraform.configure_defender_workspace, true);
  assert.equal(existingBicep.logAnalyticsWorkspaceLocation, "centralus");
  assert.deepEqual(existingBicep.allowedLocations, ["centralus", "eastus2"]);
  assert.deepEqual(existingTerraform.allowed_locations, [
    "centralus",
    "eastus2",
  ]);
  const existingNonprodBicep = parseBicepParameters(
    readFileSync(
      resolve(
        root,
        existingPlan.artifacts.find(
          (artifact) =>
            artifact.provider === "bicep" &&
            artifact.environment === "nonprod" &&
            artifact.regionRole === "primary",
        ).path,
      ),
      "utf8",
    ),
  );
  const existingNonprodTerraform = parseTerraformVariables(
    readFileSync(
      resolve(
        root,
        existingPlan.artifacts.find(
          (artifact) =>
            artifact.provider === "terraform" &&
            artifact.environment === "nonprod" &&
            artifact.regionRole === "primary",
        ).path,
      ),
      "utf8",
    ),
  );
  assert.equal(existingBicep.configureDefenderWorkspace, true);
  assert.equal(
    existingBicep.defenderWorkspaceAssociationManagedExternally,
    false,
  );
  assert.equal(existingBicep.defenderWorkspaceSharedSubscription, true);
  assert.equal(existingNonprodBicep.configureDefenderWorkspace, false);
  assert.equal(
    existingNonprodBicep.defenderWorkspaceAssociationManagedExternally,
    true,
  );
  assert.equal(existingNonprodBicep.defenderWorkspaceSharedSubscription, true);
  assert.equal(existingTerraform.configure_defender_workspace, true);
  assert.equal(
    existingTerraform.defender_workspace_association_managed_externally,
    false,
  );
  assert.equal(
    existingTerraform.defender_workspace_shared_subscription,
    true,
  );
  assert.equal(
    existingNonprodTerraform.configure_defender_workspace,
    false,
  );
  assert.equal(
    existingNonprodTerraform.defender_workspace_association_managed_externally,
    true,
  );
  assert.equal(
    existingNonprodTerraform.defender_workspace_shared_subscription,
    true,
  );

  assert.throws(
    () =>
      generateIacPlan(createInput({ oneSubscription: true }), {
        providers: ["bicep", "terraform"],
        outputPath: `${outputRelative}/shared-subscription-new-workspace`,
        previewFixtures: successFixture,
      }),
    /requires one approved existing Defender workspace/,
  );

  const disabledPlan = generateIacPlan(
    createInput({ defenderForServers: false }),
    {
      providers: ["bicep", "terraform"],
      outputPath: `${outputRelative}/defender-disabled`,
      previewFixtures: successFixture,
    },
  );
  const disabledBicep = parseBicepParameters(
    readFileSync(
      resolve(
        root,
        disabledPlan.artifacts.find(
          (artifact) =>
            artifact.provider === "bicep" &&
            artifact.environment === "prod" &&
            artifact.regionRole === "primary",
        ).path,
      ),
      "utf8",
    ),
  );
  assert.equal(disabledPlan.decisionModel.defenderWorkspace.status, "not-required");
  assert.equal(disabledBicep.configureDefenderWorkspace, false);
  assert.equal(disabledBicep.existingLogAnalyticsWorkspaceId, "");
  const realContacts = {
    budgetAlertEmails: ["cloud-operations@contoso.example"],
    securityContactEmail: "security-operations@contoso.example",
  };
  const contactPlan = generateIacPlan(input, {
    providers: ["bicep", "terraform"],
    outputPath: `${outputRelative}/real-contacts`,
    previewFixtures: successFixture,
    notificationContacts: realContacts,
  });
  const contactBicep = readFileSync(
    resolve(
      root,
      contactPlan.artifacts.find(
        (artifact) =>
          artifact.provider === "bicep" &&
          artifact.environment === "prod" &&
          artifact.regionRole === "primary",
      ).path,
    ),
    "utf8",
  );
  const contactTerraform = readFileSync(
    resolve(
      root,
      contactPlan.artifacts.find(
        (artifact) =>
          artifact.provider === "terraform" &&
          artifact.environment === "prod" &&
          artifact.regionRole === "primary",
      ).path,
    ),
    "utf8",
  );
  assert.match(contactBicep, /cloud-operations@contoso\.example/);
  assert.match(contactTerraform, /security-operations@contoso\.example/);
  assert.doesNotMatch(
    JSON.stringify(contactPlan),
    /cloud-operations@|security-operations@/,
  );
  assert.throws(
    () =>
      generateIacPlan(input, {
        providers: ["bicep", "terraform"],
        outputPath: `${outputRelative}/real-contacts`,
        previewFixtures: successFixture,
      }),
    /Refusing to mutate an existing generated artifact/,
  );

  const bicepParameterNames = new Set(Object.keys(bicepParameters));
  const declaredBicepParameters = new Set(
    [...readFileSync(resolve(root, "infra/bicep/main.bicep"), "utf8").matchAll(
      /^param ([A-Za-z0-9]+)\b/gm,
    )].map((match) => match[1]),
  );
  for (const name of bicepParameterNames) {
    assert(declaredBicepParameters.has(name), `Unknown Bicep parameter: ${name}`);
  }

  const declaredTerraformVariables = new Set(
    [...readFileSync(resolve(root, "infra/terraform/variables.tf"), "utf8").matchAll(
      /^variable "([^"]+)"/gm,
    )].map((match) => match[1]),
  );
  for (const name of Object.keys(parseTerraformVariables(
    readFileSync(resolve(root, primaryTerraform.path), "utf8"),
  ))) {
    assert(declaredTerraformVariables.has(name), `Unknown Terraform variable: ${name}`);
  }

  const decisionModel = buildDecisionModel(input);
  assert.equal(
    planDigest(decisionModel),
    planDigest(reverseObjectKeys(decisionModel)),
    "Object key ordering must not change the digest",
  );
  assert.equal(canonicalJson(decisionModel), canonicalJson(reverseObjectKeys(decisionModel)));

  assertDigestChanges(
    decisionModel,
    (model) => {
      model.target.environments[0].subscriptionId =
        "44444444-4444-4444-4444-444444444444";
    },
    "subscription",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.target.tenantId = "55555555-5555-5555-5555-555555555555";
    },
    "tenant",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.regional.primary.region = "westus3";
    },
    "region",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.profile.computeProfile = "aks";
    },
    "profile",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.profile.profileExtensions.push("foundry");
    },
    "profile extensions",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.services[0].purpose = "changed service decision";
    },
    "services",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.paidPlans.defenderForContainers = true;
    },
    "paid plans",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.regional.mode = "warm-workload";
    },
    "regional mode",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.costAssumptions.regional.selectedPrimaryEstimate += 1;
    },
    "cost assumptions",
  );
  assertDigestChanges(
    decisionModel,
    (model) => {
      model.proposedActions[0].summary = "Changed action";
    },
    "proposed actions",
  );

  const approvedInput = structuredClone(input);
  approvedInput.approval = {
    status: "approved",
    planId: input.planId,
    planDigest: first.planDigest,
    approvedAt: "2026-08-08T20:00:00Z",
    expiresAt: "2026-08-09T20:00:00Z",
  };
  const approved = generateIacPlan(approvedInput, {
    outputPath: `${outputRelative}/approved`,
    providers: ["bicep"],
    evaluatedAt: Date.parse("2026-08-09T19:00:00Z"),
  });
  assert.equal(approved.approval.status, "approved");
  assert.equal(approved.approval.reapprovalRequired, false);

  const modifiedInput = structuredClone(approvedInput);
  modifiedInput.deployment.services[0].purpose = "modified purpose";
  const modified = generateIacPlan(modifiedInput, {
    outputPath: `${outputRelative}/modified`,
    providers: ["terraform"],
    evaluatedAt: Date.parse("2026-08-09T19:00:00Z"),
  });
  assert.notEqual(modified.planDigest, first.planDigest);
  assert.equal(modified.approval.status, "pending");
  assert.equal(modified.approval.reapprovalRequired, true);
  assert.equal(modified.approval.invalidationReason, "plan-digest-changed");

  const replaced = generateIacPlan(modifiedInput, {
    outputPath: outputRelative,
    providers: ["bicep", "terraform"],
    evaluatedAt: Date.parse("2026-08-09T19:00:00Z"),
  });
  assert.equal(
    JSON.parse(
      readFileSync(
        resolve(
          root,
          outputRelative,
          replaced.planId,
          `a${String(replaced.decisionModel.regionalAttempt.attemptNumber).padStart(2, "0")}-` +
            `${replaced.decisionModel.regionalAttempt.targetRegion}-` +
            replaced.planDigest.slice("sha256:".length, "sha256:".length + 10),
          "plan-summary.json",
        ),
        "utf8",
      ),
    ).planDigest,
    replaced.planDigest,
    "A generated summary must be scoped to the exact attempt and plan digest",
  );

  const expiredInput = structuredClone(approvedInput);
  expiredInput.approval.expiresAt = "2026-08-08T20:30:00Z";
  const expired = generateIacPlan(expiredInput, {
    outputPath: `${outputRelative}/expired`,
    providers: ["bicep"],
    evaluatedAt: Date.parse("2026-08-08T20:31:00Z"),
  });
  assert.equal(expired.approval.status, "pending");
  assert.equal(expired.approval.invalidationReason, "approval-expired");

  const singleRegion = generateIacPlan(
    createInput({ regionalMode: "single-region-ready" }),
    {
      outputPath: `${outputRelative}/single`,
      providers: ["bicep", "terraform"],
    },
  );
  assert.equal(singleRegion.artifacts.length, 4);
  assert(singleRegion.artifacts.every((artifact) => artifact.regionRole === "primary"));

  const sensitive = structuredClone(input);
  sensitive.deployment.proposedActions[0].summary =
    "Send fixture token to founder@example.com.";
  assert.throws(
    () =>
      generateIacPlan(sensitive, {
        outputPath: `${outputRelative}/sensitive`,
      }),
    /Sensitive input value/,
  );
  const sasSensitive = structuredClone(input);
  sasSensitive.deployment.proposedActions[0].summary =
    "Inspect https://storage.example.invalid/file?sv=1&sig=fixture-value.";
  assert.throws(
    () =>
      generateIacPlan(sasSensitive, {
        outputPath: `${outputRelative}/sas-sensitive`,
      }),
    /Sensitive input value/,
  );
  assert.doesNotMatch(
    JSON.stringify(failureFixture),
    /this-pattern-is-intentionally-absent/,
  );
  const failed = generateIacPlan(input, {
    outputPath: `${outputRelative}/failure`,
    previewFixtures: failureFixture,
  });
  assert(
    failed.previews
      .filter((preview) => preview.regionRole === "primary")
      .every((preview) => preview.status === "failed"),
  );
  assert(
    failed.previews
      .filter((preview) => preview.regionRole === "secondary")
      .every((preview) => preview.status === "representation-only"),
  );
  const failedText = JSON.stringify(failed);
  assert.doesNotMatch(failedText, /fixture-secret|fixture-token|founder@/i);

  assert.deepEqual(
    summarizePreview("bicep", {
      status: 0,
      stdout: "Create: 1 Modify: 0 Delete: 2",
      stderr: "",
    }),
    {
      status: "blocked",
      changes: { create: 1, modify: 0, remove: 2 },
      destructiveChanges: true,
      errorClass: null,
      message: "Preview contains destructive changes and is blocked for review.",
    },
  );
  assert.deepEqual(
    summarizePreview("terraform", {
      status: 0,
      stdout: "Plan: 8 to import, 0 to add, 0 to change, 2 to destroy.",
      stderr: "",
    }),
    {
      status: "blocked",
      changes: { create: 0, modify: 0, remove: 2 },
      destructiveChanges: true,
      errorClass: null,
      message: "Preview contains destructive changes and is blocked for review.",
    },
  );
  assert.equal(
    summarizePreview("terraform", {
      status: 0,
      stdout: "Terraform returned an unfamiliar successful response.",
      stderr: "",
    }).status,
    "failed",
    "Unclassified successful preview output must fail closed",
  );

  const mismatchedWorkload = structuredClone(input);
  mismatchedWorkload.regionalPlan.workloadSelection.computeProfile = "aks";
  assert.throws(
    () =>
      generateIacPlan(mismatchedWorkload, {
        outputPath: `${outputRelative}/mismatched-workload`,
      }),
    /different workload selection/,
  );
  const overlappingRegions = structuredClone(input);
  overlappingRegions.regionalPlan.secondaryRecommendation.proposedVnetCidr =
    overlappingRegions.regionalPlan.selectedPrimary.proposedVnetCidr;
  assert.throws(
    () =>
      generateIacPlan(overlappingRegions, {
        outputPath: `${outputRelative}/overlapping-regions`,
      }),
    /must not overlap/,
  );

  assert.throws(
    () => generateIacPlan(input, { outputPath: "../outside" }),
    /must stay under/,
  );
  assert.throws(
    () =>
      generateIacPlan(input, {
        outputPath: `${outputRelative}/raw-traversal`,
        rawArtifactPath: "../raw",
      }),
    /must stay under/,
  );
  const localBackend = structuredClone(input);
  localBackend.deployment.terraformBackend.type = "local";
  assert.throws(
    () =>
      generateIacPlan(localBackend, {
        outputPath: `${outputRelative}/local-backend`,
      }),
    /expected constant "azurerm"/,
  );
  const invalidBackendSubscription = structuredClone(input);
  invalidBackendSubscription.deployment.terraformBackend.subscriptionId =
    "not-a-subscription";
  assert.throws(
    () =>
      generateIacPlan(invalidBackendSubscription, {
        outputPath: `${outputRelative}/invalid-backend-subscription`,
      }),
    /does not match/,
  );
  const missingV2BackendSubscription = structuredClone(input);
  delete missingV2BackendSubscription.deployment.terraformBackend
    .subscriptionId;
  assert.throws(
    () =>
      generateIacPlan(missingV2BackendSubscription, {
        outputPath: `${outputRelative}/missing-v2-backend-subscription`,
      }),
    /missing required property subscriptionId/,
  );
  const legacyInput = structuredClone(input);
  legacyInput.schemaVersion = "1.0.0";
  delete legacyInput.readinessEvidence;
  delete legacyInput.deployment.terraformBackend.subscriptionId;
  const legacyPlan = generateIacPlan(legacyInput, {
    providers: ["terraform"],
    outputPath: `${outputRelative}/legacy-v1`,
    previewFixtures: { terraform: successFixture },
  });
  assert.equal(
    Object.hasOwn(legacyPlan.decisionModel.terraformBackend, "subscriptionId"),
    false,
  );
  assert.equal(legacyPlan.inputContractVersion, "1.0.0");
  assert.equal(legacyPlan.approval.invalidationReason, "readiness-evidence-required");
  assert.equal(first.inputContractVersion, "3.0.0");
  const unsupported = structuredClone(input);
  unsupported.schemaVersion = "4.0.0";
  assert.throws(
    () =>
      generateIacPlan(unsupported, {
        outputPath: `${outputRelative}/unsupported`,
      }),
    /unsupported value "4.0.0"/,
  );
  const collisionDirectory = resolve(outputPath, "artifact-collision");
  mkdirSync(collisionDirectory, { recursive: true });
  const existingPlanJson = resolve(collisionDirectory, "reviewed.plan.json");
  writeFileSync(existingPlanJson, "reviewed-artifact", { mode: 0o600 });
  assert.throws(
    () =>
      assertArtifactDestinationsAvailable([
        resolve(collisionDirectory, "reviewed.tfplan"),
        existingPlanJson,
        resolve(collisionDirectory, "reviewed.provenance.json"),
      ]),
    /Refusing to overwrite an existing raw artifact/,
  );
  assert.equal(readFileSync(existingPlanJson, "utf8"), "reviewed-artifact");
  const existingPlanLog = resolve(collisionDirectory, "terraform-plan.txt");
  writeFileSync(existingPlanLog, "reviewed-log", { mode: 0o600 });
  const transactionPaths = [
    resolve(collisionDirectory, "transaction.tfplan"),
    resolve(collisionDirectory, "transaction.plan.json"),
    resolve(collisionDirectory, "transaction.provenance.json"),
  ];
  assert.throws(
    () =>
      writeExclusiveArtifacts([
        { path: transactionPaths[0], content: "plan" },
        { path: transactionPaths[1], content: "json" },
        { path: transactionPaths[2], content: "provenance" },
        { path: existingPlanLog, content: "new-log" },
      ]),
    /Refusing to overwrite an existing raw artifact/,
  );
  assert.equal(readFileSync(existingPlanLog, "utf8"), "reviewed-log");
  assert.equal(transactionPaths.some((path) => existsSync(path)), false);
  process.env.ARM_OIDC_REQUEST_TOKEN = "fixture-arm-token";
  process.env.ARM_OIDC_REQUEST_URL = "https://arm-token.example";
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "fixture-actions-token";
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://actions-token.example";
  const plannerCliEnvironment = sanitizedPlannerTerraformEnvironment(
    { TF_DATA_DIR: "safe-data" },
    "safe-cli-config",
    "cli",
  );
  assert.equal(plannerCliEnvironment.ARM_OIDC_REQUEST_TOKEN, undefined);
  assert.equal(plannerCliEnvironment.ARM_OIDC_REQUEST_URL, undefined);
  assert.equal(
    plannerCliEnvironment.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    undefined,
  );
  assert.equal(plannerCliEnvironment.ACTIONS_ID_TOKEN_REQUEST_URL, undefined);
  const plannerOidcEnvironment = sanitizedPlannerTerraformEnvironment(
    { TF_DATA_DIR: "safe-data" },
    "safe-cli-config",
    "oidc",
  );
  assert.equal(
    plannerOidcEnvironment.ARM_OIDC_REQUEST_TOKEN,
    "fixture-arm-token",
  );
  assert.equal(
    plannerOidcEnvironment.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    "fixture-actions-token",
  );
  assert.equal(plannerOidcEnvironment.TEMP, "safe-data");
  assert.equal(plannerOidcEnvironment.TMP, "safe-data");
  assert.equal(plannerOidcEnvironment.TMPDIR, "safe-data");
  delete process.env.ARM_OIDC_REQUEST_TOKEN;
  delete process.env.ARM_OIDC_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const unsupportedWorkload = structuredClone(input);
  unsupportedWorkload.workloadPlan.schemaVersion = "2.0.0";
  assert.throws(
    () =>
      generateIacPlan(unsupportedWorkload, {
        outputPath: `${outputRelative}/unsupported-workload`,
      }),
    /expected constant "1.0.0"/,
  );
  const unsupportedRegional = structuredClone(input);
  unsupportedRegional.regionalPlan.schemaVersion = "2.0.0";
  assert.throws(
    () =>
      generateIacPlan(unsupportedRegional, {
        outputPath: `${outputRelative}/unsupported-regional`,
      }),
    /expected constant "1.1.0"/,
  );
  const missing = structuredClone(input);
  delete missing.target;
  assert.throws(
    () =>
      generateIacPlan(missing, {
        outputPath: `${outputRelative}/missing`,
      }),
    /missing required property target/,
  );

  const reconciliationPath = `${outputRelative}/reconciliation`;
  const reconciledOriginal = generateIacPlan(input, {
    outputPath: reconciliationPath,
    providers: ["bicep", "terraform"],
  });
  const reconciledReplacement = generateIacPlan(
    createInput({ regionalMode: "single-region-ready" }),
    {
    outputPath: reconciliationPath,
    providers: ["bicep"],
    },
  );
  assert(
    reconciledOriginal.artifacts.every((artifact) =>
      existsSync(resolve(root, artifact.path)),
    ),
    "A later plan must not delete immutable predecessor artifacts",
  );
  assert(
    reconciledReplacement.artifacts.every((artifact) =>
      existsSync(resolve(root, artifact.path)),
    ),
    "The current attempt artifacts must be generated",
  );

  const protectedOutput = `${outputRelative}/protected`;
  const protectedArtifact = first.artifacts.find(
    (artifact) =>
      artifact.provider === "bicep" &&
      artifact.environment === "prod" &&
      artifact.regionRole === "primary",
  );
  const protectedFile = resolve(
    root,
    protectedOutput,
    protectedArtifact.path.slice(`${outputRelative}/`.length),
  );
  mkdirSync(dirname(protectedFile), { recursive: true });
  writeFileSync(protectedFile, "user-owned content\n");
  assert.throws(
    () =>
      generateIacPlan(input, {
        outputPath: protectedOutput,
        providers: ["bicep"],
      }),
    /Refusing to overwrite a non-generated file/,
  );

  for (const artifact of first.artifacts) {
    const ignored = spawnSync("git", ["check-ignore", "--quiet", artifact.path], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(ignored.status, 0, `${artifact.path} must be ignored by Git`);
  }
  const generatedStatus = spawnSync(
    "git",
    ["status", "--short", "--untracked-files=all", outputRelative],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(generatedStatus.stdout, "");

  const cliOutput = `${outputRelative}/cli`;
  const cli = spawnSync(
    process.execPath,
    [
      script,
      "generate",
      "--input",
      "-",
      "--provider",
      "both",
      "--output-dir",
      cliOutput,
    ],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(input),
    },
  );
  assert.equal(cli.status, 0, cli.stderr);
  const cliSummary = JSON.parse(cli.stdout);
  validateDocument(summarySchema, cliSummary);
  assert(cliSummary.previews.every((preview) =>
    ["not-run", "representation-only"].includes(preview.status),
  ));

  const completeMode = spawnSync(
    process.execPath,
    [script, "generate", "--input", "-", "--mode", "Complete"],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(input),
    },
  );
  assert.equal(completeMode.status, 2);
  assert.match(completeMode.stderr, /Unknown argument: --mode/);

  const writeCapableCommand = spawnSync(
    process.execPath,
    [script, "apply", "--input", "-"],
    {
      cwd: root,
      encoding: "utf8",
      input: JSON.stringify(input),
    },
  );
  assert.equal(writeCapableCommand.status, 2);
  assert.match(writeCapableCommand.stderr, /only supported command is generate/);

  const source = readFileSync(script, "utf8");
  assert.doesNotMatch(source, /\bterraform\s+apply\b/i);
  assert.doesNotMatch(source, /\bdeployment\s+(?:create|complete)\b/i);
  assert.doesNotMatch(source, /\bprovider\s+register\b|\brole\s+assignment\b/i);
  assert.match(source, /-backend-config=use_oidc=/);
  assert.match(source, /-backend-config=use_cli=/);
  assert.match(source, /-backend-config=subscription_id=/);
  assert.match(source, /-backend-config=use_azuread_auth=true/);

  console.log("Startup IaC planner fixture tests passed.");
} finally {
  rmSync(outputPath, { recursive: true, force: true });
}
