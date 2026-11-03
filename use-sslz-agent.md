---
layout: page
title: "Use SSLZ Agent"
description: "Start local Azure adoption planning with SSLZ Agent in GitHub Copilot CLI."
permalink: /use-sslz-agent/
---

Run **SSLZ Agent** in GitHub Copilot CLI from a local checkout. This page provides setup instructions only:
it does not run the agent, connect to Azure, or receive access to your tenant, subscriptions, billing account, or secrets.
You can discuss your workload and run local JSON planners without Azure CLI, an Azure subscription, or Azure login.

## Install the local prerequisites

You need Git, [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli),
and a GitHub account with Copilot access. On Windows, use PowerShell 6 or later. Installation options:

| Environment | Install Copilot CLI |
|---|---|
| Windows with WinGet | `winget install GitHub.Copilot` |
| macOS or Linux with Homebrew | `brew install --cask copilot-cli` |
| npm on any supported OS, with Node.js 22 or later | `npm install -g @github/copilot` |

Node.js is also needed to run SSLZ's local `.mjs` checks and planners, regardless of how you install Copilot CLI.
Use Node.js 22 or later for this walkthrough. The CLI syntax was checked with Copilot CLI 1.0.105; this is a tested
version, not a proven minimum. Check your installation:

```shell
git --version
copilot --version
node --version
```

Azure CLI, Bicep, Terraform, and Azure permissions are not prerequisites for the initial conversation or local JSON
planning. The website's [Quick Start]({{ '/' | relative_url }}#quick-start) is a separate, direct operator deployment
path with different prerequisites and approval responsibilities.

## Clone the public agent version

The agent implementation is maintained separately from the classic website. These commands pin commit
`798a3ccad9710084ecc37f3386e8826934bfa0f2` on the implementation branch. Run them only after this exact commit is
reachable from the public `agent-aware` branch; do not substitute another commit or continue on the branch tip. Use a
parent directory where
`sslz-agent` does not already exist. Git will refuse to clone over a nonempty directory; do not delete or
overwrite an existing checkout to follow this guide.

Run each command separately and stop if any command fails. Once the pinned commit is public, these commands work in
PowerShell and macOS/Linux shells:

```shell
git clone --branch agent-aware --single-branch https://github.com/ricmmartins/sslz.git sslz-agent
cd sslz-agent
git checkout --detach 798a3ccad9710084ecc37f3386e8826934bfa0f2
git rev-parse HEAD
```

The last command must print exactly `798a3ccad9710084ecc37f3386e8826934bfa0f2`. A detached HEAD keeps this walkthrough
on that version even if the branch moves. If checkout fails or the hash differs, stop; do not substitute an unverified
commit or continue on the branch tip.

Review `.github/agents/sslz-agent.agent.md`, `.github/copilot-instructions.md`, and any repository configuration
before trusting the folder in Copilot. This pinned profile has `read`, `search`, `execute`, and `WebFetch` tools.
It includes adoption guidance for founders and technology leaders across different organization sizes and hosting
environments. The startup planner itself accepts teams of 1-50 engineers; larger teams need broader architecture review
instead of forcing their inputs into that schema.

## Sign in to Copilot and select the agent

Sign in to GitHub Copilot, independently of Azure:

```shell
copilot login
copilot --agent sslz-agent
```

Follow the GitHub sign-in prompts. Review the folder trust prompt before accepting it. In an existing CLI session,
`/login` handles GitHub authentication. You can alternatively start `copilot`, enter `/agent`, and select
**SSLZ Agent** from this repository. The CLI ID `sslz-agent` comes from the profile filename.

A personal profile with the same ID in `~/.copilot/agents/` overrides the repository profile. On Windows, that folder is
`$HOME\.copilot\agents`. Check for both `sslz-agent.agent.md` and `sslz-agent.md`, and any conflicting display name.
Resolve a conflict yourself before continuing; these instructions do not rename, remove, or overwrite your profiles.
If the agent is missing, confirm the repository root, pinned hash, profile file, folder trust, and CLI version, then
restart the CLI. See GitHub's [custom-agent guidance](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli).

Enter this in the interactive session:

```text
I am building a B2B API for EU retailers. It is new on Azure, uses PostgreSQL, and must stay in the EU.
Start with repository reads and planning only. Do not log in to Azure, inspect a tenant, install software,
write files, or run a preview. Ask before any command or external request.
```

