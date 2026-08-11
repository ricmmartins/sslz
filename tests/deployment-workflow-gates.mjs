#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function workflow(name) {
  return readFileSync(resolve(root, `.github/workflows/${name}`), "utf8");
}

for (const [name, provider] of [
  ["deploy-bicep.yml", "bicep"],
  ["deploy-terraform.yml", "terraform"],
]) {
  const source = workflow(name);
  assert.match(source, /^on:\r?\n  workflow_dispatch:/m, `${name}: dispatch required`);
  assert.doesNotMatch(source, /^  (?:push|pull_request|schedule):/m);
  assert.match(source, /runs-on: \[self-hosted, sslz-deployment\]/);
  assert.match(source, /uses: actions\/checkout@v4\r?\n        with:\r?\n[\s\S]*?clean: false/);
  assert.match(source, /environment: \$\{\{ inputs\.environment \}\}/);
  assert.match(source, /regional_attempt_chain:/);
  assert.match(source, /regional_attempt_number:/);
  assert.match(
    source,
    /group: deploy-regional-\$\{\{ inputs\.environment \}\}-\$\{\{ inputs\.regional_attempt_chain \}\}/,
  );
  assert.match(source, /manifest\.regionalAttempt\?\.chainId/);
  assert.match(source, /manifest\.regionalAttempt\?\.attemptNumber/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, new RegExp(`EXPECTED_PROVIDER: ${provider}`));
  assert.match(source, /startup-deployment-integration\.sh apply/);
  assert.match(source, /--manifest "\$MANIFEST_PATH"/);
  assert.match(source, /--approval "\$APPROVAL_PATH"/);
  assert.match(source, /SSLZ_DEPLOYMENT_APPROVAL_PUBLIC_KEY_FILE/);
  assert.doesNotMatch(source, /\baz deployment sub create\b/);
  assert.doesNotMatch(source, /\bterraform apply\b/);
}

const validation = workflow("validate.yml");
assert.match(validation, /^  pull_request:/m);
assert.match(validation, /^  push:/m);
assert.match(validation, /node tests\/blocking-check-catalog\.mjs/);
assert.match(validation, /node tests\/deployment-workflow-gates\.mjs/);

const integration = workflow("integration-test.yml");
assert.match(
  integration,
  /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main' && github\.event\.inputs\.deploy == 'true'/,
);
assert.match(
  integration,
  /ARM_SUBSCRIPTION_ID: \$\{\{ secrets\.AZURE_SUBSCRIPTION_ID_INTEGRATION \}\}/,
);
assert.match(integration, /environment: integration-nonprod/);
assert.doesNotMatch(integration, /AZURE_SUBSCRIPTION_ID_PROD/);
assert.doesNotMatch(integration, /AZURE_SUBSCRIPTION_ID_NONPROD/);
assert.match(
  integration,
  /continue-on-error: true\r?\n        working-directory: infra\/terraform\r?\n        run: terraform apply/,
);
assert.match(
  integration,
  /if: always\(\) && steps\.tf-apply\.outcome != 'skipped'/,
);
assert.match(integration, /id: tf-destroy/);
assert.match(integration, /APPLY_OUTCOME: \$\{\{ steps\.tf-apply\.outcome \}\}/);
assert.match(
  integration,
  /DESTROY_OUTCOME: \$\{\{ steps\.tf-destroy\.outcome \}\}/,
);
assert.match(
  integration,
  /Terraform apply failed; inspect the apply diagnostics first\.[\s\S]+Terraform teardown also failed; orphan cleanup is required\.[\s\S]+exit "\$failed"/,
);
assert(
  integration.indexOf("run: terraform destroy") >
    integration.indexOf("run: terraform apply"),
  "Integration cleanup must follow every started apply",
);

console.log("Deployment workflow gate tests passed.");
