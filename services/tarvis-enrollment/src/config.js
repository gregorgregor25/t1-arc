import { readFile } from "node:fs/promises";

function requiredSecret(value, name) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function fingerprints(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.replaceAll(":", "").trim().toUpperCase())
      .filter((item) => /^[0-9A-F]{64}$/.test(item)),
  );
}

function packageNames(value) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^[A-Za-z0-9_.]{3,255}$/.test(item)),
  );
}

export function readConfig(environment = process.env) {
  return {
    host: environment.HOST?.trim() || "127.0.0.1",
    port: boundedInteger(
      environment.PORT,
      7314,
      1,
      65_535,
      "PORT",
    ),
    bearerToken: requiredSecret(
      environment.TARVIS_ENROLLMENT_BEARER_TOKEN,
      "TARVIS_ENROLLMENT_BEARER_TOKEN",
    ),
    caCertificatePath: requiredSecret(
      environment.TARVIS_ENROLLMENT_CA_CERT_FILE,
      "TARVIS_ENROLLMENT_CA_CERT_FILE",
    ),
    caPrivateKeyPath: requiredSecret(
      environment.TARVIS_ENROLLMENT_CA_KEY_FILE,
      "TARVIS_ENROLLMENT_CA_KEY_FILE",
    ),
    allowedAttestationRootFingerprints: fingerprints(
      environment.TARVIS_ALLOWED_ATTESTATION_ROOT_SHA256,
    ),
    allowedAndroidPackages: packageNames(
      environment.TARVIS_ALLOWED_ANDROID_PACKAGES,
    ),
    allowedAndroidSigningCertificateDigests: fingerprints(
      environment.TARVIS_ALLOWED_ANDROID_SIGNING_CERT_SHA256,
    ),
    challengeTtlMs: boundedInteger(
      environment.TARVIS_ENROLLMENT_CHALLENGE_TTL_MS,
      120_000,
      30_000,
      5 * 60_000,
      "TARVIS_ENROLLMENT_CHALLENGE_TTL_MS",
    ),
    certificateTtlMs: boundedInteger(
      environment.TARVIS_ENROLLMENT_CERTIFICATE_TTL_MS,
      5 * 60_000,
      60_000,
      15 * 60_000,
      "TARVIS_ENROLLMENT_CERTIFICATE_TTL_MS",
    ),
    maximumChallenges: boundedInteger(
      environment.TARVIS_ENROLLMENT_MAX_CHALLENGES,
      1_024,
      1,
      10_000,
      "TARVIS_ENROLLMENT_MAX_CHALLENGES",
    ),
  };
}

export async function loadCaMaterial(config) {
  const [certificatePem, privateKeyPem] = await Promise.all([
    readFile(config.caCertificatePath, "utf8"),
    readFile(config.caPrivateKeyPath, "utf8"),
  ]);
  if (!certificatePem.includes("BEGIN CERTIFICATE")) {
    throw new Error("The enrolment CA certificate file is invalid.");
  }
  if (!privateKeyPem.includes("PRIVATE KEY")) {
    throw new Error("The enrolment CA private-key file is invalid.");
  }
  return { certificatePem, privateKeyPem };
}
