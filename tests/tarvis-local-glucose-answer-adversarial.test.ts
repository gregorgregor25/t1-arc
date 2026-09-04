import { describe, expect, it } from "vitest";

import {
  buildLocalGlucoseAnswer,
  rangeForLocalGlucoseIntent,
  UnsupportedLocalGlucoseIntentError,
} from "@/data/tarvis/localGlucoseAnswer";
import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  type TarvisIntentV1,
} from "@/data/tarvis/intent";
import type { GlucoseReading } from "@/domain/models";
import type { EvidenceClockWindowVisualizationReference } from "@/domain/insights";
import { zonedDateTimeToTimestamp } from "@/domain/time";

const NOW = Date.parse("2026-08-07T20:00:00+01:00");

function london(
  date: `${number}-${number}-${number}`,
  hour: number,
  minute = 0,
) {
  return zonedDateTimeToTimestamp(date, hour, minute);
}

function reading(id: string, timestamp: number, mmolL: number): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: "flat",
    quality: "measured",
    sourceId: "adversarial-cgm",
  };
}

function readyIntent(question: string, now = NOW) {
  const resolution = resolveTarvisIntent(question, {
    now,
    timezone: "Europe/London",
  });
  expect(resolution.outcome).toEqual({ status: "ready", code: "ready" });
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(`Expected a ready fixture intent: ${question}`);
  }
  return resolution.intent;
}

function averageIntent(days = "three") {
  return readyIntent(
    `What were my average readings over the last ${days} days between midnight and 7 a.m.?`,
  );
}

function calculationOf(result: ReturnType<typeof buildLocalGlucoseAnswer>) {
  const calculation = result.evidence.calculation;
  if (!calculation)
    throw new Error("Expected deterministic calculation evidence.");
  return calculation;
}

function visualizationOf(
  result: ReturnType<typeof buildLocalGlucoseAnswer>,
): EvidenceClockWindowVisualizationReference {
  const visualization = result.evidence.visualization;
  if (visualization?.kind !== "recurring-clock-overlay-v1") {
    throw new Error("Expected recurring clock-window visualization evidence.");
  }
  return visualization;
}

describe("local glucose answer screenshot contract", () => {
  it("answers exactly three 00:00-07:00 windows, two observed, without 08:16", () => {
    const intent = averageIntent();
    const readings = [
      reading("wed-a", london("2026-08-06", 0, 1), 6),
      reading("wed-b", london("2026-08-06", 0, 6), 8),
      reading("thu-a", london("2026-08-07", 0, 1), 10),
      reading("thu-b", london("2026-08-07", 0, 6), 12),
      reading("forbidden-0816", london("2026-08-07", 8, 16), 19),
      reading("too-old", london("2026-08-04", 2), 2),
    ];

    const result = buildLocalGlucoseAnswer({ asOf: NOW, intent, readings });
    const visualization = visualizationOf(result);

    expect(result.bundle.result).toMatchObject({
      observedMeanMmolL: 9,
      requestedWindowCount: 3,
      windowsWithData: 2,
      missingWindowCount: 1,
      readingCount: 4,
    });
    expect(result.evidence.recordIds).toEqual([
      "wed-a",
      "wed-b",
      "thu-a",
      "thu-b",
    ]);
    expect(result.evidence.recordIds).not.toContain("forbidden-0816");
    expect(result.answer.headline).toBe("Observed average glucose: 9.0 mmol/L");
    expect(result.answer.answer).toContain(
      "2 of the 3 requested overnight windows",
    );
    expect(result.answer.answer).toContain("00:00–07:00");
    expect(result.answer.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "one requested window contained no glucose readings",
        ),
      ]),
    );
    expect(result.presentation).toMatchObject({
      kind: "average-glucose",
      windows: [
        {
          recordCount: 4,
          metrics: [
            {
              id: "average-glucose",
              value: 9,
              unit: "mmol/L",
            },
          ],
        },
      ],
    });
    expect(visualization.domain).toEqual({
      startMinute: 0,
      endMinuteUnwrapped: 420,
      binMinutes: 15,
    });
    expect(visualization.missingOccurrenceLabels).toHaveLength(1);
    expect(visualization.aggregatePoints).toEqual([
      expect.objectContaining({
        minute: 7.5,
        mmolL: 9,
        contributingWindowCount: 2,
      }),
    ]);
  });

  it("uses the smallest exact repository range and half-open record boundaries", () => {
    const intent = averageIntent("one");
    const range = rangeForLocalGlucoseIntent(intent, NOW);
    expect(range).toEqual({
      start: london("2026-08-07", 0),
      end: london("2026-08-07", 7),
    });

    const result = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent,
      readings: [
        reading("before", range.start - 1, 2),
        reading("at-start", range.start, 4),
        reading("before-end", range.end - 1, 6),
        reading("at-end", range.end, 8),
        reading("after-end", range.end + 1, 10),
      ],
    });

    expect(result.bundle.result.recordIds).toEqual(["at-start", "before-end"]);
    expect(result.evidence.recordIds).toEqual(["at-start", "before-end"]);
    expect(result.bundle.result.observedMeanMmolL).toBe(5);
    expect(
      result.bundle.evidence.records.every(
        (record) =>
          record.timestamp >= range.start && record.timestamp < range.end,
      ),
    ).toBe(true);
  });

  it("returns unavailable rather than zero when every requested window is empty", () => {
    const result = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent: averageIntent(),
      readings: [],
    });

    expect(result.bundle.result).toMatchObject({
      observedMeanMmolL: null,
      readingCount: 0,
      windowsWithData: 0,
      missingWindowCount: 3,
    });
    expect(result.evidence.recordIds).toEqual([]);
    expect(calculationOf(result).metrics).toEqual([
      { id: "glucose.mean", value: null, unit: "mmol/L" },
    ]);
    expect(result.answer).toMatchObject({
      headline: "Glucose result unavailable",
      confidence: "limited",
    });
    expect(result.answer.answer).toContain("missing time as zero");
    expect(result.presentation.windows[0]!.metrics[0]!.value).toBeNull();
    expect(visualizationOf(result).aggregatePoints).toEqual([]);
  });
});

