import { readinessEvidenceDigest } from "../scripts/startup-iac-plan.mjs";

const observedAt = "2026-08-08T10:00:00Z";
const attestedAt = "2026-08-08T10:30:00Z";
const expiresAt = "2026-08-12T13:00:00Z";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function codeEvidence(status, issuer, reference, character, extra = {}) {
  return {
    status,
    issuer,
    reference,
    observedAt,
    expiresAt,
    evidenceDigest: digest(character),
    ...extra,
  };
}

function humanAttestation(
  status,
  issuerRole,
  reference,
  subjectScope,
  character,
  extra = {},
) {
  return {
    status,
    issuerRole,
    reference,
    subjectScope,
    attestedAt,
    expiresAt,
    evidenceDigest: digest(character),
    ...extra,
  };
}

function buildReadinessEvidence(input) {
  const environments = Object.fromEntries(
    input.target.environments.map((environment) => [
      environment.name,
      environment.subscriptionId,
    ]),
  );
  const secondary =
    input.regionalPlan.requestedRegionalMode === "single-region-ready"
      ? null
      : input.regionalPlan.secondaryRecommendation.region;
  const regions = [
    { role: "primary", region: input.regionalPlan.selectedPrimary.region },
    ...(secondary ? [{ role: "secondary", region: secondary }] : []),
  ];
  const targetRtoMinutes = input.regionalPlan.recoveryTargets.rtoMinutes;
  const targetRpoMinutes = input.regionalPlan.recoveryTargets.rpoMinutes;
  const selectedProfiles = [
    input.workloadPlan.computeProfile,
    ...input.workloadPlan.profileExtensions,
  ];
  const evidence = {
    schemaVersion: "2.0.0",
    evidenceId: `readiness.${input.planId}.001`,
    status: "ready",
    issuedAt: observedAt,
    expiresAt,
    subject: {
      planId: input.planId,
      tenantId: input.target.tenantId,
      prodSubscriptionId: environments.prod,
      nonprodSubscriptionId: environments.nonprod,
      profileVersion: input.workloadPlan.profileVersion,
      computeProfile: input.workloadPlan.computeProfile,
      profileExtensions: [...input.workloadPlan.profileExtensions],
      regionalMode: input.regionalPlan.requestedRegionalMode,
      primaryRegion: input.regionalPlan.selectedPrimary.region,
      secondaryRegion: secondary,
    },
    codeEvidence: {
      preflight: codeEvidence(
        "pass",
        "startup-preflight.mjs",
        "preflight.run-ready-001",
        "1",
      ),
      regional: regions.map(({ role, region }, index) =>
        codeEvidence(
          "pass",
          "startup-regional-plan.mjs",
          `regional.${role}.001`,
          String(index + 2),
          { role, region },
        ),
      ),
      foundry: input.workloadPlan.profileExtensions.includes("foundry")
        ? regions.map(({ role, region }, index) =>
            codeEvidence(
              "pass",
              "startup-regional-plan.mjs",
              `foundry.${role}.001`,
              String(index + 4),
              {
                role,
                region,
                modelReference: "model.fixture-gpt41",
                modelVersion: "2026-01-15",
                deploymentType: "GlobalStandard",
                requiredQuota: 10,
                availableQuota: 20,
                quotaUnit: "k-tpm",
              },
            ),
          )
        : [],
    },
    humanAttestations: {
      startupBillingSupport: humanAttestation(
        "confirmed",
        "role.microsoft-startups-support",
        "attestation.billing-support.001",
        "microsoft-for-startups-billing-and-support",
        "6",
        { attestationVersion: "1.0.0" },
      ),
      externalReviews: {
        security: humanAttestation(
          "approved",
          "role.security-reviewer",
          "review.security.001",
          "sslz-security-review",
          "8",
          { attestationVersion: "1.0.0" },
        ),
        azureArchitecture: humanAttestation(
          "approved",
          "role.azure-architecture-reviewer",
          "review.azure-architecture.001",
          "azure-architecture-review",
          "9",
          { attestationVersion: "1.0.0" },
        ),
        iacParity: humanAttestation(
          "approved",
          "role.iac-parity-reviewer",
          "review.iac-parity.001",
          "bicep-terraform-parity-review",
          "0",
          { attestationVersion: "1.0.0" },
        ),
      },
      failoverOwner: humanAttestation(
        "confirmed",
        "role.platform-governance",
        "attestation.failover-owner.001",
        "workload-failover-accountability",
        "7",
        {
          ownerReference: "identity.oncall-primary",
          roleReference: "role.incident-commander",
        },
      ),
      recoveryMeasurements: selectedProfiles.map((profileId, index) =>
        humanAttestation(
          "met",
          "role.recovery-test-authority",
          `measurement.${profileId}.001`,
          "profile-recovery-measurement",
          String.fromCharCode(97 + index),
          {
            profileId,
            targetRtoMinutes,
            targetRpoMinutes,
            measuredRtoMinutes: Math.max(0, targetRtoMinutes - 5),
            measuredRpoMinutes: Math.max(0, targetRpoMinutes - 2),
          },
        ),
      ),
      serviceRecoveryTests: input.workloadPlan.profileExtensions.map(
        (profileExtension, index) =>
          humanAttestation(
            "pass",
            "role.recovery-test-authority",
            `service-test.${profileExtension}.001`,
            "service-specific-recovery-test",
            String.fromCharCode(100 + index),
            { profileExtension },
          ),
      ),
      coolFootprintCost:
        input.regionalPlan.requestedRegionalMode === "cool-infrastructure"
          ? humanAttestation(
              "confirmed",
              "role.finops-reviewer",
              "cost.cool-footprint.001",
              "cool-secondary-footprint-cost",
              "f",
              {
                currency:
                  input.regionalPlan.costAssumptions.currency,
                minimum:
                  input.regionalPlan.costAssumptions.secondaryBaseline.minimum,
                maximum:
                  input.regionalPlan.costAssumptions.secondaryBaseline.maximum,
                provenanceReference: "pricing.azure-calculator.001",
              },
            )
          : null,
    },
    evidenceDigest: digest("0"),
  };
  evidence.evidenceDigest = readinessEvidenceDigest(evidence);
  return evidence;
}

export { buildReadinessEvidence };
