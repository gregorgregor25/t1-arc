import { afterEach, describe, expect, it } from "vitest";

import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  tarvisPersonalTargetProfile,
  type TarvisGlucoseTargetProfile,
} from "@/data/tarvis/intent";
import { buildLocalGlucoseAnswer } from "@/data/tarvis/localGlucoseAnswer";
import { buildLocalGlucoseRangeAnswer } from "@/data/tarvis/localGlucoseRangeAnswer";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import type { GlucoseReading } from "@/domain/models";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

const AS_OF = Date.parse("2026-08-07T20:00:00+01:00");
const PERSONAL: TarvisGlucoseTargetProfile = tarvisPersonalTargetProfile({
  targetMin: 4,
  targetMax: 9,
})!;

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

function ready(question: string, personal?: TarvisGlucoseTargetProfile) {
  const resolution = resolveTarvisIntent(question, {
    now: AS_OF,
    timezone: "Europe/London",
    personalTargetProfile: personal,
  });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(`Expected ready intent, received ${resolution.outcome.code}`);
  }
  return resolution.intent;
}

function bounds(question: string, personal?: TarvisGlucoseTargetProfile) {
  return ready(question, personal).thresholds.map(({ value }) => [
    value.role,
    value.operator,
    value.value,
    value.unit,
  ]);
}

function reading(id: string, timestamp: number, mmolL: number): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: "unknown",
    quality: "measured",
    sourceId: "test-cgm",
  };
}

/**
 * Yesterday (6 August) with readings every 5 minutes cycling through
 * 2.8, 3.5, 6, 8.5, 12 and 15 mmol/L, so each value holds one sixth of the day.
 */
function yesterdayReadings() {
  const start = Date.parse("2026-08-06T00:00:00+01:00");
  const values = [2.8, 3.5, 6, 8.5, 12, 15];
  const readings: GlucoseReading[] = [];
  for (let index = 0; index < 288; index += 1) {
    readings.push(reading(`g-${index}`, start + index * 5 * 60_000, values[index % values.length]!));
  }
  return readings;
}

describe("Tarv1s time-in-range questions name their range", () => {
  it("keeps plain time in range on the standard range even when a personal range is set", () => {
    expect(bounds("What was my time in range over the last 7 days?", PERSONAL)).toEqual([
      ["range_lower", "gte", 3.9, "mmol/L"],
      ["range_upper", "lte", 10, "mmol/L"],
    ]);
  });

  it("resolves tight range, TITR and my range", () => {
    expect(bounds("What was my time in tight range last 7 days?")).toEqual([
      ["range_lower", "gte", 3.9, "mmol/L"],
      ["range_upper", "lte", 7.8, "mmol/L"],
    ]);
    expect(bounds("What was my TITR over the last 90 days?")).toEqual([
      ["range_lower", "gte", 3.9, "mmol/L"],
      ["range_upper", "lte", 7.8, "mmol/L"],
    ]);
    expect(bounds("What was my time in my range last 7 days?", PERSONAL)).toEqual([
      ["range_lower", "gte", 4, "mmol/L"],
      ["range_upper", "lte", 9, "mmol/L"],
    ]);
  });

  it("uses the standard range for my range when no valid personal range exists", () => {
    expect(tarvisPersonalTargetProfile({ targetMin: 9, targetMax: 4 })).toBeUndefined();
    expect(bounds("What was my time in my range last 7 days?")).toEqual([
      ["range_lower", "gte", 3.9, "mmol/L"],
      ["range_upper", "lte", 10, "mmol/L"],
    ]);
  });

  it("represents time below or above a level as one bound of a range", () => {
    expect(bounds("What was my time below 3 last 7 days?")).toEqual([
      ["range_lower", "gte", 3, "mmol/L"],
      ["range_upper", "lte", 10, "mmol/L"],
    ]);
    expect(bounds("time below 70 last 7 days")).toEqual([
      ["range_lower", "gte", 70, "mg/dL"],
      ["range_upper", "lte", 180, "mg/dL"],
    ]);
    expect(bounds("time above 250 mg/dL last 30 days")).toEqual([
      ["range_lower", "gte", 70, "mg/dL"],
      ["range_upper", "lte", 250, "mg/dL"],
    ]);
    expect(bounds("time very low last 14 days")).toEqual([
      ["range_lower", "gte", 3, "mmol/L"],
      ["range_upper", "lte", 10, "mmol/L"],
    ]);
    expect(bounds("time above range last week")).toEqual([
      ["range_lower", "gte", 3.9, "mmol/L"],
      ["range_upper", "lte", 10, "mmol/L"],
    ]);
  });

  it("does not read a period such as 'over 14 days' as a glucose level", () => {
    const resolution = resolveTarvisIntent("What percentage over 14 days was in range?", {
      now: AS_OF,
      timezone: "Europe/London",
    });
    expect(resolution.intent.thresholds.some(({ value }) => value.value === 14)).toBe(false);
  });

  it("passes the personal range through the request coordinator", () => {
    const plan = coordinateTarvisRequest({
      question: "What was my time in my range yesterday?",
      asOf: AS_OF,
      personalTargetProfile: PERSONAL,
    });
    expect(plan.kind).toBe("scoped-glucose");
    if (plan.kind !== "scoped-glucose") return;
    expect(plan.intent.thresholds.map(({ value }) => value.value)).toEqual([4, 9]);
  });
});

