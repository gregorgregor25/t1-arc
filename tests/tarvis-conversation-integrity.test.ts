import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadTarvisConversationState,
  saveTarvisConversation,
  serializeTarvisConversation,
  TarvisConversationStorageLimitError,
  type StoredTarvisExchange,
  validStoredTarvisExchange,
} from "@/data/tarvis/conversationStore";
import { compactTarvisEvidence } from "@/data/tarvis/evidenceCompaction";
import { buildLocalGlucoseAnswer } from "@/data/tarvis/localGlucoseAnswer";
import { buildLocalGlucoseRangeAnswer } from "@/data/tarvis/localGlucoseRangeAnswer";
import {
  buildLocalPersonalDataAnswer,
  rangesForLocalPersonalDataIntent,
} from "@/data/tarvis/localPersonalDataAnswer";
import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { toDateKey } from "@/domain/time";
import type {
  DataSourceStatus,
  GlucoseReading,
  TimelineData,
  TimeRange,
} from "@/domain/models";

const persistence = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: vi.fn(async () => ({
    getFirstAsync: vi.fn(async () =>
      persistence.value ? { value: persistence.value } : null,
    ),
  })),
  withT1ArcTransaction: vi.fn(
    async (work: (transaction: unknown) => Promise<void>) =>
      work({
        getFirstAsync: vi.fn(async () => null),
        runAsync: vi.fn(async (_sql: string, _key: string, value?: string) => {
          persistence.value = value;
        }),
      }),
  ),
}));
vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

const AS_OF = Date.parse("2026-08-07T20:00:00+01:00");

async function loadedConversation() {
  const result = await loadTarvisConversationState();
  return result.status === "loaded" ? result.exchanges : [];
}

function ready(question: string) {
  const result = resolveTarvisIntent(question, {
    now: AS_OF,
    timezone: "Europe/London",
  });
  if (!isReadyTarvisIntent(result)) throw new Error(result.outcome.code);
  return result.intent;
}

function reading(id: string, timestamp: string, mmolL: number): GlucoseReading {
  const instant = Date.parse(timestamp);
  return {
    id,
    timestamp: instant,
    receivedAt: instant,
    mmolL,
    trend: "unknown",
    quality: "measured",
    sourceId: "test-cgm",
  };
}

function source(id: string, label: string): DataSourceStatus {
  return {
    id,
    label,
    detail: "Conversation replay test source",
    freshness: "current",
    origin: "imported",
    isLive: true,
  };
}

function timeline(
  range: TimeRange,
  overrides: Partial<TimelineData> = {},
): TimelineData {
  return {
    range: { ...range },
    glucose: [],
    basal: [],
    boluses: [],
    dailyInsulinTotals: [],
    context: [],
    sources: [],
    ...overrides,
  };
}

function personalExchange(
  id: string,
  question: string,
  data: (range: TimeRange) => TimelineData,
): StoredTarvisExchange {
  const intent = ready(question);
  const ranges = rangesForLocalPersonalDataIntent(intent, AS_OF);
  const result = buildLocalPersonalDataAnswer({
    asOf: AS_OF,
    intent,
    current: data(ranges.current),
  });
  return {
    id,
    question,
    answer: result.answer,
    evidence: result.evidence,
    intent,
    presentation: result.presentation,
  };
}

function exactExchange(): StoredTarvisExchange {
  const question = "What was my average glucose today?";
  const intent = ready(question);
  const result = buildLocalGlucoseRangeAnswer({
    asOf: AS_OF,
    intent,
    readings: [
      reading("first", "2026-08-07T08:00:00+01:00", 6),
      reading("second", "2026-08-07T08:05:00+01:00", 8),
    ],
  });
  return {
    id: "exact-1",
    question,
    answer: result.answer,
    evidence: compactTarvisEvidence(result.evidence),
    intent,
    presentation: result.presentation,
    answerBundle: result.answerBundle,
  };
}

function recurringBoundaryEventExchange(): StoredTarvisExchange {
  const question =
    "How many high-glucose events did I have over the last one day between midnight and 7 a.m.?";
  const intent = ready(question);
  const result = buildLocalGlucoseAnswer({
    asOf: AS_OF,
    intent,
    readings: [
      reading("pre-boundary-normal", "2026-08-06T23:50:00+01:00", 6),
      reading("start-inside", "2026-08-07T06:55:00+01:00", 12),
      reading("post-boundary-high", "2026-08-07T07:00:00+01:00", 12),
      reading("post-boundary-confirm", "2026-08-07T07:10:00+01:00", 12),
    ],
  });
  return {
    id: "recurring-boundary-event",
    question,
    answer: result.answer,
    evidence: compactTarvisEvidence([result.evidence]),
    intent,
    presentation: result.presentation,
    answerBundle: result.answerBundle,
  };
}

