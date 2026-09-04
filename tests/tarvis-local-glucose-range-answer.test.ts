import { describe, expect, it } from "vitest";

import {
  buildLocalGlucoseRangeAnswer,
  rangeForLocalGlucoseRangeIntent,
} from "@/data/tarvis/localGlucoseRangeAnswer";
import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import type { GlucoseReading } from "@/domain/models";

const AS_OF = Date.parse("2026-08-07T20:00:00+01:00");

function ready(question: string) {
  const resolution = resolveTarvisIntent(question, {
    now: AS_OF,
    timezone: "Europe/London",
  });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(
      `Expected ready intent, received ${resolution.outcome.code}`,
    );
  }
  return resolution.intent;
}

function reading(id: string, timestamp: string, mmolL: number): GlucoseReading {
  const instant = Date.parse(timestamp);
  return {
    id,
    timestamp: instant,
    receivedAt: instant,
    mmolL,
    trend: "unknown",
    quality: "measured",
    sourceId: "test-cgm",
  };
}

describe("local Tarv1s exact range glucose answers", () => {
  it("answers today from the exact half-open local period", () => {
    const intent = ready("What was my average glucose today?");
    expect(rangeForLocalGlucoseRangeIntent(intent, AS_OF)).toEqual({
      start: Date.parse("2026-08-07T00:00:00+01:00"),
      end: AS_OF,
    });
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("start", "2026-08-07T00:00:00+01:00", 6),
        reading("midday", "2026-08-07T12:00:00+01:00", 8),
        reading("excluded-at-end", "2026-08-07T20:00:00+01:00", 20),
        reading("excluded-yesterday", "2026-08-06T23:59:00+01:00", 20),
      ],
    });

    expect(result.answer.headline).toBe("Observed average glucose: 7.0 mmol/L");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]!.recordIds).toEqual(["start", "midday"]);
    expect(result.answer.answer).toContain("periods you asked about");
    expect(result.evidence[0]!.visualization).toMatchObject({
      kind: "range-trace-v1",
      metric: "glucose.mean",
      subtitle: expect.stringContaining(
        "chart may show fewer points to stay clear",
      ),
      windows: [
        {
          recordCount: 2,
          points: [{ recordIds: ["start"] }, { recordIds: ["midday"] }],
        },
      ],
    });
    expect(result.evidence[0]!.visualization?.subtitle).not.toContain(
      "All readings",
    );
  });

  it("always gives the local date and time of a highest reading", () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my highest glucose in the last 14 days?"),
      readings: [
        reading("ordinary", "2026-08-01T09:00:00+01:00", 7.2),
        reading("highest", "2026-08-05T18:42:00+01:00", 15.8),
      ],
    });

    expect(result.answer.answer).toContain("15.8 mmol/L");
    expect(result.answer.answer).toContain(
      "at 18:42 on Wednesday, 5 August 2026",
    );
  });

  it("describes repeated extreme readings without implying a single occurrence", () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("What was my lowest glucose in the last 14 days?"),
      readings: [
        reading("first-low", "2026-08-02T01:15:00+01:00", 3.2),
        reading("ordinary", "2026-08-03T10:00:00+01:00", 6.4),
        reading("last-low", "2026-08-06T22:05:00+01:00", 3.2),
      ],
    });

    expect(result.answer.answer).toContain(
      "first at 01:15 on Sunday, 2 August 2026 and again at 22:05 on Thursday, 6 August 2026",
    );
  });

  it("calculates comparison periods separately and exposes both evidence sets", () => {
    const intent = ready(
      "Compare my average glucose over the last 24 hours with the previous period.",
    );
    const range = rangeForLocalGlucoseRangeIntent(intent, AS_OF);
    expect(range).toEqual({
      start: AS_OF - 48 * 60 * 60_000,
      end: AS_OF,
    });
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("previous", "2026-08-06T08:00:00+01:00", 6),
        reading("current", "2026-08-07T08:00:00+01:00", 9),
      ],
    });

    expect(result.answer.headline).toBe("Observed glucose comparison");
    expect(result.answer.answer).toContain("Requested period");
    expect(result.answer.answer).toContain("Previous equal elapsed period");
    expect(result.evidence.map(({ recordIds }) => recordIds)).toEqual([
      ["current"],
      ["previous"],
      ["previous", "current"],
    ]);
    expect(
      result.evidence
        .slice(0, 2)
        .every(({ visualization }) => visualization === undefined),
    ).toBe(true);
    expect(result.evidence[2]).toMatchObject({
      label: "Readings used for the comparison chart",
      visualization: { kind: "period-comparison-v1" },
    });
    expect(result.presentation.windows).toHaveLength(2);
  });

  it("uses observed duration rather than reading count for time in range", () => {
    const intent = ready("What was my time in range today?");
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("within", "2026-08-07T01:00:00+01:00", 6),
        reading("above", "2026-08-07T01:06:00+01:00", 12),
        reading("above-again", "2026-08-07T01:12:00+01:00", 12),
      ],
    });

    expect(result.evidence[0]!.calculation?.metrics).toContainEqual({
      id: "glucose.time_in_range",
      unit: "%",
      value: 25,
    });
    expect(result.answer.answer).toContain("25.0%");
    expect(result.evidence[0]!.visualization).toMatchObject({
      kind: "range-distribution-v1",
      metric: "glucose.time_in_range",
      windows: [
        {
          distribution: {
            belowPercent: 0,
            inRangePercent: 25,
            abovePercent: 75,
          },
        },
      ],
    });
  });

  it("returns unavailable rather than zero when a period has no readings", () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("How many low-glucose events have I had today?"),
      readings: [],
    });
    expect(result.answer.headline).toBe("Glucose result unavailable");
    expect(result.evidence[0]!.calculation?.metrics[0]?.value).toBeNull();
    expect(result.answer.answer).toContain("result is unavailable");
    expect(result.evidence[0]!.visualization).toMatchObject({
      kind: "event-timeline-v1",
      windows: [
        {
          coveragePercent: 0,
          coverageStatus: "unavailable",
          recordCount: 0,
          points: [],
          events: [],
        },
      ],
    });
  });

  it("uses boundary context to attribute an event to its true start period", () => {
    const intent = ready("How many high-glucose events did I have yesterday?");
    expect(rangeForLocalGlucoseRangeIntent(intent, AS_OF)).toEqual({
      start: Date.parse("2026-08-05T23:45:00+01:00"),
      end: Date.parse("2026-08-07T00:15:00+01:00"),
    });
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [
        reading("start-inside", "2026-08-06T23:50:00+01:00", 12),
        reading("still-inside", "2026-08-06T23:55:00+01:00", 12),
        reading("confirm-after", "2026-08-07T00:05:00+01:00", 12),
      ],
    });
    expect(result.evidence[0]!.calculation?.metrics[0]?.value).toBe(1);
    expect(result.evidence[0]!.recordIds).toEqual([
      "start-inside",
      "still-inside",
    ]);
    expect(result.evidence[0]!.recordIds).not.toContain("confirm-after");
    expect(result.evidence[0]!.description).toContain("nearby readings");
    expect(result.evidence[0]!.description).toContain("All Records");
    expect(result.presentation.detail).toContain(
      "A high or low is counted after glucose stays beyond the threshold for 15 minutes.",
    );
    expect(result.presentation.detail.toLowerCase()).not.toContain("t1arc");
    expect(result.presentation.detail).not.toContain("canonical-v3");
    expect(result.answerBundle.scope.windows[0]?.contextRecordIds).toEqual([
      "confirm-after",
    ]);
    expect(result.evidence[0]!.visualization).toMatchObject({
      kind: "event-timeline-v1",
      eventKind: "high",
      windows: [
        {
          points: [
            { recordIds: ["start-inside"] },
            { recordIds: ["still-inside"] },
          ],
          events: [
            {
              end: Date.parse("2026-08-06T23:55:00+01:00"),
              endStatus: "observed-through",
              continuesBeyondWindow: true,
              recordIds: ["start-inside", "still-inside"],
            },
          ],
        },
      ],
    });
  });

  it("does not recount an event that was already active at period start", () => {
    const result = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent: ready("How many high-glucose events did I have today?"),
      readings: [
        reading("before", "2026-08-06T23:50:00+01:00", 12),
        reading("at-start", "2026-08-07T00:00:00+01:00", 12),
        reading("confirmed", "2026-08-07T00:05:00+01:00", 12),
      ],
    });
    expect(result.evidence[0]!.calculation?.metrics[0]?.value).toBe(0);
  });

  it("is deterministic across equivalent input permutations and keeps exact thresholds", () => {
    const intent = ready("How many high-glucose events have I had today?");
    const values = [
      reading("b", "2026-08-07T01:00:00+01:00", 13),
      reading("a", "2026-08-07T01:00:00+01:00", 9),
      reading("d", "2026-08-07T01:05:00+01:00", 11),
      reading("c", "2026-08-07T01:15:00+01:00", 11),
    ];
    const forward = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: values,
    });
    const reverse = buildLocalGlucoseRangeAnswer({
      asOf: AS_OF,
      intent,
      readings: [...values].reverse(),
    });

    expect(reverse).toEqual(forward);
    expect(forward.evidence[0]!.calculation?.thresholds).toEqual([
      expect.objectContaining({ operator: "gt", value: 10 }),
    ]);
    expect(forward.evidence[0]!.visualization).toMatchObject({
      kind: "event-timeline-v1",
      windows: [
        {
          events: [
            {
              recordIds: ["a", "b", "d", "c"],
              endStatus: "observed-through",
            },
          ],
        },
      ],
    });
  });
});