describe("Tarv1s exact time-in-range answers", () => {
  const readings = yesterdayReadings();

  it("says the standard range for plain time in range", () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my time in range yesterday?"),
      readings,
    });
    // 6 and 8.5 mmol/L: two sixths of observed time.
    expect(result.answer.headline).toBe("Time in the standard range 3.9–10.0 mmol/L: 33.3%");
    expect(result.answer.answer).toContain(
      "33.3% of observed sensor time was in the standard range 3.9–10.0 mmol/L",
    );
    expect(result.presentation.windows[0]?.metrics.map(({ label }) => label)).toEqual([
      "Time below 3.9 mmol/L",
      "Time in the standard range 3.9–10.0 mmol/L",
      "Time above 10.0 mmol/L",
    ]);
  });

  it("answers tight range and your range", () => {
    const tight = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my time in tight range yesterday?"),
      readings,
    });
    expect(tight.answer.headline).toBe("Time in the tight range 3.9–7.8 mmol/L: 16.7%");

    const personal = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my time in my range yesterday?", PERSONAL),
      readings,
    });
    expect(personal.answer.headline).toBe("Time in your range 4.0–9.0 mmol/L: 33.3%");
  });

  it("leads with the share below or above the named level", () => {
    const below = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my time below 3 yesterday?"),
      readings,
    });
    expect(below.answer.headline).toBe("Time below 3.0 mmol/L: 16.7%");
    expect(below.answer.answer).toContain("16.7% of observed sensor time was below 3.0 mmol/L");

    const veryHigh = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("How much time was I above 13.9 yesterday?"),
      readings,
    });
    expect(veryHigh.answer.headline).toBe("Time above 13.9 mmol/L: 16.7%");
  });

  it("uses published mg/dL limits for mg/dL users", () => {
    setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, glucoseUnit: "mgDl" });
    const standard = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my time in range yesterday?"),
      readings,
    });
    expect(standard.answer.headline).toBe("Time in the standard range 70–180 mg/dL: 33.3%");
    const below = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("time below 54 mg/dL yesterday"),
      readings,
    });
    expect(below.answer.headline).toBe("Time below 54 mg/dL: 16.7%");
  });

  it("keeps coverage limits visible when readings are incomplete", () => {
    // Only the first six hours of yesterday were recorded.
    const partial = readings.slice(0, 72);
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my time in range yesterday?"),
      readings: partial,
    });
    expect(result.answer.confidence).toBe("limited");
    expect(result.answer.limitations.join(" ")).toContain("less than 70% sensor coverage");
    expect(result.answer.headline).toContain("standard range");
  });

  it("names the range in clock-window answers", () => {
    const result = buildLocalGlucoseAnswer({
      asOf: AS_OF,
      intent: ready("What was my TIR over the last three days between midnight and 7 a.m.?"),
      readings,
    });
    expect(result.answer.headline).toMatch(/^Time in the standard range 3\.9–10\.0 mmol\/L: /);
    expect(result.answer.answer).toContain("in the standard range 3.9–10.0 mmol/L");
  });
});
