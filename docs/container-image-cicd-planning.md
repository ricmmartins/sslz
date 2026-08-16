---
layout: page
title: "Container Image and CI/CD Migration Planning"
nav_order: 8.7
description: "Read-only container image, registry, and CI/CD source assessment and migration planning for Azure Container Registry"
---

# Container Image and CI/CD Migration Planning

## Status

[PR #25](https://github.com/ricmmartins/sslz/pull/25) delivered this planner. It is execution-disabled and validated with
synthetic fixtures and hosted CI; the repository has no current-main live registry, image, pipeline, promotion, cutover,
or rollback evidence. See the [implementation and evidence matrix](implementation-status.md).

This increment assesses supplied container image, registry, and CI/CD metadata and generates a deterministic plan for
moving from AWS ECR, GCP Artifact Registry/GCR, or a generic OCI registry — paired with GitHub Actions, AWS CodeBuild,
GCP Cloud Build, GitLab CI, Jenkins, or Azure DevOps — to Azure Container Registry with a GitHub Actions or Azure DevOps
delivery pipeline. It has no source or target registry connection, image push or pull, pipeline write, cloud operation,
IaC action, DNS change, credential action, or any other write path. It never stores credentials, tokens, secret-bearing
URLs, customer identifiers, or repository contents.

## Validate and plan

```bash
node scripts/startup-container-image-cicd-plan.mjs plan --input agent/examples/container-image-cicd-plan-input.json --output json
```

The command writes JSON to standard output only. Exit status is `0` for a complete plan, `1` for a blocked plan, and `2`
for invalid or secret-bearing input. The checked-in example is synthetic and contains only non-secret metadata and opaque
references.

## Contracts and evidence

| Contract | Purpose |
|---|---|
| `container-image-cicd-source-assessment.schema.json` | Versioned non-secret source metadata for the registry, images (platforms, digests, tags, signatures, attestations, provenance, SBOM, base image, vulnerabilities), and CI/CD (triggers, protected branches, environments, runner identity/egress, secret references, promotion, deployment targets), plus governance and source-of-truth ownership |
| `container-image-cicd-plan-input.schema.json` | Source assessment, the Azure Container Registry and CI/CD target evidence, region policy, migration scope, requirement policy, transition decisions, replay lineage, and optional program integration bindings |
| `container-image-cicd-plan.schema.json` | Compatibility results, transition strategy, stage gates, detailed transition plan, immutable identity bindings, human confirmations, and the execution-disabled safety boundary |

The source assessment accepts opaque secret references, image and base-image digests, and owner references, never secret
material or credential-bearing endpoints. Password/token/connection-string/private-key/client-secret/access-key keys and
private-key, credential-bearing URI, AWS access-key, and JWT-shaped values fail validation before any evaluation.

## Enforcement

The evaluator checks, and blocks on failure of, every one of these controls:

- **Digest pinning and no mutable-tag trust** — every image and deployment reference is pinned by immutable digest,
  mutable-tag deploys are disabled, and tag immutability is enabled on the source and target registries.
- **Signatures, SBOM, provenance, and unsigned/unattested promotion policy** — every image is signed, carries a
  supported-format SBOM, and has provenance whose subject digest matches the artifact; the target enforces verification;
  and promotion requires signatures and attestations, so unsigned or unattested images cannot be promoted.
- **Multi-arch compatibility and provenance continuity** — required platforms are present, every image platform is
  supported by the target, and the target preserves the digest on promotion.
- **Base image support and vulnerability policy** — base images are in scope and supported, and every image has a current
  scan within the critical and high vulnerability policy.
- **Registry control parity** — target replication, retention, encryption (including customer-managed keys when required),
  and private-network posture meet the configured policy.
- **Least privilege, environment separation, and secret hygiene** — federated least-privilege runner identity with
  controlled egress, separated nonproduction and production environments with isolated secrets and identity and required
  reviewers, and external-managed secret references only.
- **Governed triggers, promotion, and deployment targets** — restricted build triggers, protected branches, digest-immutable
  and approval-bound promotion, and digest- and approval-bound deployment targets.
- **Dual-publish, cutover, and rollback** — a bounded dual-publish window binding the exact source and target registries,
  plus a complete rollback plan with source-registry failback.
- **Freshness, tamper/replay protection, and explicit source-of-truth ownership** — the source assessment, target evidence,
  and attempt lineage are current; provenance discontinuity (a tampered attestation subject) and replayed ordinals, nonces,
  or assessments fail closed; and the source registry remains authoritative until an approved cutover completes.
- **Fail-closed manual review** — unsupported registry/CI-CD pairings, missing evidence, or any unsatisfied control block
  the plan and select `blocked-manual-review`.

## Strategy and stages

The planner selects exactly one strategy: `dual-publish-cutover` when every cataloged check passes, or
`blocked-manual-review` otherwise. Every result contains gates for `assess`, `prepare-registry`, `configure-pipeline`,
`dual-publish`, `validate`, `cutover`, `verify`, `rollback-required`, and `completed`. All gates set `executionAllowed` to
`false`; downstream stages remain pending human confirmation even when the plan is complete.

The detailed transition plan records prerequisites, unsupported findings, required remediations, registry and pipeline
configuration, image promotion, validation, cutover, rollback, source-of-truth rules, cleanup, and unresolved decisions.
These are reviewed instructions, not executable commands. The planner emits no shell, cloud, registry, or build commands.

## Identity and integration

The container identity binds the source assessment digest and freshness, target registry and CI/CD evidence digests,
region policy, requirements, transition decisions, scope, accountable owner, replay lineage, and optional program
integration digests (workload profile, regional plan, IaC plan, readiness evidence, deployment manifest, deployment
approval, and PostgreSQL migration identity). The result emits the same binding for readiness, IaC, manifest, and approval
identities with `executionEligible: false`. Any assessment mutation, stale or replayed evidence, changed target, or
decision change produces a different plan and identity or a blocking check. A later execution increment must copy and
verify these bindings; this increment deliberately provides no executor or approval transition.

This additive planning contract does not affect Bicep or Terraform parameters, resources, previews, or apply surfaces, so
no IaC parity change is required.

## Human and live confirmation

Before any future container image or CI/CD transition can proceed, humans must confirm the current source registry catalog
and tag/digest accuracy, target registry capacity and controls, signature/SBOM/provenance/vulnerability evidence for every
promoted image, CI/CD source-of-truth ownership and protected branches/environments and runner identity, and the
dual-publish window, cutover authorization, traffic shift, secret rotation, and rollback authority. Supplied synthetic or
local metadata cannot prove those live conditions.
