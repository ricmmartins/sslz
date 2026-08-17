#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  compareAllowedChanges,
  expectedHomepage,
  expectedReadme,
  parseNameStatus,
  validateClassicBaseline,
} from "../scripts/validate-classic-baseline.mjs";

assert.deepEqual(parseNameStatus("M\0README.md\0A\0new.txt\0"), [
  { status: "M", path: "README.md" },
  { status: "A", path: "new.txt" },
]);
assert.deepEqual(parseNameStatus(""), []);

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
  expectedHomepage("before\nmarker\nafter\n", {
    homepage: { insertAfter: "marker", cta: "cta" },
  }),
  "before\nmarker\ncta\nafter\n",
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
assert.equal(result.changes.length, 9);

console.log("Classic baseline manifest tests passed.");
