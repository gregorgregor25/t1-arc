import { describe, expect, it, vi } from "vitest";

import {
  serializeTarvisConversation,
  type StoredTarvisExchange,
  validateSerializedTarvisConversation,
} from "@/data/tarvis/conversationStore";
import { compactTarvisEvidence } from "@/data/tarvis/evidenceCompaction";
import {
  buildTarvisEvidenceLineData,
  formatTarvisEvidenceLine,
  isTarvisEvidenceLineData,
  type TarvisEvidenceLineData,
} from "@/data/tarvis/evidenceLine";
import type { TarvisEvidencePresentation } from "@/data/tarvis/evidencePresentation";
import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { buildLocalGlucoseRangeAnswer } from "@/data/tarvis/localGlucoseRangeAnswer";
import type { TarvisAnswer, TarvisEvidencePacket } from "@/data/tarvis/types";
import type { EvidenceReference } from "@/domain/insights";
import type { GlucoseReading } from "@/domain/models";

vi.mock("@/data/persistence/t1arcDatabase", () => ({}));
vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

const MINUTE = 60_000;
const AS_OF = Date.parse("2026-11-17T09:30:00Z");
const MMOL = { locale: "en-GB", timeZone: "Europe/London", glucoseUnit: "mmolL" } as const;
const MG_DL = { locale: "en-GB", timeZone: "Europe/London", glucoseUnit: "mgDl" } as const;

function ready(question: string) {
  const result = resolveTarvisIntent(question, { now: AS_OF, timezone: "Europe/London" });
  if (!isReadyTarvisIntent(result)) throw new Error(result.outcome.code);
  return result.intent;
}

function readings(start: number, end: number, value: (index: number) => number): GlucoseReading[] {
  const items: GlucoseReading[] = [];
  for (let timestamp = start, index = 0; timestamp < end; timestamp += 5 * MINUTE, index += 1) {
    items.push({ id: `g-${timestamp}`, timestamp, receivedAt: timestamp, mmolL: value(index), trend: "flat", quality: "measured", sourceId: "test-cgm" });
  }
  return items;
}

function answer(overrides: Partial<TarvisAnswer> = {}): TarvisAnswer {
  return {
    headline: "Glucose this week",
    answer: "A model-written answer that says 99% and 1,000,000 readings.",
    confidence: "moderate",
    evidenceIds: ["glucose-week"],
    limitations: [],
    ...overrides,
  };
}

const YESTERDAY = { start: Date.parse("2026-11-16T00:00:00Z"), end: Date.parse("2026-11-17T00:00:00Z") };

