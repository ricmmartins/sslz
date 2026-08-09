#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalJson,
  planDigest,
} from "./startup-iac-plan.mjs";
import { validateDocument } from "./validate-agent-contracts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_ROOT = resolve(root, ".sslz/remediation-state");
const VERSION = "1.0.0";
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTION_ID =
  /^provider\.register\.(prod|nonprod)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_COMMAND_TOKEN = /^[A-Za-z0-9._:/{}-]+$/;

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const planSchema = load("agent/schemas/iac-plan-summary.schema.json");
const approvalSchema = load(
  "agent/schemas/provider-remediation-approval.schema.json",
);
const resultSchema = load("agent/schemas/provider-remediation-result.schema.json");
const profiles = new Map(
  ["container-apps", "aks", "postgresql", "foundry", "gpu"].map((id) => [
    id,
    load(`agent/profiles/${id}.json`),
  ]),
);

class RemediationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new RemediationError(code, message);
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function approvalPayload(approval) {
  const { approvalDigest: omitted, ...payload } = approval;
  return payload;
}

function approvalDigest(approval) {
  return hash(approvalPayload(approval));
}

function actionSummary(action) {
  return {
    id: action.id,
    type: action.type,
    operation: action.operation,
    namespace: action.namespace,
    subscriptionId: action.subscriptionId,
    scope: action.scope,
  };
}

function planSummary(plan) {
  return {
    version: plan.plannerVersion,
    id: plan.planId,
    digest: plan.planDigest,
  };
}

function commandArguments(action) {
  return [
    "provider",
    "register",
    "--subscription",
    action.subscriptionId,
    "--namespace",
    action.namespace,
    "--wait",
    "--output",
    "none",
  ];
}

function commandPreview(args) {
  if (args.some((argument) => !SAFE_COMMAND_TOKEN.test(argument))) {
    fail(
      "remediation.command.invalid",
      "The reviewed action cannot be represented as a safe Azure CLI command.",
    );
  }
  return ["az", ...args].join(" ");
}

function baseResult(mode, evaluatedAt) {
  return {
    schemaVersion: VERSION,
    executorVersion: VERSION,
    generatedBy: "startup-provider-remediation.mjs",
    generatedAt: new Date(evaluatedAt).toISOString(),
    mode,
    status: "error",
    code: "remediation.error",
    message: "Provider remediation could not be completed safely.",
    plan: null,
    action: null,
    approval: {
      provided: false,
      status: "notProvided",
      consumed: false,
      expiresAt: null,
      artifactDigest: null,
    },
    command: {
      executable: "az",
      arguments: [],
      preview: null,
      executed: false,
    },
    verification: {
      performed: false,
      registrationState: null,
    },
    safety: {
      azureWrites: 0,
      localState: "none",
      rawOutputRetained: false,
      personalApprovalIdentityRetained: false,
    },
  };
}

function approvalAudit(approval) {
  const statuses = new Set(["pending", "approved", "declined", "consumed"]);
  return {
    provided: true,
    status: statuses.has(approval?.status) ? approval.status : "invalid",
    consumed: approval?.status === "consumed",
    expiresAt:
      typeof approval?.expiresAt === "string" &&
      Number.isFinite(Date.parse(approval.expiresAt))
        ? approval.expiresAt
        : null,
    artifactDigest:
      typeof approval?.approvalDigest === "string" &&
      /^sha256:[0-9a-f]{64}$/.test(approval.approvalDigest)
        ? approval.approvalDigest
        : null,
  };
}

function validatedResult(result) {
  validateDocument(resultSchema, result);
  return result;
}

function rejectedResult(
  result,
  code,
  message,
  { approvalStatus = "invalid", consumed = false } = {},
) {
  result.status = "rejected";
  result.code = code;
  result.message = message;
  result.approval.status = approvalStatus;
  result.approval.consumed = consumed;
  return validatedResult(result);
}

