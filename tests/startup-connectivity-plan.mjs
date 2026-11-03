#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CONNECTIVITY_CHECK_IDS,
  CONNECTIVITY_CHECK_ORDER,
  STAGE_ORDER,
  connectivityPlanDigest,
  planConnectivity,
} from "../scripts/startup-connectivity-plan.mjs";
import { validateDocument } from "../scripts/validate-agent-contracts.mjs";

const root = resolve(".");
const script = resolve(root, "scripts/startup-connectivity-plan.mjs");
const base = JSON.parse(
  readFileSync(resolve(root, "agent/examples/connectivity-plan-input.json"), "utf8"),
);
const scenarios = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/connectivity-planner/scenarios.json"),
    "utf8",
  ),
);
const outputSchema = JSON.parse(
  readFileSync(resolve(root, "agent/schemas/connectivity-plan.schema.json"), "utf8"),
);

function setPath(value, path, replacement) {
  const parts = path.split(".");
  const property = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  parent[property] = structuredClone(replacement);
}

function checkById(plan, id) {
  return plan.checks.find((check) => check.id === id);
}

// Recompute the source and target integrity digests to match a mutated
// input, unless the scenario deliberately exercises tamper detection by
// keeping the original claim stale against mutated evidence.
function withFreshDigests(input, scenario = {}) {
  if (!scenario.skipSourceDigestRecompute) {
    input.integrityClaims.sourceAssessmentDigestClaim = connectivityPlanDigest(
      input.sourceAssessment,
    );
  }
  if (!scenario.skipTargetDigestRecompute) {
    input.integrityClaims.targetEvidenceDigestClaim = connectivityPlanDigest(
      input.target,
    );
  }
  return input;
}

function planWith(...args) {
  const options =
    args.length > 0 && !Array.isArray(args[args.length - 1])
      ? args.pop()
      : {};
  const input = structuredClone(base);
  for (const [path, value] of args) {
    setPath(input, path, value);
  }
  withFreshDigests(input, options);
  return planConnectivity(input);
}

for (const scenario of scenarios) {
  const input = structuredClone(base);
  for (const [path, value] of scenario.mutations) {
    setPath(input, path, value);
  }
  withFreshDigests(input, scenario);
  const first = planConnectivity(input);
  const second = planConnectivity(structuredClone(input));
  assert.deepEqual(second, first, `${scenario.name}: output must be deterministic`);
  validateDocument(outputSchema, first);
  assert.equal(first.status, scenario.expectedStatus, scenario.name);
  assert.equal(
    first.transition.selected,
    scenario.expectedStrategy,
    scenario.name,
  );
  assert.deepEqual(first.requiredChecks, CONNECTIVITY_CHECK_ORDER);
  assert.deepEqual(
    first.checks.map(({ id }) => id),
    CONNECTIVITY_CHECK_ORDER,
  );
  for (const id of scenario.expectedChecks) {
    assert.notEqual(
      checkById(first, id).classification,
      "pass",
      `${scenario.name}: ${id} must block`,
    );
  }
  assert.equal(first.safety.executionEnabled, false);
  assert.equal(first.safety.executionEligible, false);
  assert.equal(first.safety.connectivityActions, "none");
  assert.equal(first.safety.dnsActions, "none");
  assert.equal(first.safety.identityActions, "none");
  assert.equal(first.safety.egressActions, "none");
  assert.equal(first.safety.firewallActions, "none");
  assert.equal(first.safety.routeActions, "none");
  assert.equal(first.safety.credentialActions, "none");
  assert.equal(first.safety.iacActions, "none");
  assert.equal(first.safety.generatedArtifacts, "stdout-only");
  assert.deepEqual(
    first.stages.map(({ state }) => state),
    STAGE_ORDER,
  );
  assert(first.stages.every(({ executionAllowed }) => !executionAllowed));
  assert.equal(first.identityBindings.readiness.executionEligible, false);
  assert.equal(first.identityBindings.iac.executionEligible, false);
  assert.equal(first.identityBindings.manifest.executionEligible, false);
  assert.equal(first.identityBindings.approval.executionEligible, false);
  assert.equal(
    first.planDigest,
    connectivityPlanDigest(
      Object.fromEntries(
        Object.entries(first).filter(([key]) => key !== "planDigest"),
      ),
    ),
  );
}

