import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const TERRAFORM_PROVENANCE_DOMAIN = "sslz-terraform-plan-provenance-v1";

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashCanonical(value) {
  return hashBytes(canonicalJson(value));
}

function terraformRuntimePlatform() {
  const operatingSystem =
    process.platform === "win32" ? "windows" : process.platform;
  const architecture =
    process.arch === "x64"
      ? "amd64"
      : process.arch === "ia32"
        ? "386"
        : process.arch;
  return `${operatingSystem}_${architecture}`;
}

function terraformExecutable() {
  const requested = process.env.SSLZ_TERRAFORM_EXECUTABLE;
  const candidates = requested
    ? [requested]
    : process.platform === "win32"
      ? [
          String.raw`C:\Program Files\HashiCorp\Terraform\terraform.exe`,
          String.raw`C:\Program Files\Terraform\terraform.exe`,
        ]
      : [
          "/usr/bin/terraform",
          "/usr/local/bin/terraform",
          "/opt/homebrew/bin/terraform",
        ];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) {
      continue;
    }
    const path = resolve(candidate);
    if (
      existsSync(path) &&
      !lstatSync(path).isSymbolicLink() &&
      statSync(path).isFile()
    ) {
      return { path, digest: hashBytes(readFileSync(path)) };
    }
  }
  throw new Error(
    "Terraform must be installed at a trusted absolute path or set through SSLZ_TERRAFORM_EXECUTABLE.",
  );
}

function provenanceKey(publicKey) {
  const key =
    publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("The Terraform provenance key must be Ed25519.");
  }
  return key;
}

function terraformProvenanceKeyId(publicKey) {
  return hashBytes(
    provenanceKey(publicKey).export({ type: "spki", format: "der" }),
  );
}

function terraformProvenancePayload(provenance) {
  const { signature: omitted, ...payload } = provenance;
  return payload;
}

function terraformProvenanceSigningMessage(provenance) {
  return Buffer.from(
    `${TERRAFORM_PROVENANCE_DOMAIN}\0${canonicalJson(
      terraformProvenancePayload(provenance),
    )}`,
    "utf8",
  );
}

function signTerraformProvenance(payload, privateKey) {
  const key =
    privateKey?.type === "private"
      ? privateKey
      : createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("The Terraform provenance signing key must be Ed25519.");
  }
  const provenance = {
    schemaVersion: "1.0.0",
    generatedBy: "startup-iac-plan.mjs",
    ...payload,
    signatureAlgorithm: "Ed25519",
    keyId: terraformProvenanceKeyId(createPublicKey(key)),
  };
  provenance.signature = sign(
    null,
    terraformProvenanceSigningMessage(provenance),
    key,
  ).toString("base64");
  return provenance;
}

function verifyTerraformProvenance(provenance, publicKey) {
  const key = provenanceKey(publicKey);
  if (provenance.keyId !== terraformProvenanceKeyId(key)) {
    return false;
  }
  const signature = Buffer.from(provenance.signature, "base64");
  if (
    signature.length !== 64 ||
    signature.toString("base64") !== provenance.signature
  ) {
    return false;
  }
  return verify(
    null,
    terraformProvenanceSigningMessage(provenance),
    key,
    signature,
  );
}

export {
  hashBytes,
  hashCanonical,
  signTerraformProvenance,
  terraformExecutable,
  terraformRuntimePlatform,
  terraformProvenanceKeyId,
  terraformProvenancePayload,
  terraformProvenanceSigningMessage,
  verifyTerraformProvenance,
};
