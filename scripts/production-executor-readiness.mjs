#!/usr/bin/env node

import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  keyFingerprint,
  readTrustedPublicKey,
  requireDurableStateStore,
} from "./startup-deployment-integration.mjs";
import { terraformExecutable } from "./terraform-plan-provenance.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const externalChecksRequired = [
  "Azure executor identity, effective RBAC including inherited grants, and OIDC federation",
  "GitHub environment reviewers, branch restrictions, runner isolation, and concurrency",
  "Public-key provenance, protected key-file ACLs, independent approver and builder authorization",
  "Replay volume persistence, backup integrity, and same-executor filesystem identity",
  "Remote backend existence, Azure AD data-plane authorization, locking, backup, and restore",
  "Terraform binary supply-chain trust and plan-bound version/platform (when selected)",
  "Real approved deployment, postchecks, measured recovery, and alert receipt",
];

function checkProductionExecutor({ provider, backend, workload } = {}) {
  if (!["bicep", "terraform"].includes(provider)) {
    throw new Error("Select --provider bicep or terraform.");
  }
  if (workload !== undefined && (workload !== "greenfield-acceptance" || provider !== "bicep")) {
    throw new Error("The greenfield-acceptance workload currently supports only Bicep.");
  }
  const checks = [];
  function check(id, operation, failureMessage) {
    try {
      checks.push({ id, status: "passed", ...operation() });
    } catch (error) {
      checks.push({
        id,
        status: "failed",
        code: error.code ?? "executor.prerequisite.invalid",
        message: error.code?.startsWith("deployment.")
          ? error.message
          : failureMessage ?? "Local prerequisite is missing, unreadable, or invalid.",
      });
    }
  }
  function publicKey(environmentName) {
    const pem = readTrustedPublicKey(
      environmentName,
      "deployment.approval.trust-anchor",
      `${environmentName} must identify a provisioned absolute public-key path.`,
    );
    if (pem.includes("PRIVATE KEY")) {
      throw new Error("A public key, not signing material, is required.");
    }
    return { keyId: keyFingerprint(pem), authorityVerified: false };
  }

  check("deployment-approval-public-key", () =>
    publicKey("SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE"),
    "The deployment approval key must be a readable Ed25519 public key.",
  );
  check("provider-approval-public-key", () =>
    publicKey("SSLZ_PROVIDER_APPROVAL_PUBLIC_KEY_FILE"),
    "The provider approval key must be a readable Ed25519 public key.",
  );
  if (workload) {
    check("workload-approval-public-key", () =>
      publicKey("SSLZ_WORKLOAD_APPROVAL_PUBLIC_KEY_FILE"),
      "The workload approval key must be a readable Ed25519 public key.",
    );
    check("workload-image-provenance-public-key", () =>
      publicKey("SSLZ_WORKLOAD_IMAGE_PROVENANCE_PUBLIC_KEY_FILE"),
      "The image builder key must be a readable Ed25519 public key.",
    );
    check("workload-independent-image-authority", () => {
      const approval = publicKey("SSLZ_WORKLOAD_APPROVAL_PUBLIC_KEY_FILE");
      const image = publicKey("SSLZ_WORKLOAD_IMAGE_PROVENANCE_PUBLIC_KEY_FILE");
      if (approval.keyId === image.keyId) throw new Error("Image builder and deployment approver must use separate keys.");
      return { distinctKeys: true, organizationalSeparationVerified: false };
    }, "Image provenance and workload approval must use distinct keys; administrative separation still requires external verification.");
  }
  check("fixed-durable-replay-store", () => {
    const store = requireDurableStateStore(".sslz/deployment-state");
    return {
      effectiveStoreId: store.storeId,
      localPermissionsChecked: true,
      durabilityVerified: false,
    };
  });
  if (provider === "terraform") {
    check("terraform-provenance-public-key", () =>
      publicKey("SSLZ_TERRAFORM_PROVENANCE_PUBLIC_KEY_FILE"),
      "The Terraform provenance key must be a readable Ed25519 public key.",
    );
    check("terraform-executable", () => {
      const executable = terraformExecutable();
      accessSync(executable.path, constants.R_OK | constants.X_OK);
      return {
        digest: executable.digest,
        versionAndPlatformVerified: false,
        supplyChainTrustVerified: false,
      };
    }, "Terraform must resolve to a readable executable at the protected absolute installation path.");
    check("terraform-remote-backend-coordinates", () => {
      const inputSchema = JSON.parse(
        readFileSync(resolve(root, "agent/schemas/iac-plan-input.schema.json"), "utf8"),
      );
      const backendSchema = structuredClone(
        inputSchema.properties.deployment.properties.terraformBackend,
      );
      backendSchema.required.push("subscriptionId");
      backendSchema.$defs = { uuid: inputSchema.$defs.uuid };
      validateDocument(backendSchema, backend);
      return { remoteAccessVerified: false };
    }, "Exact AzureRM remote backend coordinates including subscriptionId are required; local state and extra credential fields are rejected.");
  }
  return {
    schemaVersion: "1.0.0",
    provider,
    ...(workload ? { workload } : {}),
    status: checks.some((check) => check.status === "failed")
      ? "blocked"
      : "local-prerequisites-present",
    productionReady: false,
    safety: {
      azureCalls: 0,
      githubCalls: 0,
      writes: 0,
      deploymentExecutablesLaunched: 0,
      localPermissionToolsMayRun: process.platform === "win32",
    },
    checks,
    externalChecksRequired,
    limitations:
      "Presence is not authorization or production readiness. No keys, markers, permissions, state, or resources are created or repaired. Apply still validates the exact plan, approval, runtime, and live target.",
  };
}

function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") {
      console.log(
        "Usage: node scripts/production-executor-readiness.mjs --provider bicep|terraform [--backend-file <remote-backend.json>] [--workload greenfield-acceptance]\nTerraform requires a JSON object matching decisionModel.terraformBackend, including subscriptionId. The bounded workload supports only Bicep. This read-only command cannot authorize production.",
      );
      return;
    }
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index];
      if (
        !["--provider", "--backend-file", "--workload"].includes(flag) ||
        !args[index + 1] ||
        Object.hasOwn(options, flag)
      ) {
        throw new Error("Invalid, duplicate, or missing command argument.");
      }
      options[flag] = args[index + 1];
    }
    if (options["--backend-file"] && options["--provider"] !== "terraform") {
      throw new Error("--backend-file is only applicable to Terraform.");
    }
    let backend;
    if (options["--backend-file"]) {
      try {
        backend = JSON.parse(readFileSync(resolve(options["--backend-file"]), "utf8"));
      } catch {
        throw new Error("--backend-file must contain a readable JSON backend object.");
      }
    }
    const result = checkProductionExecutor({ provider: options["--provider"], backend, workload: options["--workload"] });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "blocked" ? 1 : 0;
  } catch (error) {
    console.error(`Executor readiness usage error: ${error.message}`);
    process.exitCode = 2;
  }
}

export { checkProductionExecutor };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
