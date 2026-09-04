import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApiKeyStore } from "../src/apiKeyStore.js";

test("persists and reloads the remembered model key in a private file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "t1arc-key-store-"));
  const filePath = path.join(directory, "openai-api-key");
  try {
    const store = await ApiKeyStore.open({ filePath });
    assert.equal(store.key, null);

    await store.remember("test-key-one");
    assert.equal(store.key, "test-key-one");
    assert.equal(await readFile(filePath, "utf8"), "test-key-one\n");
    if (process.platform !== "win32") {
      assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    }

    const reopened = await ApiKeyStore.open({ filePath });
    assert.equal(reopened.key, "test-key-one");
    await reopened.remember("test-key-two");
    assert.equal(await readFile(filePath, "utf8"), "test-key-two\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
