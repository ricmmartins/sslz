#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = readFileSync(
  resolve(root, ".github/agents/sslz-founder.agent.md"),
  "utf8",
);
const launcher = readFileSync(resolve(root, "use-sslz-agent.md"), "utf8");
const journeys = JSON.parse(
  readFileSync(resolve(root, "tests/fixtures/founder-agent-journeys.json"), "utf8"),
);

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(match, "The agent profile must begin with YAML frontmatter.");
  const frontmatter = match[1];
  const scalar = (name) => {
    const value = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1];
    assert(value, `Missing ${name} frontmatter.`);
    return value.trim();
  };
  return {
    body: markdown.slice(match[0].length),
    name: scalar("name"),
    description: scalar("description"),
    target: scalar("target"),
    tools: JSON.parse(scalar("tools")),
    disableModelInvocation: scalar("disable-model-invocation") === "true",
    userInvocable: scalar("user-invocable") === "true",
  };
}

const agent = parseFrontmatter(profile);
const normalizedLauncher = launcher.replace(/^>\s?/gm, "").replace(/\s+/g, " ");
assert.equal(agent.name, "SSLZ Founder Agent");
assert.equal(agent.target, "github-copilot");
assert.deepEqual(agent.tools, ["read", "search", "execute"]);
assert.equal(agent.disableModelInvocation, true);
assert.equal(agent.userInvocable, true);
assert(agent.description.length > 20);
assert(agent.body.length <= 30_000, "Agent prompt exceeds GitHub's 30,000-character limit.");

const requiredProfileText = [
  "What are you building, who needs it",
  "How it works",
  "one startup subscription",
  "production/nonproduction pair",
  "billing/credit visibility",
  "provider registration",
  "quota",
  "capacity",
  "Foundry model access",
  "GPU",
  "PostgreSQL regional",
  "Defender workspace",
  "Regional retry",
  "AKS ingress",
  "explicitly approves",
  "signed approval artifact required before baseline Azure write",
  "provider `apply` remains disabled in this profile",
  "live execution remains disabled",
  "GitHub cloud agent",
  "arbitrary founder tenant",
  "untrusted data",
  "not a shell allowlist",
  "never ask the founder to use `--allow-all`",
];
for (const text of requiredProfileText) {
  assert(
    agent.body.toLowerCase().includes(text.toLowerCase()),
    `Agent profile is missing required behavior: ${text}`,
  );
}

const requiredCommands = [
  "node scripts/validate-greenfield-journey.mjs",
  "node scripts/startup-preflight.mjs inspect",
  "node scripts/startup-workload-plan.mjs plan",
  "node scripts/startup-regional-plan.mjs plan",
  "node scripts/startup-postgresql-plan.mjs plan",
  "node scripts/startup-postgresql-migration-plan.mjs plan",
  "node scripts/startup-postgresql-rehearsal-plan.mjs plan",
  "node scripts/startup-postgresql-execution-plan.mjs plan",
  "node scripts/startup-container-image-cicd-plan.mjs plan",
  "node scripts/startup-connectivity-plan.mjs plan",
  "node scripts/startup-control-plane-ownership-plan.mjs plan",
  "node scripts/startup-program-lineage.mjs build",
  "node scripts/startup-iac-plan.mjs generate",
  "node scripts/startup-provider-remediation.mjs dry-run",
  "node scripts/startup-deployment-integration.mjs preview",
];
for (const command of requiredCommands) {
  assert(agent.body.includes(command), `Agent profile is missing command: ${command}`);
}

const prohibitedProductLanguage = /Optional Agent-Aware Experience/i;
assert(!prohibitedProductLanguage.test(profile));
assert(!prohibitedProductLanguage.test(launcher));
assert(!/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(profile));
assert(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(profile));

assert.equal(journeys.schemaVersion, "1.0.0");
assert.equal(journeys.productName, "SSLZ Founder Agent");
assert.equal(
  journeys.canonicalLaunchUrl,
  "https://startupscalelanding.zone/use-sslz-agent/",
);
assert.deepEqual(
  journeys.journeys.map(({ route }) => route),
  ["greenfield", "migration", "dual-cloud"],
);
const journeysById = new Map(
  journeys.journeys.map((journey) => [journey.id, journey]),
);
assert.equal(
  journeysById.size,
  journeys.journeys.length,
  "Journey IDs must be unique.",
);
for (const journey of journeys.journeys) {
  assert.equal(journey.expectedAzureWritesBeforeApproval, 0);
  assert.equal(journey.expectedExternalNetworkCallsInFixture, 0);
  assert(journey.founderPrompt.length > 20);
  assert(journey.requiredTopics.length >= 6);
}
assert.equal(
  journeysById.get("synthetic-greenfield")?.liveExecution,
  "guarded-primary-baseline-only",
);
assert.equal(journeysById.get("synthetic-migration")?.liveExecution, "disabled");
assert.equal(journeysById.get("synthetic-dual-cloud")?.liveExecution, "disabled");

assert(launcher.includes("permalink: /use-sslz-agent/"));
assert(launcher.includes("copilot --agent sslz-founder"));
assert(launcher.includes('--interactive "Start a new founder journey."'));
assert(launcher.includes("/agent"));
assert(launcher.includes("copilot --agent sslz-founder --prompt"));
assert(launcher.includes("never launch this profile with `--allow-all`"));
assert(launcher.includes("https://docs.github.com/en/copilot/reference/custom-agents-configuration"));
assert(launcher.includes("default branch"));
assert(normalizedLauncher.includes("does not receive access to your Azure tenant"));
assert(!profile.includes("startup-provider-remediation.mjs apply"));

console.log("SSLZ Founder Agent static profile, launcher, and journey contract checks passed.");