// Every catalog check must have a blocking synthetic scenario.
const coveredCheckIds = new Set();
for (const scenario of scenarios) {
  for (const id of scenario.expectedChecks) {
    coveredCheckIds.add(id);
  }
}
assert.deepEqual(
  [...coveredCheckIds].sort(),
  [...CONNECTIVITY_CHECK_ORDER].sort(),
  "Every dual-cloud connectivity, DNS, identity, and egress catalog check requires a blocking scenario",
);

const ready = planConnectivity(withFreshDigests(structuredClone(base)));
assert.equal(ready.status, "ready");
assert.equal(ready.transition.selected, "phased-connectivity-cutover");
assert.equal(ready.transition.requested, "auto");
assert(ready.checks.every((check) => check.classification === "pass"));
assert.deepEqual(ready.transitionPlan.unsupportedFindings, []);
assert.deepEqual(ready.transitionPlan.requiredRemediations, []);
assert.deepEqual(ready.transitionPlan.unresolvedDecisions, []);
assert(
  ready.transitionPlan.sourceOfTruthRules.some((rule) =>
    rule.includes("source network is authoritative"),
  ),
);
assert(
  ready.transitionPlan.rollback.some((step) =>
    step.includes("separately approved failback procedure"),
  ),
);

// Identity bindings are identical across readiness, iac, manifest, and
// approval bindings, matching the container image and CI/CD planner
// convention for a single reviewed connectivity identity.
assert.equal(
  ready.identityBindings.readiness.connectivityIdentityDigest,
  ready.identityBindings.connectivityIdentityDigest,
);
assert.deepEqual(ready.identityBindings.readiness, ready.identityBindings.iac);
assert.deepEqual(ready.identityBindings.iac, ready.identityBindings.manifest);
assert.deepEqual(ready.identityBindings.manifest, ready.identityBindings.approval);

// GCP and generic on-prem positive paths remain ready.
const gcp = planWith(
  ["sourceAssessment.cloud.provider", "gcp"],
  ["sourceAssessment.cloud.connectivityType", "cloud-interconnect"],
  ["sourceAssessment.cloud.region", "us-central1"],
);
assert.equal(gcp.status, "ready");
assert.equal(
  checkById(gcp, CONNECTIVITY_CHECK_IDS.architectureSupported).classification,
  "pass",
);
const generic = planWith(
  ["sourceAssessment.cloud.provider", "onprem-generic"],
  ["sourceAssessment.cloud.connectivityType", "ipsec-vpn"],
  ["sourceAssessment.cloud.region", "onprem-primary"],
  ["target.connectivityTargetEvidence.gatewayKind", "vpn-gateway"],
);
assert.equal(generic.status, "ready");
assert.equal(
  checkById(generic, CONNECTIVITY_CHECK_IDS.architectureSupported).classification,
  "pass",
);

