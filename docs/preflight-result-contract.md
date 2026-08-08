---
layout: page
title: "Preflight Result Contract"
nav_order: 8.1
description: "Machine-readable contract for agent-assisted SSLZ planning"
---

# Preflight Result Contract

## Status

The JSON schemas, check catalog, and sanitized examples are implemented under [`agent/`](../agent/).
[`scripts/startup-preflight.sh`](../scripts/startup-preflight.sh) implements the additive, read-only `inspect` mode.
[`scripts/startup-workload-plan.sh`](../scripts/startup-workload-plan.sh) implements the local-only workload profile
planner defined by
[`workload-profile-plan.schema.json`](../agent/schemas/workload-profile-plan.schema.json).
[`scripts/startup-regional-plan.sh`](../scripts/startup-regional-plan.sh) evaluates supplied, timestamped regional
evidence against
[`regional-capacity-plan.schema.json`](../agent/schemas/regional-capacity-plan.schema.json).
The existing SSLZ prerequisite command remains unchanged.

Validate the contract assets locally:

```bash
node scripts/validate-agent-contracts.mjs
node tests/startup-preflight.mjs
node tests/startup-workload-plan.mjs
node tests/startup-regional-plan.mjs
```

The workload profile plan is intentionally separate from `deployment-plan.schema.json`: Phase 2 selects and explains
a profile but does not generate IaC, preview artifacts, deployment services, or approval digests.

The regional capacity plan is also separate from `deployment-plan.schema.json`. It ranks evidence-backed candidates,
keeps quota and point-in-time capacity as distinct classifications, and reports `iacGenerated: false` and
`azureOperations: "none"`. A capacity observation is not a reservation.

## Purpose

The preflight result lets an agent, CLI, or user interface consume the same facts without parsing terminal text. It
must be deterministic, safe to retain for troubleshooting, and useful without granting the consumer write access.

The contract separates:

- facts observed in Azure;
- conclusions made by a check;
- actions the user can approve;
- actions that require Microsoft support or manual administration;
- the infrastructure plan generated after blocking checks pass.

## Compatibility

- `schemaVersion` uses semantic versioning.
- Additive optional fields require a minor version.
- Removing or changing a field requires a major version.
- Consumers must reject unsupported major versions.
- Check IDs are stable once published.
- Human-readable text can change without a schema-version change.

## Top-level result

| Field | Type | Required | Description |
|---|---|---:|---|
| `schemaVersion` | string | Yes | Contract version, such as `1.0.0` |
| `runId` | string | Yes | Unique identifier for this preflight run |
| `generatedAt` | string | Yes | UTC timestamp in RFC 3339 format |
| `mode` | enum | Yes | `inspect`, `plan`, or `apply` |
| `overallStatus` | enum | Yes | `pass`, `warning`, `blocked`, or `error` |
| `target` | object | Yes | Intended tenant, subscriptions, and regions |
| `checks` | array | Yes | Ordered check results |
| `actions` | array | Yes | Proposed automatic, manual, or support actions |
| `deploymentPlan` | object or null | Yes | Reviewable plan, populated only when planning succeeds |
| `approval` | object | Yes | Whether a specific plan requires approval |
| `summary` | object | Yes | Counts by check status and action type |

## Modes

| Mode | Azure reads | Azure writes | Intended use |
|---|---:|---:|---|
| `inspect` | Yes | No | Discover account and workload readiness |
| `plan` | Yes | No | Produce remediation and infrastructure plans |
| `apply` | Yes | Approved actions only | Execute a previously approved, unchanged plan |

Running in `apply` mode does not imply permission to perform every proposed action. Each action has its own approval
and automation classification.

## Check result

```json
{
  "id": "account.subscription.tenant-match",
  "category": "account",
  "status": "pass",
  "severity": "blocking",
  "summary": "The selected subscriptions belong to the intended tenant.",
  "evidence": {
    "tenantId": "<tenant-id>",
    "subscriptionIds": ["<prod-id>", "<nonprod-id>"]
  },
  "remediationActionIds": [],
  "documentationUrl": "https://learn.microsoft.com/startups/build/azure-getting-started/set-up-account"
}
```

