#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const page = read("use-sslz-agent.md");
const homepage = read("index.md");
const readme = read("README.md");
const workflow = read(".github/workflows/validate-website.yml");
const cloneCommand =
  "git clone --branch main --single-branch https://github.com/ricmmartins/sslz.git sslz-agent";
const plannerArgs = [
  "scripts/startup-workload-plan.mjs", "plan",
  "--input", "agent/examples/startup-input.json", "--output", "json",
];

function commands(markdown) {
  return [...markdown.matchAll(/```(?:shell|powershell|bash)\r?\n([\s\S]*?)```/g)]
    .flatMap((match) => match[1].trim().split(/\r?\n/));
}

function validateLauncher(markdown) {
  assert.match(markdown, /^layout: page$/m);
  assert.match(markdown, /^permalink: \/use-sslz-agent\/$/m);
  const shell = commands(markdown);
  assert.deepEqual(shell, [
    "git --version", "copilot --version", "node --version",
    cloneCommand, "cd sslz-agent", "git status --short --branch",
    "copilot login", "copilot --agent sslz-agent",
    'copilot --agent sslz-agent --interactive "Start a new founder journey."',
    "node tests/sslz-agent.mjs",
    "node scripts\\startup-workload-plan.mjs plan --input agent\\examples\\startup-input.json --output json",
    `node ${plannerArgs.join(" ")}`,
  ], "Runnable instructions must keep the main-branch commands and approval boundary.");
  assert(!shell.some((line) => /\baz\b|--allow-all|--yolo|--prompt|--force/.test(line)));
  const normalized = markdown.replace(/\s+/g, " ");
  for (const required of [
    "without Azure CLI, an Azure subscription, or Azure login",
    "Sign in to Copilot with a GitHub account that has Copilot access",
    "PowerShell 6 or later",
    "Node.js 22 or later",
    "This page provides setup instructions only",
    "profile and its implementation live together on `main`",
    "stop if any command fails",
    "does not already exist",
    ".github/agents/sslz-agent.agent.md",
    "sslz-agent.agent.md",
    "sslz-agent.md",
    "~/.copilot/agents/",
    "$HOME\\.copilot\\agents",
    "overrides the repository profile",
    "folder trust",
    "`/agent`",
    "`/login`",
    "`read`, `search`, `execute`, and `WebFetch`",
    "startup planner itself accepts teams of 1-50 engineers",
    "What are you building, where does it run today, and what do you want Azure to do first?",
    "https://learn.microsoft.com/api/mcp",
    "requires no Azure login or API key",
    "does not guarantee that its tools are exposed",
    "Azure authentication is not consent",
    "normal permission prompts enabled",
    "not create an operating-system shell allowlist",
    "Migration and dual-cloud execution are disabled",
    "does not automatically deploy",
    "GitHub.com custom-agent picker is not a supported launch path",
    "The `main` branch includes adoption conversation guidance",
    "external planner invocation",
    "do not prove that the agent ran the planner itself",
    "autonomous conversation-to-deployment",
  ]) {
    assert(normalized.includes(required), `Missing launcher boundary: ${required}`);
  }
  assert(!/d921d99|b0c2464|100%|fully autonomous|guaranteed deployment/.test(markdown));
  assert(!/sslz-founder|SSLZ Founder Agent/.test(markdown));
  assert.match(normalized, /Never use `--allow-all`, `--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`, or `--yolo`/);
}

validateLauncher(page);
for (const [before, after] of [
  ["git clone --branch main", "git clone --branch agent-aware"],
  ["copilot --agent sslz-agent\n", "copilot --agent sslz-agent --allow-all\n"],
  ["copilot login\n", "az login\n"],
  ["overrides the repository profile", "does not affect selection"],
  ["does not guarantee that its tools are exposed", "guarantees all tools are exposed"],
]) {
  assert.throws(() => validateLauncher(page.replaceAll(before, after)), `Must reject: ${after}`);
}

