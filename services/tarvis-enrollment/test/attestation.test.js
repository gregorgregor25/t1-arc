import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { validateAttestationChain } from "../src/attestation.js";
import { syntheticAttestation } from "./fixtures.js";

function policy(fixture, overrides = {}) {
  return {
    allowedRootFingerprints: new Set([fixture.rootFingerprintSha256]),
    allowedAndroidPackages: new Set(["io.github.gregorgregor25.t1arc"]),
    allowedAndroidSigningCertificateDigests: new Set([
      fixture.signingCertificateDigest,
    ]),
    ...overrides,
  };
}

test("validates a challenge-bound hardware attestation chain", async () => {
  const challenge = randomBytes(32);
  const fixture = await syntheticAttestation(challenge, 1);
  const result = validateAttestationChain(
    fixture.chainBase64,
    challenge,
    policy(fixture),
  );
  assert.equal(result.securityLevel, "trusted-environment");
  assert.equal(result.rootFingerprintSha256, fixture.rootFingerprintSha256);
});

test("rejects a replayed challenge and an untrusted root", async () => {
  const challenge = randomBytes(32);
  const fixture = await syntheticAttestation(challenge, 2);
  assert.throws(
    () => validateAttestationChain(
      fixture.chainBase64,
      randomBytes(32),
      policy(fixture),
    ),
    (error) => error.code === "invalid_key_attestation",
  );
  assert.throws(
    () => validateAttestationChain(
      fixture.chainBase64,
      challenge,
      policy(fixture, { allowedRootFingerprints: new Set() }),
    ),
    (error) => error.code === "untrusted_attestation_root",
  );
});

test("rejects a different Android package or signing certificate", async () => {
  const challenge = randomBytes(32);
  const fixture = await syntheticAttestation(challenge);
  assert.throws(
    () => validateAttestationChain(
      fixture.chainBase64,
      challenge,
      policy(fixture, { allowedAndroidPackages: new Set(["example.attacker"]) }),
    ),
    (error) => error.code === "invalid_key_attestation",
  );
  assert.throws(
    () => validateAttestationChain(
      fixture.chainBase64,
      challenge,
      policy(fixture, {
        allowedAndroidSigningCertificateDigests: new Set(["00".repeat(32)]),
      }),
    ),
    (error) => error.code === "invalid_key_attestation",
  );
});
