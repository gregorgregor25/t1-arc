import { describe, expect, it } from "vitest";

import { createManualContextEvent } from "@/data/manualContext";
import {
  buildTarvisEvidencePacket,
  selectTarvisEvidencePacket,
} from "@/data/tarvis/evidencePacket";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import { buildRetrospectiveEventReview } from "@/data/tarvis/retrospectiveEventReview";
import { buildInsightReport, classifyInsightQuestion } from "@/domain/insights";
import type {
  ActivityEvent,
  GlucoseReading,
  HealthContextEvent,
  TimelineData,
  TimeRange,
} from "@/domain/models";

const AS_OF = Date.parse("2026-08-25T12:00:00+01:00");
const WALK_START = Date.parse("2026-08-24T19:00:00+01:00");

const walk: ActivityEvent = {
  id: "walk-ketone-review",
  kind: "activity",
  start: WALK_START,
  end: WALK_START + 30 * 60_000,
  title: "Evening walk",
  activityType: "walk",
  durationMinutes: 30,
  intensity: "moderate",
  sourceId: "health-connect",
  origin: "imported",
};

function glucose(id: string, timestamp: number, mmolL: number): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp,
    mmolL,
    trend: "unknown",
    quality: "measured",
    sourceId: "cgm",
  };
}

function timeline(
  range: TimeRange,
  context: HealthContextEvent[],
  readings: GlucoseReading[] = [],
): TimelineData {
  return {
    range,
    glucose: readings,
    basal: [],
    boluses: [],
    pumpStates: [],
    dailyInsulinTotals: [],
    context,
    sources: [],
  };
}

function coveredTimeline(range: TimeRange, context: HealthContextEvent[]) {
  const readings: GlucoseReading[] = [];
  for (
    let timestamp = range.start;
    timestamp < range.end;
    timestamp += 10 * 60_000
  ) {
    readings.push(glucose(`glucose:${timestamp}`, timestamp, 6.2));
  }
  return timeline(range, context, readings);
}

function bloodKetone(id: string, timestamp: number, value: number) {
  return createManualContextEvent(
    { kind: "ketone", ketoneType: "blood", value, timestamp },
    { id, recordedAt: timestamp + 1_000 },
  );
}

function urineKetone(
  id: string,
  timestamp: number,
  value: "negative" | "trace" | "+" | "++" | "+++" | "++++",
) {
  return createManualContextEvent(
    { kind: "ketone", ketoneType: "urine", value, timestamp },
    { id, recordedAt: timestamp + 1_000 },
  );
}

