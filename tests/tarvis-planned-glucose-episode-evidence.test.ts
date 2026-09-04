import { describe, expect, it } from "vitest";

import {
  loadPlannedGlucoseEpisodeEvidence,
  type TarvisEvidenceCategory,
} from "@/data/tarvis/plannedGlucoseEpisodeEvidence";
import {
  localTarvisEvidenceFallback,
  parseTarvisEvidenceSelectionResult,
} from "@/data/tarvis/evidenceAnswerGuardrail";
import { createManualContextEvent } from "@/data/manualContext";
import type {
  GlucoseReading,
  HealthContextEvent,
  TimelineData,
  TimeRange,
} from "@/domain/models";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const CURRENT_RANGE = {
  start: Date.parse("2026-08-24T00:00:00+01:00"),
  end: Date.parse("2026-08-25T00:00:00+01:00"),
};
const PREVIOUS_RANGE = {
  start: Date.parse("2026-08-23T00:00:00+01:00"),
  end: CURRENT_RANGE.start,
};
const GENERATED_AT = Date.parse("2026-08-26T09:00:00+01:00");

function glucose(
  id: string,
  timestamp: number,
  mmolL: number,
  sourceId = "libre",
): GlucoseReading {
  return {
    id,
    timestamp,
    receivedAt: timestamp + 1_000,
    mmolL,
    trend: "unknown",
    quality: "measured",
    sourceId,
  };
}

function regularGlucose(range: TimeRange, prefix: string, mmolL = 6.2) {
  const readings: GlucoseReading[] = [];
  for (
    let timestamp = range.start;
    timestamp < range.end;
    timestamp += 5 * MINUTE_MS
  ) {
    readings.push(glucose(`${prefix}:${timestamp}`, timestamp, mmolL));
  }
  return readings;
}

function replaceReading(
  readings: GlucoseReading[],
  timestamp: number,
  mmolL: number,
  id: string,
) {
  return [
    ...readings.filter((reading) => reading.timestamp !== timestamp),
    glucose(id, timestamp, mmolL),
  ].sort((left, right) => left.timestamp - right.timestamp);
}

function emptyTimeline(range: TimeRange): TimelineData {
  return {
    range,
    glucose: [],
    basal: [],
    boluses: [],
    dailyInsulinTotals: [],
    pumpStates: [],
    context: [],
    sources: [],
  };
}

function sliceTimeline(source: TimelineData, range: TimeRange): TimelineData {
  const eventEnd = (event: HealthContextEvent) => event.end ?? event.start;
  const overlaps = (start: number, end: number) =>
    start < range.end && end >= range.start;
  return {
    ...source,
    range: { ...range },
    glucose: source.glucose.filter(
      ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
    ),
    basal: source.basal.filter(({ start, end }) => overlaps(start, end)),
    boluses: source.boluses.filter(
      ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
    ),
    dailyInsulinTotals: source.dailyInsulinTotals?.filter(
      ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
    ),
    pumpStates: source.pumpStates?.filter(({ start, end }) =>
      overlaps(start, end),
    ),
    context: source.context.filter((event) =>
      overlaps(event.start, eventEnd(event)),
    ),
  };
}

