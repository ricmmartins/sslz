#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDefenderWorkspaceDecision,
  defenderWorkspaceDecisionDigest,
  digest,
  evidenceDigest,
} from "../scripts/defender-workspace-placement.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/defender-workspace-placement.json"),
    "utf8",
  ),
);
const schema = JSON.parse(
  readFileSync(
    resolve(
      root,
      "agent/schemas/defender-workspace-placement-decision.schema.json",
    ),
    "utf8",
  ),
);

function evidence(value) {
  const result = structuredClone(value);
  result.evidenceDigest = evidenceDigest(result);
  return result;
}

function input(overrides = {}) {
  return {
    decisionId: "workspace.phase-four-test.prod",
    generatedAt: fixture.generatedAt,
    expiresAt: fixture.expiresAt,
    planningAt: Date.parse(fixture.planningAt),
    tenantId: fixture.tenantId,
    subscriptionId: fixture.subscriptionId,
    targetSubscriptionIds: [fixture.subscriptionId],
    primaryRegion: fixture.primaryRegion,
    paidPlans: structuredClone(fixture.paidPlans),
    placement: { mode: "new", region: "eastus2" },
    policyEvidence: evidence(fixture.policyEvidence),
    serviceSupportEvidence: evidence(fixture.serviceSupportEvidence),
    dataResidencyEvidence: evidence(fixture.dataResidencyEvidence),
    centralWorkspaceEvidence: null,
    ...overrides,
  };
}

function decision(overrides = {}) {
  return buildDefenderWorkspaceDecision(input(overrides));
}

function assertReason(result, status, reasonCode) {
  validateDocument(schema, result);
  assert.equal(result.status, status);
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(
    defenderWorkspaceDecisionDigest(result),
    result.decisionDigest,
  );
}

assertReason(
  decision({ placement: { mode: "new", region: "eastus" } }),
  "blocked",
  "workspace.region-denied",
);

const explicit = decision();
assertReason(explicit, "ready", "workspace.explicit-new-compatible");
assert.equal(explicit.placement.region, "eastus2");

const sameSubscriptionWorkspace =
  `/subscriptions/${fixture.subscriptionId}` +
  "/resourceGroups/rg-security/providers/Microsoft.OperationalInsights/workspaces/law-security";
const sameSubscriptionWorkspaceEvidence = evidence({
  observedAt: fixture.generatedAt,
  expiresAt: fixture.expiresAt,
  tenantId: fixture.tenantId,
  subscriptionId: fixture.subscriptionId,
  workspaceResourceId: sameSubscriptionWorkspace,
  location: "eastus2",
  provisioningState: "Succeeded",
});
assertReason(
  decision({
    placement: {
      mode: "existing",
      region: "eastus2",
      tenantId: fixture.tenantId,
      subscriptionId: fixture.subscriptionId,
      workspaceResourceId: sameSubscriptionWorkspace,
    },
    workspaceEvidence: sameSubscriptionWorkspaceEvidence,
  }),
  "ready",
  "workspace.existing-compatible",
);

assertReason(
  decision({
    placement: {
      mode: "existing",
      region: "eastus2",
      tenantId: fixture.tenantId,
      subscriptionId: fixture.subscriptionId,
      workspaceResourceId: sameSubscriptionWorkspace,
    },
  }),
  "blocked",
  "workspace.existing-evidence-missing",
);

assertReason(
  decision({
    placement: {
      mode: "existing",
      region: "eastus",
      tenantId: fixture.tenantId,
      subscriptionId: fixture.subscriptionId,
      workspaceResourceId: sameSubscriptionWorkspace,
    },
    workspaceEvidence: evidence({
      ...sameSubscriptionWorkspaceEvidence,
      location: "eastus",
      evidenceDigest: undefined,
    }),
  }),
  "blocked",
  "workspace.region-denied",
);

assertReason(
  decision({ policyEvidence: null }),
  "blocked",
  "workspace.policy-evidence-missing",
);

assertReason(
  decision({
    policyEvidence: evidence({
      ...fixture.policyEvidence,
      tenantId: "44444444-4444-4444-4444-444444444444",
    }),
  }),
  "blocked",
  "workspace.policy-evidence-scope-mismatch",
);

assertReason(
  decision({
    dataResidencyEvidence: evidence({
      ...fixture.dataResidencyEvidence,
      targetSubscriptionIds: [fixture.centralSubscriptionId],
    }),
  }),
  "blocked",
  "workspace.residency-evidence-scope-mismatch",
);