// Overlap without an approved translation is blocking; an approved, exact
// translation with an owner and reference resolves the same overlap.
const overlapNoTranslation = planWith(
  ["sourceAssessment.network.cidrs", ["10.40.0.0/16"]],
  ["sourceAssessment.network.routing.routeOwners.0.prefix", "10.40.0.0/16"],
);
assert.equal(
  checkById(overlapNoTranslation, CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap)
    .classification,
  "fail",
);
const overlapWithTranslation = planWith(
  ["sourceAssessment.network.cidrs", ["10.40.0.0/16"]],
  ["sourceAssessment.network.routing.routeOwners.0.prefix", "10.40.0.0/16"],
  [
    "sourceAssessment.network.addressTranslation",
    {
      approved: true,
      ownerReference: "owner.translation.aws.orders",
      reference: "translation.aws.orders.v1",
      translatedPrefixes: [
        {
          sourcePrefix: "10.40.0.0/16",
          translatedPrefix: "100.64.0.0/16",
        },
      ],
    },
  ],
);
assert.equal(
  checkById(overlapWithTranslation, CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap)
    .classification,
  "pass",
);
assert.equal(overlapWithTranslation.status, "ready");
const incompleteTranslation = planWith(
  ["sourceAssessment.network.cidrs", ["10.40.0.0/16", "10.41.0.0/16"]],
  ["target.connectivityTargetEvidence.azureCidrs", ["10.40.0.0/15"]],
  [
    "sourceAssessment.network.routing.routeOwners",
    [
      {
        prefix: "10.40.0.0/16",
        ownerReference: "owner.route.aws.orders.40",
      },
      {
        prefix: "10.41.0.0/16",
        ownerReference: "owner.route.aws.orders.41",
      },
    ],
  ],
  [
    "sourceAssessment.network.addressTranslation",
    {
      approved: true,
      ownerReference: "owner.translation.aws.orders",
      reference: "translation.aws.orders.incomplete",
      translatedPrefixes: [
        {
          sourcePrefix: "10.40.0.0/16",
          translatedPrefix: "100.64.0.0/16",
        },
      ],
    },
  ],
);
assert.equal(
  checkById(incompleteTranslation, CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap)
    .classification,
  "fail",
);
const collidingTranslation = planWith(
  ["sourceAssessment.network.cidrs", ["10.20.0.0/16", "10.40.0.0/16"]],
  [
    "sourceAssessment.network.routing.routeOwners",
    [
      {
        prefix: "10.20.0.0/16",
        ownerReference: "owner.route.aws.orders.20",
      },
      {
        prefix: "10.40.0.0/16",
        ownerReference: "owner.route.aws.orders.40",
      },
    ],
  ],
  [
    "sourceAssessment.network.addressTranslation",
    {
      approved: true,
      ownerReference: "owner.translation.aws.orders",
      reference: "translation.aws.orders.collision",
      translatedPrefixes: [
        {
          sourcePrefix: "10.40.0.0/16",
          translatedPrefix: "10.20.0.0/16",
        },
      ],
    },
  ],
);
assert.equal(
  checkById(collidingTranslation, CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap)
    .classification,
  "fail",
);
const targetCollidingOptionalTranslation = planWith([
  "sourceAssessment.network.addressTranslation",
  {
    approved: true,
    ownerReference: "owner.translation.aws.orders",
    reference: "translation.aws.orders.target-collision",
    translatedPrefixes: [
      {
        sourcePrefix: "10.20.0.0/16",
        translatedPrefix: "10.40.0.0/16",
      },
    ],
  },
]);
assert.equal(
  checkById(
    targetCollidingOptionalTranslation,
    CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap,
  ).classification,
  "fail",
);
const sourceCollidingOptionalTranslation = planWith(
  ["sourceAssessment.network.cidrs", ["10.20.0.0/16", "10.21.0.0/16"]],
  [
    "sourceAssessment.network.routing.routeOwners",
    [
      {
        prefix: "10.20.0.0/16",
        ownerReference: "owner.route.aws.orders.20",
      },
      {
        prefix: "10.21.0.0/16",
        ownerReference: "owner.route.aws.orders.21",
      },
    ],
  ],
  [
    "sourceAssessment.network.addressTranslation",
    {
      approved: true,
      ownerReference: "owner.translation.aws.orders",
      reference: "translation.aws.orders.source-collision",
      translatedPrefixes: [
        {
          sourcePrefix: "10.21.0.0/16",
          translatedPrefix: "10.20.0.0/16",
        },
      ],
    },
  ],
);
assert.equal(
  checkById(
    sourceCollidingOptionalTranslation,
    CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap,
  ).classification,
  "fail",
);

const targetRouteMismatch = planWith([
  "target.connectivityTargetEvidence.routing.routeOwners",
  [
    {
      prefix: "0.0.0.0/0",
      ownerReference: "owner.route.azure.default",
    },
  ],
]);
assert.equal(
  checkById(targetRouteMismatch, CONNECTIVITY_CHECK_IDS.routeOwnershipExact)
    .classification,
  "fail",
);
assert.equal(
  checkById(targetRouteMismatch, CONNECTIVITY_CHECK_IDS.noDefaultRoute)
    .classification,
  "fail",
);

// Out-of-order lineage attempts (a non-monotonic ordinal against a newer
// accepted attempt) are rejected distinctly from a duplicated nonce replay.
const outOfOrder = planWith(
  ["lineage.attemptOrdinal", 2],
  [
    "lineage.acceptedAttempts",
    [
      {
        attemptOrdinal: 3,
        assessmentId: "assessment.aws.orders.newer",
        nonce: "nonce.connectivity.orders.0099",
      },
    ],
  ],
);
assert.equal(outOfOrder.status, "blocked");
assert.equal(
  checkById(outOfOrder, CONNECTIVITY_CHECK_IDS.replayProtected).classification,
  "fail",
);
const duplicateNonce = planWith(
  ["lineage.attemptOrdinal", 2],
  [
    "lineage.acceptedAttempts",
    [
      {
        attemptOrdinal: 1,
        assessmentId: "assessment.aws.orders.prior",
        nonce: "nonce.connectivity.orders.0001",
      },
    ],
  ],
);
assert.equal(duplicateNonce.status, "blocked");
assert.equal(
  checkById(duplicateNonce, CONNECTIVITY_CHECK_IDS.replayProtected).classification,
  "fail",
);

