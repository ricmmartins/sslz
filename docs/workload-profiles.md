---
layout: page
title: "Startup Workload Profiles"
nav_order: 8.2
description: "Opinionated workload choices for agent-assisted SSLZ planning"
---

# Startup Workload Profiles

## Status

These profiles are implemented by the dependency-free, read-only workload planner. They do not add or change
deployable examples.

Run the planner with a local startup input:

```bash
./scripts/startup-workload-plan.sh plan \
  --input agent/examples/startup-input.json \
  --output json
```

The output conforms to
[`agent/schemas/workload-profile-plan.schema.json`](../agent/schemas/workload-profile-plan.schema.json). It includes
the profile version, selection rationale, assumptions, required checks, unresolved decisions, and cost assumptions.
The command makes no Azure calls, writes no files, and always reports `iacGenerated: false`.

A ready workload profile can be passed with timestamped evidence to the
[regional and capacity planner](preflight-result-contract.md). That planner consumes the versioned profile selection;
it does not change the selected compute profile or extensions.

## Profile selection rules

The agent asks only questions that change architecture, cost, or operational ownership. It selects the simplest
profile that meets the stated requirements and explains which answer caused each deviation from the default.

The profiles assume:

- one primary workload;
- separate prod and non-prod subscriptions;
- no dedicated platform team;
- managed services unless the workload requires control that a managed service cannot provide;
- a single region unless recovery or capacity requirements justify Hot/Cool;
- the existing SSLZ security, monitoring, cost, and policy baseline.

## Discovery questions

| Question | Why it matters |
|---|---|
| What does the application do? | Establishes workload shape and required services |
| Is traffic HTTP, event driven, scheduled, or mixed? | Selects compute and scaling model |
| Does the team require Kubernetes APIs or cluster-level control? | Distinguishes AKS from Container Apps |
| Does the workload use a relational database? | Selects PostgreSQL when appropriate |
| Does it call Foundry-managed models? | Adds model, quota, filtering, and regional checks |
| Does it run or train a custom model on GPU? | Adds GPU quota, SKU, and AKS requirements |
| What data residency boundary applies? | Restricts primary and secondary regions |
| What are the target RTO and RPO? | Selects single-region or Hot/Cool readiness |
| What monthly platform budget is acceptable? | Prevents unsuitable services and standby scale |
| Who owns production incidents? | Determines whether the operational burden is supportable |

## Decision order

1. Start with Container Apps.
2. Select AKS only when a stated requirement needs Kubernetes or customer-managed GPU nodes.
3. Add PostgreSQL only when the workload needs relational persistence.
4. Prefer Foundry-managed models over customer-managed model serving.
5. Keep the profile single-region unless the founder provides a recovery or capacity requirement.
6. Stop and recommend further architecture review when the workload falls outside SSLZ boundaries.

Docker packaging is input context only. It is never an AKS selection reason.

## Profile: Container Apps

**Default for:** HTTP APIs, web applications, background workers, scheduled jobs, and event-driven services.

**Why it is the default:** Container Apps provides managed ingress, autoscaling, health monitoring, revisions, and
scale to zero without requiring the startup to operate Kubernetes.

**Baseline decisions:**

- workload-profiles environment;
- VNet integration when private service access is selected;
- managed identity for Azure service access;
- startup, readiness, and liveness probes;
- min replicas of zero for nonprod unless startup latency requires otherwise;
- production min replicas based on the availability target;
- Log Analytics and application telemetry;
- secrets referenced from Key Vault, not copied into IaC parameters.

**Select AKS instead when:**

- the application requires Kubernetes APIs, operators, admission controllers, or custom schedulers;
- a service mesh is a documented requirement;
- the team requires cluster-level networking behavior unavailable in Container Apps;
- custom GPU model serving requires Kubernetes scheduling and device plugins;
- the workload depends on a Kubernetes ecosystem component that cannot run as a regular container.

Do not select AKS because the team already uses Docker or expects future scale. Container Apps supports containerized
applications and horizontal scaling without cluster operations.

## Profile: AKS

**Default for:** none. AKS is an exception that requires a recorded justification.

**Prerequisites:**

- an engineer owns cluster upgrades, node-image upgrades, capacity, networking, and incident response;
- production uses the Standard tier and uptime SLA;
- the region and selected VM SKUs pass quota and capacity checks;
- address space supports node, pod, upgrade-surge, and failover growth;
- application workloads run on user node pools;
- system and user workloads are separated;
- production workloads use multiple replicas, disruption budgets, and topology spread constraints.

