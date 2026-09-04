import { randomUUID } from "node:crypto";
import { createDataset } from "./schema.js";
import { executeReadonlyQuery } from "./sql.js";
import { HttpError } from "./errors.js";

export class SessionStore {
  #sessions = new Map();
  #ttlMs;
  #clock;
  #cleanupTimer;

  constructor({ ttlMs, clock = Date.now, cleanupIntervalMs = undefined }) {
    this.#ttlMs = ttlMs;
    this.#clock = clock;
    const interval = cleanupIntervalMs ?? Math.min(60_000, Math.max(10_000, Math.floor(ttlMs / 2)));
    this.#cleanupTimer = setInterval(() => this.cleanup(), interval);
    this.#cleanupTimer.unref?.();
  }

  create(snapshot) {
    const rawDataset = createDataset(snapshot);
    const now = this.#clock();
    const id = randomUUID();
    const session = {
      id,
      dataset: {
        description: rawDataset.description,
        query: (sql) => executeReadonlyQuery(rawDataset.database, sql),
      },
      database: rawDataset.database,
      activeRequests: 0,
      createdAtMs: now,
      expiresAtMs: now + this.#ttlMs,
    };
    this.#sessions.set(id, session);
    return {
      id,
      createdAtMs: session.createdAtMs,
      expiresAtMs: session.expiresAtMs,
      description: rawDataset.description,
    };
  }

  async withSession(id, task) {
    const session = this.#sessions.get(id);
    const now = this.#clock();
    if (!session || (session.activeRequests === 0 && session.expiresAtMs <= now)) {
      if (session) {
        this.#closeSession(session);
      }
      throw new HttpError(404, "session_not_found", "That TARV1S lab session has expired or does not exist.");
    }

    session.activeRequests += 1;
    session.expiresAtMs = now + this.#ttlMs;
    try {
      return await task(session.dataset);
    } finally {
      session.activeRequests -= 1;
      session.expiresAtMs = this.#clock() + this.#ttlMs;
    }
  }

  delete(id) {
    const session = this.#sessions.get(id);
    if (!session) {
      return false;
    }
    if (session.activeRequests > 0) {
      throw new HttpError(409, "session_busy", "That TARV1S lab session is currently analysing a question.");
    }
    this.#closeSession(session);
    return true;
  }

  cleanup() {
    const now = this.#clock();
    for (const session of this.#sessions.values()) {
      if (session.activeRequests === 0 && session.expiresAtMs <= now) {
        this.#closeSession(session);
      }
    }
  }

  close() {
    clearInterval(this.#cleanupTimer);
    for (const session of [...this.#sessions.values()]) {
      if (session.activeRequests === 0) {
        this.#closeSession(session);
      }
    }
  }

  get size() {
    return this.#sessions.size;
  }

  #closeSession(session) {
    this.#sessions.delete(session.id);
    session.database.close();
  }
}
