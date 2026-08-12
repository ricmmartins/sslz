import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  validateAksIngressDecision,
  validateAksIngressPostcheck,
} from "../scripts/aks-ingress-contract.mjs";
import {
  buildDefenderWorkspaceDecision,
  digest as defenderWorkspaceDigest,
  evidenceDigest as defenderEvidenceDigest,
} from "../scripts/defender-workspace-placement.mjs";
import {
  approvalSigningMessage,
  buildDeploymentManifest,
  keyFingerprint,
  validateApprovedAksIngressPostcheck,
} from "../scripts/startup-deployment-integration.mjs";
import {
  evaluateProfileGates,
  GATE_IDS as CONTAINER_APPS_GATE_IDS,
} from "../scripts/startup-container-apps-cool-plan.mjs";
import { generateIacPlan } from "../scripts/startup-iac-plan.mjs";
import { planPostgresql } from "../scripts/startup-postgresql-plan.mjs";
import {
  approvalDigest as providerApprovalDigest,
  runProviderRemediation,
} from "../scripts/startup-provider-remediation.mjs";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";
import {
  createRegionalAttempt,
  recordAttemptFailure,
  recordAttemptStarted,
  recordCleanupOutcome,
  replanRegionalAttempt,
} from "../scripts/regional-attempt.mjs";
import { buildReadinessEvidence } from "./readiness-fixture.mjs";

