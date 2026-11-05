# Greenfield acceptance workload

This is a deliberately small Azure Container Apps acceptance service for the
user-assigned managed identity → private Blob Storage path. It is not a SaaS/API
product and has no AI functionality.

Configure `AZURE_CLIENT_ID` (the user-assigned identity's client ID),
`BLOB_ACCOUNT_URL` (an `https://<account>.blob.core.windows.net` URL), and
`BLOB_CONTAINER=acceptance`. `PORT` is optional and defaults to `8080`. The
container must already exist. The service uses only `ManagedIdentityCredential`
and the Azure Blob SDK; it does not accept keys, connection strings, or public
storage endpoints.

At startup it resolves the Blob hostname to IPv4 and refuses readiness unless
every returned address is RFC1918-private. It then obtains a token for the
configured identity and writes and reads back the fixed
`_sslz-acceptance-canary` blob. That small canary remains in the container.
Checks repeat every five seconds after each attempt, including after success,
so role-assignment propagation can recover and lost DNS or data access revokes
readiness without making the liveness endpoint fail. Each check has a 15-second
deadline; readiness is false during revalidation. Periodic canary overwrites
create storage versions when versioning is enabled; this is a bounded acceptance
workload, not a long-running production canary.
Grant the identity the Blob data permissions needed for this operation. Only
`GET /healthz` (liveness) and `GET /readyz` (dependency-backed readiness) are
implemented; there is no data or mutation API. Readiness responses expose only
`ready` or `not_ready`, while logs use stable error codes and never include SDK
errors or credential data.

Run `npm ci` and `npm test` locally. Local tests use injected DNS and storage
adapters and do not prove Azure connectivity or permissions. Build and deploy
the image through the approved executor, record the resulting immutable image
digest there, and validate the live private DNS and managed-identity data path
separately. This source intentionally does not invent an image digest or
perform Azure operations.