describe("Tarv1s manually logged ketone evidence", () => {
  it("keeps blood and urine modality, value, event time and local provenance in an incident review", () => {
    const bloodTime = WALK_START - 30 * 60_000;
    const urineTime = WALK_START + 10 * 60_000;
    const blood = bloodKetone("manual-blood-ketone", bloodTime, 0.8);
    const urine = urineKetone("manual-urine-ketone", urineTime, "++");
    const result = buildRetrospectiveEventReview({
      question: "Why did my glucose go low during my walk yesterday?",
      timeline: timeline(
        {
          start: WALK_START - 24 * 60 * 60_000,
          end: AS_OF,
        },
        [walk, blood, urine],
        [
          glucose("glucose-start", WALK_START, 5.7),
          glucose("glucose-low", WALK_START + 25 * 60_000, 3.6),
        ],
      ),
    });

    const evidence = result.evidence.find(
      (reference) => reference.label === "Manually logged ketone readings",
    );
    expect(evidence?.recordIds).toEqual([
      "manual-blood-ketone",
      "manual-urine-ketone",
    ]);

    const bloodPreview = evidence?.examples.find(
      (example) => example.id === "manual-blood-ketone",
    );
    expect(bloodPreview).toMatchObject({
      timestamp: bloodTime,
      primary: "Blood ketones · 0.8 mmol/L",
      sourceId: "t1arc-manual",
    });
    expect(bloodPreview?.secondary).toContain("Blood ketone meter value");

    const urinePreview = evidence?.examples.find(
      (example) => example.id === "manual-urine-ketone",
    );
    expect(urinePreview).toMatchObject({
      timestamp: urineTime,
      primary: "Urine ketones · ++",
      sourceId: "t1arc-manual",
    });
    expect(urinePreview?.secondary).toContain("Urine ketone strip result");

    expect(result.answer.answer).toContain(
      "Blood ketones · 0.8 mmol/L was manually recorded at 18:30",
    );
    expect(result.answer.answer).toContain(
      "Urine ketones · ++ was manually recorded at 19:10",
    );
    expect(result.answer.answer).not.toContain("t1arc:ketone:v1");
    expect(
      result.evidence.find(
        (reference) => reference.label === "Other recorded review context",
      )?.recordIds ?? [],
    ).not.toContain("manual-blood-ketone");
    expect(result.answer.answer).not.toMatch(
      /\b(?:take|dose|adjust|increase|decrease)\s+(?:insulin|medication)\b/i,
    );
  });

  it("reports ketone missingness without treating an empty window as a zero or confirmed absence", () => {
    const result = buildRetrospectiveEventReview({
      question: "Why did my glucose go low during my walk yesterday?",
      timeline: timeline(
        {
          start: WALK_START - 24 * 60 * 60_000,
          end: AS_OF,
        },
        [walk],
        [glucose("glucose-start", WALK_START, 5.7)],
      ),
    });

    expect(result.answer.answer).toContain(
      "No manually logged ketone record was loaded in the review window",
    );
    expect(result.answer.answer).toContain(
      "not proof that no manually logged ketone occurred",
    );
    expect(result.answer.answer).not.toMatch(
      /ketones? (?:were|was) (?:zero|0)/i,
    );
    expect(
      result.evidence.some(
        (reference) => reference.label === "Manually logged ketone readings",
      ),
    ).toBe(false);
  });

  it("assembles a ketone-focused personal evidence finding instead of generic Other context", () => {
    const currentRange = {
      start: Date.parse("2026-08-18T00:00:00+01:00"),
      end: Date.parse("2026-08-25T00:00:00+01:00"),
    };
    const previousRange = {
      start: Date.parse("2026-08-11T00:00:00+01:00"),
      end: currentRange.start,
    };
    const bloodTime = Date.parse("2026-08-23T21:15:00+01:00");
    const urineTime = Date.parse("2026-08-16T08:40:00+01:00");
    const report = buildInsightReport(
      coveredTimeline(currentRange, [
        bloodKetone("current-blood", bloodTime, 0.6),
      ]),
      coveredTimeline(previousRange, [
        urineKetone("previous-urine", urineTime, "trace"),
      ]),
      AS_OF,
    );

    const finding = report.findings.find(
      (candidate) => candidate.id === "recorded-ketone-readings",
    );
    expect(finding?.summary).toContain("Blood ketones · 0.6 mmol/L");
    expect(finding?.summary).toContain("Urine ketones · Trace");
    expect(finding?.summary).not.toContain("Other");
    expect(finding?.evidence[0]?.recordIds).toEqual(["current-blood"]);
    expect(finding?.evidence[0]?.examples[0]).toMatchObject({
      timestamp: bloodTime,
      primary: "Blood ketones · 0.6 mmol/L",
      sourceId: "t1arc-manual",
    });
    expect(finding?.evidence[1]?.examples[0]).toMatchObject({
      timestamp: urineTime,
      primary: "Urine ketones · Trace",
      sourceId: "t1arc-manual",
    });
    expect(
      report.findings.find(
        (candidate) => candidate.id === "recorded-context-notes",
      ),
    ).toBeUndefined();
    expect(classifyInsightQuestion("What were my ketones?")).toEqual([
      "context",
    ]);

    const lookup = buildTarvisEvidencePacket(report);
    const selected = selectTarvisEvidencePacket(
      "What were my ketones?",
      lookup.packet,
    );
    expect(selected.findings.map(({ id }) => id)).toContain(
      "recorded-ketone-readings",
    );
    expect(
      selected.evidence.find(({ id }) => id === "current-manual-ketones")
        ?.examples[0],
    ).toMatchObject({
      timestamp: bloodTime,
      primary: "Blood ketones · 0.6 mmol/L",
      sourceId: "t1arc-manual",
    });

    const ketoneFinding = report.findings.find(
      ({ id }) => id === "recorded-ketone-readings",
    )!;
    const crowdedLookup = buildTarvisEvidencePacket({
      ...report,
      findings: [
        ...Array.from({ length: 18 }, (_, index) => ({
          ...ketoneFinding,
          id: `other-context-${index}`,
          title: `Other context ${index}`,
        })),
        ketoneFinding,
      ],
    });
    expect(crowdedLookup.packet.findings).toHaveLength(18);
    expect(crowdedLookup.packet.findings[0]?.id).toBe(
      "recorded-ketone-readings",
    );
    expect(
      selectTarvisEvidencePacket(
        "What were my ketones?",
        crowdedLookup.packet,
      ).findings.map(({ id }) => id),
    ).toContain("recorded-ketone-readings");
  });

  it.each([
    "I just manually logged blood ketones of 3.2 and I think I have DKA",
    "My urine ketone strip is +++ now and I logged it in T1 Arc",
    "I manually logged ketones and I'm vomiting now",
  ])(
    "keeps current ketone danger behind the local safety gate with no hosted route: %s",
    (question) => {
      const plan = coordinateTarvisRequest({ question, asOf: AS_OF });
      expect(plan.kind).toBe("answer");
      if (plan.kind !== "answer") {
        throw new Error("Current ketone danger must return a local answer");
      }
      expect(plan.source).toBe("safety");
    },
  );
});
