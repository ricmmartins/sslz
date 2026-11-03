#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = readFileSync(
  resolve(root, ".github/agents/sslz-founder.agent.md"),
  "utf8",
);
const launcher = readFileSync(resolve(root, "use-sslz-agent.md"), "utf8");
const grounding = readFileSync(
  resolve(root, "agent/compat/recommendation-grounding.md"),
  "utf8",
);
const normalizedGrounding = grounding.replace(/\s+/g, " ");
const workloadPlanner = readFileSync(
  resolve(root, "scripts/startup-workload-plan.mjs"),
  "utf8",
);
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
const normalizedProfile = agent.body.replace(/\s+/g, " ");
assert.equal(agent.name, "SSLZ Founder Agent");
assert.equal(agent.target, "github-copilot");
assert.deepEqual(agent.tools, ["read", "search", "execute"]);
assert.equal(agent.disableModelInvocation, true);
assert.equal(agent.userInvocable, true);
assert(agent.description.length > 20);
assert(agent.body.length <= 30_000, "Agent prompt exceeds GitHub's 30,000-character limit.");

for (const text of [
  "organizations of different sizes and stages",
  "current hosting (which may be AWS, GCP, on-premises, Azure, another provider, or none)",
  "Assess maturity qualitatively as **discovery**, **planning**, or **evidence-backed readiness**",
  "do not invent a numeric score",
  "Team size alone is not a maturity assessment, workload requirement, or platform-organization recommendation.",
  "Do not infer a service from a company label.",
  "If requirements are unknown, recommend no compute or extension profile yet.",
  "Public documentation search and fetch are permitted for sanitized technical queries",
  "If Learn MCP is unavailable or retrieval fails",
  "Cite the retrieved URL",
  "cite the local SSLZ file path",
  "An Azure service described in Learn is not automatically implemented by SSLZ.",
  "explicitly approves that exact local artifact-generation step",
  "Preview is a separate live action",
  "Local schema and planner checks do not prove tenant access",
  "live execution remains disabled",
  "not a shell allowlist",
  "never ask the founder to use `--allow-all`",
]) {
  assert(
    normalizedProfile.toLowerCase().includes(text.toLowerCase()),
    `Agent profile is missing required behavior: ${text}`,
  );
}

for (const command of [
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
]) {
  assert(agent.body.includes(command), `Agent profile is missing command: ${command}`);
}

assert(!/Optional Agent-Aware Experience/i.test(profile));
assert(!/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(profile));
assert(!/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(profile));
assert(!/small-startup architecture/i.test(profile));
assert(!/startup-scale architecture/i.test(profile));
assert(!profile.includes("startup-provider-remediation.mjs apply"));

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
assert.equal(journeysById.size, journeys.journeys.length, "Journey IDs must be unique.");
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

const scenarios = journeys.regressionScenarios;
const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
assert.equal(scenariosById.size, scenarios.length, "Scenario IDs must be unique.");
for (const id of [
  "ai-saas-aws-to-azure-12-engineers",
  "non-ai-gcp-api-with-confirmed-requirements",
  "greenfield-azure-no-existing-hosting",
  "existing-azure-environment",
  "on-premises-large-team",
  "gcp-to-azure-migration-planning",
  "existing-azure-cost-and-governance",
  "ai-workload-with-unverified-model-region-and-quota",
  "simple-non-ai-http-api",
  "contradictory-intent",
]) {
  assert(scenariosById.has(id), `Missing contrasting scenario: ${id}`);
}
assert.equal(scenarios.length, 10, "The illustrative prompt must remain only one scenario.");

