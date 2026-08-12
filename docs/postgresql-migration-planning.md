---
layout: page
title: "PostgreSQL Migration Planning"
nav_order: 8.4
description: "Read-only source assessment and migration planning for Azure Database for PostgreSQL"
---

# PostgreSQL Migration Planning

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