const mixedFederationEnvironment = planWith([
  "target.identityTargetEvidence.federation.environment",
  "nonprod",
]);
assert.equal(
  checkById(
    mixedFederationEnvironment,
    CONNECTIVITY_CHECK_IDS.identityEnvironmentSeparation,
  ).classification,
  "fail",
);

const broadSupernets = planWith([
  "sourceAssessment.egress.allowlist",
  [
    {
      destination: "0.0.0.0/1",
      port: 443,
      protocol: "tcp",
      reference: "egress.aws.halfspace-a",
    },
    {
      destination: "128.0.0.0/1",
      port: 443,
      protocol: "tcp",
      reference: "egress.aws.halfspace-b",
    },
  ],
]);
assert.equal(
  checkById(broadSupernets, CONNECTIVITY_CHECK_IDS.egressBoundedAllowlist)
    .classification,
  "fail",
);

// Tamper and target mismatch are distinct, blocking findings, and each
// produces a different plan digest and connectivity identity digest.
const tampered = planWith(
  ["sourceAssessment.governance.owner.role", "compromisedowner"],
  { skipSourceDigestRecompute: true },
);
assert.equal(
  checkById(tampered, CONNECTIVITY_CHECK_IDS.integrityVerified).classification,
  "fail",
);
assert.notEqual(tampered.planDigest, ready.planDigest);
assert.notEqual(
  tampered.identityBindings.connectivityIdentityDigest,
  ready.identityBindings.connectivityIdentityDigest,
);

const targetMismatch = planWith(
  ["target.connectivityTargetEvidence.ownerReference", "owner.network.azure.compromised"],
  { skipTargetDigestRecompute: true },
);
assert.equal(
  checkById(targetMismatch, CONNECTIVITY_CHECK_IDS.targetIntegrityVerified)
    .classification,
  "fail",
);
assert.notEqual(targetMismatch.planDigest, ready.planDigest);
assert.notEqual(
  targetMismatch.identityBindings.connectivityIdentityDigest,
  ready.identityBindings.connectivityIdentityDigest,
);
for (const [path, value] of [
  ["target.dnsTargetEvidence.forwarding.loopDetected", true],
  ["target.identityTargetEvidence.federation.subject", "repo:other/app:environment:prod"],
  ["target.egressTargetEvidence.allowlist.0.port", 8443],
]) {
  const mismatched = planWith([path, value], { skipTargetDigestRecompute: true });
  assert.equal(
    checkById(mismatched, CONNECTIVITY_CHECK_IDS.targetIntegrityVerified)
      .classification,
    "fail",
    `${path}: every target evidence surface must be integrity-bound`,
  );
}

// Region mismatch invalidates the target binding and the identity.
const regionMutation = planWith([
  "target.connectivityTargetEvidence.region",
  "westeurope",
]);
assert.equal(
  checkById(regionMutation, CONNECTIVITY_CHECK_IDS.targetBound).classification,
  "fail",
);
assert.notEqual(regionMutation.planDigest, ready.planDigest);
assert.notEqual(
  regionMutation.identityBindings.connectivityIdentityDigest,
  ready.identityBindings.connectivityIdentityDigest,
);

// Requirements, transition, and integration changes each reproduce a new
// connectivity identity so downstream bindings stay traceable.
const requirementsMutation = planWith(["requirements.maxRpoMinutes", 5]);
assert.notEqual(requirementsMutation.planDigest, ready.planDigest);
assert.notEqual(
  requirementsMutation.identityBindings.requirementsDigest,
  ready.identityBindings.requirementsDigest,
);
const transitionMutation = planWith([
  "transition.cutoverReference",
  "runbook.connectivity.cutover.orders.v2",
]);
assert.notEqual(
  transitionMutation.identityBindings.transitionDigest,
  ready.identityBindings.transitionDigest,
);
const integrationMutation = planWith(["integration", null]);
assert.notEqual(
  integrationMutation.identityBindings.integrationDigest,
  ready.identityBindings.integrationDigest,
);

