---
layout: page
title: "Readiness Evidence Contract"
nav_order: 8.35
description: "Privacy-preserving evidence bound to IaC and deployment approval"
---

# Readiness Evidence Contract

## Status

The contract and validator are implemented, but checked-in evidence is synthetic. Contract validity does not prove that
the referenced tenant, billing, review, owner, capacity, recovery, or workload evidence exists in a protected live
system. See the [implementation and evidence matrix](implementation-status.md).

## Purpose

[`readiness-evidence.schema.json`](../agent/schemas/readiness-evidence.schema.json) is the no-write `3.0.0` contract that
must accompany an IaC v3 plan. It does not collect evidence, call Azure, confirm a human action, register a provider, or
deploy anything. It records only supplied status, opaque references, timestamps, bounded measurements, and SHA-256
digests needed to decide whether a reviewed plan is eligible for approval.

The contract deliberately separates:

- `codeEvidence`: authoritative preflight, primary/secondary regional observations, selected Foundry
  model-version/deployment/quota observations, and the selected PostgreSQL regional decision/evidence binding;
- `humanAttestations`: Microsoft for Startups billing/support confirmation; explicit security, Azure architecture, and
  Bicep/Terraform parity reviews; a failover owner and role reference; measured recovery results; service-specific
  recovery tests; and cool-footprint cost provenance.

Version `3.0.0` adds the mandatory subscription-topology decision and binds billing/support confirmation to its exact
decision ID and digest. It is the only readiness version eligible for new Phase 6 approval. Human attestations are never
inferred from planner output. External review items carry an explicit
`attestationVersion`, issuer role, opaque reference, scope, timestamp, expiry, and digest. `pending`, `rejected`, `unmet`,
`not-measured`, `fail`, stale, future-dated, or expired evidence blocks readiness.

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
  compute profile, extensions, regional mode, primary/secondary regions, and AKS ingress mode/decision digest;
- the embedded topology decision has a valid self-digest, is current, and exactly matches the subject tenant and
  environment subscriptions;
- the authoritative preflight passes and every item is current;
- billing/support is explicitly confirmed for the exact topology decision ID and digest, and the security, Azure
  architecture, and Bicep/Terraform parity reviews are explicitly approved;
- explicit RTO/RPO targets exist and every selected profile has current measured results at or below those targets;
- every selected extension has a passing service-specific recovery test;
- cool infrastructure has a valid `minimum <= maximum` USD range, provenance reference, and exact match to the selected
  regional plan;
- primary and required secondary evidence match their selected roles and regions;
- Foundry selections include current model reference, model version, deployment type, and sufficient quota in every
  selected region;
- a selected PostgreSQL profile includes a current canonical decision for the exact primary region, eligible selected
  evidence, exact fallback rationale, provider-equivalent parameters, and the `planning-only`/no-Azure-operation boundary.

Missing values are blockers; the validator does not invent owners, targets, measurements, costs, confirmations, model
versions, deployments, quota, or capacity.

Billing/support confirmation uses an opaque reference and cannot override observed evidence that benefits are associated
with another subscription or billing profile. The contract does not contain support transcripts, billing identifiers, or
documents. Azure Billing Support must resolve billing-account/profile visibility; Microsoft for Startups Program Support
must resolve startup entitlement or benefit-association questions.

## Digest and approval chain

The v3 IaC planner validates freshness, topology identity, and scope before generating review artifacts. It places the
full sanitized artifact in `plan-summary.json`, places the readiness and topology identities/digests/validity windows in
the canonical decision model, and includes those bindings in the plan digest. For PostgreSQL it also binds the full
decision, selected evidence digest, fallback rationale, and provider-parameter digest. Legacy v1/v2 inputs can still be represented
locally, but their approval remains
`pending` with `readiness-evidence-required`.

For AKS, readiness binds the explicit ingress mode and decision digest. The manifest and approval additionally bind the
postcheck digest so changing the service type, frontend exposure, backend NodePort, probe, source prefixes, or evidence
expectations invalidates approval.

Phase 6 revalidates the full artifact when preparing a Bicep or Terraform preview. The immutable deployment manifest
copies the evidence version, opaque ID, digest, expiry, topology decision ID/digest, and exact environment mapping. The
manifest also copies the PostgreSQL decision and selected-evidence digests when that profile is selected. The Ed25519
approval repeats and signs those fields.
Immediately before execution, the integration revalidates the plan, evidence freshness, manifest digest, approval
signature, and every binding again. Mutation, omission, stale evidence, replay under another plan ID, target mismatch,
scope mismatch, profile/region mismatch, or changing PostgreSQL fallback after approval fail closed.

This does not expand the execution boundary: only the existing primary `single-region-ready` platform baseline is
executable, and no secondary region or workload deployment is added.
