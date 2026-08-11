---
layout: page
title: "IaC Plan Generation"
nav_order: 8.4
description: "Digest-bound local Bicep and Terraform review inputs"
---

# IaC Plan Generation

## Purpose

Phase 4 converts a ready workload profile and eligible regional recommendation into reviewable inputs for the existing
SSLZ Bicep and Terraform roots. It does not add workload modules or run an Azure or Terraform write operation. The
dispatch-only deployment workflows consume Phase 4 output only through the signed Phase 6 integration.

The input and output contracts are:

- [`agent/schemas/iac-plan-input.schema.json`](../agent/schemas/iac-plan-input.schema.json) for compatible Phase 4 v1 inputs
- [`agent/schemas/iac-plan-input-v2.schema.json`](../agent/schemas/iac-plan-input-v2.schema.json) for Phase 6-capable plans with an exact backend subscription
- [`agent/schemas/iac-plan-input-v3.schema.json`](../agent/schemas/iac-plan-input-v3.schema.json) for approval-capable plans with readiness evidence
- [`agent/schemas/readiness-evidence.schema.json`](../agent/schemas/readiness-evidence.schema.json)
- [`agent/schemas/subscription-topology-decision.schema.json`](../agent/schemas/subscription-topology-decision.schema.json)
- [`agent/schemas/defender-workspace-placement-decision.schema.json`](../agent/schemas/defender-workspace-placement-decision.schema.json)
- [`agent/schemas/iac-plan-summary.schema.json`](../agent/schemas/iac-plan-summary.schema.json)
- [`agent/schemas/regional-attempt.schema.json`](../agent/schemas/regional-attempt.schema.json)
- [`agent/schemas/cool-foundation-baseline.schema.json`](../agent/schemas/cool-foundation-baseline.schema.json)
- [`agent/schemas/cool-foundation-plan.schema.json`](../agent/schemas/cool-foundation-plan.schema.json)
- [`agent/schemas/cool-foundation-manifest.schema.json`](../agent/schemas/cool-foundation-manifest.schema.json)
- [`agent/schemas/container-apps-cool-profile-input.schema.json`](../agent/schemas/container-apps-cool-profile-input.schema.json)
- [`agent/schemas/container-apps-cool-profile-plan.schema.json`](../agent/schemas/container-apps-cool-profile-plan.schema.json)
- [`agent/schemas/container-apps-cool-profile-manifest.schema.json`](../agent/schemas/container-apps-cool-profile-manifest.schema.json)
- [`agent/schemas/terraform-plan-provenance.schema.json`](../agent/schemas/terraform-plan-provenance.schema.json)

## Generate review inputs

```bash
./scripts/startup-iac-plan.sh generate \
  --input <iac-plan-input.json> \
  --provider both \
  --output-dir .sslz/generated/my-plan
```

The output directory must be `.sslz/generated` or one of its descendants. Beneath the plan ID it writes an
attempt-and-plan-digest directory for the summary, plus environment-specific attempt directories for provider artifacts:

- one `.local.bicepparam` per environment and requested regional role;
- one `.auto.tfvars` per environment and requested regional role;
- `plan-summary.json`, containing the canonical decisions, artifact paths, preview classification, digest, and
  approval state.

For example, a summary is written under
`.sslz/generated/my-plan/a02-centralus-<plan-digest>/plan-summary.json`; parameter artifacts are written under the
signed `regionalAttempt.artifactRoot`. A later plan or regional attempt never reconciles or deletes an earlier
attempt directory.

Only primary files are generated for `single-region-ready`. A reviewed `cool-infrastructure` recommendation generates
the primary representations plus nonproduction secondary parameters targeting dedicated Bicep and Terraform roots.
Those roots model only collision-safe networking and observability, use a nonoverlapping VNet CIDR, distinct regional
resource groups, deterministic names, a dedicated nondelegated Container Apps `/23` subnet, and an isolated Terraform
backend key. They do not include subscription-global
policy, budgets, Defender settings, global ingress, workloads, replication, or failover. `warm-workload` remains
review-only and does not generate a secondary foundation.

## Regional retries

`regionalAttempt` is optional for the initial plan and defaults to attempt 1 in the selected primary region. A later
attempt must provide the complete immutable predecessor record for both production and nonproduction. Each record must
match its environment, chain, attempt number, original region, identity, and record digest. A changed-region attempt must
also provide successful cleanup evidence for each environment; otherwise planning fails closed. The selected primary
region must exactly match the attempt target.

