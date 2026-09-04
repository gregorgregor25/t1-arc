import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  askTarvisAnalystLab,
  clearTarvisAnalystLabSessionForTests,
  isTarvisAnalystLabEnabled,
  labEvidenceReferences,
} from "../services/tarvis-lab/client/experimentalBackendClient";
import type { TarvisLabSnapshot } from "../services/tarvis-lab/client/experimentalDataset";

const RANGE = { start: 1_000, end: 9_000 };
const originalUrl = process.env.EXPO_PUBLIC_TARVIS_LAB_URL;
const originalEnabled = process.env.EXPO_PUBLIC_TARVIS_LAB_ENABLED;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function snapshot(): TarvisLabSnapshot {
  return {
    schemaVersion: 1,
    timezone: "Europe/London",
    generatedAtMs: 8_000,
    range: { startMs: RANGE.start, endMs: RANGE.end },
    tables: {
      glucose_readings: [],
      glucose_observation_intervals: [],
      basal_deliveries: [],
      basal_daily_segments: [],
      bolus_deliveries: [],
      insulin_daily_totals: [],
      pump_states: [],
      context_events: [],
      meal_items: [],
      strength_workouts: [],
      strength_exercises: [],
      strength_sets: [],
      health_metrics: [],
      daily_health_metrics: [],
      source_statuses: [],
    },
  };
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_TARVIS_LAB_ENABLED = "1";
  process.env.EXPO_PUBLIC_TARVIS_LAB_URL = "https://analyst.test/";
  clearTarvisAnalystLabSessionForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearTarvisAnalystLabSessionForTests();
  if (originalUrl === undefined) {
    delete process.env.EXPO_PUBLIC_TARVIS_LAB_URL;
  } else {
    process.env.EXPO_PUBLIC_TARVIS_LAB_URL = originalUrl;
  }
  if (originalEnabled === undefined) {
    delete process.env.EXPO_PUBLIC_TARVIS_LAB_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_TARVIS_LAB_ENABLED = originalEnabled;
  }
});