const root = resolve(import.meta.dirname, "..");
const generatedRelative = ".sslz/generated/greenfield-journey";
const generatedRoot = join(root, ".sslz", "generated", "greenfield-journey");
const fixedNow = "2026-08-11T18:00:00.000Z";
const fixedNowMs = Date.parse(fixedNow);
const syntheticPrivateKey = createPrivateKey({
  key: Buffer.from(
    "MC4CAQAwBQYDK2VwBCIEIPyRUPlvoMdRqX9i+lb0uhdZrlgzociQlYbp3f0Ea/jQ",
    "base64",
  ),
  format: "der",
  type: "pkcs8",
});
const syntheticPublicKey = createPublicKey(syntheticPrivateKey);

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function executeSyntheticPreflight(
  fixture = "az-one-subscription-missing-aks-provider.json",
  runId = "synthetic-greenfield-preflight",
) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "scripts", "startup-preflight.mjs"),
      "inspect",
      "--startup-subscription",
      "22222222-2222-2222-2222-222222222222",
      "--profile",
      "aks",
      "--profile",
      "postgresql",
      "--profile",
      "foundry",
      "--output",
      "json",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        AZURE_CLI_PATH: process.execPath,
        AZURE_CLI_PREFIX_ARGS: JSON.stringify([
          join(root, "tests", "mock-az.mjs"),
        ]),
        AZ_FIXTURE: fixture,
        PREFLIGHT_RUN_ID: runId,
        PREFLIGHT_GENERATED_AT: "2026-08-11T17:00:00.000Z",
      },
    },
  );
  assert(result.stdout, `Synthetic preflight produced no JSON: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function runSyntheticPreflight() {
  const preflight = executeSyntheticPreflight();
  assert(preflight.overallStatus === "blocked", "Fresh preflight must be blocked.");
  assert(
    preflight.topologyDecision.subscriptionTopology.selectionMode ===
      "one-subscription",
    "Fresh preflight must observe the one-subscription topology.",
  );
  assert(
    preflight.topologyDecision.benefitAssociation.state ===
      "credits-or-benefit-association-unknown",
    "Fresh preflight must retain billing and benefit uncertainty.",
  );
  const providers = preflight.checks.find(
    ({ id }) => id === "account.provider.required-registrations",
  );
  assert(
    providers?.evidence?.missingProviders?.some(
      ({ namespace }) => namespace === "Microsoft.ContainerService",
    ),
    "AKS preflight must detect missing Microsoft.ContainerService.",
  );
  return preflight;
}

function transition(blockerTransitions, checkId, from, to, evidenceDigest) {
  if (blockerTransitions.some((item) => item.checkId === checkId)) return;
  blockerTransitions.push({
    checkId,
    transitions: [
      { status: from, evidenceDigest: null },
      { status: to, evidenceDigest },
    ],
  });
}

function createJourneyOrchestrator() {
  const events = [];
  const blockedStatuses = new Set(["blocked", "fail", "rejected"]);
  const preparationCount = (journeyId) =>
    events.filter(
      (event) =>
        event.journeyId === journeyId &&
        event.type === "deployment-write-preparation",
    ).length;
  const sanitize = (message) =>
    String(message).replace(
      /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,
      "<redacted-id>",
    );

  return {
    prepare(journeyId, action) {
      events.push({ journeyId, type: "deployment-write-preparation" });
      return action();
    },
    expectBlocked(id, stage, expectedCheckId, action) {
      let outcome;
      let thrown;
      try {
        outcome = action();
      } catch (error) {
        thrown = error;
      }

      const emittedCheckId =
        thrown?.checkId ?? thrown?.code ?? outcome?.checkId ?? outcome?.code;
      const status = thrown ? "blocked" : outcome?.status;
      if (!thrown && !blockedStatuses.has(status)) {
        events.push({ journeyId: id, type: "deployment-write-preparation" });
        throw new Error(`${id} did not fail closed at ${stage}.`);
      }
      assert(
        emittedCheckId === expectedCheckId,
        `${id} emitted ${emittedCheckId ?? "no blocker ID"} instead of ${expectedCheckId}.`,
      );
      assert(
        preparationCount(id) === 0,
        `${id} reached deployment write preparation after its blocker.`,
      );
      return {
        id,
        status: "blocked",
        failedAtStage: stage,
        blockerIds: [emittedCheckId],
        writePreparationEvents: preparationCount(id),
        diagnostic: sanitize(thrown?.message ?? outcome?.diagnostic),
      };
    },
    preparationCount,
  };
}

function buildPlanningPostcheck(aksDecision) {
  const postcheck = structuredClone(aksDecision.postcheck);
  const result = validateAksIngressPostcheck(
    postcheck,
    "planning",
    fixedNowMs,
    { expectedDecision: aksDecision },
  );
  assert(
    result.status === "planned" && result.liveConnectivityObserved === false,
    "Planning postcheck must remain explicitly not observed.",
  );
  return { ...postcheck, status: "not-observed" };
}

function buildSignedAcceptance(aksDecision, evidence) {
  const postcheck = {
    ...structuredClone(aksDecision.postcheck),
    decisionDigest: evidence.decisionDigest,
    observedHealthState: evidence.healthy ? "healthy" : "unhealthy",
    observedReachability: evidence.reachable ? "reachable" : "unreachable",
    observedAt: evidence.observedAt,
    expiresAt: "2026-08-11T18:10:00.000Z",
    evidenceReference: "synthetic-observation-alias",
    liveConnectivityClaimed: true,
  };
  const validation = validateAksIngressPostcheck(
    postcheck,
    "acceptance",
    fixedNowMs,
    { expectedDecision: aksDecision },
  );
  assert(validation.status === "observed", "AKS acceptance must be observed.");
  const evidenceDigest = digest(postcheck);
  const approval = {
    schemaVersion: "1.0.0",
    approvalId: "synthetic-observed-acceptance",
    decisionDigest: aksDecision.decisionDigest,
    evidenceDigest,
    approvedAt: fixedNow,
  };
  const signature = sign(
    null,
    Buffer.from(canonicalize(approval)),
    syntheticPrivateKey,
  ).toString("base64");
  return {
    status: "pass",
    postcheck,
    liveConnectivityClaimed: true,
    observedAt: postcheck.observedAt,
    evidenceDigest,
    approvalDigest: digest(approval),
    signatureAlgorithm: "Ed25519",
    signature,
    publicKeyFingerprint: digest(
      syntheticPublicKey.export({ type: "spki", format: "der" }).toString("base64"),
    ),
  };
}

function locatePlanSummary(artifactPath) {
  const planRoot = resolve(root, dirname(dirname(dirname(artifactPath))));
  const candidates = readdirSync(planRoot)
    .map((entry) => resolve(planRoot, entry, "plan-summary.json"))
    .filter((path) => existsSync(path));
  assert(
    candidates.length === 1,
    "exactly one generated plan summary is required",
  );
  return candidates[0];
}

function deploymentPreviewRunner(executable, args, target) {
  if (executable === "bicep") {
    const bicepExecutable = resolve(
      homedir(),
      ".azure",
      "bin",
      process.platform === "win32" ? "bicep.exe" : "bicep",
    );
    return spawnSync(bicepExecutable, args, {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  if (
    executable === "az" &&
    args[0] === "deployment" &&
    args[2] === "what-if"
  ) {
    const parameterPath = args.find(
      (argument) =>
        typeof argument === "string" && argument.endsWith(".bicepparam"),
    );
    const suffix =
      /param regionalAttemptSuffix = '([^']+)'/.exec(
        readFileSync(parameterPath, "utf8"),
      )?.[1] ?? "";
    const resourceGroup = `rg-contoso-prod${suffix}-networking`;
    return {
      status: 0,
      stdout: JSON.stringify({
        changes: [
          {
            changeType: "Create",
            resourceId: `/subscriptions/${target.subscriptionId}/resourceGroups/${resourceGroup}`,
          },
          {
            changeType: "Modify",
            resourceId: `/subscriptions/${target.subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkSecurityGroups/nsg-contoso-prod${suffix}-aks`,
          },
        ],
      }),
      stderr: "",
    };
  }
  throw new Error(`Unexpected deployment preparation command: ${executable}`);
}

function buildDeploymentApproval(manifest) {
  const approval = {
    schemaVersion: "1.0.0",
    status: "approved",
    manifestVersion: manifest.manifestVersion,
    manifestDigest: manifest.manifestDigest,
    planVersion: manifest.plan.version,
    planId: manifest.plan.id,
    planDigest: manifest.plan.digest,
    regionalAttemptId: manifest.regionalAttempt.attemptId,
    regionalAttemptDigest: digest(manifest.regionalAttempt),
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
    topologyDecisionExpiresAt: manifest.readinessEvidence.topologyDecisionExpiresAt,
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
    aksIngressMode: manifest.aksIngress.mode,
    aksIngressDecisionDigest: manifest.aksIngress.decisionDigest,
    aksIngressPostcheckDigest: manifest.aksIngress.postcheckDigest,
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
    nonce: "c".repeat(64),
    approvedAt: "2026-08-11T17:30:00Z",
    expiresAt: "2026-08-11T18:20:00Z",
    signatureAlgorithm: "Ed25519",
    keyId: keyFingerprint(syntheticPublicKey),
  };
  approval.signature = sign(
    null,
    approvalSigningMessage(approval),
    syntheticPrivateKey,
  ).toString("base64");
  assert(
    verify(
      null,
      approvalSigningMessage(approval),
      syntheticPublicKey,
      Buffer.from(approval.signature, "base64"),
    ),
    "Synthetic deployment approval signature must verify before validation.",
  );
  return approval;
}

function resignDeploymentApproval(approval, overrides) {
  const updated = { ...approval, ...overrides };
  delete updated.signature;
  updated.signature = sign(
    null,
    approvalSigningMessage(updated),
    syntheticPrivateKey,
  ).toString("base64");
  return updated;
}

function syntheticRegionalInput() {
  const input = readJson(
    join(root, "agent", "examples", "regional-planning-input.json"),
  );
  input.planningAt = fixedNow;
  input.startupInput.workload.requiresKubernetes = true;
  input.startupInput.workload.kubernetesRequirements = ["operator"];
  input.startupInput.workload.requiresRelationalDatabase = true;
  input.startupInput.workload.usesFoundryModels = true;
  input.startupInput.workload.managedModelFit = "yes";
  input.startupInput.workload.aksIngress = readJson(
    join(root, "agent", "examples", "aks-ingress-public.json"),
  );
  input.startupInput.reliability.rtoMinutes = 60;
  input.startupInput.reliability.rpoMinutes = 15;
  input.regionalRequirements.computeSku = "Standard_D4s_v5";
  input.regionalRequirements.foundry = {
    model: "gpt-4.1",
    deploymentType: "GlobalStandard",
  };
  for (const region of input.evidence.regions) {
    region.observedAt = "2026-08-11T17:00:00Z";
    region.capacity.observedAt = "2026-08-11T17:05:00Z";
    if (region.region === "eastus2") {
      region.allowedByPolicy = false;
    }
  }
  input.workloadPlan = planWorkload(input.startupInput);
  return input;
}

function syntheticDefenderDecision({
  allowedLocations = ["centralus"],
  expectedStatus = "ready",
} = {}) {
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const subscriptionId = "22222222-2222-2222-2222-222222222222";
  const targetSubscriptionIds = [subscriptionId];
  const workspaceResourceId =
    `/subscriptions/${subscriptionId}/resourceGroups/rg-security/` +
    "providers/Microsoft.OperationalInsights/workspaces/law-security";
  const paidPlans = {
    defenderForServers: true,
    defenderForContainers: true,
    defenderForDatabases: true,
    defenderForKeyVault: true,
    defenderForResourceManager: true,
    defenderForStorage: true,
  };
  const evidence = (value) => {
    const result = {
      observedAt: "2026-08-11T17:00:00Z",
      expiresAt: "2026-08-12T17:00:00Z",
      ...value,
    };
    result.evidenceDigest = defenderEvidenceDigest(result);
    return result;
  };
  const decision = buildDefenderWorkspaceDecision({
    decisionId: "workspace.greenfield-journey.prod",
    generatedAt: fixedNow,
    expiresAt: "2026-08-12T17:00:00Z",
    planningAt: fixedNowMs,
    tenantId,
    subscriptionId,
    targetSubscriptionIds,
    primaryRegion: "centralus",
    paidPlans,
    placement: {
      mode: "existing",
      region: "centralus",
      tenantId,
      subscriptionId,
      workspaceResourceId,
    },
    policyEvidence: evidence({
      tenantId,
      targetSubscriptionIds,
      allowedLocations,
    }),
    serviceSupportEvidence: evidence({ supportedRegions: ["centralus"] }),
    dataResidencyEvidence: evidence({
      tenantId,
      targetSubscriptionIds,
      allowedRegions: ["centralus"],
    }),
    workspaceEvidence: evidence({
      tenantId,
      subscriptionId,
      workspaceResourceId,
      location: "centralus",
      provisioningState: "Succeeded",
    }),
    centralWorkspaceEvidence: evidence({
      tenantId,
      subscriptionId,
      workspaceReferenceDigest: defenderWorkspaceDigest(
        workspaceResourceId.toLowerCase(),
      ),
      targetSubscriptionIds,
    }),
  });
  assert(
    decision.status === expectedStatus,
    `Synthetic Defender workspace placement must be ${expectedStatus}.`,
  );
  return decision;
}

function iacInput(
  workload,
  regional,
  postgresql,
  defender,
  aks,
  topologyDigest,
  regionalAttempt,
) {
  const subscriptionId = "22222222-2222-2222-2222-222222222222";
  const input = {
    schemaVersion: "3.0.0",
    planId: "greenfield-journey-plan-v2",
    target: {
      tenantId: "11111111-1111-1111-1111-111111111111",
      environments: [
        { name: "prod", subscriptionId },
        { name: "nonprod", subscriptionId },
      ],
    },
    workloadPlan: workload,
    regionalPlan: regional,
    postgresqlPlan: postgresql,
    deployment: {
      companyName: "contoso",
      budgetStartDate: "2026-08-01T00:00:00Z",
      monthlyBudgetAmounts: { prod: 500, nonprod: 200 },
      deployNetworking: true,
      logRetentionInDays: 90,
      logDailyQuotaGb: 5,
      paidPlans: {
        defenderForServers: true,
        defenderForContainers: true,
        defenderForDatabases: true,
        defenderForKeyVault: true,
        defenderForResourceManager: true,
        defenderForStorage: true,
      },
      services: [
        {
          type: "Microsoft.ContainerService/managedClusters",
          purpose: "application compute",
        },
        {
          type: "Microsoft.DBforPostgreSQL/flexibleServers",
          purpose: "relational data",
        },
        {
          type: "Microsoft.CognitiveServices/accounts",
          purpose: "managed model",
        },
      ],
      proposedActions: [
        {
          id: "provider.register.prod.microsoft-containerservice",
          type: "azureWrite",
          operation: "provider.register",
          namespace: "Microsoft.ContainerService",
          subscriptionId,
          region: null,
          scope: `/subscriptions/${subscriptionId}`,
          summary: "Register Microsoft.ContainerService for reviewed AKS deployment.",
        },
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
        subscriptionId,
        resourceGroupName: "rg-terraform-state",
        storageAccountName: "stsslzfixture",
        containerName: "tfstate",
        keyPrefix: "sslz-greenfield",
      },
      defenderWorkspacePlacement: defender,
    },
    approval: null,
  };
  input.regionalAttempt = regionalAttempt;
  input.readinessEvidence = buildReadinessEvidence(input);
  return input;
}

export async function runGreenfieldJourney() {
  rmSync(generatedRoot, { recursive: true, force: true });
  mkdirSync(generatedRoot, { recursive: true });

  const orchestrator = createJourneyOrchestrator();
  const blockerTransitions = [];
  const preflight = runSyntheticPreflight();
  const topology = {
    decisionId: preflight.topologyDecision.decisionId,
    decisionDigest: preflight.topologyDecision.decisionDigest,
    selectionMode:
      preflight.topologyDecision.subscriptionTopology.selectionMode,
    prodSubscriptionAlias: "startup-subscription",
    nonprodSubscriptionAlias: "startup-subscription",
    supportConfirmation: {
      status: "confirmed",
      confirmedBy: "external-support-alias",
      confirmedAt: fixedNow,
      topologyDecisionDigest: preflight.topologyDecision.decisionDigest,
      bindingDigest: digest({
        account: "startup-account",
        subscription: "startup-subscription",
        topologyDecisionDigest: preflight.topologyDecision.decisionDigest,
      }),
    },
  };
  const topologyDigest = topology.decisionDigest;
  transition(
    blockerTransitions,
    "billing.subscription.credit-association",
    "unresolved",
    "pass",
    topologyDigest,
  );
  transition(
    blockerTransitions,
    "billing.target-benefit.topology-confirmed",
    "unresolved",
    "pass",
    topology.supportConfirmation.bindingDigest,
  );
  transition(
    blockerTransitions,
    "readiness.support.startup-confirmed",
    "unresolved",
    "pass",
    topology.supportConfirmation.bindingDigest,
  );

  const regionalInput = syntheticRegionalInput();
  const workload = regionalInput.workloadPlan;
  assert(workload.computeProfile === "aks", "Explicit Kubernetes requirements must select AKS.");
  assert(
    workload.computeProfile !== "container-apps",
    "AKS requirements must not select Container Apps.",
  );
  assert(workload.profileExtensions.includes("postgresql"), "PostgreSQL profile was not selected.");
  assert(workload.profileExtensions.includes("foundry"), "Foundry profile was not selected.");
  for (const checkId of workload.requiredChecks) {
    if (checkId === "account.provider.required-registrations") continue;
    transition(
      blockerTransitions,
      checkId,
      "unresolved",
      "pass",
      digest(workload),
    );
  }

  const providerPlan = {
    status: "blocked",
    namespaces: ["Microsoft.ContainerService"],
    approved: false,
    executionMode: "mock",
    writeEvents: 0,
  };
  const providerEvidenceDigest = digest(providerPlan.namespaces);
  transition(
    blockerTransitions,
    "account.provider.required-registrations",
    "blocked",
    "pass",
    providerEvidenceDigest,
  );
  providerPlan.status = "pass";
  providerPlan.approved = true;
  providerPlan.writeEvents = 1;
  providerPlan.executionDigest = digest({
    namespaces: providerPlan.namespaces,
    runner: "deterministic-mock",
  });

  const regional = planRegions(regionalInput, { evaluatedAt: fixedNowMs });
  const postgresqlInput = readJson(
    join(root, "agent", "examples", "postgresql-regional-plan-input.json"),
  );
  const postgresql = planPostgresql(postgresqlInput, {
    evaluatedAt: fixedNowMs,
  });
  assert(
    postgresql.selectedRegion === "centralus",
    "Central US must be the PostgreSQL fallback.",
  );
  assert(
    postgresql.candidates.find((candidate) => candidate.region === "eastus2")
      .disposition !== "eligible",
    "East US 2 must fail PostgreSQL suitability.",
  );
  const selectedPostgresql = postgresql.candidates.find(
    (candidate) => candidate.region === postgresql.selectedRegion,
  );
  for (const check of selectedPostgresql.checks) {
    transition(
      blockerTransitions,
      check.id,
      "blocked",
      "pass",
      selectedPostgresql.evidenceDigest,
    );
  }
  const defender = syntheticDefenderDecision();
  transition(
    blockerTransitions,
    "operations.monitoring.destination-valid",
    "blocked",
    "pass",
    defender.decisionDigest,
  );

  const retryFixture = readJson(
    join(
      root,
      "tests",
      "fixtures",
      "regional-retry",
      "primary-failure-alternate-success.json",
    ),
  );
  const priorRetryBindings = {
    regionalEvidenceDigest: digest({ evidence: "eastus2-v1" }),
    planDigest: digest({ plan: "eastus2-v1" }),
    artifactDigest: digest({ artifact: "eastus2-v1" }),
    manifestDigest: digest({ manifest: "eastus2-v1" }),
    approvalDigest: digest({ approval: "eastus2-v1" }),
  };
  const nextRetryBindings = {
    regionalEvidenceDigest: digest(regionalInput.evidence),
    planDigest: digest({ plan: "centralus-v2" }),
    artifactDigest: digest({ artifact: "centralus-v2" }),
    manifestDigest: digest({ manifest: "centralus-v2" }),
    approvalDigest: digest({ approval: "centralus-v2" }),
  };
  const priorAttempt = createRegionalAttempt({
    ...retryFixture,
    targetRegion: retryFixture.originalRegion,
    ...priorRetryBindings,
    createdAt: retryFixture.timestamps.planned,
  });
  const failedAttempt = recordAttemptFailure(
    recordAttemptStarted(priorAttempt, retryFixture.timestamps.started),
    {
      code: "deployment.execution.failed",
      summary: "Synthetic primary-region allocation failed.",
      diagnostics: { service: "Microsoft.ContainerService", authorization: "******" },
      occurredAt: retryFixture.timestamps.failed,
    },
  );
  const cleanupIncompleteNegative = orchestrator.expectBlocked(
    "cleanup-incomplete",
    "regional-retry",
    "regional.retry.cleanup-complete",
    () =>
      replanRegionalAttempt(failedAttempt, {
        ...retryFixture,
        targetRegion: retryFixture.alternateRegion,
        ...nextRetryBindings,
        createdAt: retryFixture.timestamps.replanned,
      }),
  );
  const cleanedAttempt = recordCleanupOutcome(failedAttempt, {
    succeeded: true,
    evidenceDigest: digest({ cleanup: "verified-absent" }),
    occurredAt: retryFixture.timestamps.cleaned,
    summary: "Attempt-owned resources and identities were verified absent.",
  });
  const reusedEvidenceNegative = orchestrator.expectBlocked(
    "reused-regional-evidence",
    "regional-retry",
    "regional.retry.binding-current",
    () =>
      replanRegionalAttempt(cleanedAttempt, {
        ...retryFixture,
        targetRegion: retryFixture.alternateRegion,
        ...nextRetryBindings,
        regionalEvidenceDigest: priorRetryBindings.regionalEvidenceDigest,
        createdAt: retryFixture.timestamps.replanned,
      }),
  );
  const regionalRetry = replanRegionalAttempt(cleanedAttempt, {
    ...retryFixture,
    targetRegion: retryFixture.alternateRegion,
    ...nextRetryBindings,
    createdAt: retryFixture.timestamps.replanned,
  });
  assert(
    regionalRetry.bindings.regionalEvidenceDigest !==
      priorAttempt.bindings.regionalEvidenceDigest,
    "Changed-region retry must use fresh regional evidence.",
  );
  assert(
    regionalRetry.identities.stateKey === priorAttempt.identities.stateKey,
    "Changed-region retry must retain the remote Terraform state key.",
  );
  assert(
    regionalRetry.identities.deploymentName !==
      priorAttempt.identities.deploymentName,
    "Changed-region retry must use fresh location-bound identities.",
  );
  transition(
    blockerTransitions,
    "regional.retry.cleanup-complete",
    "blocked",
    "pass",
    cleanedAttempt.cleanup.evidenceDigest,
  );
  transition(
    blockerTransitions,
    "regional.retry.binding-current",
    "blocked",
    "pass",
    regionalRetry.bindings.regionalEvidenceDigest,
  );

  const aksDecision = validateAksIngressDecision(
    readJson(join(root, "agent", "examples", "aks-ingress-public.json")),
  );
  assert(
    aksDecision.nsgRules.map(({ priority, sourceAddressPrefixes, destinationPort }) => ({
      priority,
      sourceAddressPrefixes,
      destinationPort,
    })).some(
      (rule) =>
        rule.priority === 100 &&
        rule.sourceAddressPrefixes.includes("AzureLoadBalancer") &&
        rule.destinationPort === 30080,
    ),
    "AKS public mode must include exact Azure Load Balancer probe/NodePort rule.",
  );
  assert(
    aksDecision.nsgRules.some(
      (rule) =>
        rule.priority === 110 &&
        rule.sourceAddressPrefixes.includes("Internet") &&
        rule.destinationPort === 30080,
    ),
    "AKS public mode must include exact approved source/NodePort rule.",
  );

  const reviewedRetryPredecessors = Object.fromEntries(
    ["prod", "nonprod"].map((environment) => {
      const previous = createRegionalAttempt({
        chainId: "greenfield-journey",
        planId: "greenfield-journey-plan-v2",
        provider: "bicep",
        environment,
        backendKeyPrefix: "sslz-greenfield",
        originalRegion: "eastus2",
        targetRegion: "eastus2",
        ...priorRetryBindings,
        createdAt: retryFixture.timestamps.planned,
      });
      const failed = recordAttemptFailure(
        recordAttemptStarted(previous, retryFixture.timestamps.started),
        {
          code: "deployment.execution.failed",
          summary: "Synthetic primary-region allocation failed.",
          diagnostics: {
            service: "Microsoft.ContainerService",
            authorization: "******",
          },
          occurredAt: retryFixture.timestamps.failed,
        },
      );
      return [
        environment,
        recordCleanupOutcome(failed, {
          succeeded: true,
          evidenceDigest: digest({
            cleanup: "verified-absent",
            environment,
          }),
          occurredAt: retryFixture.timestamps.cleaned,
          summary: "Attempt-owned resources and identities were verified absent.",
        }),
      ];
    }),
  );
  const reviewedRegionalRetry = {
    chainId: "greenfield-journey",
    attemptNumber: 2,
    originalRegion: "eastus2",
    targetRegion: "centralus",
    previousAttempts: reviewedRetryPredecessors,
    safeSameRegionRetry: false,
  };
  const previewFixtures = readJson(
    join(root, "tests", "fixtures", "iac-planner", "preview-success.json"),
  );
  const iac = generateIacPlan(
    iacInput(
      workload,
      regional,
      postgresql,
      defender,
      aksDecision,
      topologyDigest,
      reviewedRegionalRetry,
    ),
    {
      providers: ["bicep", "terraform"],
      outputPath: generatedRelative,
      previewFixtures,
      evaluatedAt: fixedNowMs,
    },
  );
  assert(iac.approval.status === "pending", "IaC plan must await explicit approval.");
  assert(
    iac.previews.every((preview) => preview.destructiveChanges === false),
    "IaC previews must contain no destructive changes.",
  );
  assert(
    iac.artifacts.some(
      (artifact) =>
        artifact.provider === "bicep" && artifact.region === "centralus",
    ) &&
      iac.artifacts.some(
        (artifact) =>
          artifact.provider === "terraform" && artifact.region === "centralus",
      ),
    "Bicep and Terraform must represent the same selected region.",
  );
  assert(
    iac.artifacts
      .filter((artifact) => artifact.provider === "terraform")
      .every((artifact) => artifact.stateKey),
    "Terraform artifacts require remote state keys.",
  );
  const bicepProdArtifact = iac.artifacts.find(
    (artifact) =>
      artifact.provider === "bicep" &&
      artifact.environment === "prod" &&
      artifact.regionRole === "primary",
  );
  assert(bicepProdArtifact, "A production Bicep artifact is required.");
  const iacPlanPath = locatePlanSummary(bicepProdArtifact.path);
  const reviewedBicepPreview = iac.previews.find(
    (preview) =>
      preview.provider === "bicep" &&
      preview.environment === "prod" &&
      preview.regionRole === "primary",
  );
  assert(reviewedBicepPreview, "A production Bicep preview is required.");
  reviewedBicepPreview.source = "command";
  iac.approval = {
    ...iac.approval,
    status: "approved",
    approvedAt: "2026-08-11T17:30:00.000Z",
    expiresAt: "2026-08-11T19:00:00.000Z",
  };
  writeFileSync(iacPlanPath, `${JSON.stringify(iac, null, 2)}\n`);
  const deploymentTarget = {
    subscriptionId: iac.decisionModel.target.environments.find(
      (environment) => environment.name === "prod",
    ).subscriptionId,
    workspaceId:
      iac.readinessEvidence.codeEvidence.defenderWorkspacePlacement.placement
        .workspaceReference,
  };
  const productionManifest = orchestrator.prepare(
    "synthetic-greenfield-founder-v1",
    () =>
      buildDeploymentManifest(iac, {
        provider: "bicep",
        environment: "prod",
        planPath: iacPlanPath,
        evaluatedAt: fixedNowMs,
        stateStoreResolver: (statePath) => {
          assert(
            statePath === ".sslz/deployment-state",
            "Production manifest preparation must request the canonical state path.",
          );
          return { storeId: "99999999-9999-4999-8999-999999999999" };
        },
        runner: (executable, args) =>
          deploymentPreviewRunner(executable, args, deploymentTarget),
      }),
  );
  const productionApproval = buildDeploymentApproval(productionManifest);
  writeFileSync(
    join(generatedRoot, "deployment-manifest.json"),
    `${JSON.stringify(productionManifest, null, 2)}\n`,
  );
  writeFileSync(
    join(generatedRoot, "deployment-approval.json"),
    `${JSON.stringify(productionApproval, null, 2)}\n`,
  );
  assert(
    productionManifest.plan.digest === iac.planDigest &&
      productionManifest.readinessEvidence.digest ===
        iac.readinessEvidence.evidenceDigest &&
      productionManifest.regionalAttempt.attemptNumber === 2 &&
      productionManifest.regionalAttempt.previousAttemptKey ===
        reviewedRetryPredecessors.prod.identities.attemptKey &&
      productionApproval.manifestDigest === productionManifest.manifestDigest &&
      productionApproval.scope ===
        `/subscriptions/${deploymentTarget.subscriptionId}`,
    "Production deployment preparation must preserve plan, readiness, retry, and scope bindings.",
  );
  const providerActionId =
    "provider.register.prod.microsoft-containerservice";
  const dryRun = runProviderRemediation(iac, providerActionId, null, {
    mode: "dry-run",
    evaluatedAt: fixedNowMs,
  });
  assert(
    dryRun.status === "planned" && dryRun.safety.azureWrites === 0,
    "Provider remediation dry run must plan without Azure writes.",
  );
  const unapproved = runProviderRemediation(iac, providerActionId, null, {
    mode: "apply",
    evaluatedAt: fixedNowMs,
  });
  assert(
    unapproved.code === "remediation.approval.required" &&
      unapproved.safety.azureWrites === 0,
    "Unapproved provider remediation must fail closed without Azure writes.",
  );
  const providerAction = iac.decisionModel.proposedActions.find(
    ({ id }) => id === providerActionId,
  );
  const providerApproval = {
    schemaVersion: "1.0.0",
    status: "approved",
    planVersion: iac.plannerVersion,
    planId: iac.planId,
    planDigest: iac.planDigest,
    actionId: providerAction.id,
    actionType: providerAction.type,
    operation: providerAction.operation,
    namespace: providerAction.namespace,
    subscriptionId: providerAction.subscriptionId,
    scope: providerAction.scope,
    approvedAt: fixedNow,
    expiresAt: "2026-08-11T20:00:00.000Z",
  };
  providerApproval.approvalDigest = providerApprovalDigest(providerApproval);
  let providerReads = 0;
  const providerCalls = [];
  const providerRunner = (args) => {
    providerCalls.push([...args]);
    if (args[0] === "account") {
      return {
        status: 0,
        stdout: JSON.stringify({
          id: providerAction.subscriptionId,
          tenantId: iac.decisionModel.target.tenantId,
          state: "Enabled",
        }),
        stderr: "",
      };
    }
    if (args[0] === "provider" && args[1] === "show") {
      providerReads += 1;
      return {
        status: 0,
        stdout: JSON.stringify({
          namespace: providerAction.namespace,
          registrationState:
            providerReads === 1 ? "NotRegistered" : "Registered",
        }),
        stderr: "",
      };
    }
    if (args[0] === "provider" && args[1] === "register") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 2, stdout: "", stderr: "unexpected synthetic command" };
  };
  const providerStatePath = `.sslz/remediation-state/greenfield-${process.pid}`;
  rmSync(join(root, providerStatePath), { recursive: true, force: true });
  const approvedProvider = runProviderRemediation(
    iac,
    providerActionId,
    providerApproval,
    {
      mode: "apply",
      evaluatedAt: fixedNowMs,
      runner: providerRunner,
      statePath: providerStatePath,
    },
  );
  assert(
    approvedProvider.status === "succeeded" &&
      providerCalls.some(
        (args) => args[0] === "provider" && args[1] === "register",
      ),
    "Approved provider remediation must execute only through the deterministic mock.",
  );
  providerPlan.writeEvents = approvedProvider.safety.azureWrites;
  providerPlan.executionDigest = digest(approvedProvider);
  rmSync(join(root, providerStatePath), { recursive: true, force: true });

  const productionApprovalDigest = digest(productionApproval);
  const deploymentPreparation = {
    status: "prepared",
    executionMode: "mock",
    writeEvents: 0,
    writePreparationEvents: orchestrator.preparationCount(
      "synthetic-greenfield-founder-v1",
    ),
    manifestDigest: productionManifest.manifestDigest,
    approvalDigest: productionApprovalDigest,
    productionContract: "buildDeploymentManifest",
  };

  const planningPostcheck = buildPlanningPostcheck(aksDecision);
  assert(
    planningPostcheck.liveConnectivityClaimed === false,
    "Planning postcheck must not claim live reachability.",
  );
  const acceptancePostcheck = buildSignedAcceptance(aksDecision, {
    observedAt: "2026-08-11T17:55:00.000Z",
    healthy: true,
    reachable: true,
    decisionDigest: aksDecision.decisionDigest,
  });
  const approvedAcceptance = validateApprovedAksIngressPostcheck({
    postcheck: acceptancePostcheck.postcheck,
    purpose: "acceptance",
    expectedDecision: aksDecision,
    manifest: productionManifest,
    approval: productionApproval,
    publicKey: syntheticPublicKey.export({ type: "spki", format: "pem" }),
    evaluatedAt: fixedNowMs,
  });
  assert(
    approvedAcceptance.status === "accepted" &&
      approvedAcceptance.evidenceDigest === acceptancePostcheck.evidenceDigest,
    "Observed AKS acceptance must validate against the signed production deployment manifest.",
  );

  const wrongBenefitPreflight = executeSyntheticPreflight(
    "az-benefits-different-subscription.json",
    "synthetic-wrong-benefit-preflight",
  );
  const wrongBenefitCheck = wrongBenefitPreflight.checks.find(
    ({ id }) => id === "billing.subscription.credit-association",
  );
  assert(
    wrongBenefitCheck?.status === "fail",
    "Wrong-subscription benefits must fail the production preflight check.",
  );
  const noFallbackInput = structuredClone(postgresqlInput);
  noFallbackInput.allowedLocations = ["eastus2"];
  noFallbackInput.evidence = noFallbackInput.evidence.filter(
    (candidate) => candidate.region === "eastus2",
  );
  const noFallbackPostgresql = planPostgresql(noFallbackInput, {
    evaluatedAt: fixedNowMs,
  });
  const noFallbackCheck = noFallbackPostgresql.candidates
    .flatMap((candidate) => candidate.checks)
    .find(
      ({ id, classification }) =>
        id === "region.postgresql.edition-version-supported" &&
        classification === "fail",
    );
  assert(
    noFallbackPostgresql.status === "blocked" && noFallbackCheck,
    "No-fallback PostgreSQL planning must emit the expected blocker.",
  );
  const deniedDefender = syntheticDefenderDecision({
    allowedLocations: ["eastus2"],
    expectedStatus: "blocked",
  });
  const mutableProfileInput = readJson(
    join(root, "agent", "examples", "container-apps-cool-profile-input.json"),
  );
  mutableProfileInput.configuration.image = "contoso.azurecr.io/api:latest";
  const profileBinding = mutableProfileInput.foundationBinding;
  const foundationForProfile = {
    planId: profileBinding.planId,
    planDigest: profileBinding.planDigest,
    environment: "nonprod",
    mode: "cool-infrastructure",
    status: "ready-for-review",
    gateResults: [{ status: "pass" }],
    approvalBinding: {
      readinessEvidenceDigest: profileBinding.readinessEvidenceDigest,
    },
    foundation: {
      primary: { vnetCidr: profileBinding.primaryVnetCidr },
      secondary: {
        subscriptionId: profileBinding.subscriptionId,
        region: profileBinding.secondaryRegion,
        vnetCidr: profileBinding.secondaryVnetCidr,
        resourceNames: {
          vnet: profileBinding.vnetResourceId.split("/").at(-1),
          workspace: profileBinding.logAnalyticsWorkspaceResourceId
            .split("/")
            .at(-1),
        },
      },
      isolation: {
        scope: profileBinding.vnetResourceId.replace(
          /\/providers\/Microsoft\.Network\/virtualNetworks\/[^/]+$/,
          "",
        ),
        terraformState: profileBinding.terraformStateKey.replace(
          "-nonprod-secondary-container-apps.tfstate",
          "-nonprod-secondary.tfstate",
        ),
      },
    },
  };
  const mutableImageGate = evaluateProfileGates(
    foundationForProfile,
    mutableProfileInput,
    [],
    fixedNowMs,
  ).find(({ id }) => id === CONTAINER_APPS_GATE_IDS.image);
  assert(
    mutableImageGate?.status === "blocked",
    "Mutable image input must block the production immutable-image gate.",
  );

  const negatives = [
    orchestrator.expectBlocked(
      "benefits-wrong-subscription",
      "preflight",
      "billing.subscription.credit-association",
      () => ({
        status: wrongBenefitCheck.status,
        checkId: wrongBenefitCheck.id,
        diagnostic: wrongBenefitCheck.summary,
      }),
    ),
    orchestrator.expectBlocked(
      "provider-remediation-not-approved",
      "provider-remediation",
      "remediation.approval.required",
      () => ({
        status: unapproved.status,
        code: unapproved.code,
        diagnostic: unapproved.message,
      }),
    ),
    orchestrator.expectBlocked(
      "no-postgresql-fallback",
      "regional-planning",
      "region.postgresql.edition-version-supported",
      () => ({
        status: noFallbackPostgresql.status,
        checkId: noFallbackCheck.id,
        diagnostic: noFallbackCheck.summary,
      }),
    ),
    orchestrator.expectBlocked(
      "defender-workspace-denied",
      "defender-placement",
      "workspace.region-denied",
      () => ({
        status: deniedDefender.status,
        code: deniedDefender.reasonCode,
        diagnostic: "The explicit Defender workspace region is denied.",
      }),
    ),
    cleanupIncompleteNegative,
    reusedEvidenceNegative,
    orchestrator.expectBlocked(
      "stale-approval",
      "approval",
      "deployment.approval.expired",
      () =>
        validateApprovedAksIngressPostcheck({
          postcheck: acceptancePostcheck.postcheck,
          purpose: "acceptance",
          expectedDecision: aksDecision,
          manifest: productionManifest,
          approval: resignDeploymentApproval(productionApproval, {
            approvedAt: "2026-08-11T16:00:00.000Z",
            expiresAt: "2026-08-11T17:00:00.000Z",
          }),
          publicKey: syntheticPublicKey.export({
            type: "spki",
            format: "pem",
          }),
          evaluatedAt: fixedNowMs,
        }),
    ),
    orchestrator.expectBlocked(
      "mutable-image",
      "iac-plan",
      CONTAINER_APPS_GATE_IDS.image,
      () => ({
        status: mutableImageGate.status,
        checkId: mutableImageGate.id,
        diagnostic: mutableImageGate.message,
      }),
    ),
    orchestrator.expectBlocked(
      "public-aks-private-mode",
      "aks-ingress",
      "network.aks-ingress.architecture-review",
      () => {
        validateAksIngressDecision({
          mode: "private",
          serviceType: "LoadBalancer",
          frontendExposure: "public",
          protocol: "Tcp",
          frontendPort: 80,
          backendNodePort: 30080,
          healthProbe: {
            sourcePrefix: "AzureLoadBalancer",
            port: 30080,
          },
          dataSourcePrefixes: ["Internet"],
          reservedNsgPriorities: [],
        });
      },
    ),
    orchestrator.expectBlocked(
      "unhealthy-postcheck",
      "postcheck",
      "network.aks-ingress.postcheck-current",
      () =>
        buildSignedAcceptance(aksDecision, {
          observedAt: "2026-08-11T17:55:00.000Z",
          healthy: false,
          reachable: true,
          decisionDigest: aksDecision.decisionDigest,
        }),
    ),
    orchestrator.expectBlocked(
      "stale-postcheck",
      "postcheck",
      "network.aks-ingress.postcheck-current",
      () =>
        buildSignedAcceptance(aksDecision, {
          observedAt: "2026-08-11T16:00:00.000Z",
          healthy: true,
          reachable: true,
          decisionDigest: aksDecision.decisionDigest,
        }),
    ),
    orchestrator.expectBlocked(
      "mismatched-postcheck",
      "postcheck",
      "network.aks-ingress.postcheck-current",
      () =>
        buildSignedAcceptance(aksDecision, {
          observedAt: "2026-08-11T17:55:00.000Z",
          healthy: true,
          reachable: true,
          decisionDigest: digest("different-decision"),
        }),
    ),
  ];

  const report = {
    schemaVersion: "1.0.0",
    journeyId: "synthetic-greenfield-founder-v1",
    generatedAt: fixedNow,
    mode: "validation-only",
    status: "pass",
    stages: [
      { id: "preflight", status: "pass" },
      { id: "topology", status: "pass" },
      { id: "provider-remediation", status: "pass" },
      { id: "workload-discovery", status: "pass" },
      { id: "regional-planning", status: "pass" },
      { id: "defender-placement", status: "pass" },
      { id: "regional-retry", status: "pass" },
      { id: "iac-plan", status: "pass" },
      { id: "readiness-approval", status: "pass" },
      { id: "deployment-preparation", status: "pass" },
      { id: "aks-planning-postcheck", status: "not-observed" },
      { id: "aks-observed-acceptance", status: "pass" },
    ],
    blockerTransitions,
    bindings: {
      topologyDigest,
      workloadPlanDigest: digest(workload),
      regionalPlanDigest: digest(regional),
      postgresqlDecisionDigest: postgresql.decisionDigest,
      defenderDecisionDigest: defender.decisionDigest,
      aksDecisionDigest: aksDecision.decisionDigest,
      providerExecutionDigest: providerPlan.executionDigest,
      readinessDigest: productionManifest.readinessEvidence.digest,
      planDigest: iac.planDigest,
      manifestDigest: productionManifest.manifestDigest,
      approvalDigest: productionApprovalDigest,
      acceptanceEvidenceDigest: acceptancePostcheck.evidenceDigest,
    },
    artifacts: iac.artifacts.map(({ provider, environment, region, digest: artifactDigest }) => ({
      provider,
      environment,
      region,
      digest: artifactDigest,
    })),
    negativeJourneys: negatives,
    diagnostics: {
      sanitized: true,
      azureWrites: 0,
      liveTenantDependency: false,
      mockedAzureWriteEvents: providerPlan.writeEvents,
      preflightRunId: preflight.runId,
      deploymentPreparation,
      planningPostcheck,
      acceptancePostcheck: {
        status: acceptancePostcheck.status,
        liveConnectivityClaimed: acceptancePostcheck.liveConnectivityClaimed,
        evidenceDigest: acceptancePostcheck.evidenceDigest,
        approvalDigest: acceptancePostcheck.approvalDigest,
        signatureAlgorithm: acceptancePostcheck.signatureAlgorithm,
      },
    },
  };
  assert(
    report.negativeJourneys.every(
      (negative) =>
        negative.status === "blocked" && negative.writePreparationEvents === 0,
    ),
    "Every negative journey must fail closed before write preparation.",
  );
  validateDocument(
    readJson(
      join(
        root,
        "agent",
        "schemas",
        "greenfield-journey-report.schema.json",
      ),
    ),
    report,
  );
  writeFileSync(
    join(generatedRoot, "journey-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  return report;
}
