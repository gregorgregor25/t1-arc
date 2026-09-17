import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { ChallengeStore, validateInstallationId } from "./challengeStore.js";
import { HttpError } from "./errors.js";
import { validateAttestationChain } from "./attestation.js";

const MAX_BODY_BYTES = 196 * 1024;
const HEALTH_PATH = "/poc/v1/health";
const CHALLENGE_PATH = "/poc/v1/enrollment/challenges";
const CERTIFICATE_PATH = "/poc/v1/enrollment/certificates";

function json(response, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": encoded.length,
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(encoded);
}

function authorize(request, expectedToken) {
  const value = request.headers.authorization;
  const prefix = "Bearer ";
  if (typeof value !== "string" || !value.startsWith(prefix)) {
    throw new HttpError(401, "unauthorized", "Enrolment authorization is required.");
  }
  const supplied = Buffer.from(value.slice(prefix.length));
  const expected = Buffer.from(expectedToken);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new HttpError(401, "unauthorized", "Enrolment authorization is required.");
  }
}

async function readStrictJson(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") {
    throw new HttpError(415, "content_type", "Content-Type must be application/json.");
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    byteLength += chunk.length;
    if (byteLength > MAX_BODY_BYTES) {
      throw new HttpError(413, "body_too_large", "The enrolment request is too large.");
    }
    chunks.push(chunk);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "The enrolment request is invalid.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new HttpError(400, "invalid_json", "The enrolment request is invalid.");
  }
  return result;
}

function requireExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new HttpError(400, "unexpected_fields", "The enrolment request contains unexpected fields.");
  }
}

export function createEnrollmentServer({ config, certificateIssuer }) {
  const challenges = new ChallengeStore({
    ttlMs: config.challengeTtlMs,
    maximumEntries: config.maximumChallenges,
  });
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://enrollment.invalid");
      if (request.method === "GET" && url.pathname === HEALTH_PATH) {
        return json(response, 200, { status: "ok", contentPath: false });
      }
      authorize(request, config.bearerToken);
      if (request.method === "POST" && url.pathname === CHALLENGE_PATH) {
        const body = await readStrictJson(request);
        requireExactKeys(body, ["installationId"]);
        return json(response, 201, challenges.create(body.installationId));
      }
      if (request.method === "POST" && url.pathname === CERTIFICATE_PATH) {
        const body = await readStrictJson(request);
        requireExactKeys(body, [
          "attestationChainDerBase64",
          "challengeId",
          "installationId",
        ]);
        const installationId = validateInstallationId(body.installationId);
        const challenge = challenges.consume(body.challengeId, installationId);
        const attestation = validateAttestationChain(
          body.attestationChainDerBase64,
          challenge.challenge,
          {
            allowedRootFingerprints: config.allowedAttestationRootFingerprints,
            allowedAndroidPackages: config.allowedAndroidPackages,
            allowedAndroidSigningCertificateDigests:
              config.allowedAndroidSigningCertificateDigests,
          },
        );
        const issued = await certificateIssuer.issue({
          attestedPublicKeySpki: attestation.leaf.publicKey.export({
            type: "spki",
            format: "der",
          }),
          installationId,
        });
        return json(response, 201, {
          certificateChainPem: [issued.certificatePem],
          expiresAtMs: issued.expiresAtMs,
          attestationSecurityLevel: attestation.securityLevel,
          attestationRootFingerprintSha256: attestation.rootFingerprintSha256,
        });
      }
      throw new HttpError(404, "not_found", "The enrolment route does not exist.");
    } catch (error) {
      if (error instanceof HttpError) {
        return json(response, error.status, {
          error: { code: error.code, message: error.message },
        });
      }
      return json(response, 500, {
        error: {
          code: "internal_error",
          message: "The enrolment request could not be completed.",
        },
      });
    }
  });
}
