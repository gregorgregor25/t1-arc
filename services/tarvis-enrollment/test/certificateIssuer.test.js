import assert from "node:assert/strict";
import { webcrypto, X509Certificate } from "node:crypto";
import test from "node:test";
import { CertificateIssuer, createDevelopmentCa } from "../src/certificateIssuer.js";

test("issues a short-lived client certificate for an external public key", async () => {
  const ca = await createDevelopmentCa({ days: 1 });
  const now = Date.now();
  const issuer = await CertificateIssuer.create({
    ...ca,
    ttlMs: 5 * 60_000,
    now: () => now,
  });
  const keys = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keys.publicKey));
  const result = await issuer.issue({
    attestedPublicKeySpki: spki,
    installationId: "installation_1234567890",
  });
  const leaf = new X509Certificate(result.certificatePem);
  const root = new X509Certificate(ca.certificatePem);
  assert.equal(leaf.verify(root.publicKey), true);
  assert.equal(leaf.checkIssued(root), true);
  assert.equal(
    leaf.publicKey.export({ type: "spki", format: "der" }).toString("hex"),
    spki.toString("hex"),
  );
  assert.ok(result.expiresAtMs <= now + 5 * 60_000);
  assert.ok(result.expiresAtMs > now + 4 * 60_000);
});
