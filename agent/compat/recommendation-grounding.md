# Recommendation grounding

The Founder Agent combines two separate kinds of evidence for each Azure recommendation:

1. **Azure guidance:** use Microsoft Learn MCP search with a sanitized, workload-specific query. Fetch the relevant
   Microsoft Learn page before relying on details that affect architecture or prerequisites. Cite the actual official
   URL returned by retrieval and summarize only claims supported by that page.
2. **SSLZ support:** inspect the relevant local planner, profile, schema, example, script, and
   [implementation status](/agent/docs/implementation-status/). Cite repository paths and label the capability as
   planner-supported, planning-only, externally required, or disabled for live execution.

An official Microsoft page establishes what an Azure service can do. It does not establish that SSLZ implements,
generates, validates, or deploys that service. Likewise, an SSLZ profile or planner does not prove that Microsoft
currently offers the service, model, SKU, or capacity for a particular tenant or region.

## Evidence to show

For each recommended service or foundation component, provide:

- the user requirement that makes it relevant;
- the Azure capability claim and an actual Microsoft Learn URL retrieved for this response;
- the SSLZ capability and local file paths that support that exact claim;
- what remains unverified, including implementation gaps, approval boundaries, or required live evidence.

Prefer the smallest set of services supported by confirmed requirements. If required information is missing or
contradictory, preserve the unknown or ask one focused question instead of using a planner default. In particular, do
not infer a compute profile, database, managed model, GPU, or Kubernetes requirement from a company label.

## Retrieval fallback and unavailable documentation

Check whether the documentation search/fetch tools are actually available in the active runtime. Do not assume that a
tool listed in another session or assistant is available to the Founder Agent. If Learn MCP search or fetch is missing
or fails, disclose that specific limitation. Prefer MCP when it works. If an approved `web_fetch` tool is available,
fetch a relevant public HTTPS page on `learn.microsoft.com` or `docs.microsoft.com`, honoring URL approvals and checking
that the final URL after redirects remains official. Use only sanitized technical URLs, never authenticated pages,
customer URLs, identifiers, secrets, or private data. No shell HTTP clients, proxies, installations, or global
configuration changes are permitted.

Report the retrieval method (MCP or web-fetch), actual final URL, and retrieval time. Rely only on content actually
returned. Distinguish retrieval time from an editorial update date; report the latter only if present in retrieved
content, never infer it. A fetched known page provides current page content, not exhaustive search coverage or proof that it is the
latest guidance across all documentation. Note preview status and limitations when the retrieved content identifies
them. A runtime lockdown message is a diagnostic about that invocation, not proof of corporate policy.

If neither approved retrieval method succeeds:

- say that official documentation was not retrieved for this response and identify the actual failure;
- leave Azure capability claims that need that documentation unverified;
- do not invent URLs, present remembered documentation as freshly checked, or use `curl`, browser search, or another
  ad hoc network path as a substitute for the approved retrieval tools;
- continue only with clearly labeled local SSLZ contract facts, sanitized user inputs, and offline planning that is safe
  without the missing documentation;
- ask for a retry or stop before relying on the unverified Azure claim.

Never send company names, user/customer data, tenant or subscription IDs, credentials, workload secrets, or other
confidential details to Microsoft Learn. Search only with the minimum sanitized technical context needed.

## Limits

Learn pages can change. Fetch the selected pages for the current recommendation and treat them as guidance checked at
that time, not as a tenant-specific guarantee. Documentation does not establish account access, provider registration,
policy, billing or credits, regional availability, quota, capacity, model access, support entitlement, or workload
readiness. Those require the applicable current evidence and approvals.

## Verified reference examples

These pages were searched and fetched through Microsoft Learn MCP while this guidance was added. They are starting
points for similar questions, not a fixed citation set for every conversation:

| Topic | Microsoft Learn | Related SSLZ evidence |
|---|---|---|
| Workload reliability and requirements | [Reliability design principles](https://learn.microsoft.com/en-us/azure/well-architected/reliability/principles) | `agent/schemas/startup-input.schema.json`, `agent/profiles/`, `scripts/startup-workload-plan.mjs`, `scripts/startup-regional-plan.mjs` |
| Organization and landing-zone scope | [What is an Azure landing zone?](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/) | `docs/graduation-guide.md`, `docs/implementation-status.md`, `scripts/startup-workload-plan.mjs` |
| Containerized applications | [Azure Container Apps overview](https://learn.microsoft.com/azure/container-apps/overview) | `agent/profiles/container-apps.json`, `scripts/startup-workload-plan.mjs`; cool-profile artifacts are execution-disabled |
| Relational persistence | [Azure Database for PostgreSQL Flexible Server overview](https://learn.microsoft.com/azure/postgresql/flexible-server/overview) | `agent/profiles/postgresql.json`, `scripts/startup-postgresql-plan.mjs`; migration execution is disabled |
| Azure-hosted AI models | [Foundry Models sold by Azure](https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure) | `agent/profiles/foundry.json`, `scripts/startup-regional-plan.mjs`; model and regional evidence is still required |
| Event-driven functions and HTTP APIs | [What is Azure Functions?](https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview) | No dedicated Azure Functions profile or selection exists in `scripts/startup-workload-plan.mjs`; external implementation is required |

This list does not assert that every referenced service is selected, available, or deployable through SSLZ. Use the
capability matrix and the exact implementation paths for the current branch before describing support.
