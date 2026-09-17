import { afterEach, describe, expect, it } from "vitest";

import {
  resolveTarvisIntentRange,
  type ResolvedTarvisIntentRange,
  type TarvisIntentRangeResolution,
} from "@/data/tarvis/intentRange";
import type {
  TarvisIntentField,
  TarvisIntentV1,
  TarvisTemporalScope,
} from "@/data/tarvis/intent";
import { type DateKey, zonedDateTimeToTimestamp } from "@/domain/time";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

const AS_OF = Date.parse("2026-08-07T20:00:00+01:00");

afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

function field<T>(value: T): TarvisIntentField<T> {
  return {
    value,
    provenance: {
      kind: "explicit",
      sourceText: "test",
      sourceStart: 0,
      sourceEnd: 4,
      turnId: null,
      note: null,
    },
  };
}

function intent(
  temporalScope: TarvisTemporalScope,
  options: {
    comparison?: "previous_equal_period" | "explicit_periods" | null;
    clockWindow?: TarvisIntentV1["clockWindow"];
  } = {},
): Pick<TarvisIntentV1, "temporalScope" | "clockWindow" | "comparison"> {
  return {
    temporalScope: field(temporalScope),
    clockWindow: options.clockWindow ?? null,
    comparison:
      options.comparison === undefined || options.comparison === null
        ? null
        : field({ kind: options.comparison }),
  };
}

function resolve(
  temporalScope: TarvisTemporalScope,
  options: {
    asOf?: number;
    comparison?: "previous_equal_period" | "explicit_periods" | null;
    clockWindow?: TarvisIntentV1["clockWindow"];
    timezone?: string;
  } = {},
) {
  return resolveTarvisIntentRange({
    intent: intent(temporalScope, options),
    asOf: options.asOf ?? AS_OF,
    timezone: options.timezone,
  });
}

function expectResolved(
  result: TarvisIntentRangeResolution,
): ResolvedTarvisIntentRange {
  expect(result.status).toBe("resolved");
  if (result.status !== "resolved") {
    throw new Error(`Expected resolved range, received ${result.status}`);
  }
  expect(result.intervalConvention).toBe("half-open");
  expect(result.current.end).toBeLessThanOrEqual(result.asOf);
  expect(result.current.end).toBeGreaterThan(result.current.start);
  return result;
}

function midnight(date: string) {
  return zonedDateTimeToTimestamp(date as DateKey);
}

