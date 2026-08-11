#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateIacPlan,
  readinessEvidenceDigest,
} from "../scripts/startup-iac-plan.mjs";
import {
  GATE_IDS,
  deriveResume,
  evaluateGates,
  generateCoolFoundationPlan,
  validateCoolFoundationPlan,
  validateStepStateSemantics,
} from "../scripts/startup-cool-foundation-plan.mjs";
import { planRegions } from "../scripts/startup-regional-plan.mjs";
import { planWorkload } from "../scripts/startup-workload-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";
import { buildReadinessEvidence } from "./readiness-fixture.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evaluatedAt = Date.parse("2026-08-09T12:00:00Z");
const outputRelative = `.sslz/generated/cool-foundation-tests-${process.pid}`;
const outputPath = resolve(root, outputRelative);
const regionalInput = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/regional-planning-input.json"),
    "utf8",
  ),
);
const baseline = JSON.parse(
  readFileSync(
    resolve(root, "agent/examples/cool-foundation-baseline.json"),
    "utf8",
  ),
);
const planSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/cool-foundation-plan.schema.json"),
    "utf8",
  ),
);
const manifestSchema = JSON.parse(
  readFileSync(
    resolve(root, "agent/schemas/cool-foundation-manifest.schema.json"),
    "utf8",
  ),
);

function createInput() {
  const planningInput = structuredClone(regionalInput);
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
    planId: "phase-seven-cool-test",
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
        keyPrefix: "phase-seven",
      },
    },
    approval: null,
  };
  input.readinessEvidence = buildReadinessEvidence(input);
  return input;
}

function gateStatus(plan, id) {
  return plan.gateResults.find((item) => item.id === id).status;
}

function reevaluate(sourcePlan, changedBaseline = baseline) {
  return evaluateGates(sourcePlan, changedBaseline, evaluatedAt);
}

function status(gates, id) {
  return gates.find((item) => item.id === id).status;
}

