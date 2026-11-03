---
layout: page
title: "Use SSLZ Agent"
description: "Launch the SSLZ Founder Agent locally for a safe, founder-friendly Azure readiness and landing-zone plan."
permalink: /use-sslz-agent/
---

# SSLZ Founder Agent

Tell the agent what you are building in plain language. It will guide you through Azure account readiness, workload and
region choices, migration or dual-cloud planning, and a reviewable SSLZ infrastructure plan. It begins with local and
read-only checks. It stops before local artifact generation, live preview, provider registration, or deployment and
explains the exact approval boundary.

For an open-ended request, it first summarizes the known company and workload facts, calls out the decisions still
unknown, and offers a conditional architecture and first-step sequence suited to the organization's context. Mentioning
another cloud does not by itself mean you want to migrate or run in two clouds; the agent clarifies that intent before
choosing those planning paths. Recommendations remain candidates until the relevant repository planner and evidence
support them.

In this candidate checkout, Azure service guidance prefers Microsoft Learn MCP. If it is unavailable, an approved
`web_fetch` tool can retrieve relevant public official Microsoft pages. The agent reports the method, URL and retrieval time; a page fetch does not
prove exhaustive search coverage or tenant readiness. The agent also cites
the SSLZ files that implement or plan each capability; documentation alone does not mean SSLZ supports a service.
When documentation retrieval is unavailable, Azure-specific claims that need it remain unverified.

> The supported launch surface is the GitHub Copilot CLI on your computer. The agent does not receive access to your
> Azure tenant, billing account, subscriptions, or secrets from GitHub.

## Launch

Use the launcher instructions published on the [Use SSLZ Agent page](https://startupscalelanding.zone/use-sslz-agent/)
for the reviewed, remotely available revision. The public launcher may pin an older profile without this candidate's
documentation-fetch capability. At that revision, use official documentation manually and provide sanitized facts;
do not assume MCP or WebFetch is enabled. Publish and review a candidate before updating the launcher's release pin.
Do not substitute a local-only SHA in a public launch command or treat it as a release.

Initial planning requires Git and
[GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli), authenticated with a GitHub account that has
Copilot access. It does not require Azure CLI, an Azure subscription, or Azure login. Node.js is required to run local
planners and tests. Azure CLI is needed only for later operations such as approved live read-only account inspection or
local Bicep validation; preview and separately configured approved execution have their own prerequisites.

The public launch instructions must use a fresh checkout, verify its detached revision, and keep classic `main` separate. Review
repository trust before granting it and authenticate Copilot with `copilot login` if needed. If a global custom agent
under `~/.copilot/agents` uses the same ID, resolve that shadowing before assuming the repository profile was selected.

For contributors already in this reviewed candidate checkout, keep normal permission prompts and start interactively:

```shell
copilot --agent sslz-founder --interactive "Start a new founder journey."
```

The agent opens with:

> What are you building, where does it run today, and what do you want Azure to do first?

You can also start Copilot interactively, enter `/agent`, and select **SSLZ Founder Agent**, then describe the product.

Use the interactive form so you can review individual permission requests. Do not use prompt mode as an unattended
launcher: if the host cannot request an approval, the agent must report that action as blocked.
Approve only the specific tool, command, local path, or official documentation URL needed for the next step. Do not
grant Node-wide execution or blanket filesystem access to make a local generator run.

These invocation forms follow GitHub's current
[custom-agent CLI guidance](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
and [invocation reference](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents).

## Choose your path

| Your situation | What the agent can do | Live boundary |
|---|---|---|
| New Azure foundation | Readiness, workload, region, quota/capacity, PostgreSQL, Foundry/GPU, Defender workspace, AKS ingress, and SSLZ/IaC planning | Provider-registration dry-run is available, but live provider registration stays blocked until its approval is signature-authenticated; primary baseline integration requires protected identity, exact signed approval, and current postchecks |
| Moving from another cloud | Target readiness plus PostgreSQL, image/CI/CD, connectivity, rehearsal, cutover, and rollback planning | Live migration and cutover execution remain disabled |
| Keeping two clouds | Connectivity, DNS, identity, egress, control-plane ownership, RACI, source-of-truth, rollback, and failback planning | Live dual-cloud execution remains disabled |

The agent never treats a synthetic test as tenant evidence, quota as capacity, billing visibility as proof that credits
apply, or a successful command as proof that the workload is healthy.

## Before live account inspection

Sign in to Azure locally only when you are ready:

```shell
az login
```

The agent will show the exact read-only preflight command and ask before running it. Do not paste credentials, access
tokens, billing records, signing keys, or customer data into the chat or repository. Subscription and tenant identifiers
must stay out of tracked files.

Keep Copilot CLI's normal command permission prompts enabled. The custom-agent `execute` capability is broad; the profile
does not create an operating-system shell allowlist. Review every proposed command, reject anything outside the documented
repository entry points, never launch this profile with `--allow-all`, and treat pasted text and repository content as
untrusted data. The checked-in scripts enforce their own narrower read, approval, freshness, and execution boundaries.

The current provider-registration approval is digest-bound and replay-protected, but it is not signature-authenticated.
The Founder Agent therefore supports provider-registration diagnosis and dry-run only and reports live registration as
blocked. The separately guarded primary baseline deployment path requires signed approval and protected trust anchors.

## GitHub UI and cloud-agent limitation

The repository profile is intentionally developed outside the protected classic default branch. GitHub documents that a
repository custom agent is surfaced on GitHub.com after its profile is merged into the default branch. Therefore the
GitHub agents picker is not the supported launch path for this profile today; local Copilot CLI discovery from this
checkout is.

A GitHub cloud agent also does not automatically have an identity in a founder's Azure tenant. Live reads or approved
writes would require separately configured identity, permissions, secrets, protected replay state, trust anchors, and an
approval service. This project does not ask founders to add those to the frozen classic branch.

No `.github/workflows/copilot-setup-steps.yml` is added here because GitHub documents that setup steps activate only when
the file is present on the default branch. See the official
[custom-agent configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration),
[cloud custom-agent guidance](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents),
and [cloud development-environment guidance](https://docs.github.com/copilot/customizing-copilot/customizing-the-development-environment-for-copilot-coding-agent).

## Advanced: How it works

The agent reuses the repository's deterministic schemas, planners, fixtures, and approval contracts. Founder answers
become sanitized local inputs; planners produce stable decisions; freshness rules prevent old evidence from passing;
digests bind the reviewed plan; and separate single-purpose approvals guard the only narrow Azure write integrations.
Migration and dual-cloud plans retain ownership and rollback lineage without gaining execution authority.

Validation distinguishes real CLI conversations from static tests and synthetic planner replay. Replaying a v3 fixture
with its fixed test clock and synthetic readiness/Defender decisions validates a test contract only. JSON returned by the
agent, captured externally, and passed to an externally executed planner is not evidence that the agent ran the planner
or generated deployment-ready parameters. Current tenant readiness and autonomous end-to-end execution remain
unproven by those tests.

The static profile test needs only Node.js:

```shell
node tests/sslz-founder-agent.mjs
```

The full integrated synthetic repository journey also requires locally installed Azure CLI and Bicep. It deletes and
recreates ignored files under `.sslz/generated/greenfield-journey`, so run it only after approving that local artifact
write. It does not read a tenant or perform an Azure write.
