import { describe, expect, it, vi } from "vitest";

import {
  MAX_STORED_TARVIS_CONVERSATION_BYTES,
  serializeTarvisConversation,
  type StoredTarvisExchange,
} from "@/data/tarvis/conversationStore";
import { compactTarvisEvidence } from "@/data/tarvis/evidenceCompaction";
import { buildLocalGlucoseRangeAnswer } from "@/data/tarvis/localGlucoseRangeAnswer";
import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { MAX_EVIDENCE_QUERY_CHART_POINTS } from "@/domain/evidenceQueryChart";
import type { GlucoseReading } from "@/domain/models";

vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

const AS_OF = Date.parse("2026-08-08T00:00:00+01:00");
const FIVE_MINUTES = 5 * 60_000;
const NINETY_DAYS = 90 * 24 * 60 * 60_000;

describe("Tarv1s pathological conversation scale", () => {
  it("bounds a full 90-day five-minute trace before persistence", () => {
    const resolution = resolveTarvisIntent(
      "What was my average glucose over the last 90 days?",
      { now: AS_OF, timezone: "Europe/London" },
    );
    if (!isReadyTarvisIntent(resolution)) {
      throw new Error(
        `Expected a ready intent, got ${resolution.outcome.code}.`,
      );
    }
    const start = AS_OF - NINETY_DAYS;
    const readings: GlucoseReading[] = Array.from(
      { length: NINETY_DAYS / FIVE_MINUTES },
      (_, index) => {
        const timestamp = start + index * FIVE_MINUTES;
        return {
          id: `scale-${index}`,
          timestamp,
          receivedAt: timestamp,
          mmolL: 5 + (index % 80) / 10,
          trend: "unknown",
          quality: "measured",
          sourceId: "scale-cgm",
        };
      },
    );
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: resolution.intent,
      readings,
    });
    const evidence = compactTarvisEvidence(result.evidence);
    const exchange: StoredTarvisExchange = {
      id: "scale-90-days",
      question: resolution.intent.question,
      answer: result.answer,
      evidence,
      intent: resolution.intent,
      presentation: result.presentation,
      answerBundle: result.answerBundle,
    };

    const serialized = serializeTarvisConversation([exchange], AS_OF);
    const document = JSON.parse(serialized);
    const visualization = document.exchanges[0].evidence[0].visualization;
    const scopedRecordCount = result.answerBundle.scope.windows.reduce(
      (sum, window) => sum + window.calculationRecordIds.length,
      0,
    );

    expect(scopedRecordCount).toBeGreaterThan(25_000);
    expect(result.answerBundle.records).toHaveLength(scopedRecordCount);
    expect(visualization.windows[0].points.length).toBeLessThanOrEqual(
      MAX_EVIDENCE_QUERY_CHART_POINTS,
    );
    expect(visualization.windows[0].sampling).toMatchObject({
      sourceRecordCount: scopedRecordCount,
      sourceSampleCount: scopedRecordCount,
    });
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
      MAX_STORED_TARVIS_CONVERSATION_BYTES,
    );
  }, 30_000);
});
