#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PLANNER_VERSION = "1.0.0";

const CONTROL_PLANE_CAPABILITIES = Object.freeze([
  "dns-zones-records-resolvers",
  "certificate-issuance-renewal",
  "secret-stores-references-rotation",
  "cicd-pipelines-runners",
  "artifact-promotion",
  "observability-telemetry-alert-routing",
  "incidents-oncall-escalation",
  "feature-flags-configuration",
  "deployment-authority",
  "database-writes",
  "application-writes",
  "source-of-truth-transfer",
  "backup-restore",
  "cutover",
  "rollback",
  "failback",
]);

const OWNERSHIP_STATE_ORDER = Object.freeze([
  "coexistence",
  "pre-cutover",
  "cutover",
  "post-cutover",
  "rollback",
  "failback",
]);

const REQUIRED_ROLE_TYPES = Object.freeze([
  "source-cloud",
  "azure",
  "shared-platform",
  "application",
  "security",
  "network",
  "database",
  "incident",
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

const REQUIRED_ACCOUNTABLE_ROLE = Object.freeze({
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

const CONTROL_PLANE_OWNERSHIP_CHECK_IDS = Object.freeze({
  artifactsBound: "control.ownership.artifacts-bound",
  raciComplete: "control.ownership.raci-complete",
  authorityUnambiguous: "control.ownership.authority-unambiguous",
  separationOfDuties: "control.ownership.separation-of-duties",
  escalationAcyclic: "control.ownership.escalation-acyclic",
  sourceOfTruthAuthorized: "control.ownership.source-of-truth-authorized",
  recoveryOwned: "control.ownership.rollback-failback-owned",
  evidenceCurrent: "control.ownership.evidence-current",
  handoffIntegrity: "control.ownership.handoff-integrity",
  replayProtected: "control.ownership.replay-protected",
  transitionOrderValid: "control.ownership.transition-order-valid",
  lineageMonotonic: "control.ownership.lineage-monotonic",
  safetyEnforced: "control.ownership.safety-enforced",
});
const CONTROL_PLANE_OWNERSHIP_CHECK_ORDER = Object.freeze(
  Object.values(CONTROL_PLANE_OWNERSHIP_CHECK_IDS),
);

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const inputSchema = load(
  "agent/schemas/control-plane-ownership-plan-input.schema.json",
);
const outputSchema = load(
  "agent/schemas/control-plane-ownership-plan.schema.json",
);
const trustedBindingsSchema = load(
  "agent/schemas/control-plane-ownership-trusted-bindings.schema.json",
);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertOpaqueMetadata(value, path = "$") {
  const forbiddenKey =
    /(?:password|passphrase|token|connection.?string|private.?key|client.?secret|access.?key|tenant.?id|subscription.?id|email)/i;
  const forbiddenValue = [
    /@[a-z0-9.-]+\.[a-z]{2,}/i,
    /\b[0-9a-f]{8}-[0-9a-f]{27,}\b/i,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /\b(?:az|terraform|kubectl|docker|psql|curl)\s+/i,
  ];
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOpaqueMetadata(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      forbiddenValue.some((pattern) => pattern.test(value))
    ) {
      throw new Error(
        `control.ownership.sanitized-metadata: ${path} must contain only opaque non-PII references.`,
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) {
      throw new Error(
        `control.ownership.sanitized-metadata: ${path}.${key} is not an allowed metadata field.`,
      );
    }
    assertOpaqueMetadata(child, `${path}.${key}`);
  }
}

function resultCheck(id, passes, summary, evidenceReferences = []) {
  return {
    id,
    classification: passes ? "pass" : "fail",
    summary,
    evidenceReferences: [...new Set(evidenceReferences)].sort(),
  };
}

function roleMap(input) {
  return new Map(input.roles.map((role) => [role.reference, role.type]));
}

function roleSetComplete(input) {
  const types = input.roles.map(({ type }) => type);
  return (
    input.roles.length === REQUIRED_ROLE_TYPES.length &&
    new Set(input.roles.map(({ reference }) => reference)).size ===
      input.roles.length &&
    new Set(types).size === REQUIRED_ROLE_TYPES.length &&
    REQUIRED_ROLE_TYPES.every((type) => types.includes(type))
  );
}

function assignmentsComplete(input) {
  if (
    !same(input.capabilities, CONTROL_PLANE_CAPABILITIES) ||
    input.states.length !== OWNERSHIP_STATE_ORDER.length
  ) {
    return false;
  }
  return input.states.every((state, index) => {
    const ids = state.assignments.map(({ capabilityId }) => capabilityId);
    return (
      state.state === OWNERSHIP_STATE_ORDER[index] &&
      state.ordinal === index + 1 &&
      ids.length === CONTROL_PLANE_CAPABILITIES.length &&
      new Set(ids).size === ids.length &&
      same(ids, CONTROL_PLANE_CAPABILITIES) &&
      state.assignments.every(
        (assignment) =>
          typeof assignment.accountable === "string" &&
          assignment.responsible.length > 0 &&
          new Set(assignment.responsible).size ===
            assignment.responsible.length &&
          new Set(assignment.consulted).size === assignment.consulted.length &&
          new Set(assignment.informed).size === assignment.informed.length,
      )
    );
  });
}

function authorityIsUnambiguous(input, roles) {
  const validScopes = new Set(["source-cloud", "azure", "shared"]);
  return input.states.every((state) =>
    state.assignments.every((assignment) => {
      const expectedRole = REQUIRED_ACCOUNTABLE_ROLE[assignment.capabilityId];
      return (
        typeof assignment.accountable === "string" &&
        roles.get(assignment.accountable) === expectedRole &&
        validScopes.has(assignment.authorityScope)
      );
    }),
  );
}

function separationOfDutiesValid(input) {
  return input.states.every((state) =>
    state.assignments.every((assignment) => {
      if (!SOD_CAPABILITIES.has(assignment.capabilityId)) return true;
      return (
        typeof assignment.approvalAuthority === "string" &&
        assignment.approvalAuthority !== assignment.accountable &&
        !assignment.responsible.includes(assignment.approvalAuthority)
      );
    }),
  );
}

function escalationIsAcyclic(input) {
  const edges = new Map();
  for (const route of input.escalationRoutes) {
    if (route.fromRole === route.toRole) return false;
    if (!edges.has(route.fromRole)) edges.set(route.fromRole, []);
    edges.get(route.fromRole).push(route.toRole);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (role) => {
    if (visiting.has(role)) return false;
    if (visited.has(role)) return true;
    visiting.add(role);
    for (const next of edges.get(role) ?? []) {
      if (!visit(next)) return false;
    }
    visiting.delete(role);
    visited.add(role);
    return true;
  };
  return input.roles.every(({ reference }) => visit(reference));
}

function changedAssignments(fromState, toState) {
  const prior = new Map(
    fromState.assignments.map((assignment) => [
      assignment.capabilityId,
      assignment,
    ]),
  );
  return toState.assignments.filter((assignment) => {
    const before = prior.get(assignment.capabilityId);
    return (
      before?.accountable !== assignment.accountable ||
      before?.authorityScope !== assignment.authorityScope
    );
  });
}

function sourceOfTruthIsAuthorized(input) {
  return input.transitions.every((transition, index) => {
    const before = input.states[index];
    const after = input.states[index + 1];
    const changed = changedAssignments(before, after).filter(
      ({ capabilityId }) => capabilityId === "source-of-truth-transfer",
    );
    if (changed.length === 0) return true;
    return (
      transition.sourceOfTruthTransferApproved === true &&
      transition.handoffs.some(
        (handoff) =>
          handoff.capabilityId === "source-of-truth-transfer" &&
          handoff.accepted === true,
      )
    );
  });
}

function recoveryIsOwned(input) {
  return input.states.every((state) =>
    ["rollback", "failback"].every((capabilityId) => {
      const assignment = state.assignments.find(
        (candidate) => candidate.capabilityId === capabilityId,
      );
      return (
        typeof assignment?.accountable === "string" &&
        assignment.responsible.length > 0 &&
        typeof assignment.approvalAuthority === "string"
      );
    }),
  );
}

function temporalEvidenceCurrent(input) {
  const planningAt = Date.parse(input.planningAt);
  if (!Number.isFinite(planningAt)) return false;
  return input.transitions
    .flatMap(({ handoffs }) => handoffs)
    .every((handoff) => {
      const observedAt = Date.parse(handoff.observedAt);
      const expiresAt = Date.parse(handoff.expiresAt);
      return (
        Number.isFinite(observedAt) &&
        Number.isFinite(expiresAt) &&
        observedAt <= planningAt &&
        expiresAt > planningAt &&
        planningAt - observedAt <=
          input.maxEvidenceAgeHours * 60 * 60 * 1000
      );
    });
}

function handoffsAreValid(input) {
  return input.transitions.every((transition, index) => {
    const before = input.states[index];
    const after = input.states[index + 1];
    const changes = changedAssignments(before, after);
    const changedIds = changes.map(({ capabilityId }) => capabilityId).sort();
    const handoffIds = transition.handoffs
      .map(({ capabilityId }) => capabilityId)
      .sort();
    if (!same(changedIds, handoffIds)) return false;
    return changes.every((change) => {
      const previous = before.assignments.find(
        ({ capabilityId }) => capabilityId === change.capabilityId,
      );
      const handoff = transition.handoffs.find(
        ({ capabilityId }) => capabilityId === change.capabilityId,
      );
      return (
        handoff?.accepted === true &&
        handoff.offeredBy === previous.accountable &&
        handoff.acceptedBy === change.accountable &&
        handoff.approvalAuthority === change.approvalAuthority &&
        handoff.evidenceDigest ===
          digest({
            reference: handoff.reference,
            capabilityId: handoff.capabilityId,
            fromState: transition.fromState,
            toState: transition.toState,
            offeredBy: handoff.offeredBy,
            acceptedBy: handoff.acceptedBy,
            approvalAuthority: handoff.approvalAuthority,
            observedAt: handoff.observedAt,
            expiresAt: handoff.expiresAt,
            nonce: handoff.nonce,
          })
      );
    });
  });
}

function replayIsProtected(input) {
  const accepted = input.lineage.acceptedAttempts;
  const acceptedOrdinals = accepted.map(({ attemptOrdinal }) => attemptOrdinal);
  const acceptedNonces = accepted.map(({ attemptNonce }) => attemptNonce);
  const handoffs = input.transitions.flatMap(({ handoffs }) => handoffs);
  const handoffNonces = handoffs.map(({ nonce }) => nonce);
  const handoffDigests = handoffs.map(({ evidenceDigest }) => evidenceDigest);
  return (
    acceptedOrdinals.every((ordinal, index) => ordinal === index + 1) &&
    input.lineage.attemptOrdinal === accepted.length + 1 &&
    new Set(acceptedNonces).size === acceptedNonces.length &&
    !acceptedNonces.includes(input.lineage.attemptNonce) &&
    new Set(handoffNonces).size === handoffNonces.length &&
    new Set(handoffDigests).size === handoffDigests.length
  );
}

function transitionOrderIsValid(input) {
  return (
    input.transitions.length === OWNERSHIP_STATE_ORDER.length - 1 &&
    input.transitions.every(
      (transition, index) =>
        transition.sequence === index + 1 &&
        transition.fromState === OWNERSHIP_STATE_ORDER[index] &&
        transition.toState === OWNERSHIP_STATE_ORDER[index + 1],
    )
  );
}

function lineageIsMonotonic(input) {
  const accepted = input.lineage.acceptedAttempts;
  return accepted.every(
    (attempt, index) =>
      attempt.attemptOrdinal === index + 1 &&
      typeof attempt.planDigest === "string",
  );
}

function safetyIsEnforced(input) {
  return (
    input.safety.executionEnabled === false &&
    input.safety.executionEligible === false &&
    input.safety.executionAllowed === false &&
    input.safety.liveOperations === "disabled"
  );
}

function bindingsAreExact(input, trustedBindings) {
  return (
    same(input.integration, trustedBindings) &&
    input.target.environment === trustedBindings.environment &&
    input.target.environmentReference ===
      trustedBindings.environmentReference &&
    input.target.targetReference === trustedBindings.targetReference &&
    input.integrityClaims.statesDigest === digest(input.states) &&
    input.integrityClaims.transitionsDigest === digest(input.transitions) &&
    input.integrityClaims.roleCatalogDigest === digest(input.roles)
  );
}

function plannedActions(input) {
  return input.transitions.map((transition) => ({
    sequence: transition.sequence,
    stateChange: `${transition.fromState}-to-${transition.toState}`,
    representation: "non-executable",
    requiredFutureAuthority: "separate-live-control-plane-approval",
    executionAllowed: false,
  }));
}

function evaluate(input, trustedBindings) {
  const roles = roleMap(input);
  const checks = [
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.artifactsBound,
      bindingsAreExact(input, trustedBindings),
      "Exact predecessor lineage, artifact, environment, target, and integrity digests must match protected bindings.",
      Object.values(input.integration).filter(
        (value) => typeof value === "string" && value.startsWith("sha256:"),
      ),
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.raciComplete,
      roleSetComplete(input) && assignmentsComplete(input),
      "Every canonical capability and state requires one accountable role plus explicit responsible, consulted, and informed sets.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.authorityUnambiguous,
      authorityIsUnambiguous(input, roles),
      "DNS, certificate, CI/CD, deployment, database, application, recovery, and source-of-truth authorities must resolve to one qualified role and scope.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.separationOfDuties,
      separationOfDutiesValid(input),
      "Sensitive control-plane authorities require an approval role separate from accountable and responsible roles.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.escalationAcyclic,
      escalationIsAcyclic(input),
      "Escalation routes must be acyclic and cannot self-escalate.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.sourceOfTruthAuthorized,
      sourceOfTruthIsAuthorized(input),
      "A source-of-truth authority change requires explicit transfer approval and accepted handoff evidence.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.recoveryOwned,
      recoveryIsOwned(input),
      "Rollback and failback must retain accountable, responsible, and approval authorities in every state.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.evidenceCurrent,
      temporalEvidenceCurrent(input),
      "Handoff evidence must be observed, current, unexpired, and within the configured age at planning time.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.handoffIntegrity,
      handoffsAreValid(input),
      "Every ownership change requires one accepted, digest-bound handoff from the prior authority to the successor.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.replayProtected,
      replayIsProtected(input),
      "Attempt and handoff nonces and evidence digests must be unique and not replay accepted history.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.transitionOrderValid,
      transitionOrderIsValid(input),
      "Ownership transitions must be complete, unique, and in canonical coexistence through failback order.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.lineageMonotonic,
      lineageIsMonotonic(input),
      "Accepted ownership attempts must form a monotonic, gap-free lineage.",
    ),
    resultCheck(
      CONTROL_PLANE_OWNERSHIP_CHECK_IDS.safetyEnforced,
      safetyIsEnforced(input),
      "The assessment must keep all execution flags false and all live operations disabled.",
    ),
  ];
  return checks;
}

function planControlPlaneOwnership(input, options = {}) {
  assertOpaqueMetadata(input);
  validateDocument(inputSchema, input);
  const trustedBindings = options.trustedBindings;
  if (!trustedBindings) {
    throw new Error(
      "control.ownership.artifacts-bound: externally protected trustedBindings are required.",
    );
  }
  validateDocument(trustedBindingsSchema, trustedBindings);
  const checks = evaluate(input, trustedBindings);
  const status = checks.every(({ classification }) => classification === "pass")
    ? "ready-for-human-review"
    : "blocked";
  const output = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    planId: input.planId,
    generatedAt: input.planningAt,
    evidenceMode: input.evidenceMode,
    sourceProvider: input.sourceProvider,
    target: structuredClone(input.target),
    status,
    requiredChecks: [...CONTROL_PLANE_OWNERSHIP_CHECK_ORDER],
    checks,
    authorityMatrix: structuredClone(input.states),
    transitions: structuredClone(input.transitions),
    lineage: structuredClone(input.lineage),
    bindings: {
      ...structuredClone(input.integration),
      roleCatalogDigest: digest(input.roles),
      authorityMatrixDigest: digest(input.states),
      transitionDigest: digest(input.transitions),
      inputDigest: digest(input),
    },
    plannedActions: plannedActions(input),
    humanConfirmationRequired: [
      "Protected systems must replace synthetic evidence with current live evidence.",
      "Each live handoff and operation requires separate capability-specific approval.",
      "Rollback and failback ownership must be rehearsed before any cutover.",
    ],
    safety: {
      executionEnabled: false,
      executionEligible: false,
      executionAllowed: false,
      liveOperations: "disabled",
      networkCalls: "none",
      cloudOperations: "none",
      dnsOperations: "none",
      certificateOperations: "none",
      secretOperations: "none",
      pipelineOperations: "none",
      databaseOperations: "none",
      applicationOperations: "none",
      recoveryOperations: "none",
      iacOperations: "none",
      generatedCommands: "none",
      generatedArtifacts: "stdout-only",
    },
  };
  output.planDigest = digest(output);
  validateDocument(outputSchema, output);
  return output;
}

function parseArguments(argv) {
  if (argv[0] !== "plan") {
    throw new Error(
      "Usage: startup-control-plane-ownership-plan.mjs plan --input <path> --trusted-bindings <path> [--output json]",
    );
  }
  const options = { output: "json" };
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !["--input", "--trusted-bindings", "--output"].includes(flag)) {
      throw new Error(`Unsupported or incomplete argument: ${flag}`);
    }
    options[flag.slice(2)] = value;
  }
  if (
    !options.input ||
    !options["trusted-bindings"] ||
    options.output !== "json"
  ) {
    throw new Error(
      "Both --input and --trusted-bindings are required; only --output json is supported.",
    );
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const input = JSON.parse(readFileSync(resolve(options.input), "utf8"));
  const trustedBindings = JSON.parse(
    readFileSync(resolve(options["trusted-bindings"]), "utf8"),
  );
  process.stdout.write(
    `${JSON.stringify(planControlPlaneOwnership(input, { trustedBindings }), null, 2)}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export {
  CONTROL_PLANE_CAPABILITIES,
  CONTROL_PLANE_OWNERSHIP_CHECK_IDS,
  CONTROL_PLANE_OWNERSHIP_CHECK_ORDER,
  OWNERSHIP_STATE_ORDER,
  canonicalJson as controlPlaneOwnershipCanonicalJson,
  digest as controlPlaneOwnershipDigest,
  planControlPlaneOwnership,
};
