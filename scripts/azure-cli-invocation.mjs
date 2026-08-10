import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_AZURE_CONFIG_DIR = resolve(homedir(), ".azure");
const TRUSTED_PATH =
  process.platform === "win32"
    ? String.raw`C:\Windows\System32;C:\Windows`
    : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

function azureCliConfigDirectory() {
  return DEFAULT_AZURE_CONFIG_DIR;
}

function sanitizedAzureCliEnvironment(extra = {}) {
  const environment = {};
  const allowed = [
    "ALL_PROXY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "SYSTEMROOT",
  ];
  const sourceKeys = new Map(
    Object.keys(process.env).map((key) => [key.toUpperCase(), key]),
  );
  for (const key of allowed) {
    const sourceKey = sourceKeys.get(key);
    if (sourceKey && process.env[sourceKey] !== undefined) {
      environment[key] = process.env[sourceKey];
    }
  }
  return {
    ...environment,
    ...extra,
    AZURE_CONFIG_DIR: azureCliConfigDirectory(),
    PATH: TRUSTED_PATH,
  };
}

function azureCliInvocation(args) {
  const candidates =
    process.platform === "win32"
      ? [
          String.raw`C:\Program Files\Microsoft SDKs\Azure\CLI2\python.exe`,
          String.raw`C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\python.exe`,
        ]
      : [
          "/usr/bin/az",
          "/usr/local/bin/az",
          "/opt/az/bin/az",
          "/opt/homebrew/bin/az",
        ];
  const executable = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (!executable) {
    throw new Error("Azure CLI could not be located without a command shell.");
  }
  return {
    executable,
    arguments:
      process.platform === "win32"
        ? ["-IBm", "azure.cli", ...args]
        : args,
  };
}

export {
  azureCliConfigDirectory,
  azureCliInvocation,
  sanitizedAzureCliEnvironment,
};
