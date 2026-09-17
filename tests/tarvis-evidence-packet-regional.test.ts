import { afterEach, describe, expect, it } from "vitest";

import { buildTarvisEvidencePacket } from "@/data/tarvis/evidencePacket";
import type { InsightReport, InsightWindowSummary } from "@/domain/insights";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

function windowSummary(coveragePercent: number): InsightWindowSummary {
  return {
    glucoseAverage: 7.4,
    glucoseStandardDeviation: 2.1,
    glucoseCvPercent: 28.4,
    timeInRangePercent: 72.3,
    timeAbovePercent: 24.5,
    timeBelowPercent: 3.2,
    coveragePercent,
    glucoseReadings: 240,
    highGlucoseRuns: 3,
    lowGlucoseRuns: 1,
    insulinUnits: null,
    mealCarbsPerDay: null,
    lateMeals: 0,
    sleepMinutesPerNight: null,
    activityMinutes: null,
  };
}

describe("Tarv1s evidence-packet regional copy", () => {
  it("uses regional digits in low-coverage model context", () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: "ar-EG",
    });
    const report: InsightReport = {
      generatedAt: 200,
      currentRange: { start: 100, end: 200 },
      previousRange: { start: 0, end: 100 },
      ready: false,
      headline: "Glucose comparison",
      summary: "A deterministic comparison.",
      current: windowSummary(42.5),
      previous: windowSummary(96.8),
      findings: [],
    };

    const packet = buildTarvisEvidencePacket(report).packet;

    expect(packet.comparison.summary).toContain("٤٢٫٥% sensor coverage");
  });
});
