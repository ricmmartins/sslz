#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "sslz-prerequisites-"));
const log = join(directory, "calls.jsonl");
const script = fileURLToPath(new URL("../scripts/validate-prerequisites.sh", import.meta.url));
try {
  const az = join(directory, "az");
  writeFileSync(az, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const scenario = process.env.SSLZ_TEST_SCENARIO;
fs.appendFileSync(process.env.SSLZ_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "version") {
  if (scenario === "broken-cli") process.exit(1);
  console.log("2.80.0");
}
else if (args[0] === "bicep" && args[1] === "version") {
  if (scenario === "missing-bicep") process.exit(1);
  console.log("Bicep CLI version 0.46.1");
} else if (args[0] === "account" && args[1] === "show") {
  if (scenario === "unauthenticated") process.exit(1);
  console.log("mock-account");
} else if (args[0] === "provider" && args[1] === "show") {
  console.log(scenario === "unregistered" ? "NotRegistered" : "Registered");
} else if (args[0] === "group" && args[1] === "list") {
  if (scenario === "no-group-read") process.exit(1);
  console.log("mock-group");
} else if (args[0] === "policy" && args[1] === "assignment" && args[2] === "list") {
  if (scenario === "no-policy-read") process.exit(1);
  console.log("mock-policy");
} else { process.exit(9); }
`);
  chmodSync(az, 0o700);
  const terraform = join(directory, "terraform");
  writeFileSync(terraform, `#!/usr/bin/env node
console.log(JSON.stringify({terraform_version: process.env.SSLZ_TEST_SCENARIO === "old-terraform" ? "1.4.0" : "1.9.8"}));
`);
  chmodSync(terraform, 0o700);
  function run(scenario, args = ["--tool", "bicep"]) {
    writeFileSync(log, "");
    const result = spawnSync("bash", [script, ...args], {
      encoding: "utf8", timeout: 30000,
      env: {
        ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`,
        SSLZ_TEST_LOG: log, SSLZ_TEST_SCENARIO: scenario,
      },
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    assert(!calls.some(args => args.some(arg => ["create", "delete", "register", "set", "update"].includes(arg))),
      "Prerequisites must perform reads only.");
    return { ...result, calls };
  }
  for (const tool of ["bicep", "terraform"]) {
    const result = run("pass", ["--tool", tool]);
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes("Read-only checks passed"));
    assert(result.stdout.includes("does not authorize deployment"));
    assert(!result.stdout.includes("Ready to deploy"));
  }
  for (const scenario of ["broken-cli", "missing-bicep", "unauthenticated", "unregistered", "no-group-read", "no-policy-read", "old-terraform"]) {
    const result = run(scenario);
    assert.equal(result.status, 1, `${scenario}: ${result.stdout}\n${result.stderr}`);
    assert(!result.stdout.includes("Read-only checks passed"));
  }
  assert.equal(run("missing-bicep", ["--tool", "terraform"]).status, 0,
    "Terraform does not require the Bicep executable.");
  for (const args of [["--tool"], ["--tool", "invalid"], ["--skip-checks"]]) {
    const result = run("pass", args);
    assert.equal(result.status, 1);
    assert.equal(result.calls.length, 0);
  }
  console.log("Actual Bash prerequisite checks passed mocked positive/read-only and tool/auth/provider/permission negatives. No Azure calls.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
