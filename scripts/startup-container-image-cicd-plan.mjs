#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PLANNER_VERSION = "1.0.0";

const CONTAINER_CICD_CHECK_IDS = Object.freeze({
  assessmentCurrent: "migration.container.assessment-current",
  evidenceComplete: "migration.container.evidence-complete",
  targetBound: "migration.container.target-bound",
  digestPinned: "migration.container.digest-pinned",
  mutableTagUntrusted: "migration.container.mutable-tag-untrusted",
  platformsCompatible: "migration.container.platforms-compatible",
  baseImageSupported: "migration.container.base-image-supported",
  sbomPresent: "migration.container.sbom-present",
  signaturesVerified: "migration.container.signatures-verified",
  provenanceContinuous: "migration.container.provenance-continuous",
  vulnerabilityPolicyMet: "migration.container.vulnerability-policy-met",
  registryControlsParity: "migration.container.registry-controls-parity",
  unsignedPromotionBlocked: "migration.container.unsigned-promotion-blocked",
  replayProtected: "migration.container.replay-protected",
  sourceOfTruthExplicit: "migration.container.source-of-truth-explicit",
  cicdSourceBound: "migration.cicd.source-bound",
  cicdTriggersGoverned: "migration.cicd.triggers-governed",
  cicdRunnerLeastPrivilege: "migration.cicd.runner-least-privilege",
  cicdEnvironmentSeparation: "migration.cicd.environment-separation",
  cicdSecretReferencesExternal: "migration.cicd.secret-references-external",
  cicdPromotionGoverned: "migration.cicd.promotion-governed",
  cicdDeploymentTargetsBound: "migration.cicd.deployment-targets-bound",
  cicdDualPublishReady: "migration.cicd.dual-publish-ready",
  cicdRollbackComplete: "migration.cicd.rollback-complete",
});
const CONTAINER_CICD_CHECK_ORDER = Object.freeze(
  Object.values(CONTAINER_CICD_CHECK_IDS),
);

const STAGE_ORDER = Object.freeze([
  "assess",
  "prepare-registry",
  "configure-pipeline",
  "dual-publish",
  "validate",
  "cutover",
  "verify",
  "rollback-required",
  "completed",
]);

// Supported source registry / CI/CD pairings modelled by this planner.
const SOURCE_PAIRINGS = Object.freeze({
  "aws-ecr": ["github-actions", "aws-codebuild"],
  "gcp-artifact-registry": ["gcp-cloud-build"],
  "gcp-gcr": ["gcp-cloud-build"],
  "generic-oci": ["github-actions", "gitlab-ci", "jenkins", "azure-devops"],
});

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const inputSchema = load(
  "agent/schemas/container-image-cicd-plan-input.schema.json",
);
const outputSchema = load("agent/schemas/container-image-cicd-plan.schema.json");

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
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
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function assertNonSecretMetadata(value, path = "$") {
  const sensitiveKey =
    /(?:password|passphrase|(?:access|refresh|identity)?token|connection.?string|private.?key|client.?secret|access.?key)/i;
  const sensitiveValue = [
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
    /\b(?:https?|oci):\/\/[^/\s:@]+:[^@\s/]+@/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  ];
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNonSecretMetadata(item, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      sensitiveValue.some((pattern) => pattern.test(value))
    ) {
      throw new Error(
        `container.cicd.secret-material: ${path} contains secret material; use an opaque reference.`,
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      throw new Error(
        `container.cicd.secret-material: ${path}.${key} is not an allowed metadata field.`,
      );
    }
    assertNonSecretMetadata(child, `${path}.${key}`);
  }
}

function evidenceFreshness(observedAt, expiresAt, input) {
  const planningAt = Date.parse(input.planningAt);
  const observed = Date.parse(observedAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(planningAt) ||
    !Number.isFinite(observed) ||
    !Number.isFinite(expires) ||
    observed > planningAt ||
    expires <= planningAt ||
    planningAt - observed > input.maxAssessmentAgeHours * 60 * 60 * 1000
  ) {
    return "stale";
  }
  return "current";
}

function resultCheck(id, classification, freshness, summary, evidenceReferences) {
  return {
    id,
    classification:
      freshness === "stale" && classification === "pass"
        ? "unresolved"
        : classification,
    freshness,
    summary:
      freshness === "stale"
        ? `${summary} The supporting evidence is stale, future-dated, or expired.`
        : summary,
    evidenceReferences: [...new Set(evidenceReferences)].sort(),
  };
}

function combined(...freshnessValues) {
  return freshnessValues.every((value) => value === "current")
    ? "current"
    : "stale";
}

