import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeStore } from "../src/challengeStore.js";

test("a challenge is one-time and installation-bound", () => {
  let now = 1_000;
  const store = new ChallengeStore({
    ttlMs: 60_000,
    maximumEntries: 5,
    now: () => now,
  });
  const first = store.create("installation_1234567890");
  const consumed = store.consume(first.challengeId, "installation_1234567890");
  assert.equal(consumed.challenge.toString("base64"), first.challengeBase64);
  assert.throws(
    () => store.consume(first.challengeId, "installation_1234567890"),
    (error) => error.status === 410,
  );
  now += 70_000;
  const expired = store.create("installation_1234567890");
  now += 70_000;
  assert.throws(
    () => store.consume(expired.challengeId, "installation_1234567890"),
    (error) => error.status === 410,
  );
});
