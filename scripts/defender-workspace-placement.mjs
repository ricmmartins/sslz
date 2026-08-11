import { createHash } from "node:crypto";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WORKSPACE_ID =
  /^\/subscriptions\/([0-9a-f-]{36})\/resourcegroups\/([^/]+)\/providers\/microsoft\.operationalinsights\/workspaces\/([^/]+)$/i;
export const DEFENDER_WORKSPACE_CHECK_ID =
  "operations.monitoring.destination-valid";

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

function evidenceDigest(evidence) {
  const { evidenceDigest: omitted, ...payload } = evidence;
  return digest(payload);
}

function defenderWorkspaceDecisionDigest(decision) {
  const { decisionDigest: omitted, ...payload } = decision;
  return digest(payload);
}

function normalizeRegion(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/\s+/g, "") : null;
}

function normalizeRegions(values) {
  return [...new Set((values ?? []).map(normalizeRegion).filter(Boolean))].sort();
}

function currentEvidence(evidence, planningAt) {
  if (!evidence) {
    return false;
  }
  const observedAt = Date.parse(evidence.observedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  return (
    Number.isFinite(observedAt) &&
    Number.isFinite(expiresAt) &&
    observedAt <= planningAt &&
    expiresAt > planningAt &&
    expiresAt > observedAt &&
    evidenceDigest(evidence) === evidence.evidenceDigest
  );
}

function workspaceDependentPlans(paidPlans) {
  return paidPlans?.defenderForServers === true ? ["defenderForServers"] : [];
}

function buildDefenderWorkspaceDecision({
  decisionId,
  generatedAt,
  expiresAt,
  planningAt = Date.parse(generatedAt),
  tenantId,
  subscriptionId,
  targetSubscriptionIds = [subscriptionId],
  primaryRegion,
  paidPlans,
  placement,
  policyEvidence,
  serviceSupportEvidence,
  dataResidencyEvidence,
  workspaceEvidence = null,
  centralWorkspaceEvidence = null,
}) {
  const normalizedTenant = String(tenantId ?? "").toLowerCase();
  const normalizedSubscription = String(subscriptionId ?? "").toLowerCase();
  const normalizedTargets = [
    ...new Set(
      (targetSubscriptionIds ?? [])
        .map((value) => String(value).toLowerCase())
        .filter((value) => UUID.test(value)),
    ),
  ].sort();
  const normalizedPrimary = normalizeRegion(primaryRegion);
  const requiredByPlans = workspaceDependentPlans(paidPlans);
  const paidPlanSelectionDigest = digest(
    Object.fromEntries(
      Object.entries(paidPlans ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
  const defenderWorkspaceRequired = requiredByPlans.length > 0;
  let status = defenderWorkspaceRequired ? "blocked" : "not-required";
  let reasonCode = defenderWorkspaceRequired
    ? "workspace.placement-ambiguous"
    : "workspace.defender-disabled";
  let mode = defenderWorkspaceRequired ? "unsupported-default" : "disabled";
  let region = defenderWorkspaceRequired
    ? normalizeRegion(
        placement?.mode === "existing"
          ? workspaceEvidence?.location
          : placement?.region,
      )
    : null;
  let workspaceReference = null;
  let workspaceReferenceDigest = null;
  let scopeDigest = null;

  const policyCurrent = currentEvidence(policyEvidence, planningAt);
  const serviceCurrent = currentEvidence(serviceSupportEvidence, planningAt);
  const residencyCurrent = currentEvidence(dataResidencyEvidence, planningAt);
  const workspaceCurrent = currentEvidence(workspaceEvidence, planningAt);
  const allowedLocations = normalizeRegions(policyEvidence?.allowedLocations);
  const supportedRegions = normalizeRegions(serviceSupportEvidence?.supportedRegions);
  const residencyRegions = normalizeRegions(dataResidencyEvidence?.allowedRegions);
  const policyScopeMatches =
    String(policyEvidence?.tenantId ?? "").toLowerCase() === normalizedTenant &&
    canonicalJson(normalizeRegions(policyEvidence?.targetSubscriptionIds)) ===
      canonicalJson(normalizedTargets);
  const residencyScopeMatches =
    String(dataResidencyEvidence?.tenantId ?? "").toLowerCase() ===
      normalizedTenant &&
    canonicalJson(
      normalizeRegions(dataResidencyEvidence?.targetSubscriptionIds),
    ) === canonicalJson(normalizedTargets);

  if (defenderWorkspaceRequired) {
    if (!policyEvidence) {
      reasonCode = "workspace.policy-evidence-missing";
    } else if (!policyCurrent) {
      reasonCode = "workspace.policy-evidence-stale";
    } else if (!policyScopeMatches) {
      reasonCode = "workspace.policy-evidence-scope-mismatch";
    } else if (!serviceCurrent) {
      reasonCode = "workspace.service-evidence-stale";
    } else if (!residencyCurrent) {
      reasonCode = "workspace.residency-evidence-stale";
    } else if (!residencyScopeMatches) {
      reasonCode = "workspace.residency-evidence-scope-mismatch";
    } else if (
      !placement ||
      !["new", "existing"].includes(placement.mode) ||
      (placement.mode === "new" && !region)
    ) {
      reasonCode = "workspace.placement-ambiguous";
    } else if (placement.mode === "existing" && !workspaceEvidence) {
      reasonCode = "workspace.existing-evidence-missing";
    } else if (placement.mode === "existing" && !workspaceCurrent) {
      reasonCode = "workspace.existing-evidence-stale";
    } else if (!allowedLocations.includes(region)) {
      reasonCode = "workspace.region-denied";
    } else if (!supportedRegions.includes(region)) {
      reasonCode = "workspace.region-unsupported";
    } else if (!residencyRegions.includes(region)) {
      reasonCode = "workspace.data-residency-mismatch";
    } else if (placement.mode === "new") {
      mode = "new";
      if (region !== normalizedPrimary) {
        reasonCode = "workspace.primary-region-mismatch";
      } else {
        status = "ready";
        reasonCode = "workspace.explicit-new-compatible";
        workspaceReference = `new:${normalizedTenant}:${normalizedSubscription}:${region}`;
        workspaceReferenceDigest = digest(workspaceReference);
        scopeDigest = digest({
          tenantId: normalizedTenant,
          targetSubscriptionIds: normalizedTargets,
          region,
        });
      }
    } else {
      mode = "existing";
      const match = String(placement.workspaceResourceId ?? "").match(WORKSPACE_ID);
      const workspaceTenant = String(placement.tenantId ?? "").toLowerCase();
      const workspaceSubscription =
        match?.[1]?.toLowerCase() ??
        String(placement.subscriptionId ?? "").toLowerCase();
      workspaceReference = match
        ? String(placement.workspaceResourceId).toLowerCase()
        : null;
      const crossSubscriptionPlacement = normalizedTargets.some(
        (target) => target !== workspaceSubscription,
      );
      const sharedPlacement = region !== normalizedPrimary;
      const centralCurrent = currentEvidence(centralWorkspaceEvidence, planningAt);
      if (!match) {
        reasonCode = "workspace.existing-reference-invalid";
      } else if (
        workspaceTenant !== normalizedTenant ||
        (placement.subscriptionId &&
          String(placement.subscriptionId).toLowerCase() !== workspaceSubscription)
      ) {
        reasonCode = "workspace.existing-scope-mismatch";
      } else if (
        String(workspaceEvidence.tenantId).toLowerCase() !== normalizedTenant ||
        String(workspaceEvidence.subscriptionId).toLowerCase() !==
          workspaceSubscription ||
        String(workspaceEvidence.workspaceResourceId).toLowerCase() !==
          workspaceReference ||
        workspaceEvidence.provisioningState !== "Succeeded" ||
        !region
      ) {
        reasonCode = "workspace.existing-evidence-mismatch";
      } else if (crossSubscriptionPlacement) {
        reasonCode = "workspace.cross-subscription-unsupported";
      } else if (sharedPlacement && !centralWorkspaceEvidence) {
        reasonCode = "workspace.central-evidence-missing";
      } else if (sharedPlacement && !centralCurrent) {
        reasonCode = "workspace.central-evidence-stale";
      } else if (
        sharedPlacement &&
        (String(centralWorkspaceEvidence.tenantId).toLowerCase() !==
          normalizedTenant ||
          String(centralWorkspaceEvidence.subscriptionId).toLowerCase() !==
            workspaceSubscription ||
          centralWorkspaceEvidence.workspaceReferenceDigest !==
           digest(workspaceReference) ||
          canonicalJson(
           normalizeRegions(centralWorkspaceEvidence.targetSubscriptionIds),
          ) !== canonicalJson(normalizedTargets))
      ) {
        reasonCode = "workspace.central-evidence-mismatch";
      } else {
        status = "ready";
        reasonCode = sharedPlacement
          ? "workspace.existing-central-compatible"
          : "workspace.existing-compatible";
        workspaceReferenceDigest = digest(workspaceReference);
        scopeDigest = digest({
          tenantId: workspaceTenant,
          subscriptionId: workspaceSubscription,
          targetSubscriptionIds: normalizedTargets,
          resourceGroup: match[2].toLowerCase(),
          workspaceName: match[3].toLowerCase(),
          region,
        });
      }
    }

    if (status === "ready") {
      const requiredEvidence = [
        policyEvidence,
        serviceSupportEvidence,
        dataResidencyEvidence,
        ...(mode === "existing" ? [workspaceEvidence] : []),
        ...(mode === "existing" &&
        region !== normalizedPrimary
          ? [centralWorkspaceEvidence]
          : []),
      ];
      const decisionExpiry = Date.parse(expiresAt);
      if (
        !Number.isFinite(decisionExpiry) ||
        requiredEvidence.some(
          (item) =>
            !item ||
            !Number.isFinite(Date.parse(item.expiresAt)) ||
            Date.parse(item.expiresAt) < decisionExpiry,
        )
      ) {
        status = "blocked";
        reasonCode = "workspace.decision-expiry-exceeds-evidence";
      }
    }
  }

  const decision = {
    schemaVersion: "1.0.0",
    decisionId,
    generatedAt,
    expiresAt,
    status,
    reasonCode,
    tenantId: normalizedTenant,
    subscriptionId: normalizedSubscription,
    targetSubscriptionIds: normalizedTargets,
    primaryRegion: normalizedPrimary,
    defenderWorkspaceRequired,
    requiredByPlans,
    paidPlanSelectionDigest,
    placement: {
      mode,
      region,
      workspaceReference,
      workspaceReferenceDigest,
      scopeDigest,
    },
    evidence: {
      policyEvidenceDigest: policyEvidence?.evidenceDigest ?? null,
      policyEvidenceExpiresAt: policyEvidence?.expiresAt ?? null,
      serviceSupportEvidenceDigest:
        serviceSupportEvidence?.evidenceDigest ?? null,
      serviceSupportEvidenceExpiresAt:
        serviceSupportEvidence?.expiresAt ?? null,
      dataResidencyEvidenceDigest:
        dataResidencyEvidence?.evidenceDigest ?? null,
      dataResidencyEvidenceExpiresAt:
        dataResidencyEvidence?.expiresAt ?? null,
      workspaceEvidenceDigest: workspaceEvidence?.evidenceDigest ?? null,
      workspaceEvidenceExpiresAt: workspaceEvidence?.expiresAt ?? null,
      centralWorkspaceEvidenceDigest:
        centralWorkspaceEvidence?.evidenceDigest ?? null,
      centralWorkspaceEvidenceExpiresAt:
        centralWorkspaceEvidence?.expiresAt ?? null,
    },
    decisionDigest: null,
  };
  decision.decisionDigest = defenderWorkspaceDecisionDigest(decision);
  return decision;
}

export {
  buildDefenderWorkspaceDecision,
  canonicalJson,
  defenderWorkspaceDecisionDigest,
  digest,
  evidenceDigest,
};
