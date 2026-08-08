# SSLZ Agent Contracts

This directory contains the versioned, machine-readable contracts for the startup agent flow. The additive startup
preflight performs Azure reads only. The workload planner reads local JSON only and makes no Azure calls.

## Contents

| Path | Purpose |
|---|---|
| `schemas/startup-input.schema.json` | Founder and workload planning input |
| `schemas/preflight-result.schema.json` | Account, workload, and regional check result |
| `schemas/deployment-plan.schema.json` | Reviewable SSLZ deployment plan |
| `schemas/workload-profile-plan.schema.json` | Read-only workload profile selection |
| `checks/check-catalog.json` | Stable check IDs and official documentation |
| `profiles/` | Versioned compute and extension decision data |
| `examples/` | Sanitized ready, blocked, and input examples |

## Validate locally

```bash
node scripts/validate-agent-contracts.mjs
node tests/startup-preflight.mjs
node tests/startup-workload-plan.mjs
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

## Safety boundary

The account preflight implements only `inspect`. Domain and secondary-administrator checks return `unknown` when
Microsoft Graph evidence is unavailable. Startup-credit association remains blocking until it is confirmed through
authoritative billing or Microsoft for Startups support evidence. Workload planning is a separate local-only command;
regional availability, quota, capacity, and IaC generation remain later phases.
