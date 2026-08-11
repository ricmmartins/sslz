import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonicalJson(value))
    .digest("hex")}`;
}

function topologyDecisionDigest(decision) {
  const { decisionDigest: omitted, ...payload } = decision;
  return digest(payload);
}

function subscriptionIdFromResourceId(value) {
  const match = String(value ?? "").match(
    /^\/subscriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function billingScopeDigests(billingProperty) {
  const properties = billingProperty?.properties ?? {};
  return [
    ["billing-account", properties.billingAccountId],
    ["billing-profile", properties.billingProfileId],
    ["invoice-section", properties.invoiceSectionId],
  ]
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([kind, value]) => digest(`${kind}:${value.toLowerCase()}`))
    .sort();
}

function benefitEvidence(benefits) {
  const subscriptionIds = new Set();
  const scopeDigests = new Set();
  for (const benefit of benefits ?? []) {
    const properties = benefit?.properties ?? {};
    for (const candidate of [
      benefit?.id,
      properties.resourceId,
      properties.appliedScopeId,
    ]) {
      const subscriptionId = subscriptionIdFromResourceId(candidate);
      if (subscriptionId) {
        subscriptionIds.add(subscriptionId);
      }
    }
    for (const [kind, value] of [
      ["billing-account", properties.billingAccountResourceId],
      ["billing-account", properties.billingAccountId],
      ["billing-profile", properties.billingProfileId],
      ["invoice-section", properties.invoiceSectionId],
    ]) {
      if (typeof value === "string" && value.length > 0) {
        scopeDigests.add(digest(`${kind}:${value.toLowerCase()}`));
      }
    }
  }
  return {
    subscriptionIds: [...subscriptionIds].sort(),
    scopeDigests: [...scopeDigests].sort(),
  };
}

function buildTopologyDecision({
  runId,
  generatedAt,
  expiresAt,
  selectionMode,
  tenantId,
  environments,
  visibleSubscriptions,
  subscriptionReadErrors,
  targetTenantMismatch,
  billingProperties,
  billingReadFailed,
  benefits,
  benefitsReadFailed,
}) {
  const normalizedEnvironments = environments
    .map((environment) => ({
      name: environment.name,
      subscriptionId: environment.subscriptionId.toLowerCase(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const targetIds = [...new Set(normalizedEnvironments.map((item) => item.subscriptionId))];
  const enabledVisible = (visibleSubscriptions ?? [])
    .filter(
      (subscription) =>
        UUID_PATTERN.test(subscription?.id ?? "") &&
        subscription?.state === "Enabled",
    )
    .map((subscription) => ({
      id: subscription.id.toLowerCase(),
      tenantId: String(subscription.tenantId ?? "").toLowerCase(),
    }));
  const visibleInTenant = enabledVisible.filter(
    (subscription) => subscription.tenantId === String(tenantId ?? "").toLowerCase(),
  );
  const visibleIds = new Set(visibleInTenant.map((subscription) => subscription.id));
  const missingTargetIds = targetIds.filter((id) => !visibleIds.has(id));

  let topologyState;
  let topologyReasonCode;
  if (targetTenantMismatch) {
    topologyState = "target-subscription-tenant-mismatch";
    topologyReasonCode = "topology.target-tenant-mismatch";
  } else if (subscriptionReadErrors || missingTargetIds.length > 0) {
    topologyState = "expected-target-subscriptions-missing";
    topologyReasonCode = "topology.expected-targets-missing";
  } else if (
    selectionMode === "one-subscription" &&
    (visibleInTenant.length !== 1 || targetIds.length !== 1)
  ) {
    topologyState = "unsupported-ambiguous-multi-subscription";
    topologyReasonCode = "topology.explicit-environment-mapping-required";
  } else if (targetIds.length === 1) {
    topologyState = "one-subscription-startup";
    topologyReasonCode = "topology.one-subscription-selected";
  } else {
    topologyState = "separate-prod-nonprod-subscriptions";
    topologyReasonCode = "topology.explicit-prod-nonprod-selected";
  }

  const targetScopeDigests = [
    ...new Set(
      (billingProperties ?? []).flatMap((property) =>
        billingScopeDigests(property),
      ),
    ),
  ].sort();
  const observedBenefits = benefitEvidence(benefits);
  const targetIdSet = new Set(targetIds);
  const benefitTargetsAnotherSubscription =
    observedBenefits.subscriptionIds.length > 0 &&
    observedBenefits.subscriptionIds.some((id) => !targetIdSet.has(id));
  const benefitTargetsAnotherBillingScope =
    observedBenefits.scopeDigests.length > 0 &&
    targetScopeDigests.length > 0 &&
    !observedBenefits.scopeDigests.some((item) =>
      targetScopeDigests.includes(item),
    );

  let benefitState;
  let benefitReasonCode;
  if (billingReadFailed || benefitsReadFailed) {
    benefitState = "billing-evidence-unavailable";
    benefitReasonCode = "topology.billing-read-unavailable";
  } else if (
    benefitTargetsAnotherSubscription ||
    benefitTargetsAnotherBillingScope
  ) {
    benefitState = "benefits-on-different-subscription-or-billing-profile";
    benefitReasonCode = "topology.benefit-target-mismatch";
  } else {
    benefitState = "credits-or-benefit-association-unknown";
    benefitReasonCode = "topology.authoritative-confirmation-required";
  }

  const subscriptionReady = [
    "one-subscription-startup",
    "separate-prod-nonprod-subscriptions",
  ].includes(topologyState);
  const supportRoute =
    benefitState === "billing-evidence-unavailable"
      ? "azure-billing-support"
      : "microsoft-for-startups-program-support";
  const decision = {
    schemaVersion: "1.0.0",
    decisionId: `topology.${runId}`,
    generatedAt,
    expiresAt,
    status: subscriptionReady && benefitState === "confirmed-for-exact-target"
      ? "ready"
      : "blocked",
    tenantId: tenantId?.toLowerCase() ?? null,
    environments: normalizedEnvironments,
    subscriptionTopology: {
      state: topologyState,
      reasonCode: topologyReasonCode,
      selectionMode,
      visibleEnabledSubscriptionCount: visibleInTenant.length,
      targetSubscriptionCount: targetIds.length,
    },
    benefitAssociation: {
      state: benefitState,
      reasonCode: benefitReasonCode,
      authoritativeEvidence:
        benefitState ===
        "benefits-on-different-subscription-or-billing-profile",
      targetBillingScopeDigests: targetScopeDigests,
      observedBenefitScopeDigests: observedBenefits.scopeDigests,
      observedBenefitSubscriptionIds: observedBenefits.subscriptionIds,
    },
    evidence: {
      subscriptionInventoryDigest: digest(
        enabledVisible
          .map((subscription) => ({
            id: subscription.id,
            tenantId: subscription.tenantId,
          }))
          .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
      ),
      billingEvidenceDigest: digest({
        targetBillingScopeDigests: targetScopeDigests,
        observedBenefitScopeDigests: observedBenefits.scopeDigests,
        observedBenefitSubscriptionIds: observedBenefits.subscriptionIds,
        billingReadFailed,
        benefitsReadFailed,
      }),
    },
    supportHandoff: {
      required: true,
      route: supportRoute,
      reference: null,
    },
    decisionDigest: null,
  };
  decision.decisionDigest = topologyDecisionDigest(decision);
  return decision;
}

export {
  buildTopologyDecision,
  canonicalJson,
  topologyDecisionDigest,
};
