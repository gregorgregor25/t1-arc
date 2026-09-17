import "reflect-metadata";
import { createPrivateKey, randomBytes, webcrypto, X509Certificate as NodeCertificate } from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto);

const SIGNING_ALGORITHM = {
  name: "ECDSA",
  namedCurve: "P-256",
  hash: "SHA-256",
};

function certificateExpiry(certificate) {
  return new Date(new NodeCertificate(Buffer.from(certificate.rawData)).validTo).getTime();
}

export class CertificateIssuer {
  static async create({ certificatePem, privateKeyPem, ttlMs, now = () => Date.now() }) {
    const caCertificate = new x509.X509Certificate(certificatePem);
    const privateDer = createPrivateKey(privateKeyPem).export({
      format: "der",
      type: "pkcs8",
    });
    const signingKey = await webcrypto.subtle.importKey(
      "pkcs8",
      privateDer,
      SIGNING_ALGORITHM,
      false,
      ["sign"],
    );
    return new CertificateIssuer({ caCertificate, signingKey, ttlMs, now });
  }

  constructor({ caCertificate, signingKey, ttlMs, now }) {
    this.caCertificate = caCertificate;
    this.signingKey = signingKey;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async issue({ attestedPublicKeySpki, installationId }) {
    const publicKey = await webcrypto.subtle.importKey(
      "spki",
      attestedPublicKeySpki,
      SIGNING_ALGORITHM,
      true,
      ["verify"],
    );
    const nowMs = this.now();
    const notBefore = new Date(nowMs - 30_000);
    const desiredExpiry = nowMs + this.ttlMs;
    const caExpiry = certificateExpiry(this.caCertificate);
    const expiresAtMs = Math.min(desiredExpiry, caExpiry - 1_000);
    if (expiresAtMs <= nowMs) throw new Error("The enrolment CA certificate has expired.");
    const installationHash = Buffer.from(
      await webcrypto.subtle.digest("SHA-256", Buffer.from(installationId, "utf8")),
    )
      .toString("hex")
      .slice(0, 24);
    const extensions = [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth], false),
      await x509.SubjectKeyIdentifierExtension.create(publicKey),
      await x509.AuthorityKeyIdentifierExtension.create(this.caCertificate.publicKey),
      new x509.SubjectAlternativeNameExtension([
        { type: "url", value: `urn:t1arc:install:${installationHash}` },
      ]),
    ];
    const certificate = await x509.X509CertificateGenerator.create({
      serialNumber: randomBytes(16).toString("hex"),
      subject: "CN=t1arc-android,OU=TarvisPOC",
      // Preserve the CA's original ASN.1 Name encoding. Re-parsing the display
      // string can change UTF8String attributes to PrintableString, which makes
      // strict path builders treat the leaf issuer and root subject as different.
      issuer: this.caCertificate.subjectName,
      notBefore,
      notAfter: new Date(expiresAtMs),
      publicKey,
      signingKey: this.signingKey,
      signingAlgorithm: SIGNING_ALGORITHM,
      extensions,
    });
    return {
      certificatePem: certificate.toString("pem"),
      expiresAtMs,
    };
  }
}

export async function createDevelopmentCa({ commonName = "T1 Arc TARV1S POC CA", days = 30 } = {}) {
  const keys = await webcrypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  const now = Date.now();
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(16).toString("hex"),
    name: `CN=${commonName},O=T1 Arc Development`,
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + days * 24 * 60 * 60_000),
    signingAlgorithm: SIGNING_ALGORITHM,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const privateKeyDer = Buffer.from(
    await webcrypto.subtle.exportKey("pkcs8", keys.privateKey),
  );
  const privateKeyPem = [
    "-----BEGIN PRIVATE KEY-----",
    privateKeyDer.toString("base64").match(/.{1,64}/g).join("\n"),
    "-----END PRIVATE KEY-----",
    "",
  ].join("\n");
  return {
    certificatePem: certificate.toString("pem"),
    privateKeyPem,
  };
}
