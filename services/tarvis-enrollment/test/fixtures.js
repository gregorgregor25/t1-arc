import "reflect-metadata";
import { randomBytes, webcrypto, X509Certificate as NodeCertificate } from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto);

const ALG = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const ATTESTATION_OID = "1.3.6.1.4.1.11129.2.1.17";

function lengthBytes(length) {
  if (length < 128) return Buffer.from([length]);
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, content) {
  const value = Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(value.length), value]);
}

function highTag(tagClass, constructed, number, content) {
  const encodedNumber = [];
  let remaining = number;
  do {
    encodedNumber.unshift(remaining & 0x7f);
    remaining = Math.floor(remaining / 128);
  } while (remaining > 0);
  for (let index = 0; index < encodedNumber.length - 1; index += 1) {
    encodedNumber[index] |= 0x80;
  }
  const value = Buffer.from(content);
  return Buffer.concat([
    Buffer.from([(tagClass << 6) | (constructed ? 0x20 : 0) | 0x1f, ...encodedNumber]),
    lengthBytes(value.length),
    value,
  ]);
}

function integer(value) {
  return der(0x02, [value]);
}

function enumerated(value) {
  return der(0x0a, [value]);
}

export function androidKeyDescription(
  challenge,
  securityLevel = 1,
  packageName = "io.github.gregorgregor25.t1arc",
  signingCertificateDigest = Buffer.alloc(32, 0x5a),
) {
  const applicationId = der(
    0x30,
    Buffer.concat([
      der(0x31, der(0x30, Buffer.concat([der(0x04, Buffer.from(packageName)), integer(1)]))),
      der(0x31, der(0x04, signingCertificateDigest)),
    ]),
  );
  const softwareEnforced = der(
    0x30,
    highTag(2, true, 709, der(0x04, applicationId)),
  );
  const rootOfTrust = der(
    0x30,
    Buffer.concat([
      der(0x04, Buffer.alloc(32, 0x33)),
      der(0x01, [0xff]),
      enumerated(0),
      der(0x04, Buffer.alloc(32, 0x44)),
    ]),
  );
  const teeEnforced = der(0x30, highTag(2, true, 704, rootOfTrust));
  return der(
    0x30,
    Buffer.concat([
      integer(3),
      enumerated(securityLevel),
      integer(4),
      enumerated(securityLevel),
      der(0x04, challenge),
      der(0x04, []),
      softwareEnforced,
      teeEnforced,
    ]),
  );
}

export async function syntheticAttestation(
  challenge,
  securityLevel = 1,
  packageName = "io.github.gregorgregor25.t1arc",
  signingCertificateDigest = Buffer.alloc(32, 0x5a),
) {
  const rootKeys = await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const root = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(16).toString("hex"),
    name: "CN=Synthetic Android Attestation Root",
    keys: rootKeys,
    signingAlgorithm: ALG,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 60 * 60_000),
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign, true),
      await x509.SubjectKeyIdentifierExtension.create(rootKeys.publicKey),
    ],
  });
  const leafKeys = await webcrypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: randomBytes(16).toString("hex"),
    subject: "CN=Synthetic Android Attested Key",
    issuer: root.subject,
    publicKey: leafKeys.publicKey,
    signingKey: rootKeys.privateKey,
    signingAlgorithm: ALG,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 60 * 60_000),
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.Extension(
        ATTESTATION_OID,
        false,
        androidKeyDescription(
          challenge,
          securityLevel,
          packageName,
          signingCertificateDigest,
        ),
      ),
    ],
  });
  const rootNode = new NodeCertificate(Buffer.from(root.rawData));
  return {
    leafKeys,
    chainBase64: [leaf.toString("base64"), root.toString("base64")],
    rootFingerprintSha256: rootNode.fingerprint256.replaceAll(":", "").toUpperCase(),
    signingCertificateDigest: signingCertificateDigest.toString("hex").toUpperCase(),
  };
}
