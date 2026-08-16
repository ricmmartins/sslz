---
layout: page
title: "Implementation and Evidence Status"
nav_order: 7.9
description: "Authoritative implementation, execution-authority, and validation status for SSLZ"
---

# Implementation and Evidence Status

This page is the authoritative status summary for the repository at
[`6b361e2`](https://github.com/ricmmartins/sslz/commit/6b361e29031529af78868b46e3a3628b179996ed),
the `main` merge commit for [PR #29](https://github.com/ricmmartins/sslz/pull/29), as of 2026-08-16 UTC.
It distinguishes implemented code from execution authority and test evidence. A contract or planner can be implemented
without being allowed to execute the operation it describes.

## Evidence terms

- **Local synthetic:** deterministic fixtures, mocks, generated ephemeral signing identities, schema validation, and
  compiled-template or Terraform tests. It is not evidence about a real tenant, workload, recovery event, or migration.
- **Hosted CI:** the same repository tests on GitHub-hosted runners. The three `Validate IaC` jobs passed for
  [PR #29](https://github.com/ricmmartins/sslz/actions/runs/31919769131).
- **Live preview:** Azure-authenticated Bicep what-if or Terraform plan. The latest verified successful scheduled run in
  this audit was [2026-08-10 on commit `a7acdbd`](https://github.com/ricmmartins/sslz/actions/runs/31365214740), after
  PR #9. Both preview jobs passed and the deploy job was skipped. This predates PRs #10-#29 and is not current-`main`
  live evidence.
- **Live execution:** an Azure, database, registry, pipeline, DNS, identity, network, cutover, rollback, or failback write
  followed by relevant postchecks. No such evidence for the current `main` commit is checked into this repository or
  identified by the GitHub runs reviewed for this status.

## Capability matrix

| Capability | Implementation state | Execution authority | Evidence on this baseline | Next gate |
|---|---|---|---|---|
| Phase 0 contracts and result schemas | Delivered | None; schemas only | Local synthetic and hosted CI | Consumer-specific compatibility testing |
| Phase 1 account/topology preflight | Delivered read-only `inspect` path | Azure reads under the operator identity; no writes | Local synthetic and hosted CI; no current-`main` tenant-read record retained here | Authorized live read-only pilot with redacted evidence |
| Phases 2-3 workload, region, capacity, and PostgreSQL fallback planning | Delivered local planners | None; supplied JSON only | Local synthetic and hosted CI | Current workload, regional, quota, capacity, and owner evidence |
| Phase 4 IaC generation and preview | Delivered generator; preview is optional | Local file writes; Bicep what-if reads Azure; Terraform plan can acquire a remote-state backend lease; neither applies managed infrastructure | Local synthetic and hosted CI; historical live preview on the older PR #9 baseline only | Current-`main` Bicep what-if and Terraform plan in an approved test subscription |
| Phase 5 provider remediation | Delivered narrow writer | Separate single-use approval for one profile-allowlisted provider registration | Local synthetic and hosted CI; no current-`main` live registration evidence | Approved nonproduction registration and readback |
| Phase 6 primary platform baseline | Delivered approval-gated Bicep/Terraform apply path and manual workflows | Signed single-use approval for one exact primary `single-region-ready` baseline on a protected runner | Local synthetic and hosted CI; no current-`main` approved live apply/postcheck record | Protected-runner nonproduction preview, approval, apply, postchecks, and rollback review |
| Phase 7 cool foundation and Container Apps cool profile | Planning artifacts delivered; execution disabled | None; Phase 6 rejects secondary and `cool-infrastructure` execution | Local synthetic and hosted CI | Separate reviewed executor plus live activation, restore, RTO/RPO, traffic, and cleanup tests |
| PostgreSQL migration, rehearsal, and execution-contract planning | Planners and approval/evidence contracts delivered; executor absent | None; every planned operation remains unapplied | Local synthetic and hosted CI; no live database, rehearsal, cutover, or rollback evidence | Protected live evidence, separate migration authority, executor, rehearsal, cutover, and rollback validation |
| Container image and CI/CD migration planning | Planner delivered; execution disabled | None | Local synthetic and hosted CI; no live registry, image, pipeline, promotion, or rollback evidence | Protected live evidence, separate promotion authority, executor, and dual-publish/cutover test |
| Dual-cloud connectivity, DNS, identity, and egress planning | Planner delivered; execution disabled | None | Local synthetic and hosted CI; no live tunnel, route, DNS, federation, egress, or failback evidence | Protected live topology evidence, separate network authorities, executor, coexistence and failback tests |
| Program-lineage envelope and greenfield report v2 | Delivered local validator and canonical report contract | None; it preserves but does not expand baseline authority | Local synthetic and hosted CI | Protected external replay/trust store and a live-evidence report generated by an authorized system |
| SaaS private endpoint runtime path | Bicep and Terraform example paths delivered by [PR #27](https://github.com/ricmmartins/sslz/pull/27) | Direct operator IaC only; not an agent-approved workload path | Compiled/template and Terraform tests in hosted CI; no current-`main` live example deployment evidence | Nonproduction deployment and end-to-end Container Apps-to-SQL/Redis DNS/connectivity test |
| Defender for Storage V2 | Default-off opt-in delivered by [PR #28](https://github.com/ricmmartins/sslz/pull/28) | Direct operator IaC or an exact reviewed Phase 6 baseline decision | Compiled/template, Terraform, contract, and hosted CI validation; no current-`main` live opt-in evidence | Workload and cost review, explicit approval, live tier readback, and budget monitoring |

The canonical
[`greenfield-journey-report.schema.json`](../agent/schemas/greenfield-journey-report.schema.json) is version `2.0.0`.
Its `programLineage` summary references the separately emitted envelope by exact `envelopeDigest` and
`programIdentityDigest`, and it separates baseline deployment readiness from PostgreSQL migration, container
image/CI/CD, and dual-cloud planning readiness. The checked-in report uses `evidenceMode: "synthetic"` and grants no
migration or dual-cloud execution authority.

## Direct operator boundary

The Quick Start and example `az deployment ... create` and `terraform apply` commands are direct operator IaC paths.
They do not invoke the startup-agent Phase 4 plan, Phase 5 remediation approval, or Phase 6 signed deployment approval.
That is an intentional compatibility path, not an approval bypass inside the agent workflows. Operators using it own plan
review, credentials, permissions, state protection, change approval, validation, and rollback.

The repository must not contain tenant credentials, signing keys, approval identities, connection strings, billing
documents, support transcripts, or live topology. Provision those through the protected runner, identity, secret,
approval, billing, support, and evidence systems described by the relevant contracts.

## Remaining human and live prerequisites

Before making broader claims, complete and retain sanitized evidence for:

1. current tenant, subscription, billing-benefit, role, policy, provider, quota, capacity, and service-availability checks;
2. security, architecture, IaC parity, cost, notification-recipient, and accountable-owner review;
3. current-main Bicep what-if and Terraform plan against approved nonproduction targets;
4. an approved Phase 5 registration where one is actually required;
5. protected-runner Phase 6 deployment, postchecks, failure handling, and rollback review;
6. workload health and private endpoint DNS/connectivity for the selected examples;
7. measured restore, activation, RTO/RPO, traffic, and cleanup exercises before any Hot/Cool readiness claim;
8. PostgreSQL rehearsal and migration, image dual-publish/promotion, and dual-cloud coexistence/cutover/failback under
   separate authorities before any execution claim.

## Delivery history

The numbered phases are capability labels, not GitHub pull-request numbers. The original conceptual PR table in the
[implementation plan](startup-agent-implementation-plan.md) predates delivery. Actual merged delivery was:

| PR | Delivered scope |
|---|---|
| [#4](https://github.com/ricmmartins/sslz/pull/4) | Startup agent contracts |
| [#5](https://github.com/ricmmartins/sslz/pull/5) | Read-only startup preflight |
| [#6](https://github.com/ricmmartins/sslz/pull/6) | Read-only workload planner |
| [#7](https://github.com/ricmmartins/sslz/pull/7) | Read-only regional planner |
| [#8](https://github.com/ricmmartins/sslz/pull/8) | Phase 4 IaC generation |
| [#9](https://github.com/ricmmartins/sslz/pull/9) | Approved provider remediation |
| [#10](https://github.com/ricmmartins/sslz/pull/10) | Phase 6 approved baseline integration |
| [#11](https://github.com/ricmmartins/sslz/pull/11) | Readiness evidence binding |
| [#13](https://github.com/ricmmartins/sslz/pull/13) | Deployment and review gate hardening |
| [#14](https://github.com/ricmmartins/sslz/pull/14) | Execution-disabled cool foundation planning |
| [#15](https://github.com/ricmmartins/sslz/pull/15) | Execution-disabled Container Apps cool profile |
| [#16](https://github.com/ricmmartins/sslz/pull/16) | Startup billing/topology decisions |
| [#17](https://github.com/ricmmartins/sslz/pull/17) | Defender workspace placement |
| [#18](https://github.com/ricmmartins/sslz/pull/18) | Portable regional retry contracts |
| [#19](https://github.com/ricmmartins/sslz/pull/19) | PostgreSQL regional fallback |
| [#20](https://github.com/ricmmartins/sslz/pull/20) | AKS ingress contracts |
| [#21](https://github.com/ricmmartins/sslz/pull/21) | Synthetic greenfield journey validation |
| [#22](https://github.com/ricmmartins/sslz/pull/22) | PostgreSQL migration planner |
| [#23](https://github.com/ricmmartins/sslz/pull/23) | PostgreSQL rehearsal planner |
| [#24](https://github.com/ricmmartins/sslz/pull/24) | Approval-bound, execution-disabled PostgreSQL execution planner |
| [#25](https://github.com/ricmmartins/sslz/pull/25) | Container image and CI/CD migration planner |
| [#26](https://github.com/ricmmartins/sslz/pull/26) | Dual-cloud connectivity planner |
| [#27](https://github.com/ricmmartins/sslz/pull/27) | SaaS private endpoint runtime path |
| [#28](https://github.com/ricmmartins/sslz/pull/28) | Default-off Defender for Storage opt-in |
| [#29](https://github.com/ricmmartins/sslz/pull/29) | Cross-program lineage and report v2 |

[PR #12](https://github.com/ricmmartins/sslz/pull/12) was closed without merge; its intended hardening scope was delivered
through later merged work, beginning with PR #13.
