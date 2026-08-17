---
layout: agent
title: "SSLZ Founder Agent"
description: "Founder-guided Azure readiness, planning, evidence, and approval boundaries"
permalink: /agent/
---

The **SSLZ Founder Agent** guides founders from "what are you building?" to a reviewable Azure readiness and landing-zone
plan. It reuses local scripts, machine-readable contracts, deterministic planning, and narrowly approval-gated
integrations. It does not replace the classic Bicep or Terraform Quick Start.

[Launch the SSLZ Founder Agent]({{ '/use-sslz-agent/' | relative_url }})

> **Not an autonomous hosted bot:** SSLZ does not embed a chatbot, run a hosted agent, capture your credentials, or make
> unattended cloud decisions. Operators choose inputs, review artifacts, provide Azure authentication only when needed,
> and retain responsibility for deployment, validation, and rollback.

## Choose the right path

| Experience | Best for | Execution model |
|---|---|---|
| [Classic SSLZ]({{ '/' | relative_url }}) | Teams that want the original one-hour landing-zone path | Direct operator Bicep or Terraform |
| SSLZ Founder Agent | Founders who want guided discovery, plans, evidence, and explicit approval boundaries | Local Copilot CLI plus repository scripts and contracts; writes are absent, disabled, or narrowly approval-gated as documented |

## Flow, contracts, and evidence

1. [Startup agent flow]({{ '/agent/docs/startup-agent-flow/' | relative_url }}) explains account discovery, workload
   selection, regional planning, IaC review, and execution boundaries.
2. [Preflight result contract]({{ '/agent/docs/preflight-result-contract/' | relative_url }}) defines account,
   subscription, billing-topology, check, action, and deployment-plan results.
3. [Implementation and evidence status]({{ '/agent/docs/implementation-status/' | relative_url }}) is authoritative for
   what is delivered, what can write, and whether evidence is synthetic, historical, or live.
4. [Implementation plan]({{ '/agent/docs/startup-agent-implementation-plan/' | relative_url }}) records the phased
   program and review gates.

## Planning and readiness

| Area | Documentation |
|---|---|
| Workload selection | [Startup workload profiles]({{ '/agent/docs/workload-profiles/' | relative_url }}) |
| Region and recovery posture | [Hot/Cool regional topology]({{ '/agent/docs/hot-cool-regional-topology/' | relative_url }}) |
| Bicep and Terraform review artifacts | [IaC plan generation]({{ '/agent/docs/iac-plan-generation/' | relative_url }}) |
| Privacy-preserving readiness bindings | [Readiness evidence]({{ '/agent/docs/readiness-evidence/' | relative_url }}) |
| Provider registration | [Approved provider remediation]({{ '/agent/docs/provider-remediation/' | relative_url }}) |
| Baseline deployment boundary | [Approved deployment integration]({{ '/agent/docs/approved-deployment-integration/' | relative_url }}) |

## Migration and multi-environment programs

These programs remain separate from primary-baseline authority. Their lineage does not silently grant execution rights.

- [Program lineage envelope]({{ '/agent/docs/program-lineage-envelope/' | relative_url }})
- [PostgreSQL migration planning]({{ '/agent/docs/postgresql-migration-planning/' | relative_url }})
- [Container image and CI/CD migration planning]({{ '/agent/docs/container-image-cicd-planning/' | relative_url }})
- [Dual-cloud connectivity, DNS, identity, and egress planning]({{ '/agent/docs/dual-cloud-connectivity-planning/' | relative_url }})
- [Control-plane ownership planning]({{ '/agent/docs/control-plane-ownership-planning/' | relative_url }})

## Safety and execution boundaries

- Read-only planners do not log into Azure unless a documented preview or inspection explicitly requires authentication.
- Planning-only migration, image, connectivity, control-plane, and Hot/Cool artifacts do not authorize execution.
- Provider registration and primary-baseline integration accept only reviewed, digest-bound, single-purpose approvals.
- A passing schema or fixture test is **synthetic evidence**, not proof of a live deployment, migration, failover, image
  promotion, private connection, capacity allocation, or application-health outcome.
- Follow the [implementation status matrix]({{ '/agent/docs/implementation-status/' | relative_url }}) for the remaining
  human review and live validation gates.

## Repository assets

- [Agent check catalog]({{ '/agent/checks/check-catalog.json' | relative_url }}) and schemas are published under this section; start with the
  [greenfield journey report schema]({{ '/agent/schemas/greenfield-journey-report.schema.json' | relative_url }}).
- [Sanitized contract examples]({{ '/agent/examples/ready-container-apps.json' | relative_url }}) show expected shapes
  without tenant secrets.
- [Planning and validation scripts]({{ site.github_repo }}/tree/agent-aware/scripts) are source-controlled and run locally.
- [Agent contract source]({{ site.github_repo }}/tree/agent-aware/agent) contains every schema, profile, example, and check.