function exactBoundaryEventExchange(): StoredTarvisExchange {
  const question = "How many high-glucose events did I have yesterday?";
  const intent = ready(question);
  const result = buildLocalGlucoseRangeAnswer({
    asOf: AS_OF,
    intent,
    readings: [
      reading("exact-pre-boundary", "2026-08-05T23:50:00+01:00", 6),
      reading("exact-start-inside", "2026-08-06T23:50:00+01:00", 12),
      reading("exact-still-inside", "2026-08-06T23:55:00+01:00", 12),
      reading("exact-post-confirm", "2026-08-07T00:05:00+01:00", 12),
    ],
  });
  return {
    id: "exact-boundary-event",
    question,
    answer: result.answer,
    evidence: compactTarvisEvidence(result.evidence),
    intent,
    presentation: result.presentation,
    answerBundle: result.answerBundle,
  };
}

function plainExchange(index: number): StoredTarvisExchange {
  return {
    id: `plain-${index}`,
    question: `Question ${index} ${"x".repeat(220)}`,
    answer: {
      headline: `Answer ${index}`,
      answer: "A deterministic plain answer.",
      confidence: "limited",
      evidenceIds: [],
      limitations: [],
    },
    evidence: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Tarv1s schema-v3 conversation integrity", () => {
  beforeEach(() => {
    persistence.value = undefined;
  });

  it("persists, validates, reloads and refreezes a V2 answer bundle", async () => {
    const exchange = exactExchange();
    expect(validStoredTarvisExchange(exchange)).toBe(true);

    await saveTarvisConversation([exchange]);
    const document = JSON.parse(persistence.value!);
    expect(document.schemaVersion).toBe(3);
    expect(document.exchanges[0].answerBundle.identity).toEqual(
      exchange.answerBundle?.identity,
    );

    const [restored] = await loadedConversation();
    expect(restored?.answerBundle?.identity).toEqual(
      exchange.answerBundle?.identity,
    );
    expect(Object.isFrozen(restored?.answerBundle)).toBe(true);
    expect(Object.isFrozen(restored?.answerBundle?.scope.windows[0])).toBe(
      true,
    );
  });

  it("preserves separate thread identities and migrates older exchanges", async () => {
    await saveTarvisConversation([
      { ...plainExchange(1), threadId: "thread:first" },
      { ...plainExchange(2), threadId: "thread:second" },
      plainExchange(3),
    ]);

    const restored = await loadedConversation();
    expect(restored.map(({ threadId }) => threadId)).toEqual([
      "thread:first",
      "thread:second",
      "legacy:legacy-unknown",
    ]);
  });

  it("round-trips every deterministic personal-data answer type with in-range evidence", async () => {
    const dailyTotalTimeline = (range: TimeRange) =>
      timeline(range, {
        dailyInsulinTotals: [
          {
            id: `daily-${toDateKey(range.start)}`,
            timestamp: range.end - 1,
            dateKey: toDateKey(range.start),
            basalUnits: 14,
            bolusUnits: 9,
            totalUnits: 23,
            sourceId: "insulin-source",
            importedAt: range.end + 1_000,
          },
        ],
        sources: [source("insulin-source", "Insulin")],
      });
    const exchanges = [
      personalExchange("personal-current", "what's my sugar now?", (range) =>
        timeline(range, {
          glucose: [
            reading(
              "current-reading",
              new Date(AS_OF - 5 * 60_000).toISOString(),
              7.2,
            ),
          ],
          sources: [source("test-cgm", "Glucose")],
        }),
      ),
      personalExchange(
        "personal-total-insulin",
        "how much insulin yesterday?",
        dailyTotalTimeline,
      ),
      personalExchange(
        "personal-basal-insulin",
        "how much basal insulin yesterday?",
        (range) =>
          timeline(range, {
            basal: [
              {
                id: "basal-crossing-start",
                start: range.start - 60 * 60_000,
                end: range.end,
                rateUnitsPerHour: 1,
                units: 25,
                sourceId: "insulin-source",
              },
            ],
            sources: [source("insulin-source", "Insulin")],
          }),
      ),
      personalExchange(
        "personal-bolus-insulin",
        "how much bolus insulin yesterday?",
        dailyTotalTimeline,
      ),
      personalExchange(
        "personal-carbs",
        "how many carbs did i eat yesterday?",
        (range) =>
          timeline(range, {
            context: [
              {
                id: "meal",
                kind: "meal",
                title: "Recorded meal",
                mealType: "dinner",
                carbsGrams: 45,
                start: range.start + 18 * 60 * 60_000,
                sourceId: "context-source",
                origin: "manual",
              },
            ],
          }),
      ),
      personalExchange(
        "personal-activity",
        "how long did i exercise yesterday?",
        (range) =>
          timeline(range, {
            context: [
              {
                id: "activity-crossing-start",
                kind: "activity",
                title: "Recorded walk",
                activityType: "walk",
                intensity: "moderate",
                durationMinutes: 60,
                start: range.start - 30 * 60_000,
                end: range.start + 30 * 60_000,
                sourceId: "context-source",
                origin: "imported",
              },
            ],
          }),
      ),
      personalExchange(
        "personal-sleep",
        "how long did i sleep yesterday?",
        (range) =>
          timeline(range, {
            context: [
              {
                id: "sleep-crossing-start",
                kind: "sleep",
                title: "Recorded sleep",
                durationMinutes: 8 * 60,
                start: range.start - 2 * 60 * 60_000,
                end: range.start + 6 * 60 * 60_000,
                sourceId: "context-source",
                origin: "imported",
              },
            ],
          }),
      ),
      personalExchange(
        "personal-coverage",
        "what was my sensor coverage yesterday?",
        (range) =>
          timeline(range, {
            glucose: [
              reading(
                "coverage-reading",
                new Date(range.start + 60 * 60_000).toISOString(),
                6.8,
              ),
            ],
            sources: [source("test-cgm", "Glucose")],
          }),
      ),
      personalExchange("personal-gaps", "any sensor gaps yesterday?", (range) =>
        timeline(range, {
          glucose: [
            reading(
              "gap-reading",
              new Date(range.start + 60 * 60_000).toISOString(),
              6.8,
            ),
          ],
          sources: [source("test-cgm", "Glucose")],
        }),
      ),
    ];

    exchanges.forEach((exchange) => {
      expect(validStoredTarvisExchange(exchange), exchange.id).toBe(true);
      exchange.evidence.forEach((reference) => {
        reference.examples.forEach((example) => {
          expect(
            example.timestamp,
            `${exchange.id}:${example.id}`,
          ).toBeGreaterThanOrEqual(reference.range.start);
          expect(
            example.timestamp,
            `${exchange.id}:${example.id}`,
          ).toBeLessThan(reference.range.end);
        });
      });
    });

    await saveTarvisConversation(exchanges);
    const restored = await loadedConversation();

    expect(restored.map(({ id }) => id)).toEqual(exchanges.map(({ id }) => id));
    expect(restored.map(({ answer }) => answer)).toEqual(
      exchanges.map(({ answer }) => answer),
    );
    expect(restored.map(({ evidence }) => evidence)).toEqual(
      exchanges.map(({ evidence }) => evidence),
    );
    expect(restored.map(({ presentation }) => presentation)).toEqual(
      exchanges.map(({ presentation }) => presentation),
    );
  });

  it("persists recurring event context in V2 provenance without exposing it as calculation evidence", async () => {
    const exchange = recurringBoundaryEventExchange();
    const bundleWindow = exchange.answerBundle!.scope.windows[0]!;

    expect(exchange.answerBundle!.claims[0]?.value).toBe(1);
    expect(bundleWindow.calculationRecordIds).toEqual(["start-inside"]);
    expect(bundleWindow.contextRecordIds).toEqual([
      "pre-boundary-normal",
      "post-boundary-high",
      "post-boundary-confirm",
    ]);
    expect(exchange.answerBundle!.records.map(({ id }) => id)).toEqual([
      "pre-boundary-normal",
      "start-inside",
      "post-boundary-high",
      "post-boundary-confirm",
    ]);
    expect(exchange.evidence.flatMap(({ recordIds }) => recordIds)).toEqual([
      "start-inside",
    ]);
    expect(validStoredTarvisExchange(exchange)).toBe(true);

    await saveTarvisConversation([exchange]);
    expect(JSON.parse(persistence.value!).schemaVersion).toBe(3);
    const [restored] = await loadedConversation();

    expect(restored?.evidence.flatMap(({ recordIds }) => recordIds)).toEqual([
      "start-inside",
    ]);
    expect(restored?.answerBundle?.scope.windows[0]?.contextRecordIds).toEqual(
      bundleWindow.contextRecordIds,
    );
    expect(Object.isFrozen(restored?.answerBundle)).toBe(true);
    expect(Object.isFrozen(restored?.answerBundle?.records[0])).toBe(true);
  });

  it("keeps exact-range classification context out of All Records too", () => {
    const exchange = exactBoundaryEventExchange();
    expect(exchange.answerBundle!.scope.windows[0]?.contextRecordIds).toEqual([
      "exact-pre-boundary",
      "exact-post-confirm",
    ]);
    expect(exchange.evidence.flatMap(({ recordIds }) => recordIds)).toEqual([
      "exact-start-inside",
      "exact-still-inside",
    ]);
    expect(validStoredTarvisExchange(exchange)).toBe(true);
  });

  it("rejects detached answer, chart and bundle links before replay", () => {
    const missingEvidence = clone(exactExchange());
    missingEvidence.answer.evidenceIds = ["missing"];
    expect(validStoredTarvisExchange(missingEvidence)).toBe(false);

    const detachedPoint = clone(exactExchange());
    const visualization = detachedPoint.evidence[0]!.visualization;
    if (!visualization || visualization.kind === "recurring-clock-overlay-v1") {
      throw new Error("Expected an exact visualization.");
    }
    visualization.windows[0]!.points[0] = {
      ...visualization.windows[0]!.points[0]!,
      recordIds: ["not-evidence"],
      recordId: undefined,
    };
    expect(validStoredTarvisExchange(detachedPoint)).toBe(false);

    const forgedDisplayedValue = clone(exactExchange());
    const forgedVisualization = forgedDisplayedValue.evidence[0]!.visualization;
    if (
      !forgedVisualization ||
      forgedVisualization.kind === "recurring-clock-overlay-v1"
    ) {
      throw new Error("Expected an exact visualization.");
    }
    forgedVisualization.windows[0]!.points[0]!.mmolL = 19;
    expect(validStoredTarvisExchange(forgedDisplayedValue)).toBe(false);

    const changedClaim = clone(exactExchange());
    (changedClaim.answerBundle!.claims[0] as { value: number }).value = 99;
    expect(validStoredTarvisExchange(changedClaim)).toBe(false);
  });

  it("loads a valid schema-v2 recurring chart without inventing a V2 bundle", async () => {
    const question =
      "What were my average readings over the last two nights between midnight and 7 a.m.?";
    const intent = ready(question);
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("night-a", "2026-08-06T01:00:00+01:00", 6),
        reading("night-b", "2026-08-07T01:00:00+01:00", 8),
      ],
    });
    persistence.value = JSON.stringify({
      schemaVersion: 2,
      updatedAt: AS_OF,
      exchanges: [
        {
          id: "legacy-recurring",
          question,
          answer: result.answer,
          evidence: [result.evidence],
          intent,
          presentation: result.presentation,
        },
      ],
    });

    const restored = await loadedConversation();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.answerBundle).toBeUndefined();
    expect(restored[0]?.evidence[0]?.visualization?.kind).toBe(
      "recurring-clock-overlay-v1",
    );
  });

  it("rejects impossible recurring payloads during legacy migration", async () => {
    const question =
      "What were my average readings over the last two nights between midnight and 7 a.m.?";
    const intent = ready(question);
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent,
      readings: [reading("night-a", "2026-08-07T01:00:00+01:00", 6)],
    });
    const exchange: any = {
      id: "bad-legacy",
      question,
      answer: result.answer,
      evidence: [result.evidence],
      intent,
      presentation: result.presentation,
    };
    const populatedWindow = exchange.evidence[0].visualization.windows.find(
      (window: { points: unknown[] }) => window.points.length > 0,
    );
    if (!populatedWindow) throw new Error("Expected a populated clock window.");
    populatedWindow.status = "missing";
    persistence.value = JSON.stringify({
      schemaVersion: 2,
      updatedAt: AS_OF,
      exchanges: [exchange],
    });

    expect(await loadedConversation()).toEqual([]);
  });

  it("keeps the newest contiguous exchanges under a deterministic byte budget", () => {
    const serialized = serializeTarvisConversation(
      Array.from({ length: 8 }, (_, index) => plainExchange(index)),
      AS_OF,
      1_450,
    );
    const document = JSON.parse(serialized);
    const ids = document.exchanges.map(
      (exchange: StoredTarvisExchange) => exchange.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.at(-1)).toBe("plain-7");
    expect(ids).toEqual(
      Array.from(
        { length: ids.length },
        (_, index) => `plain-${8 - ids.length + index}`,
      ),
    );
  });

  it("fails explicitly when the newest complete exchange alone exceeds the budget", () => {
    expect(() =>
      serializeTarvisConversation([plainExchange(1)], AS_OF, 256),
    ).toThrow(TarvisConversationStorageLimitError);
  });
});
