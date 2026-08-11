---
layout: page
title: "Hot/Cool Regional Topology"
nav_order: 8.3
description: "Startup-scale regional capacity and recovery planning"
---

# Hot/Cool Regional Topology

## Status

The regional and capacity evaluator is implemented as a read-only planning command. SSLZ remains single-region until
deployable modules, explicit approval, validation, and recovery tests are implemented.

## Purpose

Hot/Cool prepares a startup to redeploy or activate a workload in another region when the primary region cannot
supply capacity or experiences an outage. It keeps the secondary footprint smaller than the primary footprint.

It is not automatically:

- active/passive disaster recovery;
- zero-data-loss failover;
- a capacity reservation;
- a guarantee that a model or SKU remains available;
- a replacement for service-specific recovery design.

## Entry criteria

Offer Hot/Cool when at least one condition applies:

- the workload has a documented RTO or RPO that single-region restore cannot meet;
- a required SKU or model has meaningful regional-capacity risk;
- customers or contracts require regional recovery;
- a region outage would threaten the startup's survival;
- the workload already has an owner and a scheduled recovery test.

Stay single-region when the startup can restore within its recovery target, has no recovery owner, or cannot justify
the added data and operational cost.

## Required founder inputs

| Input | Example |
|---|---|
| Data-residency boundary | United States geography |
| Recovery time objective | Four hours |
| Recovery point objective | One hour |
| Failover decision owner | CTO |
| Maximum cool-region monthly cost | USD 300 |
| Capacity fallback only or disaster recovery | Both |
| Manual or automatic traffic failover | Manual |

The agent must not invent recovery targets.

## Region selection

Choose the primary region for workload fit, not proximity alone. Rank candidate regions using:

1. data-residency compliance;
2. required services and features;
3. Foundry model and deployment-type availability;
4. compute and GPU SKU eligibility;
5. quota headroom;
6. availability-zone support;
7. latency to users and dependencies;
8. estimated cost.

Select a secondary region only after applying the same checks. Prefer a region in the required geography with
independent capacity characteristics. Azure regional pairing is useful context for some platform recovery behavior,
but it does not replace per-service availability and recovery validation.

## Startup-scale deployment modes

| Mode | Secondary baseline | Application compute | Data | Traffic |
|---|---|---|---|---|
| `single-region-ready` | Validated regional plan | Not deployed | Backup or service default | Primary only |
| `cool-infrastructure` | Nonprod foundation plan | Profile representation optional, never executed | Not configured | Not configured |
| `warm-workload` | Baseline deployed | Minimum healthy scale | Online replica | Manual or automatic |

`single-region-ready` is the only currently executable production option. Phase 7 uses `cool-infrastructure` only to
prepare a guarded, nonproduction secondary networking and observability foundation; execution remains disabled.
The additive `cool-container-apps` profile can now represent an internal minimum footprint for validation, but it has no
executor and does not change this mode's production or traffic boundary.
`warm-workload` requires later service-specific modules and recovery tests.

## Baseline in each region

| Concern | Primary region | Secondary region |
|---|---|---|
| Resource organization | Existing subscription and resource groups | Same strategy, distinct regional groups |
| Network | Current SSLZ VNet | Non-overlapping VNet |
| Policy | Existing subscription assignments | Same subscription assignments, regional parameters updated |
| Monitoring | Active workspace and alerts | Central destination remains reachable; regional diagnostics configured |
| Defender | Selected plans enabled | Subscription plans already apply; regional resources inherit coverage |
| Compute | Normal production scale | Profile-specific cool scale |
| Secrets | Key Vault and managed identities | No copied secrets in source; use approved recovery pattern |
| Ingress | Primary endpoint | Secondary origin prepared when global failover is selected |

The first version does not add a hub network or connectivity subscription.

## Service-specific recovery

### Container Apps

- Create a separate environment in each region.
- Enable zone redundancy at environment creation when required and supported.
- Keep application revisions and configuration reproducible through IaC.
- Use at least the minimum replica count needed by the selected availability target.
- Configure health probes before relying on traffic failover.
- Use Azure Front Door when automatic global HTTP failover is required.

### AKS

- Use a separate cluster in each region.
- Plan non-overlapping pod, service, and VNet address space.
- Validate node SKUs and quota independently in both regions.
- Keep cluster and workload configuration reproducible.
- Back up Kubernetes state and persistent data with an explicit restore procedure.
- Use Azure Front Door or Traffic Manager according to protocol and routing requirements.

AKS in two regions doubles cluster operations. If the startup cannot own upgrades and recovery tests in both
clusters, Hot/Cool AKS is not ready.

### PostgreSQL

