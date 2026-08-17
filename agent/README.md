# SSLZ Agent Contracts

This directory contains the versioned, machine-readable contracts for the startup agent flow. The additive startup
preflight performs Azure reads only. The workload and regional planners read local JSON only and make no Azure calls.
The IaC planner writes ignored local review inputs and can optionally run non-deploying previews. Terraform preview can
acquire and release a remote-state backend lease; it does not apply managed infrastructure.

Capability delivery does not imply execution authority. Phase 7 and the PostgreSQL migration, container image/CI/CD, and
dual-cloud programs remain planning-only and execution-disabled. The
[implementation and evidence matrix](../docs/implementation-status.md) is authoritative for delivered status, approval
boundaries, synthetic and hosted validation, historical live preview evidence, and remaining live gates.

## Contents

| Path | Purpose |
|---|---|
| `schemas/startup-input.schema.json` | Founder and workload planning input |
| `schemas/preflight-result.schema.json` | Account, workload, and regional check result |
| `schemas/deployment-plan.schema.json` | Reviewable SSLZ deployment plan |
| `schemas/workload-profile-plan.schema.json` | Read-only workload profile selection |
| `schemas/regional-planning-input.schema.json` | Timestamped, supplied regional evidence |
| `schemas/regional-capacity-plan.schema.json` | Read-only regional and capacity recommendation |
| `schemas/postgresql-source-assessment.schema.json` | Non-secret PostgreSQL source inventory and operational evidence |
| `schemas/postgresql-migration-plan-input.schema.json` | Read-only PostgreSQL migration assessment and target evidence input |
| `schemas/postgresql-migration-plan.schema.json` | Deterministic execution-disabled PostgreSQL migration plan |
| `schemas/postgresql-rehearsal-evidence.schema.json` | Expiry-bounded rehearsal, validation, cutover-readiness, rollback-readiness, and replay-lineage evidence |
| `schemas/postgresql-rehearsal-lineage.schema.json` | Read-only accepted evidence-set lineage for deterministic replay rejection |
| `schemas/postgresql-rehearsal-plan.schema.json` | Deterministic execution-disabled PostgreSQL rehearsal and validation plan |
| `schemas/postgresql-execution-*.schema.json` | Approval-bound live-evidence, trust, lineage, stage-approval, request, and deterministic no-operation orchestration contracts |
| `schemas/container-image-cicd-source-assessment.schema.json` | Non-secret container image, registry, and CI/CD source inventory |
| `schemas/container-image-cicd-plan-input.schema.json` | Source assessment, ACR and CI/CD target evidence, region policy, requirements, transition decisions, replay lineage, and program integration bindings |
| `schemas/container-image-cicd-plan.schema.json` | Deterministic execution-disabled container image and CI/CD migration plan |
| `schemas/connectivity-source-assessment.schema.json` | Non-secret dual-cloud private connectivity, DNS, workload identity, and egress source inventory |
| `schemas/connectivity-plan-input.schema.json` | Source assessment, Azure connectivity/DNS/identity/egress target evidence, requirements, transition decisions, replay lineage, and program integration bindings |
| `schemas/connectivity-plan.schema.json` | Deterministic execution-disabled dual-cloud connectivity, DNS, identity, and egress migration plan |
| `schemas/control-plane-ownership-plan-input.schema.json` | Versioned dual-cloud role, RACI, state, handoff, lineage, and exact artifact bindings |
| `schemas/control-plane-ownership-trusted-bindings.schema.json` | Protected predecessor-envelope, artifact, environment, and target identities |
| `schemas/control-plane-ownership-plan.schema.json` | Deterministic execution-disabled control-plane ownership and RACI plan |
| `schemas/program-lineage-input.schema.json` | Canonical baseline identities plus exact PostgreSQL, container, and connectivity planner artifacts |
| `schemas/program-lineage-envelope.schema.json` | Deterministic execution-disabled cross-program identity, stage chain, readiness separation, and authority boundary |
| `schemas/program-lineage-trusted-digests.schema.json` | Externally protected PostgreSQL planner trust arguments supplied outside the artifact bundle |
| `schemas/iac-plan-input.schema.json` | Profile, regional recommendation, target, and deployment decisions |
| `schemas/iac-plan-input-v2.schema.json` | Phase 6-capable IaC input requiring the exact Terraform backend subscription |
| `schemas/iac-plan-input-v3.schema.json` | Approval-capable IaC input requiring bound readiness evidence |
| `schemas/readiness-evidence.schema.json` | Versioned code evidence and external/human attestations |
| `schemas/iac-plan-summary.schema.json` | Sanitized parameter, preview, digest, and approval summary |
| `schemas/cool-foundation-*.schema.json` | Execution-disabled nonproduction cool foundation contracts |
| `schemas/container-apps-cool-profile-*.schema.json` | Execution-disabled Container Apps cool profile input, plan, and manifest contracts |
| `schemas/terraform-plan-provenance.schema.json` | Signed atomic-build provenance for one Terraform saved plan |
| `schemas/provider-remediation-approval.schema.json` | Single-use approval bound to one reviewed provider action |
| `schemas/provider-remediation-result.schema.json` | Sanitized dry-run and apply audit result |
| `schemas/deployment-execution-manifest.schema.json` | Immutable provider, target, artifact, preview, and command binding |
| `schemas/deployment-approval.schema.json` | Trusted signed approval for one exact platform deployment |
| `schemas/deployment-result.schema.json` | Sanitized deployment and post-validation audit result |
| `schemas/greenfield-journey-report.schema.json` | Sanitized v2 validation-only founder journey with required program-lineage identity and separated readiness |
| `checks/check-catalog.json` | Stable check IDs and official documentation |
| `profiles/` | Versioned compute and extension decision data |
| `examples/` | Sanitized ready, blocked, and input examples |