function fixtureWithSustainedHigh() {
  const eventStart = Date.parse("2026-08-24T02:00:00+01:00");
  let current = regularGlucose(CURRENT_RANGE, "current");
  [11.0, 12.0, 13.4, 12.4].forEach((value, index) => {
    current = replaceReading(
      current,
      eventStart + index * 5 * MINUTE_MS,
      value,
      `sustained-high-${index}`,
    );
  });
  // A larger single value must not displace a supported sustained episode.
  current = replaceReading(
    current,
    Date.parse("2026-08-24T15:00:00+01:00"),
    18.1,
    "isolated-higher-reading",
  );

  const context: HealthContextEvent[] = [
    {
      id: "meal-before-high",
      kind: "meal",
      start: Date.parse("2026-08-23T21:00:00+01:00"),
      title: "Evening meal",
      mealType: "dinner",
      carbsGrams: 58,
      sourceId: "t1arc-food",
      origin: "manual",
    },
    {
      id: "walk-before-high",
      kind: "activity",
      start: Date.parse("2026-08-23T23:30:00+01:00"),
      end: Date.parse("2026-08-23T23:50:00+01:00"),
      title: "Evening walk",
      activityType: "walk",
      durationMinutes: 20,
      intensity: "light",
      sourceId: "health-connect",
      origin: "imported",
    },
    {
      id: "sleep-before-high",
      kind: "sleep",
      start: Date.parse("2026-08-23T22:30:00+01:00"),
      end: Date.parse("2026-08-24T01:30:00+01:00"),
      title: "Recorded sleep",
      durationMinutes: 180,
      sourceId: "health-connect",
      origin: "imported",
    },
    {
      id: "stress-note-before-high",
      kind: "note",
      start: Date.parse("2026-08-24T01:45:00+01:00"),
      title: "Stressful evening",
      category: "stress",
      detail: "User-recorded stress note",
      sourceId: "t1arc-manual",
      origin: "manual",
    },
  ];
  const all: TimelineData = {
    range: { start: PREVIOUS_RANGE.start, end: CURRENT_RANGE.end },
    glucose: [
      ...regularGlucose(PREVIOUS_RANGE, "previous"),
      ...current,
    ],
    basal: [
      {
        id: "basal-around-high",
        start: Date.parse("2026-08-23T22:00:00+01:00"),
        end: Date.parse("2026-08-24T04:00:00+01:00"),
        rateUnitsPerHour: 0.8,
        units: 4.8,
        sourceId: "glooko-pump",
      },
    ],
    boluses: [
      {
        id: "bolus-before-high",
        timestamp: Date.parse("2026-08-23T20:55:00+01:00"),
        units: 4.2,
        sourceId: "glooko-pump",
      },
    ],
    dailyInsulinTotals: [],
    pumpStates: [
      {
        id: "activity-mode-around-high",
        start: Date.parse("2026-08-24T01:00:00+01:00"),
        end: Date.parse("2026-08-24T01:30:00+01:00"),
        kind: "activity-mode",
        sourceId: "glooko-pump",
      },
    ],
    context,
    sources: [
      {
        id: "libre",
        label: "LibreLinkUp",
        detail: "Direct glucose history",
        freshness: "current",
        origin: "live",
        isLive: true,
      },
      {
        id: "glooko-pump",
        label: "Glooko",
        detail: "Imported pump history",
        freshness: "current",
        origin: "imported",
        isLive: false,
      },
    ],
  };
  return { all, eventStart };
}

