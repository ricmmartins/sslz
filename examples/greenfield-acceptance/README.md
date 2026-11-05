# Bounded greenfield acceptance workload

This example contains a real health/readiness service, unlike the infrastructure-only
SaaS/API/AI examples. It is an initial nonproduction acceptance path. It is not a complete
customer application or a production-certified deployment.

`main.bicep` creates a dedicated new resource group. `workload.bicep` creates
Container Apps, managed identity, private Blob Storage and private DNS. The service
under `app` tests identity-based canary read/write over private DNS. Storage versioning
and soft deletion are configured; restore and recovery still require actual exercises.

Use the [signed workload execution runbook](../../docs/greenfield-workload-execution.md).
The executor only accepts a digest-pinned public acceptance image and independently
signed provenance and approval. It rejects existing target/managed groups and any
non-create what-if change. No registry image is published by a local Docker build.

The template creates billable resources, including Container Apps managed networking.
Live execution requires current regional/quota/cost review, a protected executor,
independent authorities, supervised duration and explicit cleanup ownership.
Do not invoke raw deployment commands as a substitute for the signed path.

Initial execution is Bicep-only. Updates, restore, rollback, alert delivery and cleanup
execution are not implemented by this example's executor; follow the runbook's
preservation and recovery boundaries. Migration and dual-cloud remain out of scope.
