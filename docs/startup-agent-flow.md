---
layout: page
title: "Startup Agent Flow"
nav_order: 8
description: "Implemented and planned agent-assisted Azure account and SSLZ setup"
---

# Startup Agent Flow

## Status

Phases 0-6 have delivered contract, planning, or narrowly approval-gated implementation. Phase 7 has delivered
execution-disabled cool-foundation and Container Apps planning artifacts, but no secondary-region executor. The
PostgreSQL migration, image/CI, dual-cloud connectivity, and program-lineage surfaces are also delivered as planning and
validation contracts without execution authority. See the
[authoritative implementation and evidence matrix](implementation-status.md).

The canonical current-`main` validation command is:

```bash
node scripts/validate-greenfield-journey.mjs
```

It runs the integrated synthetic founder journey through repository contracts with deterministic mocks, including
fail-closed negative journeys, a separately signed synthetic observed AKS acceptance, and an execution-disabled
cross-program lineage envelope. It performs no Azure writes or live-tenant reads. It requires Node.js and the local
Bicep CLI installed by `az bicep install`, but no npm install or project dependency restore. Tagged releases expose only
the capabilities documented in their tag; direct Bicep/Terraform usage remains the baseline deployment workflow rather
than an implicit agent run.

## Acceptance-gap context

The one-subscription and billing-benefit scenario was observed while the existing SSLZ baseline was exercised through a
generic agent interaction. That interaction did not intentionally invoke the startup preflight, workload, regional,
readiness, IaC, or signed-approval commands. It is therefore an acceptance-gap hardening input for the agent-aware flow,
not evidence that those commands regressed.

Before this hardening, the agent-aware flow already provided deterministic checks, catalog-driven blockers, current
readiness evidence, canonical plan digests, immutable deployment manifests, signed single-use approvals, replay
resistance, and live tenant/subscription validation. The genuine gaps were narrower: Phase 1 required a separate
prod/nonprod pair, did not publish a versioned subscription/billing topology decision, and could not bind an external
benefit-association confirmation to that exact decision. The topology contract and bindings below close only those gaps;
they do not replace or duplicate the existing workload, regional, IaC, or deployment controls.

## Goal

Help an early-stage startup move from redeemed Azure credits to a reviewed SSLZ deployment plan without requiring
the founder to understand Azure account, identity, quota, or regional capacity details first.

The agent guides the founder through:

```text
Account discovery
  -> account checks
  -> workload discovery
  -> region and capacity checks
  -> deployment plan
  -> founder approval
  -> SSLZ deployment
  -> post-deployment validation
```

SSLZ remains the declarative deployment engine. The agent collects context, runs checks, explains blockers, and
selects an appropriate SSLZ configuration. It must not hide or replace Bicep and Terraform plans.

## Design principles

1. **Start small.** Target pre-seed to Series A startups with one primary workload, 5-15 engineers, and no dedicated
   platform team.
2. **Use startup defaults.** Prefer low-cost managed services and the simplest architecture that satisfies the
   workload.
3. **Plan before changing Azure.** Show the subscriptions, regions, services, estimated platform costs, and intended
   changes before deployment.
4. **Require approval.** Never deploy infrastructure, assign privileged roles, or enable paid Defender plans without
   explicit approval.
5. **Fail with a next action.** Distinguish configuration, permission, quota, capacity, billing, entitlement, and
   service errors. Provide the official guidance or support route for each blocker.
6. **Keep existing SSLZ behavior stable.** Agent support must be additive and backward compatible.
7. **Know when to graduate.** Recommend full Azure Landing Zones when the workload exceeds the boundaries in the
   [Graduation Guide](graduation-guide.md).

## Official sources

