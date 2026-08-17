#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const EXPECTED_BASELINE_COMMIT =
  "d2d1ea823c33affeb620ec6acbc90536ec646c2d";
const EXPECTED_BASELINE_TREE = "77070a7f81ab85fe2d0d58659f90901668e9b9c7";
const EXPECTED_CLEAN_ROOT_COMMIT =
  "a4de206d8878f9c012203bee740b46f0b9234e14";
const EXPECTED_RECOVERY_BASE_COMMIT =
  "b8fe8254c29cdbea3ddd6d4f10bbaa8de3c21223";
const EXPECTED_RECOVERY_BASE_TREE =
  "02146c85e1f8d86d747a9cd732992699e3743c12";
const EXPECTED_INTEGRATION_BASE_COMMIT =
  "ff16a2ce81425507461bba52ec9319ba1ce55020";
const EXPECTED_INTEGRATION_BASE_TREE =
  "15b4168644e33988e265561a28b28dcb3ef4bd13";
const EXPECTED_AGENT_SOURCE_COMMIT =
  "b0c24640a833e0302e0edc4a542948301f33bbd2";
const EXPECTED_AGENT_LAUNCHER_PATH = "use-sslz-agent.md";
const EXPECTED_AGENT_LAUNCHER_BLOB =
  "39c4f0c959b39f0e70a0b8032e35579dce9f28df";
const EXPECTED_AGENT_PROFILE_PATH = ".github/agents/sslz-founder.agent.md";
const EXPECTED_AGENT_PROFILE_BLOB =
  "6cd3691239ea9d243c837f2eb0507dae455a65f6";
const REPO_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const MANIFEST_PATH = resolve(
  REPO_ROOT,
  ".github",
  "classic-baseline-manifest.json",
);

function git(args, { cwd = REPO_ROOT, trim = true } = {}) {
  const output = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  return trim ? output.trim() : output;
}

function parseNameStatus(output) {
  if (!output) {
    return [];
  }
  const fields = output.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length % 2 !== 0) {
    throw new Error("Unexpected git diff --name-status output.");
  }
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    changes.push({ status: fields[index], path: fields[index + 1] });
  }
  return changes;
}