## Validate locally

```bash
node scripts/validate-greenfield-journey.mjs
```

That is the canonical validation-only entry point for the integrated agent-aware founder journey on the current `main`
branch. It exercises the repository planners and approval/remediation boundaries with deterministic mocks, creates no
Azure resources, and requires no tenant access. The emitted report contains aliases and digests rather than tenant or
subscription identifiers, PII, secrets, or raw diagnostics. Node.js and the local Bicep CLI installed by
`az bicep install` are required; no npm install or project dependency restore is needed.

Individual contract suites remain available for focused development:

```bash
node scripts/validate-agent-contracts.mjs
node tests/startup-preflight.mjs
node tests/startup-workload-plan.mjs
node tests/startup-regional-plan.mjs
node tests/startup-postgresql-migration-plan.mjs
node tests/startup-postgresql-rehearsal-plan.mjs
node tests/startup-postgresql-execution-plan.mjs
node tests/startup-container-image-cicd-plan.mjs
node tests/startup-connectivity-plan.mjs
node tests/startup-control-plane-ownership-plan.mjs
node tests/startup-program-lineage.mjs
node tests/startup-iac-plan.mjs
node tests/startup-readiness-evidence.mjs
node tests/startup-cool-foundation-plan.mjs
node tests/startup-container-apps-cool-plan.mjs
node tests/startup-provider-remediation.mjs
node tests/startup-deployment-integration.mjs
```

Validation and fixture tests use Node.js built-in modules and require no package installation, Azure login, or Azure
permissions.

Tagged releases may predate the integrated journey; consult the documentation in the selected tag. Direct use of
`infra/bicep` or `infra/terraform` is an operator-controlled baseline IaC workflow outside the startup-agent approval
gates unless the operator explicitly uses the Phase 4-6 commands.

## Inspect an Azure account

```bash
./scripts/startup-preflight.sh inspect \
  --prod-subscription <subscription-id> \
  --nonprod-subscription <subscription-id> \
  --profile container-apps \
  --output text
```

Use `--output json` for the contract defined by `schemas/preflight-result.schema.json`. The command never registers a
provider, assigns a role, changes billing, or deploys resources.
Repeat `--profile` for every selected compute or extension profile. When omitted, preflight preserves the baseline
Container Apps behavior. AKS inspection therefore requests `--profile aks` and checks
`Microsoft.ContainerService` without imposing that provider on unrelated workloads.

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

The command derives Bicep and Terraform parameters from one canonical decision model. Approval-capable v3 inputs must
include current readiness evidence whose canonical digest is bound into the plan. It writes only beneath
`.sslz/generated/`, which is ignored by Git, and emits a stable SHA-256 digest plus approval metadata. A changed
approval-bound decision invalidates a supplied approval. Add `--preview` to run only Bicep what-if or Terraform plan.
Terraform preview requires the input's explicit `azurerm` remote-backend coordinates and ambient authentication; the
planner does not create a backend or credentials.

## Prepare a nonproduction cool foundation plan

```bash
./scripts/startup-cool-foundation-plan.sh generate \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --baseline agent/examples/cool-foundation-baseline.json \
  --output-dir .sslz/generated/my-plan/cool-foundation
```

The Phase 7 command validates current readiness evidence and emits deterministic, execution-disabled Bicep and
Terraform manifests for secondary networking and observability in `nonprod` only. It binds exact source and parameter
digests, isolated scope and Terraform state, ordered future steps, read-only postchecks, teardown intent, and pending
approval metadata. It does not authenticate, preview, deploy, register providers, query live billing, synthesize human
attestations, or add global ingress, workloads, replication, or failover. The example baseline (RTO 240 minutes, RPO 60
minutes, secondary recurring cost at most 30% of primary, quarterly exercise, and `Platform Operations Owner`) is a
provisional noncritical planning fixture, not a production promise.

