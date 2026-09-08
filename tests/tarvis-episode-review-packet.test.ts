import { describe, expect, it } from "vitest";
import { focusTarvisEpisodeReviewPacket } from "@/data/tarvis/episodeReviewPacket";
import { selectTarvisEvidencePacket } from "@/data/tarvis/evidencePacket";
import { parseTarvisEvidenceSelectionResult, tarvisEvidenceFindingOptions } from "@/data/tarvis/evidenceAnswerGuardrail";
import type { TarvisEvidencePacket } from "@/data/tarvis/types";

const QUESTION = "Review my low glucose episodes over the last 14 days. Look at my meals, insulin, exercise and sleep.";
function packet(): TarvisEvidencePacket {
  const currentRange = { start: Date.parse("2026-08-25T00:00:00+01:00"), end: Date.parse("2026-09-07T10:30:00+01:00") };
  const previousRange = { start: Date.parse("2026-08-11T00:00:00+01:00"), end: currentRange.start };
  const summary = {
    glucoseAverage: 7, glucoseStandardDeviation: 2, glucoseCvPercent: 28,
    timeInRangePercent: 80, timeBelowPercent: 4, timeAbovePercent: 16,
    glucoseReadings: 4000, coveragePercent: 98, lowGlucoseRuns: 8, highGlucoseRuns: 12,
    insulinUnits: 300, mealCarbsPerDay: 180, lateMeals: 4,
    sleepMinutesPerNight: 400, activityMinutes: 200,
  };
  const definitions = [
    ["glucose-overview", "glucose"], ["food-context", "food"],
    ["insulin-change", "insulin"], ["activity-context", "activity"], ["sleep-context", "sleep"],
  ] as const;
  const findings = definitions.map(([id, category]) => ({
    id, category, kind: "observation", title: `${category} context`, summary: `Observed ${category} comparison.`,
    evidenceIds: category === "glucose" ? ["current-glucose", "previous-glucose"] : [`current-${category}`, `previous-${category}`],
  }));
  return {
    schemaVersion: 1, timezone: "Europe/London", units: { glucose: "mmol/L", weight: "kg", distance: "km" },
    generatedAt: currentRange.end,
    comparison: { currentRange, previousRange, current: summary, previous: { ...summary, lowGlucoseRuns: 5 }, headline: "Time in range improved", summary: "Irrelevant glucose overview" },
    findings,
    evidence: findings.flatMap(({ evidenceIds }) => evidenceIds.map((id) => ({
      id, label: id, description: id, recordCount: 10, examples: [], range: id.startsWith("current") ? currentRange : previousRange,
    }))),
  };
}

describe("real-phone episode review relevance", () => {
  it("keeps episodes and every requested context in valid, empty and invalid model selections", () => {
    const source = packet();
    const focused = selectTarvisEvidencePacket(QUESTION, focusTarvisEpisodeReviewPacket(QUESTION, source, "low"));
    expect(focused.requiredFindingIds).toHaveLength(5);
    expect(tarvisEvidenceFindingOptions(focused)).toHaveLength(5);
    for (const text of [JSON.stringify({ findingIds: ["sleep-context"] }), JSON.stringify({ findingIds: [] }), "not-json"]) {
      const result = parseTarvisEvidenceSelectionResult(text, focused);
      expect(result.answer.headline).toBe("8 observed low episodes versus 5 previously");
      expect(result.answer.answer).toContain("8 sustained low episodes");
      for (const area of ["food", "insulin", "activity", "sleep"]) expect(result.answer.answer).toContain(`Observed ${area} comparison`);
      expect(result.answer.answer).not.toContain("Irrelevant glucose overview");
      expect(result.answer.evidenceIds).toHaveLength(10);
      expect(result.answer.answer).toContain("not records around each episode");
    }
    expect(source.comparison.headline).toBe("Time in range improved");
    expect(source.requiredFindingIds).toBeUndefined();
  });

  it("shows exact local boundaries, including partial today, without rounding fourteen dates to thirteen days", () => {
    const focused = focusTarvisEpisodeReviewPacket(QUESTION, packet(), "low");
    expect(focused.comparison.summary).toContain("25 Aug 2026");
    expect(focused.comparison.summary).toContain("7 Sept 2026");
    expect(focused.comparison.summary).toContain("10:30");
    expect(focused.comparison.summary).toContain("part of today");
    expect(focused.comparison.summary).not.toContain("13 days");
  });

  it("does not substitute zero for sparse or missing glucose", () => {
    const source = packet();
    source.comparison.previous.glucoseReadings = 0;
    source.comparison.previous.lowGlucoseRuns = null;
    expect(focusTarvisEpisodeReviewPacket(QUESTION, source, "low")).toBe(source);
  });

  it("explains a missing context comparison without claiming there were no records", () => {
    const source = packet();
    source.findings = source.findings.filter(({ category }) => category !== "sleep");
    const focused = focusTarvisEpisodeReviewPacket(QUESTION, source, "low");
    expect(focused.findings[0]?.caveat).toContain("comparable sleep summary is not available for both periods");
    expect(focused.findings[0]?.caveat).toContain("does not mean nothing was recorded");
  });

  it("retains observed zero episodes when glucose coverage is sufficient", () => {
    const source = packet();
    source.comparison.current.lowGlucoseRuns = 0;
    expect(focusTarvisEpisodeReviewPacket(QUESTION, source, "low").comparison.headline).toBe("0 observed low episodes versus 5 previously");
  });

  it("does not describe bolus-only records as complete insulin delivery", () => {
    const source = packet();
    source.comparison.current.basalUnitsPerDay = 0;
    source.comparison.current.bolusUnitsPerDay = 23;
    source.comparison.previous.bolusUnitsPerDay = 27;
    const focused = focusTarvisEpisodeReviewPacket(QUESTION, source, "low");
    const insulin = focused.findings.find(({ id }) => id === "insulin-change");
    expect(insulin?.summary).toContain("not a comparison of complete insulin delivery");
    expect(insulin?.caveat).toContain("do not prove that no basal insulin was delivered");
  });
});
