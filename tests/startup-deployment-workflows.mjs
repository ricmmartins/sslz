#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanBundleDirectory,
  stageApprovedDeploymentArtifacts,
} from "../scripts/stage-approved-deployment-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = resolve(
  tmpdir(),
  `sslz-workflow-tests-${process.pid}`,
);
const digest = (value) => `sha256:${value.repeat(64)}`;

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createBundle(name, overrides = {}) {
  const bundlePath = resolve(temporaryRoot, name, "bundle");
  const plan = {
    schemaVersion: "1.0.0",
    inputContractVersion: "3.0.0",
    planId: "workflow-plan",
    planDigest: digest("1"),
    readinessEvidence: {
      schemaVersion: "1.0.0",
      evidenceId: "readiness.workflow.001",
    },
    ...overrides.plan,
  };
  const manifest = {
    schemaVersion: "1.0.0",
    manifestDigest: digest("2"),
    plan: {
      artifactPath: ".sslz/generated/workflow/plan-summary.json",
      id: plan.planId,
      digest: plan.planDigest,
    },
    execution: {
      operation: "platform-baseline.deploy",
      provider: "bicep",
      environment: "nonprod",
      regionRole: "primary",
    },
    artifacts: {
      parameter: {
        path: ".sslz/generated/workflow/bicep/nonprod-primary.bicepparam",
      },
      savedPlan: null,
      provenance: null,
      planJson: null,
    },
    ...overrides.manifest,
  };
  const approval = {
    schemaVersion: "1.0.0",
    status: "approved",
    operation: "platform-baseline.deploy",
    provider: manifest.execution.provider,
    environment: manifest.execution.environment,
    regionRole: "primary",
    planId: plan.planId,
    planDigest: plan.planDigest,
    manifestDigest: manifest.manifestDigest,
    ...overrides.approval,
  };

  writeJson(
    resolve(bundlePath, "generated/workflow/plan-summary.json"),
    plan,
  );
  mkdirSync(resolve(bundlePath, "generated/workflow/bicep"), {
    recursive: true,
  });
  writeFileSync(
    resolve(bundlePath, "generated/workflow/bicep/nonprod-primary.bicepparam"),
    "using '../../../infra/bicep/main.bicep'\n",
    "utf8",
  );
  writeJson(resolve(bundlePath, "deployment-manifest.json"), manifest);
  writeJson(resolve(bundlePath, "deployment-approval.json"), approval);
  return { bundlePath, plan, manifest, approval };
}

function createTerraformBundle(name) {
  const bundle = createBundle(name);
  bundle.manifest.execution.provider = "terraform";
  bundle.manifest.artifacts = {
    parameter: {
      path: ".sslz/generated/workflow/terraform/nonprod-primary.auto.tfvars.json",
    },
    savedPlan: {
      path: ".sslz/generated/workflow/terraform/raw/nonprod-primary.tfplan",
    },
    provenance: {
      path:
        ".sslz/generated/workflow/terraform/raw/nonprod-primary.provenance.json",
    },
    planJson: {
      path: ".sslz/generated/workflow/terraform/raw/nonprod-primary.plan.json",
    },
  };
  bundle.approval.provider = "terraform";
  writeJson(
    resolve(bundle.bundlePath, "deployment-manifest.json"),
    bundle.manifest,
  );
  writeJson(
    resolve(bundle.bundlePath, "deployment-approval.json"),
    bundle.approval,
  );
  writeJson(
    resolve(
      bundle.bundlePath,
      "generated/workflow/terraform/nonprod-primary.auto.tfvars.json",
    ),
    { subscription_id: "33333333-3333-3333-3333-333333333333" },
  );
  mkdirSync(
    resolve(bundle.bundlePath, "generated/workflow/terraform/raw"),
    { recursive: true },
  );
  writeFileSync(
    resolve(
      bundle.bundlePath,
      "generated/workflow/terraform/raw/nonprod-primary.tfplan",
    ),
    "saved plan fixture",
  );
  writeJson(
    resolve(
      bundle.bundlePath,
      "generated/workflow/terraform/raw/nonprod-primary.provenance.json",
    ),
    { schemaVersion: "1.0.0", keyId: digest("3") },
  );
  writeJson(
    resolve(
      bundle.bundlePath,
      "generated/workflow/terraform/raw/nonprod-primary.plan.json",
    ),
    { format_version: "1.2" },
  );
  return bundle;
}

