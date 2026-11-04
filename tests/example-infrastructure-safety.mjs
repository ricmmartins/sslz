#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

function extractBlock(source, pattern, description) {
  const match = pattern.exec(source);
  assert(match, `Missing ${description}`);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  assert.fail(`Unclosed ${description}`);
}

function resource(source, type, name) {
  return extractBlock(
    source,
    new RegExp(`resource\\s+"${type}"\\s+"${name}"\\s*\\{`),
    `resource ${type}.${name}`,
  );
}

function assertPreventDestroy(source, type, name) {
  const block = resource(source, type, name);
  assert.match(block, /lifecycle\s*\{\s*prevent_destroy\s*=\s*true\s*\}/);
}

const examples = {
  ai: read("examples/ai-startup/terraform/main.tf"),
  api: read("examples/api-first-startup/terraform/main.tf"),
  saas: read("examples/saas-startup/terraform/main.tf"),
};

for (const [type, name] of [
  ["azurerm_storage_account", "this"],
  ["azurerm_storage_container", "models"],
  ["azurerm_storage_container", "datasets"],
  ["azurerm_key_vault", "this"],
]) {
  assertPreventDestroy(examples.ai, type, name);
}
for (const [type, name] of [
  ["azurerm_cosmosdb_account", "this"],
  ["azurerm_cosmosdb_sql_database", "this"],
  ["azurerm_cosmosdb_sql_container", "items"],
  ["azurerm_key_vault", "this"],
]) {
  assertPreventDestroy(examples.api, type, name);
}
for (const [type, name] of [
  ["azurerm_mssql_server", "this"],
  ["azurerm_mssql_database", "app"],
  ["azurerm_key_vault", "this"],
]) {
  assertPreventDestroy(examples.saas, type, name);
}

for (const [type, name] of [
  ["azurerm_linux_web_app", "this"],
  ["azurerm_linux_web_app_slot", "staging"],
]) {
  const app = resource(examples.api, type, name);
  const siteConfig = extractBlock(app, /site_config\s*\{/, `${type}.${name} site_config`);
  const heal = extractBlock(siteConfig, /auto_heal_setting\s*\{/, `${type}.${name} auto_heal_setting`);
  assert.match(heal, /action_type\s*=\s*"Recycle"/);
  assert.match(heal, /minimum_process_execution_time\s*=\s*"00:05:00"/);
  assert.match(heal, /status_code_range\s*=\s*"500-599"/);
  assert.match(heal, /count\s*=\s*5/);
  assert.match(heal, /interval\s*=\s*"00:01:00"/);
}

for (const example of ["ai-startup", "api-first-startup", "saas-startup"]) {
  const readme = read(`examples/${example}/README.md`);
  const teardown = readme.slice(readme.indexOf("## Teardown"));
  assert.match(teardown, /prevent_destroy/);
  assert.match(teardown, /remove those lifecycle guards/);
  assert.match(teardown, /destroy plan/);
}

const css = read("assets/css/main.css");
const tableRules = extractBlock(css, /\.page-content table\s*\{/, ".page-content table CSS");
assert.match(tableRules, /display:\s*block/);
assert.match(tableRules, /max-width:\s*100%/);
assert.match(tableRules, /overflow-x:\s*auto/);

console.log("Terraform data guards, App Service auto-heal, teardown guidance, and responsive table rules passed.");
