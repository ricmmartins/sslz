---
layout: page
title: "Startup Agent Implementation Plan"
nav_order: 8.4
description: "Phased, backward-compatible delivery plan for agent-assisted SSLZ"
---

# Startup Agent Implementation Plan

## Goal

Deliver agent-assisted account and workload planning without changing current SSLZ deployments until the new path is
tested and explicitly selected.

## Delivery rules

1. Keep `scripts/validate-prerequisites.sh` behavior and human-readable output compatible.
2. Add capabilities through new flags, files, and commands before changing defaults.
3. Keep account discovery and planning read only.
4. Require a reviewed plan and explicit approval for every Azure write.
5. Use official Azure documentation as the normative source for checks.
6. Test status semantics with mocked Azure responses before live integration tests.
7. Never make billing, entitlement, domain, or privileged-role changes unattended.
8. Do not deploy a secondary region in the first implementation.

## Proposed repository structure

```text
agent/
├── schemas/
│   ├── preflight-result.schema.json
│   ├── startup-input.schema.json
│   └── deployment-plan.schema.json
├── checks/
│   └── check-catalog.json
├── profiles/
│   ├── container-apps.json
│   ├── aks.json
│   ├── foundry.json
│   ├── postgresql.json
│   └── gpu.json
└── examples/
    ├── blocked-billing.json
    └── ready-container-apps.json

scripts/
├── validate-prerequisites.sh
└── startup-preflight.sh

tests/
├── fixtures/
└── startup-preflight.bats
```

Use Bash for the first CLI implementation because the repository already uses Bash scripts and Azure CLI. Keep the
decision data in JSON so another language or agent extension can consume it later.

Do not introduce Bats or another test dependency unless the repository adopts it explicitly. The initial test script
can use Bash assertions and fixture commands. The structure above shows the intended boundary, not a dependency
decision.

## Phase 0: Contract assets

**Purpose:** turn the approved documentation into testable artifacts without calling Azure.

**Changes:**

- add JSON schemas for startup input, preflight output, and deployment plan;
- add a catalog of stable check IDs, severities, documentation links, and automation classes;
- add sanitized passing, warning, and blocked examples;
- add a schema-validation job using an existing runtime available on GitHub-hosted runners;
- include `agent/**`, `scripts/startup-preflight.sh`, and tests in validation workflow paths.

**Acceptance:**

- all examples validate against the schemas;
- unsupported enum values and missing required fields fail CI;
- examples contain no personal data or secrets;
- no Azure login is required;
- no existing deployment workflow changes.

**Rollback:** remove the additive contract assets and CI job.

## Phase 1: Read-only account preflight

**Purpose:** replace assumptions about account readiness with structured evidence.

**Command proposal:**

```bash
./scripts/startup-preflight.sh inspect \
  --prod-subscription <subscription-id> \
  --nonprod-subscription <subscription-id> \
  --output json
```

**Checks:**

- active Azure authentication;
- explicit prod and nonprod subscription selection;
- tenant match;
- readable subscription state;
- effective deployment roles;
- policy-read access;
- required resource-provider registration state;
- company-domain and secondary-admin checks when permissions expose trustworthy evidence;
- billing and credit context, otherwise a blocking `unknown` result with the support path.

**Safety:**

- every Azure command is read only;
- no provider registration;
- no role assignment;
- no billing change;
- stderr is sanitized before becoming structured output;
- human output remains available with `--output text`.

**Tests:**

- mock `az` responses for pass, permission denied, tenant mismatch, missing provider, and throttling;
- mock unavailable billing evidence;
- verify stable check IDs and overall status;
- verify that blocking unknowns do not pass;
- verify secret-like fixture values are redacted.

**Acceptance:**

- deterministic JSON for every fixture;
- nonzero exit for `blocked` and `error`;
- zero exit for `pass` and `warning`;
- no Azure writes in source or execution trace;
- existing `validate-prerequisites.sh` remains unchanged.

**Rollback:** remove the new script. The current preflight remains the supported path.

## Phase 2: Workload profile planner

**Purpose:** select a startup-scale workload composition without deploying it.

