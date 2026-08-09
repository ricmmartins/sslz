---
layout: page
title: "IaC Plan Generation"
nav_order: 8.4
description: "Digest-bound local Bicep and Terraform review inputs"
---

# IaC Plan Generation

## Purpose

Phase 4 converts a ready workload profile and eligible regional recommendation into reviewable inputs for the
existing SSLZ Bicep and Terraform roots. It does not add workload modules, change the manual deployment workflows, or
run an Azure or Terraform write operation.

The input and output contracts are:

- [`agent/schemas/iac-plan-input.schema.json`](../agent/schemas/iac-plan-input.schema.json)
- [`agent/schemas/iac-plan-summary.schema.json`](../agent/schemas/iac-plan-summary.schema.json)

## Generate review inputs

```bash
./scripts/startup-iac-plan.sh generate \
  --input <iac-plan-input.json> \
  --provider both \
  --output-dir .sslz/generated/my-plan
```

The output directory must be `.sslz/generated` or one of its descendants. The command writes:

- one `.local.bicepparam` per environment and requested regional role;
- one `.auto.tfvars` per environment and requested regional role;
- `plan-summary.json`, containing the canonical decisions, artifact paths, preview classification, digest, and
  approval state.

Only primary files are generated for `single-region-ready`. A reviewed `cool-infrastructure` or `warm-workload`
recommendation generates distinct primary and secondary representations with the recommended region and nonoverlapping
VNet CIDR. Secondary files remain representation-only because the existing roots also contain subscription-global
resources and do not yet provide collision-free multi-region naming. The planner never previews a secondary file as
an independent root or state.

Generated files use nonpersonal `example.invalid` contact placeholders. Replace them only in the ignored local files
when an authenticated preview requires the real notification contacts. Secrets, connection strings, tokens, private
keys, credentials, personal email addresses, and secure parameter values are rejected as planner input.

## Digest and approval

The planner canonicalizes object keys and computes a SHA-256 digest over all approval-bound decisions:

- tenant and environment subscriptions;
- compute profile and profile extensions;
- regional mode, primary and optional secondary region, and regional network CIDRs;
- planned services and paid Defender selections;
- deployment and cost assumptions;
- proposed manual, support, and information actions;
- explicit Terraform remote-backend coordinates.

Approval metadata contains the immutable plan ID and digest. If either value changes, an earlier approval is replaced
with `pending`, `reapprovalRequired` is true, and the summary records why it was invalidated.
An approved Phase 4 input must include a non-null expiry no more than 24 hours after approval; expired or overlong
approvals are rejected. Phase 5 provider remediation uses a separate single-use action approval.

## Read-only previews

Use previews only in an environment that already has the required tools and authentication:

```bash
./scripts/startup-iac-plan.sh generate \
  --input <iac-plan-input.json> \
  --provider both \
  --output-dir .sslz/generated/my-plan \
  --preview
```

Bicep runs subscription-scope what-if. Complete-mode semantics are not accepted. Terraform initializes the explicitly
configured `azurerm` remote backend and runs plan; local shared state is not accepted. The planner does not create the
backend or configure credentials.

The retained summary contains only deterministic change counts, destructive-change classification, and a bounded
error class. Raw tool text, environment variables, and account output are not retained. To preserve raw output for an
approved local or CI diagnostic workflow, explicitly provide a path inside the selected output directory:

```bash
--raw-artifact-dir .sslz/generated/my-plan/raw
```

That directory remains ignored by Git. Existing raw files are never overwritten.

## Safety boundary

- no deployment or Terraform apply command exists;
- no provider registration, role assignment, billing change, or resource write is performed;
- destructive preview results are blocked for review;
- generated paths cannot escape `.sslz/generated/`;
- non-generated files are not overwritten;
- generated parameter artifacts remain ignored and are not committed.