function assertActionShape(action) {
  const keys = Object.keys(action).sort();
  const expected = [
    "id",
    "namespace",
    "operation",
    "region",
    "scope",
    "subscriptionId",
    "summary",
    "type",
  ].sort();
  if (canonicalJson(keys) !== canonicalJson(expected)) {
    fail(
      "remediation.action.malformed",
      "The reviewed provider-registration action has an invalid shape.",
    );
  }
  if (
    !ACTION_ID.test(action.id) ||
    action.type !== "azureWrite" ||
    action.operation !== "provider.register" ||
    action.region !== null ||
    !UUID.test(action.subscriptionId) ||
    action.scope !== `/subscriptions/${action.subscriptionId}` ||
    typeof action.summary !== "string" ||
    action.summary.length === 0
  ) {
    fail(
      "remediation.action.malformed",
      "The reviewed action is not an exact subscription-scoped provider registration.",
    );
  }
}

function validateReviewedAction(plan, actionId) {
  validateDocument(planSchema, plan);
  if (plan.plannerVersion !== VERSION) {
    fail(
      "remediation.plan.version",
      "The reviewed plan version is not supported for provider remediation.",
    );
  }
  const recomputedDigest = planDigest(plan.decisionModel);
  if (recomputedDigest !== plan.planDigest) {
    fail(
      "remediation.plan.digest-mismatch",
      "The reviewed plan digest does not match its canonical decision model.",
    );
  }
  if (!ACTION_ID.test(actionId)) {
    fail(
      "remediation.action.id",
      "The requested action identifier is not a provider-registration action.",
    );
  }
  const actions = plan.decisionModel?.proposedActions;
  if (!Array.isArray(actions)) {
    fail(
      "remediation.plan.actions",
      "The reviewed plan does not contain a valid proposed-action list.",
    );
  }
  const matching = actions.filter((action) => action?.id === actionId);
  if (matching.length !== 1) {
    fail(
      "remediation.action.not-reviewed",
      "Exactly one unchanged provider-registration action must exist in the reviewed plan.",
    );
  }
  const action = matching[0];
  assertActionShape(action);

  const profileSelection = plan.decisionModel?.profile;
  const profileIds = [
    profileSelection?.computeProfile,
    ...(profileSelection?.profileExtensions ?? []),
  ];
  const selectedProfiles = profileIds.map((profileId) => profiles.get(profileId));
  if (
    selectedProfiles.some(
      (profile) =>
        !profile || profile.profileVersion !== profileSelection?.profileVersion,
    )
  ) {
    fail(
      "remediation.profile.invalid",
      "The reviewed plan contains an unsupported or mismatched workload profile.",
    );
  }
  const allowedNamespaces = new Set(
    selectedProfiles.flatMap((profile) => profile.providerNamespaces),
  );
  if (!allowedNamespaces.has(action.namespace)) {
    fail(
      "remediation.provider.not-allowlisted",
      "The provider namespace is not allowlisted by the selected workload profiles.",
    );
  }

  const target = plan.decisionModel?.target;
  if (!UUID.test(target?.tenantId ?? "")) {
    fail(
      "remediation.target.tenant",
      "The reviewed plan does not contain one canonical tenant identifier.",
    );
  }
  const environments = Array.isArray(target?.environments)
    ? target.environments
    : [];
  const targetEnvironment = environments.find(
    (environment) => environment.subscriptionId === action.subscriptionId,
  );
  if (!targetEnvironment) {
    fail(
      "remediation.target.subscription",
      "The provider-registration subscription is not an exact reviewed target.",
    );
  }
  const expectedId = `provider.register.${targetEnvironment.name}.${action.namespace
    .toLowerCase()
    .replaceAll(".", "-")}`;
  if (action.id !== expectedId) {
    fail(
      "remediation.action.id-mismatch",
      "The provider-registration action identifier does not match its exact target.",
    );
  }
  return action;
}

