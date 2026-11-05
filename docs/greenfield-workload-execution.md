---
layout: agent
permalink: /agent/docs/greenfield-workload-execution/
title: "Bounded Greenfield Workload Execution"
nav_order: 8.8
description: "Signed initial Container Apps acceptance deployment with managed identity and private Blob Storage"
---

## Supported scope

The local candidate adds an initial, nonproduction acceptance workload at
`examples/greenfield-acceptance`. It runs a small Node.js service on Container Apps,
uses a user-assigned managed identity, and tests Blob Storage through private DNS
and a private endpoint. This is a new bounded path, not an extension of the Phase 6
baseline allowlist. It does not deploy arbitrary customer applications or the
SaaS, API, or AI examples. Terraform workload execution is not implemented.

Offline tests, a compiled template, and a locally built container are not live
acceptance evidence. This path remains unavailable for live execution until an
independently protected builder, approver, executor, resource inventory, regional
availability/quota review, and cost/cleanup review are configured and verified.
See [production executor operations](/agent/docs/production-executor/).

## Resource and application boundary

The subscription-scope Bicep entry point creates one dedicated
`rg-sslz-<runName>` resource group, with:

- a VNet and separate Container Apps and private-endpoint subnets;
- a Consumption workload-profile environment, one app, one replica and TLS ingress;
- one managed identity with Blob Data Contributor scoped to the `acceptance` container;
- a Standard LRS storage account with shared keys, public blob access and public network access disabled;
- Blob versioning/one-day soft deletion, a private endpoint, private DNS zone and VNet link.

Container Apps also creates a managed `ME_sslz_<runName>` infrastructure group.
Both group names must be absent before preview and again before deployment.
The subscription deployment name `sslz-<runName>` must also be unused; an existing
deployment record is never overwritten by this path.
The environment's managed load balancer/public IPs, replica, private endpoint,
DNS, storage versions and data transfer can incur costs. The app deliberately
has public HTTPS health ingress; its Blob data path must be private. Application
logs are not sent to a paid workspace by this acceptance template. Alert delivery
and a production monitoring configuration are separate acceptance requirements.

The service's readiness check resolves the Blob hostname to private IPv4
addresses and uses managed identity to write and read back a canary. Liveness
does not depend on Blob readiness. Public endpoints accept no application data
or mutation commands. Readiness is an application observation, not an Azure SLA.

## Inputs and exact binding

Use the official workload planner with a valid `startup-input` JSON. This path
accepts only a ready Container Apps result, no PostgreSQL/Foundry/GPU extensions,
`single-region-ready` reliability, and the explicitly designated nonproduction
subscription. Unknown requirements must not be changed merely to fit this path.
The executor reruns `planWorkload` and requires the exact same result.

The request follows
[`greenfield-workload-request.schema.json`](/agent/schemas/greenfield-workload-request.schema.json),
an exact JSON object, version `1.0.0`, containing:

| Field | Required value |
|---|---|
| `tenantId`, `subscriptionId`, `attemptId` | Lowercase UUIDs; target must match the authenticated Azure account |
| `runName` | 6-16 lowercase alphanumeric characters, beginning with a letter |
| `location` | Explicit lowercase Azure region, independently checked for services, capacity and cost |
| `image` | `ghcr.io/ricmmartins/sslz-acceptance@sha256:<64 lowercase hex characters>`; tags are rejected |
| `requirementsDigest`, `planDigest` | SHA-256 of each complete canonical JSON document, using exported `digest`; not the baseline's differently defined plan digest |
| `expiresAt` | UTC timestamp after the current time, no more than four hours ahead |
| `maximumCostUsd`, `maximumActiveHours` | Positive numbers, at most 20 and 4 respectively |

These are bounded acceptance limits, not a configurable production offering.
The cost field is an approved ceiling, **not an enforced billing cap**. No Azure
budget or automatic timer can guarantee that Azure charges stop at that value.
Before any live execution, estimate costs, retain the exact ownership inventory,
establish a cleanup deadline and independently supervise cleanup. Do not start
the test when those operational protections are absent.

The emitted manifest binds the entire request, requirements, recomputed planner
result, Bicep source digest, complete application source digest, compiled template,
parameters, create-only what-if changes, timestamp and effective replay-store ID.
Application source includes Dockerfile, Docker ignore rules, dependency manifests,
and every regular file under `app/src`; links are rejected. Raw inputs and the
preview can contain internal identifiers. Keep them in protected ignored storage,
not chat, tracked files or public artifacts.

## Protected preview

Provision the fixed `.sslz/deployment-state` store through the independently
reviewed executor bootstrap. The CLI has no store override and does not create
trust or replay infrastructure.

```bash
node scripts/production-executor-readiness.mjs --provider bicep --workload greenfield-acceptance
node scripts/greenfield-workload-execution.mjs preview \
  --request <acceptance-request.json> \
  --requirements <startup-input.json> \
  --plan <workload-plan.json>
```

