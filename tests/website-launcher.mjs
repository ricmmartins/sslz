#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pin = "362dd43ca4e0991e00f4b2c8454ba4a4bd0b0670";
const read = (path) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const page = read("use-sslz-agent.md");
const homepage = read("index.md");
const readme = read("README.md");
const manifest = JSON.parse(read(".github/classic-baseline-manifest.json"));
const cloneCommand =
  "git clone --branch agent-aware --single-branch https://github.com/ricmmartins/sslz.git sslz-founder-agent";
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
    cloneCommand, "cd sslz-founder-agent", `git checkout --detach ${pin}`, "git rev-parse HEAD",
    "copilot login", "copilot --agent sslz-founder",
    "node tests/sslz-founder-agent.mjs",
    "node scripts\\startup-workload-plan.mjs plan --input agent\\examples\\startup-input.json --output json",
    `node ${plannerArgs.join(" ")}`,
  ], "Runnable instructions must keep the reviewed commands, pin, and approval boundary.");
  assert(!shell.some((line) => /\baz\b|--allow-all|--yolo|--prompt|--force/.test(line)));
  const normalized = markdown.replace(/\s+/g, " ");
  for (const required of [
    "without Azure CLI, an Azure subscription, or Azure login",
    "GitHub account with Copilot access",
    "PowerShell 6 or later",
    "Node.js 22 or later",
    "This page provides setup instructions only",
    "stop if any command fails",
    "does not already exist",
    "~/.copilot/agents/",
    "$HOME\\.copilot\\agents",
    "overrides the repository profile",
    "folder trust",
    "`/agent`",
    "`/login`",
    "`read`, `search`, and `execute`",
    "does not include the newer `WebFetch` capability",
    "https://learn.microsoft.com/api/mcp",
    "requires no Azure login or API key",
    "Configuring a server does not grant this pinned agent permission",
    "forbids ad hoc web requests",
    "`learn.microsoft.com` or `docs.microsoft.com`",
    "checking the final URL after redirects",
    "does not by itself mean that your company's administrator must change anything",
    "Azure authentication is not consent",
    "normal permission prompts enabled",
    "not create an operating-system shell allowlist",
    "Migration and dual-cloud execution are disabled",
    "does not automatically deploy",
    "absent from classic `main`",
    "not evidence for the version installed here",
    "autonomous conversation-to-deployment",
    "publish a reviewed agent implementation first",
  ]) {
    assert(normalized.includes(required), `Missing launcher boundary: ${required}`);
  }
  assert(!/d921d99|b0c2464|100%|fully autonomous|guaranteed deployment/.test(markdown));
  assert.match(markdown, /Never use `--allow-all`, `--allow-all-tools`, `--allow-all-paths`, `--allow-all-urls`, or `--yolo`/);
}

validateLauncher(page);
for (const [before, after] of [
  [pin, "d921d99b6e2c2979d5637f7f186e6c9fe44ef86c"],
  ["copilot --agent sslz-founder\n", "copilot --agent sslz-founder --allow-all\n"],
  ["copilot login\n", "az login\n"],
  ["overrides the repository profile", "does not affect selection"],
  ["forbids ad hoc web requests", "allows arbitrary HTTP requests"],
]) {
  assert.throws(() => validateLauncher(page.replace(before, after)), `Must reject: ${after}`);
}

assert.equal(manifest.launcher.implementationCommit, pin);
assert.match(homepage, /\{\{ '\/use-sslz-agent\/' \| relative_url \}\}" class="btn btn-secondary">Use SSLZ Agent<\/a>/);
assert.equal(homepage.split(">Use SSLZ Agent</a>").length - 1, 1);
assert.match(homepage, /id="quick-start"/);
assert.match(readme, /\[Use SSLZ Agent\]\(https:\/\/startupscalelanding.zone\/use-sslz-agent\/\)/);
assert.match(readme, /without Azure CLI or Azure\r?\nlogin/);
assert.match(read("_config.yml"), /^url: "https:\/\/startupscalelanding.zone"$/m);
assert.match(read("_config.yml"), /^baseurl: ""$/m);
assert(!/agent-aware|use-sslz-agent\.md/.test(read("_data/navigation.yml")));
const links = [...page.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
assert(links.every((link) => ["docs.github.com", "learn.microsoft.com"].includes(new URL(link).hostname)));
assert(page.includes("{{ '/' | relative_url }}#quick-start"));
console.log("Website launcher contracts and negative regressions passed.");

if (process.argv.includes("--remote-smoke")) {
  const temporary = mkdtempSync(join(tmpdir(), "sslz-launcher-"));
  const checkout = join(temporary, "sslz-founder-agent");
  const git = (args, cwd = checkout) => execFileSync("git", args, {
    cwd, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    // Execute the published clone/pin sequence without reusing any existing checkout.
    git(cloneCommand.split(" ").slice(1), temporary);
    git(["checkout", "--detach", pin]);
    assert.equal(git(["rev-parse", "HEAD"]), pin);
    git(["merge-base", "--is-ancestor", pin, "origin/agent-aware"]);
    assert.equal(git(["status", "--porcelain"]), "");
    const profile = readFileSync(join(checkout, ".github", "agents", "sslz-founder.agent.md"), "utf8");
    const tools = JSON.parse(profile.match(/^tools: (.+)$/m)[1]);
    assert.deepEqual(tools, ["read", "search", "execute"]);
    assert.match(profile, /^name: SSLZ Founder Agent$/m);
    assert.match(profile, /Do not use ad hoc web requests/);
    const env = {
      ...process.env, PATH: "", Path: "",
      AZURE_CONFIG_DIR: join(temporary, "no-azure-login"),
    };
    const runNode = (args) => execFileSync(process.execPath, args, {
      cwd: checkout, env, encoding: "utf8", timeout: 60_000,
    });
    const profileResult = runNode(["tests/sslz-founder-agent.mjs"]);
    console.log(profileResult.trim());
    const planner = JSON.parse(runNode(plannerArgs));
    assert.equal(planner.schemaVersion, "1.0.0");
    assert.equal(planner.status, "ready");
    assert.equal(planner.computeProfile, "container-apps");
    assert.deepEqual(planner.profileExtensions, ["postgresql"]);
    assert.equal(git(["status", "--porcelain"]), "", "No tracked or untracked output expected.");
    console.log(`Public clone pinned ${pin}; exact profile tools verified; no-Azure planner returned ${planner.computeProfile} + ${planner.profileExtensions.join(", ")}.`);
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