### Check fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | Yes | Stable, namespaced check identifier |
| `category` | enum | Yes | Check area such as `account`, `billing`, `quota`, or `region` |
| `status` | enum | Yes | `pass`, `warning`, `fail`, `unknown`, `skipped`, or `error` |
| `severity` | enum | Yes | `blocking`, `high`, `medium`, `low`, or `info` |
| `summary` | string | Yes | Short result that states what was observed |
| `evidence` | object | Yes | Minimal structured facts supporting the result |
| `remediationActionIds` | array | Yes | IDs of proposed actions that address the result |
| `documentationUrl` | string | Yes | Official documentation for the check |
| `error` | object | No | Safe error details when `status` is `error` |

`unknown` is not success. A blocking check with `unknown`, `fail`, or `error` status prevents the deployment plan
from being approved.

## Action result

```json
{
  "id": "provider.register.microsoft-app",
  "type": "azureWrite",
  "status": "proposed",
  "summary": "Register the Microsoft.App resource provider.",
  "automatic": true,
  "approvalRequired": true,
  "risk": "low",
  "scope": "/subscriptions/<subscription-id>",
  "commandPreview": "az provider register --namespace Microsoft.App",
  "documentationUrl": "https://learn.microsoft.com/azure/azure-resource-manager/management/..."
}
```

### Action types

| Type | Meaning |
|---|---|
| `azureWrite` | The agent can perform an Azure write after approval |
| `manual` | A user must complete the action in an authenticated Microsoft experience |
| `support` | Microsoft support or program support must resolve the issue |
| `information` | No change is required; the action communicates a decision or trade-off |

### Action states

`proposed`, `approved`, `running`, `succeeded`, `failed`, `declined`, and `notApplicable`.

An action marked `automatic: true` is technically automatable. It still cannot run when `approvalRequired` is true
until the user approves the exact plan that contains it.

## Deployment plan

The deployment plan records decisions, not secrets or complete IaC output.

```json
{
  "planId": "plan-identifier",
  "planDigest": "sha256:...",
  "profile": "container-apps",
  "environments": [
    {
      "name": "prod",
      "subscriptionId": "<prod-id>",
      "primaryRegion": "eastus2",
      "secondaryRegion": "centralus",
      "regionalMode": "hot-cool"
    }
  ],
  "services": [
    {
      "type": "Microsoft.App/managedEnvironments",
      "region": "eastus2",
      "purpose": "application compute"
    }
  ],
  "estimatedMonthlyPlatformCost": {
    "currency": "USD",
    "minimum": 0,
    "maximum": 100,
    "assumptions": ["Application usage charges are excluded."]
  },
  "iac": {
    "provider": "bicep",
    "previewType": "what-if",
    "previewArtifact": "relative/path/to/sanitized-summary.json"
  }
}
```

The plan digest binds approval to the selected subscriptions, regions, profile, services, paid plans, and proposed
actions. Recalculate the plan and request approval again if any of those values change.

## Approval

```json
{
  "required": true,
  "status": "pending",
  "planId": "plan-identifier",
  "planDigest": "sha256:...",
  "approvedAt": null,
  "expiresAt": null
}
```

The result must not store personal approval identity unless the surrounding platform has an approved audit system.
The agent should rely on that platform for authentication and audit records.

## Overall status rules

| Overall status | Rule |
|---|---|
| `pass` | All blocking checks pass and no unresolved high-severity action exists |
| `warning` | Blocking checks pass, but nonblocking warnings remain |
| `blocked` | A blocking check is `fail`, `unknown`, or `error` |
| `error` | The preflight itself could not produce a trustworthy result |

Skipped checks must include a reason in `evidence`. A check cannot be skipped merely because the agent lacks
permission; use `unknown` and propose the permission or support action instead.

## Error classification

| Error class | Example | Result |
|---|---|---|
| `configuration` | Wrong tenant or subscription | Blocking check and manual remediation |
| `permission` | Missing policy or billing-reader access | Blocking or warning based on selected modules |
| `billing` | Credit context is not visible | Blocking unknown and manual or support action |
| `entitlement` | Credits or benefits require transfer | Blocking support action |
| `quota` | Regional quota is insufficient | Blocking action to request quota or change region |
| `capacity` | Azure cannot currently allocate the selected SKU | Blocking alternative-region or SKU action |
| `availability` | A required service or model is unavailable in the region | Blocking region or design change |
| `policy` | Allowed-location policy rejects the target region | Blocking policy or region action |
| `transient` | Read request is throttled | Retry with bounded backoff, then return `error` |

