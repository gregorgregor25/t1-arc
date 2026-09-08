import { afterEach, describe, expect, it } from "vitest";

import { formatTarvisCompactPeriod, formatTarvisRequestedPeriod, tarvisComparisonDurationNote } from "@/data/tarvis/timePresentation";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

const US_PROFILE = {
  ...DEFAULT_REGIONAL_PROFILE,
  region: "us" as const,
  countryCode: "US" as const,
  languageTag: "en-US",
  analysisTimeZone: "America/New_York",
  followDeviceTimeZone: false,
};

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

describe("Tarv1s requested-period presentation", () => {
  it("keeps compact answers dated and makes the unfinished day explicit", () => {
    expect(formatTarvisCompactPeriod({
      start: Date.parse("2026-09-02T00:00:00+01:00"), end: Date.parse("2026-09-08T17:12:00+01:00"),
    })).toBe("2 Sept 2026 to 8 Sept 2026, through 17:12");
  });
  it("preserves both clock boundaries for rolling windows", () => {
    expect(formatTarvisCompactPeriod({
      start: Date.parse("2026-09-07T17:12:00+01:00"), end: Date.parse("2026-09-08T17:12:00+01:00"),
    })).toBe("7 Sept 2026 17:12 to 8 Sept 2026 17:12");
  });
  it("explains an unfinished September period without inventing a clock change", () => {
    const note = tarvisComparisonDurationNote({
      current: { start: Date.parse("2026-09-02T00:00:00+01:00"), end: Date.parse("2026-09-08T17:12:00+01:00") },
      previous: { start: Date.parse("2026-08-26T00:00:00+01:00"), end: Date.parse("2026-09-02T00:00:00+01:00") },
      currentCappedAtAsOf: true,
    });
    expect(note).toContain("ends at the time you asked");
    expect(note).toContain("161.2 versus 168 hours");
    expect(note).not.toContain("clocks changed");
  });

  it.each([
    ["2026-03-29T00:00:00Z", "2026-03-29T23:00:00Z", "2026-03-28T00:00:00Z", "23 versus 24"],
    ["2026-10-24T23:00:00Z", "2026-10-26T00:00:00Z", "2026-10-23T23:00:00Z", "25 versus 24"],
    ["2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z", "2026-03-01T00:00:00Z", "720 versus 744"],
  ])("reports actual calendar lengths without guessing their cause", (start, end, previousStart, hours) => {
    const note = tarvisComparisonDurationNote({
      current: { start: Date.parse(start), end: Date.parse(end) },
      previous: { start: Date.parse(previousStart), end: Date.parse(start) },
      currentCappedAtAsOf: false,
    });
    expect(note).toContain(hours);
    expect(note).not.toMatch(/clocks changed|time you asked/);
  });

  it("does not warn for equal durations or a single period", () => {
    const current = { start: 0, end: 24 * 3_600_000 };
    expect(tarvisComparisonDurationNote({ current, previous: null, currentCappedAtAsOf: false })).toBeNull();
    expect(tarvisComparisonDurationNote({ current, previous: current, currentCappedAtAsOf: true })).toBeNull();
  });
  it("does not claim that two identically displayed durations differ", () => {
    const previous = { start: 0, end: 168 * 3_600_000 };
    const current = { start: previous.end, end: previous.end * 2 - 1 };
    expect(tarvisComparisonDurationNote({ current, previous, currentCappedAtAsOf: true })).toBeNull();
  });
  it("recognises a whole en-US calendar day without relying on its time text", () => {
    setRuntimeRegionalProfile(US_PROFILE);

    expect(
      formatTarvisRequestedPeriod({
        start: Date.parse("2026-08-15T00:00:00-04:00"),
        end: Date.parse("2026-08-16T00:00:00-04:00"),
      }),
    ).toBe("Saturday, August 15, 2026");
  });

  it.each([
    {
      start: "2026-03-08T00:00:00-05:00",
      end: "2026-03-09T00:00:00-04:00",
      expected: "Sunday, March 8, 2026",
    },
    {
      start: "2026-11-01T00:00:00-04:00",
      end: "2026-11-02T00:00:00-05:00",
      expected: "Sunday, November 1, 2026",
    },
  ])("recognises a whole DST-transition day", ({ start, end, expected }) => {
    setRuntimeRegionalProfile(US_PROFILE);

    expect(
      formatTarvisRequestedPeriod({
        start: Date.parse(start),
        end: Date.parse(end),
      }),
    ).toBe(expected);
  });
});
