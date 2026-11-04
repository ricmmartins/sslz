#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "sslz-teardown-"));
const log = join(directory, "calls.jsonl");
const script = fileURLToPath(new URL("../scripts/teardown.sh", import.meta.url));
try {
  const mock = join(directory, "az");
  writeFileSync(mock, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SSLZ_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "account" && args[1] === "show") {
  console.log("isolated-mock-subscription");
} else if (args[0] === "group" && args[1] === "list") {
  const query = args[args.indexOf("--query") + 1];
  if (query !== "[?name=='rg-acme-nonprod-monitoring' || name=='rg-acme-nonprod-networking'].name") process.exit(7);
  console.log("rg-acme-nonprod-monitoring\\nrg-acme-nonprod-networking");
} else if (args[0] === "group" && args[1] === "delete") {
  const name = args[args.indexOf("--name") + 1];
  if (!["rg-acme-nonprod-monitoring", "rg-acme-nonprod-networking"].includes(name)) process.exit(8);
} else { process.exit(9); }
`);
  chmodSync(mock, 0o700);
  function run(args) {
    writeFileSync(log, "");
    const result = spawnSync("bash", [script, ...args], {
      encoding: "utf8", timeout: 30000,
      env: { ...process.env, PATH: `${directory}${delimiter}${process.env.PATH}`, SSLZ_TEST_LOG: log },
    });
    assert.ifError(result.error);
    return { ...result, calls: readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) };
  }
  for (const extra of [[], ["--company", "acme' || name!='"], ["--company", "../acme"]]) {
    const result = run(["--tool", "bicep", "--env", "nonprod", "--yes", ...extra]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.calls.length, 0, "Invalid deletion scope must fail before Azure calls.");
  }
  const result = run(["--tool", "bicep", "--env", "nonprod", "--company", "acme", "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.filter(a => a[1] === "delete").map(a => a[a.indexOf("--name") + 1]),
    ["rg-acme-nonprod-monitoring", "rg-acme-nonprod-networking"]);
  assert(!result.stdout.includes("az role assignment list --all"));
  assert(!result.stdout.includes("--tier Free"));
  assert(result.stdout.includes("pre-deployment inventory"));
  console.log("Actual Bash teardown rejected missing/invalid company before Azure calls and selected only two exact baseline groups through a mocked Azure CLI. No Azure writes.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
