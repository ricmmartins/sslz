import {
  CONTROL_PLANE_CAPABILITIES,
  OWNERSHIP_STATE_ORDER,
  controlPlaneOwnershipDigest,
} from "../scripts/startup-control-plane-ownership-plan.mjs";

const ROLE_BY_TYPE = Object.freeze({
  "source-cloud": "role.source-cloud-platform",
  azure: "role.azure-platform",
  "shared-platform": "role.shared-platform",
  application: "role.application",
  security: "role.security",
  network: "role.network",
  database: "role.database",
  incident: "role.incident",
});

const ACCOUNTABLE_TYPE = Object.freeze({
  "dns-zones-records-resolvers": "network",
  "certificate-issuance-renewal": "security",
  "secret-stores-references-rotation": "security",
  "cicd-pipelines-runners": "shared-platform",
  "artifact-promotion": "shared-platform",
  "observability-telemetry-alert-routing": "shared-platform",
  "incidents-oncall-escalation": "incident",
  "feature-flags-configuration": "application",
  "deployment-authority": "shared-platform",
  "database-writes": "database",
  "application-writes": "application",
  "source-of-truth-transfer": "database",
  "backup-restore": "database",
  cutover: "incident",
  rollback: "incident",
  failback: "incident",
});

const PROVIDER_SCOPED = new Set([
  "dns-zones-records-resolvers",
  "certificate-issuance-renewal",
  "secret-stores-references-rotation",
  "artifact-promotion",
  "deployment-authority",
  "database-writes",
  "application-writes",
  "source-of-truth-transfer",
  "backup-restore",
  "cutover",
  "rollback",
  "failback",
]);

const SOD_CAPABILITIES = new Set([
  "certificate-issuance-renewal",
  "secret-stores-references-rotation",
  "artifact-promotion",
  "deployment-authority",
  "database-writes",
  "application-writes",
  "source-of-truth-transfer",
  "cutover",
  "rollback",
  "failback",
]);

const digest = (character) => `sha256:${character.repeat(64)}`;

function authorityScope(state, capabilityId) {
  if (!PROVIDER_SCOPED.has(capabilityId)) return "shared";
  if (["coexistence", "pre-cutover", "rollback"].includes(state)) {
    return "source-cloud";
  }
  return "azure";
}

function assignment(state, capabilityId) {
  const accountable = ROLE_BY_TYPE[ACCOUNTABLE_TYPE[capabilityId]];
  const approvalAuthority = SOD_CAPABILITIES.has(capabilityId)
    ? accountable === ROLE_BY_TYPE.security
      ? ROLE_BY_TYPE.incident
      : ROLE_BY_TYPE.security
    : null;
  return {
    capabilityId,
    accountable,
    responsible: [accountable],
    consulted: [
      accountable === ROLE_BY_TYPE.security
        ? ROLE_BY_TYPE["shared-platform"]
        : ROLE_BY_TYPE.security,
    ],
    informed: [
      accountable === ROLE_BY_TYPE.incident
        ? ROLE_BY_TYPE.application
        : ROLE_BY_TYPE.incident,
    ],
    approvalAuthority,
    authorityScope: authorityScope(state, capabilityId),
  };
}

function handoff(transition, before, after) {
  const seed = {
    reference: `handoff.${transition.sequence}.${after.capabilityId}`,
    capabilityId: after.capabilityId,
    fromState: transition.fromState,
    toState: transition.toState,
    offeredBy: before.accountable,
    acceptedBy: after.accountable,
    approvalAuthority: after.approvalAuthority,
    observedAt: "2026-08-16T18:00:00Z",
    expiresAt: "2026-08-18T18:00:00Z",
    nonce: `nonce.handoff.${transition.sequence}.${after.capabilityId}`,
  };
  return {
    reference: seed.reference,
    capabilityId: seed.capabilityId,
    offeredBy: seed.offeredBy,
    acceptedBy: seed.acceptedBy,
    approvalAuthority: seed.approvalAuthority,
    accepted: true,
    observedAt: seed.observedAt,
    expiresAt: seed.expiresAt,
    nonce: seed.nonce,
    evidenceDigest: controlPlaneOwnershipDigest(seed),
  };
}

