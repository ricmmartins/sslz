---
layout: page
title: "Approved Provider Remediation"
nav_order: 8.5
description: "Single-use approval for one allowlisted Azure resource-provider registration"
---

# Approved Provider Remediation

## Purpose

Phase 5 adds the first write-capable startup-agent command. Its complete Azure write surface is one
subscription-scoped `az provider register` for a namespace required by the selected workload profile. It does not
deploy infrastructure or change roles, subscriptions, features, policies, billing, entitlements, domains, or resource
configuration.

The contracts are:

- [`provider-remediation-approval.schema.json`](../agent/schemas/provider-remediation-approval.schema.json)
- [`provider-remediation-result.schema.json`](../agent/schemas/provider-remediation-result.schema.json)

## Reviewed action

The Phase 4 input must contain the exact provider action before its canonical plan digest is calculated:

```json
{
  "id": "provider.register.prod.microsoft-app",
  "type": "azureWrite",
  "operation": "provider.register",
  "namespace": "Microsoft.App",
  "subscriptionId": "22222222-2222-2222-2222-222222222222",
  "region": null,
  "scope": "/subscriptions/22222222-2222-2222-2222-222222222222",
  "summary": "Register Microsoft.App for the reviewed production profile."
}
```

The namespace must come from `providerNamespaces` in the selected compute profile or extension. The initial static
profile-derived allowlist is `Microsoft.App`, `Microsoft.ContainerService`, `Microsoft.CognitiveServices`,
`Microsoft.DBforPostgreSQL`, and `Microsoft.Compute`. A namespace from another profile is rejected even if it is in
the global static set.

## Dry run

```bash
./scripts/startup-provider-remediation.sh dry-run \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --action provider.register.prod.microsoft-app \
  --output text
```

Dry run performs no Azure call and writes no local replay state. It recomputes the canonical plan digest, confirms
that the unchanged action occurs exactly once, validates the exact subscription scope, checks the selected-profile
allowlist, and prints the same sanitized Azure CLI argument array that apply would execute.

## Approval artifact

Apply requires a separate artifact from the approved review system. The artifact binds:

- plan version, ID, and canonical digest;
- action ID and `azureWrite` type;
- the fixed `provider.register` operation;
- namespace, subscription ID, and exact subscription scope;
- approval and expiry timestamps;
- a canonical SHA-256 digest over every artifact field except `approvalDigest`.

The artifact stores no approval identity. It must be `approved`, not expired, approved no more than 24 hours before
expiry, and unused. See
[`provider-registration-approval.json`](../agent/examples/provider-registration-approval.json) for the schema shape.
The approval system, not this repository, is responsible for authenticating and authorizing the approval decision.

## Apply

```bash
./scripts/startup-provider-remediation.sh apply \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --action provider.register.prod.microsoft-app \
  --approval <approved-provider-registration.json> \
  --output json
```

Apply reserves the approval atomically beneath `.sslz/remediation-state/`, which is ignored by Git. It then:

1. reads the explicitly selected subscription and verifies its exact subscription ID, tenant ID, and enabled state;
2. reads the provider state and succeeds without a write when it is already `Registered`;
3. executes exactly one `az provider register --subscription ... --namespace ... --wait --output none`;
4. immediately reads the provider and requires the exact namespace to be `Registered`;
5. consumes the approval for success or failure and stops.

Concurrent or repeated use of the same approval is rejected. A registration or verification failure retains only
allowlisted structured state, performs no second write, and requires a new reviewed plan and approval. Raw Azure CLI
stdout, stderr, environment variables, secrets, and personal data are not retained in results or replay state.

## Privilege boundary

The caller needs only permission to read the target subscription and provider state and register providers on that
subscription. Use a purpose-built role containing the minimum required provider registration action where possible.
The command never selects a default subscription and supplies `--subscription` to every Azure CLI operation.

Disable apply by removing access to `startup-provider-remediation.sh`; manual provider registration remains the
rollback path. The Bicep and Terraform deployment commands are not called by this phase.
