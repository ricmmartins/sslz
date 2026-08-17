---
layout: page
title: "Use SSLZ Agent"
description: "Run the SSLZ Founder Agent locally for a safe, founder-friendly Azure readiness and landing-zone plan."
permalink: /use-sslz-agent/
---

Run the **SSLZ Founder Agent** in GitHub Copilot CLI from a local checkout. This page provides setup instructions only:
it does not run the agent, connect to Azure, or receive access to your tenant, subscriptions, billing account, or secrets.

The agent starts with repository reads and local, deterministic checks. It asks before any live read-only Azure
inspection and stops before artifact generation, preview, provider registration, or deployment so you can review the
next action and its approval boundary.

## Run locally

Install [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli), Git, and
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli). Use an Azure identity with read access to the
subscriptions you want inspected.

The agent profile currently lives on the technical implementation branch. Clone that branch and pin the verified
implementation commit:

```shell
git clone --branch agent-aware --single-branch https://github.com/ricmmartins/sslz.git sslz-founder-agent
cd sslz-founder-agent
git checkout --detach b0c24640a833e0302e0edc4a542948301f33bbd2
```

Sign in locally and confirm the subscription context that the agent may inspect:

```shell
az login
az account show --output table
```

Then start the agent from the repository root:

```shell
copilot --agent=sslz-founder
```

Enter `Start a new founder journey.` The agent begins by asking:

> What are you building, who needs it, and is it new on Azure, moving from another cloud, or staying in two clouds?

You can also start `copilot` interactively, enter `/agent`, and select **SSLZ Founder Agent**. For a focused
non-interactive request:

```shell
copilot --agent=sslz-founder --prompt "I am building a B2B API for EU retailers. It is new on Azure, uses PostgreSQL, and must stay in the EU. Start with read-only planning."
```

These invocation forms follow GitHub's
[custom-agent CLI guidance](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
and [invocation reference](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents).

## What it can help with

| Your situation | Planning support | Live boundary |
|---|---|---|
| New Azure foundation | Account readiness, workload and region choices, quota and capacity checks, and a reviewable SSLZ infrastructure plan | Read-only inspection requires your approval; provider registration and deployment remain separately guarded |
| Moving from another cloud | Target readiness, connectivity, data and image migration, rehearsal, cutover, and rollback planning | Live migration and cutover execution remain disabled |
| Keeping two clouds | Connectivity, DNS, identity, egress, ownership, source-of-truth, rollback, and failback planning | Live dual-cloud execution remains disabled |

The agent does not treat a synthetic test as tenant evidence, quota as capacity, billing visibility as proof that credits
apply, or a successful command as proof that a workload is healthy.

## Keep control of your environment

Keep Copilot CLI's normal command permission prompts enabled. The custom-agent `execute` capability is broad; the profile
does not create an operating-system shell allowlist. Review every proposed command, reject anything outside the
documented repository entry points, and never launch this profile with `--allow-all`.

Do not paste credentials, access tokens, billing records, signing keys, customer data, tenant IDs, or subscription IDs
into the chat or tracked files. The agent uses your current local Azure CLI identity only after it shows the exact
read-only command and receives your approval.

## GitHub UI and cloud-agent limitations

GitHub custom-agent discovery on GitHub.com requires the profile to be merged into the repository's default branch. The
profile is intentionally absent from protected classic `main`, so the GitHub agents picker is not a supported launch
path today. Local Copilot CLI discovery from the checkout above is the supported path.

A GitHub cloud agent also does not automatically have an identity in an arbitrary founder Azure tenant. Live tenant
reads would require separately configured identity and permissions. Approved writes would additionally require protected
secrets, replay state, trust anchors, and an approval service. This launcher does not ask you to add those capabilities
to `main`.

See GitHub's [custom-agent configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration)
and [cloud custom-agent guidance](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents)
for the platform behavior behind these limitations.