Describe your own workload using sanitized facts. For an open-ended request, the agent summarizes what is known,
unknown, and the next safe decision, then asks about facts you have not already provided:

> What are you building, where does it run today, and what do you want Azure to do first?

Answer one question at a time. Expect unknowns and evidence gaps to remain explicit. A conversation does not guarantee
that a deterministic planner ran; request its exact command and review its output when you need a planner result.
GitHub also documents `--agent sslz-agent --prompt "..."` for programmatic invocation. This walkthrough uses an
interactive session so you can answer questions and review tool requests; do not add blanket permissions to make an
unattended prompt run.

## Check local planning without Azure

In the pinned checkout, these optional checks read tracked files and sanitized fixtures. Run them yourself, or approve
these exact commands when the agent proposes them:

```shell
node tests/sslz-agent.mjs
```

For PowerShell:

```powershell
node scripts\startup-workload-plan.mjs plan --input agent\examples\startup-input.json --output json
```

For macOS/Linux:

```bash
node scripts/startup-workload-plan.mjs plan --input agent/examples/startup-input.json --output json
```

The first command checks static profile and journey contracts. The second runs a local workload planner on a synthetic
example and prints JSON. Neither proves readiness, quota, available capacity, startup-credit eligibility, or health in
your tenant. The full greenfield journey is a different check that writes local artifacts and requires additional
tooling; it is not part of this no-Azure smoke check.

## Current documentation and MCP availability

The preferred source for current Azure documentation is the public
[Microsoft Learn MCP server](https://learn.microsoft.com/en-us/training/support/mcp), using HTTP transport at
`https://learn.microsoft.com/api/mcp`. It requires no Azure login or API key. In Copilot CLI, `/mcp` shows availability;
`/mcp add` opens the setup form. Choose a unique server name, HTTP, that URL, and only the documentation tools you need,
then save with Ctrl+S. Preserve existing server settings; do not replace your MCP configuration file.
See [GitHub's MCP setup guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

Configuring a server does not guarantee that its tools are exposed in the selected agent's runtime. The `WebFetch`
profile capability does not itself grant Microsoft Learn MCP access. Prefer Learn MCP when available. If it is unavailable,
use only an exposed, approved HTTPS fetch tool for relevant public `learn.microsoft.com` or `docs.microsoft.com` pages,
checking the final URL after redirects. Cite what was actually retrieved. If neither route works, disclose the gap and
continue with local facts only. Do not add tools, use shell HTTP commands, or enable blanket permissions to bypass a
restriction. An unavailable tool can reflect the profile, runtime, configuration, or policy; it does not by itself
mean that your company's administrator must change anything.

## Approve live access separately

Only when you choose a specific live read should the agent explain the exact read-only repository command, target,
required permissions, and information it will read. Then install
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) if needed and authenticate locally for that
approved scope. Review the active account and subscription before allowing the inspection. Azure authentication is
not consent to subsequent reads or writes.

Keep Copilot CLI's normal permission prompts enabled. The custom-agent `execute` capability is broad; the profile
does not create an operating-system shell allowlist. Reject commands outside the documented repository entry points.
Never use `--allow-all`, `--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`, or `--yolo` with this walkthrough.
Do not paste credentials, tokens, billing records, signing keys, customer data, tenant IDs, or subscription IDs into
chat or tracked files.

Local artifact generation and live preview need separate review and approval. Provider registration and deployment
remain guarded by their operation-specific contracts; provider apply is disabled in this profile. Migration and
dual-cloud execution are disabled. The agent does not automatically deploy a workload, and a successful command
does not establish application health.

## Hosted UI and release limits

This is a local CLI launcher. The profile is absent from classic `main`; the GitHub.com custom-agent picker is not
a supported launch path for this repository. A hosted agent also has no automatic access to an arbitrary Azure tenant.
See GitHub's [invocation reference](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents)
and [custom-agent configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration).

This pinned implementation supports adoption conversation guidance, documentation grounding when the required tools
are exposed, local contract checks, and fixture-based planning. Earlier release checks included seven real two-turn
conversations, version 3 fixture replay, and an external planner invocation. Those checks have different scopes:
conversation and replay checks do not prove that the agent ran the planner itself. Neither those tests nor this guide
establish an autonomous conversation-to-deployment flow or real tenant readiness.

Release this page only after the pinned commit is reachable from the public implementation branch and clean-clone
checks pass. Publish the website documentation separately from classic `main`; do not merge the agent implementation
into it.
