import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ResultJournal } from "../src/resultJournal.js";

test("journals the complete reproducible run without credentials", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tarvis-journal-test-"));
  const filePath = path.join(directory, "runs.jsonl");
  try {
    const journal = new ResultJournal({ filePath, clock: () => 1234 });
    await journal.recordCompleted({
      request: {
        turnId: "turn-1",
        question: "What was my average?",
        history: [],
        asOfMs: 1200,
        model: "gpt-5.6-luna",
      },
      dataset: {
        description: {
          schemaVersion: "raw-backup-v15",
          generatedAtMs: 1000,
          timezone: "Europe/London",
          totalRows: 1,
          tables: { glucose_readings: { rowCount: 1 } },
        },
      },
      result: {
        answer: {
          headline: "Average glucose",
          answer: "6.2 mmol/L",
          confidence: "high",
          evidenceIds: ["q1"],
          limitations: [],
        },
        evidence: [{ id: "q1", sql: "SELECT AVG(mmol_l) FROM glucose_readings" }],
        metrics: { model: "gpt-5.6-luna", totalTokens: 42 },
      },
    });
    const text = readFileSync(filePath, "utf8");
    const entry = JSON.parse(text.trim());
    assert.equal(entry.recordedAtMs, 1234);
    assert.equal(entry.request.question, "What was my average?");
    assert.equal(entry.result.evidence[0].id, "q1");
    assert.equal(entry.dataset.tableCounts.glucose_readings, 1);
    assert.doesNotMatch(text, /api.?key|bearer|service.?token/iu);
    if (process.platform !== "win32") {
      assert.equal(statSync(filePath).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