describe("local glucose answer thresholds and duration weighting", () => {
  it("uses explicit mmol/L thresholds and elapsed observed time for TIR", () => {
    const intent = readyIntent(
      "What percentage of my glucose readings were between 4 and 10 mmol/L over the last one day from midnight to 7 a.m.?",
    );
    const start = london("2026-08-07", 0);
    const result = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent,
      readings: [
        reading("below-5m", start, 3),
        reading("in-range-10m", start + 5 * 60_000, 7),
        reading("above-12m", start + 15 * 60_000, 12),
      ],
    });

    expect(calculationOf(result)).toMatchObject({
      metrics: [{ id: "glucose.time_in_range", value: 37, unit: "%" }],
      thresholds: [
        { operator: "gte", role: "range_lower", unit: "mmol/L", value: 4 },
        { operator: "lte", role: "range_upper", unit: "mmol/L", value: 10 },
      ],
    });
    expect(result.presentation.windows[0]!.metrics).toEqual([
      expect.objectContaining({ id: "time-below-range", value: 18.5 }),
      expect.objectContaining({ id: "time-in-range", value: 37 }),
      expect.objectContaining({ id: "time-above-range", value: 44.4 }),
    ]);
    expect(result.evidence.visualization).toBeUndefined();
    expect(result.answerBundle.charts).toEqual([]);
    expect(result.answer.answer).toContain("37.0% of observed sensor time");
  });

  it("normalizes explicit mg/dL thresholds once and records the converted values", () => {
    const intent = readyIntent(
      "What percentage of my glucose readings were between 70 and 180 mg/dL over the last one day from midnight to 7 a.m.?",
    );
    const start = london("2026-08-07", 0);
    const result = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent,
      readings: [
        reading("below", start, 3.8),
        reading("inside", start + 5 * 60_000, 7),
        reading("above", start + 10 * 60_000, 10.2),
      ],
    });
    const thresholds = calculationOf(result).thresholds;

    expect(thresholds).toEqual([
      {
        operator: "gte",
        role: "range_lower",
        unit: "mmol/L",
        value: 70 / 18.016,
      },
      {
        operator: "lte",
        role: "range_upper",
        unit: "mmol/L",
        value: 180 / 18.016,
      },
    ]);
    expect(result.evidence.visualization).toBeUndefined();
    expect(result.answerBundle.charts).toEqual([]);
    expect(intent.thresholds.map((item) => item.value.unit)).toEqual([
      "mg/dL",
      "mg/dL",
    ]);
  });
});