const disabledPlans = Object.fromEntries(
  Object.keys(fixture.paidPlans).map((name) => [name, false]),
);
assertReason(
  decision({
    paidPlans: disabledPlans,
    placement: null,
    policyEvidence: null,
    serviceSupportEvidence: null,
    dataResidencyEvidence: null,
  }),
  "not-required",
  "workspace.defender-disabled",
);

assertReason(
  decision({
    dataResidencyEvidence: evidence({
      ...fixture.dataResidencyEvidence,
      allowedRegions: ["centralus"],
    }),
  }),
  "blocked",
  "workspace.data-residency-mismatch",
);

assertReason(
  decision({ placement: null }),
  "blocked",
  "workspace.placement-ambiguous",
);

const centralWorkspace =
  `/subscriptions/${fixture.subscriptionId}` +
  "/resourceGroups/rg-central-security/providers/Microsoft.OperationalInsights/workspaces/law-central";
const centralEvidence = evidence({
  observedAt: fixture.generatedAt,
  expiresAt: fixture.expiresAt,
  tenantId: fixture.tenantId,
  subscriptionId: fixture.subscriptionId,
  workspaceReferenceDigest: digest(centralWorkspace.toLowerCase()),
  targetSubscriptionIds: [fixture.subscriptionId],
});
const centralObservedWorkspace = evidence({
  observedAt: fixture.generatedAt,
  expiresAt: fixture.expiresAt,
  tenantId: fixture.tenantId,
  subscriptionId: fixture.subscriptionId,
  workspaceResourceId: centralWorkspace,
  location: "centralus",
  provisioningState: "Succeeded",
});
assertReason(
  decision({
    placement: {
      mode: "existing",
      region: "centralus",
      tenantId: fixture.tenantId,
      subscriptionId: fixture.subscriptionId,
      workspaceResourceId: centralWorkspace,
    },
    workspaceEvidence: centralObservedWorkspace,
    centralWorkspaceEvidence: centralEvidence,
  }),
  "ready",
  "workspace.existing-central-compatible",
);

assertReason(
  decision({
    placement: {
      mode: "existing",
      region: "centralus",
      tenantId: fixture.tenantId,
      subscriptionId: fixture.subscriptionId,
      workspaceResourceId: centralWorkspace,
    },
    workspaceEvidence: centralObservedWorkspace,
  }),
  "blocked",
  "workspace.central-evidence-missing",
);

const crossSubscriptionWorkspace =
  `/subscriptions/${fixture.centralSubscriptionId}` +
  "/resourceGroups/rg-cross-sub-security/providers/Microsoft.OperationalInsights/workspaces/law-cross-sub";
assertReason(
  decision({
    placement: {
      mode: "existing",
      region: "eastus2",
      tenantId: fixture.tenantId,
      subscriptionId: fixture.centralSubscriptionId,
      workspaceResourceId: crossSubscriptionWorkspace,
    },
    workspaceEvidence: evidence({
      observedAt: fixture.generatedAt,
      expiresAt: fixture.expiresAt,
      tenantId: fixture.tenantId,
      subscriptionId: fixture.centralSubscriptionId,
      workspaceResourceId: crossSubscriptionWorkspace,
      location: "eastus2",
      provisioningState: "Succeeded",
    }),
  }),
  "blocked",
  "workspace.cross-subscription-unsupported",
);

assertReason(
  decision({
    placement: {
      mode: "existing",
      region: "eastus2",
      tenantId: "44444444-4444-4444-4444-444444444444",
      subscriptionId: fixture.subscriptionId,
      workspaceResourceId: sameSubscriptionWorkspace,
    },
    workspaceEvidence: sameSubscriptionWorkspaceEvidence,
  }),
  "blocked",
  "workspace.existing-scope-mismatch",
);

assertReason(
  decision({
    policyEvidence: evidence({
      ...fixture.policyEvidence,
      expiresAt: "2026-08-11T12:30:00Z",
    }),
  }),
  "blocked",
  "workspace.policy-evidence-stale",
);

assertReason(
  decision({
    policyEvidence: evidence({
      ...fixture.policyEvidence,
      expiresAt: "2026-08-11T13:30:00Z",
    }),
  }),
  "blocked",
  "workspace.decision-expiry-exceeds-evidence",
);

const mutated = structuredClone(explicit);
mutated.placement.region = "centralus";
assert.notEqual(
  defenderWorkspaceDecisionDigest(mutated),
  mutated.decisionDigest,
  "Mutating workspace placement must invalidate its digest",
);
assert.doesNotMatch(JSON.stringify(explicit), /secret|token|password|key=/i);

console.log("Defender workspace placement fixture tests passed.");
