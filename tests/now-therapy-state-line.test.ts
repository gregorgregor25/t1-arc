import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NOW_CARD_CLOCK_AHEAD_MS,
  NOW_THERAPY_STATE_MAX_AGE_MS,
  nowTherapyStateLines,
  therapyStateRecordedUntil,
  therapyStateRouteActivity,
  therapyStateRouteIsCurrent,
} from "@/components/nowCardPresentation";
import {
  getRuntimeRegionalProfile,
  setRuntimeRegionalProfile,
} from "@/domain/regionalProfileRuntime";
import {
  therapyStatesForRange,
  type TherapyStateInterval,
  type TherapyStateRawRecord,
  type TherapyStateSourceRef,
} from "@/domain/therapyStates";

const MINUTE = 60_000;
/** Route activity where only AAPS on this phone has been seen, at `at`. */
const local = (at: number) => ({ "aaps-local": at });
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
    const lines = nowTherapyStateLines([profile80, activityTarget], NOW, local(NOW - 2 * MINUTE));
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
    expect(nowTherapyStateLines([loop, suspend], NOW, local(NOW)).map(({ text }) => text)).toEqual([
      "Pump suspended until next change",
      "Open loop until next change",
    ]);
  });

  it("shows nothing when there are no records or they are stale", () => {
    expect(nowTherapyStateLines(undefined, NOW, local(NOW))).toEqual([]);
    expect(nowTherapyStateLines([], NOW, local(NOW))).toEqual([]);
    expect(nowTherapyStateLines([activityTarget], NOW, undefined)).toEqual([]);
    expect(
      nowTherapyStateLines([activityTarget], NOW, local(NOW - NOW_THERAPY_STATE_MAX_AGE_MS - MINUTE)),
    ).toEqual([]);
    expect(
      nowTherapyStateLines([activityTarget], NOW, local(NOW - NOW_THERAPY_STATE_MAX_AGE_MS)),
    ).toHaveLength(1);
  });

  it("leaves out ended, future, baseline and exercise states", () => {
    const ended = state({ id: "ended", kind: "temporary-target", targetReason: "hypo", programmedDurationMs: 20 * MINUTE, start: NOW - HOUR, end: NOW - 40 * MINUTE });
    const cancelled = state({ id: "cancel", kind: "temporary-target", endBasis: "cancelled", start: NOW - HOUR, end: NOW - 5 * MINUTE });
    const replaced = state({ id: "next", kind: "profile-switch", percentage: 120, endBasis: "next-record", start: NOW - 2 * HOUR, end: NOW - HOUR });
    const future = state({ id: "future", kind: "temporary-target", targetReason: "eating-soon", programmedDurationMs: HOUR, start: NOW + 5 * MINUTE, end: NOW + 5 * MINUTE });
    const closedLoop = state({ id: "closed", kind: "loop-mode", loopMode: "closed-loop", baseline: true, endBasis: "open" });
    const exercise = state({ id: "ex", kind: "exercise", programmedDurationMs: HOUR });
    expect(nowTherapyStateLines([ended, cancelled, replaced, future, closedLoop, exercise], NOW, local(NOW))).toEqual([]);
  });

  it("ends exactly at the recorded end", () => {
    const endsNow = state({ id: "edge", kind: "temporary-target", targetReason: "activity", programmedDurationMs: 30 * MINUTE, start: NOW - 30 * MINUTE });
    expect(nowTherapyStateLines([endsNow], NOW, local(NOW))).toEqual([]);
    expect(nowTherapyStateLines([endsNow], NOW - MINUTE, local(NOW - MINUTE))).toHaveLength(1);
  });

  it("lists at most two overlapping states, most relevant first", () => {
    const suspend = state({ id: "sus", kind: "pump-suspend", endBasis: "open", start: NOW - 5 * MINUTE });
    const lines = nowTherapyStateLines([profile80, activityTarget, suspend], NOW, local(NOW));
    expect(lines.map(({ id }) => id)).toEqual(["sus", "tt"]);
  });

  it("prefers the most recent of two states of the same kind", () => {
    const older = state({ id: "older", kind: "temporary-target", targetReason: "hypo", programmedDurationMs: 2 * HOUR, start: NOW - HOUR });
    const newer = state({ id: "newer", kind: "temporary-target", targetReason: "eating-soon", programmedDurationMs: HOUR, start: NOW - 10 * MINUTE });
    expect(nowTherapyStateLines([older, newer], NOW, local(NOW))[0]!.text).toBe("Eating soon target until 10:50");
  });

  it("uses the analysis time zone and names the day when the end is not today", () => {
    setRuntimeRegionalProfile({
      ...getRuntimeRegionalProfile(),
      analysisTimeZone: "America/New_York",
    });
    // 05:00 in New York; ends 01:00 the next day there.
    const overnight = state({ id: "night", kind: "profile-switch", percentage: 90, programmedDurationMs: 20 * HOUR, start: NOW });
    const [line] = nowTherapyStateLines([overnight], NOW + MINUTE, local(NOW));
    expect(line!.text).toBe("Profile 90% until Wed 18 Nov 01:00");
    expect(line!.detail).toContain("recorded from 05:00");
  });

  it("describes a time shift without a percentage", () => {
    const shifted = state({ id: "shift", kind: "profile-switch", percentage: 100, timeshiftHours: 2, programmedDurationMs: HOUR });
    expect(nowTherapyStateLines([shifted], NOW, local(NOW))[0]!.text).toBe("Profile time shift +2 h until 10:30");
  });

  it("never words a line as advice", () => {
    const lines = nowTherapyStateLines([profile80, activityTarget], NOW, local(NOW));
    for (const line of lines) {
      expect(`${line.text} ${line.detail}`).not.toMatch(/\b(should|consider|try|increase|decrease|take|units?)\b/i);
    }
  });
});

