---
layout: page
title: "Readiness Evidence Contract"
nav_order: 8.35
description: "Privacy-preserving evidence bound to IaC and deployment approval"
---

# Readiness Evidence Contract

## Purpose

[`readiness-evidence.schema.json`](../agent/schemas/readiness-evidence.schema.json) is the no-write `1.0.0` contract that
must accompany an IaC v3 plan. It does not collect evidence, call Azure, confirm a human action, register a provider, or
deploy anything. It records only supplied status, opaque references, timestamps, bounded measurements, and SHA-256
digests needed to decide whether a reviewed plan is eligible for approval.

The contract deliberately separates:

- `codeEvidence`: authoritative preflight, primary/secondary regional observations, and selected Foundry
  model-version/deployment/quota observations;
- `humanAttestations`: Microsoft for Startups billing/support confirmation, a failover owner and role reference,
  measured recovery results, service-specific recovery tests, and cool-footprint cost provenance.

Human attestations are never inferred from planner output. `pending`, `rejected`, `unmet`, `not-measured`, `fail`, stale,
future-dated, or expired evidence blocks readiness.

## Privacy and evidence references

Use authorization-controlled opaque references such as `attestation.billing-support.001`, role references such as
`role.incident-commander`, and evidence digests. Do not store names, email addresses, support transcript text, billing
documents, access tokens, secrets, connection strings, or signing material. The referenced source remains in its
authoritative protected system.

Every evidence item records its issuer or issuer role, source reference, observed or attested timestamp, expiry, subject
scope, status, and digest. The artifact itself has a canonical SHA-256 `evidenceDigest` computed over every field except
that digest.

## Required consistency

The validator fails closed unless:

- the evidence subject exactly matches the plan ID, tenant, prod/nonprod subscriptions, selected profile version,
  compute profile, extensions, regional mode, and primary/secondary regions;
- the authoritative preflight passes and every item is current;
- billing/support and failover-owner attestations are explicitly confirmed;
- explicit RTO/RPO targets exist and every selected profile has current measured results at or below those targets;
- every selected extension has a passing service-specific recovery test;
- cool infrastructure has a valid `minimum <= maximum` USD range, provenance reference, and exact match to the selected
  regional plan;
- primary and required secondary evidence match their selected roles and regions;
- Foundry selections include current model reference, model version, deployment type, and sufficient quota in every
  selected region.

Missing values are blockers; the validator does not invent owners, targets, measurements, costs, confirmations, model
versions, deployments, quota, or capacity.

## Digest and approval chain

The v3 IaC planner validates freshness and scope before generating review artifacts. It places the full sanitized
artifact in `plan-summary.json`, places its identity/digest/validity window in the canonical decision model, and includes
that binding in the plan digest. Legacy v1/v2 inputs can still be represented locally, but their approval remains
`pending` with `readiness-evidence-required`.

Phase 6 revalidates the full artifact when preparing a Bicep or Terraform preview. The immutable deployment manifest
copies the evidence version, opaque ID, digest, and expiry. The Ed25519 approval repeats and signs those fields.
Immediately before execution, the integration revalidates the plan, evidence freshness, manifest digest, approval
signature, and every binding again. Mutation, omission, stale evidence, replay under another plan ID, target mismatch,
scope mismatch, and profile/region mismatch fail closed.

This does not expand the execution boundary: only the existing primary `single-region-ready` platform baseline is
executable, and no secondary region or workload deployment is added.
