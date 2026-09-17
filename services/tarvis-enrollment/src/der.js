const MAX_DER_DEPTH = 20;
const ANDROID_ATTESTATION_OID_DER = Buffer.from([
  0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x02, 0x01, 0x11,
]);

export function readDerNode(buffer, offset = 0, end = buffer.length, depth = 0) {
  if (!Buffer.isBuffer(buffer) || depth > MAX_DER_DEPTH || offset < 0 || offset >= end) {
    throw new Error("Invalid DER object.");
  }
  const tag = buffer[offset];
  const tagClass = tag >>> 6;
  const constructed = (tag & 0x20) !== 0;
  let tagNumber = tag & 0x1f;
  let cursor = offset + 1;
  if (tagNumber === 0x1f) {
    tagNumber = 0;
    let tagBytes = 0;
    while (true) {
      if (cursor >= end || tagBytes >= 5) throw new Error("Invalid DER tag number.");
      const value = buffer[cursor++];
      if (tagBytes === 0 && (value & 0x7f) === 0) {
        throw new Error("Non-canonical DER tag number.");
      }
      tagNumber = tagNumber * 128 + (value & 0x7f);
      tagBytes += 1;
      if ((value & 0x80) === 0) break;
    }
    if (tagNumber < 31) throw new Error("Non-canonical DER tag number.");
  }
  if (cursor >= end) throw new Error("Truncated DER object.");
  const firstLength = buffer[cursor++];
  let length;
  if ((firstLength & 0x80) === 0) {
    length = firstLength;
  } else {
    const lengthBytes = firstLength & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4 || cursor + lengthBytes > end) {
      throw new Error("Invalid DER length.");
    }
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      length = length * 256 + buffer[cursor++];
    }
    if (length < 128) throw new Error("Non-canonical DER length.");
  }
  const contentStart = cursor;
  const contentEnd = contentStart + length;
  if (contentEnd > end) throw new Error("Truncated DER content.");
  return {
    tag,
    tagClass,
    tagNumber,
    constructed,
    offset,
    headerLength: contentStart - offset,
    contentStart,
    contentEnd,
    end: contentEnd,
    content: buffer.subarray(contentStart, contentEnd),
  };
}

export function readDerChildren(buffer, node, depth = 0) {
  if (!node.constructed) throw new Error("The DER value is not constructed.");
  const children = [];
  let cursor = node.contentStart;
  while (cursor < node.contentEnd) {
    const child = readDerNode(buffer, cursor, node.contentEnd, depth + 1);
    children.push(child);
    cursor = child.end;
  }
  if (cursor !== node.contentEnd) throw new Error("Invalid DER child boundary.");
  return children;
}

function onlyChild(buffer, node) {
  const children = readDerChildren(buffer, node);
  if (children.length !== 1) throw new Error("The DER explicit value is malformed.");
  return children[0];
}

function integerValue(node) {
  if ((node.tag !== 0x02 && node.tag !== 0x0a) || node.content.length < 1 || node.content.length > 8) {
    throw new Error("The DER integer is invalid.");
  }
  if ((node.content[0] & 0x80) !== 0) throw new Error("Negative DER integers are not supported.");
  let value = 0;
  for (const byte of node.content) value = value * 256 + byte;
  if (!Number.isSafeInteger(value)) throw new Error("The DER integer is too large.");
  return value;
}

function contextValue(buffer, authorizationList, number) {
  return readDerChildren(buffer, authorizationList).find(
    (node) => node.tagClass === 2 && node.tagNumber === number,
  );
}