describe("Tarv1s Analyst Lab backend client", () => {
  it("only enables an explicitly configured HTTPS endpoint", () => {
    process.env.EXPO_PUBLIC_TARVIS_LAB_ENABLED = "0";
    expect(isTarvisAnalystLabEnabled()).toBe(false);

    process.env.EXPO_PUBLIC_TARVIS_LAB_ENABLED = "1";
    process.env.EXPO_PUBLIC_TARVIS_LAB_URL = "http://analyst.test";
    expect(isTarvisAnalystLabEnabled()).toBe(false);

    process.env.EXPO_PUBLIC_TARVIS_LAB_URL = "not a URL";
    expect(isTarvisAnalystLabEnabled()).toBe(false);

    process.env.EXPO_PUBLIC_TARVIS_LAB_URL = "https://analyst.test/dev/";
    expect(isTarvisAnalystLabEnabled()).toBe(true);
  });

  it("maps SQL evidence to bounded, inspectable app evidence", () => {
    const references = labEvidenceReferences(
      [
        {
          id: "query:glucose",
          purpose: "Find the highest glucose",
          sql: "SELECT id, timestamp_ms, mmol_l FROM glucose_readings",
          columns: ["id", "timestamp_ms", "mmol_l"],
          rowCount: 9,
          preview: Array.from({ length: 10 }, (_, index) => ({
            id: `glucose:${index + 1}`,
            timestamp_ms: 2_000 + index,
            mmol_l: 10 + index / 10,
          })),
          truncated: true,
        },
        {
          id: "query:summary",
          purpose: "Summarise totals",
          sql: "SELECT 1",
          columns: ["total"],
          rowCount: 1,
          preview: [{ total: 42 }],
          truncated: false,
        },
      ],
      RANGE,
    );

    expect(references.get("query:glucose")).toMatchObject({
      label: "Find the highest glucose",
      range: RANGE,
      recordIds: [
        "glucose:1",
        "glucose:2",
        "glucose:3",
        "glucose:4",
        "glucose:5",
        "glucose:6",
        "glucose:7",
        "glucose:8",
      ],
    });
    expect(references.get("query:glucose")?.description).toContain("shortened");
    expect(references.get("query:glucose")?.examples).toHaveLength(8);
    expect(references.get("query:glucose")?.examples[0]).toMatchObject({
      id: "glucose:1",
      timestamp: 2_000,
      sourceId: "tarvis-analyst-lab",
      secondary: "Read-only Analyst Lab result",
    });
    expect(references.get("query:summary")?.examples[0]).toMatchObject({
      id: "query:summary:result:1",
      timestamp: RANGE.start,
      primary: "total: 42",
    });
  });

  it("validates the response, preserves verified evidence IDs, and reports token metrics", async () => {
    const privateHistoryText = "Private local reading was 3.2 mmol/L at 02:15.";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ sessionId: "session:1", expiresAtMs: Date.now() + 600_000 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          answer: {
            headline: "  Yesterday's totals  ",
            answer: "  You logged 120 g carbohydrate and 18 U bolus.  ",
            confidence: "high",
            evidenceIds: ["query:1", "query:1"],
            limitations: ["  Imported records only.  ", ""],
          },
          evidence: [
            {
              id: "query:1",
              purpose: "Compare carbohydrate with bolus",
              sql: "SELECT 120 AS carbs, 18 AS bolus",
              columns: ["carbs", "bolus"],
              rowCount: 1.9,
              preview: [
                { id: "answer:1", timestamp_ms: 7_000, carbs: 120, bolus: 18 },
                { id: "discard-nested", nested: { unsafe: true } },
              ],
              truncated: false,
            },
          ],
          metrics: {
            model: "gpt-test",
            estimatedCostUsd: 0.00042,
            inputTokens: 100,
            outputTokens: 40,
            totalTokens: 140,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await askTarvisAnalystLab({
      apiKey: "test-key",
      asOfMs: 8_000,
      history: [
        { role: "user", text: "What did we discuss before?" },
        {
          role: "assistant",
          text: privateHistoryText,
          modelSharing: "local-only",
        },
      ],
      loadSnapshot: async () => snapshot(),
      question: "Carbs versus bolus yesterday?",
      range: RANGE,
    });

    expect(result.answer).toEqual({
      headline: "Yesterday's totals",
      answer: "You logged 120 g carbohydrate and 18 U bolus.",
      confidence: "high",
      evidenceIds: ["query:1"],
      limitations: ["Imported records only."],
    });
    expect(result.requestMetrics).toMatchObject({
      model: "gpt-test",
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      estimatedCostUsd: 0.00042,
    });
    expect(result.evidenceReferences.get("query:1")?.examples[1]?.primary).toBe(
      "id: discard-nested",
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://analyst.test/dev/v1/sessions",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://analyst.test/dev/v1/sessions/session%3A1/questions",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenAI-API-Key": "test-key",
      },
    });
    const questionRequest = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(questionRequest?.body))).toEqual({
      question: "Carbs versus bolus yesterday?",
      asOfMs: 8_000,
      history: [
        { role: "user", content: "What did we discuss before?" },
        {
          role: "assistant",
          content:
            "A previous answer was calculated locally from private health records and is not shared with the hosted model.",
        },
      ],
    });
    expect(String(questionRequest?.body)).not.toContain(privateHistoryText);
  });

  it("rejects an answer that does not match the constrained response contract", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ sessionId: "session:invalid", expiresAtMs: Date.now() + 600_000 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          answer: {
            headline: "Unsupported confidence",
            answer: "This must not be accepted.",
            confidence: "certain",
            evidenceIds: [],
            limitations: [],
          },
          evidence: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      askTarvisAnalystLab({
        apiKey: "test-key",
        asOfMs: 8_000,
        history: [],
        loadSnapshot: async () => snapshot(),
        question: "What happened?",
        range: RANGE,
      }),
    ).rejects.toThrow("The Analyst Lab returned an invalid answer.");
  });

  it("rejects an answer whose cited evidence was not returned", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ sessionId: "session:missing", expiresAtMs: Date.now() + 600_000 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          answer: {
            headline: "Unverifiable answer",
            answer: "This must not be displayed without its evidence.",
            confidence: "high",
            evidenceIds: ["query:not-returned"],
            limitations: [],
          },
          evidence: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      askTarvisAnalystLab({
        apiKey: "test-key",
        asOfMs: 8_000,
        history: [],
        loadSnapshot: async () => snapshot(),
        question: "What happened?",
        range: RANGE,
      }),
    ).rejects.toThrow(
      "The Analyst Lab answer referred to evidence that was not returned.",
    );
  });
});
