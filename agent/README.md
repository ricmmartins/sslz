# SSLZ Agent Contracts

This directory contains the versioned, machine-readable contracts for the startup agent flow. The additive startup
preflight consumes these contracts and performs Azure reads only.

## Contents

| Path | Purpose |
|---|---|
| `schemas/startup-input.schema.json` | Founder and workload planning input |
| `schemas/preflight-result.schema.json` | Account, workload, and regional check result |
| `schemas/deployment-plan.schema.json` | Reviewable SSLZ deployment plan |
| `checks/check-catalog.json` | Stable check IDs and official documentation |
| `examples/` | Sanitized ready, blocked, and input examples |

## Validate locally

```bash
node scripts/validate-agent-contracts.mjs
node tests/startup-preflight.mjs
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

## Safety boundary

Only `inspect` is implemented. Domain and secondary-administrator checks return `unknown` when Microsoft Graph
evidence is unavailable. Startup-credit association remains blocking until it is confirmed through authoritative
billing or Microsoft for Startups support evidence.