function canonicalChanges(changes) {
  return changes
    .map(({ path, status }) => ({ path, status }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
}

function compareAllowedChanges(actualChanges, allowedChanges) {
  const actual = canonicalChanges(actualChanges);
  const allowed = canonicalChanges(allowedChanges);
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
    throw new Error(
      [
        "Classic tree differs from the approved baseline allowlist.",
        `Expected: ${JSON.stringify(allowed)}`,
        `Actual:   ${JSON.stringify(actual)}`,
      ].join("\n"),
    );
  }
  return actual;
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function isAgentPath(path) {
  return /(^|[._/-])agents?(?=[._/-]|$)/i.test(path);
}

function readCommitPath(commit, path) {
  return git(["show", `${commit}:${path}`], { trim: false });
}

function expectedReadme(baselineReadme, manifest) {
  const original = manifest.readme.originalBadges.join("\n");
  if (countOccurrences(baselineReadme, original) !== 1) {
    throw new Error("Baseline README badge block is not uniquely identifiable.");
  }
  return baselineReadme.replace(
    original,
    manifest.readme.approvedBadges.join("\n"),
  );
}

function expectedHomepage(baselineHomepage, manifest) {
  const { cta, insertAfter } = manifest.homepage;
  if (countOccurrences(baselineHomepage, insertAfter) !== 1) {
    throw new Error("Baseline homepage CTA insertion point is not unique.");
  }
  return baselineHomepage.replace(insertAfter, `${insertAfter}\n${cta}`);
}

function expectedValidateWorkflow(baselineWorkflow, manifest) {
  const { entry, insertAfter } = manifest.validateWorkflow;
  if (countOccurrences(baselineWorkflow, `${insertAfter}\n`) !== 1) {
    throw new Error("Baseline Validate IaC trigger is not uniquely identifiable.");
  }
  return baselineWorkflow.replace(
    `${insertAfter}\n`,
    `${insertAfter}\n${entry}\n`,
  );
}

function validateClassicBaseline({
  head = "HEAD",
  manifestPath = MANIFEST_PATH,
  repoRoot = REPO_ROOT,
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 2) {
    throw new Error(`Unsupported classic manifest schema: ${manifest.schemaVersion}`);
  }
  if (
    manifest.baseline.commit !== EXPECTED_BASELINE_COMMIT ||
    manifest.baseline.tree !== EXPECTED_BASELINE_TREE ||
    manifest.cleanRoot.commit !== EXPECTED_CLEAN_ROOT_COMMIT ||
    manifest.cleanRoot.tree !== EXPECTED_BASELINE_TREE ||
    manifest.recoveryBase.commit !== EXPECTED_RECOVERY_BASE_COMMIT ||
    manifest.recoveryBase.tree !== EXPECTED_RECOVERY_BASE_TREE ||
    manifest.integrationBase.commit !== EXPECTED_INTEGRATION_BASE_COMMIT ||
    manifest.integrationBase.tree !== EXPECTED_INTEGRATION_BASE_TREE ||
    manifest.approvedAgentSource.commit !== EXPECTED_AGENT_SOURCE_COMMIT ||
    manifest.approvedAgentSource.launcherPath !==
      EXPECTED_AGENT_LAUNCHER_PATH ||
    manifest.approvedAgentSource.launcherBlob !==
      EXPECTED_AGENT_LAUNCHER_BLOB ||
    manifest.approvedAgentSource.profilePath !== EXPECTED_AGENT_PROFILE_PATH ||
    manifest.approvedAgentSource.profileBlob !== EXPECTED_AGENT_PROFILE_BLOB
  ) {
    throw new Error(
      "Classic manifest does not identify the authorized classic and launcher sources.",
    );
  }

  const resolvedHead = git(["rev-parse", `${head}^{commit}`], { cwd: repoRoot });
  const headLineage = git(["rev-list", "--parents", "-n", "1", resolvedHead], {
    cwd: repoRoot,
  }).split(/\s+/);
  if (
    headLineage.length !== 2 ||
    headLineage[1] !== EXPECTED_INTEGRATION_BASE_COMMIT
  ) {
    throw new Error(
      "Classic launcher integration must be one commit above the approved main integration base.",
    );
  }
  const integrationBaseLineage = git(
    ["rev-list", "--parents", "-n", "1", EXPECTED_INTEGRATION_BASE_COMMIT],
    { cwd: repoRoot },
  ).split(/\s+/);
  const integrationBaseTree = git(
    ["rev-parse", `${EXPECTED_INTEGRATION_BASE_COMMIT}^{tree}`],
    { cwd: repoRoot },
  );
  const recoveryBaseLineage = git(
    ["rev-list", "--parents", "-n", "1", EXPECTED_RECOVERY_BASE_COMMIT],
    { cwd: repoRoot },
  ).split(/\s+/);
  const recoveryBaseTree = git(
    ["rev-parse", `${EXPECTED_RECOVERY_BASE_COMMIT}^{tree}`],
    { cwd: repoRoot },
  );
  const rootLineage = git(
    ["rev-list", "--parents", "-n", "1", EXPECTED_CLEAN_ROOT_COMMIT],
    { cwd: repoRoot },
  ).split(/\s+/);
  const cleanRootTree = git(
    ["rev-parse", `${EXPECTED_CLEAN_ROOT_COMMIT}^{tree}`],
    { cwd: repoRoot },
  );
  if (
    integrationBaseLineage.length !== 2 ||
    integrationBaseLineage[1] !== EXPECTED_RECOVERY_BASE_COMMIT ||
    integrationBaseTree !== EXPECTED_INTEGRATION_BASE_TREE ||
    recoveryBaseLineage.length !== 2 ||
    recoveryBaseLineage[1] !== EXPECTED_CLEAN_ROOT_COMMIT ||
    recoveryBaseTree !== EXPECTED_RECOVERY_BASE_TREE ||
    rootLineage.length !== 1 ||
    cleanRootTree !== EXPECTED_BASELINE_TREE ||
    git(["cat-file", "-t", EXPECTED_BASELINE_TREE], { cwd: repoRoot }) !== "tree"
  ) {
    throw new Error(
      "Clean root must be parentless and byte-equivalent to the authorized source baseline tree.",
    );
  }

  const declaredPaths = manifest.allowedChanges.map(({ path }) => path);
  if (
    new Set(declaredPaths).size !== declaredPaths.length ||
    JSON.stringify(declaredPaths) !==
      JSON.stringify(
        [...declaredPaths].sort((left, right) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      )
  ) {
    throw new Error("Classic manifest allowlist paths must be unique and sorted.");
  }

  const diff = git(
    [
      "diff",
      "--name-status",
      "--no-renames",
      "-z",
      EXPECTED_BASELINE_TREE,
      resolvedHead,
    ],
    { cwd: repoRoot, trim: false },
  );
  const changes = compareAllowedChanges(
    parseNameStatus(diff),
    manifest.allowedChanges,
  );

  for (const entry of manifest.allowedChanges) {
    if (!entry.expectedBlob) {
      continue;
    }
    const blob = git(["rev-parse", `${resolvedHead}:${entry.path}`], {
      cwd: repoRoot,
    });
    if (blob !== entry.expectedBlob) {
      throw new Error(
        `${entry.path} does not match approved blob ${entry.expectedBlob}.`,
      );
    }
  }

  const baselineReadmeBlob = git(
    ["rev-parse", `${EXPECTED_BASELINE_TREE}:README.md`],
    { cwd: repoRoot },
  );
  const baselineHomepageBlob = git(
    ["rev-parse", `${EXPECTED_BASELINE_TREE}:index.md`],
    { cwd: repoRoot },
  );
  const baselineValidateWorkflowBlob = git(
    ["rev-parse", `${EXPECTED_BASELINE_TREE}:.github/workflows/validate.yml`],
    { cwd: repoRoot },
  );
  if (
    baselineReadmeBlob !== manifest.readme.baselineBlob ||
    baselineHomepageBlob !== manifest.homepage.baselineBlob ||
    baselineValidateWorkflowBlob !== manifest.validateWorkflow.baselineBlob
  ) {
    throw new Error("Classic content baseline blobs do not match the manifest.");
  }

  const baselineReadme = readCommitPath(EXPECTED_BASELINE_TREE, "README.md");
  const currentReadme = readCommitPath(resolvedHead, "README.md");
  const approvedReadme = expectedReadme(baselineReadme, manifest);
  if (currentReadme !== approvedReadme) {
    throw new Error("README differs from the approved badge-only transformation.");
  }
  const badgeLines = currentReadme
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[!["));
  if (
    JSON.stringify(badgeLines) !==
    JSON.stringify(manifest.readme.approvedBadges)
  ) {
    throw new Error("README must contain exactly the two approved health badges.");
  }

  const baselineHomepage = readCommitPath(EXPECTED_BASELINE_TREE, "index.md");
  const currentHomepage = readCommitPath(resolvedHead, "index.md");
  const approvedHomepage = expectedHomepage(baselineHomepage, manifest);
  if (currentHomepage !== approvedHomepage) {
    throw new Error("Homepage differs from the baseline plus the approved CTA.");
  }
  if (
    countOccurrences(currentHomepage, manifest.homepage.label) !== 1 ||
    countOccurrences(currentHomepage, manifest.homepage.url) !== 1 ||
    countOccurrences(currentHomepage, manifest.homepage.legacyUrl) !== 0
  ) {
    throw new Error("Homepage must contain exactly one approved SSLZ Agent CTA.");
  }
  if (/agent-aware/i.test(currentHomepage)) {
    throw new Error(
      "Classic founder-facing homepage copy must not mention agent-aware.",
    );
  }

  if (
    manifest.launcher.path !== manifest.approvedAgentSource.launcherPath ||
    manifest.launcher.expectedBlob !==
      manifest.allowedChanges.find(
        ({ path }) => path === manifest.launcher.path,
      )?.expectedBlob
  ) {
    throw new Error("Launcher path and blob must be pinned consistently.");
  }
  const currentLauncher = readCommitPath(resolvedHead, manifest.launcher.path);
  if (
    countOccurrences(
      currentLauncher,
      `permalink: ${manifest.launcher.permalink}`,
    ) !== 1 ||
    countOccurrences(
      currentLauncher,
      `title: "${manifest.launcher.title}"`,
    ) !== 1 ||
    !currentLauncher.includes(manifest.launcher.product) ||
    !currentLauncher.includes("This page provides setup instructions only") ||
    !currentLauncher.includes(
      `git clone --branch ${manifest.launcher.technicalBranch} --single-branch`,
    ) ||
    !currentLauncher.includes(EXPECTED_AGENT_SOURCE_COMMIT)
  ) {
    throw new Error(
      "Launcher is missing an approved identity, route, or local setup boundary.",
    );
  }
  const launcherHeadings = currentLauncher
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s/.test(line));
  if (launcherHeadings.some((heading) => /agent-aware/i.test(heading))) {
    throw new Error(
      "Technical branch names must not appear as launcher product headings.",
    );
  }

  const baselineValidateWorkflow = readCommitPath(
    EXPECTED_BASELINE_TREE,
    ".github/workflows/validate.yml",
  );
  const currentValidateWorkflow = readCommitPath(
    resolvedHead,
    ".github/workflows/validate.yml",
  );
  const approvedValidateWorkflow = expectedValidateWorkflow(
    baselineValidateWorkflow,
    manifest,
  );
  if (currentValidateWorkflow !== approvedValidateWorkflow) {
    throw new Error(
      "Validate IaC workflow differs from the baseline plus workflow_dispatch.",
    );
  }
  if (countOccurrences(currentValidateWorkflow, "workflow_dispatch:") !== 1) {
    throw new Error(
      "Validate IaC workflow must contain exactly one workflow_dispatch trigger.",
    );
  }

  const paths = git(["ls-tree", "-r", "--name-only", resolvedHead], {
    cwd: repoRoot,
  }).split(/\r?\n/);
  if (paths.includes(EXPECTED_AGENT_PROFILE_PATH)) {
    throw new Error("Classic tree must not contain the SSLZ Founder Agent profile.");
  }
  const agentPaths = paths.filter(isAgentPath);
  if (
    JSON.stringify(agentPaths) !== JSON.stringify([manifest.launcher.path])
  ) {
    throw new Error(
      `Classic tree contains unapproved agent route/content paths: ${agentPaths.join(", ")}`,
    );
  }

  return {
    baseline: EXPECTED_BASELINE_COMMIT,
    baselineRoot: EXPECTED_CLEAN_ROOT_COMMIT,
    baselineTree: EXPECTED_BASELINE_TREE,
    recoveryBase: EXPECTED_RECOVERY_BASE_COMMIT,
    integrationBase: EXPECTED_INTEGRATION_BASE_COMMIT,
    head: resolvedHead,
    changes,
  };
}

function parseArguments(argv) {
  if (argv.length === 0) {
    return { head: "HEAD" };
  }
  if (argv.length === 2 && argv[0] === "--head") {
    return { head: argv[1] };
  }
  throw new Error("Usage: validate-classic-baseline.mjs [--head <ref>]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = validateClassicBaseline(parseArguments(process.argv.slice(2)));
    console.log(
      `Classic baseline is valid at ${result.head} with ${result.changes.length} approved path change(s).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  compareAllowedChanges,
  expectedHomepage,
  expectedReadme,
  expectedValidateWorkflow,
  isAgentPath,
  parseNameStatus,
  validateClassicBaseline,
};
