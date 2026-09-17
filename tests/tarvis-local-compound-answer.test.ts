import { describe, expect, it, vi } from "vitest";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import { loadLocalCompoundAnswer } from "@/data/tarvis/localCompoundAnswer";
import { resolveTarvisIntentRange } from "@/data/tarvis/intentRange";
import { isTarvisEvidencePresentation } from "@/data/tarvis/evidencePresentation";
import type { GlucoseReading, TimelineData, TimeRange } from "@/domain/models";
import { serializeTarvisConversation, validateSerializedTarvisConversation } from "@/data/tarvis/conversationStore";

vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

const NOW = Date.parse("2026-09-08T17:12:00+01:00");
const GLUCOSE_QUESTION = "Hey. What was my average glucose over the last 7 days compared the previous 7 days? And how many periods of low sugar did I have in the last 7 days compared to the previous 7 days?";
const FOOD_QUESTION = "How many carbohydrates did I log yesterday versus how much bolus insulin I took?";

function plan(question: string) {
  const result = coordinateTarvisRequest({ question, asOf: NOW });
  expect(result.kind).toBe("scoped-compound");
  if (result.kind !== "scoped-compound") throw new Error(JSON.stringify(result));
  return result;
}

function timeline(range: TimeRange, overrides: Partial<TimelineData> = {}): TimelineData {
  return { range, glucose: [], basal: [], boluses: [], context: [], sources: [], ...overrides };
}