describe("Tarv1s exact non-recurring intent ranges", () => {
  it.each([
    ["minute", 90, 90 * 60_000],
    ["hour", 36, 36 * 60 * 60_000],
    ["day", 3, 3 * 24 * 60 * 60_000],
    ["week", 2, 2 * 7 * 24 * 60 * 60_000],
  ] as const)(
    "resolves rolling %s scopes as exact elapsed duration",
    (unit, amount, duration) => {
      const result = expectResolved(
        resolve({ kind: "rolling", unit, amount, anchor: "now" }),
      );
      expect(result.current).toEqual({
        start: AS_OF - duration,
        end: AS_OF,
      });
      expect(result.currentCappedAtAsOf).toBe(false);
    },
  );

  it.each([
    ["America/New_York", "2026-08-07T20:00:00-04:00", "2026-08-06T20:00:00-04:00"],
    ["Asia/Tokyo", "2026-08-08T09:00:00+09:00", "2026-08-07T09:00:00+09:00"],
  ] as const)(
    "matches ordinary previous-day wall-clock progress in %s",
    (timeZone, asOfText, expectedEndText) => {
      setRuntimeRegionalProfile({
        ...DEFAULT_REGIONAL_PROFILE,
        analysisTimeZone: timeZone,
        followDeviceTimeZone: false,
      });
      const asOf = Date.parse(asOfText);
      const result = expectResolved(
        resolve(
          { kind: "calendar_period", period: "today" },
          { comparison: "previous_equal_period", asOf, timezone: timeZone },
        ),
      );

      expect(result.previous).toEqual({
        start: zonedDateTimeToTimestamp(
          (timeZone === "Asia/Tokyo" ? "2026-08-07" : "2026-08-06") as DateKey,
          0,
          0,
          0,
          timeZone,
        ),
        end: Date.parse(expectedEndText),
      });
      expect(result.timezone).toBe(timeZone);
      expect(result.comparisonBasis).toBe("matching_local_wall_clock_progress");
    },
  );

  it("resolves recent local days through now from London midnight", () => {
    const result = expectResolved(
      resolve({
        kind: "recent_local_days",
        count: 3,
        include: "through_now",
      }),
    );
    expect(result.current).toEqual({
      start: midnight("2026-08-05"),
      end: AS_OF,
    });
    expect(result.currentCappedAtAsOf).toBe(true);
  });

  it("resolves the requested number of completed local days", () => {
    const result = expectResolved(
      resolve({
        kind: "recent_local_days",
        count: 3,
        include: "completed_days",
      }),
    );
    expect(result.current).toEqual({
      start: midnight("2026-08-04"),
      end: midnight("2026-08-07"),
    });
    expect(result.currentCappedAtAsOf).toBe(false);
  });

  it("uses actual 23-hour and 25-hour London calendar days", () => {
    const springAsOf = Date.parse("2026-03-30T12:00:00+01:00");
    const spring = expectResolved(
      resolve(
        {
          kind: "recent_local_days",
          count: 2,
          include: "completed_days",
        },
        { asOf: springAsOf },
      ),
    );
    expect(spring.current).toEqual({
      start: midnight("2026-03-28"),
      end: midnight("2026-03-30"),
    });
    expect(spring.current.end - spring.current.start).toBe(47 * 60 * 60_000);

    const autumnAsOf = Date.parse("2026-10-26T12:00:00Z");
    const autumn = expectResolved(
      resolve(
        {
          kind: "recent_local_days",
          count: 2,
          include: "completed_days",
        },
        { asOf: autumnAsOf },
      ),
    );
    expect(autumn.current.end - autumn.current.start).toBe(49 * 60 * 60_000);
  });

  it.each([
    ["today", { start: midnight("2026-08-07"), end: AS_OF }, true],
    [
      "yesterday",
      { start: midnight("2026-08-06"), end: midnight("2026-08-07") },
      false,
    ],
    ["this_week", { start: midnight("2026-08-03"), end: AS_OF }, true],
    [
      "last_week",
      { start: midnight("2026-07-27"), end: midnight("2026-08-03") },
      false,
    ],
    ["this_month", { start: midnight("2026-08-01"), end: AS_OF }, true],
    [
      "last_month",
      { start: midnight("2026-07-01"), end: midnight("2026-08-01") },
      false,
    ],
  ] as const)(
    "resolves the %s local-calendar boundary",
    (period, expected, capped) => {
      const result = expectResolved(
        resolve({ kind: "calendar_period", period }),
      );
      expect(result.current).toEqual(expected);
      expect(result.currentCappedAtAsOf).toBe(capped);
    },
  );

  it("resolves exact dates and treats the end as exclusive", () => {
    const result = expectResolved(
      resolve({ kind: "calendar_date", date: "2026-08-06" }),
    );
    expect(result.current).toEqual({
      start: midnight("2026-08-06"),
      end: midnight("2026-08-07"),
    });
  });

  it("caps an exact current local date at asOf", () => {
    const result = expectResolved(
      resolve({ kind: "calendar_date", date: "2026-08-07" }),
    );
    expect(result.current).toEqual({
      start: midnight("2026-08-07"),
      end: AS_OF,
    });
    expect(result.currentCappedAtAsOf).toBe(true);
  });

  it("resolves inclusive local date ranges to an exclusive next-midnight end", () => {
    const result = expectResolved(
      resolve({
        kind: "calendar_date_range",
        startDate: "2026-08-03",
        endDate: "2026-08-05",
        inclusiveEndDate: true,
      }),
    );
    expect(result.current).toEqual({
      start: midnight("2026-08-03"),
      end: midnight("2026-08-06"),
    });
  });

  it("caps an inclusive range ending today but rejects future dates", () => {
    const current = expectResolved(
      resolve({
        kind: "calendar_date_range",
        startDate: "2026-08-06",
        endDate: "2026-08-07",
        inclusiveEndDate: true,
      }),
    );
    expect(current.current.end).toBe(AS_OF);
    expect(current.currentCappedAtAsOf).toBe(true);

    expect(
      resolve({ kind: "calendar_date", date: "2026-08-08" }),
    ).toMatchObject({ status: "rejected", code: "future_range" });
    expect(
      resolve({
        kind: "calendar_date_range",
        startDate: "2026-08-07",
        endDate: "2026-08-08",
        inclusiveEndDate: true,
      }),
    ).toMatchObject({ status: "rejected", code: "future_range" });
  });
});