function validateApproval(approval, plan, action, evaluatedAt) {
  validateDocument(approvalSchema, approval);
  const actualDigest = approvalDigest(approval);
  if (actualDigest !== approval.approvalDigest) {
    fail(
      "remediation.approval.digest-mismatch",
      "The approval artifact digest does not match its canonical content.",
    );
  }
  if (approval.status !== "approved") {
    fail(
      `remediation.approval.${approval.status}`,
      `The approval artifact is ${approval.status} and cannot authorize a write.`,
    );
  }
  const binding = {
    planVersion: plan.plannerVersion,
    planId: plan.planId,
    planDigest: plan.planDigest,
    actionId: action.id,
    actionType: action.type,
    operation: action.operation,
    namespace: action.namespace,
    subscriptionId: action.subscriptionId,
    scope: action.scope,
  };
  for (const [field, expected] of Object.entries(binding)) {
    if (approval[field] !== expected) {
      fail(
        "remediation.approval.binding-mismatch",
        "The approval artifact does not match every approval-bound plan and action field.",
      );
    }
  }
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    approvedAt > evaluatedAt ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > MAX_APPROVAL_TTL_MS
  ) {
    fail(
      "remediation.approval.window",
      "The approval artifact has an invalid or overlong validity window.",
    );
  }
  if (expiresAt <= evaluatedAt) {
    fail(
      "remediation.approval.expired",
      "The approval artifact has expired.",
    );
  }
}

function assertNoSymlink(path) {
  const relation = relative(root, path);
  const segments = relation.split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      fail(
        "remediation.state.symlink",
        "The local remediation state path cannot contain symbolic links.",
      );
    }
  }
}

function stateDirectory(requestedPath) {
  if (!requestedPath || isAbsolute(requestedPath)) {
    fail(
      "remediation.state.path",
      "The remediation state directory must be a relative ignored path.",
    );
  }
  const path = resolve(root, requestedPath);
  const relation = relative(STATE_ROOT, path);
  if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    fail(
      "remediation.state.path",
      "The remediation state directory must stay under .sslz/remediation-state.",
    );
  }
  assertNoSymlink(path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertNoSymlink(path);
  return path;
}

function writeState(path, state) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, path);
}

function reserveApproval(approval, action, evaluatedAt, requestedStateDirectory) {
  const directory = stateDirectory(requestedStateDirectory);
  const key = approval.approvalDigest.slice("sha256:".length);
  const statePath = resolve(directory, `${key}.json`);
  const lockPath = resolve(directory, `${key}.lock`);
  if (existsSync(statePath)) {
    return { status: "consumed" };
  }
  let descriptor;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") {
      return { status: "race" };
    }
    throw error;
  }
  if (existsSync(statePath)) {
    closeSync(descriptor);
    unlinkSync(lockPath);
    return { status: "consumed" };
  }
  const state = {
    schemaVersion: VERSION,
    status: "running",
    approvalDigest: approval.approvalDigest,
    planDigest: approval.planDigest,
    actionId: action.id,
    namespace: action.namespace,
    subscriptionId: action.subscriptionId,
    scope: action.scope,
    startedAt: new Date(evaluatedAt).toISOString(),
    completedAt: null,
    code: "remediation.running",
  };
  writeState(statePath, state);
  return { status: "reserved", descriptor, lockPath, statePath, state };
}

function completeApproval(reservation, status, code, evaluatedAt) {
  const completed = {
    ...reservation.state,
    status,
    completedAt: new Date(evaluatedAt).toISOString(),
    code,
  };
  writeState(reservation.statePath, completed);
  reservation.state = completed;
}

function releaseApproval(reservation) {
  closeSync(reservation.descriptor);
  unlinkSync(reservation.lockPath);
}