function finalizeIntegrity(input) {
  input.integrityClaims = {
    statesDigest: controlPlaneOwnershipDigest(input.states),
    transitionsDigest: controlPlaneOwnershipDigest(input.transitions),
    roleCatalogDigest: controlPlaneOwnershipDigest(input.roles),
  };
  return input;
}

function createControlPlaneOwnershipFixture(sourceProvider = "aws") {
  const trustedBindings = {
    predecessorProgramLineageEnvelopeDigest: digest("1"),
    programIdentityDigest: digest("2"),
    connectivityPlanDigest: digest("3"),
    postgresqlMigrationPlanDigest: digest("4"),
    containerImageCicdPlanDigest: digest("5"),
    readinessEvidenceDigest: digest("6"),
    iacPlanDigest: digest("7"),
    deploymentManifestDigest: digest("8"),
    deploymentApprovalDigest: digest("9"),
    environment: "prod",
    environmentReference: "environment.production.orders",
    targetReference: "target.postgresql.orders.flexible",
  };
  const states = OWNERSHIP_STATE_ORDER.map((state, index) => ({
    state,
    ordinal: index + 1,
    assignments: CONTROL_PLANE_CAPABILITIES.map((capabilityId) =>
      assignment(state, capabilityId),
    ),
  }));
  const transitions = OWNERSHIP_STATE_ORDER.slice(0, -1).map(
    (fromState, index) => {
      const transition = {
        sequence: index + 1,
        fromState,
        toState: OWNERSHIP_STATE_ORDER[index + 1],
        sourceOfTruthTransferApproved: false,
        handoffs: [],
      };
      const before = states[index];
      const after = states[index + 1];
      for (const next of after.assignments) {
        const prior = before.assignments.find(
          ({ capabilityId }) => capabilityId === next.capabilityId,
        );
        if (
          prior.accountable !== next.accountable ||
          prior.authorityScope !== next.authorityScope
        ) {
          transition.handoffs.push(handoff(transition, prior, next));
        }
      }
      transition.sourceOfTruthTransferApproved = transition.handoffs.some(
        ({ capabilityId }) => capabilityId === "source-of-truth-transfer",
      );
      return transition;
    },
  );
  const input = {
    schemaVersion: "1.0.0",
    planId: `ownership.synthetic.${sourceProvider}.orders.v1`,
    planningAt: "2026-08-16T21:00:00Z",
    maxEvidenceAgeHours: 48,
    evidenceMode: "synthetic",
    sourceProvider,
    target: {
      environment: trustedBindings.environment,
      environmentReference: trustedBindings.environmentReference,
      region: "centralus",
      targetReference: trustedBindings.targetReference,
    },
    integration: structuredClone(trustedBindings),
    roles: Object.entries(ROLE_BY_TYPE).map(([type, reference]) => ({
      reference,
      type,
    })),
    capabilities: [...CONTROL_PLANE_CAPABILITIES],
    states,
    escalationRoutes: [
      {
        fromRole: ROLE_BY_TYPE["source-cloud"],
        toRole: ROLE_BY_TYPE.azure,
      },
      {
        fromRole: ROLE_BY_TYPE.azure,
        toRole: ROLE_BY_TYPE["shared-platform"],
      },
      {
        fromRole: ROLE_BY_TYPE["shared-platform"],
        toRole: ROLE_BY_TYPE.application,
      },
      {
        fromRole: ROLE_BY_TYPE.application,
        toRole: ROLE_BY_TYPE.security,
      },
      {
        fromRole: ROLE_BY_TYPE.security,
        toRole: ROLE_BY_TYPE.network,
      },
      {
        fromRole: ROLE_BY_TYPE.network,
        toRole: ROLE_BY_TYPE.database,
      },
      {
        fromRole: ROLE_BY_TYPE.database,
        toRole: ROLE_BY_TYPE.incident,
      },
    ],
    transitions,
    lineage: {
      attemptOrdinal: 1,
      attemptNonce: `nonce.ownership.${sourceProvider}.orders.0001`,
      acceptedAttempts: [],
    },
    integrityClaims: {},
    safety: {
      executionEnabled: false,
      executionEligible: false,
      executionAllowed: false,
      liveOperations: "disabled",
    },
  };
  return {
    input: finalizeIntegrity(input),
    trustedBindings,
  };
}

export {
  ROLE_BY_TYPE,
  createControlPlaneOwnershipFixture,
  finalizeIntegrity,
};
