#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTopologyDecision } from "./subscription-topology.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  readFileSync(resolve(root, "agent/checks/check-catalog.json"), "utf8"),
);
const catalogById = new Map(catalog.checks.map((check) => [check.id, check]));
const requiredProviders = [
  "Microsoft.App",
  "Microsoft.Authorization",
  "Microsoft.Insights",
  "Microsoft.KeyVault",
  "Microsoft.Network",
  "Microsoft.OperationalInsights",
  "Microsoft.Resources",
];
const sufficientRoles = new Set(["Owner", "Contributor"]);
const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const sensitivePattern =
  /(access|refresh)[_-]?token|client[_-]?secret|connection[_-]?string|authorization:\s*bearer|-----BEGIN [A-Z ]+PRIVATE KEY-----/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(
    "Usage: startup-preflight.sh inspect (--startup-subscription <id> | --prod-subscription <id> --nonprod-subscription <id>) [--output json|text]",
  );
  process.exit(2);
}

function parseArguments(argv) {
  if (argv[0] !== "inspect") {
    usage("Only inspect mode is supported.");
  }

  const options = { mode: "inspect", output: "text" };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--prod-subscription" && value) {
      options.prodSubscriptionId = value;
      index += 1;
    } else if (argument === "--nonprod-subscription" && value) {
      options.nonprodSubscriptionId = value;
      index += 1;
    } else if (argument === "--startup-subscription" && value) {
      options.startupSubscriptionId = value;
      index += 1;
    } else if (argument === "--output" && value) {
      options.output = value;
      index += 1;
    } else {
      usage(`Unsupported or incomplete argument: ${argument}`);
    }
  }

  const hasExplicitPair =
    options.prodSubscriptionId && options.nonprodSubscriptionId;
  if (
    (!options.startupSubscriptionId && !hasExplicitPair) ||
    (options.startupSubscriptionId &&
      (options.prodSubscriptionId || options.nonprodSubscriptionId))
  ) {
    usage(
      "Select either one startup subscription or an explicit prod/nonprod pair.",
    );
  }
  const suppliedIds = options.startupSubscriptionId
    ? [options.startupSubscriptionId]
    : [options.prodSubscriptionId, options.nonprodSubscriptionId];
  if (suppliedIds.some((id) => !uuidPattern.test(id))) {
    usage("Subscription IDs must be canonical UUIDs.");
  }
  if (options.startupSubscriptionId) {
    options.selectionMode = "one-subscription";
    options.prodSubscriptionId = options.startupSubscriptionId;
    options.nonprodSubscriptionId = options.startupSubscriptionId;
  } else {
    options.selectionMode = "explicit-prod-nonprod";
  }
  options.prodSubscriptionId = options.prodSubscriptionId.toLowerCase();
  options.nonprodSubscriptionId = options.nonprodSubscriptionId.toLowerCase();
  if (!["json", "text"].includes(options.output)) {
    usage("--output must be json or text.");
  }
  return options;
}