describe("local glucose event semantics", () => {
  it("does not split an event until recovery remains across threshold for 15 minutes", () => {
    const intent = readyIntent(
      "How many low-glucose episodes below 3.9 mmol/L over the last one day from midnight to 7 a.m.?",
    );
    const start = london("2026-08-07", 0);
    const samples = [
      [0, 3],
      [5, 3],
      [10, 3],
      [15, 3],
      // A ten-minute recovery attempt is not a new event boundary.
      [20, 5],
      [25, 5],
      [30, 3],
      [35, 3],
      // This recovery persists for the required fifteen minutes.
      [40, 5],
      [45, 5],
      [50, 5],
      [55, 5],
    ] as const;
    const result = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent,
      readings: samples.map(([minute, mmolL]) =>
        reading(`low:${minute}`, start + minute * 60_000, mmolL),
      ),
    });

    expect(calculationOf(result).metrics).toEqual([
      { id: "glucose.low_episodes", value: 1, unit: "events" },
    ]);
    expect(calculationOf(result).episodeDefinitionVersion).toContain(
      "15m-start-recovery",
    );
    expect(result.presentation.windows[0]!.metrics).toEqual([
      expect.objectContaining({ id: "low-events", value: 1 }),
    ]);
  });

  it("returns both requested episode metrics without blending their thresholds", () => {
    const intent = readyIntent(
      "How many lows and how many highs over the last one day from midnight to 7 a.m.?",
    );
    const start = london("2026-08-07", 0);
    const samples: [number, number][] = [];
    [0, 5, 10, 15].forEach((minute) => samples.push([minute, 3]));
    [20, 25, 30, 35].forEach((minute) => samples.push([minute, 6]));
    [40, 45, 50, 55].forEach((minute) => samples.push([minute, 12]));
    [60, 65, 70, 75].forEach((minute) => samples.push([minute, 6]));

    const result = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent,
      readings: samples.map(([minute, mmolL]) =>
        reading(`both:${minute}`, start + minute * 60_000, mmolL),
      ),
    });

    expect(calculationOf(result).metrics).toEqual([
      { id: "glucose.low_episodes", value: 1, unit: "events" },
      { id: "glucose.high_episodes", value: 1, unit: "events" },
    ]);
    expect(calculationOf(result).thresholds).toEqual([
      { operator: "lt", role: "low", unit: "mmol/L", value: 3.9 },
      { operator: "gt", role: "high", unit: "mmol/L", value: 10 },
    ]);
    expect(result.presentation.kind).toBe("glucose-events");
    expect(result.answer.headline).toBe("Observed glucose events");
    expect(result.evidence.visualization).toBeUndefined();
    expect(result.answerBundle.charts).toEqual([]);
  });
});