Every later attempt receives deterministic, collision-safe Bicep nested deployment names, resource and policy-assignment
suffixes, Terraform workspace identities, raw saved-plan paths, and generated artifact paths. Terraform deliberately
retains the chain's reviewed backend key so subscription-level singleton ownership is not lost; predecessor validation,
successful cleanup evidence, chain concurrency, fresh provenance, and the new approval prevent stale or parallel state
use. The attempt identity is provider-equivalent, but each provider gets its own artifact directory. Region changes
always produce a different plan digest and require new previews, a new saved Terraform plan or Bicep what-if, a new
execution manifest, and a new signed approval. The planner never imports a saved plan or regional evidence from a
predecessor attempt. Artifact roots include both the attempt identity and plan digest, so retry generation cannot
overwrite or mutate the failed attempt's evidence. Retry planning accepts only a failed no-write predecessor or a
successfully cleaned predecessor and requires the same Terraform backend prefix and state key. Before execution, the
executor reacquires the chain lock and verifies that exact predecessor digest and terminal state in its protected durable
store; a cleanup transition preserves the original failure evidence while atomically advancing the stored record.

## Generate the execution-disabled Phase 7 plan

```bash
./scripts/startup-cool-foundation-plan.sh generate \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --baseline agent/examples/cool-foundation-baseline.json \
  --output-dir .sslz/generated/my-plan/cool-foundation
```

This local command validates the selected secondary region, evidence freshness, owner role/reference, measured and
target RTO/RPO, cost ceiling and provenance, external reviews, recovery exercise, billing/support confirmation, and
exact artifact/source digests. Missing human or billing evidence always blocks; it is never inferred. The output binds
provider-equivalent decisions to two execution-disabled manifests with ordered step states, deterministic idempotency
keys, retry/resume rules, read-only postchecks, teardown intent, and fail-closed cleanup handling.

The example baseline is provisional for noncritical nonproduction evidence only: 240-minute RTO, 60-minute RPO, a
secondary recurring-cost ceiling of 30% of primary, quarterly recovery exercises, and accountable role
`Platform Operations Owner`. These values are planning defaults, not production commitments or completed attestations.

## Generate the execution-disabled Container Apps profile

```bash
./scripts/startup-container-apps-cool-plan.sh generate \
  --foundation-plan .sslz/generated/my-plan/cool-foundation/cool-foundation-plan.json \
  --profile-input agent/examples/container-apps-cool-profile-input.json \
  --output-dir .sslz/generated/my-plan/cool-container-apps
```

The profile planner accepts only an exact nonproduction cool foundation whose gates and artifact digests still pass. It
then produces provider-equivalent Bicep and Terraform parameter artifacts, source and decision digests, and durable
execution-disabled manifests. Direct validation rejects mutable image tags, secret values, unversioned Key Vault
references, wrong identity or RBAC scope, primary scope/state reuse, overlapping address spaces, wrong profile subnet,
incomplete probes, external ingress, and production/global/data failover settings.

The minimum footprint is one internal Container Apps environment on a dedicated nondelegated `/23` subnet and one
single-revision app pinned to an image digest. It may scale to zero or retain one idle replica; that assumption must match
the reviewed cost evidence. Startup, readiness, and liveness probes, workspace diagnostics, configuration parity, scoped
identity access, rollback, cleanup, and recovery measurements are blocking. The checked-in example intentionally retains
`not-measured`, null RTO, and null RPO placeholders, which cannot auto-pass.

Generated files use nonpersonal `example.invalid` contact placeholders unless a protected contacts file is supplied.
For deployable previews, create an owner-only JSON file outside the repository:

```json
{
  "budgetAlertEmails": ["cloud-operations@contoso.example"],
  "securityContactEmail": "security-operations@contoso.example"
}
```

Pass its absolute path with `--notification-contacts-file`. Contact values are written only to the ignored local
parameter artifacts required by Azure; summaries, results, replay state, and command output retain only their digest.
Secrets, connection strings, tokens, private keys, credentials, personal email addresses in the main planner input, and
secure parameter values are rejected.

## Digest and approval

The planner canonicalizes object keys and computes a SHA-256 digest over all approval-bound decisions:

- tenant and environment subscriptions;
- compute profile and profile extensions;
- regional mode, primary and optional secondary region, and regional network CIDRs;
- planned services and paid Defender selections;
- the Defender workspace decision, effective region, placement mode, scope/reference digests, tenant/subscription-scoped policy evidence
  digest/expiry, and paid-plan selection digest;
- deployment and cost assumptions;
- proposed manual, support, and information actions;
- explicit Terraform remote-backend coordinates, including the backend subscription.
- the readiness evidence version, opaque artifact ID, canonical digest, issue time, and expiry.
- the topology decision ID, digest, expiry, tenant, and exact environment-to-subscription mapping.

Approval metadata contains the immutable plan ID and digest. If either value changes, an earlier approval is replaced
with `pending`, `reapprovalRequired` is true, and the summary records why it was invalidated.
An approved Phase 4 input must include a non-null expiry no more than 24 hours after approval; expired or overlong
approvals are rejected. Phase 5 provider remediation uses a separate single-use action approval.

Only v3 inputs can carry approval-eligible readiness evidence. The planner validates its self-digest, current freshness,
embedded topology self-digest and freshness, exact tenant/environment subscription mapping, benefit-target consistency,
plan/profile/region scope, explicit human confirmations, recovery measurements, service tests, cost provenance, and
conditional Foundry evidence. It also requires an unchanged ready Defender workspace decision whenever Defender for
Servers is enabled. Generated Bicep and Terraform parameters select the same explicit workspace region or approved
existing resource ID; neither provider may fall back to a default region. Legacy v1/v2 inputs remain representable for
compatibility, but their approval is forced to
`pending` with `readiness-evidence-required`.

Phase 7 readiness additionally requires the cost ceiling, exercise cadence/status, owner role/reference, external
reviews, and billing/support confirmation. The generated approval binding remains pending and cannot authorize
execution.

The Container Apps increment adds another pending approval binding but still exposes no executor. Even a
`ready-for-review` profile cannot deploy, change traffic or DNS, register providers, replicate data, or claim end-to-end
recovery.

## Read-only previews

Use previews only in an environment that already has the required tools and authentication:

```bash
./scripts/startup-iac-plan.sh generate \
  --input <iac-plan-input.json> \
  --provider both \
  --output-dir .sslz/generated/my-plan \
  --preview \
  --notification-contacts-file /protected/sslz-notification-contacts.json
```

Bicep runs subscription-scope what-if. Complete-mode semantics are not accepted. Terraform initializes the explicitly
configured `azurerm` remote backend in its bound subscription with Azure AD data-plane authentication and runs plan;
local shared state is not accepted. The planner does not create the backend or configure credentials.

The retained summary contains only deterministic change counts, destructive-change classification, and a bounded
error class. Raw tool text, environment variables, and account output are not retained. To preserve raw output for an
approved local or CI diagnostic workflow, explicitly provide a path inside the selected output directory:

```bash
--raw-artifact-dir .sslz/generated/my-plan/raw
```

`--raw-artifact-dir` requires `--notification-contacts-file`. That directory remains ignored by Git. Existing raw files
are never overwritten.
Phase 6 Terraform apply requires this option because it applies the exact saved `<environment>-primary.tfplan` from
the reviewed preview and never recalculates a plan. Raw Terraform plan generation also requires an Ed25519 builder key:

```bash
export SSLZ_TERRAFORM_PROVENANCE_PRIVATE_KEY_FILE=/protected/sslz-terraform-builder.key
export SSLZ_TERRAFORM_EXECUTABLE=/opt/hashicorp/terraform
```

The planner copies the Terraform root, lock file, controlled CLI configuration, and generated parameter artifact into
a random owner-only build snapshot. It resolves Terraform only from a trusted absolute non-link path, runs `init`, `plan`,
and `show` only there, and signs the executable digest, source, parameter, backend, provider-lock, saved-plan,
platform/version, configuration, planned-values, variables, and resource-change digests, then
writes `<environment>-primary.provenance.json` beside the saved plan and removes the snapshot. Phase 6 trusts only the
matching provisioned public key.

## Safety boundary

- no deployment or Terraform apply command exists;
- no provider registration, role assignment, billing change, or resource write is performed;
- destructive preview results are blocked for review;
- generated paths cannot escape `.sslz/generated/`;
- non-generated files are not overwritten;
- generated parameter artifacts remain ignored and are not committed.

Deployment is a separate signed-approval command. See
[Approved Deployment Integration](approved-deployment-integration.md).
