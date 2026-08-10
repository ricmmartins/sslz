#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDecisionModel,
  planDigest,
} from "../scripts/startup-iac-plan.mjs";
import {
  approvalDigest,
  commandArguments,
  runProviderRemediation,
} from "../scripts/startup-provider-remediation.mjs";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";
import { buildReadinessEvidence } from "./readiness-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const regionalInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/regional-planning-input.json"),
    "utf8",
  ),
);
const resultSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/provider-remediation-result.schema.json"),
    "utf8",
  ),
);
const evaluatedAt = Date.parse("2026-08-09T12:00:00Z");
const tenantId = "11111111-1111-1111-1111-111111111111";
const prod = "22222222-2222-2222-2222-222222222222";
const actionId = "provider.register.prod.microsoft-app";
const stateRoot = `.sslz/remediation-state/tests-${process.pid}`;
const stateRootPath = resolve(root, stateRoot);
const cliFixturePath = resolve(
  root,
  `.sslz/generated/provider-remediation-tests-${process.pid}`,
);

function createPlan({
  planId = "phase-five-test",
  namespace = "Microsoft.App",
  action = {},
  profile = null,
} = {}) {
  const planningInput = structuredClone(regionalInput);
  planningInput.startupInput.reliability.regionalMode = "single-region-ready";
  planningInput.startupInput.reliability.rtoMinutes = 60;
  planningInput.startupInput.reliability.rpoMinutes = 15;
  planningInput.workloadPlan = planWorkload(planningInput.startupInput);
  if (profile) {
    planningInput.workloadPlan.computeProfile = profile.computeProfile;
    planningInput.workloadPlan.profileExtensions = profile.profileExtensions;
  }
  const regionalPlan = planRegions(planningInput);
  const namespaceSlug = namespace.toLowerCase().replaceAll(".", "-");
  const input = {
    schemaVersion: "3.0.0",
    planId,
    target: {
      tenantId,
      environments: [
        { name: "prod", subscriptionId: prod },
        {
          name: "nonprod",
          subscriptionId: "33333333-3333-3333-3333-333333333333",
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
          id: `provider.register.prod.${namespaceSlug}`,
          type: "azureWrite",
          operation: "provider.register",
          namespace,
          subscriptionId: prod,
          region: null,
          scope: `/subscriptions/${prod}`,
          summary: `Register ${namespace} for the reviewed production profile.`,
          ...action,
        },
      ],
      terraformBackend: {
        type: "azurerm",
        subscriptionId: prod,
        resourceGroupName: "rg-terraform-state",
        storageAccountName: "stsslzfixture",
        containerName: "tfstate",
        keyPrefix: "phase-five",
      },
    },
    approval: null,
  };
  input.readinessEvidence = buildReadinessEvidence(input);
  const decisionModel = buildDecisionModel(input);
  const digest = planDigest(decisionModel);
  return {
    schemaVersion: "1.0.0",
    plannerVersion: "1.0.0",
    generatedBy: "startup-iac-plan.mjs",
    planId,
    planDigest: digest,
    decisionModel,
    readinessEvidence: input.readinessEvidence,
    approval: {
      required: true,
      status: "pending",
      planId,
      planDigest: digest,
      approvedAt: null,
      expiresAt: null,
      reapprovalRequired: false,
      invalidationReason: null,
    },
    artifacts: [
      {
        provider: "bicep",
        environment: "prod",
        regionRole: "primary",
        region: "eastus2",
        path: ".sslz/generated/phase-five/prod-primary.local.bicepparam",
        previewEligible: true,
      },
    ],
    previews: [
      {
        provider: "bicep",
        environment: "prod",
        regionRole: "primary",
        region: "eastus2",
        source: "none",
        status: "not-run",
        changes: { create: 0, modify: 0, remove: 0 },
        destructiveChanges: false,
        errorClass: null,
        message: "Preview was not requested.",
        rawArtifact: null,
      },
    ],
    safety: {
      azureOperations: "none",
      bicepDeploymentMode: "incremental-only",
      terraformBackend: "remote-required",
      contactValues: "sanitized-placeholders",
      rawArtifacts: "not-retained",
    },
  };
}