const NIGHTSCOUT: TherapyStateSourceRef = {
  rawRecordId: "ns-raw",
  sourceId: "nightscout",
  sourceFile: "Nightscout API treatments and profile",
};
const LOCAL: TherapyStateSourceRef = {
  rawRecordId: "local-raw",
  sourceId: "aaps-local",
  sourceFile: "AAPS broadcast (sender confirmed)",
};

const nightscoutSuspend = state({
  id: "ns-sus",
  kind: "pump-suspend",
  endBasis: "open",
  start: NOW - 20 * MINUTE,
  source: NIGHTSCOUT,
});

describe("Today therapy-state line: per-route freshness", () => {
  it("hides a Nightscout-only state while only AAPS on this phone is current", () => {
    const activity = { nightscout: NOW - 2 * HOUR, "aaps-local": NOW - MINUTE };
    expect(nowTherapyStateLines([nightscoutSuspend], NOW, activity)).toEqual([]);
  });

  it("shows a Nightscout state after a recent Nightscout treatment sync", () => {
    const lines = nowTherapyStateLines([nightscoutSuspend], NOW, { nightscout: NOW - 5 * MINUTE });
    expect(lines.map(({ text }) => text)).toEqual(["Pump suspended until next change"]);
  });

  it("shows a state when a duplicate copy arrived through a current route", () => {
    const copied = { ...nightscoutSuspend, duplicateSources: [LOCAL] };
    const activity = { nightscout: NOW - 2 * HOUR, "aaps-local": NOW - MINUTE };
    expect(nowTherapyStateLines([copied], NOW, activity)).toHaveLength(1);
  });

  it("hides states whose route freshness is unknown", () => {
    expect(nowTherapyStateLines([nightscoutSuspend], NOW, {})).toEqual([]);
    expect(nowTherapyStateLines([nightscoutSuspend], NOW, undefined)).toEqual([]);
    expect(nowTherapyStateLines([nightscoutSuspend], NOW, { "aaps-local": NOW })).toEqual([]);
    expect(nowTherapyStateLines([activityTarget], NOW, { nightscout: NOW })).toEqual([]);
    expect(nowTherapyStateLines([activityTarget], NOW, { "aaps-local": Number.NaN })).toEqual([]);
  });

  it("hides an older state when another current route has a newer one of the same kind", () => {
    const olderRemote = state({
      id: "ns-tt",
      kind: "temporary-target",
      targetReason: "activity",
      programmedDurationMs: 2 * HOUR,
      start: NOW - 40 * MINUTE,
      source: NIGHTSCOUT,
    });
    const newerLocal = state({
      id: "local-tt",
      kind: "temporary-target",
      targetReason: "eating-soon",
      programmedDurationMs: HOUR,
      start: NOW - 10 * MINUTE,
      source: LOCAL,
    });
    const both = { nightscout: NOW - MINUTE, "aaps-local": NOW - MINUTE };
    expect(nowTherapyStateLines([olderRemote, newerLocal], NOW, both).map(({ id }) => id)).toEqual(["local-tt"]);
    // A newer record from a route that is not current does not count.
    const remoteOnly = { nightscout: NOW - MINUTE, "aaps-local": NOW - 2 * HOUR };
    expect(nowTherapyStateLines([olderRemote, newerLocal], NOW, remoteOnly).map(({ id }) => id)).toEqual(["ns-tt"]);
  });

  it("ends a Nightscout suspension at a later resume received on this phone", () => {
    const raw = (id: string, sourceId: string, payload: Record<string, unknown>): TherapyStateRawRecord => ({
      id,
      sourceId,
      sourceFile: sourceId === "nightscout" ? NIGHTSCOUT.sourceFile : LOCAL.sourceFile,
      recordKind: sourceId === "nightscout" ? "nightscout-treatment" : "aaps-local-treatment",
      payloadJson: JSON.stringify(payload),
    });
    const records = [
      raw("ns-1", "nightscout", { eventType: "Pump Suspend", date: NOW - 20 * MINUTE }),
      raw("local-1", "aaps-local", { eventType: "Pump Resume", date: NOW - 5 * MINUTE }),
    ];
    const range = { start: NOW - 6 * HOUR, end: NOW };
    const fresh = { nightscout: NOW - MINUTE, "aaps-local": NOW - MINUTE };
    expect(nowTherapyStateLines(therapyStatesForRange(records, range, NOW), NOW, fresh)).toEqual([]);
    // Without the resume, the same suspension shows.
    const suspendedOnly = therapyStatesForRange(records.slice(0, 1), range, NOW);
    expect(nowTherapyStateLines(suspendedOnly, NOW, fresh).map(({ text }) => text)).toEqual([
      "Pump suspended until next change",
    ]);
  });
});