assert.match(homepage, /\{\{ '\/use-sslz-agent\/' \| relative_url \}\}" class="btn btn-secondary">Use SSLZ Agent<\/a>/);
assert.equal(homepage.split(">Use SSLZ Agent</a>").length - 1, 1);
assert.match(homepage, /id="quick-start"/);
assert.match(readme, /\[Use SSLZ Agent\]\(https:\/\/startupscalelanding.zone\/use-sslz-agent\/\)/);
assert.match(readme, /Clone the `main` branch/);
assert.match(read("_config.yml"), /^url: "https:\/\/startupscalelanding.zone"$/m);
assert.match(read("_config.yml"), /^baseurl: ""$/m);
assert.match(read("_data/navigation.yml"), /agent/);
assert(!/50a3ce1423e432ccdd9fa470452f6cfce75e2a50|agent-aware/.test(page));
assert.match(workflow, /run_remote_smoke:[\s\S]*?type: boolean/);
assert.match(
  workflow,
  /if: github\.event_name == 'workflow_dispatch' && inputs\.run_remote_smoke/,
);
assert.match(workflow, /node tests\/website-launcher\.mjs --remote-smoke/);
const links = [...page.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
assert(links.every((link) => ["docs.github.com", "learn.microsoft.com"].includes(new URL(link).hostname)));
assert(page.includes("{{ '/' | relative_url }}#quick-start"));
console.log("Website launcher contracts and negative regressions passed.");

if (process.argv.includes("--remote-smoke")) {
  const temporary = mkdtempSync(join(tmpdir(), "sslz-launcher-"));
  const checkout = join(temporary, "sslz-agent");
  const git = (args, cwd = checkout) => execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    // Execute the published clone sequence without reusing any existing checkout.
    git(cloneCommand.split(" ").slice(1), temporary);
    assert.equal(git(["symbolic-ref", "--short", "HEAD"]), "main");
    assert.equal(git(["rev-parse", "HEAD"]), git(["rev-parse", "origin/main"]));
    assert.equal(git(["status", "--porcelain"]), "");
    const profile = readFileSync(join(checkout, ".github", "agents", "sslz-agent.agent.md"), "utf8");
    const tools = JSON.parse(profile.match(/^tools: (.+)$/m)[1]);
    assert.deepEqual(tools, ["read", "search", "execute", "WebFetch"]);
    assert.match(profile, /^name: SSLZ Agent$/m);
    assert.match(profile, /do not assume[\s\S]*?add tools to frontmatter, or[\s\S]*?use ad hoc network requests/i);
    assert.match(profile, /What are you building, where does it run today, and what do you want Azure to do first/);
    const env = {
      ...process.env, PATH: "", Path: "",
      AZURE_CONFIG_DIR: join(temporary, "no-azure-login"),
    };
    const runNode = (args) => execFileSync(process.execPath, args, {
      cwd: checkout, env, encoding: "utf8", timeout: 60_000,
    });
    const profileResult = runNode(["tests/sslz-agent.mjs"]);
    console.log(profileResult.trim());
    const planner = JSON.parse(runNode(plannerArgs));
    assert.equal(planner.schemaVersion, "1.0.0");
    assert.equal(planner.status, "ready");
    assert.equal(planner.computeProfile, "container-apps");
    assert.deepEqual(planner.profileExtensions, ["postgresql"]);
    assert.equal(git(["status", "--porcelain"]), "", "No tracked or untracked output expected.");
    console.log(`Public main clone; exact profile tools verified; no-Azure planner returned ${planner.computeProfile} + ${planner.profileExtensions.join(", ")}.`);
    for (const url of links) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      assert(response.ok, `${url}: HTTP ${response.status}`);
      assert(["docs.github.com", "learn.microsoft.com"].includes(new URL(response.url).hostname));
      console.log(`HTTP ${response.status}: ${url}`);
      await response.body?.cancel();
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
