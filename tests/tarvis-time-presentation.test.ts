import { afterEach, describe, expect, it } from "vitest";

import { formatTarvisRequestedPeriod } from "@/data/tarvis/timePresentation";
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