try {
  const input = createInput();
  const first = generateIacPlan(input, {
    outputPath: `${outputRelative}/phase4-pending`,
    evaluatedAt,
  });
  input.approval = {
    status: "approved",
    planId: input.planId,
    planDigest: first.planDigest,
    approvedAt: "2026-08-09T11:00:00Z",
    expiresAt: "2026-08-09T13:00:00Z",
  };
  const sourcePlan = generateIacPlan(input, {
    outputPath: `${outputRelative}/phase4-approved`,
    evaluatedAt,
  });
  const plan = generateCoolFoundationPlan(sourcePlan, baseline, {
    outputPath: `${outputRelative}/cool`,
    evaluatedAt,
  });

  validateDocument(planSchema, plan);
  validateCoolFoundationPlan(plan);
  assert.equal(plan.status, "ready-for-review");
  assert.equal(plan.mode, "cool-infrastructure");
  assert.equal(plan.environment, "nonprod");
  assert.equal(plan.safety.executionEnabled, false);
  assert.equal(plan.safety.azureOperations, "none");
  assert.equal(plan.safety.singleExecutableProductionMode, "single-region-ready");
  assert.equal(plan.approvalBinding.status, "pending");
  assert.equal(plan.approvalBinding.executionApprovalAccepted, false);
  assert.equal(plan.manifests.length, 2);
  assert(plan.gateResults.every((item) => item.status === "pass"));
  const excessManifest = structuredClone(plan);
  excessManifest.manifests.push(structuredClone(excessManifest.manifests[0]));
  assert.throws(
    () => validateDocument(planSchema, excessManifest),
    /maximum item count is 2/,
  );
  const excessApprovalDigest = structuredClone(plan);
  excessApprovalDigest.approvalBinding.manifestDigests.push(
    `sha256:${"f".repeat(64)}`,
  );
  assert.throws(
    () => validateDocument(planSchema, excessApprovalDigest),
    /maximum item count is 2/,
  );
  assert.deepEqual(plan.foundation.excludedCapabilities, [
    "data-failover",
    "data-replication",
    "global-ingress",
    "production-execution",
    "profile-workload",
    "traffic-failover",
  ]);
  assert.notEqual(
    plan.foundation.primary.vnetCidr,
    plan.foundation.secondary.vnetCidr,
  );
  assert.match(
    plan.foundation.isolation.terraformState,
    /-nonprod-secondary\.tfstate$/,
  );
  assert.doesNotMatch(
    plan.foundation.isolation.terraformState,
    /-nonprod-primary\.tfstate$/,
  );

  const manifests = plan.manifests.map((binding) =>
    JSON.parse(readFileSync(resolve(root, binding.path), "utf8")),
  );
  manifests.forEach((manifest) => {
    validateDocument(manifestSchema, manifest);
    validateStepStateSemantics(manifest);
    assert.equal(manifest.safety.executionEnabled, false);
    assert.equal(manifest.resume.action, "start");
    assert.equal(manifest.resume.allowed, false);
    assert.notEqual(
      manifest.stateIsolation.identifier,
      manifest.stateIsolation.primaryIdentifier,
    );
    assert(manifest.postchecks.every((item) => item.status === "not-run"));
    assert.equal(manifest.teardown.intent, "review-only");
  });
  assert.equal(
    manifests[0].artifacts.decisionDigest,
    manifests[1].artifacts.decisionDigest,
  );
  assert.equal(gateStatus(plan, GATE_IDS.parity), "pass");

  const bicepSource = readFileSync(
    resolve(root, "infra/bicep/cool-foundation.bicep"),
    "utf8",
  );
  const terraformSource = readFileSync(
    resolve(root, "infra/terraform/cool-foundation/main.tf"),
    "utf8",
  );
  for (const source of [bicepSource, terraformSource]) {
    assert.match(source, /monitoring/i);
    assert.match(source, /networking/i);
    assert.doesNotMatch(
      source,
      /front\s*door|traffic\s*manager|global.?ingress|failover|postgres|container.?app|kubernetes|aks/i,
    );
  }

  const expired = structuredClone(sourcePlan);
  expired.readinessEvidence.expiresAt = "2026-08-09T11:59:59Z";
  expired.readinessEvidence.evidenceDigest = readinessEvidenceDigest(
    expired.readinessEvidence,
  );
  assert.equal(
    status(reevaluate(expired), GATE_IDS.region),
    "blocked",
  );

  const mismatchedRegion = structuredClone(sourcePlan);
  mismatchedRegion.readinessEvidence.subject.secondaryRegion = "westus3";
  mismatchedRegion.readinessEvidence.evidenceDigest = readinessEvidenceDigest(
    mismatchedRegion.readinessEvidence,
  );
  assert.equal(
    status(reevaluate(mismatchedRegion), GATE_IDS.region),
    "blocked",
  );

  for (const [mutate, id] of [
    [
      (item) => {
        item.readinessEvidence.humanAttestations.startupBillingSupport.status =
          "pending";
      },
      GATE_IDS.billing,
    ],
    [
      (item) => {
        item.readinessEvidence.humanAttestations.failoverOwner.status =
          "pending";
      },
      GATE_IDS.owner,
    ],
    [
      (item) => {
        item.readinessEvidence.humanAttestations.externalReviews.security.status =
          "pending";
      },
      GATE_IDS.reviews,
    ],
    [
      (item) => {
        item.readinessEvidence.humanAttestations.recoveryMeasurements[0].status =
          "unmet";
      },
      GATE_IDS.objectives,
    ],
    [
      (item) => {
        item.readinessEvidence.humanAttestations.recoveryExercise.status =
          "not-tested";
      },
      GATE_IDS.exercise,
    ],
    [
      (item) => {
        item.readinessEvidence.humanAttestations.coolFootprintCost.ceilingPercent =
          20;
      },
      GATE_IDS.cost,
    ],
  ]) {
    const changed = structuredClone(sourcePlan);
    mutate(changed);
    changed.readinessEvidence.evidenceDigest = readinessEvidenceDigest(
      changed.readinessEvidence,
    );
    assert.equal(status(reevaluate(changed), id), "blocked", id);
  }

  const pendingApproval = structuredClone(sourcePlan);
  pendingApproval.approval.status = "pending";
  assert.equal(
    status(reevaluate(pendingApproval), GATE_IDS.sourceApproval),
    "blocked",
  );

  const parityMismatch = structuredClone(sourcePlan);
  parityMismatch.artifacts.find(
    (item) =>
      item.provider === "terraform" &&
      item.environment === "nonprod" &&
      item.regionRole === "secondary",
  ).decisionDigest = `sha256:${"0".repeat(64)}`;
  assert.equal(
    status(reevaluate(parityMismatch), GATE_IDS.parity),
    "blocked",
  );

  const secondaryBicep = sourcePlan.artifacts.find(
    (item) =>
      item.provider === "bicep" &&
      item.environment === "nonprod" &&
      item.regionRole === "secondary",
  );
  const parameterPath = resolve(root, secondaryBicep.path);
  const originalParameter = readFileSync(parameterPath, "utf8");
  writeFileSync(parameterPath, `${originalParameter}\n// digest mutation\n`);
  try {
    assert.equal(
      status(reevaluate(sourcePlan), GATE_IDS.artifacts),
      "blocked",
    );
  } finally {
    writeFileSync(parameterPath, originalParameter);
  }

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

  const invalidPartial = structuredClone(stateManifest);
  invalidPartial.steps[2].state = "running";
  invalidPartial.resume = deriveResume(invalidPartial.steps);
  assert.throws(
    () => validateStepStateSemantics(invalidPartial),
    /after the active step must remain pending/,
  );

  const deploymentIntegration = readFileSync(
    resolve(root, "scripts/startup-deployment-integration.mjs"),
    "utf8",
  );
  assert.match(deploymentIntegration, /mode !== "single-region-ready"/);
  assert.match(deploymentIntegration, /deployment\.regional\.unsupported/);
  assert.doesNotMatch(
    readFileSync(
      resolve(root, ".github/workflows/deploy-bicep.yml"),
      "utf8",
    ),
    /cool-infrastructure/,
  );
  assert.doesNotMatch(
    readFileSync(
      resolve(root, ".github/workflows/deploy-terraform.yml"),
      "utf8",
    ),
    /cool-infrastructure/,
  );

  console.log("Cool foundation planning tests passed.");
} finally {
  rmSync(outputPath, { recursive: true, force: true });
}