**Startup limits:**

- begin with one system pool and one user pool;
- add a GPU pool only when required;
- avoid service mesh, private cluster, custom egress, and many node pools unless a current requirement justifies them;
- use cluster autoscaler or node autoprovisioning only after validating quota headroom and workload compatibility.

If the founder cannot name an owner for AKS operations, the agent returns to the Container Apps profile or stops for
manual architecture review.

## Profile: Foundry application

This profile extends Container Apps or AKS. It is not a standalone compute profile.

**Preferred path:** use a Foundry-managed model when it meets functional, data, latency, and throughput requirements.

**Required checks:**

- model and deployment type are available in the selected region;
- quota is sufficient for the expected throughput;
- content filtering settings fit the application and have an identified owner;
- application retries, timeouts, and fallback behavior are defined;
- model endpoint access uses managed identity where supported;
- token usage, latency, throttling, and content-filter outcomes are monitored.

Model availability and current capacity must be validated in both regions for Hot/Cool. A paired region does not
guarantee the same model, version, deployment type, or capacity.

## Profile: PostgreSQL

Use Azure Database for PostgreSQL when the workload needs relational data and PostgreSQL compatibility.

**Nonprod default:**

- Burstable compute when supported by the workload;
- no high-availability standby;
- backup retention appropriate for development data;
- private access only when the workload profile already justifies private networking.

**Production default:**

- General Purpose unless measured demand supports another tier;
- zone-redundant high availability when the business requires zone resilience and the region supports it;
- managed identity or Microsoft Entra authentication where application support allows;
- alerts for availability, storage, connections, CPU, and failed authentication;
- tested backup restore procedure.

Cross-region recovery requires an explicit data plan. A secondary application environment without replicated or
restorable data is not a recovery solution.

## Profile: Customer-managed GPU

Use only when managed models cannot satisfy the workload.

**Required checks:**

- training or serving requirement that needs direct GPU control;
- eligible GPU SKU in the subscription and region;
- current quota headroom;
- a second acceptable SKU or region;
- container image and model-artifact strategy;
- startup, readiness, and liveness behavior;
- interruption tolerance before using Spot;
- expected utilization and monthly cost.

GPU Spot is suitable for interruptible training, batch inference, and workloads designed to reschedule. It is not the
default for a latency-sensitive production endpoint.

## Composition examples

| Founder need | Selected composition |
|---|---|
| Web API with background jobs | Container Apps |
| SaaS API with relational data | Container Apps + PostgreSQL |
| AI assistant using managed models | Container Apps + Foundry + optional PostgreSQL |
| Custom GPU inference with Kubernetes requirements | AKS + GPU pool + storage |
| AI application with defined regional recovery | Compute profile + Foundry + data profile + Hot/Cool plan |

## Stop conditions

The agent stops for architecture review when any of these apply:

- more than one independent production workload;
- five or more subscriptions;
- regulated workload with controls beyond the SSLZ baseline;
- hybrid connectivity or centralized egress inspection;
- active/active multi-region writes;
- a business requirement for automatic failover that has no tested data strategy;
- a dedicated platform team requesting enterprise-wide shared services;
- the architecture requires services that no current profile covers.

These are signals to use the [Graduation Guide](graduation-guide.md), not reasons to keep expanding the startup
profiles.

## Official guidance

- [Azure compute decision tree][compute-tree]
- [Well-Architected guidance for Container Apps][aca-waf]
- [Well-Architected guidance for AKS][aks-waf]
- [Reliability in Azure Database for PostgreSQL][postgres-reliability]
- [Microsoft Foundry high availability and resiliency][foundry-reliability]

[aca-waf]: https://learn.microsoft.com/azure/well-architected/service-guides/azure-container-apps
[aks-waf]: https://learn.microsoft.com/azure/well-architected/service-guides/azure-kubernetes-service
[compute-tree]: https://learn.microsoft.com/azure/architecture/guide/technology-choices/compute-decision-tree
[foundry-reliability]: https://learn.microsoft.com/azure/foundry/how-to/high-availability-resiliency
[postgres-reliability]: https://learn.microsoft.com/azure/reliability/reliability-database-postgresql