describe("Tarv1s previous-period semantics", () => {
  const comparison = { comparison: "previous_equal_period" as const };

  it("uses an adjacent equal elapsed interval only for rolling scopes", () => {
    const result = expectResolved(
      resolve(
        { kind: "rolling", amount: 36, unit: "hour", anchor: "now" },
        comparison,
      ),
    );
    const duration = 36 * 60 * 60_000;
    expect(result.previous).toEqual({
      start: AS_OF - duration * 2,
      end: AS_OF - duration,
    });
    expect(result.comparisonBasis).toBe("adjacent_equal_elapsed_time");
  });

  it("keeps recent-day comparison boundaries on London midnights over DST", () => {
    const asOf = Date.parse("2026-03-30T12:00:00+01:00");
    const result = expectResolved(
      resolve(
        {
          kind: "recent_local_days",
          count: 2,
          include: "completed_days",
        },
        { ...comparison, asOf },
      ),
    );
    expect(result.current).toEqual({
      start: midnight("2026-03-28"),
      end: midnight("2026-03-30"),
    });
    expect(result.previous).toEqual({
      start: midnight("2026-03-26"),
      end: midnight("2026-03-28"),
    });
    expect(result.current.end - result.current.start).toBe(47 * 60 * 60_000);
    expect(result.previous!.end - result.previous!.start).toBe(
      48 * 60 * 60_000,
    );
    expect(result.comparisonBasis).toBe("adjacent_local_calendar_days");
  });

  it("uses the same number of adjacent local dates for an explicit date range", () => {
    const result = expectResolved(
      resolve(
        {
          kind: "calendar_date_range",
          startDate: "2026-08-05",
          endDate: "2026-08-06",
          inclusiveEndDate: true,
        },
        comparison,
      ),
    );
    expect(result.previous).toEqual({
      start: midnight("2026-08-03"),
      end: midnight("2026-08-05"),
    });
    expect(result.comparisonBasis).toBe("adjacent_local_calendar_days");
  });

  it("maps last week to the preceding London calendar week", () => {
    const result = expectResolved(
      resolve({ kind: "calendar_period", period: "last_week" }, comparison),
    );
    expect(result.previous).toEqual({
      start: midnight("2026-07-20"),
      end: midnight("2026-07-27"),
    });
    expect(result.comparisonBasis).toBe("previous_local_calendar_week");
  });

  it("starts a US week on Sunday", () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: "us",
      countryCode: "US",
      languageTag: "en-US",
      analysisTimeZone: "America/New_York",
      followDeviceTimeZone: false,
    });
    const asOf = Date.parse("2026-08-30T12:00:00-04:00");
    const result = expectResolved(
      resolve(
        { kind: "calendar_period", period: "this_week" },
        { asOf, timezone: "America/New_York" },
      ),
    );

    expect(result.current).toEqual({
      start: Date.parse("2026-08-30T00:00:00-04:00"),
      end: asOf,
    });
  });

  it("starts a Saturday-first locale's week on Saturday", () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: "other",
      countryCode: "IR",
      languageTag: "fa-IR",
      analysisTimeZone: "Asia/Tehran",
      followDeviceTimeZone: false,
    });
    const asOf = Date.parse("2026-08-29T12:00:00+03:30");
    const result = expectResolved(
      resolve(
        { kind: "calendar_period", period: "this_week" },
        { asOf, timezone: "Asia/Tehran" },
      ),
    );

    expect(result.current).toEqual({
      start: Date.parse("2026-08-29T00:00:00+03:30"),
      end: asOf,
    });
  });

  it("maps last month to the complete preceding calendar month", () => {
    const result = expectResolved(
      resolve({ kind: "calendar_period", period: "last_month" }, comparison),
    );
    expect(result.previous).toEqual({
      start: midnight("2026-06-01"),
      end: midnight("2026-07-01"),
    });
    expect(result.comparisonBasis).toBe("previous_local_calendar_month");
  });

  it.each([
    ["today", "2026-08-06", "2026-08-06T20:00:00+01:00"],
    ["this_week", "2026-07-27", "2026-07-31T20:00:00+01:00"],
    ["this_month", "2026-07-01", "2026-07-07T20:00:00+01:00"],
  ] as const)(
    "matches local wall-clock progress for partial %s",
    (period, expectedStart, expectedEnd) => {
      const result = expectResolved(
        resolve({ kind: "calendar_period", period }, comparison),
      );
      expect(result.previous).toEqual({
        start: midnight(expectedStart),
        end: Date.parse(expectedEnd),
      });
      expect(result.comparisonBasis).toBe("matching_local_wall_clock_progress");
    },
  );

  it("fails closed when matching yesterday lands in a spring clock gap", () => {
    const asOf = Date.parse("2026-03-30T01:30:00+01:00");
    expect(
      resolve(
        { kind: "calendar_period", period: "today" },
        { ...comparison, asOf },
      ),
    ).toMatchObject({ status: "rejected", code: "nonexistent_local_time" });
  });

  it("fails closed when matching yesterday lands in an autumn clock fold", () => {
    const asOf = Date.parse("2026-10-26T01:30:00Z");
    expect(
      resolve(
        { kind: "calendar_period", period: "today" },
        { ...comparison, asOf },
      ),
    ).toMatchObject({ status: "rejected", code: "ambiguous_local_time" });
  });

  it("fails closed when this-month progress has no date in the previous month", () => {
    const asOf = Date.parse("2026-03-31T12:00:00+01:00");
    expect(
      resolve(
        { kind: "calendar_period", period: "this_month" },
        { ...comparison, asOf },
      ),
    ).toMatchObject({
      status: "rejected",
      code: "unrepresentable_calendar_progress",
    });
  });
});