describe("planned glucose episode evidence", () => {
  it("loads the exact period first, selects the largest sustained episode, and prepends separated bounded context", async () => {
    const { all, eventStart } = fixtureWithSustainedHigh();
    const calls: TimeRange[] = [];
    const allCategories: TarvisEvidenceCategory[] = [
      "glucose",
      "insulin",
      "food",
      "activity",
      "sleep",
      "context",
      "data-quality",
    ];

    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: allCategories,
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) => {
        calls.push({ ...range });
        return sliceTimeline(all, range);
      },
    });

    expect(calls).toEqual([
      CURRENT_RANGE,
      {
        start: eventStart - 6 * HOUR_MS,
        end: eventStart + 20 * MINUTE_MS + 2 * HOUR_MS,
      },
      PREVIOUS_RANGE,
    ]);
    expect(calls[1]!.start).toBeLessThan(CURRENT_RANGE.start);
    expect(lookup.packet.findings.slice(0, 6).map(({ id }) => id)).toEqual([
      "glucose-overview",
      "planned-high-nearby-meals",
      "planned-high-nearby-insulin",
      "planned-high-nearby-activity",
      "planned-high-nearby-sleep",
      "planned-high-nearby-context",
    ]);
    const overview = lookup.packet.findings[0]!;
    expect(overview.title).toBe("Largest recorded high episode");
    expect(overview.summary).toContain("reached 13.4 mmol/L");
    expect(overview.summary).not.toContain("18.1 mmol/L");
    expect(overview.summary).toContain("timing is context, not proof");

    const candidateFindings = lookup.packet.findings.filter(
      ({ id, kind }) =>
        kind === "context-clue" &&
        [
          "planned-high-nearby-meals",
          "planned-high-nearby-insulin",
          "planned-high-nearby-activity",
          "planned-high-nearby-sleep",
          "planned-high-nearby-context",
        ].includes(id),
    );
    expect(candidateFindings).toHaveLength(5);
    candidateFindings.forEach((finding) => {
      expect(finding.summary).toContain("Timing is context, not proof");
      expect(finding.caveat).toContain("Timing is context, not proof");
    });

    const evidenceById = new Map(
      lookup.packet.evidence.map((evidence) => [evidence.id, evidence]),
    );
    expect(
      evidenceById.get("planned-high-meal-context")?.examples[0],
    ).toMatchObject({ id: "meal-before-high", sourceId: "t1arc-food" });
    expect(
      evidenceById.get("planned-high-insulin-pump-context")?.examples,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bolus-before-high",
          sourceId: "glooko-pump",
        }),
        expect.objectContaining({
          id: "basal-around-high",
          sourceId: "glooko-pump",
        }),
        expect.objectContaining({
          id: "activity-mode-around-high",
          sourceId: "glooko-pump",
        }),
      ]),
    );
    expect(
      lookup.references.get("planned-high-insulin-pump-context")?.recordIds,
    ).toEqual([
      "bolus-before-high",
      "basal-around-high",
      "activity-mode-around-high",
    ]);
  });

  it("uses an isolated threshold crossing, retains duplicate record provenance, caps future context, and filters categories", async () => {
    const eventAt = Date.parse("2026-08-24T10:00:00+01:00");
    const generatedAt = eventAt + 30 * MINUTE_MS;
    const all: TimelineData = {
      ...emptyTimeline({ start: PREVIOUS_RANGE.start, end: CURRENT_RANGE.end }),
      glucose: [
        glucose("previous-normal", PREVIOUS_RANGE.start + HOUR_MS, 6.1),
        glucose("before-low", eventAt - 5 * MINUTE_MS, 6.0),
        glucose("low-libre", eventAt, 3.0, "libre"),
        glucose("low-nightscout", eventAt, 3.4, "nightscout"),
        glucose("after-low", eventAt + 5 * MINUTE_MS, 6.1),
      ],
      context: [
        {
          id: "nearby-meal",
          kind: "meal",
          start: eventAt - HOUR_MS,
          title: "Breakfast",
          mealType: "breakfast",
          carbsGrams: 35,
          sourceId: "food-source",
          origin: "manual",
        },
        {
          id: "nearby-activity-not-selected",
          kind: "activity",
          start: eventAt - 30 * MINUTE_MS,
          title: "Walk",
          activityType: "walk",
          durationMinutes: 20,
          intensity: "light",
          sourceId: "health-connect",
          origin: "imported",
        },
      ],
      basal: [
        {
          id: "basal-not-selected",
          start: eventAt - HOUR_MS,
          end: eventAt + HOUR_MS,
          rateUnitsPerHour: 0.7,
          units: 1.4,
          sourceId: "pump",
        },
      ],
    };
    const calls: TimeRange[] = [];
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "low",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["food"],
      generatedAt,
      loadTimelineData: async (range) => {
        calls.push({ ...range });
        return sliceTimeline(all, range);
      },
    });

    expect(calls[1]).toEqual({
      start: eventAt - 6 * HOUR_MS,
      end: generatedAt,
    });
    expect(new Set(lookup.packet.findings.map(({ category }) => category))).toEqual(
      new Set(["glucose", "food", "data-quality"]),
    );
    expect(lookup.packet.findings[0]).toMatchObject({
      id: "glucose-overview",
      title: "Isolated recorded low threshold crossing",
    });
    expect(lookup.packet.findings[0]?.summary).toContain("3.2 mmol/L");
    expect(
      lookup.packet.findings.some(({ category }) => category === "insulin"),
    ).toBe(false);
    expect(
      lookup.packet.findings.some(({ category }) => category === "activity"),
    ).toBe(false);

    const serializedPacket = JSON.parse(JSON.stringify(lookup.packet)) as {
      comparison: {
        current: Record<string, unknown>;
        previous: Record<string, unknown>;
      };
    };
    for (const summary of [
      serializedPacket.comparison.current,
      serializedPacket.comparison.previous,
    ]) {
      expect(summary.insulinUnits).toBeNull();
      expect(summary).not.toHaveProperty("insulinUnitsPerDay");
      expect(summary).not.toHaveProperty("basalUnitsPerDay");
      expect(summary).not.toHaveProperty("bolusUnitsPerDay");
      expect(summary.activityMinutes).toBeNull();
      expect(summary).not.toHaveProperty("stepsPerDay");
      expect(summary).not.toHaveProperty("distanceKilometresPerDay");
      expect(summary).not.toHaveProperty("activeCaloriesPerDay");
      expect(summary.sleepMinutesPerNight).toBeNull();
    }
    expect(serializedPacket.comparison.current.mealCarbsPerDay).not.toBeNull();
    expect(serializedPacket.comparison.current.lateMeals).not.toBeNull();

    const episodeEvidence = lookup.packet.evidence.find(({ id }) =>
      id.startsWith("planned-episode-detail:isolated:low"),
    );
    expect(episodeEvidence?.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "low-libre", sourceId: "libre" }),
        expect.objectContaining({
          id: "low-nightscout",
          sourceId: "nightscout",
        }),
      ]),
    );
    expect(
      lookup.references.get(episodeEvidence!.id)?.recordIds,
    ).toEqual(expect.arrayContaining(["low-libre", "low-nightscout"]));
  });

  it("surfaces explicitly requested empty categories and a caveated no-gap check", async () => {
    const { all } = fixtureWithSustainedHigh();
    const withoutFoodOrActivity: TimelineData = {
      ...all,
      context: [],
    };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["glucose", "insulin", "data-quality"],
      explicitCategories: ["insulin", "food", "activity", "data-quality"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) =>
        sliceTimeline(withoutFoodOrActivity, range),
    });

    expect(lookup.packet.findings.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "glucose-overview",
        "planned-high-requested-evidence-availability",
      ]),
    );
    expect(lookup.packet.findings.map(({ id }) => id)).not.toContain(
      "planned-high-nearby-insulin",
    );
    const availability = lookup.packet.findings.find(
      ({ id }) => id === "planned-high-requested-evidence-availability",
    );
    expect(availability?.summary).toContain("Insulin: 1 bolus");
    expect(availability?.summary).toContain(
      "Food: no meal records were loaded",
    );
    expect(availability?.summary).toContain(
      "Activity: no activity records were loaded",
    );
    expect(availability?.summary).toContain(
      "not proof that those events did not occur",
    );
    expect(availability?.summary).toContain(
      "no interval longer than 12 minutes was observed",
    );
    expect(availability?.summary).toContain(
      "does not prove complete sensor coverage",
    );
    expect(availability?.evidenceIds).toEqual([
      "planned-high-explicit-requested-checks",
    ]);
    expect(lookup.packet.requiredFindingIds).toEqual([
      "planned-high-requested-evidence-availability",
    ]);
    expect(
      lookup.packet.evidence.find(
        ({ id }) => id === "planned-high-explicit-requested-checks",
      )?.recordCount,
    ).toBeGreaterThan(0);

    const hostedOmission = parseTarvisEvidenceSelectionResult(
      JSON.stringify({ findingIds: ["glucose-overview"] }),
      lookup.packet,
    );
    expect(hostedOmission.acceptedHostedSelection).toBe(true);
    expect(hostedOmission.answer.answer).toContain(
      "Food: no meal records were loaded",
    );
    expect(localTarvisEvidenceFallback(lookup.packet).answer).toContain(
      "Activity: no activity records were loaded",
    );
  });

  it("consolidates every positive explicitly requested category within the selection cap", async () => {
    const { all } = fixtureWithSustainedHigh();
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: [
        "glucose",
        "insulin",
        "food",
        "activity",
        "sleep",
        "context",
        "data-quality",
      ],
      explicitCategories: [
        "insulin",
        "food",
        "activity",
        "sleep",
        "context",
        "data-quality",
      ],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) => sliceTimeline(all, range),
    });

    const requested = lookup.packet.findings.find(
      ({ id }) => id === "planned-high-requested-evidence-availability",
    );
    expect(requested?.summary).toContain("Insulin:");
    expect(requested?.summary).toContain("Food:");
    expect(requested?.summary).toContain("Activity:");
    expect(requested?.summary).toContain("Sleep:");
    expect(requested?.summary).toContain("Other context:");
    expect(requested?.summary).toContain("Data quality:");
    expect(requested?.evidenceIds).toHaveLength(1);
    expect(
      lookup.packet.findings.filter(({ id }) =>
        id.startsWith("planned-high-nearby-"),
      ),
    ).toEqual([]);
  });

  it("does not contradict an explicit empty insulin check with a zero-dose comparison finding", async () => {
    const { all } = fixtureWithSustainedHigh();
    const noInsulin: TimelineData = {
      ...all,
      basal: [],
      boluses: [],
      pumpStates: [],
      sources: [],
    };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["insulin"],
      explicitCategories: ["insulin"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) => sliceTimeline(noInsulin, range),
    });

    const visible = lookup.packet.findings
      .map(({ title, summary }) => `${title} ${summary}`)
      .join(" ");
    expect(visible).toContain("no insulin or pump-state records were loaded");
    expect(visible).not.toContain("0.0 U/day");
    expect(
      lookup.packet.findings.some(({ id }) => id === "insulin-change"),
    ).toBe(false);
  });

  it("does not satisfy an explicit ketone check with an unrelated medication record", async () => {
    const { all, eventStart } = fixtureWithSustainedHigh();
    const medicationOnly: TimelineData = {
      ...all,
      context: [
        {
          id: "medication-only",
          kind: "medication",
          start: eventStart - HOUR_MS,
          title: "Recorded medication",
          sourceId: "manual",
          origin: "manual",
        },
      ],
    };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["context"],
      explicitCategories: ["context"],
      explicitContextChecks: ["ketones"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) => sliceTimeline(medicationOnly, range),
    });
    const requested = lookup.packet.findings.find(({ id }) =>
      id.endsWith("requested-evidence-availability"),
    );
    expect(requested?.summary).toContain(
      "Ketones: no manually recorded ketone readings were loaded",
    );
    expect(requested?.summary).not.toContain("Medication:");
  });

  it("keeps requested medication evidence while excluding ketone records", async () => {
    const { all, eventStart } = fixtureWithSustainedHigh();
    const medication: HealthContextEvent = {
      id: "requested-medication",
      kind: "medication",
      start: eventStart - HOUR_MS,
      title: "Recorded medication",
      sourceId: "manual",
      origin: "manual",
    };
    const ketone = createManualContextEvent(
      {
        kind: "ketone",
        ketoneType: "blood",
        timestamp: eventStart - 30 * MINUTE_MS,
        value: 1.2,
      },
      { id: "excluded-ketone", recordedAt: GENERATED_AT },
    );
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["context"],
      explicitCategories: ["context"],
      explicitContextChecks: ["medication"],
      excludedContextChecks: ["ketones"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) =>
        sliceTimeline({ ...all, context: [medication, ketone] }, range),
    });
    const requested = lookup.packet.findings.find(({ id }) =>
      id.endsWith("requested-evidence-availability"),
    );
    expect(requested?.summary).toContain("Medication: 1 medication record");
    expect(requested?.summary).not.toContain("Ketones:");
    expect(
      lookup.references.get("planned-high-explicit-requested-checks")
        ?.recordIds,
    ).toContain("requested-medication");
    expect(
      lookup.references.get("planned-high-explicit-requested-checks")
        ?.recordIds,
    ).not.toContain("excluded-ketone");
  });

  it("covers source freshness, bounded coverage, and reading gaps in an explicit data-quality check", async () => {
    const { all, eventStart } = fixtureWithSustainedHigh();
    const withGapAndStaleSource: TimelineData = {
      ...all,
      glucose: all.glucose.filter(
        ({ timestamp }) =>
          timestamp < eventStart - 45 * MINUTE_MS ||
          timestamp > eventStart - 20 * MINUTE_MS,
      ),
      sources: all.sources.map((source, index) =>
        index === 0 ? { ...source, freshness: "stale" as const } : source,
      ),
    };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["data-quality"],
      explicitCategories: ["data-quality"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) =>
        sliceTimeline(withGapAndStaleSource, range),
    });
    const summary = lookup.packet.findings.find(({ id }) =>
      id.endsWith("requested-evidence-availability"),
    )?.summary;
    expect(summary).toContain("observed glucose coverage was");
    expect(summary).toContain("Source freshness at review time");
    expect(summary).toContain("1 stale");
    expect(summary).toContain("exceeded 12 minutes");
  });

  it("reports only source freshness when gaps are explicitly excluded", async () => {
    const { all, eventStart } = fixtureWithSustainedHigh();
    const withGapAndStaleSource: TimelineData = {
      ...all,
      glucose: [
        ...all.glucose.filter(
          ({ timestamp }) => timestamp < CURRENT_RANGE.start,
        ),
        glucose("before-excluded-gap", eventStart - 30 * MINUTE_MS, 6.2),
        ...all.glucose.filter(({ id }) => id.startsWith("sustained-high-")),
      ],
      sources: all.sources.map((source, index) =>
        index === 0 ? { ...source, freshness: "stale" as const } : source,
      ),
    };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["data-quality"],
      explicitCategories: ["data-quality"],
      explicitDataQualityChecks: ["freshness"],
      excludedDataQualityChecks: ["gaps"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) =>
        sliceTimeline(withGapAndStaleSource, range),
    });
    const summary = lookup.packet.findings.find(({ id }) =>
      id.endsWith("requested-evidence-availability"),
    )?.summary;
    expect(summary).toContain("Source freshness at review time");
    expect(summary).toContain("1 stale");
    expect(summary).not.toContain("observed glucose coverage");
    expect(summary).not.toContain("exceeded 12 minutes");
    const visiblePacketProse = [
      lookup.packet.comparison.summary,
      ...lookup.packet.findings.flatMap(({ title, summary, caveat }) => [
        title,
        summary,
        caveat,
      ]),
    ].join(" ");
    expect(visiblePacketProse).not.toMatch(/sensor coverage|uncovered interval/i);
    expect(
      lookup.references.get("planned-high-explicit-requested-checks")
        ?.recordIds,
    ).toEqual(["libre", "glooko-pump"]);
  });

  it("reports only reading gaps for the exact phone-question subtype", async () => {
    const { all, eventStart } = fixtureWithSustainedHigh();
    const withGapAndStaleSource: TimelineData = {
      ...all,
      glucose: all.glucose.filter(
        ({ timestamp }) =>
          timestamp < eventStart - 45 * MINUTE_MS ||
          timestamp > eventStart - 20 * MINUTE_MS,
      ),
      sources: all.sources.map((source) => ({
        ...source,
        freshness: "stale" as const,
      })),
    };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["data-quality"],
      explicitCategories: ["data-quality"],
      explicitDataQualityChecks: ["gaps"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) =>
        sliceTimeline(withGapAndStaleSource, range),
    });
    const summary = lookup.packet.findings.find(({ id }) =>
      id.endsWith("requested-evidence-availability"),
    )?.summary;
    expect(summary).toContain("exceeded 12 minutes");
    expect(summary).not.toContain("observed glucose coverage");
    expect(summary).not.toContain("Source freshness at review time");
    expect(
      lookup.references.get("planned-high-explicit-requested-checks")
        ?.recordIds,
    ).not.toEqual(expect.arrayContaining(["libre", "glooko-pump"]));
  });

  it("does not add empty-category findings for categories the user did not explicitly request", async () => {
    const { all } = fixtureWithSustainedHigh();
    const withoutContext: TimelineData = { ...all, context: [] };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["food", "activity", "data-quality"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) => sliceTimeline(withoutContext, range),
    });

    expect(
      lookup.packet.findings.some(({ id }) =>
        id.endsWith("requested-evidence-availability"),
      ),
    ).toBe(false);
  });

  it("reports no readings as missing evidence and retains source-state provenance", async () => {
    const source: TimelineData = {
      ...emptyTimeline({ start: PREVIOUS_RANGE.start, end: CURRENT_RANGE.end }),
      glucose: [
        glucose("previous-only", PREVIOUS_RANGE.start + HOUR_MS, 6.0),
      ],
      sources: [
        {
          id: "libre-source-status",
          label: "LibreLinkUp",
          detail: "No readings returned",
          freshness: "missing",
          origin: "live",
          lastAttemptAt: GENERATED_AT - MINUTE_MS,
          isLive: true,
        },
      ],
    };
    const calls: TimeRange[] = [];
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: ["context"],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) => {
        calls.push({ ...range });
        return sliceTimeline(source, range);
      },
    });

    expect(calls).toEqual([CURRENT_RANGE, PREVIOUS_RANGE]);
    expect(lookup.packet.findings[0]).toMatchObject({
      id: "planned-high-no-readings",
      category: "data-quality",
    });
    expect(lookup.packet.findings[0]?.summary).toContain(
      "missing evidence, not proof that no high occurred",
    );
    const evidence = lookup.packet.evidence.find(
      ({ id }) => id === "planned-high-empty-search",
    );
    expect(evidence).toMatchObject({ recordCount: 1 });
    expect(evidence?.examples[0]).toMatchObject({
      id: "libre-source-status",
      sourceId: "libre-source-status",
    });
    expect(
      lookup.references.get("planned-high-empty-search")?.recordIds,
    ).toEqual(["libre-source-status"]);
  });

  it("does not invent an episode and explicitly surfaces sensor gaps", async () => {
    const first = CURRENT_RANGE.start + HOUR_MS;
    const source: TimelineData = {
      ...emptyTimeline({ start: PREVIOUS_RANGE.start, end: CURRENT_RANGE.end }),
      glucose: [
        glucose("previous-normal", PREVIOUS_RANGE.start + HOUR_MS, 6.1),
        glucose("current-before-gap", first, 6.0),
        glucose("current-after-gap", first + 30 * MINUTE_MS, 6.4),
      ],
    };
    const lookup = await loadPlannedGlucoseEpisodeEvidence({
      selectedEventKind: "high",
      currentRange: CURRENT_RANGE,
      previousRange: PREVIOUS_RANGE,
      selectedCategories: [],
      generatedAt: GENERATED_AT,
      loadTimelineData: async (range) => sliceTimeline(source, range),
    });

    expect(lookup.packet.findings.slice(0, 2).map(({ id }) => id)).toEqual([
      "glucose-overview",
      "planned-high-data-quality",
    ]);
    expect(lookup.packet.findings[0]?.summary).toContain(
      "none crossed above 10.0 mmol/L",
    );
    expect(lookup.packet.findings[0]?.summary).toContain(
      "does not prove that no high occurred",
    );
    expect(lookup.packet.findings[1]?.summary).toContain(
      "longest was 30 minutes",
    );
    expect(
      lookup.references.get("planned-high-sensor-gaps")?.recordIds,
    ).toEqual(["current-before-gap", "current-after-gap"]);
  });
});
