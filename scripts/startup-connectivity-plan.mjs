#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "1.0.0";
const PLANNER_VERSION = "1.0.0";

const CONNECTIVITY_CHECK_IDS = Object.freeze({
  architectureSupported: "migration.connectivity.architecture-supported",
  assessmentCurrent: "migration.connectivity.assessment-current",
  evidenceComplete: "migration.connectivity.evidence-complete",
  addressSpaceNoOverlap: "migration.connectivity.address-space-no-overlap",
  routeOwnershipExact: "migration.connectivity.route-ownership-exact",
  symmetricRouting: "migration.connectivity.symmetric-routing",
  noDefaultRoute: "migration.connectivity.no-default-route",
  bgpAsnAcceptable: "migration.connectivity.bgp-asn-acceptable",
  mtuCompatible: "migration.connectivity.mtu-compatible",
  gatewayRedundant: "migration.connectivity.gateway-redundant",
  firewallPolicyExplicit: "migration.connectivity.firewall-policy-explicit",
  privateEndpointReady: "migration.connectivity.private-endpoint-ready",
  targetBound: "migration.connectivity.target-bound",
  sourceOfTruthExplicit: "migration.connectivity.source-of-truth-explicit",
  integrityVerified: "migration.connectivity.integrity-verified",
  targetIntegrityVerified: "migration.connectivity.target-integrity-verified",
  replayProtected: "migration.connectivity.replay-protected",
  ownerConfirmed: "migration.connectivity.owner-confirmed",
  telemetryComplete: "migration.connectivity.telemetry-complete",
  recoveryComplete: "migration.connectivity.recovery-complete",
  transitionBounded: "migration.connectivity.transition-bounded",
  rollbackComplete: "migration.connectivity.rollback-complete",
  dnsAuthorityExplicit: "migration.dns.authority-explicit",
  dnsLoopPrevented: "migration.dns.loop-prevented",
  dnsResolverReachable: "migration.dns.resolver-reachable",
  dnsForwardingExplicit: "migration.dns.forwarding-explicit",
  dnsTtlPolicyMet: "migration.dns.ttl-policy-met",
  dnsCertificateSniBound: "migration.dns.certificate-sni-bound",
  identityOidcPinned: "migration.identity.oidc-pinned",
  identityNoLongLivedSecrets: "migration.identity.no-long-lived-secrets",
  identityLeastPrivilege: "migration.identity.least-privilege",
  identityEnvironmentSeparation: "migration.identity.environment-separation",
  egressBoundedAllowlist: "migration.egress.bounded-allowlist",
  egressDefaultDenyEnforced: "migration.egress.default-deny-enforced",
  egressNatProxyExplicit: "migration.egress.nat-proxy-explicit",
});
const CONNECTIVITY_CHECK_ORDER = Object.freeze(
  Object.values(CONNECTIVITY_CHECK_IDS),
);

const STAGE_ORDER = Object.freeze([
  "assess",
  "provision-connectivity",
  "configure-dns",
  "configure-identity",
  "configure-egress",
  "validate-coexistence",
  "cutover",
  "verify",
  "rollback-required",
  "completed",
]);

// Supported source-cloud connectivity to Azure gateway pairings modelled by
// this planner. Any pairing outside this table is unsupported and forces
// blocked-manual-review, regardless of how complete the remaining evidence is.
const ARCHITECTURE_PAIRINGS = Object.freeze({
  "aws:direct-connect": "expressroute",
  "aws:site-to-site-vpn": "vpn-gateway",
  "gcp:cloud-interconnect": "expressroute",
  "gcp:cloud-vpn": "vpn-gateway",
  "onprem-generic:expressroute": "expressroute",
  "onprem-generic:ipsec-vpn": "vpn-gateway",
});

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const inputSchema = load("agent/schemas/connectivity-plan-input.schema.json");
const outputSchema = load("agent/schemas/connectivity-plan.schema.json");

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
        `connectivity.identity.secret-material: ${path} contains secret material; use an opaque reference.`,
      );
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      throw new Error(
        `connectivity.identity.secret-material: ${path}.${key} is not an allowed metadata field.`,
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

// A minimal IPv4 CIDR overlap test, reused verbatim from
// scripts/startup-cool-foundation-plan.mjs. IPv6 destinations are out of
// scope for this planner iteration; see docs/dual-cloud-connectivity-planning.md.
function cidrRange(cidr) {
  const match = String(cidr).match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/,
  );
  if (!match) {
    return null;
  }
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((item) => item > 255) || prefix < 0 || prefix > 32) {
    return null;
  }
  const value = octets.reduce((result, item) => result * 256 + item, 0);
  const block = 2 ** (32 - prefix);
  const start = Math.floor(value / block) * block;
  return { start, end: start + block - 1 };
}

function cidrsOverlap(first, second) {
  const left = cidrRange(first);
  const right = cidrRange(second);
  return !left || !right || (left.start <= right.end && right.start <= left.end);
}

function cidrPrefixLength(cidr) {
  const prefix = Number(String(cidr).split("/")[1]);
  return Number.isInteger(prefix) ? prefix : -1;
}