Do not collapse these classes into a generic deployment or support failure.

## Data minimization

The output can include tenant IDs, subscription IDs, region names, resource-provider states, role names, quota
numbers, and selected service types.

The output must not include:

- access or refresh tokens;
- client secrets, certificates, keys, or connection strings;
- full billing records or payment methods;
- personal email addresses unless an approved user interface requires them;
- full Azure CLI error bodies when they contain request headers or account data;
- IaC parameter values marked secure;
- raw environment variables.

Redact sensitive values before writing artifacts or logs. A redaction failure makes the overall result `error`.

## Initial check identifiers

| ID | Category | Blocking |
|---|---|---:|
| `account.authentication.active` | account | Yes |
| `account.subscription.explicit-selection` | account | Yes |
| `account.subscription.tenant-match` | account | Yes |
| `identity.secondary-admin.present` | identity | Yes |
| `identity.company-domain.verified` | identity | Yes |
| `identity.deployment-role.sufficient` | identity | Yes |
| `billing.startup-credit.context-visible` | billing | Yes |
| `billing.subscription.credit-association` | billing | Yes |
| `account.provider.required-registrations` | account | Yes |
| `quota.workload.headroom` | quota | Yes |
| `region.services.available` | region | Yes |
| `region.skus.eligible` | region | Yes |
| `region.foundry-model.available` | region | When Foundry is selected |
| `security.defender.selection-reviewed` | security | Yes |
| `operations.monitoring.destination-valid` | operations | Yes |

## Example blocked result

```json
{
  "schemaVersion": "1.0.0",
  "runId": "run-identifier",
  "generatedAt": "2026-08-06T12:00:00Z",
  "mode": "plan",
  "overallStatus": "blocked",
  "target": {
    "tenantId": "<tenant-id>",
    "prodSubscriptionId": "<prod-id>",
    "nonprodSubscriptionId": "<nonprod-id>",
    "primaryRegion": "eastus2",
    "secondaryRegion": null
  },
  "checks": [
    {
      "id": "billing.subscription.credit-association",
      "category": "billing",
      "status": "unknown",
      "severity": "blocking",
      "summary": "The preflight cannot confirm that startup credits apply to both target subscriptions.",
      "evidence": {
        "reason": "The signed-in identity cannot read the billing profile."
      },
      "remediationActionIds": ["billing.verify-credit-association"],
      "documentationUrl": "https://learn.microsoft.com/startups/build/azure-getting-started/set-up-account"
    }
  ],
  "actions": [
    {
      "id": "billing.verify-credit-association",
      "type": "manual",
      "status": "proposed",
      "summary": "Verify the credit and billing-profile association before deploying.",
      "automatic": false,
      "approvalRequired": false,
      "risk": "medium",
      "scope": null,
      "commandPreview": null,
      "documentationUrl": "https://learn.microsoft.com/startups/build/azure-getting-started/set-up-account"
    }
  ],
  "deploymentPlan": null,
  "approval": {
    "required": false,
    "status": "notApplicable",
    "planId": null,
    "planDigest": null,
    "approvedAt": null,
    "expiresAt": null
  },
  "summary": {
    "checks": {"pass": 0, "warning": 0, "fail": 0, "unknown": 1, "skipped": 0, "error": 0},
    "actions": {"azureWrite": 0, "manual": 1, "support": 0, "information": 0}
  }
}
```

## Acceptance criteria

The first implementation of this contract must:

1. emit valid JSON without changing Azure in `inspect` and `plan` modes;
2. produce identical status semantics for the same mocked Azure responses;
3. reject unsupported major versions;
4. prevent plan creation when blocking checks are unresolved;
5. bind approval to a stable plan digest;
6. redact sensitive values before output;
7. include an official documentation URL for every check and action;
8. preserve the existing human-readable preflight output by default.
