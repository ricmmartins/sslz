---
layout: page
title: "Approved Deployment Integration"
nav_order: 8.6
description: "Signed single-use approval for one immutable existing SSLZ platform deployment"
---

# Approved Deployment Integration

## Purpose

Phase 6 is the only landing-zone write path exposed by `deploy-bicep.yml` and `deploy-terraform.yml`. Both workflows are
manual-dispatch-only wrappers over the existing `infra/bicep` and `infra/terraform` roots and require protected
self-hosted runners. Phase 6 does not deploy workload modules, register providers, change roles outside the existing
root, or add a second region. Only an approved primary `single-region-ready` platform baseline is executable.

The versioned contracts are:

- [`iac-plan-input-v2.schema.json`](../agent/schemas/iac-plan-input-v2.schema.json)
- [`iac-plan-input-v3.schema.json`](../agent/schemas/iac-plan-input-v3.schema.json)
- [`readiness-evidence.schema.json`](../agent/schemas/readiness-evidence.schema.json)
- [`aks-ingress-decision.schema.json`](../agent/schemas/aks-ingress-decision.schema.json)
- [`aks-ingress-postcheck.schema.json`](../agent/schemas/aks-ingress-postcheck.schema.json)
- [`subscription-topology-decision.schema.json`](../agent/schemas/subscription-topology-decision.schema.json)
- [`deployment-execution-manifest.schema.json`](../agent/schemas/deployment-execution-manifest.schema.json)
- [`deployment-approval.schema.json`](../agent/schemas/deployment-approval.schema.json)
- [`deployment-result.schema.json`](../agent/schemas/deployment-result.schema.json)
- [`regional-attempt.schema.json`](../agent/schemas/regional-attempt.schema.json)
- [`terraform-plan-provenance.schema.json`](../agent/schemas/terraform-plan-provenance.schema.json)

## Prepare the reviewed Phase 4 artifact

Generate an approved Phase 4 plan with a real command preview. Terraform requires an explicit raw-artifact directory so
the reviewed saved plan is available:

Use the `3.0.0` IaC input contract for plans intended for Phase 6. It requires the exact remote-backend subscription and
the current readiness-evidence artifact. Versions `1.0.0` and `2.0.0` remain accepted by the standalone Phase 4 planner
for compatibility but are not eligible for approved execution.

```bash
SSLZ_TERRAFORM_PROVENANCE_PRIVATE_KEY_FILE=/protected/sslz-terraform-builder.key \
SSLZ_TERRAFORM_EXECUTABLE=/opt/hashicorp/terraform \
./scripts/startup-iac-plan.sh generate \
  --input <approved-iac-plan-input.json> \
  --provider terraform \
  --output-dir .sslz/generated/my-plan \
  --preview \
  --raw-artifact-dir .sslz/generated/my-plan/raw \
  --notification-contacts-file /protected/sslz-notification-contacts.json
```

The Phase 6 preview rejects fixture, missing, failed, destructive, secondary-region, expired, or changed Phase 4
artifacts. Resource Manager and Storage Defender selections must be `true` because both existing SSLZ roots currently
deploy those plans as Standard.

Terraform also requires the builder-signed provenance emitted by Phase 4. It proves that the exact saved plan was
generated inside an atomic protected snapshot of the reviewed source, parameters, backend, provider lock, Terraform
executable digest and platform/version, and complete plan semantics. Preview and apply must resolve the exact same
Terraform executable digest through `SSLZ_TERRAFORM_EXECUTABLE` or a documented trusted installation path.

## Zero-write preview

```bash
SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE=/protected/sslz-terraform-builder.pub \
./scripts/startup-deployment-integration.sh preview \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --provider terraform \
  --environment prod \
  --output json
```

Preview performs no Azure or local write. It:

1. validates the approved Phase 4 plan, readiness artifact and topology decision digests/scopes/freshness, and expiry;
2. selects exactly one primary provider and environment;
3. hashes the complete plan artifact, selected parameters, current SSLZ source tree, controlled Terraform CLI
   configuration, and Terraform lock file;
4. compiles and semantically inspects the exact Bicep source and concrete parameter values before rerunning what-if, or
   inspects the exact saved Terraform plan;
5. rejects destructive or unclassified changes; Bicep resources outside the exact existing type/count/scope graph,
   external templates/modules, deployment scripts, or unexpected role/principal bindings; and any Terraform provider,
   external module, provisioner/action hook, resource address/type, role, managed-identity principal, or subscription
   scope outside the existing SSLZ graph;
6. emits a byte-deterministic immutable manifest inside the sanitized result.

The same validation rechecks the Defender workspace decision and binds its ID/digest, effective region, placement mode,
scope/reference digest, policy-evidence digest/freshness, and paid-plan selection digest. Missing fields, changed or stale
evidence, default-region fallback, or a tenant/subscription mismatch fails before execution is accepted.

