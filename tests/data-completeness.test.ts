import { describe, expect, it } from "vitest";

import { buildDataCompletenessReport } from "@/domain/dataCompleteness";
import { GlucoseReading, TimelineData } from "@/domain/models";

const START = Date.parse("2026-07-25T00:00:00+01:00");
const MINUTE = 60_000;

function glucose(
  minute: number,
  sourceId = "t1arc-librelinkup",
): GlucoseReading {
  const timestamp = START + minute * MINUTE;
  return {
    id: `${sourceId}:${timestamp}`,
    sourceId,
    timestamp,
    receivedAt: timestamp,
    mmolL: 6,
    trend: "flat",
    quality: "measured",
  };
}

function timeline(overrides: Partial<TimelineData> = {}): TimelineData {
  return {
    range: { start: START, end: START + 60 * MINUTE },
    glucose: [],
    basal: [],
    boluses: [],
    context: [],
    sources: [],
    ...overrides,
  };
}

describe("local data completeness audit", () => {
  it("counts uncovered boundaries and a central glucose outage", () => {
    const report = buildDataCompletenessReport(
      timeline({
        glucose: [
          glucose(5),
          glucose(10),
          glucose(15),
          glucose(40, "glooko-cgm"),
          glucose(45, "glooko-cgm"),
        ],
      }),
    );

    expect(report.glucose).toMatchObject({
      recordCount: 5,
      coveredMinutes: 39,
      missingMinutes: 21,
      coveragePercent: 65,
      longestGapMinutes: 13,
      sourceCounts: [
        { sourceId: "t1arc-librelinkup", count: 3 },
        { sourceId: "glooko-cgm", count: 2 },
      ],
    });
    expect(report.glucose.gaps).toHaveLength(3);
  });

  it("merges overlapping basal intervals and exposes uncovered time", () => {
    const report = buildDataCompletenessReport(
      timeline({
        basal: [
          {
            id: "basal:1",
            sourceId: "glooko-export",
            start: START,
            end: START + 30 * MINUTE,
            units: 0.3,
            rateUnitsPerHour: 0.6,
          },
          {
            id: "basal:2",
            sourceId: "glooko-export",
            start: START + 20 * MINUTE,
            end: START + 50 * MINUTE,
            units: 0.3,
            rateUnitsPerHour: 0.6,
          },
        ],
      }),
    );

    expect(report.basal).toMatchObject({
      recordCount: 2,
      coveredMinutes: 50,
      missingMinutes: 10,
      coveragePercent: 83.3,
      longestGapMinutes: 10,
    });
  });

  it("treats an imported automated pause as explained basal time", () => {
    const report = buildDataCompletenessReport(
      timeline({
        basal: [
          {
            id: "basal:before-pause",
            sourceId: "glooko-export",
            start: START,
            end: START + 30 * MINUTE,
            units: 0.3,
            rateUnitsPerHour: 0.6,
          },
        ],
        pumpStates: [
          {
            id: "pause:known-zero",
            sourceId: "glooko-overview-pdf",
            start: START + 30 * MINUTE,
            end: START + 45 * MINUTE,
            kind: "automated-pause",
          },
        ],
      }),
    );

    expect(report.basal).toMatchObject({
      recordCount: 1,
      coveredMinutes: 45,
      missingMinutes: 15,
      coveragePercent: 75,
    });
  });

  it("does not interpret absent boluses or context as missing coverage", () => {
    const report = buildDataCompletenessReport(timeline());

    expect(report.glucose.coveragePercent).toBe(0);
    expect(report.basal.coveragePercent).toBe(0);
    expect(report.bolusCount).toBe(0);
    expect(report.contextCount).toBe(0);
  });

  it("reconciles the latest source daily total without treating it as a delivery", () => {
    const report = buildDataCompletenessReport(
      timeline({
        range: { start: START, end: START + 24 * 60 * MINUTE },
        basal: [
          {
            id: "basal:1",
            sourceId: "glooko-export",
            start: START,
            end: START + 60 * MINUTE,
            units: 0.6,
            rateUnitsPerHour: 0.6,
          },
          {
            id: "basal:other-source",
            sourceId: "other-source",
            start: START,
            end: START + 60 * MINUTE,
            units: 10,
            rateUnitsPerHour: 10,
          },
        ],
        boluses: [
          {
            id: "bolus:1",
            sourceId: "glooko-export",
            timestamp: START + 30 * MINUTE,
            units: 2,
          },
          {
            id: "bolus:other-source",
            sourceId: "other-source",
            timestamp: START + 30 * MINUTE,
            units: 10,
          },
        ],
        dailyInsulinTotals: [
          {
            id: "total:old",
            sourceId: "glooko-export",
            timestamp: START + 59 * MINUTE,
            dateKey: "2026-07-25",
            basalUnits: 1,
            bolusUnits: 2,
            totalUnits: 3,
            importedAt: START + MINUTE,
          },
          {
            id: "total:new",
            sourceId: "glooko-export",
            timestamp: START + 59 * MINUTE,
            dateKey: "2026-07-25",
            basalUnits: 0.9,
            bolusUnits: 2.1,
            totalUnits: 3,
            importedAt: START + 2 * MINUTE,
          },
        ],
      }),
    );

    expect(report.bolusCount).toBe(2);
    expect(report.insulinReconciliation).toEqual({
      reportedDays: 1,
      dateKeys: ["2026-07-25"],
      reportedRecordIds: ["total:new"],
      organisedRecordIds: ["basal:1", "bolus:1"],
      reportedBasalUnits: 0.9,
      reportedBolusUnits: 2.1,
      reportedTotalUnits: 3,
      organisedBasalUnits: 0.6,
      organisedBolusUnits: 2,
      organisedTotalUnits: 2.6,
      differenceUnits: 0.4,
    });
  });

  it("compares source totals only with detailed rows from the same complete days", () => {
    const day = 24 * 60 * MINUTE;
    const secondDayStart = START + day;
    const report = buildDataCompletenessReport(
      timeline({
        range: { start: START, end: START + 2 * day },
        basal: [
          {
            id: "basal:reported-day",
            sourceId: "glooko-export",
            start: START,
            end: START + day,
            units: 20,
            rateUnitsPerHour: 20 / 24,
          },
          {
            id: "basal:unreported-day",
            sourceId: "glooko-export",
            start: secondDayStart,
            end: secondDayStart + day,
            units: 30,
            rateUnitsPerHour: 30 / 24,
          },
        ],
        boluses: [
          {
            id: "bolus:reported-day",
            sourceId: "glooko-export",
            timestamp: START + 12 * 60 * MINUTE,
            units: 10,
          },
          {
            id: "bolus:unreported-day",
            sourceId: "glooko-export",
            timestamp: secondDayStart + 12 * 60 * MINUTE,
            units: 15,
          },
        ],
        dailyInsulinTotals: [
          {
            id: "total:reported-day",
            sourceId: "glooko-export",
            timestamp: START + day - MINUTE,
            dateKey: "2026-07-25",
            basalUnits: 20,
            bolusUnits: 10,
            totalUnits: 30,
          },
        ],
      }),
    );

    expect(report.insulinReconciliation).toMatchObject({
      reportedDays: 1,
      reportedTotalUnits: 30,
      organisedBasalUnits: 20,
      organisedBolusUnits: 10,
      organisedTotalUnits: 30,
      differenceUnits: 0,
      organisedRecordIds: ["basal:reported-day", "bolus:reported-day"],
    });
  });

  it("does not reconcile a whole-day source total against a partial-day view", () => {
    const fullDay = 24 * 60 * MINUTE;
    const report = buildDataCompletenessReport(
      timeline({
        range: {
          start: START + 12 * 60 * MINUTE,
          end: START + fullDay,
        },
        dailyInsulinTotals: [
          {
            id: "total:whole-day",
            sourceId: "glooko-export",
            timestamp: START + fullDay - MINUTE,
            dateKey: "2026-07-25",
            totalUnits: 30,
          },
        ],
      }),
    );

    expect(report.insulinReconciliation).toBeUndefined();
  });

  it("does not call a source daily total a mismatch when timed basal rows were not exported", () => {
    const fullDay = 24 * 60 * MINUTE;
    const report = buildDataCompletenessReport(
      timeline({
        range: { start: START, end: START + fullDay },
        boluses: [
          {
            id: "bolus:1",
            sourceId: "glooko-export",
            sourceDeviceId: "pump:new",
            timestamp: START + 12 * 60 * MINUTE,
            units: 10,
          },
        ],
        dailyInsulinTotals: [
          {
            id: "total:new-pump",
            sourceId: "glooko-export",
            sourceDeviceId: "pump:new",
            timestamp: START + fullDay - MINUTE,
            dateKey: "2026-07-25",
            basalUnits: 20,
            bolusUnits: 10,
            totalUnits: 30,
          },
        ],
      }),
    );

    expect(report.bolusCount).toBe(1);
    expect(report.basal.recordCount).toBe(0);
    expect(report.insulinReconciliation).toBeUndefined();
  });
});
