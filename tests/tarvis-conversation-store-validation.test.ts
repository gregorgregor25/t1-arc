import { describe, expect, it, vi } from "vitest";

import {
  serializeTarvisConversation,
  validStoredTarvisExchange,
  validateSerializedTarvisConversation,
} from "@/data/tarvis/conversationStore";

vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

function validExchange() {
  return {
    id: "exchange-1",
    question: "What was my average glucose today?",
    answer: {
      headline: "Observed average glucose",
      answer: "The observed average was 7.0 mmol/L.",
      confidence: "limited" as const,
      evidenceIds: ["evidence-1"],
      limitations: ["Coverage was limited."],
    },
    evidence: [
      {
        id: "evidence-1",
        label: "Requested period exact glucose inputs",
        description: "One exact record.",
        range: { start: 1, end: 2 },
        recordIds: ["reading-1"],
        examples: [
          {
            id: "reading-1",
            kind: "glucose" as const,
            timestamp: 1,
            primary: "7.0 mmol/L",
            secondary: "measured",
            sourceId: "test",
          },
        ],
      },
    ],
  };
}

describe("stored Tarv1s conversation validation", () => {
  it("accepts a complete backward-compatible exchange", () => {
    expect(validStoredTarvisExchange(validExchange())).toBe(true);
  });

  it("preserves the local-only sharing marker through persistence validation", () => {
    const exchange = Object.assign(validExchange(), {
      modelSharing: "local-only" as const,
    });

    expect(validStoredTarvisExchange(exchange)).toBe(true);
    const serialized = serializeTarvisConversation([exchange], 1_000);
    expect(JSON.parse(serialized).exchanges[0]).toMatchObject({
      id: exchange.id,
      modelSharing: "local-only",
    });
    expect(
      JSON.parse(validateSerializedTarvisConversation(serialized)).exchanges[0],
    ).toMatchObject({
      id: exchange.id,
      modelSharing: "local-only",
    });
  });

  it("rejects every malformed model-sharing value", () => {
    for (const modelSharing of [
      "hosted",
      "local",
      "local_only",
      "",
      true,
      false,
      null,
      1,
      {},
      [],
    ]) {
      const exchange = Object.assign(validExchange(), { modelSharing });
      expect(validStoredTarvisExchange(exchange)).toBe(false);
      expect(() =>
        validateSerializedTarvisConversation(
          JSON.stringify({
            schemaVersion: 1,
            updatedAt: 1_000,
            exchanges: [exchange],
          }),
        ),
      ).toThrow("invalid Tarv1s conversation");
    }
  });

  it("keeps older exchanges without a sharing marker valid", () => {
    const legacy = validExchange();
    expect("modelSharing" in legacy).toBe(false);

    const migrated = JSON.parse(
      validateSerializedTarvisConversation(
        JSON.stringify({
          schemaVersion: 1,
          updatedAt: 1_000,
          exchanges: [legacy],
        }),
      ),
    );

    expect(validStoredTarvisExchange(migrated.exchanges[0])).toBe(true);
    expect(migrated.exchanges[0]).not.toHaveProperty("modelSharing");
  });

  it("rejects malformed answers that would crash rendering", () => {
    const exchange = validExchange();
    exchange.answer.evidenceIds = undefined as unknown as string[];
    expect(validStoredTarvisExchange(exchange)).toBe(false);
  });

  it("rejects malformed evidence ranges and examples", () => {
    const exchange = validExchange();
    exchange.evidence[0]!.range.end = 0;
    expect(validStoredTarvisExchange(exchange)).toBe(false);

    const other = validExchange();
    other.evidence[0]!.examples[0]!.timestamp = Number.NaN;
    expect(validStoredTarvisExchange(other)).toBe(false);
  });

  it("rejects incomplete persisted chart payloads before replay", () => {
    const exchange = validExchange() as ReturnType<typeof validExchange> & {
      evidence: (ReturnType<typeof validExchange>["evidence"][number] & {
          visualization?: unknown;
        })[];
    };
    exchange.evidence[0]!.visualization = {
      kind: "recurring-clock-overlay-v1",
      title: "Missing required chart fields",
    };
    expect(validStoredTarvisExchange(exchange)).toBe(false);
  });

  it("accepts a complete finite exact-range chart payload", () => {
    const exchange = validExchange() as ReturnType<typeof validExchange> & {
      evidence: (ReturnType<typeof validExchange>["evidence"][number] & {
          visualization?: unknown;
        })[];
    };
    exchange.evidence[0]!.visualization = {
      gapThresholdMilliseconds: 12 * 60_000,
      kind: "range-trace-v1",
      metric: "glucose.mean",
      schemaVersion: 1,
      subtitle: "All exact readings",
      targetRange: { maximum: 10, minimum: 3.9 },
      timezone: "Europe/London",
      title: "Exact glucose trace",
      units: "mmol/L",
      valueDomain: { maximum: 20, minimum: 0 },
      windows: [
        {
          coveragePercent: 100,
          coverageStatus: "sufficient",
          distribution: null,
          events: [],
          id: "requested",
          label: "Requested period",
          meanMmolL: 7,
          points: [{ mmolL: 7, recordId: "reading-1", timestamp: 1 }],
          range: { start: 1, end: 2 },
          recordCount: 1,
        },
      ],
    };
    expect(validStoredTarvisExchange(exchange)).toBe(true);
  });

  it("keeps request provenance separate from a verified local fallback", () => {
    const exchange = Object.assign(validExchange(), {
      answerSource: "local" as const,
      modelRequestSent: true,
      requestMetrics: {
        model: "gpt-test",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.001,
        evidenceCharacters: 500,
      },
      guidanceSources: [
        {
          knowledgeId: "nice-ng17-type-1-physical-activity",
          jurisdiction: "UK" as const,
          sourceTitle: "NICE NG17 physical activity recommendations",
          sourceUrl:
            "https://www.nice.org.uk/guidance/ng17/chapter/recommendations",
          recommendationRefs: ["1.5.1", "1.5.2"],
          reviewedAt: "2026-08-25",
        },
      ],
    });

    expect(validStoredTarvisExchange(exchange)).toBe(true);
  });

  it("migrates unknown legacy prose provenance fail-closed even when metrics exist", () => {
    const legacy = Object.assign(validExchange(), {
      requestMetrics: {
        model: "gpt-test",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostUsd: 0.001,
        evidenceCharacters: 500,
      },
    });
    const migrated = JSON.parse(
      validateSerializedTarvisConversation(
        JSON.stringify({
          schemaVersion: 1,
          updatedAt: 1_000,
          exchanges: [legacy],
        }),
      ),
    );

    expect(migrated.exchanges[0]).toMatchObject({
      answerSource: "local",
      modelRequestSent: true,
      requestMetrics: { totalTokens: 15 },
    });
  });

  it("rejects impossible hosted provenance and untrusted guidance URLs", () => {
    const impossible = Object.assign(validExchange(), {
      answerSource: "hosted" as const,
      modelRequestSent: false,
    });
    expect(validStoredTarvisExchange(impossible)).toBe(false);

    const untrusted = Object.assign(validExchange(), {
      guidanceSources: [
        {
          knowledgeId: "invented",
          jurisdiction: "UK" as const,
          sourceTitle: "Untrusted guidance",
          sourceUrl: "https://example.com/not-nice",
          recommendationRefs: ["1"],
          reviewedAt: "2026-08-25",
        },
      ],
    });
    expect(validStoredTarvisExchange(untrusted)).toBe(false);
  });

  it("persists a structured direct Luna answer with complete request provenance", () => {
    const exchange = Object.assign(validExchange(), {
      answer: {
        headline: "Your highest reading was 17.5 mmol/L",
        answer: "I found two readings at 17.5 mmol/L on 25 August.",
        confidence: "high" as const,
        evidenceIds: [],
        limitations: [],
        directPresentation: {
          version: 1 as const,
          kind: "fact" as const,
          headline: "Your highest reading was 17.5 mmol/L",
          summary: "I found two readings at 17.5 mmol/L on 25 August.",
          confidence: "high" as const,
          primaryMetric: {
            label: "Highest glucose",
            value: "17.5",
            unit: "mmol/L",
          },
          keyFindings: [
            { title: "When", detail: "25 August at 14:59 and 15:04." },
          ],
          interpretation: null,
          evidence: [
            { label: "Glucose history", detail: "730 readings were checked." },
          ],
          limitations: [],
          followUpQuestions: ["What happened around those readings?"],
          safetyNotice: null,
        },
      },
      evidence: [],
      answerSource: "hosted" as const,
      modelRequestSent: true,
      requestMetrics: {
        model: "gpt-5.6-luna",
        inputTokens: 230,
        outputTokens: 35,
        totalTokens: 265,
        estimatedCostUsd: 0.000088,
        evidenceCharacters: 56,
      },
    });

    expect(validStoredTarvisExchange(exchange)).toBe(true);
    const saved = JSON.parse(serializeTarvisConversation([exchange], 1_000));
    expect(saved.exchanges[0].answer.directPresentation).toMatchObject({
      version: 1,
      kind: "fact",
      primaryMetric: { value: "17.5", unit: "mmol/L" },
    });

    saved.exchanges[0].answer.directPresentation.version = 2;
    expect(validStoredTarvisExchange(saved.exchanges[0])).toBe(false);
  });
});