for (const scenario of scenarios) {
  assert.equal(scenario.sanitized, true, `${scenario.id} must be synthetic and sanitized.`);
  assert.equal(scenario.expectedAzureWritesBeforeApproval, 0);
  assert.equal(scenario.expectedExternalNetworkCalls, 0);
  assert.equal(scenario.maturity.numericScore, null);
  assert.notEqual(scenario.maturity.readiness, "ready");
  assert.equal(scenario.parameterApproval.localGenerationRequiresExplicitApproval, true);
  assert.equal(scenario.parameterApproval.previewRequiresSeparateExplicitApproval, true);
  assert.equal(scenario.parameterApproval.azureWritesBeforeApproval, 0);
  assert.equal(scenario.architecture.availabilityClaimed, false);

  if (!scenario.planner.eligible) {
    assert(scenario.planner.reason, `${scenario.id} must explain why planning is blocked.`);
  }
  if (scenario.architecture.status === "awaiting-workload-and-azure-context"
    || scenario.architecture.status === "awaiting-workload-profile"
    || scenario.architecture.status === "awaiting-current-state-and-goal"
    || scenario.architecture.status === "awaiting-model-and-workload-decisions"
    || scenario.architecture.status === "clarification-required"
    || scenario.architecture.status === "broader-architecture-review"
    || scenario.architecture.status === "current-state-assessment"
    || scenario.architecture.status === "migration-assessment-only") {
    assert.equal(scenario.architecture.computeProfile, null);
    assert.deepEqual(scenario.architecture.serviceRecommendations, []);
  }

  for (const evidence of scenario.architectureEvidence ?? []) {
    assert.match(evidence.microsoftLearnUrl, /^https:\/\/learn\.microsoft\.com\//);
    assert(
      normalizedGrounding.includes(evidence.microsoftLearnUrl),
      `${scenario.id} cites a URL outside the retrieved reference set.`,
    );
    assert(
      evidence.sslzPaths.length > 0,
      `${scenario.id} must cite the local SSLZ implementation separately.`,
    );
    for (const path of evidence.sslzPaths) {
      assert(existsSync(resolve(root, path)), `${scenario.id} cites missing SSLZ path: ${path}`);
    }
    assert(evidence.sslzStatus, `${scenario.id} must label the SSLZ support level.`);
  }
}

const illustrative = scenariosById.get("ai-saas-aws-to-azure-12-engineers");
assert.equal(
  illustrative.founderPrompt,
  "I'm building an AI SaaS company with 12 engineers. We are currently running on AWS and want to start deploying workloads on Azure. What should we do first?",
);
assert.equal(illustrative.profile.engineeringTeamSize, 12);
assert.equal(illustrative.profile.currentHosting, "AWS");
assert.equal(illustrative.profile.intendedAzureOutcome, "unknown");
assert.equal(illustrative.maturity.stage, "discovery");
assert.equal(illustrative.maturity.readiness, "not-assessed");
assert.equal(illustrative.architecture.status, "awaiting-workload-and-azure-context");
assert.deepEqual(illustrative.architecture.serviceRecommendations, []);
assert.equal(illustrative.planner.eligible, false);
assert(illustrative.unknowns.includes("model hosting and managed-model fit"));
assert(illustrative.growthRoadmap.stages.length >= 4);
assert(illustrative.growthRoadmap.graduationSignals.includes("dedicated platform team"));
assert.equal(illustrative.evidenceDistinctions.syntheticFixture, "Not customer evidence");
assert.match(illustrative.evidenceDistinctions.localPlanning, /no Azure calls/);
assert.match(illustrative.firstAction, /alongside AWS/);
assert.match(illustrative.firstAction, /replace an AWS workload/);

const simpleApi = scenariosById.get("simple-non-ai-http-api");
assert.equal(simpleApi.planner.eligible, true);
assert.equal(simpleApi.architecture.computeProfile, "container-apps");
assert.deepEqual(simpleApi.architecture.extensions, []);
assert.deepEqual(
  simpleApi.architecture.serviceRecommendations.map(({ service }) => service),
  ["Azure Container Apps"],
);
assert(simpleApi.architecture.excludedServices.includes("Azure AI Foundry"));
assert(simpleApi.architecture.excludedServices.includes("AKS"));
assert(simpleApi.architecture.excludedServices.includes("Azure Database for PostgreSQL"));
assert(scenariosById.get("gcp-to-azure-migration-planning").route === "migration-planning");
assert.equal(scenariosById.get("gcp-to-azure-migration-planning").liveExecution, "disabled");
assert.equal(scenariosById.get("existing-azure-cost-and-governance").route, "existing-azure-improvement");

const aiUnknowns = scenariosById.get("ai-workload-with-unverified-model-region-and-quota");
assert.equal(aiUnknowns.architecture.computeProfile, null);
assert.deepEqual(aiUnknowns.architecture.serviceRecommendations, []);
assert(aiUnknowns.unknowns.some((value) => /model access, region, quota/.test(value)));
assert.equal(scenariosById.get("contradictory-intent").planner.eligible, false);
assert.equal(scenariosById.get("contradictory-intent").architecture.status, "clarification-required");
assert.equal(scenariosById.get("on-premises-large-team").profile.engineeringTeamSize, 82);
assert.equal(scenariosById.get("on-premises-large-team").planner.eligible, false);

const groundingRegressions = journeys.groundingRegressions;
assert.deepEqual(groundingRegressions.documentationUnavailable.expectedAzureCapabilityClaims, []);
assert.match(
  groundingRegressions.documentationUnavailable.expectedBehavior,
  /leave Azure-specific claims unverified/i,
);
const functionEvidence = groundingRegressions.documentedButNotImplemented;
assert.match(functionEvidence.microsoftLearnUrl, /^https:\/\/learn\.microsoft\.com\//);
assert(normalizedGrounding.includes(functionEvidence.microsoftLearnUrl));
assert(functionEvidence.sslzPaths.every((path) => existsSync(resolve(root, path))));
assert(!readdirSync(resolve(root, "agent/profiles")).some((path) => /functions/i.test(path)));
assert(!workloadPlanner.includes('"functions"'));

for (const url of [
  "https://learn.microsoft.com/en-us/azure/well-architected/reliability/principles",
  "https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/",
  "https://learn.microsoft.com/azure/container-apps/overview",
  "https://learn.microsoft.com/azure/postgresql/flexible-server/overview",
  "https://learn.microsoft.com/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure",
]) {
  assert(normalizedGrounding.includes(url), `Missing verified Microsoft Learn reference: ${url}`);
}
assert(grounding.includes("do not invent URLs"));
assert(normalizedGrounding.includes("Do not assume that a tool listed in another session"));
assert(grounding.includes("quota"));
assert(grounding.includes("capacity"));
assert(grounding.includes("tenant-specific guarantee"));

assert(launcher.includes("permalink: /use-sslz-agent/"));
assert(launcher.includes("copilot --agent sslz-founder"));
assert(launcher.includes('--interactive "Start a new founder journey."'));
assert(launcher.includes("/agent"));
assert(launcher.includes("copilot --agent sslz-founder --prompt"));
assert(launcher.includes("never launch this profile with `--allow-all`"));
assert(launcher.includes("default branch"));
assert(normalizedLauncher.includes("does not receive access to your Azure tenant"));
assert(launcher.includes("Microsoft Learn"));
assert(launcher.includes("SSLZ files that implement or plan each capability"));

console.log(`SSLZ Founder Agent contracts passed across ${scenarios.length} generic scenarios and grounding regressions.`);