describe("Tarv1s screenshot compound-question regressions", () => {
  it("answers both averages and sustained lows using one glucose load and exact periods", async () => {
    const { intents } = plan(GLUCOSE_QUESTION);
    const resolved = resolveTarvisIntentRange({ intent: intents[0]!, asOf: NOW });
    if (resolved.status !== "resolved" || !resolved.previous) throw new Error("Expected comparison");
    const readings: GlucoseReading[] = [];
    for (const [index, range] of [resolved.current, resolved.previous].entries()) {
      for (let timestamp = range.start; timestamp < range.end; timestamp += 5 * 60_000) {
        const minute = (timestamp - range.start) / 60_000;
        const low = (minute >= 60 && minute < 80) || (index === 1 && minute >= 180 && minute < 200);
        readings.push({ id: `g-${timestamp}`, timestamp, receivedAt: timestamp,
          mmolL: low ? 3.2 : index === 0 ? 7 : 8, trend: "unknown", quality: "measured", sourceId: "synthetic-cgm" });
      }
    }
    const load = vi.fn(async () => readings);
    const result = await loadLocalCompoundAnswer({ intents, asOf: NOW, loadGlucoseReadings: load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.answer.answer).toContain("Average glucose: 7.0 mmol/L");
    expect(result.answer.answer).toContain("Average glucose: 8.0 mmol/L");
    expect(result.answer.answer).toContain("Sustained lows: 1");
    expect(result.answer.answer).toContain("Sustained lows: 2");
    expect(result.answer.limitations.join(" ")).toContain("ends at the time you asked");
    expect(result.answer.limitations.join(" ")).not.toContain("clocks changed");
    expect(result.answer.limitations.join(" ")).toContain("at least 15 minutes");
    expect(result.answer.limitations.join(" ")).not.toContain("consensus-15m");
    expect(isTarvisEvidencePresentation(result.presentation)).toBe(true);
    const claims = result.evidence.flatMap((reference) => reference.calculation?.metrics ?? []);
    expect(claims.filter((claim) => claim.id === "glucose.mean")).toHaveLength(2);
    expect(claims.filter((claim) => claim.id === "glucose.low_episodes").map((claim) => claim.value)).toEqual([1, 2]);
    expect(result.evidence.every((reference) => result.answer.evidenceIds.includes(reference.id))).toBe(true);
    expect(new Set(result.answer.evidenceIds).size).toBe(result.evidence.length);
    const serialized = serializeTarvisConversation([{
      id: "compound", question: GLUCOSE_QUESTION, ...result,
      answerSource: "local", modelRequestSent: false, modelSharing: "local-only",
    }], NOW);
    const restored = JSON.parse(validateSerializedTarvisConversation(serialized)).exchanges[0];
    expect(restored.answer).toEqual(result.answer);
    expect(restored.presentation).toEqual(result.presentation);
    expect(restored.evidence.map((reference: { id: string }) => reference.id)).toEqual(result.answer.evidenceIds);
    expect(restored.answerBundle).toBeUndefined();
    expect(restored.intent).toBeUndefined();
    expect(restored.modelRequestSent).toBe(false);
  });

  it("answers yesterday's carbs and bolus from one shared timeline without a ratio", async () => {
    const { intents } = plan(FOOD_QUESTION);
    const load = vi.fn(async (range: TimeRange) => timeline(range, {
      context: [{ id: "meal", kind: "meal", title: "Lunch", start: range.start + 12 * 3_600_000,
        carbsGrams: 60, mealType: "lunch", origin: "manual", sourceId: "food-log" }],
      dailyInsulinTotals: [{ id: "pump-total", timestamp: range.end - 1, dateKey: "2026-09-07",
        basalUnits: 14, bolusUnits: 8.5, totalUnits: 22.5, sourceId: "pump", importedAt: range.end + 1 }],
      sources: [{ id: "pump", label: "Insulin", detail: "Synthetic pump fixture", freshness: "current", origin: "imported", isLive: true }],
    }));
    const result = await loadLocalCompoundAnswer({ intents, asOf: NOW, loadTimelineData: load });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ start: Date.parse("2026-09-07T00:00:00+01:00"), end: Date.parse("2026-09-08T00:00:00+01:00") });
    expect(result.answer.answer).toContain("Logged carbohydrates: 60.0 g");
    expect(result.answer.answer).toContain("Bolus insulin: 8.5 U");
    expect(result.answer.answer).not.toMatch(/ratio|should take|units per|exact period|which period/i);
    expect(result.evidence.flatMap((reference) => reference.recordIds)).toEqual(expect.arrayContaining(["meal", "pump-total"]));
    expect(isTarvisEvidencePresentation(result.presentation)).toBe(true);
  });

  it("does not invent zero carbs or zero delivery when records are missing", async () => {
    const { intents } = plan(FOOD_QUESTION);
    const result = await loadLocalCompoundAnswer({ intents, asOf: NOW, loadTimelineData: async (range) => timeline(range) });
    expect(result.answer.answer).toContain("Logged carbohydrates: unavailable");
    expect(result.answer.answer).toContain("Bolus insulin: unavailable");
    expect(result.answer.answer).not.toMatch(/0\.0 [gU]/);
    expect(result.answer.confidence).toBe("limited");
  });

  it("preserves a recorded zero bolus and still reports missing carbs separately", async () => {
    const { intents } = plan(FOOD_QUESTION);
    const result = await loadLocalCompoundAnswer({ intents, asOf: NOW, loadTimelineData: async (range) => timeline(range, {
      dailyInsulinTotals: [{ id: "zero", timestamp: range.end - 1, dateKey: "2026-09-07", basalUnits: 14,
        bolusUnits: 0, totalUnits: 14, sourceId: "pump", importedAt: range.end + 1 }],
      sources: [{ id: "pump", label: "Insulin", detail: "Synthetic", freshness: "current", origin: "imported", isLive: true }],
    }) });
    expect(result.answer.answer).toContain("Bolus insulin: 0.0 U");
    expect(result.answer.answer).toContain("Logged carbohydrates: unavailable");
  });

  it("does not publish a partial result if any component's records fail to load", async () => {
    const { intents } = plan(FOOD_QUESTION);
    await expect(loadLocalCompoundAnswer({ intents, asOf: NOW, loadTimelineData: async () => { throw new Error("read failed"); } })).rejects.toThrow("read failed");
  });

  it("rejects an oversized compound before loading records", () => {
    expect(coordinateTarvisRequest({ question: "My average glucose and low episodes over the last 100 days", asOf: NOW }))
      .toMatchObject({ kind: "answer", source: "capability", answer: { headline: "That period is too large for one on-phone answer" } });
  });

  it.each([
    "How many carbs did I log yesterday and how much bolus should I take today?",
    "Compare my carbohydrates yesterday with bolus last month and recommend a dose.",
  ])("keeps treatment requests out of the local compound path: %s", (question) => {
    const result = coordinateTarvisRequest({ question, asOf: NOW });
    expect(result).toMatchObject({ kind: "answer", source: "safety" });
  });
});