function evaluate(input) {
  const sa = input.sourceAssessment;
  const cte = input.target.connectivityTargetEvidence;
  const dte = input.target.dnsTargetEvidence;
  const ite = input.target.identityTargetEvidence;
  const ete = input.target.egressTargetEvidence;
  const regionPolicy = input.target.regionPolicy;
  const req = input.requirements;

  const sourceFreshness = evidenceFreshness(sa.observedAt, sa.expiresAt, input);
  const connectivityFreshness = evidenceFreshness(cte.observedAt, cte.expiresAt, input);
  const dnsFreshness = evidenceFreshness(dte.observedAt, dte.expiresAt, input);
  const identityFreshness = evidenceFreshness(ite.observedAt, ite.expiresAt, input);
  const egressFreshness = evidenceFreshness(ete.observedAt, ete.expiresAt, input);
  const lineageFreshness = evidenceFreshness(
    input.lineage.observedAt,
    input.lineage.expiresAt,
    input,
  );
  const targetFreshness = combined(
    connectivityFreshness,
    dnsFreshness,
    identityFreshness,
    egressFreshness,
  );

  const architectureKey = `${sa.cloud.provider}:${sa.cloud.connectivityType}`;
  const requiredGatewayKind = ARCHITECTURE_PAIRINGS[architectureKey] ?? null;

  const rawOverlap = sa.network.cidrs.some((sourceCidr) =>
    cte.azureCidrs.some((azureCidr) => cidrsOverlap(sourceCidr, azureCidr)),
  );
  const overlappingSourcePrefixes = sa.network.cidrs
    .filter((sourceCidr) =>
      cte.azureCidrs.some((azureCidr) => cidrsOverlap(sourceCidr, azureCidr)),
    )
    .sort();
  const translation = sa.network.addressTranslation;
  const translatedSourcePrefixes = translation
    ? translation.translatedPrefixes.map((entry) => entry.sourcePrefix)
    : [];
  const translationSound = Boolean(
    translation &&
      translation.approved === true &&
      translation.ownerReference &&
      translation.reference &&
      translatedSourcePrefixes.length === new Set(translatedSourcePrefixes).size &&
      overlappingSourcePrefixes.every((prefix) =>
        translatedSourcePrefixes.includes(prefix),
      ) &&
      translation.translatedPrefixes.every(
        (entry) =>
          sa.network.cidrs.includes(entry.sourcePrefix) &&
          cidrRange(entry.sourcePrefix).end - cidrRange(entry.sourcePrefix).start ===
            cidrRange(entry.translatedPrefix).end -
              cidrRange(entry.translatedPrefix).start &&
          !cte.azureCidrs.some((azureCidr) =>
            cidrsOverlap(entry.translatedPrefix, azureCidr),
          ) &&
          sa.network.cidrs
            .filter((sourceCidr) => !translatedSourcePrefixes.includes(sourceCidr))
            .every(
              (sourceCidr) =>
                !cidrsOverlap(entry.translatedPrefix, sourceCidr),
            ),
      ) &&
      translation.translatedPrefixes.every(
        (entry, index) =>
          !translation.translatedPrefixes.some(
            (other, otherIndex) =>
              otherIndex !== index &&
              cidrsOverlap(entry.translatedPrefix, other.translatedPrefix),
          ),
      ),
  );

  const cidrSet = new Set(sa.network.cidrs);
  const routeOwners = sa.network.routing.routeOwners;
  const ownerPrefixes = routeOwners.map((owner) => owner.prefix);
  const uniqueOwnerPrefixes = new Set(ownerPrefixes);
  const sourceRouteOwnershipExact =
    ownerPrefixes.length === uniqueOwnerPrefixes.size &&
    cidrSet.size === sa.network.cidrs.length &&
    uniqueOwnerPrefixes.size === cidrSet.size &&
    [...cidrSet].every((prefix) => uniqueOwnerPrefixes.has(prefix));
  const targetCidrSet = new Set(cte.azureCidrs);
  const targetOwnerPrefixes = cte.routing.routeOwners.map((owner) => owner.prefix);
  const uniqueTargetOwnerPrefixes = new Set(targetOwnerPrefixes);
  const targetRouteOwnershipExact =
    targetOwnerPrefixes.length === uniqueTargetOwnerPrefixes.size &&
    targetCidrSet.size === cte.azureCidrs.length &&
    uniqueTargetOwnerPrefixes.size === targetCidrSet.size &&
    [...targetCidrSet].every((prefix) =>
      uniqueTargetOwnerPrefixes.has(prefix),
    );
  const routingDomainBound =
    sa.network.gateways.every(
      (gateway) =>
        gateway.routingDomainReference === cte.routingDomainReference,
    );

  const acceptableAsns = new Set(req.acceptableAsns);
  const sourceAsns = sa.network.gateways.map((gateway) => gateway.bgpAsn);
  const unacceptableAsns = [...new Set([...sourceAsns, cte.bgpAsn])]
    .filter((asn) => !acceptableAsns.has(asn))
    .sort((a, b) => a - b);

  const sourceMtus = sa.network.gateways.map((gateway) => gateway.mtu);
  const incompatibleMtus = [...new Set([...sourceMtus, cte.mtu])]
    .filter((mtu) => mtu !== req.requiredMtu)
    .sort((a, b) => a - b);

  const targetPrivateAccess = new Set(
    cte.privateEndpoints.map((entry) => `${entry.kind}:${entry.service}`),
  );
  const missingPrivateEndpointServices = sa.network.privateAccess
    .filter((entry) => !targetPrivateAccess.has(`${entry.kind}:${entry.service}`))
    .map((entry) => `${entry.kind}:${entry.service}`)
    .sort();

  const allDnsZones = [...sa.dns.zones, ...dte.zones];
  const allResolvers = [...sa.dns.resolvers, ...dte.resolvers];
  const unreachableResolvers = allResolvers
    .filter(
      (resolver) =>
        resolver.reachableFromSource !== true || resolver.reachableFromTarget !== true,
    )
    .map((resolver) => resolver.reference)
    .sort();
  const allCertificates = [...sa.dns.certificates, ...dte.certificates];
  const unresolvedSniCertificates = allCertificates
    .filter((certificate) => certificate.sniDependent && !certificate.dnsDependencyResolved)
    .map((certificate) => certificate.reference)
    .sort();

  const sourceEnvironments = sa.identity.environments;
  const targetEnvironments = ite.environments;
  const sourceEnvironmentNames = new Set(sourceEnvironments.map((environment) => environment.name));
  const targetEnvironmentNames = new Set(targetEnvironments.map((environment) => environment.name));
  const hasNonprodEnvironment = sourceEnvironments.some(
    (environment) => environment.purpose === "nonprod",
  );
  const hasProdEnvironment = sourceEnvironments.some(
    (environment) => environment.purpose === "prod",
  );
  const targetHasNonprodEnvironment = targetEnvironments.some(
    (environment) => environment.purpose === "nonprod",
  );
  const targetHasProdEnvironment = targetEnvironments.some(
    (environment) => environment.purpose === "prod",
  );
  const environmentsMatch =
    sourceEnvironments.length === targetEnvironments.length &&
    sourceEnvironments.every((environment) =>
      targetEnvironments.some(
        (targetEnvironment) =>
          targetEnvironment.name === environment.name &&
          targetEnvironment.purpose === environment.purpose,
      ),
    );
  const allEnvironmentsIsolated =
    sourceEnvironments.every((environment) => environment.isolatedIdentity === true) &&
    targetEnvironments.every((environment) => environment.isolatedIdentity === true);
  const federationEnvironmentBound =
    sa.identity.federation.environment !== "shared" &&
    sourceEnvironmentNames.has(sa.identity.federation.environment) &&
    ite.federation.environment !== "shared" &&
    targetEnvironmentNames.has(ite.federation.environment) &&
    sa.identity.federation.environment === ite.federation.environment;

  const isBroadDestination = (destination) =>
    cidrPrefixLength(destination) < req.minimumEgressPrefixLength;
  const broadEgressDestinations = [...sa.egress.allowlist, ...ete.allowlist]
    .filter((entry) => isBroadDestination(entry.destination))
    .map((entry) => entry.reference)
    .sort();

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

  const rollbackPlan = input.transition.rollbackPlan;

  const values = {
    architectureSupported:
      requiredGatewayKind !== null && requiredGatewayKind === cte.gatewayKind,
    assessmentCurrent: sourceFreshness === "current",
    evidenceComplete:
      sa.governance.evidenceReferences.length > 0 &&
      sa.network.gateways.length > 0 &&
      sa.dns.zones.length > 0 &&
      sa.identity.environments.length > 0 &&
      sa.egress.allowlist.length > 0,
    addressSpaceNoOverlap: translation ? translationSound : !rawOverlap,
    routeOwnershipExact:
      sourceRouteOwnershipExact &&
      targetRouteOwnershipExact &&
      routingDomainBound,
    symmetricRouting: sa.network.routing.symmetric === true && cte.routing.symmetric === true,
    noDefaultRoute:
      sa.network.routing.defaultRouteAdvertised === false &&
      sa.network.routing.defaultRouteAccepted === false &&
      cte.routing.defaultRouteAdvertised === false &&
      cte.routing.defaultRouteAccepted === false &&
      [...sa.network.cidrs, ...ownerPrefixes, ...cte.azureCidrs, ...targetOwnerPrefixes]
        .every(
          (prefix) =>
            cidrPrefixLength(prefix) >= req.minimumRoutePrefixLength,
        ),
    bgpAsnAcceptable: unacceptableAsns.length === 0,
    mtuCompatible: incompatibleMtus.length === 0,
    gatewayRedundant:
      sa.network.gateways.every((gateway) => gateway.redundant === true) &&
      cte.redundant === true,
    firewallPolicyExplicit:
      sa.network.firewallPolicy.explicitDenyByDefault === true &&
      Boolean(sa.network.firewallPolicy.intentReference) &&
      cte.firewallPolicy.explicitDenyByDefault === true &&
      Boolean(cte.firewallPolicy.intentReference),
    privateEndpointReady: missingPrivateEndpointServices.length === 0,
    targetBound:
      regionPolicy.allowedRegions.includes(cte.region) &&
      cte.residency === regionPolicy.residency &&
      regionPolicy.residency === sa.governance.dataResidency,
    sourceOfTruthExplicit: sa.governance.sourceOfTruth === "source-network",
    integrityVerified:
      digest(sa) === input.integrityClaims.sourceAssessmentDigestClaim,
    targetIntegrityVerified:
      digest(input.target) === input.integrityClaims.targetEvidenceDigestClaim,
    replayProtected:
      lineageFreshness === "current" &&
      ordinalMonotonic &&
      !assessmentIdReused &&
      !nonceReused,
    ownerConfirmed: sa.governance.owner.confirmed === true,
    telemetryComplete:
      sa.governance.telemetry.logsCentralized === true &&
      sa.governance.telemetry.alertingConfigured === true &&
      Boolean(sa.governance.telemetry.monitoringReference) &&
      cte.telemetry.logsCentralized === true &&
      cte.telemetry.alertingConfigured === true &&
      Boolean(cte.telemetry.monitoringReference),
    recoveryComplete:
      sa.governance.recovery.rpoMinutes <= req.maxRpoMinutes &&
      sa.governance.recovery.rtoMinutes <= req.maxRtoMinutes &&
      Boolean(sa.governance.recovery.rollbackReference),
    transitionBounded: input.transition.coexistenceWindowMinutes > 0,
    rollbackComplete:
      rollbackPlan !== null &&
      rollbackPlan.rollbackWindowMinutes > 0 &&
      rollbackPlan.conditions.length > 0 &&
      rollbackPlan.failbackSourceOfTruth === "source-network" &&
      rollbackPlan.stepReferences.length > 0,
    dnsAuthorityExplicit:
      allDnsZones.length > 0 &&
      allDnsZones.every((zone) => zone.sourceOfTruthReference !== null),
    dnsLoopPrevented:
      sa.dns.forwarding.loopDetected === false && dte.forwarding.loopDetected === false,
    dnsResolverReachable: unreachableResolvers.length === 0,
    dnsForwardingExplicit:
      sa.dns.forwarding.conditionalForwardingConfigured === true &&
      sa.dns.forwarding.splitHorizon === true &&
      dte.forwarding.conditionalForwardingConfigured === true &&
      dte.forwarding.splitHorizon === true,
    dnsTtlPolicyMet:
      sa.dns.ttlPolicy.maxTtlSeconds <= req.maxTtlSeconds &&
      sa.dns.ttlPolicy.negativeCachingSeconds <= req.maxTtlSeconds &&
      dte.ttlPolicy.maxTtlSeconds <= req.maxTtlSeconds &&
      dte.ttlPolicy.negativeCachingSeconds <= req.maxTtlSeconds,
    dnsCertificateSniBound: unresolvedSniCertificates.length === 0,
    identityOidcPinned:
      Boolean(sa.identity.federation.issuer) &&
      sa.identity.federation.issuer === ite.federation.issuer &&
      sa.identity.federation.audience === ite.federation.audience &&
      sa.identity.federation.subject === ite.federation.subject,
    identityNoLongLivedSecrets:
      sa.identity.federation.usesLongLivedSecret === false &&
      ite.federation.usesLongLivedSecret === false,
    identityLeastPrivilege:
      sa.identity.federation.privilege === "least" &&
      ite.federation.privilege === "least",
    identityEnvironmentSeparation:
      hasNonprodEnvironment &&
      hasProdEnvironment &&
      targetHasNonprodEnvironment &&
      targetHasProdEnvironment &&
      environmentsMatch &&
      allEnvironmentsIsolated &&
      federationEnvironmentBound,
    egressBoundedAllowlist:
      sa.egress.allowlist.length > 0 &&
      ete.allowlist.length > 0 &&
      sa.egress.consumers.includes("runner") &&
      sa.egress.consumers.includes("workload") &&
      ete.consumers.includes("runner") &&
      ete.consumers.includes("workload") &&
      broadEgressDestinations.length === 0,
    egressDefaultDenyEnforced:
      sa.egress.defaultDeny === true && ete.defaultDeny === true,
    egressNatProxyExplicit:
      Boolean(sa.egress.natOrProxyReference) && Boolean(ete.natOrProxyReference),
  };

  const sourceReference = sa.governance.evidenceReferences[0] ?? sa.assessmentId;
  const connectivityReference = cte.reference;
  const dnsReference = dte.reference;
  const identityReference = ite.reference;
  const egressReference = ete.reference;
  const ownerReference = sa.governance.owner.reference;
  const lineageReference = input.lineage.lineageId;
  const telemetryReference = sa.governance.telemetry.monitoringReference;
  const recoveryReference = sa.governance.recovery.rollbackReference;
  const firewallReference = sa.network.firewallPolicy.intentReference;
  const natReference = sa.egress.natOrProxyReference;

  const checks = [
    resultCheck(
      CONNECTIVITY_CHECK_IDS.architectureSupported,
      values.architectureSupported ? "pass" : "fail",
      sourceFreshness,
      values.architectureSupported
        ? "The source connectivity type and target Azure gateway kind are a supported, modelled architecture pairing."
        : "The source connectivity type and target Azure gateway kind are not a supported architecture pairing; manual architecture review is required.",
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.assessmentCurrent,
      values.assessmentCurrent ? "pass" : "unresolved",
      sourceFreshness,
      values.assessmentCurrent
        ? "The connectivity, DNS, identity, and egress source assessment is current and bounded by an explicit expiry."
        : "The source assessment is not current.",
      [sourceReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.evidenceComplete,
      values.evidenceComplete ? "pass" : "fail",
      sourceFreshness,
      values.evidenceComplete
        ? "Governance evidence, gateways, DNS zones, identity environments, and egress allowlist entries are all present."
        : "Governance evidence, gateways, DNS zones, identity environments, or egress allowlist entries are missing; the assessment is incomplete.",
      [sourceReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap,
      values.addressSpaceNoOverlap ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.addressSpaceNoOverlap
        ? "Source and target address space do not overlap, or an approved, exact translation with owner and reference resolves the overlap."
        : "Source and target address space overlaps and no approved, exact translation exists.",
      translation ? [translation.reference, connectivityReference] : [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.routeOwnershipExact,
      values.routeOwnershipExact ? "pass" : "fail",
      sourceFreshness,
      values.routeOwnershipExact
        ? "Every source prefix maps to exactly one uniquely owned route in the exact reviewed routing domain."
        : "Source prefixes are unowned, duplicated, outside the reviewed routing domain, or route ownership does not exactly match the address space.",
      routeOwners.map((owner) => owner.ownerReference),
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.symmetricRouting,
      values.symmetricRouting ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.symmetricRouting
        ? "Routing is symmetric on both the source and target sides."
        : "Routing is asymmetric on the source or target side.",
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.noDefaultRoute,
      values.noDefaultRoute ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.noDefaultRoute
        ? "Neither side advertises or accepts a broad default route."
        : "A default route is advertised or accepted on the source or target side.",
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.bgpAsnAcceptable,
      values.bgpAsnAcceptable ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.bgpAsnAcceptable
        ? "Every BGP ASN on the source and target side is within the acceptable ASN policy."
        : `The following BGP ASNs are not acceptable: ${unacceptableAsns.join(", ")}.`,
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.mtuCompatible,
      values.mtuCompatible ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.mtuCompatible
        ? "Every gateway MTU on the source and target side matches the required MTU exactly."
        : `The following MTUs do not match the required MTU: ${incompatibleMtus.join(", ")}.`,
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.gatewayRedundant,
      values.gatewayRedundant ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.gatewayRedundant
        ? "Every source gateway and the target gateway are redundant and highly available."
        : "A source gateway or the target gateway is not redundant.",
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.firewallPolicyExplicit,
      values.firewallPolicyExplicit ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.firewallPolicyExplicit
        ? "Firewall or NSG policy intent is explicit and denies by default on both the source and target side."
        : "Firewall or NSG policy intent is missing or does not deny by default on the source or target side.",
      [firewallReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.privateEndpointReady,
      values.privateEndpointReady ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.privateEndpointReady
        ? "Every source private or service endpoint dependency resolves to the same target access kind."
        : `The following private access dependencies are missing an exact target match: ${missingPrivateEndpointServices.join(", ")}.`,
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.targetBound,
      values.targetBound ? "pass" : "fail",
      connectivityFreshness,
      values.targetBound
        ? "The target connectivity evidence is bound to an allowed region and matching data residency."
        : "The target region or residency does not match the region policy and source assessment.",
      [connectivityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.sourceOfTruthExplicit,
      values.sourceOfTruthExplicit ? "pass" : "fail",
      sourceFreshness,
      values.sourceOfTruthExplicit
        ? "The source network remains authoritative until an approved cutover completes."
        : "The source of truth is ambiguous or prematurely assigned to the target network.",
      [ownerReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.integrityVerified,
      values.integrityVerified ? "pass" : "fail",
      sourceFreshness,
      values.integrityVerified
        ? "The recomputed source assessment digest matches the declared integrity claim; no tampering detected."
        : "The recomputed source assessment digest does not match the declared integrity claim; the assessment may have been tampered with.",
      [sourceReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.targetIntegrityVerified,
      values.targetIntegrityVerified ? "pass" : "fail",
      targetFreshness,
      values.targetIntegrityVerified
        ? "The recomputed complete target evidence digest matches the declared integrity claim; no connectivity, DNS, identity, egress, or policy mismatch was detected."
        : "The recomputed complete target evidence digest does not match the declared integrity claim; the target evidence may not be the one that was reviewed.",
      [connectivityReference, dnsReference, identityReference, egressReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.replayProtected,
      values.replayProtected ? "pass" : "fail",
      lineageFreshness,
      values.replayProtected
        ? "The attempt lineage is current, its ordinal is monotonic, and the assessment and nonce are not replayed."
        : "The attempt lineage is stale, non-monotonic, or replays an accepted assessment or nonce.",
      [lineageReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.ownerConfirmed,
      values.ownerConfirmed ? "pass" : "fail",
      sourceFreshness,
      values.ownerConfirmed
        ? "An accountable owner has explicitly confirmed this assessment."
        : "No accountable owner has confirmed this assessment.",
      [ownerReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.telemetryComplete,
      values.telemetryComplete ? "pass" : "fail",
      combined(sourceFreshness, connectivityFreshness),
      values.telemetryComplete
        ? "Source and target monitoring are referenced, logs are centralized, and alerting is configured."
        : "Source or target monitoring, centralized logging, or alerting is missing.",
      [telemetryReference, cte.telemetry.monitoringReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.recoveryComplete,
      values.recoveryComplete ? "pass" : "fail",
      sourceFreshness,
      values.recoveryComplete
        ? "Recovery point and time objectives are within policy and a rollback reference is recorded."
        : "Recovery point or time objectives exceed policy or a rollback reference is missing.",
      [recoveryReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.transitionBounded,
      values.transitionBounded ? "pass" : "fail",
      "not-applicable",
      values.transitionBounded
        ? "The coexistence window is explicitly bounded."
        : "The coexistence window is not bounded.",
      [input.transition.cutoverReference, input.transition.validationReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.rollbackComplete,
      values.rollbackComplete ? "pass" : "fail",
      "not-applicable",
      values.rollbackComplete
        ? "Rollback has an owner, bounded window, explicit conditions, source-network failback, and steps."
        : "Rollback is missing or incomplete.",
      rollbackPlan ? [rollbackPlan.ownerReference] : [],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.dnsAuthorityExplicit,
      values.dnsAuthorityExplicit ? "pass" : "fail",
      combined(sourceFreshness, dnsFreshness),
      values.dnsAuthorityExplicit
        ? "Every DNS zone declares an explicit authority and source-authoritative zones reference a source of truth."
        : "A DNS zone is missing an explicit authority or a source-authoritative zone lacks a source-of-truth reference.",
      [dnsReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.dnsLoopPrevented,
      values.dnsLoopPrevented ? "pass" : "fail",
      combined(sourceFreshness, dnsFreshness),
      values.dnsLoopPrevented
        ? "No DNS forwarding loop is detected on the source or target side."
        : "A DNS forwarding loop is detected on the source or target side.",
      [dnsReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.dnsResolverReachable,
      values.dnsResolverReachable ? "pass" : "fail",
      combined(sourceFreshness, dnsFreshness),
      values.dnsResolverReachable
        ? "Every DNS resolver is explicitly reachable from both the source and target."
        : `The following resolvers are not reachable from both sides: ${unreachableResolvers.join(", ")}.`,
      [dnsReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.dnsForwardingExplicit,
      values.dnsForwardingExplicit ? "pass" : "fail",
      combined(sourceFreshness, dnsFreshness),
      values.dnsForwardingExplicit
        ? "Conditional forwarding and split-horizon DNS are explicitly configured on both sides."
        : "Conditional forwarding or split-horizon DNS is not explicitly configured on the source or target side.",
      [dnsReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.dnsTtlPolicyMet,
      values.dnsTtlPolicyMet ? "pass" : "fail",
      combined(sourceFreshness, dnsFreshness),
      values.dnsTtlPolicyMet
        ? "DNS TTL and negative caching values on both sides are within the configured policy."
        : "A DNS TTL or negative caching value on the source or target side exceeds the configured policy.",
      [dnsReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.dnsCertificateSniBound,
      values.dnsCertificateSniBound ? "pass" : "fail",
      combined(sourceFreshness, dnsFreshness),
      values.dnsCertificateSniBound
        ? "Every SNI-dependent certificate has its DNS dependency resolved."
        : `The following SNI-dependent certificates have an unresolved DNS dependency: ${unresolvedSniCertificates.join(", ")}.`,
      [dnsReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.identityOidcPinned,
      values.identityOidcPinned ? "pass" : "fail",
      combined(sourceFreshness, identityFreshness),
      values.identityOidcPinned
        ? "The workload identity federation issuer, audience, and subject are pinned and identical between source and target."
        : "The workload identity federation issuer, audience, or subject is missing or does not match between source and target.",
      [identityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.identityNoLongLivedSecrets,
      values.identityNoLongLivedSecrets ? "pass" : "fail",
      combined(sourceFreshness, identityFreshness),
      values.identityNoLongLivedSecrets
        ? "Neither side relies on long-lived secrets or static credentials for workload identity."
        : "The source or target side relies on a long-lived secret or static credential for workload identity.",
      [identityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.identityLeastPrivilege,
      values.identityLeastPrivilege ? "pass" : "fail",
      combined(sourceFreshness, identityFreshness),
      values.identityLeastPrivilege
        ? "Workload identity privilege is least privilege on both sides."
        : "Workload identity privilege is broader than least privilege on the source or target side.",
      [identityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.identityEnvironmentSeparation,
      values.identityEnvironmentSeparation ? "pass" : "fail",
      combined(sourceFreshness, identityFreshness),
      values.identityEnvironmentSeparation
        ? "Nonproduction and production identity environments are isolated and the federation environment is bound, not shared."
        : "Identity environments are not separated, are not isolated, or the federation environment is shared or unbound.",
      [identityReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.egressBoundedAllowlist,
      values.egressBoundedAllowlist ? "pass" : "fail",
      combined(sourceFreshness, egressFreshness),
      values.egressBoundedAllowlist
        ? "Egress is bounded by an explicit, non-empty allowlist with no broad destination on either side."
        : `Egress allowlist is empty or includes a broad destination: ${broadEgressDestinations.join(", ")}.`,
      [egressReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.egressDefaultDenyEnforced,
      values.egressDefaultDenyEnforced ? "pass" : "fail",
      combined(sourceFreshness, egressFreshness),
      values.egressDefaultDenyEnforced
        ? "Default-deny egress is enforced on both the source and target side."
        : "Default-deny egress is not enforced on the source or target side.",
      [egressReference],
    ),
    resultCheck(
      CONNECTIVITY_CHECK_IDS.egressNatProxyExplicit,
      values.egressNatProxyExplicit ? "pass" : "fail",
      combined(sourceFreshness, egressFreshness),
      values.egressNatProxyExplicit
        ? "An explicit NAT or proxy reference is recorded on both the source and target side."
        : "An explicit NAT or proxy reference is missing on the source or target side.",
      [natReference, ete.natOrProxyReference].filter(Boolean),
    ),
  ];

  return {
    checks,
    details: {
      sourceFreshness,
      connectivityFreshness,
      dnsFreshness,
      identityFreshness,
      egressFreshness,
      lineageFreshness,
      targetFreshness,
      values,
      findings: {
        unacceptableAsns,
        incompatibleMtus,
        missingPrivateEndpointServices,
        unreachableResolvers,
        unresolvedSniCertificates,
        broadEgressDestinations,
      },
    },
  };
}

const REMEDIATIONS = Object.freeze({
  [CONNECTIVITY_CHECK_IDS.architectureSupported]:
    "Use a supported source-connectivity-type to Azure-gateway-kind pairing or obtain manual architecture review.",
  [CONNECTIVITY_CHECK_IDS.assessmentCurrent]:
    "Re-observe the source assessment so it is current within the configured maximum age.",
  [CONNECTIVITY_CHECK_IDS.evidenceComplete]:
    "Reconcile governance evidence, gateways, DNS zones, identity environments, and egress allowlist entries so none are missing.",
  [CONNECTIVITY_CHECK_IDS.addressSpaceNoOverlap]:
    "Eliminate the address-space overlap or record an approved, exact, owned translation with non-overlapping translated prefixes.",
  [CONNECTIVITY_CHECK_IDS.routeOwnershipExact]:
    "Assign exactly one unique, owned route to every source prefix, with no duplicates or gaps.",
  [CONNECTIVITY_CHECK_IDS.symmetricRouting]:
    "Configure symmetric routing on both the source and target side.",
  [CONNECTIVITY_CHECK_IDS.noDefaultRoute]:
    "Remove default-route advertisement or acceptance from the source and target side.",
  [CONNECTIVITY_CHECK_IDS.bgpAsnAcceptable]:
    "Renumber gateways so every BGP ASN is within the acceptable ASN policy.",
  [CONNECTIVITY_CHECK_IDS.mtuCompatible]:
    "Set every gateway MTU to the exact required MTU on both the source and target side.",
  [CONNECTIVITY_CHECK_IDS.gatewayRedundant]:
    "Provision redundant, highly available gateways on the source and target side.",
  [CONNECTIVITY_CHECK_IDS.firewallPolicyExplicit]:
    "Record an explicit firewall or NSG policy intent that denies by default on both the source and target side.",
  [CONNECTIVITY_CHECK_IDS.privateEndpointReady]:
    "Provision a matching target private endpoint for every source private or service endpoint dependency.",
  [CONNECTIVITY_CHECK_IDS.targetBound]:
    "Bind the target connectivity evidence to an allowed region and the assessed data residency.",
  [CONNECTIVITY_CHECK_IDS.sourceOfTruthExplicit]:
    "Keep the source network authoritative until an approved cutover completes.",
  [CONNECTIVITY_CHECK_IDS.integrityVerified]:
    "Re-observe the source assessment and reissue a matching integrity claim; investigate any tampering.",
  [CONNECTIVITY_CHECK_IDS.targetIntegrityVerified]:
    "Re-observe the connectivity target evidence and reissue a matching integrity claim; investigate any target mismatch.",
  [CONNECTIVITY_CHECK_IDS.replayProtected]:
    "Advance the attempt lineage with a fresh monotonic ordinal, a new nonce, and an unreplayed assessment.",
  [CONNECTIVITY_CHECK_IDS.ownerConfirmed]:
    "Obtain an accountable owner's explicit confirmation of this assessment.",
  [CONNECTIVITY_CHECK_IDS.telemetryComplete]:
    "Reference monitoring, centralize logs, and configure alerting before proceeding.",
  [CONNECTIVITY_CHECK_IDS.recoveryComplete]:
    "Bring recovery point and time objectives within policy and record a rollback reference.",
  [CONNECTIVITY_CHECK_IDS.transitionBounded]:
    "Set an explicit, positive coexistence window for the transition.",
  [CONNECTIVITY_CHECK_IDS.rollbackComplete]:
    "Provide a rollback owner, bounded window, conditions, source-network failback, and steps.",
  [CONNECTIVITY_CHECK_IDS.dnsAuthorityExplicit]:
    "Declare an explicit authority for every DNS zone and a source-of-truth reference for source-authoritative zones.",
  [CONNECTIVITY_CHECK_IDS.dnsLoopPrevented]:
    "Eliminate DNS forwarding loops on the source and target side before proceeding.",
  [CONNECTIVITY_CHECK_IDS.dnsResolverReachable]:
    "Confirm and record explicit resolver reachability from both the source and target.",
  [CONNECTIVITY_CHECK_IDS.dnsForwardingExplicit]:
    "Configure explicit conditional forwarding and split-horizon DNS on both sides.",
  [CONNECTIVITY_CHECK_IDS.dnsTtlPolicyMet]:
    "Lower DNS TTL and negative caching values on both sides to within policy.",
  [CONNECTIVITY_CHECK_IDS.dnsCertificateSniBound]:
    "Resolve the DNS dependency for every SNI-dependent certificate.",
  [CONNECTIVITY_CHECK_IDS.identityOidcPinned]:
    "Pin an identical workload identity federation issuer, audience, and subject on both source and target.",
  [CONNECTIVITY_CHECK_IDS.identityNoLongLivedSecrets]:
    "Replace long-lived secrets or static credentials with federated workload identity on both sides.",
  [CONNECTIVITY_CHECK_IDS.identityLeastPrivilege]:
    "Reduce workload identity privilege to least privilege on both sides.",
  [CONNECTIVITY_CHECK_IDS.identityEnvironmentSeparation]:
    "Isolate nonproduction and production identity environments and bind the federation environment explicitly, never shared.",
  [CONNECTIVITY_CHECK_IDS.egressBoundedAllowlist]:
    "Replace any broad egress destination with a bounded, explicit allowlist on both sides.",
  [CONNECTIVITY_CHECK_IDS.egressDefaultDenyEnforced]:
    "Enable default-deny egress on both the source and target side.",
  [CONNECTIVITY_CHECK_IDS.egressNatProxyExplicit]:
    "Record an explicit NAT or proxy reference on both the source and target side.",
});

function selectStrategy(input, checks) {
  const requested = input.transition.strategy;
  const failing = checks.filter((check) => check.classification !== "pass");
  const rationale = [];
  let selected = "blocked-manual-review";
  if (failing.length > 0) {
    rationale.push(...failing.map((check) => `${check.id} did not pass.`));
  } else {
    selected = "phased-connectivity-cutover";
    rationale.push(
      "All cataloged dual-cloud connectivity, DNS, identity, and egress checks passed; a guarded phased connectivity cutover transition is represented for human execution.",
    );
  }
  return {
    requested,
    selected,
    rationale,
    coexistenceWindowMinutes: input.transition.coexistenceWindowMinutes,
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
        ? "All cataloged dual-cloud connectivity, DNS, identity, and egress checks must pass."
        : `${state} requires fresh bound evidence, prior-stage proof, and explicit human confirmation.`,
    executionAllowed: false,
    strategy: strategy.selected,
  }));
}

function buildFindings(details) {
  const { findings, values } = details;
  const output = [];
  if (!values.architectureSupported) {
    output.push("The source connectivity type and target Azure gateway kind are an unsupported pairing.");
  }
  if (!values.addressSpaceNoOverlap) {
    output.push("Source and target address space overlaps without an approved, exact translation.");
  }
  if (findings.unacceptableAsns.length > 0) {
    output.push(`BGP ASNs outside the acceptable policy: ${findings.unacceptableAsns.join(", ")}.`);
  }
  if (findings.incompatibleMtus.length > 0) {
    output.push(`Gateway MTUs that do not match the required MTU: ${findings.incompatibleMtus.join(", ")}.`);
  }
  if (findings.missingPrivateEndpointServices.length > 0) {
    output.push(`Services missing a matching target private endpoint: ${findings.missingPrivateEndpointServices.join(", ")}.`);
  }
  if (!values.symmetricRouting) {
    output.push("Routing is asymmetric between the source and target.");
  }
  if (!values.noDefaultRoute) {
    output.push("A broad default route is advertised or accepted.");
  }
  if (!values.dnsLoopPrevented) {
    output.push("A DNS forwarding loop is detected.");
  }
  if (findings.unreachableResolvers.length > 0) {
    output.push(`DNS resolvers not reachable from both sides: ${findings.unreachableResolvers.join(", ")}.`);
  }
  if (findings.unresolvedSniCertificates.length > 0) {
    output.push(`SNI-dependent certificates with an unresolved DNS dependency: ${findings.unresolvedSniCertificates.join(", ")}.`);
  }
  if (!values.identityOidcPinned) {
    output.push("Workload identity federation issuer, audience, or subject is missing or mismatched.");
  }
  if (!values.identityNoLongLivedSecrets) {
    output.push("A long-lived secret or static credential is used for workload identity.");
  }
  if (!values.identityEnvironmentSeparation) {
    output.push("Identity environments are not separated, isolated, or the federation environment is shared.");
  }
  if (findings.broadEgressDestinations.length > 0) {
    output.push(`Egress allowlist entries with a broad destination: ${findings.broadEgressDestinations.join(", ")}.`);
  }
  if (!values.egressDefaultDenyEnforced) {
    output.push("Default-deny egress is not enforced on the source or target side.");
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
      "Reconfirm source assessment, connectivity, DNS, identity, and egress target evidence freshness.",
      "Recompute and compare every connectivity identity digest before any transition.",
      "Obtain human confirmation for gateway capacity, DNS delegation, workload identity federation, and egress allowlists.",
      "Complete a representative coexistence rehearsal before declaring cutover-ready.",
    ],
    unsupportedFindings: buildFindings(details),
    requiredRemediations,
    connectivityConfiguration: [
      "Provision the target Azure gateway with the reviewed kind, redundancy, BGP ASN, and MTU.",
      "Configure symmetric routing, unique route ownership, and no default-route advertisement or acceptance.",
      "Enable explicit deny-by-default firewall or NSG policy and provision matching private endpoints.",
    ],
    dnsConfiguration: [
      "Configure explicit DNS authority, conditional forwarding, and split-horizon resolution on both sides.",
      "Confirm and record explicit resolver reachability from both the source and target before cutover.",
      "Resolve DNS dependencies for every SNI-dependent certificate and align TTL and negative caching policy.",
    ],
    identityConfiguration: [
      "Configure workload identity federation with a pinned issuer, audience, and subject; never a long-lived secret.",
      "Isolate nonproduction and production identity environments and bind the federation environment explicitly.",
      "Grant only least-privilege access to the federated workload identity.",
    ],
    egressConfiguration: [
      "Enforce default-deny egress on both sides with an explicit, bounded allowlist.",
      "Record an explicit NAT or proxy reference; never assume a broad 0.0.0.0/0 destination.",
    ],
    validation: [
      "Compare source and target routing, DNS, identity, and egress evidence for parity.",
      "Confirm telemetry, recovery objectives, and owner confirmation remain within policy.",
      "Run connectivity, DNS resolution, and identity federation smoke tests before cutover.",
    ],
    cutover: [
      "Obtain cutover approval after rehearsal evidence and all checks pass.",
      `Shift traffic only through ${input.transition.trafficShiftReference}.`,
      `Apply cutover only through ${input.transition.cutoverReference}.`,
      `Bound blast radius using ${input.transition.blastRadiusReference}.`,
    ],
    rollback: rollbackPlan
      ? [
          `Keep the source network authoritative and available for ${rollbackPlan.rollbackWindowMinutes} minutes after cutover.`,
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
      "The source network is authoritative before cutover.",
      "The target network becomes authoritative only after coexistence validation and explicit cutover approval.",
      "Never rely on a broad default route, a shared identity environment, or an unbounded egress destination.",
      "During rollback, the source network becomes authoritative only under the reviewed failback rules.",
    ],
    cleanup: [
      "Retain source connectivity, DNS delegation, and rollback capability for the approved rollback window.",
      "After the rollback window, decommission coexistence connectivity and temporary access only through a separate approved change.",
      "Do not remove source routes, DNS zones, or identity federation until audit and owner confirmations are complete.",
    ],
    unresolvedDecisions:
      status === "blocked" ? failing.map((check) => check.id).sort() : [],
  };
}

function identityBindings(input, details, strategy) {
  const sa = input.sourceAssessment;
  const cte = input.target.connectivityTargetEvidence;
  const dte = input.target.dnsTargetEvidence;
  const ite = input.target.identityTargetEvidence;
  const ete = input.target.egressTargetEvidence;
  const sourceAssessmentDigest = digest(sa);
  const connectivityEvidenceDigest = digest(cte);
  const dnsEvidenceDigest = digest(dte);
  const identityEvidenceDigest = digest(ite);
  const egressEvidenceDigest = digest(ete);
  const regionPolicyDigest = digest(input.target.regionPolicy);
  const requirementsDigest = digest(input.requirements);
  const transitionDigest = digest(input.transition);
  const ownerDigest = digest(sa.governance.owner);
  const lineageDigest = digest(input.lineage);
  const integrationDigest = digest(input.integration);
  const identity = {
    sourceAssessmentDigest,
    sourceAssessmentObservedAt: sa.observedAt,
    sourceAssessmentExpiresAt: sa.expiresAt,
    sourceAssessmentFreshness: details.sourceFreshness,
    connectivityEvidenceDigest,
    dnsEvidenceDigest,
    identityEvidenceDigest,
    egressEvidenceDigest,
    regionPolicyDigest,
    requirementsDigest,
    transitionDigest,
    ownerDigest,
    lineageDigest,
    integrationDigest,
    targetRegion: cte.region,
    targetResidency: cte.residency,
    gatewayKind: cte.gatewayKind,
    strategy: strategy.selected,
  };
  const connectivityIdentityDigest = digest(identity);
  const binding = {
    connectivityIdentityDigest,
    sourceAssessmentDigest,
    connectivityEvidenceDigest,
    dnsEvidenceDigest,
    identityEvidenceDigest,
    egressEvidenceDigest,
    regionPolicyDigest,
    requirementsDigest,
    transitionDigest,
    ownerDigest,
    lineageDigest,
    integrationDigest,
    strategy: strategy.selected,
    executionEligible: false,
  };
  return {
    ...identity,
    connectivityIdentityDigest,
    readiness: binding,
    iac: binding,
    manifest: binding,
    approval: binding,
  };
}

function planConnectivity(input) {
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
  const cte = input.target.connectivityTargetEvidence;
  const dte = input.target.dnsTargetEvidence;
  const ite = input.target.identityTargetEvidence;
  const ete = input.target.egressTargetEvidence;
  const output = {
    schemaVersion: SCHEMA_VERSION,
    plannerVersion: PLANNER_VERSION,
    planId: input.planId,
    status,
    sourceAssessment: structuredClone(sa),
    sourceAssessmentDigest: digest(sa),
    target: {
      region: cte.region,
      residency: cte.residency,
      gatewayKind: cte.gatewayKind,
      connectivityEvidenceDigest: digest(cte),
      connectivityEvidenceFreshness: evaluation.details.connectivityFreshness,
      dnsEvidenceDigest: digest(dte),
      dnsEvidenceFreshness: evaluation.details.dnsFreshness,
      identityEvidenceDigest: digest(ite),
      identityEvidenceFreshness: evaluation.details.identityFreshness,
      egressEvidenceDigest: digest(ete),
      egressEvidenceFreshness: evaluation.details.egressFreshness,
    },
    requiredChecks: [...CONNECTIVITY_CHECK_ORDER],
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
      "Current source cloud connectivity, routing, and gateway evidence",
      "Current target Azure gateway kind, redundancy, BGP ASN, MTU, and firewall posture",
      "DNS authority, forwarding, resolver reachability, and certificate SNI dependencies for both sides",
      "Workload identity federation issuer, audience, subject, environment separation, and least privilege",
      "Egress allowlist, default-deny enforcement, and NAT or proxy posture for both sides",
      "Coexistence window, cutover authorization, traffic shift, blast radius, and rollback authority",
    ],
    safety: {
      executionEnabled: false,
      executionEligible: false,
      connectivityActions: "none",
      dnsActions: "none",
      identityActions: "none",
      egressActions: "none",
      firewallActions: "none",
      routeActions: "none",
      credentialActions: "none",
      iacActions: "none",
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
      "Usage: startup-connectivity-plan.mjs plan --input <path> [--output json]",
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
    const plan = planConnectivity(input);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = plan.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

export {
  CONNECTIVITY_CHECK_IDS,
  CONNECTIVITY_CHECK_ORDER,
  STAGE_ORDER,
  canonicalJson,
  digest as connectivityPlanDigest,
  planConnectivity,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