## Plan the nonproduction Container Apps cool profile

```bash
./scripts/startup-container-apps-cool-plan.sh generate \
  --foundation-plan .sslz/generated/my-plan/cool-foundation/cool-foundation-plan.json \
  --profile-input agent/examples/container-apps-cool-profile-input.json \
  --output-dir .sslz/generated/my-plan/cool-container-apps
```

This additive local planner binds an exact review-ready foundation to provider-equivalent Bicep and Terraform inputs for
one internal Container Apps environment and digest-pinned app. It represents a dedicated nondelegated `/23` subnet,
single-revision settings, versioned Key Vault references, user-assigned identity and scoped RBAC, minimum scale, startup/
readiness/liveness probes, configuration parity, diagnostics, rollback, cleanup, and durable resume semantics.

The checked-in profile input deliberately uses a `not-measured` recovery placeholder, so it remains blocked until an
explicit current exercise records measured RTO and RPO within the provisional targets. The planner has no preview, apply,
provider-registration, workflow-write, production, global-ingress, DNS, replication, or data-failover path, and it never
claims end-to-end recovery.

## Apply one approved provider registration

```bash
./scripts/startup-provider-remediation.sh dry-run \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --action provider.register.prod.microsoft-app

./scripts/startup-provider-remediation.sh apply \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --action provider.register.prod.microsoft-app \
  --approval <approval-artifact.json>
```

The action must be unchanged in the reviewed plan and allowed by its selected workload profiles. Apply accepts one
unexpired, unconsumed approval artifact, rechecks the exact tenant and subscription, executes one Azure CLI provider
registration with argument arrays, verifies `Registered`, and records replay state only under the ignored
`.sslz/remediation-state/` directory.

## Preview and apply one approved platform baseline

```bash
./scripts/startup-deployment-integration.sh preview \
  --plan .sslz/generated/my-plan/<attempt>/plan-summary.json \
  --provider bicep \
  --environment nonprod

SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE=/protected/sslz-terraform-builder.pub \
SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE=/protected/sslz-deployment.pub \
  ./scripts/startup-deployment-integration.sh apply \
  --plan .sslz/generated/my-plan/plan-summary.json \
  --manifest <reviewed-deployment-manifest.json> \
  --approval <signed-deployment-approval.json>
```

Preview reruns non-deploying inspection over the exact hashed artifact set and emits an immutable manifest without
applying managed infrastructure. Bicep preview binds exact compiled-template, concrete-parameter, and semantic
resource-graph digests. Terraform planning can acquire and release a remote-state backend lease and therefore requires
the corresponding backend permission; it additionally requires Phase 4 Ed25519 provenance tying the saved plan to an
atomic source snapshot. Apply verifies both
trust anchors, compiles Bicep template and parameters once into read-only ARM JSON when selected, rechecks the exact
target, executes only incremental Bicep or the exact saved Terraform plan, and blocks workloads unless every platform
check passes. Preview and approval bind the documented owner-protected local replay store at the fixed
`.sslz/deployment-state` path, including its filesystem identity; preview and apply run on the same protected executor,
and apply fails closed if that exact store is absent. The signed approval also binds a dedicated notification-recipient
digest that the approval service must recompute from its protected recipient policy without persisting email addresses.

## Safety boundary

The account preflight implements only `inspect`. Domain and secondary-administrator checks return `unknown` when
Microsoft Graph evidence is unavailable. Startup-credit association remains blocking until it is confirmed through
authoritative billing or Microsoft for Startups support evidence. Workload and regional planning are separate
local-only commands. The regional planner does not reserve capacity, create parameter files, generate IaC, or perform
Azure operations. IaC generation is a separate command with no deployment, remediation, provider-registration, role,
or billing operation. Approved provider remediation is a separate command whose only Azure write is one
profile-allowlisted resource-provider registration; it cannot call either deployment path. Approved deployment is
another standalone command and supports only the primary `single-region-ready` platform baseline. It does not deploy a
workload or secondary region. `cool-infrastructure` remains a nonproduction planning mode; no Phase 7 manifest is
accepted by the Phase 6 preview or apply path.

The PostgreSQL execution planner is a separate local JSON contract evaluator. It verifies protected digests, Ed25519
signatures, single-use nonces, exact stage authority and capability boundaries, freshness, target/environment matching,
and monotonic lineage, then emits descriptions and rollback boundaries only. Even an eligible plan performs no source,
target, cloud, IaC, network, DNS, database, dump/restore, replication, cutover, rollback, failback, state, or file write.