Raw what-if, Terraform JSON, environment values, contact values, and approval identities are discarded. Only hashes,
change counts, fixed commands, targets, and schema-defined status are retained. Bicep local modules must resolve inside
the approved source snapshot; imports, registry/template-spec modules, dynamic file/environment reads, copy loops,
external templates, and cross-subscription scopes are rejected. The manifest binds the compiled template, concrete
parameters, and exact semantic resource graph digests. For Terraform, it includes a semantic attestation of the
canonical configuration, provider graph, planned values, changes, variables, exact resource graph/scopes, backend,
source, parameters, and saved plan. The review system stores the nested `manifest` as the reviewed deployment-manifest
artifact, and its signature binds every attestation digest.

The manifest and approval expose a dedicated privacy-preserving digest of the budget and security notification
recipients. Before signing, the approval service must recompute that digest from its authorization-controlled recipient
policy and reject any mismatch. This permits real contacts without writing personal addresses into the manifest,
approval, result, audit state, or logs.

## Trusted approval

Apply accepts only an Ed25519-signed approval. The signed payload uses canonical JSON with sorted object keys, excludes
only `signature`, and is prefixed with `sslz-deployment-approval-v1` plus a NUL byte. `keyId` is the SHA-256 digest of
the trusted public key's SPKI DER representation.

The approval duplicates and binds the manifest digest, plan identity, readiness evidence version/opaque ID/digest/expiry,
topology decision ID/digest/expiry and exact environment mapping, provider, environment, primary region, tenant,
subscription, exact subscription scope, protected durable-store identity, parameter/source/saved-plan hashes, Terraform
authentication choice, notification-recipient commitment, unique nonce, and validity window. The window cannot exceed
24 hours. It also duplicates every Defender workspace binding from the manifest, so omission or mutation invalidates the
signature and replay record.

For AKS plans, the manifest and signed approval also duplicate the ingress mode, normalized decision digest, and expected
postcheck digest. Omission, mutation, mode switching, or replay against a different ingress mapping fails before any
write. Planning postchecks contain only `not-observed` placeholders. Acceptance or recovery requires fresh supplied
health and TCP/HTTP reachability evidence with timestamps and an opaque reference; deployment output alone is not a live
connectivity claim.

The approval also binds the regional attempt ID, attempt digest and number, original and target regions, and reviewed
Terraform state key. Switching regions therefore invalidates the prior manifest and approval even if every other target
field is unchanged.

## Regional failure, cleanup, and replan

Regional attempts form an append-only `1.0.0` chain. Each attempt records its original and target region, attempt number,
plan and artifact digests, deterministic deployment/resource/policy names, Terraform state/workspace identity, immutable
failure-evidence hash, and lifecycle state. Bicep and Terraform derive the same attempt key, while retaining
provider-specific artifact roots.

After a deployment write starts, a failure moves the attempt to `cleanup-required`. Preserve the original sanitized
failure evidence and perform only a reviewed, bounded cleanup of resources proven to belong to that attempt. There is no
automatic rollback and no broad resource-group deletion. A failed cleanup remains visible and blocks both replan and
alternate-region execution. Only a successful cleanup record can move the chain to `cleaned` and permit `replanned`.

Changing the target region requires a new attempt number and fresh Phase 4 plan, previews, saved Terraform plan or Bicep
what-if, manifest, and signed approval. Never copy a `.tfplan`, workspace, what-if result, manifest, or approval from the
failed region. Terraform retains the reviewed chain backend key only to preserve ownership of subscription-level
singletons; the cleaned predecessor record, chain lock, fresh provenance, and new approval gate every reuse. Later
attempts use collision-safe nested deployment names, policy-assignment names, resource suffixes, workspaces, and artifact
paths. Policy assignments retain their existing system-assigned
identity architecture, so their location-bound identities are never adopted across regions: cleanup and recreation are
mandatory. An unchanged-region retry may reuse the chain only when `safeSameRegionRetry` is explicitly evidenced; it
still receives a new attempt record and cannot mutate prior evidence.

Provision the trusted public-key file outside the repository through the protected runner configuration:

```bash
export SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE=/protected/sslz-deployment-approver.pub
```

The CLI does not accept a trust-key override. The approval system must protect the signing key and authorize the human
review. The repository stores neither key material nor approval identity.

## Apply

```bash
SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE=/protected/sslz-terraform-builder.pub \
SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE=/protected/sslz-deployment-approver.pub \
  ./scripts/startup-deployment-integration.sh apply \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --manifest <reviewed-deployment-manifest.json> \
  --approval <signed-deployment-approval.json> \
  --output json
```

