#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compareAllowedChanges,
  expectedHomepage,
  expectedReadme,
  expectedValidateWorkflow,
  isAgentPath,
  parseNameStatus,
  validateClassicBaseline,
} from "../scripts/validate-classic-baseline.mjs";

assert.deepEqual(parseNameStatus("M\0README.md\0A\0new.txt\0"), [
  { status: "M", path: "README.md" },
  { status: "A", path: "new.txt" },
]);
assert.deepEqual(parseNameStatus(""), []);
assert.equal(isAgentPath("use-sslz-agent.md"), true);
assert.equal(isAgentPath(".github/agents/sslz-founder.agent.md"), true);
assert.equal(isAgentPath("agent/checks/check-catalog.json"), true);
assert.equal(isAgentPath("docs/architecture.md"), false);

assert.deepEqual(
  compareAllowedChanges(
    [
      { path: "index.md", status: "M" },
      { path: "README.md", status: "M" },
    ],
    [
      { path: "README.md", status: "M" },
      { path: "index.md", status: "M" },
    ],
  ),
  [
    { path: "README.md", status: "M" },
    { path: "index.md", status: "M" },
  ],
);
assert.throws(
  () =>
    compareAllowedChanges(
      [{ path: "README.md", status: "M" }],
      [{ path: "index.md", status: "M" }],
    ),
  /differs from the approved baseline allowlist/,
);

assert.equal(
  expectedReadme(
    "before\nold-a\nold-b\nafter\n",
    {
      readme: {
        originalBadges: ["old-a", "old-b"],
        approvedBadges: ["new-a", "new-b"],
      },
    },
  ),
  "before\nnew-a\nnew-b\nafter\n",
);
assert.equal(
  expectedReadme("old\n\n## Quick Start\nunchanged\n", {
    readme: {
      originalBadges: ["old"],
      approvedBadges: ["new"],
      launcherSection: "## Plan with the SSLZ Founder Agent\n\nlauncher link\n",
    },
  }),
  "new\n\n## Plan with the SSLZ Founder Agent\n\nlauncher link\n\n## Quick Start\nunchanged\n",
);
assert.throws(
  () => expectedReadme("old\n", {
    readme: {
      originalBadges: ["old"],
      approvedBadges: ["new"],
      launcherSection: "launcher link\n",
    },
  }),
  /Quick Start insertion point is not unique/,
);
assert.equal(
  expectedHomepage("before\nmarker\nafter\n", {
    homepage: { insertAfter: "marker", cta: "cta" },
  }),
  "before\nmarker\ncta\nafter\n",
);
assert.equal(
  expectedValidateWorkflow("name: Validate\n\non:\n  push:\n", {
    validateWorkflow: {
      insertAfter: "on:",
      entry: "  workflow_dispatch:",
    },
  }),
  "name: Validate\n\non:\n  workflow_dispatch:\n  push:\n",
);

const result = validateClassicBaseline();
assert.equal(
  result.baseline,
  "d2d1ea823c33affeb620ec6acbc90536ec646c2d",
);
assert.equal(
  result.baselineRoot,
  "a4de206d8878f9c012203bee740b46f0b9234e14",
);
assert.equal(
  result.recoveryBase,
  "b8fe8254c29cdbea3ddd6d4f10bbaa8de3c21223",
);
assert.equal(
  result.integrationBase,
  "ff16a2ce81425507461bba52ec9319ba1ce55020",
);
assert.equal(result.changes.length, 13);
assert.throws(
  () => validateClassicBaseline({ head: "362dd43ca4e0991e00f4b2c8454ba4a4bd0b0670" }),
  undefined,
  "The agent implementation must not qualify as a classic website release.",
);

console.log("Classic baseline manifest tests passed.");