**Implementation status:** implemented by `scripts/startup-workload-plan.sh`, the versioned definitions under
`agent/profiles/`, and the deterministic fixtures in `tests/fixtures/workload-planner/`. The output uses
`agent/schemas/workload-profile-plan.schema.json` and explicitly generates no IaC.

**Input:**

- workload shape;
- Kubernetes requirements;
- database requirement;
- Foundry model requirement;
- customer-managed GPU requirement;
- data residency;
- RTO and RPO;
- monthly platform budget;
- production incident owner.

**Output:**

- selected compute profile and rationale;
- optional PostgreSQL, Foundry, and GPU extensions;
- stop condition or graduation signal;
- required Azure checks;
- cost assumptions;
- unresolved founder decisions.

**Tests:**

- common API selects Container Apps;
- Docker alone does not select AKS;
- Kubernetes operator requirement selects AKS;
- missing AKS operations owner blocks AKS;
- managed-model fit does not select customer-managed GPU;
- regulated or active/active requirements stop for architecture review.

**Acceptance:**

- same inputs always select the same profile version;
- every nondefault selection includes a reason;
- no service or SKU availability is assumed;
- no IaC files are generated yet.

**Rollback:** remove the planner and profile JSON. Account preflight remains usable.

## Phase 3: Regional and capacity planner

**Purpose:** evaluate a primary and optional secondary region without claiming reserved capacity.

**Implementation status:** implemented by `scripts/startup-regional-plan.sh`, the timestamped evidence contract in
`agent/schemas/regional-planning-input.schema.json`, and the read-only result contract in
`agent/schemas/regional-capacity-plan.schema.json`. The first release marks only current `single-region-ready` output
as executable readiness. Cool and warm requests produce review-required planning output and no infrastructure.

**Checks:**

- allowed-location policies;
- required service availability;
- availability-zone support;
- compute and GPU SKU eligibility;
- quota headroom;
- Foundry model and deployment-type availability;
- data-residency compatibility;
- non-overlapping address-space proposal.

**Output:**

- ranked primary-region candidates;
- optional secondary region;
- selected regional mode;
- alternate SKU or model deployment type;
- point-in-time evidence timestamp;
- monthly secondary-baseline estimate;
- support or quota actions.

**Tests:**

- paired region without a required service is rejected;
- adequate quota with unavailable capacity is classified separately;
- missing model availability blocks Foundry profile;
- a secondary VNet overlap blocks Hot/Cool;
- no RTO/RPO defaults are invented.

**Acceptance:**

- planner is read only;
- stale capacity evidence is labeled;
- secondary-region choice passes the same service checks as the primary;
- first release supports `single-region-ready` planning only;
- no secondary infrastructure is deployed.

**Rollback:** disable regional planning and retain the workload plan.

## Phase 4: IaC plan generation

**Status:** Implemented as an additive, local-only generator and optional read-only preview command.

**Purpose:** convert an approved profile into reviewable inputs for existing SSLZ deployment paths.

**Changes:**

- generate `.local.bicepparam` or ignored Terraform variable files;
- generate distinct primary and secondary regional parameters when requested;
- run Bicep what-if or Terraform plan;
- produce a sanitized summary and plan digest;
- preserve raw plan artifacts only in an approved local or CI artifact location.

**Safety:**

- generated local parameter files remain ignored by Git;
- secure values use approved secret stores or secure parameters;
- plan output is checked for destructive changes;
- complete-mode Bicep deployment is prohibited;
- Terraform uses a remote backend for shared execution.

**Acceptance:**

- generated Bicep and Terraform inputs represent equivalent decisions;
- both pass the existing validation workflows;
- plan digest changes when subscription, region, service, paid plan, or action changes;
- no apply command exists in this phase.

**Rollback:** delete ignored generated files and plan artifacts.

## Phase 5: Approved remediation

**Status:** Implemented as a standalone, approval-bound provider-registration command. It is not integrated with
deployment.

**Purpose:** automate low-risk prerequisites without broad write authority.

**Initial allowlist:**

- register one resource provider explicitly listed by the selected workload profiles;
- create no roles, subscriptions, domains, billing links, or entitlements.

**Guardrails:**

