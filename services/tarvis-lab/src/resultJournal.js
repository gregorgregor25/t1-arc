import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

function datasetIdentity(description = {}) {
  return {
    schemaVersion: description.schemaVersion ?? null,
    generatedAtMs: description.generatedAtMs ?? null,
    timezone: description.timezone ?? null,
    totalRows: description.totalRows ?? null,
    tableCounts: Object.fromEntries(
      Object.entries(description.tables ?? {})
        .filter(([, table]) => Number.isFinite(table?.rowCount))
        .map(([name, table]) => [name, table.rowCount]),
    ),
  };
}

export class ResultJournal {
  #filePath;
  #clock;
  #writes = Promise.resolve();

  constructor({ filePath, clock = Date.now }) {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("A result journal path is required.");
    }
    this.#filePath = filePath;
    this.#clock = clock;
  }

  recordCompleted({ request, result, dataset }) {
    return this.#append({
      journalSchemaVersion: 1,
      id: randomUUID(),
      recordedAtMs: this.#clock(),
      status: "completed",
      request: {
        turnId: request.turnId,
        question: request.question,
        history: request.history,
        asOfMs: request.asOfMs,
        model: request.model,
      },
      dataset: datasetIdentity(dataset.description),
      result,
    });
  }

  recordFailed({ request, error, dataset }) {
    return this.#append({
      journalSchemaVersion: 1,
      id: randomUUID(),
      recordedAtMs: this.#clock(),
      status: "failed",
      request: {
        turnId: request.turnId,
        question: request.question,
        history: request.history,
        asOfMs: request.asOfMs,
        model: request.model,
      },
      dataset: datasetIdentity(dataset.description),
      error: {
        code: typeof error?.code === "string" ? error.code : "analysis_failed",
        message: typeof error?.message === "string" ? error.message : "The analysis failed.",
      },
    });
  }

  #append(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    const write = this.#writes.then(async () => {
      await mkdir(path.dirname(this.#filePath), { recursive: true, mode: 0o700 });
      await appendFile(this.#filePath, line, {
        encoding: "utf8",
        flag: "a",
        mode: 0o600,
      });
    });
    this.#writes = write.catch(() => {});
    return write;
  }
}
