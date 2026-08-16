---
layout: page
title: "PostgreSQL Migration Planning"
nav_order: 8.4
description: "Read-only source assessment and migration planning for Azure Database for PostgreSQL"
---

# PostgreSQL Migration Planning

## Status

PRs [#22](https://github.com/ricmmartins/sslz/pull/22),
[#23](https://github.com/ricmmartins/sslz/pull/23), and
[#24](https://github.com/ricmmartins/sslz/pull/24) delivered migration, rehearsal, and approval-bound execution-contract
planners. Every operation remains execution-disabled. Validation is synthetic and hosted; no current-main live database,
rehearsal, cutover, rollback, or failback evidence is claimed. See the
[implementation and evidence matrix](implementation-status.md).

The first migration increment assesses supplied PostgreSQL metadata and generates a deterministic plan for moving from
AWS RDS, Google Cloud SQL, or self-managed PostgreSQL to Azure Database for PostgreSQL Flexible Server. It has no source
database connection, Azure operation, migration-tool action, dump/restore action, CDC change, DNS change, or write path.

## Validate and plan

```bash
node scripts/startup-postgresql-migration-plan.mjs plan --input agent/examples/postgresql-migration-plan-input.json --output json
```

The command writes JSON to standard output only. Exit status is `0` for a complete plan, `1` for a blocked plan, and `2`
for invalid or secret-bearing input. The checked-in example is synthetic and contains only non-secret metadata and opaque
references.

## Contracts and evidence

| Contract | Purpose |
|---|---|
| `postgresql-source-assessment.schema.json` | Versioned source metadata for engine, data/catalog objects, security, replication, availability, workload, network, identity, operations, governance, and recovery requirements |
| `postgresql-migration-plan-input.schema.json` | Source assessment, the exact PostgreSQL regional-planning input, migration-specific target evidence, migration scope, strategy constraints, validation, rollback, and reviewed decision references |
| `postgresql-migration-plan.schema.json` | Compatibility results, strategy, stage gates, detailed plan, immutable identity bindings, human confirmations, and execution-disabled safety boundary |

The source assessment accepts secret references, certificate references, DNS references, and owner references, never
secret material or connection endpoints. Password fields, tokens, connection strings, private keys, credential-bearing
PostgreSQL URIs, AWS access keys, and JWT-shaped values fail validation.

The target is recomputed through the existing deterministic PostgreSQL regional planner. Migration evidence must match
its selected region, exact engine version, required extensions, selected evidence digest, and passing runtime checks.
The migration evaluator then checks extension versions and features, encoding/collation, storage/IOPS/connection
headroom, HA/zones/RTO/RPO, private connectivity and DNS, identity mapping, logical replication prerequisites, migration
tool availability, large objects, generated columns, roles/ownership/RLS, source-of-truth rules, validation, and rollback.
Unsupported extensions or features remain explicit blockers; the planner never drops or substitutes them.

## Strategies and stages

The planner selects exactly one strategy:

- `offline-dump-restore` when the estimated final load and validation fit the tolerated downtime;
- `online-logical-replication` when offline downtime is excessive and current WAL, slot, replica-identity, target-feature,
  and migration-tool evidence supports online catch-up;
- `blocked-manual-architecture-review` when compatibility, evidence, downtime, source-of-truth, validation, or rollback
  requirements do not pass.

Every result contains gates for `assess`, `prepare`, `rehearse`, `initial-load`, `catch-up`, `validate`, `cutover-ready`,
`cutover`, `verify`, `rollback-required`, and `completed`. All gates set `executionAllowed` to `false`; downstream stages
remain pending human confirmation even when the plan is complete.

The detailed plan records prerequisites, unsupported objects, transformations, schema preparation, initial load, CDC
catch-up, validation queries/checksums/counts, write freeze, DNS and application connection references, secret-rotation
references, rollback conditions and window, source-of-truth/failback rules, cleanup, estimated downtime/data-loss bounds,
and unresolved decisions. These are reviewed instructions, not executable commands.

## Rehearsal and validation planning

The next increment consumes the exact versioned source assessment and emitted migration plan plus a separately supplied
rehearsal evidence set:

```bash
node scripts/startup-postgresql-rehearsal-plan.mjs plan \
  --source-assessment <source-assessment.json> \
  --migration-plan-input <reviewed-migration-plan-input.json> \
  --migration-plan <postgresql-migration-plan.json> \
  --evidence agent/examples/postgresql-rehearsal-evidence.json \
  --accepted-lineage agent/examples/postgresql-rehearsal-lineage.json \
  --as-of <trusted-evaluation-time> \
  --trusted-migration-plan-input-digest <protected-input-review-digest> \
  --trusted-migration-plan-digest <protected-review-digest> \
  --trusted-lineage-digest <protected-current-lineage-digest> \
  --output json
```

The command reads local JSON and writes only sanitized JSON to standard output. It rejects secret-shaped values plus
endpoint-bearing URIs and hostnames instead of copying them into output. It never connects to PostgreSQL, invokes a migration
utility, generates migration commands, calls a cloud API, changes DNS, applies IaC, writes source or target data, or applies
a stage transition. Exit status is `0` only for `ready-for-cutover-review`, `1` for blocked or stale evidence, and `2` for
invalid, endpoint-bearing, or secret-bearing input.

| Contract | Purpose |
|---|---|
| `postgresql-rehearsal-evidence.schema.json` | Versioned, expiry-bounded evidence for model prechecks, initial load, optional catch-up, schema/row/object/data validation, cutover and rollback readiness, source authority, replay lineage, and redaction |
| `postgresql-rehearsal-lineage.schema.json` | Read-only accepted evidence-set history used to reject replay and bind the next attempt ordinal |
| `postgresql-rehearsal-plan.schema.json` | Deterministic checks, stage gates, immutable bindings, validation summary, unresolved checks, human prerequisites, and the execution-disabled safety boundary |

The rehearsal planner regenerates the PR #22 plan from its exact versioned input, requires byte-semantic equality with the
supplied plan, checks the independently trusted plan digest, and rejects blocked, downgraded, tampered, or write-capable
plans. Evidence must bind the source assessment, migration plan, migration identity, selected Azure PostgreSQL target and
region, exact engine, regional decision and selected-evidence digests, target migration-evidence digest, strategy, scope,
validation plan, rollback plan, and accepted lineage. Reused evidence-set IDs, inconsistent ordinals, target mismatches,
stale evidence, or omitted required fields fail closed. The caller must supply an explicit trusted `--as-of` time; the
planner reevaluates migration/regional planning times plus source-assessment, selected-regional, target-migration,
rehearsal, and accepted-lineage observation and expiry bounds at that time against the digest-bound regional evidence-age
and assessment-age policies. Regional planning cannot postdate its parent migration plan, and rehearsal evidence cannot
predate either bound plan or the accepted-lineage snapshot it binds. Every upstream planning/evidence timestamp must include
`Z` or an explicit offset and represent a valid calendar date; the evaluation time is normalized before digest binding.

The trusted migration-input, plan, and current-lineage digests must come from a protected review or approval system
independent of the artifact bundle. The complete input digest prevents timing or freshness-policy fields omitted from the
PR #22 output from being relaxed. The planner is intentionally stateless and never marks evidence consumed; reviewers must
advance the protected lineage after acceptance. Replaying an evidence set already present in that authoritative lineage,
or replaying an older lineage whose digest no longer matches the protected current digest, blocks.

Offline dump/restore remains the default represented strategy. Logical-replication catch-up is accepted only when the
bound migration plan selected `online-logical-replication` and the evidence explicitly records permission, a lag bound,
and final lag within that bound. An offline plan must mark catch-up as not applicable. This is representation of supplied
evidence only; neither path can execute from this repository surface.

Validation requires schema compatibility, an exact expected catalog object count, one unique exact-parity row-count result
for every assessed table whose source count also matches the bound assessment (evidence-defined tolerances are rejected),
and the exact application smoke-test/query references carried by the migration plan.
Data verification must use full or chunked checksums at 100 percent coverage, or an explicitly bounded sample with nonzero
coverage, a dataset-consistent sample size, and an opaque risk-acceptance reference. Online catch-up lag must remain within
both the migration plan's estimated data-loss bound and the assessed RPO. A passing result is only eligible for human
cutover review: source-of-truth transfer, cutover, rollback, DNS, credential, and application changes remain unapplied and
require current live-owner confirmation.

This additive planning contract does not affect Bicep or Terraform parameters, resources, previews, or apply surfaces, so
no IaC parity change is required.

## Approval-bound, execution-disabled contract

[PR #24](https://github.com/ricmmartins/sslz/pull/24) implemented the contract evaluator for a possible future
write-capable migration path, not the writer itself. It consumes the exact source assessment, migration input and plan,
rehearsal evidence and report, a current execution lineage, independently signed live-condition attestations, eight
separately signed stage approvals, and a protected trust manifest:

```bash
node scripts/startup-postgresql-execution-plan.mjs plan \
  --source-assessment <source-assessment.json> \
  --migration-plan-input <migration-plan-input.json> \
  --migration-plan <migration-plan.json> \
  --rehearsal-evidence <rehearsal-evidence.json> \
  --rehearsal-plan <rehearsal-plan.json> \
  --execution-request <execution-request.json> \
  --live-evidence <live-evidence.json> \
  --approvals <stage-approvals.json> \
  --current-lineage <execution-lineage.json> \
  --trust-manifest <protected-trust-manifest.json> \
  --trusted-trust-manifest-digest <out-of-band-protected-manifest-digest> \
  --as-of <trusted-evaluation-time> \
  --trusted-evaluation-time-digest <out-of-band-protected-time-digest> \
  --output json
```

The evaluator reads local JSON and writes sanitized JSON to standard output only. Exit status is `0` when the complete
execution contract is satisfied, `1` when a check blocks or requires current evidence, and `2` for invalid, secret-bearing,
endpoint-bearing, or incomplete input. An eligible result is not an execution result: `executionPerformed` and every
operation field remain false or `none`, and no command text is generated.

The normalized evaluation time must match a separately supplied protected digest; a caller cannot make expired evidence
current merely by changing `--as-of`. Approvals must postdate the request, rehearsal/live evidence, and the protected
current-lineage snapshot, and must remain current at that trusted evaluation time.

| Contract | Purpose |
|---|---|
| `postgresql-execution-request.schema.json` | Exact environment, source, target, strategy, idempotency identity, lineage transition, and eight distinct stage authorities |
| `postgresql-execution-evidence.schema.json` | Separately signed live source catalog, target/region/capacity, secret-reference metadata, private connectivity, DNS/application, recovery/window/owner, provider/IaC, and optional online-replication evidence |
| `postgresql-execution-approval.schema.json` | Separate signed approvals for rehearsal execution, initial load, CDC/catch-up, write freeze and connection drain, cutover readiness, source-of-truth transfer, rollback, and failback |
| `postgresql-execution-lineage.schema.json` | Current environment/target state, monotonic attempt history, idempotency identities, and consumed nonces |
| `postgresql-execution-trust.schema.json` | Independently protected artifact, attestation, and approval digests plus stage- or evidence-restricted Ed25519 public keys; the complete manifest is pinned by a separately supplied protected digest |
| `postgresql-execution-plan.schema.json` | Deterministic checks, eligibility, sanitized planned actions, explicit rollback boundaries, unapplied lineage transition, and no-operation safety boundary |

Offline dump/restore is the first-class path. Its CDC authority must still issue a separate signed `not-applicable`
decision with no granted CDC capability; omission or reuse cannot be substituted by another approval. Online logical
replication is accepted only when the bound migration and rehearsal plans both selected it and a separate restricted
signer attests current CDC permission, logical-replication readiness, and replica-identity review.

Every attestation signs the complete evidence-envelope binding digest. Every approval binds the exact request (including
its timestamp), source assessment, migration plan, rehearsal report, live-evidence bundle, current lineage, environment,
target, strategy, strategy-specific predecessor/successor state and branch, idempotency identity, rollback boundary,
action digest, and exact capability digest. The evaluator also confirms the public key is actually Ed25519 rather than
trusting an algorithm label. It rejects stale artifact reuse, mismatched environment or target, partial or duplicate approval sets,
out-of-order stages, replayed nonces, non-monotonic lineage, approval substitution, capability widening, strategy downgrade,
invalid signatures, modified signed claims, and omitted evidence.

The files under `agent/examples/postgresql-execution-*.json` are sanitized schema specimens whose zero digests and placeholder
signatures are deliberately non-operational. The test suite generates ephemeral Ed25519 identities in memory and covers
positive offline and online planning plus stale, partial, tampered, replayed, duplicated, omitted, widened, downgraded, and
out-of-order cases without persisting private signing material.

Accepted lineage entries represent atomic execution-attempt outcomes. A later attempt is permitted only after the prior
attempt's protected lineage outcome has returned to `rehearsal-reviewed`; ordinals, execution IDs, idempotency keys, and
nonces must still advance without gaps or reuse.

This contract adds no Bicep or Terraform parameter, resource, preview, apply, or state surface. Provider/IaC readiness is
an opaque signed evidence binding only, so existing Bicep and Terraform remain intentionally unchanged.

## Identity and invalidation

The migration identity binds the source assessment digest and freshness, selected PostgreSQL decision/evidence digests,
target migration evidence digest, exact target region/version, strategy, scope, accountable owner, RTO/RPO/downtime,
validation plan, and rollback plan. The result emits the same binding for readiness, IaC, manifest, and approval identities
with `migrationExecutionEligible: false`.

Any source assessment mutation, stale/future/expired evidence, omitted object or database, replayed target evidence,
source/target mismatch, changed target region/version, strategy/scope/owner change, or validation/rollback change produces
a different plan and migration identity or a blocking check. A later execution PR must copy and verify these bindings in
actual execution artifacts; this increment deliberately provides no migration executor or approval transition.

## Human and live confirmation

Before any future migration can proceed, humans must confirm the current source catalog, maintenance window, source
authority, target capacity, private connectivity, DNS, migration-tool availability, application write-freeze and pool
draining, role/ownership/RLS/collation/extension/large-object transformations, rehearsal evidence, validation thresholds,
cutover authority, and rollback authority. Supplied synthetic or local metadata cannot prove those live conditions.
