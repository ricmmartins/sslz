# SSLZ Agent Contracts

This directory contains the versioned, machine-readable contracts for the startup agent flow. The additive startup
preflight performs Azure reads only. The workload and regional planners read local JSON only and make no Azure calls.
The IaC planner writes ignored local review inputs and can optionally run read-only previews.

## Contents

| Path | Purpose |
|---|---|
| `schemas/startup-input.schema.json` | Founder and workload planning input |
| `schemas/preflight-result.schema.json` | Account, workload, and regional check result |
| `schemas/deployment-plan.schema.json` | Reviewable SSLZ deployment plan |
| `schemas/workload-profile-plan.schema.json` | Read-only workload profile selection |
| `schemas/regional-planning-input.schema.json` | Timestamped, supplied regional evidence |
| `schemas/regional-capacity-plan.schema.json` | Read-only regional and capacity recommendation |
| `schemas/iac-plan-input.schema.json` | Profile, regional recommendation, target, and deployment decisions |
| `schemas/iac-plan-summary.schema.json` | Sanitized parameter, preview, digest, and approval summary |
| `checks/check-catalog.json` | Stable check IDs and official documentation |
| `profiles/` | Versioned compute and extension decision data |
| `examples/` | Sanitized ready, blocked, and input examples |

## Validate locally

```bash
node scripts/validate-agent-contracts.mjs
node tests/startup-preflight.mjs
node tests/startup-workload-plan.mjs
node tests/startup-regional-plan.mjs
node tests/startup-iac-plan.mjs
```

Validation and fixture tests use Node.js built-in modules and require no package installation, Azure login, or Azure
permissions.

## Inspect an Azure account

```bash
./scripts/startup-preflight.sh inspect \
  --prod-subscription <subscription-id> \
  --nonprod-subscription <subscription-id> \
  --output text
```

Use `--output json` for the contract defined by `schemas/preflight-result.schema.json`. The command never registers a
provider, assigns a role, changes billing, or deploys resources.

## Plan a workload profile

```bash
./scripts/startup-workload-plan.sh plan \
  --input agent/examples/startup-input.json \
  --output json
```

The deterministic result selects Container Apps by default, records any justified AKS or extension choice, lists
required checks and unresolved decisions, and reports cost assumptions. It exits with `1` for a blocked or
architecture-review result and `2` for invalid input. It does not authenticate to Azure, generate IaC, or write files.

## Plan regions and capacity

```bash
./scripts/startup-regional-plan.sh plan \
  --input agent/examples/regional-planning-input.json \
  --output json
```

The planner evaluates only the supplied, timestamped evidence. It ranks primary candidates, applies the same
selected-profile checks to an optional secondary candidate, and keeps quota distinct from point-in-time capacity.
Only a current `single-region-ready` result is executable readiness. Cool and warm requests remain review-only.
Exit status is `0` only for executable readiness, `1` for blocked or review-required output, and `2` for invalid input.

## Generate local IaC review inputs

```bash
./scripts/startup-iac-plan.sh generate \
  --input <iac-plan-input.json> \
  --provider both \
  --output-dir .sslz/generated/my-plan
```

The command derives Bicep and Terraform parameters from one canonical decision model. It writes only beneath
`.sslz/generated/`, which is ignored by Git, and emits a stable SHA-256 digest plus approval metadata. A changed
approval-bound decision invalidates a supplied approval. Add `--preview` to run only Bicep what-if or Terraform plan.
Terraform preview requires the input's explicit `azurerm` remote-backend coordinates and ambient authentication; the
planner does not create a backend or credentials.

## Safety boundary

The account preflight implements only `inspect`. Domain and secondary-administrator checks return `unknown` when
Microsoft Graph evidence is unavailable. Startup-credit association remains blocking until it is confirmed through
authoritative billing or Microsoft for Startups support evidence. Workload and regional planning are separate
local-only commands. The regional planner does not reserve capacity, create parameter files, generate IaC, or perform
Azure operations. IaC generation is a separate command with no deployment, remediation, provider-registration, role,
or billing operation.