function parseAttestationApplicationId(buffer, authorizationList) {
  const context = contextValue(buffer, authorizationList, 709);
  if (!context) return null;
  const octet = onlyChild(buffer, context);
  if (octet.tag !== 0x04 || octet.content.length > 16 * 1024) {
    throw new Error("The attestation application identifier is invalid.");
  }
  const encoded = octet.content;
  const root = readDerNode(encoded);
  if (root.tag !== 0x30 || root.end !== encoded.length) {
    throw new Error("The attestation application identifier is malformed.");
  }
  const [packagesNode, digestsNode, ...extra] = readDerChildren(encoded, root);
  if (!packagesNode || !digestsNode || extra.length || packagesNode.tag !== 0x31 || digestsNode.tag !== 0x31) {
    throw new Error("The attestation application identifier is incomplete.");
  }
  const packages = readDerChildren(encoded, packagesNode).map((packageNode) => {
    if (packageNode.tag !== 0x30) throw new Error("The attested package is invalid.");
    const [name, version, ...packageExtra] = readDerChildren(encoded, packageNode);
    if (!name || !version || packageExtra.length || name.tag !== 0x04 || name.content.length < 1 || name.content.length > 255) {
      throw new Error("The attested package is invalid.");
    }
    const packageName = Buffer.from(name.content).toString("utf8");
    if (!/^[A-Za-z0-9_.]{3,255}$/.test(packageName)) {
      throw new Error("The attested package name is invalid.");
    }
    return { packageName, version: integerValue(version) };
  });
  const signingCertificateDigests = readDerChildren(encoded, digestsNode).map((digest) => {
    if (digest.tag !== 0x04 || digest.content.length !== 32) {
      throw new Error("The attested signing-certificate digest is invalid.");
    }
    return Buffer.from(digest.content).toString("hex").toUpperCase();
  });
  if (!packages.length || !signingCertificateDigests.length) {
    throw new Error("The attestation application identifier is empty.");
  }
  return { packages, signingCertificateDigests };
}

function parseRootOfTrust(buffer, authorizationList) {
  const context = contextValue(buffer, authorizationList, 704);
  if (!context) throw new Error("The hardware root of trust is missing.");
  const sequence = onlyChild(buffer, context);
  if (sequence.tag !== 0x30) throw new Error("The hardware root of trust is malformed.");
  const children = readDerChildren(buffer, sequence);
  if (children.length < 3 || children[0].tag !== 0x04 || children[1].tag !== 0x01 || children[2].tag !== 0x0a) {
    throw new Error("The hardware root of trust is incomplete.");
  }
  const deviceLocked = children[1].content.length === 1 && children[1].content[0] !== 0;
  return {
    deviceLocked,
    verifiedBootState: integerValue(children[2]),
  };
}

function findAttestationExtensionValue(certificateDer) {
  let position = certificateDer.indexOf(ANDROID_ATTESTATION_OID_DER);
  while (position >= 0) {
    let cursor = position + ANDROID_ATTESTATION_OID_DER.length;
    let next = readDerNode(certificateDer, cursor);
    if (next.tag === 0x01) {
      cursor = next.end;
      next = readDerNode(certificateDer, cursor);
    }
    if (next.tag === 0x04) return next.content;
    position = certificateDer.indexOf(ANDROID_ATTESTATION_OID_DER, position + 1);
  }
  throw new Error("The Android key-attestation extension is missing.");
}

export function parseAndroidKeyDescription(certificateDer) {
  const extensionValue = findAttestationExtensionValue(certificateDer);
  const root = readDerNode(extensionValue);
  if (root.tag !== 0x30 || root.end !== extensionValue.length) {
    throw new Error("The Android key-attestation extension is malformed.");
  }
  const children = readDerChildren(extensionValue, root);
  if (children.length < 8 || children[1].tag !== 0x0a || children[3].tag !== 0x0a) {
    throw new Error("The Android key-attestation description is incomplete.");
  }
  if (children[4].tag !== 0x04 || children[4].content.length > 128) {
    throw new Error("The Android key-attestation challenge is invalid.");
  }
  if (children[6].tag !== 0x30 || children[7].tag !== 0x30) {
    throw new Error("The Android key authorization lists are invalid.");
  }
  const application =
    parseAttestationApplicationId(extensionValue, children[6]) ??
    parseAttestationApplicationId(extensionValue, children[7]);
  if (!application) {
    throw new Error("The attested Android application identity is missing.");
  }
  const rootOfTrust = parseRootOfTrust(extensionValue, children[7]);
  return {
    attestationSecurityLevel: children[1].content.at(-1),
    keymasterSecurityLevel: children[3].content.at(-1),
    challenge: Buffer.from(children[4].content),
    ...application,
    ...rootOfTrust,
  };
}
