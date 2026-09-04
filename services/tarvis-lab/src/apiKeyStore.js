import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

function cleanKey(value) {
  const key = value?.trim();
  if (!key || key.length > 512) return null;
  return key;
}

export class ApiKeyStore {
  #filePath;
  #key;
  #writes = Promise.resolve();

  constructor({ filePath = null, initialKey = null }) {
    this.#filePath = filePath;
    this.#key = cleanKey(initialKey);
  }

  static async open(options) {
    const store = new ApiKeyStore(options);
    if (!store.#key && store.#filePath) {
      try {
        const metadata = await lstat(store.#filePath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw new Error("The remembered OpenAI key path is not a regular file.");
        }
        if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
          throw new Error("The remembered OpenAI key has an unexpected owner.");
        }
        if (process.platform !== "win32") {
          await chmod(store.#filePath, 0o600);
        }
        store.#key = cleanKey(await readFile(store.#filePath, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw new Error("The remembered OpenAI key could not be read.", { cause: error });
        }
      }
    }
    return store;
  }

  get key() {
    return this.#key;
  }

  async remember(value) {
    const key = cleanKey(value);
    if (!key) throw new Error("The OpenAI key cannot be remembered safely.");

    const write = this.#writes.then(() => this.#rememberKey(key));
    this.#writes = write.catch(() => {});
    return write;
  }

  async #rememberKey(key) {
    if (!this.#filePath) {
      this.#key = key;
      return;
    }
    if (key === this.#key) return;

    const directory = path.dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(directory, `.openai-key-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${key}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, this.#filePath);
      await chmod(this.#filePath, 0o600);
      this.#key = key;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw new Error("The OpenAI key could not be remembered safely.", { cause: error });
    }
  }
}
