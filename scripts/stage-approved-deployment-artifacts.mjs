#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const APPROVED_DIRECTORY = ".sslz/approved";
const WORKFLOW_GENERATED_DIRECTORY = ".sslz/generated/workflow";
const PLAN_PATH = `${WORKFLOW_GENERATED_DIRECTORY}/plan-summary.json`;
const MANIFEST_NAME = "deployment-manifest.json";
const APPROVAL_NAME = "deployment-approval.json";

function fail(message) {
  throw new Error(message);
}

function assertContained(base, path, label) {
  const relation = relative(base, path);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail(`${label} must be a child of its protected root.`);
  }
}

function assertNoSymlinks(base, path, label) {
  assertContained(base, path, label);
  const segments = relative(base, path).split(sep).filter(Boolean);
  let current = base;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      fail(`${label} cannot contain symbolic links.`);
    }
  }
}

function assertRegularFile(path, label) {
  if (
    !existsSync(path) ||
    lstatSync(path).isSymbolicLink() ||
    !statSync(path).isFile()
  ) {
    fail(`${label} is missing or is not a regular file.`);
  }
}

function readJson(path, label) {
  assertRegularFile(path, label);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function generatedBundlePath(bundlePath, repositoryPath) {
  const prefix = `${WORKFLOW_GENERATED_DIRECTORY}/`;
  if (
    typeof repositoryPath !== "string" ||
    !repositoryPath.startsWith(prefix) ||
    repositoryPath.includes("\\") ||
    repositoryPath.split("/").includes("..")
  ) {
    fail("Every approved generated artifact must use the fixed workflow output directory.");
  }
  return resolve(bundlePath, repositoryPath.slice(".sslz/".length));
}

function removeProtectedChild(workspaceRoot, relativePath) {
  const path = resolve(workspaceRoot, relativePath);
  assertNoSymlinks(workspaceRoot, path, relativePath);
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function cleanApprovedDeploymentWorkspace(workspaceRoot) {
  const resolvedRoot = resolve(workspaceRoot);
  removeProtectedChild(resolvedRoot, APPROVED_DIRECTORY);
  removeProtectedChild(resolvedRoot, WORKFLOW_GENERATED_DIRECTORY);
}

function cleanBundleDirectory(bundlePath, runnerTemp) {
  const tempRoot = resolve(runnerTemp);
  const resolvedBundle = resolve(bundlePath);
  assertNoSymlinks(tempRoot, resolvedBundle, "The approval bundle directory");
  if (existsSync(resolvedBundle)) {
    rmSync(resolvedBundle, { recursive: true, force: true });
  }
}

function inspectBundleTree(bundlePath) {
  const allowedRootEntries = [
    APPROVAL_NAME,
    MANIFEST_NAME,
    "generated",
  ];
  const rootEntries = readdirSync(bundlePath, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  if (
    JSON.stringify(rootEntries.map((entry) => entry.name)) !==
      JSON.stringify(allowedRootEntries) ||
    rootEntries.some(
      (entry) =>
        entry.isSymbolicLink() ||
        (entry.name === "generated" ? !entry.isDirectory() : !entry.isFile()),
    )
  ) {
    fail("The approval bundle has an unexpected or incomplete root layout.");
  }

  const generatedRoot = resolve(bundlePath, "generated");
  const generatedEntries = readdirSync(generatedRoot, {
    withFileTypes: true,
  });
  if (
    generatedEntries.length !== 1 ||
    generatedEntries[0].name !== "workflow" ||
    generatedEntries[0].isSymbolicLink() ||
    !generatedEntries[0].isDirectory()
  ) {
    fail("The approval bundle must contain only generated/workflow artifacts.");
  }

  const workflowRoot = resolve(generatedRoot, "workflow");
  const pending = [workflowRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = resolve(current, entry.name);
      if (entry.isSymbolicLink()) {
        fail("The approval bundle cannot contain symbolic links.");
      }
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (!entry.isFile()) {
        fail("The approval bundle can contain only regular files.");
      }
    }
  }
}

function selectedGeneratedPaths(manifest) {
  return [
    manifest?.plan?.artifactPath,
    manifest?.artifacts?.parameter?.path,
    manifest?.artifacts?.savedPlan?.path,
    manifest?.artifacts?.provenance?.path,
    manifest?.artifacts?.planJson?.path,
  ].filter(Boolean);
}

function assertWorkflowBinding(plan, manifest, approval, provider, environment) {
  if (!["bicep", "terraform"].includes(provider)) {
    fail("The workflow provider must be bicep or terraform.");
  }
  if (!["prod", "nonprod"].includes(environment)) {
    fail("The workflow environment must be prod or nonprod.");
  }
  if (
    plan?.inputContractVersion !== "3.0.0" ||
    !plan.readinessEvidence
  ) {
    fail("Approved workflow deployment requires a readiness-bound v3 plan.");
  }
  if (
    manifest?.plan?.artifactPath !== PLAN_PATH ||
    manifest?.plan?.id !== plan.planId ||
    manifest?.plan?.digest !== plan.planDigest
  ) {
    fail("The manifest does not bind the fixed workflow plan artifact.");
  }
  if (
    manifest?.execution?.provider !== provider ||
    manifest?.execution?.environment !== environment ||
    manifest?.execution?.regionRole !== "primary" ||
    manifest?.execution?.operation !== "platform-baseline.deploy"
  ) {
    fail("The manifest does not match the selected workflow target.");
  }
  if (
    approval?.status !== "approved" ||
    approval?.provider !== provider ||
    approval?.environment !== environment ||
    approval?.regionRole !== "primary" ||
    approval?.operation !== "platform-baseline.deploy" ||
    approval?.planId !== plan.planId ||
    approval?.planDigest !== plan.planDigest ||
    approval?.manifestDigest !== manifest.manifestDigest
  ) {
    fail("The approval does not match the selected workflow target and manifest.");
  }
}

function stageApprovedDeploymentArtifacts({
  bundlePath,
  workspaceRoot,
  provider,
  environment,
}) {
  const resolvedBundle = resolve(bundlePath);
  const resolvedWorkspace = resolve(workspaceRoot);
  if (
    !existsSync(resolvedBundle) ||
    lstatSync(resolvedBundle).isSymbolicLink() ||
    !statSync(resolvedBundle).isDirectory()
  ) {
    fail("The downloaded approval bundle is not a regular directory.");
  }
  inspectBundleTree(resolvedBundle);

  const manifest = readJson(
    resolve(resolvedBundle, MANIFEST_NAME),
    "The deployment manifest",
  );
  const approval = readJson(
    resolve(resolvedBundle, APPROVAL_NAME),
    "The deployment approval",
  );
  const planBundlePath = generatedBundlePath(resolvedBundle, PLAN_PATH);
  const plan = readJson(planBundlePath, "The Phase 4 plan");
  assertWorkflowBinding(plan, manifest, approval, provider, environment);

  for (const repositoryPath of selectedGeneratedPaths(manifest)) {
    assertRegularFile(
      generatedBundlePath(resolvedBundle, repositoryPath),
      "A manifest-bound generated artifact",
    );
  }

  cleanApprovedDeploymentWorkspace(resolvedWorkspace);
  const destinationGenerated = resolve(
    resolvedWorkspace,
    WORKFLOW_GENERATED_DIRECTORY,
  );
  const destinationApproved = resolve(resolvedWorkspace, APPROVED_DIRECTORY);
  mkdirSync(destinationGenerated, { recursive: true, mode: 0o700 });
  mkdirSync(destinationApproved, { recursive: true, mode: 0o700 });
  cpSync(
    resolve(resolvedBundle, "generated/workflow"),
    destinationGenerated,
    { recursive: true, force: false, errorOnExist: true },
  );
  cpSync(
    resolve(resolvedBundle, MANIFEST_NAME),
    resolve(destinationApproved, MANIFEST_NAME),
    { force: false, errorOnExist: true },
  );
  cpSync(
    resolve(resolvedBundle, APPROVAL_NAME),
    resolve(destinationApproved, APPROVAL_NAME),
    { force: false, errorOnExist: true },
  );
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    fail(`The protected ${name} setting is required.`);
  }
  return value;
}

function main() {
  try {
    const command = process.argv[2];
    const bundlePath = requiredEnvironment("SSLZ_APPROVED_BUNDLE_PATH");
    const runnerTemp = requiredEnvironment("RUNNER_TEMP");
    if (command === "clean-bundle") {
      cleanBundleDirectory(bundlePath, runnerTemp);
    } else if (command === "stage") {
      const resolvedBundle = resolve(bundlePath);
      assertNoSymlinks(
        resolve(runnerTemp),
        resolvedBundle,
        "The approval bundle directory",
      );
      stageApprovedDeploymentArtifacts({
        bundlePath: resolvedBundle,
        workspaceRoot: process.cwd(),
        provider: requiredEnvironment("SSLZ_DEPLOYMENT_PROVIDER"),
        environment: requiredEnvironment("SSLZ_DEPLOYMENT_ENVIRONMENT"),
      });
      process.stdout.write("Approved deployment artifacts staged.\n");
    } else {
      fail("The command must be clean-bundle or stage.");
    }
  } catch (error) {
    process.stderr.write(`Workflow artifact staging failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

export {
  cleanApprovedDeploymentWorkspace,
  cleanBundleDirectory,
  stageApprovedDeploymentArtifacts,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
