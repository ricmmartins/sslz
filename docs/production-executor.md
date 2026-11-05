---
layout: agent
permalink: /agent/docs/production-executor/
title: "Production Executor Operations"
nav_order: 8.7
description: "Bootstrap, local prerequisites, and external acceptance for a protected greenfield Azure executor"
---

## Prerequisites before agentic execution

Complete these once, outside the agent, before any live agentic run. The traditional Quick Start does not need them.

| # | Prerequisite | Who | Evidence to record |
|---|---|---|---|
| 1 | Approval keys: four distinct Ed25519 key pairs (deployment, provider, workload, image provenance). Private keys stay in an independent signing service; only public keys go to the runner. | Security/approver | Key IDs, owner, rotation policy |
| 2 | Protected self-hosted runner labeled `sslz-deployment`, running only `main`, one job at a time | Platform admin | Runner group, isolation, patching |
| 3 | GitHub environments (for example `nonprod`, `prod`) with required reviewers, self-review prevention and `main`-only deployment branches | Repository admin | Environment protection export |
| 4 | Entra app or managed identity with a federated credential limited to this repository and environment, and no client secret | Bootstrap admin | Subject claim, audience |
| 5 | Least-privilege RBAC on the target subscription only; never Owner. Provider registration is a separate approved action | Bootstrap admin | Role assignments, scope |
| 6 | Pre-provisioned `.sslz/deployment-state` replay store with its marker, owner-only access, on durable backed-up storage | Operations custodian | Backup and restore observation |
| 7 | For workloads: a published, digest-pinned image with builder-signed provenance | Image builder | Registry digest, signature |

Example one-time setup for items 3 to 5. Replace the placeholders; run as the bootstrap administrator, not as the executor:

```bash
# 4. Identity and federated credential (environment-scoped subject)
az ad app create --display-name sslz-executor-nonprod
az ad sp create --id <appId>
az ad app federated-credential create --id <appObjectId> --parameters '{
  "name": "sslz-nonprod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<owner>/<repo>:environment:nonprod",
  "audiences": ["api://AzureADTokenExchange"]
}'

# 5. Scoped role assignment (replace the role with the least privilege the reviewed baseline needs)
az role assignment create --assignee <appId> --role "<least-privilege role>" \
  --scope /subscriptions/<subscriptionId>

# 3. Repository secrets read by the deploy workflows
gh secret set AZURE_CLIENT_ID --env nonprod --body <appId>
gh secret set AZURE_TENANT_ID --env nonprod --body <tenantId>
gh secret set AZURE_SUBSCRIPTION_ID_NONPROD --env nonprod --body <subscriptionId>
```

Then run the read-only check and resolve every `blocked` item without generating throwaway keys:

```bash
node scripts/production-executor-readiness.mjs --provider bicep --workload greenfield-acceptance
```

A `local-prerequisites-present` result is not authorization. Items 1 to 7 still need external verification, listed in
the acceptance checklist at the end of this runbook.

## Scope and evidence

This runbook covers the protected executor for a new Azure landing-zone baseline and subsequent greenfield workload
operations. The existing Phase 6 executable surface remains the primary single-region platform baseline, not a workload
deployment engine. Workload rollout needs its own explicitly approved, supported execution path; this document does not
grant one. Migration and dual-cloud are outside product scope, not future production acceptance requirements.

The local checker and offline fixtures are not a successful live journey, Azure identity validation, recovery proof, or
alert-delivery proof. All acceptance items below require recorded observations on the actual protected services.
See [approved deployment integration](/agent/docs/approved-deployment-integration/) for the signed artifact protocol.

## Separation of duties and bootstrap

Keep these authorities separate; a repository edit or a passing check must not create execution authority:

| Authority | Responsibility | Must not have |
|---|---|---|
| Bootstrap administrator | Provision identity/federation, narrowly scoped role assignments, protected runner, backend, and replay storage; approve bootstrap changes separately | Routine use of bootstrap privileges by the executor |
| Plan builder | Produce reviewed immutable artifacts; Terraform builder signs atomic saved-plan provenance | Deployment/provider approval signing authority |
| Human reviewer and approval service | Authorize exact target, cost, recipient policy, artifact hashes, expiry, nonce, and store identity; sign only after independent review | Signing key exposed to repository jobs or executor |
| Deployment executor | Verify public keys and signed artifacts; consume single-use approval; apply and postcheck one baseline | Approval/provenance private keys, ability to administer its own trust configuration |
| Operations/recovery custodian | Protect audit/replay backups, monitor alerts, rehearse recovery, authorize bounded cleanup | Ability to erase consumed approvals to permit replay |