- action must exist in the reviewed plan;
- action scope must match the plan;
- approval must match the plan digest and be unexpired;
- the agent shows the exact command before execution;
- post-action read verifies the intended state;
- partial failure produces a new plan instead of continuing blindly.
- replay and concurrent use are blocked by constrained, ignored local state;
- every Azure CLI operation uses an argument array and an explicit subscription;
- dry run performs no Azure calls or local writes.

**Acceptance:**

- unapproved action is rejected;
- modified action invalidates approval;
- action outside the allowlist is rejected;
- verification failure returns `error`;
- audit output contains no secrets or personal data.

**Rollback:** disable apply mode. Manual remediation remains documented.

## Phase 6: Existing SSLZ deployment integration

**Status:** Implemented as the signed-approval path for one existing primary Bicep or Terraform platform baseline.
Provider deployment workflows are dispatch-only Phase 6 wrappers; PR and push workflows remain validation-only.

**Purpose:** call the current Bicep or Terraform path after checks and approval.

**Guardrails:**

- deployment uses the reviewed plan artifact;
- subscription and tenant are rechecked immediately before execution;
- Bicep template and concrete parameters are compiled into an approval-bound exact semantic resource graph, reproduced
  once from the execution snapshot, and the resulting read-only ARM JSON runs incrementally without external templates,
  scripts, copy loops, or cross-subscription scopes;
- Terraform applies the saved plan, not a newly calculated unreviewed plan;
- both AzureRM automatic provider-registration controls remain disabled so Phase 5 is the only registration writer;
- post-deployment checks verify monitoring, Defender selection, policy, budgets, and expected resources;
- failure stops before workload deployment when the platform baseline is unhealthy.

**Acceptance:**

- manual and agent paths produce the same platform configuration;
- deployment workflows fail closed without the readiness-bound Phase 4 plan, reviewed manifest, and signed approval;
- integration test deploys, validates, and tears down in nonprod;
- rollback guidance is attached to the result.

## Phase 7: Hot/Cool deployment

**Purpose:** add secondary-region infrastructure only after the planning path is proven.

**First deployable mode:** `cool-infrastructure`.

**Order:**

1. generate and validate both regional plans;
2. deploy non-overlapping regional networking;
3. deploy profile-specific cool compute;
4. configure service-specific data recovery;
5. configure observability;
6. run activation and restore tests;
7. add global ingress only when end-to-end health checks and data behavior support it.

Foundry, PostgreSQL, Container Apps, and AKS each require separate recovery acceptance tests. A successful second SSLZ
deployment does not mark the workload as recovery ready.

## Pull request sequence

| PR | Scope | Azure writes |
|---|---|---:|
| 1 | Schemas, catalog, examples, schema CI | No |
| 2 | Read-only account preflight and fixture tests | No |
| 3 | Workload profile planner and tests | No |
| 4 | Region and capacity planner and tests | No |
| 5 | Parameter generation and IaC plan summaries | No |
| 6 | Approved provider registration allowlist | Yes |
| 7 | Existing SSLZ deployment integration | Yes |
| 8+ | Service-specific Hot/Cool modules and recovery tests | Yes |

Do not combine read-only planning with write automation in the same first PR.

## Review gates

Before the first write-capable PR:

- security review of command construction, redaction, scopes, and approval binding;
- Azure architecture review of check semantics and startup defaults;
- confirmation from the Microsoft for Startups team on support routes and billing limitations;
- Bicep and Terraform parity review;
- fixture coverage for every blocking check;
- documented rollback and partial-failure behavior.

Before Hot/Cool deployment:

- measured recovery target for each supported profile;
- cost estimate for the cool footprint;
- service-specific data recovery test;
- capacity and model checks for both regions;
- named failover owner.

## Definition of done

The agent-assisted path is ready for an initial startup pilot when:

1. it can complete inspect and plan modes without Azure writes;
2. account, billing uncertainty, quota, capacity, service availability, and policy failures are distinct;
3. Container Apps is selected by default and AKS requires justification;
4. every plan shows costs, assumptions, official sources, and unresolved actions;
5. approval is bound to an immutable plan digest;
6. manual SSLZ deployment remains unchanged;
7. nonprod integration tests pass for both Bicep and Terraform;
8. the pilot begins single-region, with Hot/Cool limited to a reviewed plan until recovery tests pass.
