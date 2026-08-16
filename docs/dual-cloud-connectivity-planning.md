---
layout: page
title: "Dual-Cloud Connectivity, DNS, Identity, and Egress Planning"
nav_order: 8.8
description: "Read-only private connectivity, DNS, workload identity, and egress source assessment and migration planning for AWS, GCP, and generic/on-prem to Azure"
---

# Dual-Cloud Connectivity, DNS, Identity, and Egress Planning

[PR #26](https://github.com/ricmmartins/sslz/pull/26) delivered this planner. It is execution-disabled and validated with
synthetic fixtures and hosted CI; the repository has no current-main live tunnel, routing, DNS, federation, egress,
coexistence, cutover, or failback evidence. See the
[implementation and evidence matrix](implementation-status.md).

This increment assesses supplied private connectivity, DNS, workload identity, and egress metadata and generates a
deterministic plan for connecting an AWS, GCP, or generic/on-prem source network to Azure over AWS Direct Connect, AWS
Site-to-Site VPN, GCP Cloud Interconnect, GCP Cloud VPN, or a generic/on-prem ExpressRoute or IPsec VPN circuit,
terminating on Azure ExpressRoute or a VPN Gateway. It has no source or target network connection, route, firewall, NSG,
or NVA change, DNS zone or resolver change, workload identity or federation change, egress or NAT/proxy change, tunnel
creation, credential generation, or any other write path. It never stores credentials, tokens, secret-bearing URLs,
customer identifiers, or live topology.

## Validate and plan

```bash
node scripts/startup-connectivity-plan.mjs plan --input agent/examples/connectivity-plan-input.json --output json
```

The command writes JSON to standard output only. Exit status is `0` for a complete plan, `1` for a blocked plan, and `2`
for invalid or secret-bearing input. The checked-in example is synthetic and contains only non-secret metadata and opaque
references.

## Contracts and evidence

| Contract | Purpose |
|---|---|
| `connectivity-source-assessment.schema.json` | Versioned non-secret source metadata for the source cloud (provider, connectivity type, region), network (CIDRs, address translation, gateways, routing, firewall policy, private access), DNS (zones, resolvers, forwarding, TTL/negative caching), identity (federation, environment separation), egress (destinations, NAT/proxy reference), and governance and source-of-truth ownership |
| `connectivity-plan-input.schema.json` | Source assessment, the Azure connectivity/DNS/identity/egress target evidence, requirement policy, transition decisions, replay lineage, and optional program integration bindings |
| `connectivity-plan.schema.json` | Compatibility results, transition strategy, stage gates, detailed transition plan, immutable identity bindings, human confirmations, and the execution-disabled safety boundary |

The source assessment accepts opaque owner and gateway references, never secret material or credential-bearing endpoints.
Password/token/connection-string/private-key/client-secret/access-key keys and private-key, credential-bearing URI, AWS
access-key, and JWT-shaped values fail validation before any evaluation.

This planner models IPv4 unicast connectivity only. IPv6 (`::/0`) source, target, and route representations are out of
scope for this increment and are not asserted, translated, or validated.

## Enforcement

The evaluator checks, and blocks on failure of, every one of these controls:

- **Supported architecture and current, complete evidence** — the source provider and connectivity type pair to a
  supported Azure gateway kind (AWS Direct Connect/Site-to-Site VPN, GCP Cloud Interconnect/Cloud VPN, or generic/on-prem
  ExpressRoute/IPsec VPN); the source assessment and target evidence are current; and every required evidence reference
  is present.
- **Address space, routing, and gateway resilience** — no overlapping source and target address space unless an
  approved, owned, and referenced translation with exact non-overlapping translated prefixes exists; every route has a
  unique, exact owner; routing is symmetric; no broad default route (`0.0.0.0/0` or a supernet default) is advertised or
  accepted under the configured minimum route prefix length; BGP ASNs are within the acceptable set; MTU is compatible
  end to end; and the gateway is redundant/highly available.
- **Firewall/NSG/NVA intent and private access** — firewall or NSG or NVA policy intent is explicit (not implicit
  allow-all), and private endpoint or service endpoint evidence is present where the target requires it.
- **Target binding and source-of-truth authority** — the target evidence is bound to the assessed source region and
  scope, and the source network remains the explicit, singular authority until an approved cutover completes.
- **DNS authority, loop prevention, and resolver reachability** — DNS zone authority and source of truth are explicit; no
  forwarding or conditional-forwarding loop exists between source and target resolvers; every referenced resolver is
  explicitly reachable; conditional forwarding is explicit where required; TTL and negative-caching policy meet the
  configured bound; and certificate/SNI dependencies are bound to the correct zone.
- **Workload identity federation and least privilege** — OIDC issuer, audience, and subject are pinned and match the
  target's expectations; no long-lived secret or static credential is present; access is least-privilege scoped; and
  nonproduction and production environments are not mixed in a single identity or trust boundary.
- **Bounded egress** — runner/workload egress destinations are an explicit, bounded allowlist (never a broad `0.0.0.0/0`
  or `::/0` assumption, or a prefix broader than the configured minimum); a default-deny egress posture is enforced; and
  an explicit NAT or proxy reference is recorded on both the source and target side where required.
- **Telemetry, ownership, recovery, and bounded transition** — telemetry coverage, an explicit accountable owner, a
  recovery plan meeting the RPO/RTO policy, and a bounded transition window with a complete rollback/failback plan are
  all present.
- **Freshness, tamper/replay protection, and integrity lineage** — the source assessment and target evidence digests
  match their integrity claims (detecting tamper or a mismatched target); replay lineage rejects a reused assessment ID
  or nonce and rejects a non-monotonic (out-of-order or duplicated) attempt ordinal.
- **Fail-closed manual review** — an unsupported provider/connectivity-type pairing, missing evidence, or any unsatisfied
  control blocks the plan and selects `blocked-manual-review`.

## Strategy and stages

The planner selects exactly one strategy: `phased-connectivity-cutover` when every cataloged check passes, or
`blocked-manual-review` otherwise. Every result contains gates for `assess`, `provision-connectivity`, `configure-dns`,
`configure-identity`, `configure-egress`, `validate-coexistence`, `cutover`, `verify`, `rollback-required`, and
`completed`. All gates set `executionAllowed` to `false`; downstream stages remain pending human confirmation even when
the plan is complete.

The detailed transition plan records prerequisites, unsupported findings, required remediations, DNS source-of-truth
rules, coexistence validation, cutover, rollback, and unresolved decisions. These are reviewed instructions, not
executable commands. The planner emits no shell, cloud, network, DNS, or IaC commands, and creates no tunnels.

## Identity and integration

The connectivity identity binds the source assessment digest and freshness, target evidence digest, requirements,
transition decisions, replay lineage, and optional program integration digests (existing workload profile, regional
plan, IaC plan, readiness evidence, deployment manifest, deployment approval, PostgreSQL migration identity, and
container image/CI migration identity). The result emits the same binding for readiness, IaC, manifest, and approval
identities with `executionEligible: false`. Any assessment mutation, stale or replayed evidence, changed target, or
decision change produces a different plan and identity or a blocking check. A later execution increment must copy and
verify these bindings; this increment deliberately provides no executor or approval transition.

This additive planning contract does not affect Bicep or Terraform parameters, resources, previews, or apply surfaces, so
no IaC parity change is required.

## Human and live confirmation

Before any future connectivity, DNS, identity, or egress transition can proceed, humans must confirm the current source
network topology and CIDR/route accuracy, gateway capacity and redundancy, firewall/NSG/NVA rules, DNS zone delegation
and resolver reachability, workload identity federation configuration, egress allowlist completeness, telemetry coverage,
and the cutover authorization, coexistence validation, and rollback/failback authority. Supplied synthetic or local
metadata cannot prove those live conditions.
