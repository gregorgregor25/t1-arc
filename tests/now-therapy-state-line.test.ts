import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NOW_THERAPY_STATE_MAX_AGE_MS,
  nowTherapyStateLines,
  therapyStateRecordedUntil,
} from "@/components/nowCardPresentation";
import {
  getRuntimeRegionalProfile,
  setRuntimeRegionalProfile,
} from "@/domain/regionalProfileRuntime";
import type { TherapyStateInterval } from "@/domain/therapyStates";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// 10:00 in London (GMT in November).
const NOW = Date.parse("2026-11-17T10:00:00Z");

function state(overrides: Partial<TherapyStateInterval> & Pick<TherapyStateInterval, "id" | "kind">): TherapyStateInterval {
  return {
    start: NOW - 30 * MINUTE,
    // Interval ends are cut at the time the records were read.
    end: NOW,
    endBasis: "programmed",
    baseline: false,
    source: {
      rawRecordId: `raw-${overrides.id}`,
      sourceId: "aaps-local",
      sourceFile: "AAPS broadcast (sender confirmed)",
    },
    duplicateSources: [],
    ...overrides,
  };
}

const activityTarget = state({
  id: "tt",
  kind: "temporary-target",
  targetReason: "activity",
  targetLowMmolL: 8,
  targetHighMmolL: 8,
  programmedDurationMs: 2 * HOUR,
  start: NOW - 30 * MINUTE,
});

const profile80 = state({
  id: "ps",
  kind: "profile-switch",
  percentage: 80,
  profileName: "Weekday",
  programmedDurationMs: 3 * HOUR,
  start: NOW - HOUR,
});

let previousProfile: ReturnType<typeof getRuntimeRegionalProfile>;

beforeEach(() => {
  previousProfile = getRuntimeRegionalProfile();
  setRuntimeRegionalProfile({
    ...previousProfile,
    languageTag: "en-GB",
    analysisTimeZone: "Europe/London",
    followDeviceTimeZone: false,
    glucoseUnit: "mmolL",
  });
});

afterEach(() => {
  setRuntimeRegionalProfile(previousProfile);
});