| Area | Source |
|---|---|
| Startup account setup | [Properly Setting Up Your Azure Account][startup-account] |
| Landing-zone design | [Cloud Adoption Framework: Azure landing zones][azure-landing-zones] |
| Workload quality | [Azure Well-Architected Framework](https://learn.microsoft.com/azure/well-architected/) |
| Regional design | [Azure reliability guidance](https://learn.microsoft.com/azure/reliability/) |
| Available and paired regions | [List of Azure regions](https://learn.microsoft.com/azure/reliability/regions-list) |
| Infrastructure as code | [Bicep best practices][bicep-practices] and [Terraform style conventions][terraform-style] |

The implementation should link each check to a stable official source. Blog posts can provide additional explanation
but must not be the normative source for account, security, reliability, or service behavior.

## Phase 1: Account discovery and readiness

The account flow follows the Microsoft for Startups setup guidance. The agent checks what Azure exposes, but the
founder remains responsible for identity proof, credit redemption, and support requests.

| Check | Agent action | Automatic change? | Block deployment? |
|---|---|---:|---:|
| Azure authentication | Identify signed-in account, tenant, and active subscription | No | Yes |
| Startup subscription topology | Inventory enabled subscriptions and evaluate an explicit one-subscription or prod/nonprod mapping | No | Yes |
| Credit context | Report visible billing profile and credit context when permissions allow | No | Yes if unresolved |
| Company tenant | Confirm tenant identity and collect the intended company domain | No | Yes |
| Secondary admin | Confirm a second administrator exists | No | Yes |
| Custom domain | Confirm the company domain is verified and primary | No | Yes |
| Subscription selection | Confirm the exact subscription ID for each environment; both may be the same only in validated one-subscription mode | No | Yes |
| Tenant consistency | Confirm both subscriptions belong to the intended tenant | No | Yes |
| Effective permissions | Check the roles required by the selected SSLZ modules | No | Yes |
| Resource providers | Report missing registrations and propose registration commands | With approval | Yes |
| Policy access | Confirm the identity can read and deploy required assignments | No | Yes when policies are selected |

### Human-only and support actions

The read-only topology decision distinguishes a validated one-subscription startup, an exact prod/nonprod pair, missing
targets, tenant mismatch, unavailable billing evidence, unknown benefit association, benefits observed elsewhere, and an
ambiguous multi-subscription inventory. A single visible subscription can be safely mapped to both environments only when
the user selects it explicitly. If multiple subscriptions are visible, the user must select an explicit prod/nonprod
mapping.

Billing visibility does not prove that startup credits apply. A current Microsoft support confirmation must bind the
exact topology decision ID and digest through readiness evidence. Azure Billing Support handles billing account/profile
visibility. Microsoft for Startups Program Support handles credit activation, entitlement, and benefit-association
questions. Only an opaque support reference is retained.

The agent must not attempt to:

- redeem startup credits;
- create a subscription;
- transfer an entitlement to another account;
- move credits or benefits between subscriptions;
- associate subscriptions with another billing profile;
- change billing associations;
- create or verify a company DNS domain without approval;
- create a Global Administrator or subscription Owner assignment without approval;
- infer that credits apply to a subscription when billing evidence is unavailable.

The agent also cannot prove benefit applicability from partial metadata, complete a support case, or make an ambiguous
multi-subscription choice on the user's behalf. Those conditions remain blocked.

Preflight derives provider checks from repeatable `--profile` selections. The default remains `container-apps` for
backward compatibility; an AKS plan explicitly supplies `--profile aks`, which adds
`Microsoft.ContainerService` to the inspected namespaces without blocking non-AKS journeys.

## Phase 2: Workload discovery

Ask only questions that change the architecture:

1. Is this the startup's first production workload?
2. Is the application HTTP/event driven, or does it require Kubernetes APIs and cluster control?
3. Does it require PostgreSQL, another managed database, or no database?
4. Does it use Microsoft Foundry models?
5. Does it require customer-managed GPU compute?
6. What data-residency boundaries apply?
7. What outage duration and data loss can the business tolerate?
8. What monthly platform budget should the plan stay within?

### Initial profiles

| Profile | Default | Use when |
|---|---|---|
| Container Apps | Preferred | HTTP and event-driven apps without Kubernetes operations |
| AKS | Exception | Kubernetes APIs, custom scheduling, specialized networking, or GPU nodes |
| Foundry managed models | Preferred for inference | A managed model meets the workload and has quota and capacity |
| Customer-managed GPU | Exception | Custom model serving or training requires direct GPU control |
| PostgreSQL | Preferred relational database | Relational data with PostgreSQL compatibility |

The agent must explain why it selected a profile and what requirement would justify a different one.

See [Startup Workload Profiles](workload-profiles.md) for the complete selection rules.

## Phase 3: Region and capacity planning

Region selection is workload-specific. A region pair alone does not guarantee that every required service, model,
SKU, or availability-zone feature exists in both regions.

The implemented `scripts/startup-regional-plan.sh` command evaluates supplied, timestamped evidence without calling
Azure. It reports quota and point-in-time capacity separately and never treats observed capacity as reserved.

For each candidate region, check:

- subscription access to the region;
- allowed-location policies;
- required service availability;
- Foundry model and deployment-type availability;
- compute and GPU SKU eligibility;
- quota headroom;
- availability-zone support where the workload requires it;
- data-residency constraints;
- estimated cost differences.

### Hot/Cool startup topology

The Hot/Cool option is an opt-in conceptual target, not the default for every startup. The table describes intended
topology, not current deployment evidence or execution support.

| Layer | Primary region (Hot) | Secondary region (Cool) |
|---|---|---|
| SSLZ baseline | Deployable through the approved Phase 6 primary path | Planning representation only |
| Networking | Deployed | Deployed with non-overlapping address space |
| Observability | Active | Ready to receive regional telemetry |
| Application compute | Active and scaled normally | Minimum viable scale or deployment-ready, based on RTO |
| Data | Primary | Service-supported geo-replica, geo-backup, or restore plan based on RPO |
| Foundry models | Active deployment | Validated capacity or a documented alternative model/region |
| Ingress | Active endpoint | Registered backend with health checks when automated failover is required |

The plan must state that deploying a landing-zone baseline in two regions does not provide workload failover by
itself. Data replication, model availability, secrets, DNS or global ingress, and recovery procedures require
service-specific design.

### When not to use Hot/Cool

Stay single-region when:

- the startup can restore within its required recovery window;
- the service does not support a useful secondary-region design;
- the additional operational work exceeds the business impact of an outage;
- the startup has not defined an owner for failover tests.

Use a secondary region as a capacity fallback only after validating that every required service and model is
available there.

See [Hot/Cool Regional Topology](hot-cool-regional-topology.md) for entry criteria, service-specific recovery, cost
controls, and testing requirements.

The regional planner marks only current `single-region-ready` output as executable readiness. A `cool-infrastructure`
or `warm-workload` recommendation remains review-only and performs no Azure operation. Separate Phase 7 planners can
generate execution-disabled provider representations, but Phase 6 will not preview or apply them.

## Phase 4: Plan and approval

Before deployment, present:

- detected tenant and account context;
- exact target subscription for each environment;
- topology decision ID, digest, freshness, and benefit-association status;
- selected workload profile and rationale;
- primary and secondary regions;
- services, SKUs, and paid security plans;
- quota and capacity findings;
- estimated recurring platform cost;
- Bicep what-if or Terraform plan;
- manual and support actions still required;
- rollback and teardown approach.

When Defender for Servers is selected, Phase 4 also presents a deterministic Log Analytics workspace decision. It blocks
unless the exact effective region is allowed by current policy, matches the selected primary region for new placement,
is supported by the service and data-residency plan, or is backed by current scope-bound central/shared workspace
evidence. Azure default workspace placement is never treated as evidence.

Approval applies to a specific plan. Any change to the topology decision, subscription mapping, tenant, region, paid plan,
privileged role, or resource scope invalidates the approval and requires a new plan.

## Phase 5: Approved provider remediation

The implemented first write-capable command is limited to one resource-provider registration already present in the
reviewed plan. The provider namespace must be required by the selected workload profile. Apply requires a separate,
unexpired, single-use approval artifact bound to the plan digest and every action field, rechecks the exact tenant and
subscription, runs one argument-array Azure CLI command, and verifies `Registered`. It performs no deployment,
feature registration, policy, role, billing, entitlement, subscription, or domain change.

See [Approved Provider Remediation](provider-remediation.md).

## Phase 6: Deployment and validation

Phase 6 is implemented by `scripts/startup-deployment-integration.sh`. It consumes an approved Phase 4 artifact, emits
an immutable provider-specific manifest through zero-write preview, and requires a trusted Ed25519-signed approval for
apply. It supports only the primary `single-region-ready` platform baseline.

The agent uses the existing SSLZ Bicep or Terraform path. It must:

1. preserve idempotency;
2. use workload identity federation for CI/CD;
3. avoid secrets in source, parameters, logs, and agent output;
4. deploy in incremental mode for Bicep;
5. retain Terraform state in an approved remote backend for team use;
6. record the plan, approval, deployment IDs, and validation result;
7. validate the deployed state instead of treating a successful command as success.

Post-deployment platform validation includes:

- expected resource groups and regional resources;
- policy assignments and compliance state;
- Log Analytics and Activity Log forwarding;
- selected Defender plans, their cost, and the exact approved workspace association;
- budgets and alert recipients;
- explicit `workloadDeploymentAllowed: false` until every baseline check passes.

Application health, database connectivity, secondary-region deployment, and Hot/Cool recovery are workload or Phase 7
work and are not performed by Phase 6.

See [Approved Deployment Integration](approved-deployment-integration.md).

## Cross-program planning lineage

The canonical journey references a separate v1 program-lineage envelope rather than copying migration identities into
the signed Phase 5/6 deployment approval. This keeps the existing approval scope unchanged while binding one exact
sequence of real planner outputs:

1. PostgreSQL migration assessment and planning;
2. PostgreSQL rehearsal planning;
3. PostgreSQL execution-contract planning;
4. container image and CI/CD migration planning;
5. dual-cloud connectivity, DNS, identity, and egress planning.

Each stage binds the exact artifact digest and predecessor stage digest. The final program identity and envelope digests
therefore change when any upstream artifact, target, environment, lineage, order, or cross-program binding changes.
Duplicate, omitted, out-of-order, stale, replayed, mismatched, or substituted artifacts fail closed. The fixtures invoke
the repository planner modules with sanitized synthetic evidence; they do not assert against planner source text.

The envelope does not authorize execution. Every stage sets `executionEnabled`, `executionEligible`, and
`executionAllowed` to false and names a distinct future approval. The existing baseline approval remains limited to
`greenfield-platform-deployment-only` and does not authorize migration, database writes, image promotion, connectivity,
DNS, identity, egress, cutover, rollback, or failback. Its report separately identifies baseline greenfield deployment
readiness and non-executable migration/dual-cloud planning readiness, including whether evidence is synthetic or live.

The canonical greenfield journey report is v2 and requires this envelope identity and readiness separation. A v1 report
is intentionally rejected rather than accepted with incomplete lineage. See
[Program Lineage Envelope](program-lineage-envelope.md).

## Agent result contracts

The versioned machine-readable result schemas are implemented. `startup-preflight` produces the `inspect` result;
scope-limited commands produce the separate provider-remediation, deployment, readiness, regional-attempt,
greenfield-report, and program-lineage contracts linked from [`agent/README.md`](../agent/README.md). The complete
shared preflight semantics, including reserved modes without a generic producer, are in the
[Preflight Result Contract](preflight-result-contract.md). Use the checked-in
[`ready-container-apps.json`](../agent/examples/ready-container-apps.json) and
[`blocked-billing.json`](../agent/examples/blocked-billing.json) specimens rather than copying an abbreviated contract.

Do not include access tokens, secrets, full billing records, personal email addresses, or other unnecessary personal
data in this output.

## Delivered baseline criteria

The delivered contract and agent-gated planner baseline can:

1. inspect and plan without changing Azure;
2. identify the active account, tenant, and explicit target subscriptions;
3. detect tenant mismatch and missing required roles;
4. report missing providers without registering them automatically;
5. classify billing and entitlement uncertainty as a support action;
6. ask the workload questions and select Container Apps or AKS with a reason;
7. evaluate a primary and optional secondary region without claiming capacity is guaranteed;
8. produce a reviewable deployment plan;
9. require explicit, artifact-bound approval before an agent-gated write operation.

Direct operator Bicep and Terraform commands remain a separate, non-agent path. The `deploy-bicep.yml` and
`deploy-terraform.yml` workflows require Phase 6 artifacts and invoke the approval-gated deployment integration. The
separate `integration-test.yml` write path is a manually dispatched disposable-nonproduction test path protected by
`integration-nonprod`; it is outside the agent approval flow and is not a landing-zone delivery path.

## Out of scope or still separately gated

- automatic credit redemption or entitlement transfer;
- unattended privileged role assignments;
- automatic DNS-domain verification;
- guaranteed capacity reservation;
- automatic production failover;
- migration of running workloads between regions;
- replacement of the existing SSLZ Bicep or Terraform deployment paths;
- full Azure Landing Zone architecture.

See the [Startup Agent Implementation Plan](startup-agent-implementation-plan.md) for the phased pull request,
testing, approval, and rollback sequence.

[azure-landing-zones]: https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/
[bicep-practices]: https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices
[startup-account]: https://learn.microsoft.com/startups/build/azure-getting-started/set-up-account
[terraform-style]: https://developer.hashicorp.com/terraform/language/syntax/style
