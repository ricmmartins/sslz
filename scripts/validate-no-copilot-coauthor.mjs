#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/i;
const ZERO_SHA = /^0{40}$/;
const COPILOT_NAME = /^(?:GitHub[ \t]+)?Copilot(?:[ \t]+App)?$/i;
const COPILOT_GITHUB_EMAIL =
  /^(?:(?:223556219\+)?copilot(?:app)?@users\.noreply\.github\.com|copilot@github\.com)$/i;

function identity(value) {
  const match = value.trim().match(/^(.*?)\s*(?:<([^<>\s]+)>)?$/);
  return {
    name: match?.[1]?.trim() ?? "",
    email: match?.[2]?.trim() ?? "",
  };
}

function isProhibitedCopilotIdentity(name, email) {
  return COPILOT_NAME.test(name.trim()) || COPILOT_GITHUB_EMAIL.test(email.trim());
}

function prohibitedCopilotCoauthorTrailers(message) {
  const parsed = execFileSync("git", ["interpret-trailers", "--parse"], {
    encoding: "utf8",
    input: message,
  });
  return parsed
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((trailer) => {
      const separator = trailer.indexOf(":");
      if (
        separator < 0 ||
        trailer.slice(0, separator).trim().toLowerCase() !== "co-authored-by"
      ) {
        return false;
      }
      const { name, email } = identity(trailer.slice(separator + 1));
      return isProhibitedCopilotIdentity(name, email);
    });
}

function commitRange(base, head) {
  if (!SHA.test(base) || !SHA.test(head)) {
    throw new Error("--base and --head must be full 40-character commit SHAs.");
  }
  if (ZERO_SHA.test(base)) {
    return [head];
  }
  const output = execFileSync(
    "git",
    ["rev-list", "--reverse", `${base}..${head}`],
    { encoding: "utf8" },
  ).trim();
  return output ? output.split(/\r?\n/) : [];
}

function validateCommitRange(base, head) {
  const commits = commitRange(base, head);
  const violations = [];
  for (const commit of commits) {
    const metadata = execFileSync(
      "git",
      ["show", "-s", "--format=%an%x00%ae%x00%cn%x00%ce%x00%B", commit],
      { encoding: "utf8" },
    );
    const [authorName, authorEmail, committerName, committerEmail, ...body] =
      metadata.split("\0");
    const identities = [
      ["author", authorName, authorEmail],
      ["committer", committerName, committerEmail],
    ].filter(([, name, email]) => isProhibitedCopilotIdentity(name, email));
    const message = body.join("\0");
    const trailers = prohibitedCopilotCoauthorTrailers(message);
    if (identities.length > 0 || trailers.length > 0) {
      violations.push({ commit, identities, trailers });
    }
  }
  if (violations.length > 0) {
    const details = violations
      .map(
        ({ commit, identities, trailers }) => {
          const fields = [
            ...identities.map(
              ([role, name, email]) =>
                `${role} ${JSON.stringify(`${name} <${email}>`)}`,
            ),
            ...trailers.map((trailer) => JSON.stringify(trailer)),
          ];
          return `${commit}: ${fields.join(", ")}`;
        },
      )
      .join("\n");
    throw new Error(
      `Copilot must not be attributed as a commit author, committer, or co-author. Remove the prohibited attribution:\n${details}`,
    );
  }
  return commits.length;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--base", "--head"].includes(name) || value === undefined) {
      throw new Error("Usage: validate-no-copilot-coauthor.mjs --base <sha> --head <sha>");
    }
    options[name.slice(2)] = value;
  }
  if (!options.base || !options.head) {
    throw new Error("Usage: validate-no-copilot-coauthor.mjs --base <sha> --head <sha>");
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { base, head } = parseArguments(process.argv.slice(2));
    const count = validateCommitRange(base, head);
    console.log(`Commit attribution is valid for ${count} commit(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export {
  isProhibitedCopilotIdentity,
  prohibitedCopilotCoauthorTrailers,
  validateCommitRange,
};