function createApproval(plan, overrides = {}) {
  const action = plan.decisionModel.proposedActions[0];
  const approval = {
    schemaVersion: "1.0.0",
    status: "approved",
    planVersion: plan.plannerVersion,
    planId: plan.planId,
    planDigest: plan.planDigest,
    actionId: action.id,
    actionType: action.type,
    operation: action.operation,
    namespace: action.namespace,
    subscriptionId: action.subscriptionId,
    scope: action.scope,
    approvedAt: "2026-08-09T11:00:00Z",
    expiresAt: "2026-08-09T13:00:00Z",
    ...overrides,
  };
  approval.approvalDigest = approvalDigest(approval);
  return approval;
}

function mockAzure({
  accountId = prod,
  accountTenantId = tenantId,
  accountState = "Enabled",
  initialState = "NotRegistered",
  finalState = "Registered",
  registerStatus = 0,
  rawError = "",
} = {}) {
  const calls = [];
  let providerReads = 0;
  const runner = (args) => {
    calls.push([...args]);
    if (args[0] === "account" && args[1] === "show") {
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
    if (args[0] === "provider" && args[1] === "show") {
      providerReads += 1;
      return {
        status: 0,
        stdout: JSON.stringify({
          namespace: "Microsoft.App",
          registrationState: providerReads === 1 ? initialState : finalState,
        }),
        stderr: "",
      };
    }
    if (args[0] === "provider" && args[1] === "register") {
      return { status: registerStatus, stdout: "", stderr: rawError };
    }
    return { status: 2, stdout: "", stderr: rawError };
  };
  return { calls, runner };
}

function apply(plan, approval, azure, suffix) {
  const result = runProviderRemediation(plan, actionId, approval, {
    mode: "apply",
    evaluatedAt,
    runner: azure.runner,
    statePath: `${stateRoot}/${suffix}`,
  });
  validateDocument(resultSchema, result);
  return result;
}

function assertSanitized(value) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /fixture-secret|founder@startup\.example|authorization:\s*bearer/i,
  );
}

function mutateBoundField(base, field, value) {
  const approval = structuredClone(base);
  approval[field] = value;
  approval.approvalDigest = approvalDigest(approval);
  return approval;
}

