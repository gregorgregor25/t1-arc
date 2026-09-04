import { X509Certificate } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { HttpError } from "./errors.js";
import { parseAndroidKeyDescription } from "./der.js";

const MAX_CERTIFICATES = 8;
const MAX_CERTIFICATE_DER_BYTES = 16 * 1024;

function strictBase64(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil((MAX_CERTIFICATE_DER_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error("Invalid certificate encoding.");
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length === 0 ||
    decoded.length > MAX_CERTIFICATE_DER_BYTES ||
    decoded.toString("base64") !== value
  ) {
    throw new Error("Invalid certificate encoding.");
  }
  return decoded;
}

function fingerprintValue(certificate) {
  return certificate.fingerprint256.replaceAll(":", "").toUpperCase();
}

export function validateAttestationChain(
  encodedChain,
  expectedChallenge,
  policy,
) {
  try {
    if (!Array.isArray(encodedChain) || encodedChain.length < 2 || encodedChain.length > MAX_CERTIFICATES) {
      throw new Error("Invalid attestation chain length.");
    }
    const certificates = encodedChain.map(
      (encoded) => new X509Certificate(strictBase64(encoded)),
    );
    for (let index = 0; index < certificates.length - 1; index += 1) {
      if (!certificates[index].verify(certificates[index + 1].publicKey)) {
        throw new Error("The attestation chain signature is invalid.");
      }
    }
    const root = certificates.at(-1);
    if (!root.verify(root.publicKey)) {
      throw new Error("The attestation root is not self-signed.");
    }
    const rootFingerprintSha256 = fingerprintValue(root);
    if (!policy.allowedRootFingerprints.has(rootFingerprintSha256)) {
      throw new HttpError(
        403,
        "untrusted_attestation_root",
        `The Android attestation root is not allowlisted (${rootFingerprintSha256}).`,
      );
    }
    const description = parseAndroidKeyDescription(certificates[0].raw);
    if (
      expectedChallenge.length !== description.challenge.length ||
      !timingSafeEqual(expectedChallenge, description.challenge)
    ) {
      throw new Error("The key attestation does not match the one-time challenge.");
    }
    if (
      description.attestationSecurityLevel !== 1 &&
      description.attestationSecurityLevel !== 2
    ) {
      throw new Error("The attested key is not hardware-backed.");
    }
    if (
      description.keymasterSecurityLevel !== 1 &&
      description.keymasterSecurityLevel !== 2
    ) {
      throw new Error("The keymaster implementation is not hardware-backed.");
    }
    if (!description.deviceLocked || description.verifiedBootState !== 0) {
      throw new Error("The device is not locked in Android Verified Boot state.");
    }
    if (
      !description.packages.some(({ packageName }) =>
        policy.allowedAndroidPackages.has(packageName))
    ) {
      throw new Error("The attested Android package is not allowed.");
    }
    if (
      !description.signingCertificateDigests.some((digest) =>
        policy.allowedAndroidSigningCertificateDigests.has(digest))
    ) {
      throw new Error("The attested Android signing certificate is not allowed.");
    }
    const now = Date.now();
    for (const certificate of certificates) {
      if (
        new Date(certificate.validFrom).getTime() > now ||
        new Date(certificate.validTo).getTime() <= now
      ) {
        throw new Error("The attestation certificate is not currently valid.");
      }
    }
    return {
      leaf: certificates[0],
      rootFingerprintSha256,
      securityLevel:
        description.attestationSecurityLevel === 2 ? "strongbox" : "trusted-environment",
      packageNames: description.packages.map(({ packageName }) => packageName),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      403,
      "invalid_key_attestation",
      "The Android key attestation could not be verified.",
    );
  }
}
