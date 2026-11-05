#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = ".github/agents/sslz-agent.agent.md";
const source = readFileSync(resolve(root, sourcePath), "utf8").replace(/\r\n/g, "\n");
const match = source.match(/^---\n([\s\S]*?)\n---\n/);
if (!match) throw new Error(`${sourcePath} must begin with YAML frontmatter.`);
const description = match[1].match(/^description:\s*(.+)$/m)?.[1].trim();
if (!description) throw new Error(`${sourcePath} must have a description.`);
const body = source.slice(match[0].length);

const notice = (host, bypassFlags) => `<!--
Generated from ${sourcePath} by scripts/generate-agent-adapters.mjs. Do not edit by hand.
Run \`node scripts/generate-agent-adapters.mjs\` after changing the source profile.
-->

> **Adapter note for ${host}.** This is a generated copy of the SSLZ Agent profile written for GitHub Copilot CLI.
> References to Copilot CLI, \`/agent\`, the \`execute\` grant, \`WebFetch\`, or the GitHub custom-agent picker describe
> the source profile. In ${host}, use the equivalent read, search, shell and public-documentation tools that the host
> exposes, and keep its normal permission prompts on. Never use ${bypassFlags}. All safety rules below apply
> unchanged. This adapter has had no client-specific acceptance testing beyond the repository's static contract check.

`;

const outputs = {
  ".claude/agents/sslz-agent.md": `---
name: sslz-agent
description: ${description}
tools: Read, Grep, Glob, Bash, WebFetch
---

${notice("Claude Code", "`--dangerously-skip-permissions` or any permission-bypass mode")}${body}`,
  "agent/adapters/codex-sslz-agent.md": `# SSLZ Agent instructions for Codex

${notice("Codex", "`--dangerously-bypass-approvals-and-sandbox`, `--yolo`, or any approval-bypass mode")}${body}`,
};

const check = process.argv.includes("--check");
let stale = false;
for (const [path, content] of Object.entries(outputs)) {
  const full = resolve(root, path);
  const current = existsSync(full) ? readFileSync(full, "utf8").replace(/\r\n/g, "\n") : null;
  if (check) {
    if (current !== content) {
      console.error(`${path} is out of date. Run: node scripts/generate-agent-adapters.mjs`);
      stale = true;
    }
  } else {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    console.log(`Wrote ${path}`);
  }
}
if (stale) process.exit(1);
if (check) console.log("Agent adapters are up to date.");