describe("Tarv1s temporal fail-closed routing", () => {
  it("delegates every recurring clock-window intent", () => {
    const result = resolve(
      {
        kind: "recent_local_days",
        count: 3,
        include: "most_recent_completed_windows",
      },
      {
        clockWindow: field({
          start: { hour: 0, minute: 0 },
          end: { hour: 7, minute: 0 },
          crossesMidnight: false,
          occurrenceAnchor: "start_date",
        }),
      },
    );
    expect(result).toEqual({
      status: "delegate",
      schemaVersion: 1,
      code: "recurring_clock_window",
      delegateTo: "scoped-glucose-recurring-window",
      message:
        "Recurring local-clock windows must use the dedicated DST-aware scoped-query resolver.",
    });
  });

  it("rejects a completed-window scope missing its clock window", () => {
    expect(
      resolve({
        kind: "recent_local_days",
        count: 3,
        include: "most_recent_completed_windows",
      }),
    ).toMatchObject({ status: "rejected", code: "clock_window_required" });
  });

  it("rejects invalid, reversed, empty, and unsupported ranges", () => {
    expect(
      resolve({ kind: "calendar_date", date: "2026-02-30" }),
    ).toMatchObject({ status: "rejected", code: "invalid_scope" });
    expect(
      resolve({
        kind: "calendar_date_range",
        startDate: "2026-08-06",
        endDate: "2026-08-03",
        inclusiveEndDate: true,
      }),
    ).toMatchObject({ status: "rejected", code: "reversed_range" });
    expect(
      resolve(
        { kind: "calendar_period", period: "today" },
        { asOf: midnight("2026-08-07") },
      ),
    ).toMatchObject({ status: "rejected", code: "empty_range" });
    expect(
      resolve(
        { kind: "calendar_period", period: "today" },
        { comparison: "explicit_periods" },
      ),
    ).toMatchObject({
      status: "rejected",
      code: "unsupported_comparison",
    });
  });

  it("rejects invalid runtime options and impossible rolling spans", () => {
    expect(
      resolve(
        { kind: "rolling", amount: 1, unit: "hour", anchor: "now" },
        { timezone: "UTC" },
      ),
    ).toMatchObject({ status: "rejected", code: "unsupported_timezone" });
    expect(
      resolve(
        { kind: "rolling", amount: 1, unit: "hour", anchor: "now" },
        { asOf: Number.NaN },
      ),
    ).toMatchObject({ status: "rejected", code: "invalid_as_of" });
    expect(
      resolve(
        { kind: "rolling", amount: 2, unit: "day", anchor: "now" },
        { asOf: 60_000 },
      ),
    ).toMatchObject({ status: "rejected", code: "invalid_range" });
    expect(
      resolve({
        kind: "recent_local_days",
        count: 0,
        include: "completed_days",
      }),
    ).toMatchObject({ status: "rejected", code: "invalid_scope" });
  });
});