function assertNoInputInterpolationInRun(workflow) {
  const lines = workflow.split(/\r?\n/);
  let runIndent = null;
  for (const line of lines) {
    const indentation = line.match(/^\s*/)[0].length;
    if (runIndent !== null && line.trim() && indentation <= runIndent) {
      runIndent = null;
    }
    if (/^\s+run:/.test(line)) {
      assert.doesNotMatch(line, /\$\{\{\s*inputs\./);
    }
    if (/^\s+run:\s*(?:\||>)?\s*$/.test(line)) {
      runIndent = indentation;
    }
    if (runIndent !== null) {
      assert.doesNotMatch(line, /\$\{\{\s*inputs\./);
    }
  }
}

function assertHardenedWorkflow(workflow, provider) {
  assert.match(workflow, /^on:\r?\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule):/m);
  assert.deepEqual(
    [...workflow.matchAll(/^      ([a-z][a-z0-9_]*):\s*$/gm)].map(
      (match) => match[1],
    ),
    ["environment", "approval_run_id"],
  );
  assert.match(workflow, /approval_run_id:/);
  assert.match(workflow, /approval_run_id:[\s\S]*required: true/);
  assert.match(workflow, /permissions:\r?\n  contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /pull-requests: write/);
  assert.match(workflow, /group: sslz-approved-deployment/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(workflow, /-\s+self-hosted/);
  assert.match(workflow, /-\s+sslz-deployment/);
  assert.match(workflow, new RegExp(`-\\s+${provider}`));
  assert.match(workflow, /clean: false/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(
    workflow,
    /node scripts\/stage-approved-deployment-artifacts\.mjs clean-bundle/,
  );
  assert.match(
    workflow,
    /node scripts\/stage-approved-deployment-artifacts\.mjs stage/,
  );
  assert.match(workflow, /uses: actions\/download-artifact@v4/);
  assert.match(
    workflow,
    new RegExp(
      `name: sslz-approved-deployment-${provider}-\\$\\{\\{ inputs\\.environment \\}\\}`,
    ),
  );
  assert.match(workflow, /run-id: \$\{\{ inputs\.approval_run_id \}\}/);
  assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
  assert.match(
    workflow,
    /SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE: \$\{\{ vars\.SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE \}\}/,
  );
  assert.match(
    workflow,
    /node scripts\/startup-deployment-integration\.mjs apply/,
  );
  assert.match(
    workflow,
    /--plan \.sslz\/generated\/workflow\/plan-summary\.json/,
  );
  assert.match(
    workflow,
    /--manifest \.sslz\/approved\/deployment-manifest\.json/,
  );
  assert.match(
    workflow,
    /--approval \.sslz\/approved\/deployment-approval\.json/,
  );
  assert.match(workflow, new RegExp(`--provider ${provider}`));
  assert.match(
    workflow,
    /--environment "\$SSLZ_DEPLOYMENT_ENVIRONMENT"/,
  );
  assertNoInputInterpolationInRun(workflow);
}

mkdirSync(temporaryRoot, { recursive: true });
try {
  const workspace = resolve(temporaryRoot, "workspace");
  const statePath = resolve(
    workspace,
    ".sslz/deployment-state/.durable-store.json",
  );
  writeJson(statePath, {
    schemaVersion: "1.0.0",
    durable: true,
    storeId: "77777777-7777-4777-8777-777777777777",
  });
  const valid = createBundle("valid");
  stageApprovedDeploymentArtifacts({
    bundlePath: valid.bundlePath,
    workspaceRoot: workspace,
    provider: "bicep",
    environment: "nonprod",
  });
  assert.equal(existsSync(statePath), true);
  assert.equal(
    existsSync(
      resolve(
        workspace,
        ".sslz/generated/workflow/plan-summary.json",
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(
      resolve(workspace, ".sslz/approved/deployment-manifest.json"),
    ),
    true,
  );

  const missing = createBundle("missing");
  rmSync(
    resolve(
      missing.bundlePath,
      "generated/workflow/bicep/nonprod-primary.bicepparam",
    ),
  );
  assert.throws(
    () =>
      stageApprovedDeploymentArtifacts({
        bundlePath: missing.bundlePath,
        workspaceRoot: resolve(temporaryRoot, "missing-workspace"),
        provider: "bicep",
        environment: "nonprod",
      }),
    /missing or is not a regular file/,
  );

  const wrongTarget = createBundle("wrong-target");
  assert.throws(
    () =>
      stageApprovedDeploymentArtifacts({
        bundlePath: wrongTarget.bundlePath,
        workspaceRoot: resolve(temporaryRoot, "wrong-target-workspace"),
        provider: "bicep",
        environment: "prod",
      }),
    /manifest does not match the selected workflow target/,
  );

  const legacy = createBundle("legacy", {
    plan: { inputContractVersion: "2.0.0", readinessEvidence: null },
  });
  assert.throws(
    () =>
      stageApprovedDeploymentArtifacts({
        bundlePath: legacy.bundlePath,
        workspaceRoot: resolve(temporaryRoot, "legacy-workspace"),
        provider: "bicep",
        environment: "nonprod",
      }),
    /readiness-bound v3 plan/,
  );

  const terraform = createTerraformBundle("terraform");
  const terraformWorkspace = resolve(temporaryRoot, "terraform-workspace");
  stageApprovedDeploymentArtifacts({
    bundlePath: terraform.bundlePath,
    workspaceRoot: terraformWorkspace,
    provider: "terraform",
    environment: "nonprod",
  });
  assert.equal(
    existsSync(
      resolve(
        terraformWorkspace,
        ".sslz/generated/workflow/terraform/raw/nonprod-primary.tfplan",
      ),
    ),
    true,
  );

  const missingProvenance = createTerraformBundle("missing-provenance");
  rmSync(
    resolve(
      missingProvenance.bundlePath,
      "generated/workflow/terraform/raw/nonprod-primary.provenance.json",
    ),
  );
  assert.throws(
    () =>
      stageApprovedDeploymentArtifacts({
        bundlePath: missingProvenance.bundlePath,
        workspaceRoot: resolve(
          temporaryRoot,
          "missing-provenance-workspace",
        ),
        provider: "terraform",
        environment: "nonprod",
      }),
    /missing or is not a regular file/,
  );

  const unexpected = createBundle("unexpected");
  writeFileSync(resolve(unexpected.bundlePath, "unreviewed.sh"), "exit 0\n");
  assert.throws(
    () =>
      stageApprovedDeploymentArtifacts({
        bundlePath: unexpected.bundlePath,
        workspaceRoot: resolve(temporaryRoot, "unexpected-workspace"),
        provider: "bicep",
        environment: "nonprod",
      }),
    /unexpected or incomplete root layout/,
  );

  const runnerTemp = resolve(temporaryRoot, "runner-temp");
  const staleBundle = resolve(runnerTemp, "approved-bundle");
  mkdirSync(staleBundle, { recursive: true });
  writeFileSync(resolve(staleBundle, "stale.json"), "{}\n");
  cleanBundleDirectory(staleBundle, runnerTemp);
  assert.equal(existsSync(staleBundle), false);

  const bicepWorkflow = readFileSync(
    resolve(root, ".github/workflows/deploy-bicep.yml"),
    "utf8",
  );
  const terraformWorkflow = readFileSync(
    resolve(root, ".github/workflows/deploy-terraform.yml"),
    "utf8",
  );
  assertHardenedWorkflow(bicepWorkflow, "bicep");
  assertHardenedWorkflow(terraformWorkflow, "terraform");
  assert.match(
    terraformWorkflow,
    /SSLZ_TERRAFORM_EXECUTABLE: \$\{\{ vars\.SSLZ_TERRAFORM_EXECUTABLE \}\}/,
  );
  assert.match(
    terraformWorkflow,
    /SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE: \$\{\{ vars\.SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE \}\}/,
  );

  const workflowDirectory = resolve(root, ".github/workflows");
  const deploymentWritePattern =
    /\baz deployment (?:sub|tenant|mg) create\b|\bterraform (?:apply|destroy)\b|\baz provider register\b/i;
  for (const file of readdirSync(workflowDirectory)) {
    if (!file.endsWith(".yml")) {
      continue;
    }
    assert.doesNotMatch(
      readFileSync(resolve(workflowDirectory, file), "utf8"),
      deploymentWritePattern,
      `${file} must not bypass the approved integration`,
    );
  }

  const integrationWorkflow = readFileSync(
    resolve(workflowDirectory, "integration-test.yml"),
    "utf8",
  );
  assert.doesNotMatch(integrationWorkflow, /^\s+deploy:/m);
  assert.doesNotMatch(integrationWorkflow, /deploy-validate-teardown/);
  assert.match(integrationWorkflow, /az deployment sub what-if/);
  assert.match(integrationWorkflow, /terraform plan -out=tfplan/);

  const validateWorkflow = readFileSync(
    resolve(workflowDirectory, "validate.yml"),
    "utf8",
  );
  assert.match(validateWorkflow, /'\.github\/workflows\/\*\*'/);
  assert.match(
    validateWorkflow,
    /'scripts\/stage-approved-deployment-artifacts\.mjs'/,
  );
  assert.match(
    validateWorkflow,
    /node tests\/startup-deployment-workflows\.mjs/,
  );
  assert.match(
    readFileSync(resolve(root, ".gitignore"), "utf8"),
    /^\.sslz\/approved\/$/m,
  );

  const cli = resolve(root, "scripts/startup-deployment-integration.mjs");
  const cliPlan = resolve(temporaryRoot, "cli-plan.json");
  const cliManifest = resolve(temporaryRoot, "cli-manifest.json");
  const cliApproval = resolve(temporaryRoot, "cli-approval.json");
  writeJson(cliPlan, valid.plan);
  writeJson(cliManifest, valid.manifest);
  writeJson(cliApproval, valid.approval);
  const missingSelection = spawnSync(
    process.execPath,
    [
      cli,
      "apply",
      "--plan",
      cliPlan,
      "--manifest",
      cliManifest,
      "--approval",
      cliApproval,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(missingSelection.status, 2);

  const targetMismatch = spawnSync(
    process.execPath,
    [
      cli,
      "apply",
      "--plan",
      cliPlan,
      "--manifest",
      cliManifest,
      "--approval",
      cliApproval,
      "--provider",
      "bicep",
      "--environment",
      "prod",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(targetMismatch.status, 1);
  const mismatchResult = JSON.parse(targetMismatch.stdout);
  assert.equal(
    mismatchResult.code,
    "deployment.workflow-target.mismatch",
  );
  assert.equal(mismatchResult.safety.deploymentWrites, 0);

  console.log("Startup deployment workflow hardening tests passed.");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
