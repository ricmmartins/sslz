---
layout: page
title: "Program Lineage Envelope"
nav_order: 15
description: "Execution-disabled deterministic lineage across migration and dual-cloud planners"
---

# Program Lineage Envelope

The program-lineage envelope is a versioned, non-executable contract that connects the canonical greenfield baseline to
later migration planning without widening deployment authority. Build and validate it as part of the canonical journey:

```bash
node scripts/validate-greenfield-journey.mjs
```

For focused validation, run:

```bash
node tests/startup-program-lineage.mjs
```

## Identity chain

The envelope binds the canonical workload, regional, PostgreSQL decision, IaC, readiness, deployment manifest, and signed
baseline approval digests. It then chains the real planner outputs in this fixed order:

1. PostgreSQL migration plan;
2. PostgreSQL rehearsal plan;
3. PostgreSQL execution-contract plan;
4. container image and CI/CD plan;
5. dual-cloud connectivity, DNS, identity, and egress plan.

Object keys are canonicalized recursively and arrays retain their order. Each stage digest includes its predecessor,
artifact identity, execution-disabled flags, evidence mode, status, and future authority. The program identity binds the
baseline, lineage nonce and ordinal, and complete stage chain. The envelope digest binds the complete sanitized output.
The lineage builder reruns every planner from the supplied versioned inputs and requires byte-for-byte canonical JSON
equivalence with each supplied output; recomputing a digest over a substituted output is not accepted.

Validation rejects upstream mutation, stale evidence, omission, replay, duplicate or out-of-order stages, target or
environment mismatch, lineage mismatch, and cross-program artifact substitution.

Program generation reevaluates every supplied `observedAt`/`expiresAt` and `issuedAt`/`expiresAt` pair at the envelope
`generatedAt` timestamp. Planner-time `current` labels are not accepted after expiration. PostgreSQL rehearsal and
execution trust arguments are supplied outside the artifact bundle through `--trusted-planner-digests`; the builder does
not derive them from the documents they authenticate. For attempt 2 and later, callers must supply the full protected
previous envelope through `--trusted-previous-envelope`. The new accepted history must exactly append that envelope's
program, lineage, prior history, ordinal, nonce, and digest. The builder deliberately writes no replay state, so a
protected external executor or approval service must retain and supply the trusted inputs.

## Authority and evidence

The existing signed approval remains scoped to `greenfield-platform-deployment-only`. It cannot authorize database
migration writes, image promotion, DNS changes, dual-cloud network operations, identity or egress changes, migration
cutover, rollback, or failback. Those actions require separate future authorities named by each stage.

All envelope stages set `executionEnabled`, `executionEligible`, and `executionAllowed` to false. The builder makes no
network calls, emits no commands, and performs no cloud, database, image, DNS, identity, or IaC operation.

The report distinguishes:

- baseline greenfield deployment readiness under its existing signed approval;
- migration and dual-cloud planning readiness for human review, with no execution authority;
- synthetic evidence used by checked-in validation from future live evidence supplied by protected systems.

## Compatibility

The canonical greenfield report is version `2.0.0`. Version 1 reports are rejected because they lack the required program
identity and readiness separation. The envelope itself starts at version `1.0.0` and is referenced by exact
`programIdentityDigest` and `envelopeDigest`.