describe("local glucose evidence replay and DST", () => {
  it("is deterministic and wholly JSON replayable", () => {
    const intent = averageIntent("one");
    const readings = [
      reading("later", london("2026-08-07", 1), 7),
      reading("earlier", london("2026-08-07", 0, 30), 7),
    ];
    const first = buildLocalGlucoseAnswer({ asOf: NOW, intent, readings });
    const second = buildLocalGlucoseAnswer({
      asOf: NOW,
      intent: structuredClone(intent),
      readings: [...readings].reverse(),
    });

    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.answer.evidenceIds).toEqual([first.evidence.id]);
    expect(first.evidence.recordIds).toEqual(first.bundle.evidence.recordIds);
  });

  it("gives different calculations different query and evidence identities", () => {
    const morningMean = averageIntent("one");
    const overnightMean = readyIntent(
      "What was my average glucose over the last one day from 10 p.m. to 3 a.m.?",
    );
    const narrowRange = readyIntent(
      "What percentage of my glucose readings were between 4 and 8 mmol/L over the last one day from midnight to 7 a.m.?",
    );
    const wideRange = readyIntent(
      "What percentage of my glucose readings were between 4 and 10 mmol/L over the last one day from midnight to 7 a.m.?",
    );
    const results = [morningMean, overnightMean, narrowRange, wideRange].map(
      (intent) => buildLocalGlucoseAnswer({ asOf: NOW, intent, readings: [] }),
    );

    expect(new Set(results.map((result) => result.bundle.queryId)).size).toBe(
      4,
    );
    expect(new Set(results.map((result) => result.evidence.id)).size).toBe(4);
  });

  it("retains spring clock-gap annotation while continuous sensor coverage stays complete", () => {
    const asOf = london("2026-03-29", 8);
    const intent = readyIntent(
      "What was my average glucose over the last one day from midnight to 7 a.m.?",
      asOf,
    );
    const range = rangeForLocalGlucoseIntent(intent, asOf);
    const readings: GlucoseReading[] = [];
    for (
      let timestamp = range.start;
      timestamp < range.end;
      timestamp += 5 * 60_000
    ) {
      readings.push(reading(`spring:${timestamp}`, timestamp, 7));
    }

    const result = buildLocalGlucoseAnswer({ asOf, intent, readings });
    const visualization = visualizationOf(result);

    expect(result.bundle.result.coverage).toMatchObject({
      expectedMinutes: 360,
      observedMinutes: 360,
      percent: 100,
    });
    expect(visualization.windows[0]!.clockTransitions).toEqual([
      expect.objectContaining({
        kind: "gap",
        affectedStartMinute: 60,
        affectedEndMinute: 120,
      }),
    ]);
    expect(visualization.windows[0]!.segments[1]!.startsAfter).toEqual({
      sensorGap: false,
      clockTransition: "gap",
    });
  });
});

describe("local glucose adapter fails closed on mismatched ready intents", () => {
  function expectUnsupported(mutator: (intent: TarvisIntentV1) => void) {
    const intent = structuredClone(averageIntent("one"));
    mutator(intent);
    expect(() =>
      buildLocalGlucoseAnswer({ asOf: NOW, intent, readings: [] }),
    ).toThrow(UnsupportedLocalGlucoseIntentError);
  }

  it("rejects a metric/operation mismatch", () => {
    expectUnsupported((intent) => {
      intent.operation.value = "range_distribution";
    });
  });

  it("rejects a comparison instead of ignoring it", () => {
    expectUnsupported((intent) => {
      intent.comparison = {
        value: { kind: "previous_equal_period" },
        provenance: intent.operation.provenance,
      };
    });
  });

  it("rejects a non-recurring or clockless time scope", () => {
    expectUnsupported((intent) => {
      intent.temporalScope.value = {
        kind: "recent_local_days",
        count: 1,
        include: "through_now",
      };
    });
    expectUnsupported((intent) => {
      intent.clockWindow = null;
    });
  });

  it("rejects duplicate metrics", () => {
    expectUnsupported((intent) => {
      intent.metrics.push(structuredClone(intent.metrics[0]!));
    });
  });

  it("rejects inverted TIR thresholds", () => {
    const intent = readyIntent(
      "What percentage of my glucose readings were between 4 and 10 mmol/L over the last one day from midnight to 7 a.m.?",
    );
    intent.thresholds[0]!.value.value = 12;
    intent.thresholds[1]!.value.value = 8;
    expect(() =>
      buildLocalGlucoseAnswer({ asOf: NOW, intent, readings: [] }),
    ).toThrow(UnsupportedLocalGlucoseIntentError);
  });

  it("rejects non-finite execution anchors and duplicate evidence IDs", () => {
    const intent = averageIntent("one");
    expect(() =>
      buildLocalGlucoseAnswer({ asOf: Number.NaN, intent, readings: [] }),
    ).toThrow(UnsupportedLocalGlucoseIntentError);

    const timestamp = london("2026-08-07", 1);
    expect(() =>
      buildLocalGlucoseAnswer({
        asOf: NOW,
        intent,
        readings: [
          reading("duplicate", timestamp, 6),
          reading("duplicate", timestamp + 5 * 60_000, 7),
        ],
      }),
    ).toThrow(/Duplicate glucose record ID/);
  });
});