Preview uses the explicitly selected subscription for every Azure read. It
requires Azure public cloud, the exact enabled tenant/subscription, and absent
test/managed groups. It compiles only the fixed Bicep entry point, runs subscription
what-if and rejects every non-Create change, change outside the new workload group,
empty result, or missing group creation. An unsupported/indeterminate what-if
result blocks execution; it is not silently treated as a clean preview.

The preview writes temporary compiled files locally and removes them on exit.
It performs no deployment create operation. It still requires separately approved
Azure reads and live preview permission.

## Independent image provenance and approval

Configure two distinct protected Ed25519 public keys:

- `SSLZ_WORKLOAD_APPROVAL_PUBLIC_KEY_FILE`
- `SSLZ_WORKLOAD_IMAGE_PROVENANCE_PUBLIC_KEY_FILE`

Both use absolute regular non-linked files. Distinct fingerprints are checked
locally; organizational independence, owner/parent ACLs, authorized reviewer
policy and actual builder provenance must be verified externally. Neither private
key belongs in the executor, repository jobs, generated examples or chat.
The repository supplies no command to approve its own execution.

An approval has exactly `schemaVersion`, `manifestDigest`, `stateStoreId`, `nonce`,
`approvedAt`, `expiresAt`, `keyId`, and `signature`. Version is `1.0.0`; nonce is a
fresh UUID; `stateStoreId` is the effective protected store identity, not merely
the marker UUID. Approval TTL is at most four hours and cannot outlive the request.

Image provenance has exactly `schemaVersion`, `image`, `applicationSourceDigest`,
`issuedAt`, `expiresAt`, `keyId`, and `signature`. It uses version `1.0.0` and at most
a 24-hour validity window. The independent builder must actually build and inspect
the referenced source/context and registry manifest before signing. A local Docker
image/configuration ID is not a registry manifest digest. Do not sign invented
digests or assume that a passing local build published an image.

For each artifact, `keyId` is the SHA-256 SPKI DER public-key fingerprint.
Sign the UTF-8 bytes of the applicable domain, a NUL byte, and canonical sorted-key
JSON excluding only `signature`. The domains are:

| Authority | Signing domain |
|---|---|
| Workload approval | `sslz-greenfield-workload-approval-v1` |
| Image builder | `sslz-greenfield-image-provenance-v1` |

## Initial apply and postchecks

After review, current prerequisites and independent signatures:

```bash
node scripts/greenfield-workload-execution.mjs apply \
  --manifest <reviewed-manifest.json> \
  --approval <signed-workload-approval.json> \
  --image-provenance <signed-image-provenance.json>
```

Apply validates the request/planner/source/signatures/store before Azure calls.
It atomically reserves both the nonce and the target group in the fixed durable
store. Reservations remain consumed, including failures; another approval cannot
retry an unresolved target. It recompiles the fixed profile, checks the exact
signed template, snapshots the compiled template/parameters, repeats what-if,
requires the same create-only changes, checks both groups again, and rechecks
expiry immediately before one subscription deployment.

Postchecks read the exact app, image digest, environment, user-assigned identity,
identity client ID, Blob endpoint/container, and disabled public/shared-key
storage settings. HTTPS readiness uses only the observed Container Apps hostname,
rejects redirects and bounds response size/time. A successful result always
reports `productionReady: false`; it proves only this initial acceptance path
when the observations were live.

After any attempted write, cleanup remains due even on success. A CLI failure,
unknown outcome or failed postcheck reports `cleanup-required`. Preserve the
immutable reservations and completion records. Do not erase them or invent a new
group name to bypass unresolved cleanup.

The executor flushes each record and, on POSIX, the containing directory before
deployment. Windows directory flushing is not implemented. The operator must
verify the protected storage's persistence and recovery guarantees on the actual
executor host; passing filesystem tests or creating a store marker is insufficient.

## Recovery and cleanup limitations

This initial executor intentionally implements no update, automatic resume,
restore, rollback, alert-delivery test or deletion command. Blob versioning is
configured but backup/restore has not thereby been demonstrated. Live evidence
for those operations and accountable incident ownership remains required.

Cleanup must identify only this attempt's newly created workload and managed
resources, preserve all shared trust/replay/state services and existing resources,
respect service-managed group lifecycle, and verify residuals and delayed charges.
Never delete or modify an unrelated group or unregister shared providers.

## Offline verification

```bash
npm ci --prefix examples/greenfield-acceptance/app
npm test --prefix examples/greenfield-acceptance/app
node --test tests/greenfield-workload-execution.mjs
az bicep build --file examples/greenfield-acceptance/main.bicep --stdout | node tests/greenfield-acceptance-template.mjs
```

All Azure calls in the Node executor tests are mocks, with synthetic signing
identities and isolated temporary replay files. The template assertion consumes
an actual compiled Bicep template, not an Azure deployment. CI runs application
tests on Node 22. Neither fixture authority nor checked-in timestamps authorize
real execution.
