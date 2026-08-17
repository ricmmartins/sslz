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

> The supported launch surface is the GitHub Copilot CLI on your computer. The agent does not receive access to your
> Azure tenant, billing account, subscriptions, or secrets from GitHub.

## Launch

You need [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli), Git, and Node.js. Azure CLI is
needed only when you choose to run live read-only account inspection or a separately configured approved execution.

```shell
git clone --branch agent-aware --single-branch https://github.com/ricmmartins/sslz.git
cd sslz
copilot --agent sslz-founder --interactive "Start a new founder journey."
```

The agent opens with:

> What are you building, who needs it, and is it new on Azure, moving from another cloud, or staying in two clouds?

You can also start Copilot interactively, enter `/agent`, and select **SSLZ Founder Agent**. For a focused
non-interactive request that already describes the product:

```shell
copilot --agent sslz-founder --prompt "I am building a B2B API for EU retailers. It is new on Azure, uses PostgreSQL, and must stay in the EU. Start with read-only planning."
```

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

The static profile test needs only Node.js:

```shell
node tests/sslz-founder-agent.mjs
```

The full integrated synthetic repository journey also requires locally installed Azure CLI and Bicep. It deletes and
recreates ignored files under `.sslz/generated/greenfield-journey`, so run it only after approving that local artifact
write. It does not read a tenant or perform an Azure write.