function defaultRunner(args) {
  return spawnSync("az", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

function safeJson(execution) {
  if (execution.status !== 0) {
    return null;
  }
  try {
    return JSON.parse(execution.stdout);
  } catch {
    return null;
  }
}

function accountArguments(action) {
  return [
    "account",
    "show",
    "--subscription",
    action.subscriptionId,
    "--output",
    "json",
  ];
}

function verificationArguments(action) {
  return [
    "provider",
    "show",
    "--subscription",
    action.subscriptionId,
    "--namespace",
    action.namespace,
    "--query",
    "{namespace:namespace,registrationState:registrationState}",
    "--output",
    "json",
  ];
}

function operationalFailure(result, reservation, code, message, evaluatedAt) {
  completeApproval(reservation, "failed", code, evaluatedAt);
  result.status = "error";
  result.code = code;
  result.message = message;
  result.approval.consumed = true;
  result.safety.localState = "consumed";
  return validatedResult(result);
}

function runProviderRemediation(
  plan,
  actionId,
  approval,
  {
    mode = "dry-run",
    evaluatedAt = Date.now(),
    runner = defaultRunner,
    statePath = ".sslz/remediation-state",
  } = {},
) {
  const result = baseResult(mode, evaluatedAt);
  let reservation = null;
  try {
    if (!["dry-run", "apply"].includes(mode)) {
      fail("remediation.mode", "Mode must be dry-run or apply.");
    }
    const action = validateReviewedAction(plan, actionId);
    const args = commandArguments(action);
    result.plan = planSummary(plan);
    result.action = actionSummary(action);
    result.command.arguments = args;
    result.command.preview = commandPreview(args);

    if (mode === "dry-run") {
      result.status = "planned";
      result.code = "remediation.dry-run.ready";
      result.message =
        "Dry run completed with zero Azure writes; explicit apply requires a matching approval artifact.";
      return validatedResult(result);
    }

    if (!approval) {
      return rejectedResult(
        result,
        "remediation.approval.required",
        "Apply requires an explicit provider-remediation approval artifact.",
      );
    }
    result.approval = approvalAudit(approval);
    try {
      validateApproval(approval, plan, action, evaluatedAt);
    } catch (error) {
      if (error instanceof RemediationError) {
        const status = ["pending", "declined", "consumed"].includes(approval.status)
          ? approval.status
          : error.code.endsWith(".expired")
            ? "expired"
            : "invalid";
        return rejectedResult(result, error.code, error.message, {
          approvalStatus: status,
          consumed: status === "consumed",
        });
      }
      return rejectedResult(
        result,
        "remediation.approval.malformed",
        "The approval artifact is malformed.",
      );
    }
    result.approval.status = "approved";

    reservation = reserveApproval(approval, action, evaluatedAt, statePath);
    if (reservation.status === "consumed") {
      return rejectedResult(
        result,
        "remediation.approval.replayed",
        "The approval artifact has already been consumed.",
        { approvalStatus: "consumed", consumed: true },
      );
    }
    if (reservation.status === "race") {
      return rejectedResult(
        result,
        "remediation.approval.race",
        "The approval artifact is already reserved by another apply attempt.",
        { approvalStatus: "consumed", consumed: true },
      );
    }
    result.safety.localState = "reserved";

    const account = safeJson(runner(accountArguments(action)));
    if (
      account?.id?.toLowerCase() !== action.subscriptionId ||
      account?.tenantId?.toLowerCase() !== plan.decisionModel.target.tenantId ||
      account?.state !== "Enabled"
    ) {
      return operationalFailure(
        result,
        reservation,
        "remediation.target.mismatch",
        "The live Azure tenant, subscription, or subscription state does not match the reviewed plan.",
        evaluatedAt,
      );
    }

    const before = safeJson(runner(verificationArguments(action)));
    if (
      before?.namespace !== action.namespace ||
      typeof before?.registrationState !== "string"
    ) {
      return operationalFailure(
        result,
        reservation,
        "remediation.provider.read-failed",
        "The current provider registration state could not be verified safely.",
        evaluatedAt,
      );
    }
    result.verification.performed = true;
    result.verification.registrationState = [
      "Registered",
      "NotRegistered",
      "Registering",
    ].includes(before.registrationState)
      ? before.registrationState
      : "Unknown";

    if (before.registrationState === "Registered") {
      completeApproval(
        reservation,
        "succeeded",
        "remediation.provider.already-registered",
        evaluatedAt,
      );
      result.status = "succeeded";
      result.code = "remediation.provider.already-registered";
      result.message =
        "The provider was already registered; no Azure write was performed.";
      result.approval.consumed = true;
      result.safety.localState = "consumed";
      return validatedResult(result);
    }

    result.command.executed = true;
    result.safety.azureWrites = 1;
    const registration = runner(args);
    if (registration.status !== 0) {
      return operationalFailure(
        result,
        reservation,
        "remediation.provider.registration-failed",
        "The exact provider registration command failed; no further Azure write was attempted.",
        evaluatedAt,
      );
    }

    const after = safeJson(runner(verificationArguments(action)));
    result.verification.performed = true;
    result.verification.registrationState = [
      "Registered",
      "NotRegistered",
      "Registering",
    ].includes(after?.registrationState)
      ? after.registrationState
      : "Unknown";
    if (
      after?.namespace !== action.namespace ||
      after?.registrationState !== "Registered"
    ) {
      return operationalFailure(
        result,
        reservation,
        "remediation.provider.verification-failed",
        "Registration did not immediately verify as Registered; stop and create a new reviewed plan.",
        evaluatedAt,
      );
    }

    completeApproval(
      reservation,
      "succeeded",
      "remediation.provider.registered",
      evaluatedAt,
    );
    result.status = "succeeded";
    result.code = "remediation.provider.registered";
    result.message =
      "One allowlisted provider was registered and immediately verified as Registered.";
    result.approval.consumed = true;
    result.safety.localState = "consumed";
    return validatedResult(result);
  } catch (error) {
    const code =
      error instanceof RemediationError
        ? error.code
        : "remediation.input.malformed";
    const message =
      error instanceof RemediationError
        ? error.message
        : "The plan or approval input is malformed.";
    if (reservation?.status === "reserved") {
      return operationalFailure(result, reservation, code, message, evaluatedAt);
    }
    return rejectedResult(result, code, message);
  } finally {
    if (reservation?.status === "reserved") {
      releaseApproval(reservation);
    }
  }
}

function usage() {
  return [
    "Usage:",
    "  startup-provider-remediation.mjs dry-run --plan <path|-> --action <id> [--output json|text]",
    "  startup-provider-remediation.mjs apply --plan <path|-> --action <id> --approval <path> [--output json|text]",
    "",
    "Only one reviewed, profile-allowlisted provider registration can be applied.",
  ].join("\n");
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  if (!["dry-run", "apply"].includes(args[0])) {
    throw new Error("The command must be dry-run or apply.");
  }
  const options = { mode: args[0], output: "json" };
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--plan") {
      options.planPath = args[++index];
    } else if (argument === "--action") {
      options.actionId = args[++index];
    } else if (argument === "--approval") {
      options.approvalPath = args[++index];
    } else if (argument === "--output") {
      options.output = args[++index];
    } else {
      throw new Error("An unsupported argument was supplied.");
    }
  }
  if (!options.planPath || !options.actionId) {
    throw new Error("--plan and --action are required.");
  }
  if (options.mode === "apply" && !options.approvalPath) {
    throw new Error("Apply requires --approval.");
  }
  if (options.mode === "dry-run" && options.approvalPath) {
    throw new Error("Dry run does not accept an approval artifact.");
  }
  if (!["json", "text"].includes(options.output)) {
    throw new Error("--output must be json or text.");
  }
  return { help: false, ...options };
}