describe("Today therapy-state line: clock ahead", () => {
  it("does not treat route activity dated ahead of the phone clock as current", () => {
    expect(therapyStateRouteIsCurrent(NOW + HOUR, NOW)).toBe(false);
    expect(therapyStateRouteIsCurrent(NOW + NOW_CARD_CLOCK_AHEAD_MS + 1, NOW)).toBe(false);
    expect(therapyStateRouteIsCurrent(NOW + NOW_CARD_CLOCK_AHEAD_MS, NOW)).toBe(true);
    expect(nowTherapyStateLines([activityTarget], NOW, local(NOW + HOUR))).toEqual([]);
    expect(nowTherapyStateLines([nightscoutSuspend], NOW, { nightscout: NOW + HOUR })).toEqual([]);
  });

  it("drops a glucose reading dated an hour ahead before capping it to the read time", () => {
    const activity = therapyStateRouteActivity({
      now: NOW,
      readThrough: NOW,
      aapsLocalReadingAt: NOW + HOUR,
      aapsLocalTreatmentRouteOn: true,
    });
    expect(activity).toEqual({});
    expect(nowTherapyStateLines([activityTarget], NOW, activity)).toEqual([]);
  });
});

describe("Today therapy-state route activity", () => {
  it("uses the Nightscout treatment sync for Nightscout and local AAPS data for this phone", () => {
    expect(
      therapyStateRouteActivity({
        now: NOW,
        readThrough: NOW,
        nightscoutTreatmentSyncAt: NOW - 3 * MINUTE,
        aapsLocalTreatmentsReceivedAt: NOW - 50 * MINUTE,
        aapsLocalReadingAt: NOW - MINUTE,
        aapsLocalTreatmentRouteOn: true,
      }),
    ).toEqual({ nightscout: NOW - 3 * MINUTE, "aaps-local": NOW - MINUTE });
  });

  it("ignores AAPS glucose on this phone while the AAPS treatment route is off", () => {
    expect(
      therapyStateRouteActivity({
        now: NOW,
        readThrough: NOW,
        aapsLocalReadingAt: NOW - MINUTE,
        aapsLocalTreatmentRouteOn: false,
      }),
    ).toEqual({});
  });

  it("caps activity at the time the states were read, so an old load looks old", () => {
    const activity = therapyStateRouteActivity({
      now: NOW,
      readThrough: NOW - 40 * MINUTE,
      nightscoutTreatmentSyncAt: NOW - MINUTE,
    });
    expect(activity).toEqual({ nightscout: NOW - 40 * MINUTE });
    expect(nowTherapyStateLines([nightscoutSuspend], NOW, activity)).toEqual([]);
  });

  it("keeps a time up to two minutes ahead, capped at the read time", () => {
    const activity = therapyStateRouteActivity({
      now: NOW,
      readThrough: NOW,
      nightscoutTreatmentSyncAt: NOW + NOW_CARD_CLOCK_AHEAD_MS,
    });
    expect(activity).toEqual({ nightscout: NOW });
  });
});