try {
  const plan = createPlan();
  const approval = createApproval(plan);

  const dryRunAzure = mockAzure();
  const dryRun = runProviderRemediation(plan, actionId, null, {
    mode: "dry-run",
    evaluatedAt,
    runner: dryRunAzure.runner,
    statePath: `${stateRoot}/dry-run`,
  });
  validateDocument(resultSchema, dryRun);
  assert.equal(dryRun.status, "planned");
  assert.equal(dryRun.safety.azureWrites, 0);
  assert.equal(dryRun.command.executed, false);
  assert.equal(dryRunAzure.calls.length, 0);
  assert.equal(existsSyncSafe(resolve(stateRootPath, "dry-run")), false);

  const mixedCasePlan = createPlan({
    action: {
      subscriptionId: prod.toUpperCase(),
      scope: `/subscriptions/${prod.toUpperCase()}`,
    },
  });
  const mixedCaseDryRun = runProviderRemediation(
    mixedCasePlan,
    actionId,
    null,
    { mode: "dry-run", evaluatedAt },
  );
  assert.equal(mixedCaseDryRun.status, "planned");
  assert.equal(mixedCaseDryRun.action.subscriptionId, prod);
  assert.equal(mixedCaseDryRun.action.scope, `/subscriptions/${prod}`);

  const unapproved = runProviderRemediation(plan, actionId, null, {
    mode: "apply",
    evaluatedAt,
    statePath: `${stateRoot}/unapproved`,
  });
  assert.equal(unapproved.code, "remediation.approval.required");

  for (const status of ["pending", "declined", "consumed"]) {
    const artifact = createApproval(plan, { status });
    const result = apply(plan, artifact, mockAzure(), `status-${status}`);
    assert.equal(result.status, "rejected");
    assert.equal(result.approval.status, status);
  }

  const expired = createApproval(plan, {
    approvedAt: "2026-08-09T09:00:00Z",
    expiresAt: "2026-08-09T10:00:00Z",
  });
  assert.equal(
    apply(plan, expired, mockAzure(), "expired").code,
    "remediation.approval.expired",
  );

  const overlong = createApproval(plan, {
    approvedAt: "2026-08-08T12:00:00Z",
    expiresAt: "2026-08-10T12:00:00Z",
  });
  assert.equal(
    apply(plan, overlong, mockAzure(), "overlong").code,
    "remediation.approval.window",
  );

  const malformed = { ...approval, approverEmail: "founder@startup.example" };
  const malformedResult = apply(plan, malformed, mockAzure(), "malformed");
  assert.equal(malformedResult.code, "remediation.approval.malformed");
  assertSanitized(malformedResult);
  const invalidMetadata = {
    ...approval,
    status: "founder@startup.example",
    expiresAt: "fixture-secret",
    approvalDigest: "Authorization: Bearer fixture-secret",
  };
  const invalidMetadataResult = apply(
    plan,
    invalidMetadata,
    mockAzure(),
    "invalid-metadata",
  );
  validateDocument(resultSchema, invalidMetadataResult);
  assert.equal(invalidMetadataResult.status, "rejected");
  assertSanitized(invalidMetadataResult);

  const wrongVersion = mutateBoundField(
    approval,
    "planVersion",
    "2.0.0",
  );
  assert.equal(
    apply(plan, wrongVersion, mockAzure(), "wrong-version").code,
    "remediation.approval.malformed",
  );
  const wrongPlanVersion = structuredClone(plan);
  wrongPlanVersion.plannerVersion = "2.0.0";
  assert.equal(
    runProviderRemediation(wrongPlanVersion, actionId, null, {
      mode: "dry-run",
      evaluatedAt,
    }).code,
    "remediation.input.malformed",
  );

  const digestMismatch = structuredClone(approval);
  digestMismatch.approvalDigest =
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(
    apply(plan, digestMismatch, mockAzure(), "digest-mismatch").code,
    "remediation.approval.digest-mismatch",
  );

  const boundMutations = {
    planVersion: "0.9.0",
    planId: "different-plan",
    planDigest:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    actionId: "provider.register.nonprod.microsoft-app",
    actionType: "manual",
    operation: "provider.unregister",
    namespace: "Microsoft.Compute",
    subscriptionId: "33333333-3333-3333-3333-333333333333",
    scope: "/subscriptions/33333333-3333-3333-3333-333333333333",
  };
  for (const [field, value] of Object.entries(boundMutations)) {
    const mutated = mutateBoundField(approval, field, value);
    const result = apply(plan, mutated, mockAzure(), `binding-${field}`);
    assert.equal(
      result.status,
      "rejected",
      `Mutating approval-bound field ${field} must reject`,
    );
  }

  const changedPlan = structuredClone(plan);
  changedPlan.decisionModel.services[0].purpose = "mutated after review";
  const changedPlanResult = runProviderRemediation(
    changedPlan,
    actionId,
    null,
    { mode: "dry-run", evaluatedAt },
  );
  assert.equal(
    changedPlanResult.code,
    "remediation.plan.digest-mismatch",
  );

  const nonAllowlistedPlan = createPlan({
    namespace: "Microsoft.Compute",
  });
  const nonAllowlistedAction =
    "provider.register.prod.microsoft-compute";
  const nonAllowlisted = runProviderRemediation(
    nonAllowlistedPlan,
    nonAllowlistedAction,
    null,
    { mode: "dry-run", evaluatedAt },
  );
  assert.equal(
    nonAllowlisted.code,
    "remediation.provider.not-allowlisted",
  );

  const profileMismatchPlan = structuredClone(plan);
  profileMismatchPlan.decisionModel.profile.computeProfile = "aks";
  profileMismatchPlan.planDigest = planDigest(
    profileMismatchPlan.decisionModel,
  );
  profileMismatchPlan.approval.planDigest = profileMismatchPlan.planDigest;
  const profileMismatch = runProviderRemediation(
    profileMismatchPlan,
    actionId,
    null,
    { mode: "dry-run", evaluatedAt },
  );
  assert.equal(
    profileMismatch.code,
    "remediation.provider.not-allowlisted",
  );

  const subscriptionMismatchAzure = mockAzure({
    accountId: "33333333-3333-3333-3333-333333333333",
  });
  const subscriptionMismatch = apply(
    plan,
    createApproval(plan, { approvedAt: "2026-08-09T11:01:00Z" }),
    subscriptionMismatchAzure,
    "subscription-mismatch",
  );
  assert.equal(subscriptionMismatch.code, "remediation.target.mismatch");
  assert.equal(
    subscriptionMismatchAzure.calls.some(
      (args) => args[0] === "provider" && args[1] === "register",
    ),
    false,
  );

  const tenantMismatchAzure = mockAzure({
    accountTenantId: "44444444-4444-4444-4444-444444444444",
  });
  assert.equal(
    apply(
      plan,
      createApproval(plan, { approvedAt: "2026-08-09T11:02:00Z" }),
      tenantMismatchAzure,
      "tenant-mismatch",
    ).code,
    "remediation.target.mismatch",
  );

  const successAzure = mockAzure();
  const successApproval = createApproval(plan, {
    approvedAt: "2026-08-09T11:03:00Z",
  });
  const success = apply(
    plan,
    successApproval,
    successAzure,
    "success-replay",
  );
  assert.equal(success.status, "succeeded");
  assert.equal(success.code, "remediation.provider.registered");
  assert.equal(success.safety.azureWrites, 1);
  assert.equal(success.verification.registrationState, "Registered");
  const registerCalls = successAzure.calls.filter(
    (args) => args[0] === "provider" && args[1] === "register",
  );
  assert.deepEqual(registerCalls, [commandArguments(plan.decisionModel.proposedActions[0])]);
  assert.equal(
    successAzure.calls.filter(
      (args) => args[0] === "provider" && args[1] === "show",
    ).length,
    2,
  );

  const replayAzure = mockAzure();
  const replay = apply(
    plan,
    successApproval,
    replayAzure,
    "success-replay",
  );
  assert.equal(replay.code, "remediation.approval.replayed");
  assert.equal(replayAzure.calls.length, 0);

  const alreadyAzure = mockAzure({ initialState: "Registered" });
  const already = apply(
    plan,
    createApproval(plan, { approvedAt: "2026-08-09T11:04:00Z" }),
    alreadyAzure,
    "already",
  );
  assert.equal(already.code, "remediation.provider.already-registered");
  assert.equal(already.safety.azureWrites, 0);
  assert.equal(
    alreadyAzure.calls.some(
      (args) => args[0] === "provider" && args[1] === "register",
    ),
    false,
  );

  const rawSensitive =
    "Authorization: Bearer fixture-secret founder@startup.example";
  const registerFailureAzure = mockAzure({
    registerStatus: 1,
    rawError: rawSensitive,
  });
  const registerFailure = apply(
    plan,
    createApproval(plan, { approvedAt: "2026-08-09T11:05:00Z" }),
    registerFailureAzure,
    "register-failure",
  );
  assert.equal(
    registerFailure.code,
    "remediation.provider.registration-failed",
  );
  assert.equal(
    registerFailureAzure.calls.filter(
      (args) => args[0] === "provider" && args[1] === "show",
    ).length,
    1,
  );
  assertSanitized(registerFailure);

  const verificationFailureAzure = mockAzure({
    finalState: "Registering",
    rawError: rawSensitive,
  });
  const verificationFailure = apply(
    plan,
    createApproval(plan, { approvedAt: "2026-08-09T11:06:00Z" }),
    verificationFailureAzure,
    "verification-failure",
  );
  assert.equal(
    verificationFailure.code,
    "remediation.provider.verification-failed",
  );
  assert.equal(verificationFailure.safety.azureWrites, 1);
  assertSanitized(verificationFailure);

  const raceApproval = createApproval(plan, {
    approvedAt: "2026-08-09T11:07:00Z",
  });
  const raceDirectory = resolve(stateRootPath, "race");
  mkdirSync(raceDirectory, { recursive: true });
  writeFileSync(
    resolve(
      raceDirectory,
      `${raceApproval.approvalDigest.slice("sha256:".length)}.lock`,
    ),
    "",
    { mode: 0o600 },
  );
  const raceAzure = mockAzure();
  const race = apply(plan, raceApproval, raceAzure, "race");
  assert.equal(race.code, "remediation.approval.race");
  assert.equal(raceAzure.calls.length, 0);

  const injectedAction = runProviderRemediation(
    plan,
    `${actionId}\nrole assignment create`,
    null,
    { mode: "dry-run", evaluatedAt },
  );
  assert.equal(injectedAction.code, "remediation.action.id");
  assert.equal(injectedAction.safety.azureWrites, 0);
  assert.doesNotMatch(dryRun.command.preview, /[\r\n;&|`$]/);
  assert.deepEqual(dryRun.command.arguments, [
    "provider",
    "register",
    "--subscription",
    prod,
    "--namespace",
    "Microsoft.App",
    "--wait",
    "--output",
    "none",
  ]);

  mkdirSync(cliFixturePath, { recursive: true });
  const cliPlanPath = resolve(cliFixturePath, "plan-summary.json");
  writeFileSync(cliPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  const cliScript = resolve(
    root,
    "scripts/startup-provider-remediation.mjs",
  );
  const cliJson = spawnSync(
    process.execPath,
    [
      cliScript,
      "dry-run",
      "--plan",
      cliPlanPath,
      "--action",
      actionId,
      "--output",
      "json",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(cliJson.status, 0, cliJson.stderr);
  validateDocument(resultSchema, JSON.parse(cliJson.stdout));
  const cliText = spawnSync(
    process.execPath,
    [
      cliScript,
      "dry-run",
      "--plan",
      cliPlanPath,
      "--action",
      actionId,
      "--output",
      "text",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(cliText.status, 0, cliText.stderr);
  assert.match(cliText.stdout, /PLANNED/);
  assert.match(cliText.stdout, /Azure writes: 0/);
  assertSanitized(cliText.stdout);
  const cliUnsupported = spawnSync(
    process.execPath,
    [
      cliScript,
      "dry-run",
      "--plan",
      cliPlanPath,
      "--action",
      actionId,
      "--fixture-secret",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(cliUnsupported.status, 2);
  assert.doesNotMatch(cliUnsupported.stderr, /fixture-secret/);

  for (const directory of readdirSync(stateRootPath, {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory())) {
    for (const file of readdirSync(resolve(stateRootPath, directory.name))) {
      if (file.endsWith(".json")) {
        assertSanitized(
          readFileSync(resolve(stateRootPath, directory.name, file), "utf8"),
        );
      }
    }
  }

  const source = readFileSync(
    resolve(root, "scripts/startup-provider-remediation.mjs"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /\b(role assignment|provider unregister|feature register|deployment (?:sub|group|tenant) create|terraform apply|az account set)\b/i,
  );

  console.log("Startup provider remediation fixture tests passed.");
} finally {
  rmSync(stateRootPath, { recursive: true, force: true });
  rmSync(cliFixturePath, { recursive: true, force: true });
}

function existsSyncSafe(path) {
  return existsSync(path);
}
