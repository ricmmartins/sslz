#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  isProhibitedCopilotIdentity,
  prohibitedCopilotCoauthorTrailers,
} from "../scripts/validate-no-copilot-coauthor.mjs";

for (const message of [
  "fix: update validation",
  "docs: explain Copilot usage",
  "docs: show how to remove Co-authored-by lines for Copilot",
  "docs: quote a trailer\n\nCo-authored-by: GitHub Copilot\n\nThis is documentation, not a trailer.",
  "Co-authored-by: Jane Copilotson <jane@example.com>",
  "Reviewed-by: Copilot App <reviewer@example.com>",
]) {
  assert.deepEqual(
    prohibitedCopilotCoauthorTrailers(message),
    [],
    `ordinary reference must remain allowed: ${message}`,
  );
}

for (const message of [
  "fix: update validation\n\nCo-authored-by: Copilot",
  "fix: update validation\n\nco-authored-by: GitHub Copilot <223556219+Copilot@users.noreply.github.com>",
  "fix: update validation\r\n\r\nCo-authored-by: Copilot App <223556219+copilot@users.noreply.github.com>\r\n",
  "fix: update validation\n\nCO-AUTHORED-BY: COPILOT APP <223556219+COPILOT@USERS.NOREPLY.GITHUB.COM>",
]) {
  assert.equal(
    prohibitedCopilotCoauthorTrailers(message).length,
    1,
    `Copilot co-author trailer must be rejected: ${message}`,
  );
}

for (const [name, email] of [
  ["Copilot", "bot@example.com"],
  ["copilot app", "bot@example.com"],
  ["GitHub Copilot", "bot@example.com"],
  ["Jane Reviewer", "223556219+Copilot@users.noreply.github.com"],
  ["Jane Reviewer", "COPILOT@GITHUB.COM"],
]) {
  assert.equal(isProhibitedCopilotIdentity(name, email), true);
}
assert.equal(
  isProhibitedCopilotIdentity(
    "Jane Copilotson",
    "jane.copilotson@example.com",
  ),
  false,
);

console.log("Copilot co-author trailer validation tests passed.");