Apply atomically reserves the approval beneath `.sslz/deployment-state/`, rehashes every artifact, verifies the
signature and expiry again, and copies the exact verified source, parameters, controlled CLI configuration, and saved
plan into a random owner-only execution snapshot. Bicep template and parameters are compiled together exactly once
from that snapshot; all three semantic digests must still match, and only the resulting read-only ARM JSON files are
passed to Azure. Terraform executes only the protected saved-plan snapshot. A concurrent worktree replacement therefore
cannot change the approved bytes. The snapshot is removed on every result path and is never written to deployment state
or output. The exact enabled tenant and subscription are rechecked immediately before execution. Every Azure CLI
resource operation includes `--subscription`, uses a fixed argument array, and runs without a shell.

- **Bicep:** executes `az deployment sub create` with the exact reviewed parameters. Azure subscription-scope
  deployments are incremental-only; the CLI exposes no complete-mode option, and Phase 6 accepts no mode override.
  Effective policy role assignments, including parent-scope inheritance, are read back after deployment; extra roles
  for those managed identities fail the workload gate.
- **Terraform:** initializes the exact reviewed remote backend subscription with Azure AD data-plane authentication,
  `-lockfile=readonly`, a repository-controlled
  direct-only provider installation configuration, and a case-insensitive allowlist of required environment variables.
  Ambient `TF_CLI_ARGS*`, `TF_VAR_*`, provider reattachment, plugin-cache, and custom CLI configuration values are not
  inherited. Both AzureRM legacy and additive automatic provider registration are disabled and rejected in inspected
  plans; Phase 5 remains the only approved registration path. The default provider and the tightly scoped Defender
  workspace alias must reference the exact reviewed `subscription_id` variable; the alias may bind only the singleton
  workspace association and is the only surface permitted to reconcile an existing remote resource. Terraform's builtin
  provider may bind only the passing workspace-placement guard. Any resolved resource ID or scope in another subscription
  is rejected. Every role
  principal must already resolve in the saved plan to the exact policy-assignment managed identity; an unknown principal
  fails closed before approval. CLI and OIDC authentication modes are forced in the sanitized child environment, and
  the live Terraform version and platform are verified before the single-use approval is reserved. It then applies the
  exact saved `.tfplan`; apply never runs `terraform plan`.

Apply fails closed unless `.sslz/deployment-state/` is a pre-provisioned owner-protected local directory containing an
owner-protected `.durable-store.json` marker with exactly:

```json
{
  "schemaVersion": "1.0.0",
  "durable": true,
  "storeId": "00000000-0000-4000-8000-000000000000"
}
```

Use a provisioned unique UUID for `storeId`; do not use the example. Keep the store only at the fixed
repository-relative `.sslz/deployment-state` path. The manifest and signed approval bind a privacy-preserving effective
identity derived from the marker UUID and the mounted directory and marker filesystem identities, so copying the marker
to a fresh directory cannot create a new replay namespace. Preview and apply for an approval must run on the same protected executor and unchanged local filesystem identity. Apply
never creates or silently substitutes the durable store. Atomic single-use records block replay and concurrent use on
that executor. Workflow concurrency is shared across Bicep and Terraform for the whole environment, regardless of
regional-attempt chain, so provider or chain switching cannot create parallel attempts. The state stores only allowlisted hashes, targets, phases,
timestamps, and result codes.

## Post-deployment gate

A successful deployment command is not success. Phase 6 checks the expected resource groups, Log Analytics retention
and quota, Activity Log destination and categories, exact policy assignments and regional parameters, selected Defender
tiers, monthly budget and notification thresholds, the approved live budget and Defender recipient commitment, and the
expected VNet. Reads are retried for bounded Azure propagation.

`workloadDeploymentAllowed` remains `false` until every check passes. A deployment or validation failure consumes the
approval, records a rollback-review code, and performs no workload deployment or automatic rollback. Review the
sanitized result, correct the platform or revert the existing IaC, then create a new Phase 4 plan, manifest, and
approval.

The repository's separate integration-test apply is limited to a dedicated disposable subscription and
`integration-nonprod` environment. Its Terraform destroy step runs after every started apply, including partial apply
failure. Cleanup is reported separately and never replaces the original apply diagnostic.

## Privilege and rollback boundaries

Grant only the permissions already required by the selected SSLZ root at the exact target subscription, plus read
access for the postchecks and remote Terraform backend. Phase 6 never creates an extra role, elevates itself, changes
billing or entitlements, registers features or providers, unregisters providers, verifies domains, or runs arbitrary
commands.

Disable deployment by removing the `sslz-deployment` runner label or access to
`startup-deployment-integration.sh`. There is no direct workflow fallback: a new write requires a current Phase 4 v3
plan, readiness evidence, reviewed immutable manifest, and matching signed single-use approval.
