import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createDevelopmentCa, CertificateIssuer } from "../src/certificateIssuer.js";
import { createEnrollmentServer } from "../src/server.js";
import { syntheticAttestation } from "./fixtures.js";

async function fixture() {
  const ca = await createDevelopmentCa({ days: 1 });
  const issuer = await CertificateIssuer.create({ ...ca, ttlMs: 5 * 60_000 });
  const config = {
    bearerToken: "private-enrolment-token",
    challengeTtlMs: 120_000,
    certificateTtlMs: 5 * 60_000,
    maximumChallenges: 10,
    allowedAttestationRootFingerprints: new Set(),
    allowedAndroidPackages: new Set(["io.github.gregorgregor25.t1arc"]),
    allowedAndroidSigningCertificateDigests: new Set(),
  };
  const server = createEnrollmentServer({ config, certificateIssuer: issuer });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    config,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function post(baseUrl, path, body, authorized = true) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorized ? { Authorization: "Bearer private-enrolment-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("health is public but enrolment is authenticated and schema-closed", async (t) => {
  const app = await fixture();
  t.after(() => app.server.close());
  const health = await fetch(`${app.baseUrl}/poc/v1/health`);
  assert.deepEqual(await health.json(), { status: "ok", contentPath: false });
  const unauthorised = await post(
    app.baseUrl,
    "/poc/v1/enrollment/challenges",
    { installationId: "installation_1234567890" },
    false,
  );
  assert.equal(unauthorised.status, 401);
  const healthField = await post(app.baseUrl, "/poc/v1/enrollment/challenges", {
    installationId: "installation_1234567890",
    glucose: 6.2,
  });
  assert.equal(healthField.status, 400);
  assert.equal((await healthField.json()).error.code, "unexpected_fields");
});

test("issues one short-lived certificate for the challenge-bound key", async (t) => {
  const app = await fixture();
  t.after(() => app.server.close());
  const installationId = "installation_1234567890";
  const challengeResponse = await post(
    app.baseUrl,
    "/poc/v1/enrollment/challenges",
    { installationId },
  );
  assert.equal(challengeResponse.status, 201);
  const challenge = await challengeResponse.json();
  const attestation = await syntheticAttestation(
    Buffer.from(challenge.challengeBase64, "base64"),
    1,
  );
  app.config.allowedAttestationRootFingerprints.add(attestation.rootFingerprintSha256);
  app.config.allowedAndroidSigningCertificateDigests.add(
    attestation.signingCertificateDigest,
  );
  const certificateResponse = await post(
    app.baseUrl,
    "/poc/v1/enrollment/certificates",
    {
      challengeId: challenge.challengeId,
      installationId,
      attestationChainDerBase64: attestation.chainBase64,
    },
  );
  assert.equal(certificateResponse.status, 201);
  const certificate = await certificateResponse.json();
  assert.match(certificate.certificateChainPem[0], /BEGIN CERTIFICATE/);
  assert.equal(certificate.attestationSecurityLevel, "trusted-environment");
  const replay = await post(app.baseUrl, "/poc/v1/enrollment/certificates", {
    challengeId: challenge.challengeId,
    installationId,
    attestationChainDerBase64: attestation.chainBase64,
  });
  assert.equal(replay.status, 410);
});