Provision protected services through a separately reviewed administrative process, not through this checker or an
unreviewed job. Record owners, inventory references, approver policy version, and emergency access procedure outside
the artifact bundle. Keep private keys in an independently controlled signing service. The current wire protocol uses
Ed25519; select a service supporting that algorithm and the existing domain-separated canonical payload. Do not silently
substitute an incompatible vault algorithm.

Configure these absolute, regular, non-symlink public-key paths on the protected runner:

- `SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE`: deployment approval verification.
- `SSLZ_PROVIDER_APPROVAL_PUBLIC_KEY_FILE`: separately authorized provider-registration approval verification.
- `SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE`: independently protected Terraform builder verification.
- `SSLZ_TERRAFORM_EXECUTABLE`: protected absolute Terraform binary path when using Terraform.

Provider approval uses its own signing domain and authority configuration, not a deployment approval or builder
signature. Supply the provider trust variable to the protected provider process; the existing deployment workflows
only inject their own deployment/provenance variables. Public-key presence proves neither authorized provenance nor
tamper-resistant ACLs. Independently compare SPKI fingerprints with the service custodian's approved inventory and
inspect owner, parent-directory ACLs, inherited write access, runner administration, and configuration-change auditing.
Do not generate keys or a durable-store marker just to turn a failed readiness report green.

## Derive least privilege from the reviewed baseline

Do not default the executor to subscription Owner or permanent User Access Administrator. Start with the exact selected
root, compiled resource graph and planned actions; build a reviewed action/scope matrix for the target tenant and
subscription. Include read permissions for preflight, deployment operations and postchecks, plus only writes required
for selected resource groups, network resources, monitoring/diagnostics, budgets, Defender settings and policy
assignments. Derive required policy role-assignment operations from the actual root, not a generic Contributor recipe.

The baseline creates role assignments for policy-managed identities. Contributor alone cannot authorize
`Microsoft.Authorization/roleAssignments/write`. Where supported, constrain delegated role-assignment permission by
allowed role definitions, principals and scopes; bootstrap any necessary delegation independently. Resolve the real
policy identity IDs and review the exact assignments rather than granting unrestricted role administration because
identities are initially unknown. If safe delegation cannot be established, stop and resolve the prerequisite; do not
bypass the saved-plan semantic restrictions or grant Owner as an undocumented shortcut.

Provider registration is a separate approved action. Scope the registration identity and permissions to the intended
subscription and approved namespaces; do not give the platform executor ambient registration authority merely to make
Terraform initialization work. Automatic Terraform provider registration stays disabled.

