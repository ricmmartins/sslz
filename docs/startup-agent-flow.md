---
layout: page
title: "Startup Agent Flow"
nav_order: 8
description: "Design proposal for agent-assisted Azure account and SSLZ setup"
---

# Startup Agent Flow

## Status

This document is a design proposal. It does not change the current SSLZ deployment flow.

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
| Startup subscription | Identify the sponsorship subscription and its tenant | No | Yes |
| Credit context | Report visible billing profile and credit context when permissions allow | No | Yes if unresolved |
| Company tenant | Confirm tenant identity and collect the intended company domain | No | Yes |
| Secondary admin | Confirm a second administrator exists | No | Yes |
| Custom domain | Confirm the company domain is verified and primary | No | Yes |
| Subscription selection | Confirm the exact prod and non-prod subscription IDs | No | Yes |
| Tenant consistency | Confirm both subscriptions belong to the intended tenant | No | Yes |
| Effective permissions | Check the roles required by the selected SSLZ modules | No | Yes |
| Resource providers | Report missing registrations and propose registration commands | With approval | Yes |
| Policy access | Confirm the identity can read and deploy required assignments | No | Yes when policies are selected |

### Human-only and support actions

The agent must not attempt to:

- redeem startup credits;
- transfer an entitlement to another account;
- associate subscriptions with another billing profile;
- create or verify a company DNS domain without approval;
- create a Global Administrator or subscription Owner assignment without approval;
- infer that credits apply to a subscription when billing evidence is unavailable.

The result must identify the correct Microsoft support path for credit, entitlement, or billing-profile problems.

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

The Hot/Cool option is an opt-in workload profile, not the default for every startup.

| Layer | Primary region (Hot) | Secondary region (Cool) |
|---|---|---|
| SSLZ baseline | Deployed | Deployed |
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

The first planner release marks only current `single-region-ready` output as executable readiness. A
`cool-infrastructure` or `warm-workload` request remains review-only and generates no IaC or Azure operations.

## Phase 4: Plan and approval

Before deployment, present:

- detected tenant and account context;
- exact target subscription for each environment;
- selected workload profile and rationale;
- primary and secondary regions;
- services, SKUs, and paid security plans;
- quota and capacity findings;
- estimated recurring platform cost;
- Bicep what-if or Terraform plan;
- manual and support actions still required;
- rollback and teardown approach.

Approval applies to a specific plan. Any change to subscription, region, paid plan, privileged role, or resource
scope invalidates the approval and requires a new plan.

## Phase 5: Approved provider remediation

The implemented first write-capable command is limited to one resource-provider registration already present in the
reviewed plan. The provider namespace must be required by the selected workload profile. Apply requires a separate,
unexpired, single-use approval artifact bound to the plan digest and every action field, rechecks the exact tenant and
subscription, runs one argument-array Azure CLI command, and verifies `Registered`. It performs no deployment,
feature registration, policy, role, billing, entitlement, subscription, or domain change.

See [Approved Provider Remediation](provider-remediation.md).

## Phase 6: Deployment and validation

The agent uses the existing SSLZ Bicep or Terraform path. It must:

1. preserve idempotency;
2. use workload identity federation for CI/CD;
3. avoid secrets in source, parameters, logs, and agent output;
4. deploy in incremental mode for Bicep;
5. retain Terraform state in an approved remote backend for team use;
6. record the plan, approval, deployment IDs, and validation result;
7. validate the deployed state instead of treating a successful command as success.

Post-deployment validation includes:

- expected resource groups and regional resources;
- policy assignments and compliance state;
- Log Analytics and Activity Log forwarding;
- selected Defender plans and their cost;
- budgets and alert recipients;
- application health endpoint;
- database connectivity through managed identity where applicable;
- regional recovery readiness for Hot/Cool profiles.

## Agent result contract

Checks should eventually support a versioned machine-readable result. The complete design is in the
[Preflight Result Contract](preflight-result-contract.md). This is a design target, not an implemented interface.

```json
{
  "schemaVersion": "1.0",
  "planId": "generated-identifier",
  "mode": "plan",
  "checks": [
    {
      "id": "account.subscription.tenant-match",
      "status": "pass",
      "severity": "blocking",
      "summary": "The selected subscriptions belong to the intended tenant.",
      "evidence": {
        "tenantId": "<tenant-id>",
        "subscriptionIds": ["<prod-id>", "<nonprod-id>"]
      },
      "automaticRemediation": false,
      "documentationUrl": "https://learn.microsoft.com/startups/build/azure-getting-started/set-up-account"
    }
  ],
  "requiresApproval": true
}
```

Do not include access tokens, secrets, full billing records, personal email addresses, or other unnecessary personal
data in this output.

## Initial acceptance criteria

The first implementation is complete when it can:

1. run without changing Azure in plan mode;
2. identify the active account, tenant, and explicit target subscriptions;
3. detect tenant mismatch and missing required roles;
4. report missing providers without registering them automatically;
5. classify billing and entitlement uncertainty as a support action;
6. ask the workload questions and select Container Apps or AKS with a reason;
7. evaluate a primary and optional secondary region without claiming capacity is guaranteed;
8. produce a reviewable deployment plan;
9. require explicit approval before any write operation;
10. leave the existing manual Bicep and Terraform workflows unchanged.

## Out of scope for the first implementation

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