function readJson(path, stdin) {
  const source =
    path === "-"
      ? stdin
      : readFileSync(resolve(process.cwd(), path), "utf8");
  return JSON.parse(source);
}

function printText(result) {
  process.stdout.write(
    [
      `SSLZ provider remediation: ${result.status.toUpperCase()}`,
      `Code: ${result.code}`,
      `Message: ${result.message}`,
      ...(result.action
        ? [
            `Action: ${result.action.id}`,
            `Scope: ${result.action.scope}`,
            `Command: ${result.command.preview}`,
          ]
        : []),
      `Azure writes: ${result.safety.azureWrites}`,
      "",
    ].join("\n"),
  );
}

function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
  } catch (error) {
    process.stderr.write(`Provider remediation usage error: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  let result;
  try {
    const stdin = options.planPath === "-" ? readFileSync(0, "utf8") : "";
    const plan = readJson(options.planPath, stdin);
    const approval = options.approvalPath
      ? readJson(options.approvalPath, "")
      : null;
    result = runProviderRemediation(plan, options.actionId, approval, {
      mode: options.mode,
    });
  } catch {
    result = rejectedResult(
      baseResult(options.mode, Date.now()),
      "remediation.input.malformed",
      "The plan or approval artifact is malformed.",
    );
  }
  if (options.output === "text") {
    printText(result);
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  process.exitCode = ["planned", "succeeded"].includes(result.status) ? 0 : 1;
}

export {
  approvalDigest,
  commandArguments,
  runProviderRemediation,
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