describe("Today therapy-state line", () => {
  it("words an active temporary target and profile with their recorded end", () => {
    const lines = nowTherapyStateLines([profile80, activityTarget], NOW, NOW - 2 * MINUTE);
    expect(lines.map(({ text }) => text)).toEqual([
      "Activity target until 11:30",
      "Profile 80% until 12:00",
    ]);
    expect(lines[0]!.detail).toBe(
      "Activity temporary target (target 8.0 mmol/L), recorded from 09:30, until 11:30.",
    );
    expect(lines[0]!.source).toBe("AAPS on this phone, sender confirmed");
  });

  it("says until next change for an open-ended state", () => {
    const loop = state({ id: "loop", kind: "loop-mode", loopMode: "open-loop", endBasis: "open", start: NOW - 3 * HOUR });
    const suspend = state({ id: "sus", kind: "pump-suspend", endBasis: "open", start: NOW - 10 * MINUTE });
    expect(therapyStateRecordedUntil(loop)).toBeUndefined();
    expect(nowTherapyStateLines([loop, suspend], NOW, NOW).map(({ text }) => text)).toEqual([
      "Pump suspended until next change",
      "Open loop until next change",
    ]);
  });

  it("shows nothing when there are no records or they are stale", () => {
    expect(nowTherapyStateLines(undefined, NOW, NOW)).toEqual([]);
    expect(nowTherapyStateLines([], NOW, NOW)).toEqual([]);
    expect(nowTherapyStateLines([activityTarget], NOW, undefined)).toEqual([]);
    expect(
      nowTherapyStateLines([activityTarget], NOW, NOW - NOW_THERAPY_STATE_MAX_AGE_MS - MINUTE),
    ).toEqual([]);
    expect(
      nowTherapyStateLines([activityTarget], NOW, NOW - NOW_THERAPY_STATE_MAX_AGE_MS),
    ).toHaveLength(1);
  });

  it("leaves out ended, future, baseline and exercise states", () => {
    const ended = state({ id: "ended", kind: "temporary-target", targetReason: "hypo", programmedDurationMs: 20 * MINUTE, start: NOW - HOUR, end: NOW - 40 * MINUTE });
    const cancelled = state({ id: "cancel", kind: "temporary-target", endBasis: "cancelled", start: NOW - HOUR, end: NOW - 5 * MINUTE });
    const replaced = state({ id: "next", kind: "profile-switch", percentage: 120, endBasis: "next-record", start: NOW - 2 * HOUR, end: NOW - HOUR });
    const future = state({ id: "future", kind: "temporary-target", targetReason: "eating-soon", programmedDurationMs: HOUR, start: NOW + 5 * MINUTE, end: NOW + 5 * MINUTE });
    const closedLoop = state({ id: "closed", kind: "loop-mode", loopMode: "closed-loop", baseline: true, endBasis: "open" });
    const exercise = state({ id: "ex", kind: "exercise", programmedDurationMs: HOUR });
    expect(nowTherapyStateLines([ended, cancelled, replaced, future, closedLoop, exercise], NOW, NOW)).toEqual([]);
  });

  it("ends exactly at the recorded end", () => {
    const endsNow = state({ id: "edge", kind: "temporary-target", targetReason: "activity", programmedDurationMs: 30 * MINUTE, start: NOW - 30 * MINUTE });
    expect(nowTherapyStateLines([endsNow], NOW, NOW)).toEqual([]);
    expect(nowTherapyStateLines([endsNow], NOW - MINUTE, NOW - MINUTE)).toHaveLength(1);
  });

  it("lists at most two overlapping states, most relevant first", () => {
    const suspend = state({ id: "sus", kind: "pump-suspend", endBasis: "open", start: NOW - 5 * MINUTE });
    const lines = nowTherapyStateLines([profile80, activityTarget, suspend], NOW, NOW);
    expect(lines.map(({ id }) => id)).toEqual(["sus", "tt"]);
  });

  it("prefers the most recent of two states of the same kind", () => {
    const older = state({ id: "older", kind: "temporary-target", targetReason: "hypo", programmedDurationMs: 2 * HOUR, start: NOW - HOUR });
    const newer = state({ id: "newer", kind: "temporary-target", targetReason: "eating-soon", programmedDurationMs: HOUR, start: NOW - 10 * MINUTE });
    expect(nowTherapyStateLines([older, newer], NOW, NOW)[0]!.text).toBe("Eating soon target until 10:50");
  });

  it("uses the analysis time zone and names the day when the end is not today", () => {
    setRuntimeRegionalProfile({
      ...getRuntimeRegionalProfile(),
      analysisTimeZone: "America/New_York",
    });
    // 05:00 in New York; ends 01:00 the next day there.
    const overnight = state({ id: "night", kind: "profile-switch", percentage: 90, programmedDurationMs: 20 * HOUR, start: NOW });
    const [line] = nowTherapyStateLines([overnight], NOW + MINUTE, NOW);
    expect(line!.text).toBe("Profile 90% until Wed 18 Nov 01:00");
    expect(line!.detail).toContain("recorded from 05:00");
  });

  it("describes a time shift without a percentage", () => {
    const shifted = state({ id: "shift", kind: "profile-switch", percentage: 100, timeshiftHours: 2, programmedDurationMs: HOUR });
    expect(nowTherapyStateLines([shifted], NOW, NOW)[0]!.text).toBe("Profile time shift +2 h until 10:30");
  });

  it("never words a line as advice", () => {
    const lines = nowTherapyStateLines([profile80, activityTarget], NOW, NOW);
    for (const line of lines) {
      expect(`${line.text} ${line.detail}`).not.toMatch(/\b(should|consider|try|increase|decrease|take|units?)\b/i);
    }
  });
});