- Use zone-redundant high availability for zone failures when required and supported.
- Select cross-region read replicas or geo-restore based on RTO, RPO, cost, and service support.
- Document connection-endpoint changes during failover.
- Test promotion or restore before claiming regional readiness.
- Account for replication lag and possible data loss in the stated RPO.

### Foundry

- Validate the selected model, version, deployment type, quota, and capacity in each region.
- Deploy equivalent model endpoints when the recovery target requires them.
- Treat Foundry projects and attached customer-managed services as separate recovery concerns.
- Configure recovery for Search, Storage, Cosmos DB, Key Vault, and other attached services individually.
- Keep application routing and fallback behavior explicit.

Foundry does not provide automatic failover for the complete workload. The application owns endpoint selection and
recovery behavior.

## Capacity fallback

Capacity checks report a point-in-time observation, not a reservation. The plan should include:

- preferred region, SKU, and model;
- acceptable secondary region;
- acceptable alternate SKU or deployment type;
- minimum quota required;
- startup action when allocation still fails;
- an optional capacity-reservation recommendation when the business can justify it.

Do not continuously retry a capacity failure without bounded backoff. Classify the result and offer the approved
alternative.

## Failover plan

Every Hot/Cool plan must define:

1. detection signal;
2. person authorized to declare failover;
3. data recovery or promotion step;
4. compute activation or scaling step;
5. model-endpoint validation;
6. traffic-routing change;
7. application health validation;
8. customer communication owner;
9. failback decision and procedure.

Automatic traffic failover is allowed only when health probes measure the complete critical flow and the data layer
can support the transition safely.

## Testing

| Test | Minimum frequency |
|---|---|
| IaC plan for both regions | Every relevant change |
| Secondary-region service and quota checks | Monthly and before a release |
| Backup restore | Quarterly |
| Manual application activation | Quarterly |
| Full traffic failover | Twice yearly when configured |

Record actual recovery time, observed data loss, manual steps, and failures. If tests do not meet the targets, the
plan must state the measured result rather than the intended target.

## Cost controls

- report the secondary baseline separately from workload usage;
- default secondary compute to scale zero or minimum viable scale;
- do not duplicate expensive GPU capacity without a stated recovery need;
- include cross-region data-transfer and replication costs;
- apply budgets and ownership tags to secondary-region resources;
- remove a secondary footprint that no one tests or owns.

## Phase 7 foundation boundary

The guarded Phase 7 increment:

1. binds the selected secondary region and current Phase 3/4 readiness evidence;
2. models non-overlapping secondary networking and observability in dedicated Bicep and Terraform roots;
3. isolates scope, naming, address space, and Terraform state;
4. generates deterministic, execution-disabled manifests with ordered steps, postchecks, and teardown intent;
5. stops before preview, provider registration, deployment, global ingress, workload/data replication, or failover.

The provisional example baseline is for noncritical nonproduction planning only: RTO 240 minutes, RPO 60 minutes,
secondary recurring cost no more than 30% of primary, quarterly recovery exercise, and accountable role
`Platform Operations Owner`. It is not a production promise and does not satisfy human attestations automatically.

Profile-specific PRs may proceed only after the foundation plan has current region, billing/support, owner, external
review, cost, recovery-objective, exercise, and exact artifact-digest evidence. Those PRs must add and test their own
workload, data recovery, health, traffic, and rollback semantics. A separate, explicit execution change must then
review the deployment boundary; until that happens, Phase 6 continues to reject every secondary or
`cool-infrastructure` preview/apply request.

The first Container Apps profile increment binds immutable image digests, single-revision configuration, versioned Key
Vault references, managed identity and exact RBAC scope, a dedicated nondelegated `/23` subnet, scale-to-zero or one-idle
cost assumptions, all three health probe types, configuration parity, workspace diagnostics, rollback, and cleanup.
Its checked-in measured-recovery result is intentionally `not-measured`; it cannot become review-ready from targets or
attestations alone and never constitutes evidence of end-to-end recovery.

## Official guidance

- [Azure reliability guidance](https://learn.microsoft.com/azure/reliability/)
- [List of Azure regions](https://learn.microsoft.com/azure/reliability/regions-list)
- [Reliability in Container Apps](https://learn.microsoft.com/azure/reliability/reliability-container-apps)
- [Reliability in AKS](https://learn.microsoft.com/azure/reliability/reliability-aks)
- [Reliability in Azure Database for PostgreSQL][postgres-reliability]
- [Microsoft Foundry high availability and resiliency][foundry-reliability]

[foundry-reliability]: https://learn.microsoft.com/azure/foundry/how-to/high-availability-resiliency
[postgres-reliability]: https://learn.microsoft.com/azure/reliability/reliability-database-postgresql
