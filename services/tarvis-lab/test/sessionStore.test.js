import assert from "node:assert/strict";
import test from "node:test";
import { SessionStore } from "../src/sessionStore.js";
import { emptySnapshot } from "./fixtures.js";

test("expires and closes idle in-memory sessions", async () => {
  let now = 1_000;
  const store = new SessionStore({
    ttlMs: 100,
    clock: () => now,
    cleanupIntervalMs: 60_000,
  });
  try {
    const session = store.create(emptySnapshot());
    assert.equal(store.size, 1);
    await store.withSession(session.id, async (dataset) => {
      assert.equal(dataset.description.schemaVersion, 1);
    });
    now += 101;
    store.cleanup();
    assert.equal(store.size, 0);
    await assert.rejects(
      store.withSession(session.id, async () => undefined),
      /expired or does not exist/u,
    );
  } finally {
    store.close();
  }
});
