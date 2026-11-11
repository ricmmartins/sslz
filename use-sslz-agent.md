---
layout: page
title: "Use SSLZ Agent"
description: "Launch SSLZ Agent locally with GitHub Copilot CLI, Claude Code or Codex."
permalink: /use-sslz-agent/
---

Run **SSLZ Agent** on your computer to plan an Azure starting foundation aligned with SSLZ. Use GitHub Copilot CLI (the
primary path), Claude Code, or Codex. You describe what you are building, and it explains your options and helps you plan
them. It only talks and plans: it does not connect to Azure or change anything unless you approve a specific step.

**SSLZ Agent is optional.** To deploy the landing zone foundation, use the [Quick Start](/) and the Classic
Terraform or Bicep workflows; that path is the tested default. The agent is a companion for what comes next, such as
planning a workload or a migration on top of a foundation that already exists, or for different needs.

This page provides setup instructions only. It does not receive access to your Azure tenant, subscriptions, billing
account, or secrets. You can start without Azure CLI, an Azure subscription, or Azure login. The agent, its planning
scripts, safety tests, and documentation are all in the repository's `main` branch, which is the default branch.

## In short

1. Install Git, Node.js and GitHub Copilot CLI (or use [Claude Code or Codex](#use-claude-code-or-codex)).
2. Clone the SSLZ repository.
3. Start the agent and tell it about your project.

The sections below give the exact commands. Everything under "Reference (optional)" is optional reading.
## Install the local prerequisites

You need Git and [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli).
Sign in to Copilot with a GitHub account that has Copilot access. On Windows, use PowerShell 6 or later. Installation
options:

| Environment | Install Copilot CLI |
|---|---|
| Windows with WinGet | `winget install GitHub.Copilot` |
| macOS or Linux with Homebrew | `brew install --cask copilot-cli` |
| npm on any supported OS, with Node.js 22 or later | `npm install -g @github/copilot` |

Node.js 22 or later is also needed to run SSLZ's local `.mjs` checks and planners. Check your installation:

```shell
git --version
copilot --version
node --version
```

The initial conversation does not require Azure CLI, an Azure subscription, or Azure login. The read-only preflight and the launcher script do need Azure CLI and `az login` to the tenant that owns your subscriptions. Local JSON planning uses
synthetic inputs and does not need Azure access.
The website's [Quick Start]({{ '/' | relative_url }}#quick-start) is a separate, direct operator deployment path with
different prerequisites and approval responsibilities.

## Clone the repository

The agent profile and its implementation live together on `main`. The profile is the agent's instruction file. Clone the repository into a parent directory where
`sslz-agent` does not already exist, using `sslz-agent` as the clone folder. Git will refuse to clone over a nonempty
directory; do not delete or overwrite an existing checkout to follow this guide.

Run each command separately and stop if any command fails. These commands work in PowerShell and macOS/Linux shells:

```shell
git clone --branch main --single-branch https://github.com/ricmmartins/sslz.git sslz-agent
cd sslz-agent
git status --short --branch
```

The status should show the `main` branch. Review `.github/agents/sslz-agent.agent.md`, `.github/copilot-instructions.md`,
and any repository configuration before trusting the folder in Copilot. The profile has `read`, `search`, `execute`,
and `WebFetch` tools. Its guidance covers founders and technology leaders across different organization sizes and
hosting environments. The startup planner itself accepts teams of 1-50 engineers; larger teams need broader
architecture review instead of forcing their inputs into that schema.

## Sign in to Copilot and select the agent

Sign in to GitHub Copilot, independently of Azure:

```shell
copilot login
copilot --agent sslz-agent
```

Follow the GitHub sign-in prompts and review the folder trust prompt before accepting it. In an existing CLI session,
`/login` handles GitHub authentication. You can also start `copilot`, enter `/agent`, and select **SSLZ Agent** from
this repository. The CLI ID `sslz-agent` comes from the profile filename.

To start with the guided opening, run:

```shell
copilot --agent sslz-agent --interactive "Start a new founder journey."
```

If you plan to run the read-only Azure preflight (Bash, WSL, macOS or Linux), start from `bash scripts/start-sslz-agent.sh` instead. It checks the tools (Node.js, Copilot CLI and Azure CLI), requires `az login`, shows the active tenant, lets you pick the production and non-production subscriptions by number, and then starts the same interactive agent in that shell. It only reads your account list and never changes Azure. Skip it for the initial conversation, which needs no Azure access. On Windows PowerShell, use WSL or set the variables yourself as described under "What to expect on a real run".

Use the interactive form so you can review individual permission requests. Do not use prompt mode as an unattended
launcher; if the host cannot request an approval, the agent must report that action as blocked. Approve only the
specific tool, command, local path, or official documentation URL needed for the next step. Keep the profile
interactive and never launch this profile with `--allow-all`.

Try an interactive request such as:

```text
I am building a B2B API for EU retailers. It is new on Azure, uses PostgreSQL, and must stay in the EU.
Start with repository reads and planning only. Do not log in to Azure, inspect a tenant, install software,
write files, or run a preview. Ask before any command or external request.
```

Describe your own workload using sanitized facts. For an open-ended request, the agent summarizes what is known and unknown and names the next safe decision, then asks about facts you have not already provided:

> What are you building, where does it run today, and what do you want Azure to do first?

Answer one question at a time. A conversation does not guarantee that a deterministic planner ran; request its exact
command and review its output when you need a planner result. GitHub also documents
`--agent sslz-agent --prompt "..."` for programmatic invocation. This walkthrough uses an interactive session so you can
answer questions and review tool requests; do not add blanket permissions to make an unattended prompt run.

## What else the agent can do

"Start a new founder journey." is only the guided opening. You can start the agent with your own first message, or
with no message at all, and ask for any of the following. The agent works from repository guidance first, says what it
could not verify, and asks before it runs anything.

| You want to... | Example prompt |
|---|---|
| Move from another cloud or on-premises | `We run on AWS ECS Fargate with RDS PostgreSQL. Plan a move to Azure and tell me what is known and unknown.` |
| Review what you already have in Azure | `We already have a landing zone. Which gaps should we close first for a Container Apps workload?` |
| Choose services for a workload | `We have a B2B API with PostgreSQL and about 2,000 users. Which Azure services fit, and why not Kubernetes?` |
| Check readiness, read-only | `Explain what the preflight checks, then, with my approval, run it and explain every check that did not pass.` |
| Understand a blocked result | `Why is generation blocked, and what exactly must I do to unblock it?` |
| Plan a PostgreSQL migration | `Plan a 50 GB PostgreSQL migration with zero lost transactions and one hour of downtime. What must we rehearse?` |
| Stay in two clouds | `Our data stays on AWS and compute moves to Azure. What should Azure control?` |
| Understand cost and credits | `What do we know and not know about credits, cost and quotas before we deploy?` |
| Learn how it works | `How it works` (the agent then explains the planners, evidence and approval gates) |

To skip the guided opening with the launcher, use `bash scripts/start-sslz-agent.sh --blank`, or pass your own first
message in quotes. Without the launcher, run `copilot --agent sslz-agent` for a blank session.

Anything the agent cannot do inside SSLZ, such as general application code, AWS-side migration steps or a service outside
the known profiles, it hands back with the facts it gathered and a request you can paste into your own assistant,
labeled as not validated by SSLZ.
## Use Claude Code or Codex

If you use Claude Code or Codex instead, install it from its own documentation, clone
the repository as above, and start it in the cloned folder. Claude Code and Codex use generated adapters of the same instructions. They
are not yet validated in those clients, so check each permission prompt, keep approvals on, and never use a
bypass mode such as `--dangerously-skip-permissions` or `--dangerously-bypass-approvals-and-sandbox`.

For Claude Code:

```text
claude --agent sslz-agent
```

For Codex:

```text
codex "Read agent/adapters/codex-sslz-agent.md and follow it as SSLZ Agent for this session."
```

The copies live in `.claude/agents/sslz-agent.md` and `agent/adapters/codex-sslz-agent.md`. Do not edit them by hand:
they are generated from `.github/agents/sslz-agent.agent.md` and CI fails if they drift.

## Approve live access separately

Only when you choose a specific live read should the agent explain the exact read-only repository command, target,
required permissions, and information it will read. Then install
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) if needed and authenticate locally for that
approved scope. Review the active account and subscription before allowing the inspection. Azure authentication is not
consent to subsequent reads or writes.

Keep Copilot CLI's normal permission prompts enabled. The custom-agent `execute` capability is broad; the profile does
not create an operating-system shell allowlist. Reject commands outside the documented repository entry points. Never
use `--allow-all`, `--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`, or `--yolo` with this walkthrough. Do
not paste credentials, tokens, billing records, signing keys, customer data, tenant IDs, or subscription IDs into chat
or tracked files.

Local artifact generation and live preview need separate review and approval. Provider registration and deployment
remain guarded by their operation-specific contracts; provider apply is disabled in this profile. Migration and
dual-cloud execution are disabled. The agent does not automatically deploy a workload, and a successful command does
not establish application health.

## Reference (optional)

### If the agent does not appear

A personal profile with the same ID in `~/.copilot/agents/` overrides the repository profile. On Windows, that folder is
`$HOME\.copilot\agents`. Check for both `sslz-agent.agent.md` and `sslz-agent.md`, and any conflicting display name.
Resolve a conflict yourself before continuing; these instructions do not rename, remove, or overwrite your profiles.
If the agent is missing, confirm the repository root, `main` branch, profile file, folder trust, and CLI version, then
restart the CLI. See GitHub's [custom-agent guidance](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli).

### Check local planning without Azure

These optional checks read tracked files and sanitized fixtures. Run them yourself, or approve these exact commands when
the agent proposes them:

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

The full journey deletes and recreates `.sslz/generated/greenfield-journey` and creates and removes the
process-specific replay store `.sslz/remediation-state/greenfield-${process.pid}`. Use an isolated checkout to preserve
existing reports, and approve both local write targets before running that command through the agent.
Generated `.bicepparam` and `.tfvars` files can require separate read-only confirmations. If a confirmation is
unavailable, the agent must report that readback as blocked; generation alone does not verify the file contents.

### Current documentation (optional)

For up-to-date Azure documentation, you can add the public
[Microsoft Learn MCP server](https://learn.microsoft.com/en-us/training/support/mcp) (HTTP,
`https://learn.microsoft.com/api/mcp`). It requires no Azure login or API key. In Copilot CLI, run `/mcp add` and follow
the [MCP setup guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

To check it, run `/mcp` and look for the server, then start `copilot --agent sslz-agent` and ask it to cite a
Microsoft Learn page. If it says it used a web fetch instead, the profile or runtime does not expose the Learn tools.

A configured server does not guarantee that its tools are exposed to the selected agent. If Learn MCP is unavailable, the
agent falls back to approved fetches of `learn.microsoft.com` pages, or to local facts only, and says so.

### What to expect on a real run

A live test with a new Azure account showed this sequence:

Before you start the agent, set the two subscription IDs in the same terminal that launches `copilot`. In Bash or WSL, run `export SSLZ_PROD_SUBSCRIPTION_ID="<prod-subscription-id>"` and
`export SSLZ_NONPROD_SUBSCRIPTION_ID="<nonprod-subscription-id>"`, then start the agent from that same terminal.

If the agent is already running, exit it (`/exit` or Ctrl+C twice), export the variables, and start it again. A new
`copilot` session does not see variables you set in another terminal. To check them without printing the IDs, run
`echo ${SSLZ_PROD_SUBSCRIPTION_ID:+ok} ${SSLZ_NONPROD_SUBSCRIPTION_ID:+ok}` in that shell; it should print `ok ok`.
You can also run the preflight yourself in another terminal and keep the JSON file.

1. **Discovery.** About a dozen questions, one at a time. The agent keeps your answers separate from facts it has not
   verified. It then proposes a plan and asks which IaC tool you prefer.
2. **Draft requirements.** It asks before writing `.sslz/generated/.../requirements.json` (a git-ignored local file).
   You approve twice: the agent's own question, and then the CLI's per-command permission prompt.
3. **Read-only preflight.** The agent shows `scripts/startup-preflight.mjs inspect` but does not see variables from
   your other terminals. Set the subscription IDs in the same shell that launches `copilot` (or run the command
   yourself and save the JSON), so IDs stay out of the chat. `bash scripts/start-sslz-agent.sh` does this for you: it checks
   the tools and the Azure login, lets you pick the two subscriptions by number, and starts the agent in that shell. A `blocked` status and exit code 1 mean the report found
   gaps, not that the script crashed. Every check is reported as blocking, including `skipped` and `unknown` ones.
4. **Provider registration.** If providers are missing, register them yourself with `az provider register`. The agent
   never applies this. Azure may return namespaces in lowercase, such as `microsoft.insights`. Registration takes a few
   minutes: check with `az provider show -n <namespace> --query registrationState -o tsv` and rerun the preflight once
   it shows `Registered`. Providers stay registered after a teardown, so you do not need to repeat this.
   Which providers are needed depends on the profiles you chose, for example Container Apps and PostgreSQL.
5. **Readiness gate.** Terraform generation requires current evidence that goes beyond the preflight: a second
   emergency-capable administrator, security, architecture and Bicep/Terraform parity reviews, billing and benefit
   confirmation, measured recovery tests, and an eligible regional plan. The agent does not accept "I accept the risk"
   as a substitute, and there is no exemption for accounts without Startup credits. If you cannot supply this evidence
   yet, use the agent for planning only and deploy with the
   [CI/CD guide]({{ '/docs/ci-cd-setup' | relative_url }}) or the Quick Start.

**Billing checks may stay `unknown`.** The preflight reads billing properties and Billing Benefits credits for each
target subscription. A test or pay-as-you-go account, or a missing billing role, can leave these unknown. That is a
statement about what could be read, not proof that credits are missing. Ask Azure Billing Support to confirm the billing
account and profile for the exact target subscriptions.

**Run it in Bash, WSL, or Cloud Shell.** The commands in this guide use Bash syntax. On Windows, use WSL, and run
`az login` inside WSL, because the Windows login is not shared with it.

### Limits

This is a local CLI launcher. The GitHub.com custom-agent picker is not a supported launch path for this repository, and
a hosted agent has no automatic access to your Azure tenant. See GitHub's
[invocation reference](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents)
and [custom-agent configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration).

The `main` branch includes adoption conversation guidance, documentation grounding when the required tools are exposed,
local contract checks, and fixture-based planning. Checks on sample data are not evidence that the agent ran the planner, and an external planner invocation and a CLI
response do not prove that the agent ran the planner itself. This guide does not establish an autonomous
conversation-to-deployment flow or real tenant readiness. Record a remotely available revision when you need repeatable
evidence. See the [SSLZ Agent capability and evidence guide]({{ '/agent/' | relative_url }}) for links to
the SSLZ files that implement or plan each capability.
