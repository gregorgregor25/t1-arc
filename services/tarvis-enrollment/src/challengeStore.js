import { randomBytes, randomUUID } from "node:crypto";
import { HttpError } from "./errors.js";

const INSTALLATION_ID = /^[A-Za-z0-9_-]{16,128}$/;

export function validateInstallationId(value) {
  if (typeof value !== "string" || !INSTALLATION_ID.test(value)) {
    throw new HttpError(
      400,
      "invalid_installation",
      "The installation identifier is invalid.",
    );
  }
  return value;
}

export class ChallengeStore {
  constructor({ ttlMs, maximumEntries, now = () => Date.now() }) {
    this.ttlMs = ttlMs;
    this.maximumEntries = maximumEntries;
    this.now = now;
    this.entries = new Map();
  }

  create(installationId) {
    this.sweep();
    if (this.entries.size >= this.maximumEntries) {
      throw new HttpError(
        429,
        "challenge_capacity",
        "The enrolment service is temporarily busy.",
      );
    }
    const createdAtMs = this.now();
    const entry = {
      id: randomUUID(),
      installationId: validateInstallationId(installationId),
      challenge: randomBytes(32),
      createdAtMs,
      expiresAtMs: createdAtMs + this.ttlMs,
    };
    this.entries.set(entry.id, entry);
    return {
      challengeId: entry.id,
      challengeBase64: entry.challenge.toString("base64"),
      expiresAtMs: entry.expiresAtMs,
    };
  }

  consume(challengeId, installationId) {
    this.sweep();
    if (typeof challengeId !== "string" || challengeId.length > 80) {
      throw new HttpError(400, "invalid_challenge", "The enrolment challenge is invalid.");
    }
    const entry = this.entries.get(challengeId);
    if (!entry || entry.installationId !== validateInstallationId(installationId)) {
      throw new HttpError(410, "expired_challenge", "The enrolment challenge has expired.");
    }
    this.entries.delete(challengeId);
    if (entry.expiresAtMs <= this.now()) {
      throw new HttpError(410, "expired_challenge", "The enrolment challenge has expired.");
    }
    return entry;
  }

  sweep() {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(id);
    }
  }
}
