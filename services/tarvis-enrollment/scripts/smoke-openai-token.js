import { request } from "node:https";
import { webcrypto } from "node:crypto";
import { writeFile } from "node:fs/promises";

const serviceRoot = process.env.TARVIS_SMOKE_SERVICE_ROOT;
const issuerModule = await import(
  serviceRoot
    ? `${serviceRoot}/src/certificateIssuer.js`
    : new URL("../src/certificateIssuer.js", import.meta.url).href
);
const configModule = await import(
  serviceRoot
    ? `${serviceRoot}/src/config.js`
    : new URL("../src/config.js", import.meta.url).href
);
const { CertificateIssuer } = issuerModule;
const { loadCaMaterial, readConfig } = configModule;

const identityProviderId = process.env.OPENAI_IDENTITY_PROVIDER_ID;
const serviceAccountId = process.env.OPENAI_SERVICE_ACCOUNT_ID;
if (!identityProviderId || !serviceAccountId) {
  throw new Error("OPENAI_IDENTITY_PROVIDER_ID and OPENAI_SERVICE_ACCOUNT_ID are required.");
}

const config = readConfig();
const caMaterial = await loadCaMaterial(config);
const issuer = await CertificateIssuer.create({
  ...caMaterial,
  ttlMs: process.env.TARVIS_SMOKE_ISSUER_TTL_MS
    ? Number(process.env.TARVIS_SMOKE_ISSUER_TTL_MS)
    : config.certificateTtlMs,
});
const keys = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const publicKeySpki = Buffer.from(await webcrypto.subtle.exportKey("spki", keys.publicKey));
const privateKeyPkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey));
const issued = await issuer.issue({
  attestedPublicKeySpki: publicKeySpki,
  installationId: "issuer-smoke-test",
});
if (process.env.TARVIS_SMOKE_CERTIFICATE_OUTPUT_PATH) {
  await writeFile(
    process.env.TARVIS_SMOKE_CERTIFICATE_OUTPUT_PATH,
    issued.certificatePem,
    { encoding: "utf8", mode: 0o600 },
  );
}
const privateKeyPem = [
  "-----BEGIN PRIVATE KEY-----",
  privateKeyPkcs8.toString("base64").match(/.{1,64}/g).join("\n"),
  "-----END PRIVATE KEY-----",
  "",
].join("\n");
const body = JSON.stringify({
  grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
  subject_token_type: "urn:openai:params:oauth:token-type:x509",
  identity_provider_id: identityProviderId,
  service_account_id: serviceAccountId,
});

const result = await new Promise((resolve, reject) => {
  const outgoing = request(
    "https://mtls.auth.openai.com/oauth/token",
    {
      method: "POST",
      cert: issued.certificatePem,
      key: privateKeyPem,
      headers: {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json; charset=utf-8",
      },
    },
    (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (incoming.statusCode === 200) {
          const parsed = JSON.parse(responseBody);
          return resolve({
            status: incoming.statusCode,
            tokenType: parsed.token_type,
            expiresIn: parsed.expires_in,
          });
        }
        const parsed = JSON.parse(responseBody);
        resolve({
          status: incoming.statusCode,
          error: parsed.error?.code ?? parsed.error ?? "unknown_error",
          message: parsed.error?.message ?? parsed.error_description ?? "Token exchange failed.",
        });
      });
    },
  );
  outgoing.on("error", reject);
  outgoing.end(body);
});

process.stdout.write(`${JSON.stringify(result)}\n`);
