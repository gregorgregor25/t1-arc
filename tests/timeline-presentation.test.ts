import { describe, expect, it } from "vitest";

import {
  formatTimelineEndTimestamp,
  formatTimelineEntryTimestamp,
  formatTimelineInspectionTimestamp,
  formatTimelineRange,
  inspectionTimestampForRange,
  rangeSpansMultipleDates,
  resolveTimelineLayerAvailability,
  timelineInspectorInsulinParts,
  timelineTickTimestamp,
  timelineTimestampAtX,
} from "@/domain/timelinePresentation";
import { zonedDateTimeToTimestamp } from "@/domain/time";

describe("timeline presentation", () => {
  it("clears an inspected timestamp when a disjoint range is selected", () => {
    expect(
      inspectionTimestampForRange(1_500, { start: 1_000, end: 2_000 }),
    ).toBe(1_500);
    expect(
      inspectionTimestampForRange(1_500, { start: 2_000, end: 3_000 }),
    ).toBeUndefined();
    expect(
      inspectionTimestampForRange(2_000, { start: 1_000, end: 2_000 }),
    ).toBeUndefined();
  });
  it("keeps the raw tapped time instead of snapping to a distant glucose", () => {
    const start = zonedDateTimeToTimestamp("2026-08-19", 0);
    const end = zonedDateTimeToTimestamp("2026-08-19", 6);
    expect(
      timelineTimestampAtX({
        location: 55,
        plotLeft: 10,
        plotRight: 100,
        range: { start, end },
      }),
    ).toBe(zonedDateTimeToTimestamp("2026-08-19", 3) - 0.5);
    expect(
      timelineTimestampAtX({
        location: 100,
        plotLeft: 10,
        plotRight: 100,
        range: { start, end },
      }),
    ).toBe(end - 1);
  });

  it("keeps the final chart tick inside an exclusive historical range", () => {
    const range = {
      start: zonedDateTimeToTimestamp("2026-08-18", 0),
      end: zonedDateTimeToTimestamp("2026-08-19", 0),
    };

    expect(timelineTickTimestamp(range, 0, 4)).toBe(range.start);
    expect(timelineTickTimestamp(range, 3, 4)).toBe(range.end - 1);
  });

  it("includes the date in inspected values", () => {
    expect(
      formatTimelineInspectionTimestamp(
        zonedDateTimeToTimestamp("2026-08-19", 0, 18),
      ),
    ).toBe("Wed 19 Aug · 00:18");
  });

  it("names both dates for a multi-day chart", () => {
    const range = {
      start: zonedDateTimeToTimestamp("2026-08-17", 0),
      end: zonedDateTimeToTimestamp("2026-08-19", 0, 18),
    };
    expect(rangeSpansMultipleDates(range)).toBe(true);
    expect(formatTimelineRange(range)).toBe(
      "Mon 17 Aug 00:00 – Wed 19 Aug 00:18",
    );
  });

  it("renders an exclusive midnight boundary as the end of its visible day", () => {
    expect(
      formatTimelineRange({
        start: zonedDateTimeToTimestamp("2026-08-18", 0),
        end: zonedDateTimeToTimestamp("2026-08-19", 0),
      }),
    ).toBe("Tue 18 Aug · 00:00–23:59");
  });

  it("adds dates to multi-day entries and overnight end times", () => {
    const start = zonedDateTimeToTimestamp("2026-08-18", 23, 30);
    const end = zonedDateTimeToTimestamp("2026-08-19", 1, 15);
    expect(formatTimelineEntryTimestamp(start, true)).toBe(
      "Tue 18 Aug · 23:30",
    );
    expect(formatTimelineEndTimestamp(start, end)).toBe("Wed 19 Aug · 01:15");
  });

  it("exposes only layers backed by records in the selected range", () => {
    const dailyTotal = {
      id: "total",
      timestamp: 1,
      dateKey: "2026-08-18",
      basalUnits: 12,
      totalUnits: 12,
      sourceId: "glooko",
    };
    expect(
      resolveTimelineLayerAvailability({
        glucoseCount: 0,
        basalCount: 0,
        bolusCount: 0,
        dailyTotals: [dailyTotal],
        pumpStates: [],
      }),
    ).toEqual({
      glucose: false,
      basal: true,
      bolus: false,
      activity: false,
      pause: false,
    });
  });

  it("keeps hidden insulin layers out of the inspector", () => {
    const dailyTotal = {
      id: "total",
      timestamp: 1,
      dateKey: "2026-08-18",
      basalUnits: 12,
      bolusUnits: 5,
      totalUnits: 17,
      sourceId: "glooko",
    };
    expect(
      timelineInspectorInsulinParts({
        dailyTotal,
        showBasal: false,
        showBolus: true,
      }),
    ).toEqual(["Bolus 5.0 U this day"]);
    expect(
      timelineInspectorInsulinParts({
        dailyTotal,
        showBasal: true,
        showBolus: false,
      }),
    ).toEqual(["Basal 12.0 U this day"]);
  });
});
