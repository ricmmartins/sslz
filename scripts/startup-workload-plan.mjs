#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { validateDocument } from "./validate-agent-contracts.mjs";
import { validateAksIngressDecision } from "./aks-ingress-contract.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_VERSION = "1.0.0";
const SCHEMA_VERSION = "1.0.0";
const PROFILE_ORDER = [
  "container-apps",
  "aks",
  "postgresql",
  "foundry",
  "gpu",
];
const KUBERNETES_REQUIREMENT_ORDER = [
  "kubernetes-api",
  "operator",
  "specialized-networking",
  "custom-scheduler",
  "service-mesh",
  "ecosystem-component",
];

function load(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const profiles = Object.fromEntries(
  PROFILE_ORDER.map((id) => [id, load(`agent/profiles/${id}.json`)]),
);
const startupInputSchema = load("agent/schemas/startup-input.schema.json");

function unique(values) {
  return [...new Set(values)];
}

function architectureReviewReasons(input) {
  const architecture = input.architecture ?? {};
  const reasons = [];

  if (architecture.regulatedControlsBeyondBaseline) {
    reasons.push("Regulated controls beyond the SSLZ baseline require architecture review.");
  }
  if (architecture.activeActiveMultiRegionWrites) {
    reasons.push("Active/active multi-region writes are outside the startup profiles.");
  }
  if ((architecture.independentProductionWorkloads ?? 1) > 1) {
    reasons.push("More than one independent production workload exceeds the startup profile boundary.");
  }
  if ((architecture.subscriptionCount ?? 2) >= 5) {
    reasons.push("Five or more subscriptions require graduation from the startup profile.");
  }
  if (architecture.hybridConnectivity) {
    reasons.push("Hybrid connectivity requires architecture review.");
  }
  if (architecture.centralizedEgressInspection) {
    reasons.push("Centralized egress inspection requires architecture review.");
  }
  if (architecture.automaticFailoverWithoutDataStrategy) {
    reasons.push("Automatic failover without a tested data strategy is unsupported.");
  }
  if (architecture.dedicatedPlatformTeamSharedServices) {
    reasons.push("Enterprise-wide shared services are outside the startup profiles.");
  }
  for (const requirement of [...(architecture.unsupportedRequirements ?? [])].sort()) {
    reasons.push(`No startup profile covers this requirement: ${requirement}`);
  }

  return reasons;
}

function baseAssumptions(input) {
  const assumptions = [
    "One primary workload is planned.",
    "Separate production and nonproduction subscriptions are used.",
    "Managed Azure services are preferred unless a stated requirement needs direct control.",
    "The planner does not assume service, model, SKU, quota, or capacity availability.",
  ];

  if (!input.architecture) {
    assumptions.push("No architecture stop condition was provided in the input.");
  }
  if (input.workload.managedModelFit === undefined) {
    assumptions.push("Managed-model fit has not been assessed.");
  }
  if (input.workload.kubernetesRequirements === undefined) {
    assumptions.push("No detailed Kubernetes capability requirements were provided.");
  }

  return assumptions;
}

function unresolvedReliabilityDecisions(input) {
  const decisions = [];

  if (input.reliability.rtoMinutes === null) {
    decisions.push({
      id: "reliability.rto.required",
      severity: "advisory",
      question: "What recovery time objective does the workload require?",
      reason: "The input does not define an RTO.",
    });
  }
  if (input.reliability.rpoMinutes === null) {
    decisions.push({
      id: "reliability.rpo.required",
      severity: "advisory",
      question: "What recovery point objective does the workload require?",
      reason: "The input does not define an RPO.",
    });
  }
  if (
    input.reliability.regionalMode !== "single-region-ready" &&
    !input.reliability.failoverOwnerConfirmed
  ) {
    decisions.push({
      id: "reliability.failover-owner.required",
      severity: "advisory",
      question: "Who owns regional failover and recovery testing?",
      reason: "A regional recovery mode was requested without a confirmed failover owner.",
    });
  }

  return decisions;
}

function costAssumptions(input, selectedProfiles) {
  const items = [
    "Estimates are deferred until region, sizing, service tier, usage, and availability checks complete.",
  ];
  for (const profileId of selectedProfiles) {
    items.push(...profiles[profileId].costAssumptions);
  }

  return {
    currency: "USD",
    monthlyPlatformMaximum: input.budget.monthlyPlatformMaximum,
    items: unique(items),
  };
}

function architectureReviewPlan(input, reasons) {
  return {
    schemaVersion: SCHEMA_VERSION,
    profileVersion: PROFILE_VERSION,
    status: "architecture-review",
    computeProfile: null,
    profileExtensions: [],
    aksIngress: null,
    rationale: [
      {
        decision: "architecture-review",
        reason: "The workload exceeds one or more documented SSLZ startup boundaries.",
        sourceRequirements: ["architecture"],
      },
    ],
    assumptions: baseAssumptions(input),
    requiredChecks: ["workload.profile.requirements-supported"],
    unresolvedDecisions: [
      {
        id: "architecture.review.required",
        severity: "blocking",
        question: "What reviewed architecture will satisfy the unsupported requirements?",
        reason: reasons.join(" "),
      },
      ...unresolvedReliabilityDecisions(input),
    ],
    costAssumptions: costAssumptions(input, []),
    architectureReview: {
      required: true,
      reasons,
    },
    iacGenerated: false,
    azureOperations: "none",
  };
}

function planWorkload(input) {
  validateDocument(startupInputSchema, input);

  const reviewReasons = architectureReviewReasons(input);
  if (reviewReasons.length > 0) {
    return architectureReviewPlan(input, reviewReasons);
  }

  const workload = input.workload;
  const managedModelFit = workload.managedModelFit ?? "unknown";
  const detailedKubernetesRequirements = KUBERNETES_REQUIREMENT_ORDER.filter(
    (requirement) => (workload.kubernetesRequirements ?? []).includes(requirement),
  );
  const customerManagedGpuSelected =
    workload.requiresCustomerManagedGpu && managedModelFit !== "yes";
  const managedModelSubstituted =
    workload.requiresCustomerManagedGpu && managedModelFit === "yes";
  const kubernetesSources = [];

  if (workload.requiresKubernetes) {
    kubernetesSources.push("workload.requiresKubernetes");
  }
  kubernetesSources.push(
    ...detailedKubernetesRequirements.map(
      (requirement) => `workload.kubernetesRequirements.${requirement}`,
    ),
  );
  if (customerManagedGpuSelected) {
    kubernetesSources.push("workload.requiresCustomerManagedGpu");
  }

  const computeProfile = kubernetesSources.length > 0 ? "aks" : "container-apps";
  const extensions = [];
  const rationale = [];
  const unresolvedDecisions = unresolvedReliabilityDecisions(input);
  let aksIngress = null;

  if (computeProfile === "aks") {
    rationale.push({
      decision: "aks",
      reason:
        "AKS is selected because the workload explicitly requires Kubernetes capabilities or customer-managed GPU scheduling.",
      sourceRequirements: unique(kubernetesSources),
    });
  } else {
    rationale.push({
      decision: "container-apps",
      reason:
        "Container Apps is the default because no Kubernetes-specific requirement was provided.",
      sourceRequirements: ["workload.traffic"],
    });
  }

  if (workload.requiresRelationalDatabase) {
    extensions.push("postgresql");
    rationale.push({
      decision: "postgresql",
      reason: "The workload requires relational persistence.",
      sourceRequirements: ["workload.requiresRelationalDatabase"],
    });
  }

  if (workload.usesFoundryModels || managedModelSubstituted) {
    extensions.push("foundry");
    rationale.push({
      decision: "foundry",
      reason:
        managedModelSubstituted
          ? "A managed model fits the workload, so Foundry is selected instead of customer-managed GPU infrastructure."
          : "The workload explicitly uses Foundry-managed models.",
      sourceRequirements:
        managedModelSubstituted
          ? [
              "workload.requiresCustomerManagedGpu",
              "workload.managedModelFit",
            ]
          : ["workload.usesFoundryModels"],
    });
  }

  if (customerManagedGpuSelected) {
    extensions.push("gpu");
    rationale.push({
      decision: "gpu",
      reason:
        "Customer-managed GPU infrastructure is selected for the stated direct GPU control requirement.",
      sourceRequirements: ["workload.requiresCustomerManagedGpu"],
    });
  }

  if (computeProfile === "aks" && !workload.incidentOwnerConfirmed) {
    unresolvedDecisions.unshift({
      id: "operations.aks-owner.required",
      severity: "blocking",
      question: "Who owns AKS upgrades, capacity, networking, and production incidents?",
      reason: "AKS cannot proceed without a confirmed operations owner.",
    });
  }
  if (computeProfile === "aks" && !workload.aksIngress) {
    unresolvedDecisions.unshift({
      id: "network.aks-ingress.decision-explicit",
      severity: "blocking",
      question: "Is AKS ingress private or an explicitly constrained public Azure Load Balancer?",
      reason: "AKS selection never implies public exposure.",
    });
  } else if (computeProfile === "aks") {
    try {
      aksIngress = validateAksIngressDecision(workload.aksIngress);
    } catch (error) {
      return architectureReviewPlan(input, [error.message]);
    }
  } else if (workload.aksIngress) {
    return architectureReviewPlan(input, [
      "An AKS ingress decision was supplied for a non-AKS workload profile.",
    ]);
  }
  if (customerManagedGpuSelected && managedModelFit === "unknown") {
    unresolvedDecisions.unshift({
      id: "workload.managed-model-fit.required",
      severity: "blocking",
      question: "Can a Foundry-managed model satisfy the functional, data, latency, and throughput requirements?",
      reason: "Customer-managed GPU infrastructure cannot proceed until managed-model fit is reviewed.",
    });
  }

  const selectedProfiles = [computeProfile, ...extensions];
  const requiredChecks = unique(
    selectedProfiles.flatMap((profileId) => profiles[profileId].requiredChecks),
  );
  const blocked = unresolvedDecisions.some(
    (decision) => decision.severity === "blocking",
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    profileVersion: PROFILE_VERSION,
    status: blocked ? "blocked" : "ready",
    computeProfile,
    profileExtensions: extensions,
    aksIngress,
    rationale,
    assumptions: baseAssumptions(input),
    requiredChecks,
    unresolvedDecisions,
    costAssumptions: costAssumptions(input, selectedProfiles),
    architectureReview: {
      required: false,
      reasons: [],
    },
    iacGenerated: false,
    azureOperations: "none",
  };
}

function usage() {
  return [
    "Usage:",
    "  startup-workload-plan.mjs plan --input <path|-> [--output json]",
    "",
    "The planner reads local JSON only. It makes no Azure calls and generates no IaC.",
  ].join("\n");
}

function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  if (args[0] !== "plan") {
    throw new Error("The only supported command is plan.");
  }

  let inputPath;
  let output = "json";
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") {
      inputPath = args[index + 1];
      index += 1;
    } else if (argument === "--output") {
      output = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!inputPath) {
    throw new Error("--input is required.");
  }
  if (output !== "json") {
    throw new Error("The only supported output is json.");
  }

  return { help: false, inputPath };
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const source =
      options.inputPath === "-"
        ? readFileSync(0, "utf8")
        : readFileSync(resolve(process.cwd(), options.inputPath), "utf8");
    const plan = planWorkload(JSON.parse(source));
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exitCode = plan.status === "ready" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Workload planning failed: ${error.message}\n`);
    process.exitCode = 2;
  }
}

export { planWorkload };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
