---
layout: page
title: "Control-Plane Ownership Planning"
nav_order: 16
description: "Deterministic read-only ownership and RACI assessment for dual-cloud migration"
---

# Control-Plane Ownership Planning

The control-plane ownership planner is a dependency-free local JSON evaluator. It defines who is accountable,
responsible, consulted, informed, and independently approving each migration control plane. It does not grant any
authority and does not execute a handoff.

Run the checked-in synthetic AWS example with:

```bash
node scripts/startup-control-plane-ownership-plan.mjs plan \
  --input agent/examples/control-plane-ownership-plan-input.json \
  --trusted-bindings agent/examples/control-plane-ownership-trusted-bindings.json \
  --output json
```

The command reads two local JSON files and writes one JSON document to standard output. It performs no network, cloud,
DNS, certificate, secret, pipeline, database, application, recovery, or IaC operation.

## Authority matrix

The plan covers these control planes in every ownership state:

- DNS zones, records, and resolvers;
- certificate issuance and renewal;
- secret stores, references, and rotation;
- CI/CD pipelines and runners;
- artifact promotion;
- observability, telemetry, and alert routing;
- incidents, on-call, and escalation;
- feature flags and runtime configuration;
- deployment authority;
- database and application writes;
- source-of-truth transfer;
- backup and restore;
- cutover, rollback, and failback.

The only accepted opaque role types are source cloud, Azure, shared platform, application, security, network, database,
and incident. Role references cannot contain names, email addresses, tenant or subscription identifiers, credentials,
or secrets.

Each capability has exactly one accountable role and explicit responsible, consulted, and informed sets. Sensitive
capabilities also require an approval authority that is different from both the accountable role and every responsible
role. DNS, certificate, CI/CD, write, recovery, and source-of-truth ownership must resolve to the expected functional
role and one source-cloud, Azure, or shared authority scope.

## State and handoff model

The fixed state order is:

1. coexistence;
2. pre-cutover;
3. cutover;
4. post-cutover;
5. rollback;
6. failback.

Every accountable-role or authority-scope change requires one accepted handoff. The handoff binds the prior and next
state, capability, offering role, accepting role, independent approval role, observation and expiry times, and a unique
nonce into an exact digest. Source-of-truth changes also require an explicit transfer approval. The planner rejects
missing or additional handoffs, stale or tampered evidence, replayed nonces or digests, circular escalation, gaps in
attempt history, and duplicate or out-of-order states.

## Program lineage integration

The ownership input consumes protected exact digests for the predecessor program-lineage envelope and identity,
connectivity plan, PostgreSQL migration plan, container image and CI/CD plan, readiness evidence, IaC plan, deployment
manifest, and deployment approval. It also binds the exact environment and target reference.

The program-lineage builder first reproduces its five-stage predecessor envelope. It passes those exact identities to
the ownership planner and appends the canonical ownership plan digest as a sixth stage. This avoids a circular digest
while preserving the predecessor envelope as the immutable handoff boundary. Legacy five-stage envelopes remain
validatable; new canonical journeys emit the six-stage chain.

The canonical report references both the final envelope and the separate ownership plan by exact digest. Any upstream
artifact, target, environment, ownership matrix, transition, or handoff mutation changes or blocks the downstream
identity.

## Authority boundary

The Phase 5 provider-registration and Phase 6 baseline deployment authorities remain separate. Neither can authorize
provider registration, deployment, DNS, certificates, secrets, CI/CD, database or application writes, traffic changes,
backup, restore, cutover, rollback, or failback under this contract.

Every planned action is a non-executable representation. `executionEnabled`, `executionEligible`, and
`executionAllowed` remain false. Live use still requires protected current evidence, capability-specific approvers,
approved handoffs, protected replay state, rehearsed rollback and failback, and separate authorized executors.