For remote state, use Azure AD authentication and narrowly scoped blob data-plane access (typically Storage Blob Data
Contributor on the dedicated state container, subject to the backend's actual operations). Include only the control-plane
reads actually required by the selected backend mode. Do not distribute account keys, SAS tokens, or storage-account
administration rights to the executor. Independently inspect effective inherited grants and deny assignments, not just
direct assignments. Verify tenant, principal object/application IDs, target subscription, federation claims, and
backend subscription against the reviewed decision. A supplied `identityVerified: true` or similar boolean is not proof.

## Protected runner, environment and OIDC

The deployment workflows are manual-dispatch wrappers on `[self-hosted, sslz-deployment]`, protected GitHub environments,
`main`-only dispatch, and environment-wide cross-provider concurrency with cancellation disabled. Those YAML declarations
do not prove that the configured runner/environment is protected.

Externally verify and retain evidence of:

1. Environment required reviewers, prevention of self-review and bypass policy, and allowed deployment branches.
2. Protected `main`, reviewed workflow changes, runner-group repository restrictions, and no untrusted pull-request
   code execution on this runner. A runner label alone is not isolation.
3. Entra workload federation restricted to the intended repository and environment subject and expected audience;
   no broad repository/branch wildcard. The protected environment gates the OIDC-enabled job.
4. No long-lived client secret fallback; separate environment identities/subscriptions as approved. Do not log OIDC
   tokens, authentication environment values, raw Terraform plans or notification recipients.
5. Hardened executor account, trusted binary installation and public-key parents, restricted outbound access,
   protected artifact input paths, and audit shipping outside the runner's deletion authority.
6. Cross-run serialization and the fixed replay directory remain effective after checkout, reboot and runner maintenance.

Terraform's reviewed authentication mode must match execution. Azure login does not itself populate every Terraform
OIDC variable. Validate the actual sanitized child environment and the intended token-request mechanism without logging
tokens. The baseline wrapper does not provision this integration or the backend.

## Durable replay is separate from Terraform state

Pre-provision the existing executor's fixed `.sslz/deployment-state` directory with the exact marker contract documented
in the approved deployment integration guide. On POSIX, the directory must be owned by the executor with owner-only
`0700` access and the marker owner-only and readable (normally `0600`). On Windows, the existing executor checks local
ACLs with `whoami`/`icacls`; independently audit effective ACLs and inherited/parent access. Never let a cleanup job,
checkout, cache restore, or artifact extraction replace this directory or marker.

The effective `storeId` is derived from the provisioned marker UUID **and** directory/marker filesystem identities.
Preview, signing and apply for an approval must use the same persistent executor and unchanged identities. A copied
marker, new checkout directory, fresh ephemeral runner, or backup restored with new inode/file IDs is not the same
approval namespace. Do not replace the marker to reset a consumed nonce. Provider replay records beneath this protected
store and deployment/regional-attempt records must be retained together.

Back up replay records consistently and protect them against rollback/deletion separately from runner credentials.
The marker is only a local declaration; it cannot prove durable mounting, backup freshness or crash recovery. Validate
those properties with the storage administrator. Workflow concurrency is additional serialization, not durable replay.

Terraform must use the reviewed AzureRM remote backend with explicit subscription, resource group, storage account,
container and state-key prefix; the actual regional attempt's reviewed state key/workspace remains approval-bound.
Provision the backend independently. Verify Azure AD authorization, private/network access, lease-based locking,
encryption, blob versioning/soft-delete/retention, backup and restore, and separation from workload cleanup. Never use
local Terraform state or a second workspace/key to evade a lock or adopt an existing baseline.

## Read-only local check

Run on the actual executor checkout under its execution account after provisioning:

```bash
node scripts/production-executor-readiness.mjs --provider bicep
node scripts/production-executor-readiness.mjs --provider terraform --backend-file /protected/reviewed-backend.json
node scripts/production-executor-readiness.mjs --provider bicep --workload greenfield-acceptance
```

For Terraform, the backend file is the exact JSON object from `decisionModel.terraformBackend`, not a credentials file
or an initialized backend cache. It must include `type: "azurerm"`, `subscriptionId`, `resourceGroupName`,
`storageAccountName`, `containerName`, and `keyPrefix`.

Exit `0` means **local-prerequisites-present**, not authorized or production-ready. Exit `1` reports failed local checks;
exit `2` means invalid CLI arguments or an unreadable/malformed backend input file. No boolean override flags exist.
The checker:

- Reads and parses provisioned Ed25519 public keys through the executor's existing non-linked absolute-path checks,
  returning public fingerprints, not signing authority verification.
- Reuses the actual fixed-store/marker/permission/filesystem-identity checks. On Windows this launches only local
  permission inspection utilities, not deployment commands.
- For Terraform, resolves and hashes the executable with the executor's existing helper, checks local read/execute
  accessibility, and validates remote backend coordinate syntax using the existing backend schema.
- Creates or repairs nothing; makes no Azure/GitHub calls, initializes no backend, and launches no Terraform/Bicep.
  Binary authenticity, actual Terraform version/platform, provenance binding, backend existence/access and locking
  remain unverified here; the execution path still applies its own plan-specific checks.

The JSON always reports `productionReady: false` and lists outstanding external checks. Store/key fingerprints may
help an authorized reviewer reconcile inventory, but do not publish internal inventory or raw evidence indiscriminately.

The optional bounded workload check also requires distinct
`SSLZ_WORKLOAD_APPROVAL_PUBLIC_KEY_FILE` and `SSLZ_WORKLOAD_IMAGE_PROVENANCE_PUBLIC_KEY_FILE` keys.
It does not prove organizational separation, image publication/provenance or live readiness.
See the [initial workload execution runbook](/agent/docs/greenfield-workload-execution/);
this path does not expand the baseline executor or support arbitrary workloads.

Focused offline validation:

```bash
node tests/production-executor-readiness.mjs
```

Tests create explicitly synthetic fixtures in an isolated ignored checkout beneath `.sslz/generated`, remove them on
completion, and never provision the actual executor store. They test binary metadata resolution only and make no claim about a real Terraform runtime or deployment. CI runs this suite in `validate.yml`, not the website workflow.

## Rotation, interrupted execution and recovery

**Key rotation:** independently provision and verify the replacement public fingerprint and protected signing service;
revoke old signing access and audit the change. There is one configured verification key per authority, not an automatic
multi-key overlap window. Outstanding approvals/provenance signed by an old key must be reviewed and regenerated with
fresh nonces and validity windows as appropriate. Never delete replay records during rotation.

**Interrupted/failed apply:** preserve approval, manifest, attempt identifiers, sanitized result/failure hashes and
durable reservation records. Treat an unknown outcome as potentially written. Inspect live deployment operations,
Terraform lock/state serial/lineage, resources and current policy identities under an independently authorized recovery
procedure. Do not clear reservations, force-unlock, reapply a consumed approval or switch region/provider speculatively.
A deployment write failure remains cleanup-required until reviewed bounded cleanup succeeds; a fresh region needs a new
attempt, plan, preview/provenance, manifest and approval.

**Replay volume failure or stale restore:** quarantine all outstanding approvals. Reconcile off-host audit evidence,
consumed nonces, reservations, attempt state and live resources before any execution. A stale backup may omit a consumed
approval; do not enable execution merely because the restored directory passes the local checker. If filesystem identity
changed, reject old approvals, obtain fresh artifacts and approvals bound to the new effective store identity, and retain
the old ledger and recovery decision. No automatic replay-ledger merge or disaster-recovery bypass is provided.

**Terraform state recovery:** use the storage custodian's reviewed restore procedure. Record selected blob version,
serial/lineage, lease status and live-resource reconciliation. Restoring backend state does not restore the replay ledger
or undo Azure writes. Never run state surgery/import or a destructive rollback as an undocumented retry.

The offline deployment suite checks that a failed apply consumes its approval, retains a `cleanup-required` ledger,
rejects reuse, and rejects a fresh approval for the same unresolved regional attempt without a deployment write.
It also rejects approval reuse after an unhealthy postcheck. Provider fixtures reject approval reuse after both a
failed registration command and failed registration readback. Run these checks with
`node tests/startup-deployment-integration.mjs` and `node tests/startup-provider-remediation.mjs`.
These checks prove fail-closed retry behavior in mocks; they do not prove live recovery or authorize a resume.

## Operational acceptance checklist — observations required

Keep dated evidence references, responsible reviewer, exact artifact digests, target aliases and pass/fail for each item.
Do not substitute synthetic checks or planned timestamps for observations:

- [ ] Bootstrap privileges removed from routine execution; effective identity/RBAC, independent signing authorities,
  public-key provenance/ACLs, environment protections and OIDC claims independently inspected.
- [ ] Replay records survive runner restart at unchanged filesystem identity; same approval reuse and concurrent reuse
  are rejected without another write. Backend access and lease contention are observed on the intended state key.
- [ ] One real approved greenfield baseline journey records preview, signed approval, single execution, postcheck result,
  and resource/cost inventory. Phase 6 baseline success is not a workload deployment or connectivity claim.
- [ ] For an explicitly supported and separately authorized greenfield workload acceptance, capture fresh application
  health and reachability observations. For AKS ingress, retain the exact approved ingress decision and corresponding
  live acceptance/recovery postcheck; planning placeholders and ARM deployment output are insufficient.
- [ ] Recovery rehearsal records an intentional, approved failure, detection/start/end timestamps, actual restored
  service/data observations, measured RTO and RPO versus approved objectives, and any reconciliation/cleanup result.
  Record failed recovery as failed; record recovery time only after the actual health criterion passes.
- [ ] A controlled alert test records rule/channel, event and delivery timestamps, recipient receipt/acknowledgment
  evidence and measured delivery latency. A configured action group or budget contact is not proof of receipt.
- [ ] Replay and backend restore exercises record backup/version age, restored ledger completeness, state serial/lineage,
  filesystem identity outcome, approval invalidation/reissue decision and restart authorization.
- [ ] Cleanup names only newly created resources proven to belong to the approved attempt. Preserve all pre-existing
  resources, shared state/backend, trust services and replay/audit records. Verify residual resources and charges.

No live execution is authorized by this runbook. For a separately authorized new-resource experiment, record the
approved spending ceiling, maximum active-resource duration, and preservation boundary outside tracked files.
Pre-estimate all selected paid tiers and bootstrap/test costs, establish an owner and stop/cleanup deadline,
and stop if the approved limits cannot be met. Azure budgets/alerts are not hard spending caps and billing telemetry may lag. Do not start a subscription-wide baseline that
would change existing resources under a new-test-resources-only authorization. Never destroy whole subscriptions or
resource groups as a cleanup shortcut. Missing external services or safe isolation are blockers, not permission to fake
readiness or broaden the experiment.
