import { describe, expect, it } from "vitest";

import {
  buildMetricChartGeometry,
  healthMetricIntervalPresentation,
  healthMetricTrendWindowLabel,
  resolveDailyMetricDisplay,
  selectedTrendIndex,
  stepProgressStatus,
} from "@/components/healthMetrics/presentation";
import { zonedDateTimeToTimestamp } from "@/domain/time";

describe("health metric presentation", () => {
  it("does not carry an older daily value into a new selected day", () => {
    expect(
      resolveDailyMetricDisplay({
        history: [82, 93, undefined],
        selected: undefined,
      }),
    ).toEqual({ hasHistory: true, value: undefined });
  });

  it("shows a value genuinely recorded on the selected day", () => {
    expect(
      resolveDailyMetricDisplay({
        history: [82, 93, 88],
        selected: 88,
      }),
    ).toEqual({ hasHistory: true, value: 88 });
  });

  it("reports no history without inventing a zero", () => {
    expect(
      resolveDailyMetricDisplay({
        history: [undefined, undefined],
        selected: undefined,
      }),
    ).toEqual({ hasHistory: false, value: undefined });
  });

  it("opens detail on the page-selected day even when it has no record", () => {
    expect(selectedTrendIndex(7)).toBe(6);
  });

  it("restarts a line after a missing day instead of bridging the gap", () => {
    const geometry = buildMetricChartGeometry([4, 5, undefined, 7, 8], 100, 40);

    expect(geometry.path.match(/\bM\b/g)).toHaveLength(2);
    expect(geometry.path.match(/\bL\b/g)).toHaveLength(2);
    expect(geometry.points[2]).toBeUndefined();
  });

  it("names a historical seven-day window by its page end date", () => {
    const now = zonedDateTimeToTimestamp("2026-08-19", 12);

    expect(healthMetricTrendWindowLabel("2026-08-18", now)).toBe(
      "Seven days ending Tue 18 Aug",
    );
    expect(healthMetricTrendWindowLabel("2026-08-19", now)).toBe(
      "Last seven days",
    );
  });

  it("shows both dates for an interval that crosses the selected-day boundary", () => {
    const interval = healthMetricIntervalPresentation({
      start: zonedDateTimeToTimestamp("2026-08-18", 23, 30),
      end: zonedDateTimeToTimestamp("2026-08-19", 0, 15),
      selectedDate: "2026-08-19",
    });

    expect(interval).toEqual({
      startLabel: "Tue 18 Aug · 23:30",
      endLabel: "Wed 19 Aug · 00:15",
      accessibilityLabel: "From Tue 18 Aug · 23:30 to Wed 19 Aug · 00:15",
    });
  });

  it("keeps an interval wholly inside the selected day compact", () => {
    const interval = healthMetricIntervalPresentation({
      start: zonedDateTimeToTimestamp("2026-08-19", 13),
      end: zonedDateTimeToTimestamp("2026-08-19", 14, 30),
      selectedDate: "2026-08-19",
    });

    expect(interval).toEqual({
      startLabel: "13:00",
      endLabel: "14:30",
      accessibilityLabel: "From 13:00 to 14:30",
    });
  });

  it("uses the selected analysis zone for today's step pacing while travelling", () => {
    const now = Date.parse('2026-08-28T00:30:00Z');

    expect(
      stepProgressStatus({
        goal: 10_000,
        isToday: true,
        locale: 'en-US',
        now,
        steps: 5_000,
        timeZone: 'Pacific/Kiritimati',
      }),
    ).toBe('5,000 to goal');
    expect(
      stepProgressStatus({
        goal: 10_000,
        isToday: true,
        locale: 'en-US',
        now,
        steps: 5_000,
        timeZone: 'UTC',
      }),
    ).toBe('On track');
  });

  it("uses regional digits for a prior day's goal percentage", () => {
    expect(
      stepProgressStatus({
        goal: 100,
        isToday: false,
        locale: 'ar-EG',
        now: Date.now(),
        steps: 42,
        timeZone: 'Africa/Cairo',
      }),
    ).toBe('٤٢% of goal');
  });
});
