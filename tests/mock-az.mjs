#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const args = process.argv.slice(2);
const fixtureName = process.env.AZ_FIXTURE;

if (!fixtureName) {
  console.error("AZ_FIXTURE is required");
  process.exit(2);
}

function merge(base, override) {
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    return override;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? merge(result[key], value)
        : value;
  }
  return result;
}

function load(name) {
  const document = JSON.parse(
    readFileSync(resolve(fixtureDirectory, name), "utf8"),
  );
  if (!document.extends) {
    return document;
  }
  const { extends: parent, ...override } = document;
  return merge(load(parent), override);
}

if (process.env.AZ_TRACE_FILE) {
  appendFileSync(process.env.AZ_TRACE_FILE, `${args.join(" ")}\n`);
}

const fixture = load(fixtureName);
const command = args.join(" ");
const subscription = args[args.indexOf("--subscription") + 1];
const environment =
  subscription === fixture.subscriptions.prod.id ? "prod" : "nonprod";

function fail(key) {
  if (fixture.errors?.[key]) {
    console.error(fixture.errors[key]);
    process.exit(1);
  }
}

let response;
if (command.startsWith("account show --subscription")) {
  response = fixture.subscriptions[environment];
} else if (command.startsWith("account show")) {
  response = fixture.account;
} else if (command.startsWith("role assignment list")) {
  fail("roles");
  response = fixture.roles[environment];
} else if (command.startsWith("policy assignment list")) {
  fail("policies");
  response = fixture.policies[environment];
} else if (command.startsWith("provider list")) {
  fail("providers");
  const missingApp =
    fixture.providers[environment] === "missing-microsoft-app";
  response = [
    "Microsoft.App",
    "Microsoft.Authorization",
    "Microsoft.Insights",
    "Microsoft.KeyVault",
    "Microsoft.Network",
    "Microsoft.OperationalInsights",
    "Microsoft.Resources"
  ].map((namespace) => ({
    namespace,
    registrationState:
      missingApp && namespace === "Microsoft.App" ? "NotRegistered" : "Registered"
  }));
} else if (command.includes("graph.microsoft.com/v1.0/domains")) {
  fail("domains");
  response = fixture.domains;
} else if (command.includes("Microsoft.Billing/billingAccounts")) {
  fail("billing");
  response = fixture.billing;
} else {
  console.error(`Unsupported mock az command: ${command}`);
  process.exit(2);
}

console.log(JSON.stringify(response));