// Every integration binding digest changes independently, keeping the
// existing workload, region, IaC, readiness, manifest, approval,
// PostgreSQL migration, and container image/CI migration lineage distinct
// but consistently traceable.
for (const field of [
  "workloadProfilePlanDigest",
  "regionalPlanDigest",
  "iacPlanDigest",
  "readinessEvidenceDigest",
  "deploymentManifestDigest",
  "deploymentApprovalDigest",
  "postgresqlMigrationIdentityDigest",
  "containerImageCicdPlanDigest",
]) {
  const mutated = planWith([
    `integration.${field}`,
    `sha256:${"9".repeat(64)}`,
  ]);
  assert.notEqual(
    mutated.identityBindings.integrationDigest,
    ready.identityBindings.integrationDigest,
    `${field}: mutating the integration digest must change the integration binding`,
  );
}

// Secret-bearing keys and values fail closed before evaluation.
const secretKey = structuredClone(base);
secretKey.sourceAssessment.governance.owner.accessKey = "not-allowed";
assert.throws(
  () => planConnectivity(secretKey),
  /connectivity\.identity\.secret-material/,
);
const secretValue = structuredClone(base);
secretValue.sourceAssessment.network.gateways[0].reference =
  `https://ci-user:${["raw", "secret"].join("-")}@source.example/gateway`;
assert.throws(
  () => planConnectivity(secretValue),
  /connectivity\.identity\.secret-material/,
);

// The CLI reads local JSON and writes JSON to standard output only.
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "sslz-connectivity-plan-"),
);
const inputPath = join(temporaryDirectory, "input.json");
const blockedInputPath = join(temporaryDirectory, "blocked-input.json");
writeFileSync(inputPath, `${JSON.stringify(base)}\n`);
const blockedInput = structuredClone(base);
blockedInput.sourceAssessment.governance.sourceOfTruth = "ambiguous";
writeFileSync(blockedInputPath, `${JSON.stringify(blockedInput)}\n`);
const before = readdirSync(temporaryDirectory).sort();
const cli = spawnSync(
  process.execPath,
  [script, "plan", "--input", inputPath, "--output", "json"],
  { cwd: temporaryDirectory, encoding: "utf8" },
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(readdirSync(temporaryDirectory).sort(), before);
assert.deepEqual(JSON.parse(cli.stdout), ready);

const blocked = spawnSync(
  process.execPath,
  [script, "plan", "--input", blockedInputPath, "--output", "json"],
  {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: { ...process.env },
  },
);
assert.equal(blocked.status, 1, blocked.stderr);
assert.equal(JSON.parse(blocked.stdout).status, "blocked");

// Every requirements policy boolean is a hard constant; loosening any of
// them must be rejected before evaluation, never silently accepted.
for (const path of [
  "requirements.requireSymmetricRouting",
  "requirements.requireUniqueRouteOwnership",
  "requirements.blockDefaultRoutes",
  "requirements.requireGatewayRedundancy",
  "requirements.requireExplicitFirewallIntent",
  "requirements.requireOidcFederation",
  "requirements.blockLongLivedSecrets",
  "requirements.requireLeastPrivilege",
  "requirements.requireEnvironmentSeparation",
  "requirements.requireBoundedEgress",
  "requirements.requireDefaultDenyEgress",
  "requirements.requireResolverReachability",
  "requirements.requireDnsLoopPrevention",
  "requirements.requireTelemetry",
  "requirements.requireRecoveryPlan",
  "requirements.requireRollbackPlan",
  "requirements.requireOwnerConfirmation",
]) {
  const unsafePolicy = structuredClone(base);
  setPath(unsafePolicy, path, false);
  assert.throws(
    () => planConnectivity(unsafePolicy),
    /expected constant true/,
    `${path}: loosening a hard-coded policy constant must be rejected`,
  );
}

// The planner surface performs no execution and emits no commands.
const source = readFileSync(script, "utf8");
assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls|dns)/);
assert.doesNotMatch(
  source,
  /\b(?:writeFile|appendFile|mkdir|rm|unlink|rename|copyFile)(?:Sync)?\b/,
);
assert.doesNotMatch(
  source,
  /\b(?:gcloud|terraform|bicep|kubectl|helm|dig|nslookup|traceroute|ping|curl|ssh|openssl)\b/,
);
assert.doesNotMatch(
  JSON.stringify(ready),
  /ci-user|BEGIN [A-Z ]+PRIVATE KEY/,
);

console.log(
  `Connectivity, DNS, identity, and egress planner tests passed for ${scenarios.length} synthetic scenarios.`,
);
