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