The container image and CI/CD planner is a separate deterministic local JSON evaluator. It inventories registry metadata,
image platforms, tags versus digests, provenance, SBOM, signatures, attestations, base images, vulnerability posture,
registry replication/retention/encryption/network controls, build triggers, protected branches and environments, runner
identity and egress, secret-reference metadata, artifact promotion, rollback, and deployment targets across AWS ECR, GCP
Artifact Registry/GCR, and generic OCI sources paired with GitHub Actions, CodeBuild, Cloud Build, GitLab CI, Jenkins, or
Azure DevOps. It produces a deterministic Azure Container Registry target and a guarded dual-publish, cutover, and rollback
transition plan whose `executionEligible` and safety fields are always `false`/`none`. It never stores credentials,
secret-bearing URLs, or repository contents, and never emits registry, build, cloud, or IaC commands.

The dual-cloud connectivity, DNS, identity, and egress planner (`scripts/startup-connectivity-plan.mjs`) is a separate
deterministic local JSON evaluator. It inventories source-cloud (AWS, GCP, or generic/on-prem) network CIDRs, address
translation, gateways, routing and BGP/ASN/MTU, firewall/NSG/NVA policy intent, private access, DNS zones and resolvers,
workload identity federation, and egress destinations and NAT/proxy references, against Azure ExpressRoute or VPN
Gateway target evidence. It blocks on overlapping address space without an approved exact translation, asymmetric
routing or broad default routes, non-redundant gateways, unacceptable BGP ASNs or incompatible MTU, implicit firewall
policy, missing private endpoint/service endpoint evidence where required, DNS authority ambiguity or forwarding loops,
unreachable resolvers, long-lived secrets or static credentials, unpinned OIDC issuer/audience/subject, mixed
nonproduction/production environments, unbounded egress, missing telemetry/ownership/recovery/rollback evidence, and
stale, tampered, mismatched, or replayed evidence. It produces a guarded phased connectivity cutover transition plan
whose `executionEligible` and safety fields are always `false`/`none`, models IPv4 connectivity only, never stores
credentials or secret-bearing URLs, and never emits network, DNS, identity, cloud, or IaC commands or creates tunnels.

The program-lineage builder (`scripts/startup-program-lineage.mjs`) is a local contract validator, not an orchestrator
for live work. Its v1 envelope chains exact canonical digests for the baseline workload, region, PostgreSQL decision,
IaC plan, readiness evidence, deployment manifest, and signed deployment approval through the real PostgreSQL migration,
rehearsal, execution-contract, container image/CI/CD, and connectivity planner outputs. Every stage remains
`executionEnabled`, `executionEligible`, and `executionAllowed` false and names a distinct future authority. The Phase 5/6
approval remains scoped to `greenfield-platform-deployment-only`; it does not authorize database writes, image promotion,
DNS, network, identity, egress, cutover, rollback, or failback.

The control-plane ownership planner (`scripts/startup-control-plane-ownership-plan.mjs`) defines one accountable role
and explicit responsible, consulted, informed, and independent approval sets for DNS, certificates, secrets, CI/CD,
observability, incidents, configuration, deployment, writes, source of truth, recovery, cutover, rollback, and failback.
It models coexistence through failback with digest-bound accepted handoffs, acyclic escalation, monotonic lineage, exact
predecessor program and artifact bindings, and AWS, GCP, or generic source metadata. Every planned action remains a
non-executable representation and all live operations remain disabled.

The builder reruns every planner and compares its complete canonical output, reevaluates evidence expiry at the envelope
generation time, and rejects self-rehashed substitutions. Attempt 2 and later require an independently supplied
`--trusted-previous-envelope` whose exact program, lineage, history, ordinal, nonce, and digest are appended to the new
attempt. PostgreSQL planner trust arguments must be supplied separately with `--trusted-planner-digests`; they are never
derived from the bundled artifacts. Replay and trusted-digest storage remain the responsibility of a protected external
executor; the lineage builder does not create or update them.

The canonical greenfield report schema is now v2. Older v1 reports fail closed because they do not contain the required
program-lineage identity and readiness separation. The report references the separately emitted envelope by exact
envelope and program identity digests. The report and envelope identify evidence as `synthetic` or `live`; the checked-in
journey uses sanitized synthetic fixtures exclusively.

This SSLZ increment adds only planner scripts, schemas, examples, catalog entries, and validation wiring. It does not
modify the `infra/bicep` or `infra/terraform` modules, parameters, or resources, so no Bicep/Terraform parity change is
required for this or the container image/CI-CD planning increment.