function sanitize(value) {
  return String(value ?? "")
    .replace(sensitivePattern, "[REDACTED]")
    .replace(emailPattern, "[REDACTED-EMAIL]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function classifyError(error) {
  const message = sanitize(error.stderr || error.message);
  if (/too many requests|throttl|429/i.test(message)) {
    return {
      class: "transient",
      code: "azure.request.throttled",
      message: "Azure throttled a read request. Retry the preflight later.",
    };
  }
  if (/forbidden|authorizationfailed|permission|does not have authorization/i.test(message)) {
    return {
      class: "permission",
      code: "azure.read.permission-denied",
      message: "The signed-in identity cannot read the required Azure evidence.",
    };
  }
  return {
    class: "configuration",
    code: "azure.read.failed",
    message: message || "An Azure read request failed.",
  };
}

function azJson(args) {
  const executable = process.env.AZURE_CLI_PATH || "az";
  const prefixArguments = process.env.AZURE_CLI_PREFIX_ARGS
    ? JSON.parse(process.env.AZURE_CLI_PREFIX_ARGS)
    : [];
  const output = execFileSync(executable, [...prefixArguments, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return output.trim() ? JSON.parse(output) : null;
}

function readEvidence(args) {
  try {
    return { value: azJson(args) };
  } catch (error) {
    return { error: classifyError(error) };
  }
}

function makeCheck(id, status, summary, evidence = {}, remediationActionIds = [], error) {
  const definition = catalogById.get(id);
  if (!definition) {
    throw new Error(`Unknown check identifier: ${id}`);
  }
  const result = {
    id,
    category: definition.category,
    status,
    severity: definition.severity,
    summary,
    evidence,
    remediationActionIds,
    documentationUrl: definition.documentationUrl,
  };
  if (error) {
    result.error = error;
  }
  return result;
}

function makeAction(
  id,
  type,
  summary,
  documentationUrl,
  { scope = null, commandPreview = null, automatic = false, approvalRequired = false, risk = "medium" } = {},
) {
  return {
    id,
    type,
    status: "proposed",
    summary,
    automatic,
    approvalRequired,
    risk,
    scope,
    commandPreview,
    documentationUrl,
  };
}

function subscriptionStateCheck(subscription, environment, requestedId) {
  if (subscription.error) {
    return makeCheck(
      "account.subscription.explicit-selection",
      "error",
      `The ${environment} subscription could not be read.`,
      { environment },
      ["account.review-subscription-access"],
      subscription.error,
    );
  }
  if (
    subscription.value?.id !== requestedId ||
    subscription.value.state !== "Enabled"
  ) {
    return makeCheck(
      "account.subscription.explicit-selection",
      "fail",
      `The ${environment} subscription is not enabled or does not match the requested ID.`,
      {
        environment,
        requestedSubscriptionId: requestedId,
        returnedSubscriptionId: subscription.value?.id ?? null,
        state: subscription.value?.state ?? "unknown",
      },
      ["account.review-subscription-access"],
    );
  }
  return null;
}

function roleNames(roleEvidence) {
  if (!Array.isArray(roleEvidence.value)) {
    return [];
  }
  return [
    ...new Set(
      roleEvidence.value
        .map((role) => role.roleDefinitionName)
        .filter((role) => typeof role === "string"),
    ),
  ].sort();
}

function countBy(items, key, values) {
  return Object.fromEntries(
    values.map((value) => [value, items.filter((item) => item[key] === value).length]),
  );
}

function evaluate(options) {
  const checks = [];
  const actions = [];
  options.runId = process.env.PREFLIGHT_RUN_ID || randomUUID();
  options.generatedAt =
    process.env.PREFLIGHT_GENERATED_AT || new Date().toISOString();
  const generatedAt = Date.parse(options.generatedAt);
  options.expiresAt = new Date(generatedAt + 4 * 60 * 60 * 1000).toISOString();
  const account = readEvidence(["account", "show", "--output", "json"]);

  if (account.error) {
    actions.push(
      makeAction(
        "account.authenticate-azure-cli",
        "manual",
        "Authenticate Azure CLI with the intended tenant, then run the preflight again.",
        catalogById.get("account.authentication.active").documentationUrl,
        { risk: "low" },
      ),
    );
    checks.push(
      makeCheck(
        "account.authentication.active",
        "error",
        "Azure CLI authentication could not be confirmed.",
        {},
        ["account.authenticate-azure-cli"],
        account.error,
      ),
    );
    const topologyDecision = buildTopologyDecision({
      runId: options.runId,
      generatedAt: options.generatedAt,
      expiresAt: options.expiresAt,
      selectionMode: options.selectionMode,
      tenantId: null,
      environments: [
        { name: "prod", subscriptionId: options.prodSubscriptionId },
        { name: "nonprod", subscriptionId: options.nonprodSubscriptionId },
      ],
      visibleSubscriptions: [],
      subscriptionReadErrors: true,
      targetTenantMismatch: false,
      billingProperties: [],
      billingReadFailed: true,
      benefits: [],
      benefitsReadFailed: true,
    });
    return finish(options, null, checks, actions, topologyDecision);
  }

  const tenantId = account.value?.tenantId ?? null;
  const principalId = account.value?.user?.name ?? null;
  checks.push(
    makeCheck(
      "account.authentication.active",
      tenantId ? "pass" : "fail",
      tenantId
        ? "Azure CLI authentication is active."
        : "Azure CLI returned no tenant for the active account.",
      { tenantId },
      tenantId ? [] : ["account.authenticate-azure-cli"],
    ),
  );
  const subscriptionInventory = readEvidence([
    "account",
    "list",
    "--all",
    "--output",
    "json",
  ]);

  const subscriptions = [
    {
      environment: "prod",
      id: options.prodSubscriptionId,
      evidence: readEvidence([
        "account",
        "show",
        "--subscription",
        options.prodSubscriptionId,
        "--output",
        "json",
      ]),
    },
    {
      environment: "nonprod",
      id: options.nonprodSubscriptionId,
      evidence: readEvidence([
        "account",
        "show",
        "--subscription",
        options.nonprodSubscriptionId,
        "--output",
        "json",
      ]),
    },
  ];
  const stateFailures = subscriptions
    .map((item) =>
      subscriptionStateCheck(item.evidence, item.environment, item.id),
    )
    .filter(Boolean);
  if (stateFailures.length) {
    checks.push(...stateFailures);
    actions.push(
      makeAction(
        "account.review-subscription-access",
        "manual",
        "Confirm both subscription IDs are enabled and visible to the signed-in identity.",
        catalogById.get("account.subscription.explicit-selection").documentationUrl,
        { risk: "low" },
      ),
    );
  } else {
    checks.push(
      makeCheck(
        "account.subscription.explicit-selection",
        "pass",
        "Both target subscriptions are explicitly selected and enabled.",
        {
          prodSubscriptionId: options.prodSubscriptionId,
          nonprodSubscriptionId: options.nonprodSubscriptionId,
        },
      ),
    );
  }

  const subscriptionTenants = subscriptions
    .map((item) => item.evidence.value?.tenantId)
    .filter(Boolean);
  const tenantMatch =
    subscriptionTenants.length === 2 &&
    subscriptionTenants.every((subscriptionTenant) => subscriptionTenant === tenantId);
  checks.push(
    makeCheck(
      "account.subscription.tenant-match",
      tenantMatch ? "pass" : "fail",
      tenantMatch
        ? "Both target subscriptions belong to the active tenant."
        : "The target subscriptions and active account do not share one tenant.",
      { tenantId, subscriptionTenantIds: [...new Set(subscriptionTenants)].sort() },
      tenantMatch ? [] : ["account.select-correct-tenant"],
    ),
  );
  if (!tenantMatch) {
    actions.push(
      makeAction(
        "account.select-correct-tenant",
        "manual",
        "Sign in to the tenant that owns both target subscriptions.",
        catalogById.get("account.subscription.tenant-match").documentationUrl,
        { risk: "low" },
      ),
    );
  }

  const roleResults = subscriptions.map((item) => ({
    environment: item.environment,
    evidence: readEvidence([
      "role",
      "assignment",
      "list",
      "--assignee",
      principalId || "__unresolved_principal__",
      "--include-inherited",
      "--subscription",
      item.id,
      "--all",
      "--output",
      "json",
    ]),
  }));
  const roleReadFailure = roleResults.find((item) => item.evidence.error);
  const roles = Object.fromEntries(
    roleResults.map((item) => [item.environment, roleNames(item.evidence)]),
  );
  const rolesSufficient =
    !roleReadFailure &&
    Object.values(roles).every((names) => names.some((role) => sufficientRoles.has(role)));
  checks.push(
    makeCheck(
      "identity.deployment-role.sufficient",
      roleReadFailure ? "unknown" : rolesSufficient ? "pass" : "fail",
      roleReadFailure
        ? "Effective deployment roles could not be read."
        : rolesSufficient
          ? "A sufficient deployment role is visible on both subscriptions."
          : "Owner or Contributor is not visible on both target subscriptions.",
      { roles },
      rolesSufficient ? [] : ["identity.review-deployment-role"],
      roleReadFailure?.evidence.error,
    ),
  );
  if (!rolesSufficient) {
    actions.push(
      makeAction(
        "identity.review-deployment-role",
        "manual",
        "Have an administrator review least-privilege deployment access for both subscriptions.",
        catalogById.get("identity.deployment-role.sufficient").documentationUrl,
      ),
    );
  }

  const policies = subscriptions.map((item) => ({
    environment: item.environment,
    evidence: readEvidence([
      "policy",
      "assignment",
      "list",
      "--subscription",
      item.id,
      "--output",
      "json",
    ]),
  }));
  const policyFailure = policies.find((item) => item.evidence.error);
  checks.push(
    makeCheck(
      "region.services.available",
      policyFailure ? "unknown" : "warning",
      policyFailure
        ? "Subscription policy evidence could not be read for regional planning."
        : "Policy assignments are readable; service availability is deferred to regional planning.",
      {
        policyAssignmentCounts: Object.fromEntries(
          policies.map((item) => [
            item.environment,
            Array.isArray(item.evidence.value) ? item.evidence.value.length : 0,
          ]),
        ),
      },
      policyFailure ? ["account.review-policy-access"] : [],
      policyFailure?.evidence.error,
    ),
  );
  if (policyFailure) {
    actions.push(
      makeAction(
        "account.review-policy-access",
        "manual",
        "Grant read access to subscription policy assignments or have an administrator review them.",
        catalogById.get("region.services.available").documentationUrl,
      ),
    );
  }

  const providerResults = subscriptions.map((item) => ({
    environment: item.environment,
    id: item.id,
    evidence: readEvidence([
      "provider",
      "list",
      "--subscription",
      item.id,
      "--output",
      "json",
    ]),
  }));
  const providerFailure = providerResults.find((item) => item.evidence.error);
  const missingProviders = providerResults.flatMap((item) => {
    if (!Array.isArray(item.evidence.value)) {
      return [];
    }
    const states = new Map(
      item.evidence.value.map((provider) => [
        provider.namespace,
        provider.registrationState,
      ]),
    );
    return requiredProviders
      .filter((provider) => states.get(provider) !== "Registered")
      .map((provider) => ({ environment: item.environment, namespace: provider }));
  });
  const providerActionIds = missingProviders.map(
    (provider) =>
      `provider.register.${provider.environment}.${provider.namespace
        .toLowerCase()
        .replaceAll(".", "-")}`,
  );
  checks.push(
    makeCheck(
      "account.provider.required-registrations",
      providerFailure ? "unknown" : missingProviders.length ? "fail" : "pass",
      providerFailure
        ? "Resource-provider registration states could not be read."
        : missingProviders.length
          ? "One or more required resource providers are not registered."
          : "Required resource providers are registered in both subscriptions.",
      { missingProviders },
      providerFailure ? ["account.review-provider-access"] : providerActionIds,
      providerFailure?.evidence.error,
    ),
  );
  if (providerFailure) {
    actions.push(
      makeAction(
        "account.review-provider-access",
        "manual",
        "Grant read access to resource-provider registration states.",
        catalogById.get("account.provider.required-registrations").documentationUrl,
      ),
    );
  }
  missingProviders.forEach((provider, index) => {
    const subscriptionId =
      provider.environment === "prod"
        ? options.prodSubscriptionId
        : options.nonprodSubscriptionId;
    const commandArguments = [
      "az",
      "provider",
      "register",
      "--subscription",
      subscriptionId,
      "--namespace",
      provider.namespace,
    ];
    actions.push(
      makeAction(
        providerActionIds[index],
        "azureWrite",
        `Register ${provider.namespace} in the ${provider.environment} subscription after explicit approval.`,
        catalogById.get("account.provider.required-registrations").documentationUrl,
        {
          automatic: true,
          approvalRequired: true,
          risk: "low",
          scope: `/subscriptions/${subscriptionId}`,
          commandPreview: commandArguments.join(" "),
        },
      ),
    );
  });

  const domains = readEvidence(["rest", "--method", "get", "--url", "https://graph.microsoft.com/v1.0/domains"]);
  const verifiedDomains = Array.isArray(domains.value?.value)
    ? domains.value.value.filter((domain) => domain.isVerified).map((domain) => domain.id).sort()
    : [];
  const hasCompanyDomain = verifiedDomains.some(
    (domain) => !domain.endsWith(".onmicrosoft.com"),
  );
  checks.push(
    makeCheck(
      "identity.company-domain.verified",
      domains.error ? "unknown" : hasCompanyDomain ? "pass" : "fail",
      domains.error
        ? "Verified company-domain evidence is unavailable."
        : hasCompanyDomain
          ? "A verified company domain is visible in Microsoft Entra ID."
          : "No verified custom company domain is visible.",
      { verifiedCustomDomainCount: verifiedDomains.filter((domain) => !domain.endsWith(".onmicrosoft.com")).length },
      hasCompanyDomain ? [] : ["identity.verify-company-domain"],
      domains.error,
    ),
  );
  if (!hasCompanyDomain) {
    actions.push(
      makeAction(
        "identity.verify-company-domain",
        "manual",
        "Have a Microsoft Entra administrator verify the startup company domain.",
        catalogById.get("identity.company-domain.verified").documentationUrl,
      ),
    );
  }

  checks.push(
    makeCheck(
      "identity.secondary-admin.present",
      "unknown",
      "Secondary-administrator presence requires explicit administrator confirmation.",
      {
        reason:
          "Generic directory role assignments do not reliably establish two distinct emergency-capable administrators.",
      },
      ["identity.review-secondary-admin"],
    ),
  );
  actions.push(
    makeAction(
      "identity.review-secondary-admin",
      "manual",
      "Have a Microsoft Entra administrator confirm a second emergency-capable administrator.",
      catalogById.get("identity.secondary-admin.present").documentationUrl,
    ),
  );

  const distinctTargetIds = [
    ...new Set([options.prodSubscriptionId, options.nonprodSubscriptionId]),
  ];
  const billingProperties = distinctTargetIds.map((subscriptionId) => ({
    subscriptionId,
    evidence: readEvidence([
      "rest",
      "--method",
      "get",
      "--url",
      `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Billing/billingProperty/default?api-version=2024-04-01`,
    ]),
  }));
  const benefits = readEvidence([
    "rest",
    "--method",
    "get",
    "--url",
    "https://management.azure.com/providers/Microsoft.BillingBenefits/credits?api-version=2026-06-01",
  ]);
  const topologyDecision = buildTopologyDecision({
    runId: options.runId,
    generatedAt: options.generatedAt,
    expiresAt: options.expiresAt,
    selectionMode: options.selectionMode,
    tenantId,
    environments: subscriptions.map((item) => ({
      name: item.environment,
      subscriptionId: item.id,
    })),
    visibleSubscriptions: Array.isArray(subscriptionInventory.value)
      ? subscriptionInventory.value
      : [],
    subscriptionReadErrors:
      Boolean(subscriptionInventory.error) ||
      subscriptions.some((item) => item.evidence.error) ||
      stateFailures.length > 0,
    targetTenantMismatch: !tenantMatch,
    billingProperties: billingProperties
      .map((item) => item.evidence.value)
      .filter(Boolean),
    billingReadFailed: billingProperties.some((item) => item.evidence.error),
    benefits: Array.isArray(benefits.value?.value) ? benefits.value.value : [],
    benefitsReadFailed: Boolean(benefits.error),
  });
  const topologySupported = [
    "one-subscription-startup",
    "separate-prod-nonprod-subscriptions",
  ].includes(topologyDecision.subscriptionTopology.state);
  const topologyAction = topologySupported
    ? "account.use-selected-subscription-topology"
    : topologyDecision.subscriptionTopology.state ===
        "unsupported-ambiguous-multi-subscription"
      ? "account.select-explicit-environment-subscriptions"
      : topologyDecision.subscriptionTopology.state ===
          "target-subscription-tenant-mismatch"
        ? "account.select-correct-tenant"
        : "account.review-subscription-access";
  checks.push(
    makeCheck(
      "account.subscription.topology-supported",
      topologySupported ? "pass" : "fail",
      topologySupported
        ? topologyDecision.subscriptionTopology.state ===
          "one-subscription-startup"
          ? "One enabled startup subscription is explicitly mapped to both environments."
          : "Separate enabled production and nonproduction subscriptions are explicitly mapped."
        : "The visible subscription inventory does not support the requested environment mapping.",
      {
        state: topologyDecision.subscriptionTopology.state,
        selectionMode: topologyDecision.subscriptionTopology.selectionMode,
        visibleEnabledSubscriptionCount:
          topologyDecision.subscriptionTopology.visibleEnabledSubscriptionCount,
        decisionDigest: topologyDecision.decisionDigest,
      },
      [topologyAction],
    ),
  );
  if (topologySupported) {
    actions.push(
      makeAction(
        topologyAction,
        "information",
        "Carry this exact tenant, subscription, and environment mapping into workload and IaC planning.",
        catalogById.get("account.subscription.topology-supported")
          .documentationUrl,
        { risk: "low" },
      ),
    );
  } else if (
    topologyDecision.subscriptionTopology.state ===
    "unsupported-ambiguous-multi-subscription"
  ) {
    actions.push(
      makeAction(
        topologyAction,
        "manual",
        "Rerun locally with an explicit production and nonproduction subscription mapping.",
        catalogById.get("account.subscription.topology-supported")
          .documentationUrl,
        { risk: "low" },
      ),
    );
  }

  const benefitState = topologyDecision.benefitAssociation.state;
  const benefitAction =
    benefitState === "billing-evidence-unavailable"
      ? "billing.request-billing-scope-confirmation"
      : "billing.request-startup-benefit-confirmation";
  const benefitStatus =
    benefitState === "confirmed-for-exact-target"
      ? "pass"
      : benefitState ===
          "benefits-on-different-subscription-or-billing-profile"
        ? "fail"
        : "unknown";
  checks.push(
    makeCheck(
      "billing.startup-credit.context-visible",
      benefitState === "billing-evidence-unavailable" ? "unknown" : "warning",
      benefitState === "billing-evidence-unavailable"
        ? "Billing evidence is unavailable for one or more exact target scopes."
        : "Billing evidence is visible, but it does not by itself prove startup-credit applicability.",
      {
        billingEvidenceAvailable:
          benefitState !== "billing-evidence-unavailable",
        billingEvidenceDigest:
          topologyDecision.evidence.billingEvidenceDigest,
      },
      [benefitAction],
      billingProperties.find((item) => item.evidence.error)?.evidence.error ??
        benefits.error,
    ),
    makeCheck(
      "billing.subscription.credit-association",
      benefitStatus,
      benefitState ===
      "benefits-on-different-subscription-or-billing-profile"
        ? "Available benefit evidence points to a different subscription or billing profile than the workload target."
        : benefitState === "confirmed-for-exact-target"
          ? "Authoritative evidence confirms the exact target mapping."
          : "The preflight cannot prove that startup credits or benefits apply to the exact target mapping.",
      {
        state: benefitState,
        authoritativeEvidence:
          topologyDecision.benefitAssociation.authoritativeEvidence,
        decisionDigest: topologyDecision.decisionDigest,
      },
      [benefitAction],
      benefits.error,
    ),
    makeCheck(
      "billing.target-benefit.topology-confirmed",
      benefitStatus,
      benefitStatus === "fail"
        ? "Deployment would target outside the observed benefits-backed scope."
        : benefitStatus === "pass"
          ? "The exact environment mapping is benefits-backed."
          : "External confirmation must bind benefits to the exact topology decision.",
      {
        state: benefitState,
        topologyDecisionId: topologyDecision.decisionId,
        topologyDecisionDigest: topologyDecision.decisionDigest,
      },
      [benefitAction],
    ),
  );
  actions.push(
    makeAction(
      benefitAction,
      "support",
      benefitState === "billing-evidence-unavailable"
        ? "Ask Azure Billing Support to confirm the billing account and profile for the exact target subscriptions."
        : "Ask Microsoft for Startups Program Support to confirm benefit association for the exact topology decision.",
      catalogById.get("billing.target-benefit.topology-confirmed")
        .documentationUrl,
      { risk: "high" },
    ),
  );

  for (const [id, summary] of [
    ["quota.workload.headroom", "Workload quota checks require a selected workload and region."],
    ["region.skus.eligible", "SKU eligibility checks require a selected workload and region."],
    ["region.foundry-model.available", "Foundry model availability is not applicable until Foundry is selected."],
    ["security.defender.selection-reviewed", "Defender plan selection is deferred to workload planning and must be digest-bound before IaC generation."],
    ["operations.monitoring.destination-valid", "Monitoring destination validation is deferred to the fail-closed Defender workspace placement planner; Azure defaults are unsupported."],
  ]) {
    checks.push(makeCheck(id, "skipped", summary, { reason: "Not available in account-only inspect mode." }));
  }

  return finish(options, tenantId, checks, actions, topologyDecision);
}

function finish(options, tenantId, checks, actions, topologyDecision) {
  const blockingUnresolved = checks.some(
    (check) =>
      check.severity === "blocking" &&
      ["fail", "unknown", "error"].includes(check.status),
  );
  const trustworthy = checks.some((check) => check.status !== "error");
  const overallStatus = !trustworthy
    ? "error"
    : blockingUnresolved
      ? "blocked"
      : checks.some((check) => check.status === "warning")
        ? "warning"
        : "pass";
  return {
    schemaVersion: "2.0.0",
    runId: options.runId,
    generatedAt: options.generatedAt,
    mode: options.mode,
    overallStatus,
    target: {
      tenantId,
      prodSubscriptionId: options.prodSubscriptionId,
      nonprodSubscriptionId: options.nonprodSubscriptionId,
      primaryRegion: null,
      secondaryRegion: null,
    },
    topologyDecision,
    checks,
    actions,
    deploymentPlan: null,
    approval: {
      required: false,
      status: "notApplicable",
      planId: null,
      planDigest: null,
      approvedAt: null,
      expiresAt: null,
    },
    summary: {
      checks: countBy(checks, "status", [
        "pass",
        "warning",
        "fail",
        "unknown",
        "skipped",
        "error",
      ]),
      actions: countBy(actions, "type", [
        "azureWrite",
        "manual",
        "support",
        "information",
      ]),
    },
  };
}

function printText(result) {
  console.log(`SSLZ startup preflight: ${result.overallStatus.toUpperCase()}`);
  for (const check of result.checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.id}: ${check.summary}`);
  }
  if (result.actions.length) {
    console.log("\nActions:");
    for (const action of result.actions) {
      console.log(`- ${action.id}: ${action.summary}`);
    }
  }
}

const options = parseArguments(process.argv.slice(2));
const result = evaluate(options);
if (options.output === "json") {
  console.log(JSON.stringify(result, null, 2));
} else {
  printText(result);
}
process.exitCode = ["blocked", "error"].includes(result.overallStatus) ? 1 : 0;