describe("Tarv1s evidence line", () => {
  it("describes an exact on-device time-in-range answer from its calculation bundle", () => {
    const question = "What was my time in range yesterday?";
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready(question),
      readings: readings(YESTERDAY.start, YESTERDAY.end, (index) => (index % 4 === 0 ? 11 : 6)),
    });
    const data = buildTarvisEvidenceLineData({ ...result, question, references: result.evidence });
    expect(data).toBeDefined();
    expect(data!.windows).toHaveLength(1);
    expect(data!.windows[0]).toMatchObject({ start: YESTERDAY.start, end: YESTERDAY.end, records: 288 });
    expect(data!.windows[0]!.coveragePercent).toBeCloseTo(100, 0);
    expect(formatTarvisEvidenceLine(data!, MMOL)).toBe(
      "Calculated from: 16 Nov 2026 · 288 glucose readings · 100% sensor coverage · Standard range 3.9–10.0 mmol/L",
    );
    expect(formatTarvisEvidenceLine(data!, MG_DL)).toContain("Standard range 70–180 mg/dL");
  });

  it("omits the range for an average and reports partial coverage", () => {
    const question = "What was my average glucose yesterday?";
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready(question),
      readings: readings(YESTERDAY.start, YESTERDAY.start + 12 * 60 * MINUTE, () => 7),
    });
    const line = formatTarvisEvidenceLine(buildTarvisEvidenceLineData({ ...result, question })!, MMOL);
    expect(line).toBe("Calculated from: 16 Nov 2026 · 144 glucose readings · 50.5% sensor coverage");
  });

  it("uses a locally built presentation with both comparison windows", () => {
    const presentation = {
      kind: "time-in-range",
      title: "Time in range",
      detail: "Standard range",
      windows: [
        { label: "Last 7 days", range: { start: Date.parse("2026-11-10T00:00:00Z"), end: Date.parse("2026-11-17T00:00:00Z") }, recordCount: 2016, coveragePercent: 100, coverageStatus: "sufficient", metrics: [{ id: "time-in-range", label: "Time in range", value: 80, unit: "%" }] },
        { label: "Previous 7 days", range: { start: Date.parse("2026-11-03T00:00:00Z"), end: Date.parse("2026-11-10T00:00:00Z") }, recordCount: 1500, coveragePercent: 74.4, coverageStatus: "sufficient", metrics: [{ id: "time-in-range", label: "Time in range", value: 70, unit: "%" }] },
      ],
    } as unknown as TarvisEvidencePresentation;
    const line = formatTarvisEvidenceLine(buildTarvisEvidenceLineData({ answer: answer(), presentation, question: "How was my time in range?" })!, MMOL);
    expect(line).toBe(
      "Calculated from: 10 Nov 2026 – 16 Nov 2026 · 2,016 glucose readings · 100% sensor coverage; compared with 3 Nov 2026 – 9 Nov 2026 · 1,500 glucose readings · 74.4% sensor coverage · Standard range 3.9–10.0 mmol/L",
    );
  });

  it("falls back to the evidence packet for an AI answer, ignoring the numbers in model text", () => {
    const packet = {
      comparison: {
        currentRange: { start: Date.parse("2026-11-17T00:00:00Z"), end: AS_OF },
        current: { glucoseReadings: 110, coveragePercent: 96.5 },
        currentOnly: true,
      },
      evidence: [],
    } as unknown as TarvisEvidencePacket;
    const line = formatTarvisEvidenceLine(buildTarvisEvidenceLineData({ answer: answer(), packet, question: "Any lows this morning?" })!, MMOL);
    expect(line).toBe("Calculated from: 17 Nov 2026, 00:00–09:30 · 110 glucose readings · 96.5% sensor coverage · Standard range 3.9–10.0 mmol/L");
    expect(line).not.toContain("1,000,000");
    expect(formatTarvisEvidenceLine(buildTarvisEvidenceLineData({ answer: answer(), packet, question: "What did I log for lunch?" })!, MMOL)).not.toContain("range");
  });

  it("falls back to the referenced records when nothing else is available", () => {
    const references: EvidenceReference[] = [
      { id: "glucose-week", label: "Glucose readings", description: "", range: YESTERDAY, recordIds: ["a", "b", "b"], examples: [] },
    ];
    const line = formatTarvisEvidenceLine(buildTarvisEvidenceLineData({ answer: answer(), question: "x", references })!, MMOL);
    expect(line).toBe("Calculated from: 16 Nov 2026 · 2 glucose readings");
  });

  it("is absent for general explanations, safety boundaries and answers without records", () => {
    const references: EvidenceReference[] = [
      { id: "glucose-week", label: "Glucose readings", description: "", range: YESTERDAY, recordIds: ["a"], examples: [] },
    ];
    expect(buildTarvisEvidenceLineData({ answer: answer({ evidenceIds: [] }), question: "What is GMI?", references })).toBeUndefined();
    expect(buildTarvisEvidenceLineData({ answer: answer({ responseKind: "safety-boundary" }), question: "How much insulin?", references })).toBeUndefined();
  });

  it("validates stored lines and drops an invalid line without losing the exchange", () => {
    const good: TarvisEvidenceLineData = { version: 1, windows: [{ start: YESTERDAY.start, end: YESTERDAY.end, records: 288, coveragePercent: 100 }], range: { lowerMmolL: 3.9, upperMmolL: 10 } };
    expect(isTarvisEvidenceLineData(good)).toBe(true);
    expect(isTarvisEvidenceLineData({ ...good, version: 2 })).toBe(false);
    expect(isTarvisEvidenceLineData({ ...good, windows: [{ ...good.windows[0], end: YESTERDAY.start }] })).toBe(false);
    expect(isTarvisEvidenceLineData({ ...good, windows: [{ ...good.windows[0], records: -1 }] })).toBe(false);

    const question = "What was my time in range yesterday?";
    const intent = ready(question);
    const result = buildLocalGlucoseRangeAnswer({ asOf: AS_OF, intent, readings: readings(YESTERDAY.start, YESTERDAY.end, () => 6) });
    const exchange: StoredTarvisExchange = {
      id: "line-1",
      question,
      answer: result.answer,
      evidence: compactTarvisEvidence(result.evidence),
      intent,
      presentation: result.presentation,
      answerBundle: result.answerBundle,
      evidenceLine: good,
    };
    const restored = JSON.parse(validateSerializedTarvisConversation(serializeTarvisConversation([exchange], AS_OF)));
    expect(restored.exchanges[0].evidenceLine).toEqual(good);

    const forged = JSON.parse(serializeTarvisConversation([exchange], AS_OF));
    forged.exchanges[0].evidenceLine = { version: 1, windows: [] };
    const cleaned = JSON.parse(validateSerializedTarvisConversation(JSON.stringify(forged)));
    expect(cleaned.exchanges).toHaveLength(1);
    expect(cleaned.exchanges[0].evidenceLine).toBeUndefined();
  });
});