function evaluate(input) {
  const sa = input.sourceAssessment;
  const reg = sa.registry;
  const rte = input.target.registryTargetEvidence;
  const cte = input.target.cicdTargetEvidence;
  const regionPolicy = input.target.regionPolicy;
  const req = input.requirements;
  const scope = input.scope;
  const images = sa.images;
  const envNames = new Set(sa.cicd.environments.map((environment) => environment.name));
  const targetPlatforms = new Set(rte.supportedPlatforms);
  const prodEnvironments = sa.cicd.environments.filter(
    (environment) => environment.purpose === "prod",
  );

  const sourceFreshness = evidenceFreshness(sa.observedAt, sa.expiresAt, input);
  const registryFreshness = evidenceFreshness(rte.observedAt, rte.expiresAt, input);
  const cicdFreshness = evidenceFreshness(cte.observedAt, cte.expiresAt, input);
  const lineageFreshness = evidenceFreshness(
    input.lineage.observedAt,
    input.lineage.expiresAt,
    input,
  );
  const targetFreshness = combined(registryFreshness, cicdFreshness);

  const unsupportedPlatformImages = images
    .filter((image) => !image.platforms.every((platform) => targetPlatforms.has(platform)))
    .map((image) => image.reference)
    .sort();
  const missingRequiredPlatformImages = req.requireMultiArch
    ? images
        .filter((image) => !req.requiredPlatforms.every((platform) => image.platforms.includes(platform)))
        .map((image) => image.reference)
        .sort()
    : [];
  const unsignedImages = images
    .filter((image) => !(image.signed && image.signatureType !== "none"))
    .map((image) => image.reference)
    .sort();
  const missingSbomImages = images
    .filter((image) => image.sbomFormat === "none" || image.attestations.sbom !== true)
    .map((image) => image.reference)
    .sort();
  const missingProvenanceImages = images
    .filter((image) => image.attestations.provenance !== true)
    .map((image) => image.reference)
    .sort();
  const discontinuousProvenanceImages = images
    .filter((image) => image.provenanceSubjectDigest !== image.digest)
    .map((image) => image.reference)
    .sort();
  const unsupportedBaseImages = images
    .filter((image) => image.baseImage.supportStatus !== "supported")
    .map((image) => image.reference)
    .sort();
  const unscannedImages = images
    .filter((image) => image.vulnerabilities.scanStatus !== "scanned")
    .map((image) => image.reference)
    .sort();
  const vulnerableImages = images
    .filter(
      (image) =>
        image.vulnerabilities.critical > req.maxCriticalVulnerabilities ||
        image.vulnerabilities.high > req.maxHighVulnerabilities,
    )
    .map((image) => image.reference)
    .sort();
  const unpinnedDeploymentTargets = sa.cicd.deploymentTargets
    .filter((target) => target.boundByDigest !== true)
    .map((target) => target.reference)
    .sort();

  const imageReferenceSet = new Set(images.map((image) => image.reference));
  const imagesMatchScope =
    imageReferenceSet.size === scope.imageReferences.length &&
    scope.imageReferences.every((reference) => imageReferenceSet.has(reference));
  const deploymentImagesResolvable = sa.cicd.deploymentTargets.every((target) =>
    imageReferenceSet.has(target.imageReference),
  );
  const deploymentEnvironmentsResolvable = sa.cicd.deploymentTargets.every((target) =>
    envNames.has(target.environment),
  );
  const scopeEnvironmentsResolvable = scope.environments.every((environment) =>
    envNames.has(environment),
  );

  const accepted = input.lineage.acceptedAttempts;
  const maxAcceptedOrdinal = accepted.reduce(
    (maximum, attempt) => Math.max(maximum, attempt.attemptOrdinal),
    0,
  );
  const assessmentIdReused = accepted.some(
    (attempt) => attempt.assessmentId === sa.assessmentId,
  );
  const nonceReused = accepted.some(
    (attempt) => attempt.nonce === input.lineage.attemptNonce,
  );
  const ordinalMonotonic = input.lineage.attemptOrdinal > maxAcceptedOrdinal;

  const scopeEnvironmentsInTarget = scope.environments.every((environment) =>
    cte.environments.includes(environment),
  );
  const sourceBranchesInTarget = sa.cicd.protectedBranches.every((branch) =>
    cte.protectedBranches.includes(branch),
  );

  const values = {
    assessmentCurrent: sourceFreshness === "current",
    evidenceComplete:
      imagesMatchScope &&
      deploymentImagesResolvable &&
      deploymentEnvironmentsResolvable &&
      scopeEnvironmentsResolvable &&
      sa.governance.evidenceReferences.length > 0,
    targetBound:
      regionPolicy.allowedRegions.includes(rte.region) &&
      rte.residency === regionPolicy.residency &&
      regionPolicy.residency === sa.governance.dataResidency &&
      scopeEnvironmentsInTarget &&
      sourceBranchesInTarget,
    digestPinned:
      reg.deploysByMutableTag === false &&
      sa.cicd.deploymentTargets.every((target) => target.boundByDigest === true) &&
      sa.cicd.promotion.model === "digest-immutable",
    mutableTagUntrusted:
      reg.deploysByMutableTag === false &&
      reg.tagImmutability === "enabled" &&
      rte.tagImmutability === "enabled",
    platformsCompatible:
      unsupportedPlatformImages.length === 0 &&
      missingRequiredPlatformImages.length === 0,
    baseImageSupported: scope.includeBaseImages && unsupportedBaseImages.length === 0,
    sbomPresent: !req.requireSbom || missingSbomImages.length === 0,
    signaturesVerified:
      !req.requireSignatures ||
      (unsignedImages.length === 0 && rte.capabilities.signatureVerification === true),
    provenanceContinuous:
      !req.requireProvenance ||
      (missingProvenanceImages.length === 0 &&
        discontinuousProvenanceImages.length === 0 &&
        rte.capabilities.provenance === true &&
        rte.promotion.preservesDigest === true),
    vulnerabilityPolicyMet:
      unscannedImages.length === 0 && vulnerableImages.length === 0,
    registryControlsParity:
      (!req.requireReplication || rte.replication.enabled === true) &&
      rte.retention.enabled === true &&
      rte.retention.days >= req.minRetentionDays &&
      (!req.requireEncryptionAtRest ||
        rte.encryption.atRest === "provider-managed" ||
        rte.encryption.atRest === "customer-managed") &&
      (!req.requireCustomerManagedKey ||
        rte.encryption.atRest === "customer-managed") &&
      (!req.requirePrivateRegistry ||
        (rte.network.publicAccess === "disabled" &&
          rte.network.privateEndpoint === "ready")),
    unsignedPromotionBlocked:
      !req.blockUnsignedPromotion ||
      (sa.cicd.promotion.requiresSignature === true &&
        sa.cicd.promotion.requiresAttestation === true &&
        rte.capabilities.signatureVerification === true &&
        images.every(
          (image) =>
            image.signed === true &&
            image.attestations.provenance === true &&
            image.attestations.sbom === true,
        )),
    replayProtected:
      lineageFreshness === "current" &&
      ordinalMonotonic &&
      !assessmentIdReused &&
      !nonceReused,
    sourceOfTruthExplicit: sa.governance.sourceOfTruth === "source-registry",
    cicdSourceBound: (SOURCE_PAIRINGS[reg.provider] ?? []).includes(sa.cicd.provider),
    cicdTriggersGoverned:
      sa.cicd.triggers.protectedBranchPush === true &&
      sa.cicd.triggers.pullRequestFromForks !== "allowed" &&
      sa.cicd.protectedBranches.length > 0 &&
      prodEnvironments.length > 0 &&
      prodEnvironments.every((environment) => environment.requiredReviewers >= 1),
    cicdRunnerLeastPrivilege:
      (sa.cicd.runner.identityType === "oidc-federated" ||
        sa.cicd.runner.identityType === "workload-identity") &&
      sa.cicd.runner.privilege === "least" &&
      sa.cicd.runner.egress === "allowlist" &&
      cte.oidcFederation === true &&
      cte.runnerIdentity.leastPrivilege === true &&
      cte.runnerIdentity.egress === "allowlist",
    cicdEnvironmentSeparation:
      sa.cicd.environments.some((environment) => environment.purpose === "nonprod") &&
      prodEnvironments.length > 0 &&
      sa.cicd.environments.every(
        (environment) =>
          environment.isolatedSecrets === true && environment.isolatedIdentity === true,
      ) &&
      prodEnvironments.every((environment) => environment.requiredReviewers >= 1),
    cicdSecretReferencesExternal:
      sa.cicd.secrets.every(
        (secret) => secret.exposure === "reference" && secret.store === "external-managed",
      ) && cte.secretStore === "external-managed",
    cicdPromotionGoverned:
      sa.cicd.promotion.model === "digest-immutable" &&
      sa.cicd.promotion.gateReferences.length > 0 &&
      input.transition.promotion.approvalReference !== null &&
      input.transition.promotion.gateReferences.length > 0,
    cicdDeploymentTargetsBound:
      sa.cicd.deploymentTargets.length > 0 &&
      sa.cicd.deploymentTargets.every(
        (target) =>
          target.boundByDigest === true &&
          target.approvalReference !== null &&
          envNames.has(target.environment) &&
          imageReferenceSet.has(target.imageReference),
      ),
    cicdDualPublishReady:
      input.transition.dualPublish.enabled === true &&
      input.transition.dualPublish.windowMinutes > 0 &&
      input.transition.dualPublish.sourceRegistryReference === reg.reference &&
      input.transition.dualPublish.targetRegistryReference === rte.reference,
    cicdRollbackComplete:
      input.transition.rollbackPlan !== null &&
      input.transition.rollbackPlan.rollbackWindowMinutes > 0 &&
      input.transition.rollbackPlan.conditions.length > 0 &&
      input.transition.rollbackPlan.failbackSourceOfTruth === "source-registry" &&
      input.transition.rollbackPlan.stepReferences.length > 0,
  };

  const sourceReference = sa.governance.evidenceReferences[0];
  const registryReference = rte.reference;
  const cicdReference = sa.cicd.pipelineReference;
  const targetCicdReference = cte.reference;
  const ownerReference = sa.governance.owner.reference;
  const lineageReference = input.lineage.lineageId;

  const checks = [
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.assessmentCurrent,
      values.assessmentCurrent ? "pass" : "unresolved",
      sourceFreshness,
      values.assessmentCurrent
        ? "The container image and CI/CD source assessment is current and bounded by an explicit expiry."
        : "The source assessment is not current.",
      [sourceReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.evidenceComplete,
      values.evidenceComplete ? "pass" : "fail",
      sourceFreshness,
      values.evidenceComplete
        ? "Every scoped image, deployment target, and environment resolves to assessed evidence."
        : "Scoped images, deployment targets, or environments reference evidence that is missing; review is required.",
      [sourceReference, cicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.targetBound,
      values.targetBound ? "pass" : "fail",
      targetFreshness,
      values.targetBound
        ? "The Azure Container Registry and CI/CD target evidence is bound to an allowed region, matching residency, and the assessed environments and protected branches."
        : "The target region, residency, environments, or protected branches do not match the region policy and source assessment.",
      [registryReference, targetCicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.digestPinned,
      values.digestPinned ? "pass" : "fail",
      sourceFreshness,
      values.digestPinned
        ? "Every image and deployment reference is pinned by immutable digest and mutable-tag deploys are disabled."
        : "One or more references are not digest-pinned or mutable-tag deploys are enabled.",
      [sourceReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.mutableTagUntrusted,
      values.mutableTagUntrusted ? "pass" : "fail",
      targetFreshness,
      values.mutableTagUntrusted
        ? "Source and target registries enforce tag immutability and never trust mutable tags."
        : "Source or target tag immutability is disabled, or mutable tags are trusted.",
      [registryReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.platformsCompatible,
      values.platformsCompatible ? "pass" : "fail",
      targetFreshness,
      values.platformsCompatible
        ? "Every image platform is supported by the target registry and required multi-arch platforms are present."
        : "Image platforms are unsupported by the target or a required multi-arch platform is missing.",
      [registryReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.baseImageSupported,
      values.baseImageSupported ? "pass" : "fail",
      sourceFreshness,
      values.baseImageSupported
        ? "Base images are in scope and every base image is on a supported lifecycle."
        : "Base images are omitted from scope or a base image is deprecated, end-of-life, or unknown.",
      [sourceReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.sbomPresent,
      values.sbomPresent ? "pass" : "fail",
      sourceFreshness,
      values.sbomPresent
        ? "Every image carries an SBOM in a supported format."
        : "One or more images lack an SBOM in a supported format.",
      [sourceReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.signaturesVerified,
      values.signaturesVerified ? "pass" : "fail",
      targetFreshness,
      values.signaturesVerified
        ? "Every image is signed and the target enforces signature verification."
        : "One or more images are unsigned or the target does not enforce signature verification.",
      [registryReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.provenanceContinuous,
      values.provenanceContinuous ? "pass" : "fail",
      targetFreshness,
      values.provenanceContinuous
        ? "Every image has provenance whose subject digest matches the artifact and the target preserves the digest on promotion."
        : "Provenance is missing, its subject digest does not match the artifact, or the target does not preserve the digest.",
      [sourceReference, registryReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.vulnerabilityPolicyMet,
      values.vulnerabilityPolicyMet ? "pass" : "fail",
      sourceFreshness,
      values.vulnerabilityPolicyMet
        ? "Every image has a current scan within the critical and high vulnerability policy."
        : "One or more images are unscanned or exceed the critical or high vulnerability policy.",
      [sourceReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.registryControlsParity,
      values.registryControlsParity ? "pass" : "fail",
      registryFreshness,
      values.registryControlsParity
        ? "Target replication, retention, encryption, and network controls meet the configured policy."
        : "Target replication, retention, encryption, or network controls are below the configured policy.",
      [registryReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.unsignedPromotionBlocked,
      values.unsignedPromotionBlocked ? "pass" : "fail",
      targetFreshness,
      values.unsignedPromotionBlocked
        ? "Promotion requires signatures and attestations and the target verifies them, so unsigned or unattested images cannot be promoted."
        : "Unsigned or unattested images could be promoted because a signature, attestation, or verification control is missing.",
      [registryReference, cicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.replayProtected,
      values.replayProtected ? "pass" : "fail",
      lineageFreshness,
      values.replayProtected
        ? "The attempt lineage is current, its ordinal is monotonic, and the assessment and nonce are not replayed."
        : "The attempt lineage is stale, non-monotonic, or replays an accepted assessment or nonce.",
      [lineageReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.sourceOfTruthExplicit,
      values.sourceOfTruthExplicit ? "pass" : "fail",
      sourceFreshness,
      values.sourceOfTruthExplicit
        ? "The source registry remains authoritative until an approved cutover completes."
        : "The source of truth is ambiguous or prematurely assigned to the target.",
      [ownerReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdSourceBound,
      values.cicdSourceBound ? "pass" : "fail",
      sourceFreshness,
      values.cicdSourceBound
        ? "The source registry and CI/CD provider pairing is supported by this planner."
        : "The source registry and CI/CD provider pairing is not supported and requires manual architecture review.",
      [cicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdTriggersGoverned,
      values.cicdTriggersGoverned ? "pass" : "fail",
      sourceFreshness,
      values.cicdTriggersGoverned
        ? "Build triggers are restricted, protected branches are defined, and production environments require reviewers."
        : "Build triggers, protected branches, or production environment protection are insufficient.",
      [cicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdRunnerLeastPrivilege,
      values.cicdRunnerLeastPrivilege ? "pass" : "fail",
      combined(sourceFreshness, cicdFreshness),
      values.cicdRunnerLeastPrivilege
        ? "Runner identity is federated and least privilege with controlled egress on both source and target."
        : "Runner identity uses static credentials, broad privilege, or uncontrolled egress.",
      [cicdReference, targetCicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdEnvironmentSeparation,
      values.cicdEnvironmentSeparation ? "pass" : "fail",
      sourceFreshness,
      values.cicdEnvironmentSeparation
        ? "Nonproduction and production environments are separated with isolated secrets, identity, and production reviewers."
        : "Environments share secrets or identity, or lack production separation and reviewers.",
      [cicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdSecretReferencesExternal,
      values.cicdSecretReferencesExternal ? "pass" : "fail",
      combined(sourceFreshness, cicdFreshness),
      values.cicdSecretReferencesExternal
        ? "Every pipeline secret is an external-managed reference and the target uses an external secret store."
        : "A pipeline secret is inline, plaintext, pipeline-native, or the target secret store is not external.",
      [cicdReference, targetCicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdPromotionGoverned,
      values.cicdPromotionGoverned ? "pass" : "fail",
      sourceFreshness,
      values.cicdPromotionGoverned
        ? "Artifact promotion is digest-immutable, gated, and approval-bound."
        : "Artifact promotion is tag-mutable, ungated, or missing an approval.",
      [cicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdDeploymentTargetsBound,
      values.cicdDeploymentTargetsBound ? "pass" : "fail",
      sourceFreshness,
      values.cicdDeploymentTargetsBound
        ? "Every deployment target is digest-bound, approval-bound, and resolves to a scoped image and environment."
        : "A deployment target is not digest-bound, lacks approval, or references an unknown image or environment.",
      [cicdReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdDualPublishReady,
      values.cicdDualPublishReady ? "pass" : "fail",
      "not-applicable",
      values.cicdDualPublishReady
        ? "Dual publish is enabled within a bounded window and binds the exact source and target registries."
        : "Dual publish is disabled, unbounded, or does not bind the exact source and target registries.",
      [input.transition.cutoverReference, input.transition.trafficShiftReference],
    ),
    resultCheck(
      CONTAINER_CICD_CHECK_IDS.cicdRollbackComplete,
      values.cicdRollbackComplete ? "pass" : "fail",
      "not-applicable",
      values.cicdRollbackComplete
        ? "Rollback has an owner, bounded window, explicit conditions, source-registry failback, and steps."
        : "Rollback is missing or incomplete.",
      input.transition.rollbackPlan
        ? [input.transition.rollbackPlan.ownerReference]
        : [],
    ),
  ];

  return {
    checks,
    details: {
      sourceFreshness,
      registryFreshness,
      cicdFreshness,
      lineageFreshness,
      targetFreshness,
      values,
      findings: {
        unsupportedPlatformImages,
        missingRequiredPlatformImages,
        unsignedImages,
        missingSbomImages,
        missingProvenanceImages,
        discontinuousProvenanceImages,
        unsupportedBaseImages,
        unscannedImages,
        vulnerableImages,
        unpinnedDeploymentTargets,
      },
    },
  };
}

const REMEDIATIONS = Object.freeze({
  [CONTAINER_CICD_CHECK_IDS.assessmentCurrent]:
    "Re-observe the source assessment so it is current within the configured maximum age.",
  [CONTAINER_CICD_CHECK_IDS.evidenceComplete]:
    "Reconcile scope, images, deployment targets, and environments so no evidence is missing.",
  [CONTAINER_CICD_CHECK_IDS.targetBound]:
    "Bind the target registry and CI/CD evidence to an allowed region, matching residency, and the assessed environments and branches.",
  [CONTAINER_CICD_CHECK_IDS.digestPinned]:
    "Pin every image and deployment reference by immutable digest and disable mutable-tag deploys.",
  [CONTAINER_CICD_CHECK_IDS.mutableTagUntrusted]:
    "Enable tag immutability on the source and target registries and never trust mutable tags.",
  [CONTAINER_CICD_CHECK_IDS.platformsCompatible]:
    "Rebuild or omit images whose platforms are unsupported and ensure required multi-arch platforms are present.",
  [CONTAINER_CICD_CHECK_IDS.baseImageSupported]:
    "Include base images in scope and update any deprecated, end-of-life, or unknown base image.",
  [CONTAINER_CICD_CHECK_IDS.sbomPresent]:
    "Attach a supported-format SBOM to every image.",
  [CONTAINER_CICD_CHECK_IDS.signaturesVerified]:
    "Sign every image and enable signature verification on the target registry.",
  [CONTAINER_CICD_CHECK_IDS.provenanceContinuous]:
    "Produce provenance whose subject digest matches the artifact and preserve the digest through promotion.",
  [CONTAINER_CICD_CHECK_IDS.vulnerabilityPolicyMet]:
    "Rescan images and remediate findings until the critical and high vulnerability policy is met.",
  [CONTAINER_CICD_CHECK_IDS.registryControlsParity]:
    "Configure target replication, retention, encryption, and network controls to meet the policy.",
  [CONTAINER_CICD_CHECK_IDS.unsignedPromotionBlocked]:
    "Require signatures and attestations for promotion and enforce verification on the target.",
  [CONTAINER_CICD_CHECK_IDS.replayProtected]:
    "Advance the attempt lineage with a fresh monotonic ordinal, a new nonce, and an unreplayed assessment.",
  [CONTAINER_CICD_CHECK_IDS.sourceOfTruthExplicit]:
    "Keep the source registry authoritative until an approved cutover completes.",
  [CONTAINER_CICD_CHECK_IDS.cicdSourceBound]:
    "Use a supported source-registry and CI/CD pairing or obtain manual architecture review.",
  [CONTAINER_CICD_CHECK_IDS.cicdTriggersGoverned]:
    "Restrict build triggers, define protected branches, and require production environment reviewers.",
  [CONTAINER_CICD_CHECK_IDS.cicdRunnerLeastPrivilege]:
    "Use federated least-privilege runner identity with controlled egress on the source and target.",
  [CONTAINER_CICD_CHECK_IDS.cicdEnvironmentSeparation]:
    "Separate nonproduction and production with isolated secrets, identity, and production reviewers.",
  [CONTAINER_CICD_CHECK_IDS.cicdSecretReferencesExternal]:
    "Store every secret in an external-managed store and reference it without inlining values.",
  [CONTAINER_CICD_CHECK_IDS.cicdPromotionGoverned]:
    "Make promotion digest-immutable, gated, and approval-bound.",
  [CONTAINER_CICD_CHECK_IDS.cicdDeploymentTargetsBound]:
    "Bind every deployment target by digest and approval to a scoped image and environment.",
  [CONTAINER_CICD_CHECK_IDS.cicdDualPublishReady]:
    "Enable a bounded dual-publish window that binds the exact source and target registries.",
  [CONTAINER_CICD_CHECK_IDS.cicdRollbackComplete]:
    "Provide a rollback owner, bounded window, conditions, source-registry failback, and steps.",
});

function selectStrategy(input, checks) {
  const requested = input.transition.strategy;
  const failing = checks.filter((check) => check.classification !== "pass");
  const rationale = [];
  let selected = "blocked-manual-review";
  if (failing.length > 0) {
    rationale.push(...failing.map((check) => `${check.id} did not pass.`));
  } else {
    selected = "dual-publish-cutover";
    rationale.push(
      "All cataloged container image and CI/CD checks passed; a guarded dual-publish and cutover transition is represented for human execution.",
    );
  }
  return {
    requested,
    selected,
    rationale,
    dualPublishWindowMinutes: input.transition.dualPublish.windowMinutes,
  };
}

function stageGates(status, strategy) {
  const blocked = status === "blocked";
  return STAGE_ORDER.map((state) => ({
    state,
    status:
      state === "assess"
        ? blocked
          ? "blocked"
          : "pass"
        : state === "rollback-required"
          ? "not-triggered"
          : blocked
            ? "blocked"
            : "pending-human-confirmation",
    gate:
      state === "assess"
        ? "All cataloged container image and CI/CD checks must pass."
        : `${state} requires fresh bound evidence, prior-stage proof, and explicit human confirmation.`,
    executionAllowed: false,
    strategy: strategy.selected,
  }));
}

function buildFindings(details) {
  const { findings, values } = details;
  const output = [];
  if (findings.unsupportedPlatformImages.length > 0) {
    output.push(
      `Images with platforms unsupported by the target registry: ${findings.unsupportedPlatformImages.join(", ")}.`,
    );
  }
  if (findings.missingRequiredPlatformImages.length > 0) {
    output.push(
      `Images missing a required multi-arch platform: ${findings.missingRequiredPlatformImages.join(", ")}.`,
    );
  }
  if (findings.unsignedImages.length > 0) {
    output.push(`Unsigned images: ${findings.unsignedImages.join(", ")}.`);
  }
  if (findings.missingSbomImages.length > 0) {
    output.push(`Images without a supported SBOM: ${findings.missingSbomImages.join(", ")}.`);
  }
  const provenanceIssues = [
    ...new Set([
      ...findings.missingProvenanceImages,
      ...findings.discontinuousProvenanceImages,
    ]),
  ].sort();
  if (provenanceIssues.length > 0) {
    output.push(
      `Images with missing or discontinuous provenance: ${provenanceIssues.join(", ")}.`,
    );
  }
  if (findings.unsupportedBaseImages.length > 0) {
    output.push(
      `Images on unsupported base images: ${findings.unsupportedBaseImages.join(", ")}.`,
    );
  }
  if (findings.unscannedImages.length > 0) {
    output.push(
      `Images without a current vulnerability scan: ${findings.unscannedImages.join(", ")}.`,
    );
  }
  if (findings.vulnerableImages.length > 0) {
    output.push(
      `Images exceeding the vulnerability policy: ${findings.vulnerableImages.join(", ")}.`,
    );
  }
  if (findings.unpinnedDeploymentTargets.length > 0) {
    output.push(
      `Deployment targets that are not digest-pinned: ${findings.unpinnedDeploymentTargets.join(", ")}.`,
    );
  }
  if (!values.mutableTagUntrusted) {
    output.push("A source or target registry trusts mutable tags.");
  }
  if (!values.cicdSourceBound) {
    output.push("The source registry and CI/CD provider pairing is unsupported.");
  }
  return [...new Set(output)].sort();
}

function buildTransitionPlan(input, details, checks, status) {
  const failing = checks.filter((check) => check.classification !== "pass");
  const requiredRemediations = [
    ...new Set(failing.map((check) => REMEDIATIONS[check.id]).filter(Boolean)),
  ].sort();
  const rollbackPlan = input.transition.rollbackPlan;
  return {
    prerequisites: [
      "Reconfirm source assessment, target registry, and CI/CD target evidence freshness.",
      "Recompute and compare every container identity digest before any promotion.",
      "Obtain human confirmation for registry capacity, private connectivity, signing keys, and runner identity.",
      "Complete a representative dual-publish rehearsal before declaring cutover-ready.",
    ],
    unsupportedFindings: buildFindings(details),
    requiredRemediations,
    registryConfiguration: [
      "Provision the target Azure Container Registry with the reviewed SKU, replication, retention, encryption, and private network posture.",
      "Enable tag immutability, quarantine, signature verification, SBOM, and provenance capabilities before any promotion.",
      "Do not import any image until digest pinning and control parity are confirmed.",
    ],
    pipelineConfiguration: [
      "Configure the target CI/CD platform with federated least-privilege identity and controlled egress.",
      "Recreate protected branches, environment protection, and required reviewers without weakening source controls.",
      "Bind every secret to the external-managed store as a reference only.",
    ],
    imagePromotion: [
      "Promote images only by immutable digest, preserving provenance subject continuity.",
      "Reject any unsigned or unattested image at the promotion gate.",
      "Record source digest, target digest, signature, SBOM, and provenance references for every promoted image.",
    ],
    validation: [
      "Compare source and target digests, platforms, signatures, SBOMs, and provenance for parity.",
      "Confirm vulnerability scans on the promoted images remain within policy.",
      "Run application smoke tests against the target-backed nonproduction environment before cutover.",
    ],
    cutover: [
      "Obtain cutover approval after rehearsal evidence and all checks pass.",
      `Shift deployment traffic only through ${input.transition.trafficShiftReference}.`,
      `Apply cutover only through ${input.transition.cutoverReference}.`,
      `Rotate credentials using opaque references: ${input.transition.secretRotationReferences.join(", ")}.`,
    ],
    rollback: rollbackPlan
      ? [
          `Keep the source registry authoritative and available for ${rollbackPlan.rollbackWindowMinutes} minutes after cutover.`,
          ...rollbackPlan.conditions.map(
            (reference) => `Evaluate rollback condition ${reference}.`,
          ),
          ...rollbackPlan.stepReferences.map(
            (reference) => `Execute only the separately approved failback procedure ${reference}.`,
          ),
        ]
      : [
          "Rollback plan is missing; the transition remains blocked pending a reviewed rollback and failback runbook.",
        ],
    sourceOfTruthRules: [
      "The source registry is authoritative before cutover.",
      "The target registry becomes authoritative only after dual publish, validation, and explicit cutover approval.",
      "Never trust a mutable tag or promote an unsigned or unattested image.",
      "During rollback, the source registry becomes authoritative only under the reviewed failback rules.",
    ],
    cleanup: [
      "Retain the source registry, promoted digests, and rollback capability for the approved rollback window.",
      "After the rollback window, decommission dual-publish credentials and temporary access only through a separate approved change.",
      "Do not delete source images until retention, audit, compliance, and owner confirmations are complete.",
    ],
    unresolvedDecisions:
      status === "blocked" ? failing.map((check) => check.id).sort() : [],
  };
}

function identityBindings(input, details, strategy) {
  const sa = input.sourceAssessment;
  const rte = input.target.registryTargetEvidence;
  const cte = input.target.cicdTargetEvidence;
  const sourceAssessmentDigest = digest(sa);
  const registryEvidenceDigest = digest(rte);
  const cicdEvidenceDigest = digest(cte);
  const regionPolicyDigest = digest(input.target.regionPolicy);
  const requirementsDigest = digest(input.requirements);
  const transitionDigest = digest(input.transition);
  const scopeDigest = digest(input.scope);
  const ownerDigest = digest(sa.governance.owner);
  const lineageDigest = digest(input.lineage);
  const integrationDigest = digest(input.integration);
  const identity = {
    sourceAssessmentDigest,
    sourceAssessmentObservedAt: sa.observedAt,
    sourceAssessmentExpiresAt: sa.expiresAt,
    sourceAssessmentFreshness: details.sourceFreshness,
    registryEvidenceDigest,
    cicdEvidenceDigest,
    regionPolicyDigest,
    requirementsDigest,
    transitionDigest,
    scopeDigest,
    ownerDigest,
    lineageDigest,
    integrationDigest,
    targetRegion: rte.region,
    targetResidency: rte.residency,
    registrySku: rte.sku,
    cicdProvider: cte.provider,
    strategy: strategy.selected,
  };
  const containerIdentityDigest = digest(identity);
  const binding = {
    containerIdentityDigest,
    sourceAssessmentDigest,
    registryEvidenceDigest,
    cicdEvidenceDigest,
    regionPolicyDigest,
    requirementsDigest,
    transitionDigest,
    scopeDigest,
    ownerDigest,
    lineageDigest,
    integrationDigest,
    strategy: strategy.selected,
    executionEligible: false,
  };
  return {
    ...identity,
    containerIdentityDigest,
    readiness: binding,
    iac: binding,
    manifest: binding,
    approval: binding,
  };
}

function planContainerImageCicd(input) {
  assertNonSecretMetadata(input);
  validateDocument(inputSchema, input);
  const evaluation = evaluate(input);
  const strategy = selectStrategy(input, evaluation.checks);
  const status =
    evaluation.checks.every((check) => check.classification === "pass") &&
    strategy.selected !== "blocked-manual-review"
      ? "ready"
      : "blocked";
  const sa = input.sourceAssessment;
  const rte = input.target.registryTargetEvidence;
  const cte = input.target.cicdTargetEvidence;
  const output = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    planId: input.planId,
    status,
    sourceAssessment: structuredClone(sa),
    sourceAssessmentDigest: digest(sa),
    target: {
      registryReference: rte.reference,
      region: rte.region,
      residency: rte.residency,
      sku: rte.sku,
      registryEvidenceDigest: digest(rte),
      registryEvidenceFreshness: evaluation.details.registryFreshness,
      cicdReference: cte.reference,
      cicdProvider: cte.provider,
      cicdEvidenceDigest: digest(cte),
      cicdEvidenceFreshness: evaluation.details.cicdFreshness,
    },
    requiredChecks: [...CONTAINER_CICD_CHECK_ORDER],
    checks: evaluation.checks,
    transition: strategy,
    stages: stageGates(status, strategy),
    transitionPlan: buildTransitionPlan(
      input,
      evaluation.details,
      evaluation.checks,
      status,
    ),
    identityBindings: identityBindings(input, evaluation.details, strategy),
    humanConfirmationRequired: [
      "Current source registry catalog, image inventory, and tag/digest accuracy",
      "Current target Azure Container Registry capacity, replication, retention, encryption, and network posture",
      "Signature, SBOM, provenance, and vulnerability evidence for every promoted image",
      "CI/CD source-of-truth ownership, protected branches, environment protection, and runner identity posture",
      "Dual-publish window, cutover authorization, traffic shift, secret rotation, and rollback authority",
    ],
    safety: {
      executionEnabled: false,
      executionEligible: false,
      sourceRegistryActions: "none",
      targetRegistryActions: "none",
      imagePushPull: "none",
      pipelineWrites: "none",
      cloudOperations: "none",
      iacActions: "none",
      dnsActions: "none",
      credentialActions: "none",
      generatedArtifacts: "stdout-only",
    },
    planDigest: "sha256:pending",
  };
  output.planDigest = digest(
    Object.fromEntries(
      Object.entries(output).filter(([key]) => key !== "planDigest"),
    ),
  );
  validateDocument(outputSchema, output);
  return output;
}

function parseArguments(args) {
  if (args[0] !== "plan") {
    throw new Error(
      "Usage: startup-container-image-cicd-plan.mjs plan --input <path> [--output json]",
    );
  }
  let inputPath = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--input") {
      inputPath = args[index + 1];
      index += 1;
    } else if (args[index] === "--output" && args[index + 1] === "json") {
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${args[index]}`);
    }
  }
  if (!inputPath) {
    throw new Error("--input is required.");
  }
  return { inputPath };
}

function main() {
  try {
    const { inputPath } = parseArguments(process.argv.slice(2));
    const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
    const plan = planContainerImageCicd(input);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = plan.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  CONTAINER_CICD_CHECK_IDS,
  CONTAINER_CICD_CHECK_ORDER,
  STAGE_ORDER,
  canonicalJson,
  digest as containerImageCicdDigest,
  planContainerImageCicd,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
