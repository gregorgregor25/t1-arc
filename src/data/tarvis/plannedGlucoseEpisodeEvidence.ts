import {
  buildGlucoseEpisodeEvidence,
  buildInsightReport,
  detectGlucoseEpisodes,
  rankGlucoseEpisodes,
  type EvidenceRecordPreview,
  type EvidenceReference,
  type GlucoseEpisode,
  type InsightFinding,
} from "@/domain/insights";
import {
  TARGET_HIGH_MMOL_L,
  TARGET_LOW_MMOL_L,
  type GlucoseReading,
  type HealthContextEvent,
  type TimelineData,
  type TimeRange,
} from "@/domain/models";
import { formatShortDate, formatTime, toDateKey } from "@/domain/time";
import { buildDataCompletenessReport } from "@/domain/dataCompleteness";
import { isManualKetoneEvent } from "@/data/manualContext";
import { contextNoteDisplayTitle } from "@/domain/contextNotes";
import { formatGlucose, formatWeight } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import {
  formatTarvisFixedNumber,
  formatTarvisNumber,
} from "./regionalNumberPresentation";

import { buildTarvisEvidencePacket } from "./evidencePacket";
import {
  TARVIS_EXPLICIT_DATA_QUALITY_CHECK_IDS,
  type TarvisExcludedContextCheck,
  type TarvisExplicitContextCheck,
  type TarvisExplicitDataQualityCheck,
} from "./evidencePlanner";
import type {
  TarvisEvidenceLookup,
  TarvisInsightWindowSummary,
} from "./types";

const HOUR_MS = 60 * 60_000;
const MAX_CONTEXT_BEFORE_MS = 6 * HOUR_MS;
const MAX_CONTEXT_AFTER_MS = 2 * HOUR_MS;
const SENSOR_CONTINUITY_LIMIT_MS = 12 * 60_000;

function regionalGlucose(mmolL: number) {
  return formatGlucose(mmolL, getRuntimeRegionalDefaults());
}

function wholeNumber(value: number) {
  return formatTarvisNumber(value, { maximumFractionDigits: 0 });
}

function contextTitle(event: HealthContextEvent) {
  return event.kind === "note"
    ? contextNoteDisplayTitle(event, getRuntimeRegionalDefaults())
    : event.title;
}

export type TarvisEvidenceCategory =
  | "glucose"
  | "insulin"
  | "food"
  | "activity"
  | "sleep"
  | "context"
  | "data-quality";

export interface LoadPlannedGlucoseEpisodeEvidenceOptions {
  selectedEventKind: "high" | "low";
  currentRange: TimeRange;
  previousRange: TimeRange;
  selectedCategories: readonly TarvisEvidenceCategory[];
  explicitCategories?: readonly TarvisEvidenceCategory[];
  explicitContextChecks?: readonly TarvisExplicitContextCheck[];
  excludedContextChecks?: readonly TarvisExcludedContextCheck[];
  explicitDataQualityChecks?: readonly TarvisExplicitDataQualityCheck[];
  excludedDataQualityChecks?: readonly TarvisExplicitDataQualityCheck[];
  generatedAt: number;
  loadTimelineData(range: TimeRange): Promise<TimelineData>;
}

interface SelectedEpisode {
  episode: GlucoseEpisode;
  detection: "sustained" | "isolated";
}

interface SensorGap {
  before: GlucoseReading[];
  after: GlucoseReading[];
  durationMinutes: number;
}

const ALLOWED_CATEGORIES = new Set<TarvisEvidenceCategory>([
  "glucose",
  "insulin",
  "food",
  "activity",
  "sleep",
  "context",
  "data-quality",
]);

function assertTimeRange(label: string, range: TimeRange) {
  if (
    !Number.isFinite(range.start) ||
    !Number.isFinite(range.end) ||
    range.start < 0 ||
    range.end <= range.start
  ) {
    throw new RangeError(`${label} must be a finite, positive time range.`);
  }
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function eventEnd(event: HealthContextEvent) {
  return event.end ?? event.start;
}

function contextEventMatchesCheck(
  event: HealthContextEvent,
  check: TarvisExcludedContextCheck,
) {
  switch (check) {
    case "illness":
      return event.kind === "note" && event.category === "illness";
    case "stress":
      return event.kind === "note" && event.category === "stress";
    case "hormones":
      return event.kind === "note" && event.category === "hormones";
    case "medication":
      return event.kind === "medication";
    case "ketones":
      return isManualKetoneEvent(event);
  }
}

function withoutExcludedContextChecks(
  timeline: TimelineData,
  excluded: ReadonlySet<TarvisExcludedContextCheck>,
): TimelineData {
  if (!excluded.size) return timeline;
  return {
    ...timeline,
    context: timeline.context.filter(
      (event) =>
        ![...excluded].some((check) =>
          contextEventMatchesCheck(event, check),
        ),
    ),
  };
}

function overlapsRange(start: number, end: number, range: TimeRange) {
  return start < range.end && end >= range.start;
}

/**
 * Repository implementations normally honour the requested range. Filtering
 * again here makes the planner boundary explicit and prevents an over-broad
 * repository result from reaching the model packet.
 */
function restrictTimelineToRange(
  timeline: TimelineData,
  range: TimeRange,
): TimelineData {
  return {
    ...timeline,
    range: { ...range },
    glucose: timeline.glucose.filter(
      ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
    ),
    basal: timeline.basal.filter(({ start, end }) =>
      overlapsRange(start, end, range),
    ),
    boluses: timeline.boluses.filter(
      ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
    ),
    dailyInsulinTotals: timeline.dailyInsulinTotals?.filter(
      ({ timestamp }) => timestamp >= range.start && timestamp < range.end,
    ),
    pumpStates: timeline.pumpStates?.filter(({ start, end }) =>
      overlapsRange(start, end, range),
    ),
    context: timeline.context.filter((event) =>
      overlapsRange(event.start, eventEnd(event), range),
    ),
  };
}

function requestedCategories(
  selectedCategories: readonly TarvisEvidenceCategory[],
) {
  const selected = new Set<TarvisEvidenceCategory>([
    "glucose",
    "data-quality",
  ]);
  selectedCategories.forEach((category) => {
    if (ALLOWED_CATEGORIES.has(category)) selected.add(category);
  });
  return selected;
}

function plannerCategoryForInsightCategory(
  category: InsightFinding["category"],
): TarvisEvidenceCategory {
  switch (category) {
    case "heart":
    case "weight":
    case "body":
    case "vitals":
    case "hydration":
    case "medication":
      return "context";
    default:
      return category;
  }
}

function redactUnselectedSummaryCategories(
  summary: TarvisInsightWindowSummary,
  categories: ReadonlySet<TarvisEvidenceCategory>,
): TarvisInsightWindowSummary {
  const redacted = { ...summary };
  if (!categories.has("insulin")) {
    redacted.insulinUnits = null;
    delete redacted.insulinUnitsPerDay;
    delete redacted.basalUnitsPerDay;
    delete redacted.bolusUnitsPerDay;
  }
  if (!categories.has("food")) {
    redacted.mealCarbsPerDay = null;
    redacted.lateMeals = null;
  }
  if (!categories.has("sleep")) {
    redacted.sleepMinutesPerNight = null;
  }
  if (!categories.has("activity")) {
    redacted.activityMinutes = null;
    delete redacted.stepsPerDay;
    delete redacted.distanceKilometresPerDay;
    delete redacted.activeCaloriesPerDay;
  }
  if (!categories.has("context")) {
    delete redacted.averageHeartRateBpm;
    delete redacted.restingHeartRateBpm;
    delete redacted.averageWeightKilograms;
    delete redacted.weightRecords;
    delete redacted.bodyFatPercent;
    delete redacted.leanBodyMassKilograms;
    delete redacted.bodyWaterMassKilograms;
    delete redacted.hydrationLitresPerDay;
    delete redacted.healthConnectBloodGlucoseMmolL;
    delete redacted.bloodPressureSystolic;
    delete redacted.bloodPressureDiastolic;
    delete redacted.oxygenSaturationPercent;
    delete redacted.respiratoryRatePerMinute;
    delete redacted.heartRateVariabilityRmssdMs;
    delete redacted.vo2MaxMillilitresPerKilogramMinute;
    delete redacted.bodyTemperatureCelsius;
  }
  return redacted;
}

function canonicalReadingsAtEachTimestamp(readings: readonly GlucoseReading[]) {
  const groups = new Map<number, GlucoseReading[]>();
  [...readings]
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.id.localeCompare(right.id),
    )
    .forEach((reading) => {
      groups.set(reading.timestamp, [
        ...(groups.get(reading.timestamp) ?? []),
        reading,
      ]);
    });

  return [...groups.entries()].map(([timestamp, group]) => {
    const representative = group[0]!;
    return {
      ...representative,
      timestamp,
      receivedAt: Math.max(...group.map(({ receivedAt }) => receivedAt)),
      mmolL:
        group.reduce((sum, reading) => sum + reading.mmolL, 0) / group.length,
      quality: group.every(({ quality }) => quality === "measured")
        ? ("measured" as const)
        : ("estimated" as const),
      recordIds: group.map(({ id }) => id),
    };
  });
}

function selectEpisode(
  readings: readonly GlucoseReading[],
  eventKind: "high" | "low",
): SelectedEpisode | undefined {
  const sustained = rankGlucoseEpisodes(
    detectGlucoseEpisodes([...readings], eventKind),
    1,
  )[0];
  if (sustained) return { episode: sustained, detection: "sustained" };

  const threshold =
    eventKind === "high" ? TARGET_HIGH_MMOL_L : TARGET_LOW_MMOL_L;
  const crossings = canonicalReadingsAtEachTimestamp(readings).filter(
    ({ mmolL }) =>
      eventKind === "high" ? mmolL > threshold : mmolL < threshold,
  );
  const isolated = [...crossings].sort((left, right) => {
    const extreme =
      eventKind === "high"
        ? right.mmolL - left.mmolL
        : left.mmolL - right.mmolL;
    return extreme || left.timestamp - right.timestamp;
  })[0];
  if (!isolated) return undefined;

  return {
    detection: "isolated",
    episode: {
      id: `isolated:${eventKind}:${threshold}:${isolated.timestamp}`,
      kind: eventKind,
      thresholdMmolL: threshold,
      start: isolated.timestamp,
      end: isolated.timestamp,
      endStatus: "observation-ended",
      readings: [isolated],
      extremeMmolL: isolated.mmolL,
    },
  };
}

function incidentContextRange(
  episode: GlucoseEpisode,
  generatedAt: number,
): TimeRange {
  const start = Math.max(0, episode.start - MAX_CONTEXT_BEFORE_MS);
  const desiredEnd = episode.end + MAX_CONTEXT_AFTER_MS;
  // Timeline ends are exclusive. The one-millisecond floor retains an event
  // recorded exactly at generatedAt without meaningfully extending the scope.
  const end = Math.max(
    episode.end + 1,
    Math.min(desiredEnd, generatedAt),
  );
  return { start, end };
}

function dateTime(timestamp: number) {
  return `${formatShortDate(toDateKey(timestamp))} at ${formatTime(timestamp)}`;
}

function glucosePreview(reading: GlucoseReading): EvidenceRecordPreview {
  return {
    id: reading.id,
    kind: "glucose",
    timestamp: reading.timestamp,
    primary: regionalGlucose(reading.mmolL),
    secondary: reading.quality,
    sourceId: reading.sourceId,
  };
}

function basalPreview(
  delivery: TimelineData["basal"][number],
): EvidenceRecordPreview {
  return {
    id: delivery.id,
    kind: "basal",
    timestamp: delivery.start,
    primary: `${formatTarvisFixedNumber(delivery.rateUnitsPerHour, 2)} U/h basal`,
    secondary: `${formatTarvisFixedNumber(delivery.units, 2)} U recorded in the interval`,
    sourceId: delivery.sourceId,
  };
}

function bolusPreview(
  delivery: TimelineData["boluses"][number],
): EvidenceRecordPreview {
  return {
    id: delivery.id,
    kind: "bolus",
    timestamp: delivery.timestamp,
    primary: `${formatTarvisFixedNumber(delivery.units, 1)} U bolus`,
    secondary: "Recorded delivery",
    sourceId: delivery.sourceId,
  };
}

function pumpStatePreview(
  state: NonNullable<TimelineData["pumpStates"]>[number],
): EvidenceRecordPreview {
  return {
    id: state.id,
    kind: "source-record",
    timestamp: state.start,
    primary:
      state.kind === "activity-mode" ? "Pump activity mode" : "Automated pause",
    secondary: `${formatTime(state.start)} to ${formatTime(state.end)}`,
    sourceId: state.sourceId,
  };
}

function contextPreview(event: HealthContextEvent): EvidenceRecordPreview {
  let secondary = "Recorded context";
  if (event.kind === "meal") {
    secondary =
      event.carbsGrams === undefined
        ? event.mealType
        : `${event.mealType} · ${formatTarvisFixedNumber(event.carbsGrams, 0)} g carbohydrate`;
  } else if (event.kind === "activity") {
    secondary = `${formatTarvisFixedNumber(event.durationMinutes, 0)} min${
      event.intensity === "unspecified" ? "" : ` · ${event.intensity}`
    }`;
  } else if (event.kind === "sleep") {
    const hours = Math.floor(event.durationMinutes / 60);
    const minutes = event.durationMinutes % 60;
    secondary = `${wholeNumber(hours)}h ${wholeNumber(minutes)}m recorded sleep`;
  } else if (event.kind === "weight") {
    secondary = formatWeight(event.kilograms, getRuntimeRegionalDefaults());
  } else if (event.kind === "medication") {
    secondary =
      event.amount === undefined
        ? "Recorded medication event"
        : `${formatTarvisNumber(event.amount, { maximumFractionDigits: 2 })}${event.unit ? ` ${event.unit}` : ""}`;
  } else if (event.kind === "note") {
    secondary = event.detail ?? `${event.category} note`;
  }
  return {
    id: event.id,
    kind: "context",
    timestamp: event.start,
    primary: contextTitle(event),
    secondary,
    sourceId: event.sourceId,
  };
}

function representativeGlucosePreviews(
  readings: readonly GlucoseReading[],
): EvidenceRecordPreview[] {
  if (!readings.length) return [];
  const ordered = [...readings].sort(
    (left, right) =>
      left.timestamp - right.timestamp || left.id.localeCompare(right.id),
  );
  const highest = [...ordered].sort((left, right) => right.mmolL - left.mmolL)[0]!;
  const lowest = [...ordered].sort((left, right) => left.mmolL - right.mmolL)[0]!;
  const candidates = [ordered[0]!, highest, lowest, ordered.at(-1)!];
  return [
    ...new Map(candidates.map((reading) => [reading.id, glucosePreview(reading)])).values(),
  ];
}

function evidenceForSearch(
  id: string,
  label: string,
  timeline: TimelineData,
  generatedAt: number,
): EvidenceReference {
  const sourceExamples: EvidenceRecordPreview[] = timeline.sources
    .slice(0, 5)
    .map((source) => ({
      id: source.id,
      kind: "source-record",
      timestamp:
        source.dataThrough ??
        source.lastUpdatedAt ??
        source.lastAttemptAt ??
        generatedAt,
      primary: source.label,
      secondary: `${source.freshness} · ${source.detail}`,
      sourceId: source.id,
    }));
  return {
    id,
    label,
    description: `${wholeNumber(timeline.glucose.length)} glucose readings were loaded from the exact requested period`,
    range: timeline.range,
    recordIds: timeline.glucose.length
      ? timeline.glucose.map(({ id: recordId }) => recordId)
      : timeline.sources.map(({ id: sourceId }) => sourceId),
    examples: timeline.glucose.length
      ? representativeGlucosePreviews(timeline.glucose)
      : sourceExamples,
  };
}

function selectedEpisodeEvidence(
  selected: SelectedEpisode,
  incidentTimeline: TimelineData,
): EvidenceReference {
  const built = buildGlucoseEpisodeEvidence(
    selected.episode,
    incidentTimeline,
  );
  const selectedRecordIds = new Set(
    selected.episode.readings.flatMap(({ recordIds }) => recordIds),
  );
  const rawSelectedReadings = incidentTimeline.glucose.filter(({ id }) =>
    selectedRecordIds.has(id),
  );
  const eventExamples = representativeGlucosePreviews(rawSelectedReadings);
  return {
    ...built,
    id: `planned-${built.id}`,
    description: `${built.description}. The surrounding window is bounded to at most six hours before and two hours after the event; timing is context, not proof of cause`,
    recordIds: unique([...built.recordIds, ...selectedRecordIds]),
    examples: [
      ...new Map(
        [...eventExamples, ...built.examples].map((example) => [
          example.id,
          example,
        ]),
      ).values(),
    ],
  };
}

function contextEvidence(
  id: string,
  label: string,
  description: string,
  range: TimeRange,
  events: readonly HealthContextEvent[],
): EvidenceReference {
  return {
    id,
    label,
    description,
    range,
    recordIds: events.map(({ id: recordId }) => recordId),
    examples: events.slice(0, 5).map(contextPreview),
  };
}

function categoryTimingCaveat(eventKind: "high" | "low") {
  return `Timing is context, not proof that the recorded item caused the ${eventKind}.`;
}

function eventOverviewFinding(
  selected: SelectedEpisode,
  incidentTimeline: TimelineData,
): InsightFinding {
  const { episode, detection } = selected;
  const label = episode.kind === "high" ? "high" : "low";
  const thresholdRelation = episode.kind === "high" ? "above" : "below";
  const endDetail =
    detection === "isolated"
      ? `It did not meet the ${wholeNumber(15)}-minute sustained-episode definition.`
      : episode.endStatus === "confirmed-recovery"
        ? `The first recorded return across the threshold was at ${formatTime(episode.end)} and later readings confirmed it.`
        : episode.endStatus === "sensor-gap"
          ? `A sensor gap longer than ${wholeNumber(12)} minutes ended observed continuity, so the records do not prove when recovery occurred.`
          : "The loaded observations ended before a recovery could be confirmed.";
  const summary =
    detection === "sustained"
      ? `The largest sustained ${label} in the requested period ran from ${dateTime(episode.start)} to ${formatTime(episode.end)}, reached ${regionalGlucose(episode.extremeMmolL)}, and contained ${wholeNumber(episode.readings.length)} canonical readings. ${endDetail} Nearby timing is context, not proof of what caused the ${label}.`
      : `No sustained ${label} met the ${wholeNumber(15)}-minute definition, but the largest isolated threshold crossing was ${regionalGlucose(episode.extremeMmolL)} at ${dateTime(episode.start)}, ${thresholdRelation} ${regionalGlucose(episode.thresholdMmolL)}. ${endDetail} Nearby timing is context, not proof of what caused the reading.`;
  return {
    // `buildTarvisEvidencePacket` deliberately retains this ID even when the
    // comparison window has no glucose, which is essential for an incident
    // that is supported in the current window but lacks a prior comparator.
    id: "glucose-overview",
    kind: "observation",
    category: "glucose",
    title:
      detection === "sustained"
        ? `Largest recorded ${label} episode`
        : `Isolated recorded ${label} threshold crossing`,
    summary,
    caveat:
      "This describes recorded sensor data and bounded nearby records; it does not diagnose or establish a cause.",
    evidence: [selectedEpisodeEvidence(selected, incidentTimeline)],
  };
}

function mealFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
): InsightFinding | undefined {
  const meals = timeline.context.filter((event) => event.kind === "meal");
  if (!meals.length) return undefined;
  const examples = meals
    .slice(0, 3)
    .map(
      (meal) =>
        `${meal.title} at ${formatTime(meal.start)}${
          meal.carbsGrams === undefined
            ? ""
            : ` (${formatTarvisFixedNumber(meal.carbsGrams, 0)} g carbohydrate)`
        }`,
    );
  const caveat = categoryTimingCaveat(eventKind);
  return {
    id: `planned-${eventKind}-nearby-meals`,
    kind: "context-clue",
    category: "food",
    title: "Meals recorded near the episode",
    summary: `${wholeNumber(meals.length)} meal${meals.length === 1 ? " was" : "s were"} recorded in the bounded context window: ${examples.join("; ")}${
      meals.length > examples.length ? `; and ${wholeNumber(meals.length - examples.length)} more` : ""
    }. ${caveat}`,
    caveat,
    evidence: [
      contextEvidence(
        `planned-${eventKind}-meal-context`,
        "Nearby recorded meals",
        `${wholeNumber(meals.length)} meal records in the bounded incident window. ${caveat}`,
        timeline.range,
        meals,
      ),
    ],
  };
}

function insulinFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
): InsightFinding | undefined {
  const pumpStates = timeline.pumpStates ?? [];
  if (!timeline.boluses.length && !timeline.basal.length && !pumpStates.length) {
    return undefined;
  }
  const caveat = categoryTimingCaveat(eventKind);
  const parts = [
    timeline.boluses.length
      ? `${wholeNumber(timeline.boluses.length)} bolus${timeline.boluses.length === 1 ? "" : "es"}`
      : undefined,
    timeline.basal.length
      ? `${wholeNumber(timeline.basal.length)} basal interval${timeline.basal.length === 1 ? "" : "s"}`
      : undefined,
    pumpStates.length
      ? `${wholeNumber(pumpStates.length)} pump-state interval${pumpStates.length === 1 ? "" : "s"}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  const evidence: EvidenceReference = {
    id: `planned-${eventKind}-insulin-pump-context`,
    label: "Nearby insulin and pump records",
    description: `${parts.join(", ")} in the bounded incident window. ${caveat}`,
    range: timeline.range,
    recordIds: unique([
      ...timeline.boluses.map(({ id }) => id),
      ...timeline.basal.map(({ id }) => id),
      ...pumpStates.map(({ id }) => id),
    ]),
    examples: [
      ...timeline.boluses.slice(0, 2).map(bolusPreview),
      ...timeline.basal.slice(0, 2).map(basalPreview),
      ...pumpStates.slice(0, 2).map(pumpStatePreview),
    ],
  };
  return {
    id: `planned-${eventKind}-nearby-insulin`,
    kind: "context-clue",
    category: "insulin",
    title: "Insulin and pump records near the episode",
    summary: `${parts.join(", ")} were recorded in the bounded context window. These records do not establish insulin on board or physiological insulin adequacy. ${caveat}`,
    caveat,
    evidence: [evidence],
  };
}

function activityFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
): InsightFinding | undefined {
  const activities = timeline.context.filter(
    (event) => event.kind === "activity",
  );
  if (!activities.length) return undefined;
  const caveat = categoryTimingCaveat(eventKind);
  return {
    id: `planned-${eventKind}-nearby-activity`,
    kind: "context-clue",
    category: "activity",
    title: "Activity recorded near the episode",
    summary: `${activities
      .slice(0, 3)
      .map(
        (activity) =>
          `${activity.title} at ${formatTime(activity.start)} for ${formatTarvisFixedNumber(activity.durationMinutes, 0)} minutes`,
      )
      .join("; ")}${
      activities.length > 3 ? `; and ${wholeNumber(activities.length - 3)} more` : ""
    }. ${caveat}`,
    caveat,
    evidence: [
      contextEvidence(
        `planned-${eventKind}-activity-context`,
        "Nearby recorded activity",
        `${wholeNumber(activities.length)} activity record${activities.length === 1 ? "" : "s"} in the bounded incident window. ${caveat}`,
        timeline.range,
        activities,
      ),
    ],
  };
}

function sleepFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
): InsightFinding | undefined {
  const sleeps = timeline.context.filter((event) => event.kind === "sleep");
  if (!sleeps.length) return undefined;
  const caveat = categoryTimingCaveat(eventKind);
  return {
    id: `planned-${eventKind}-nearby-sleep`,
    kind: "context-clue",
    category: "sleep",
    title: "Sleep recorded near the episode",
    summary: `${sleeps
      .slice(0, 3)
      .map(
        (sleep) =>
          `${sleep.title} ending at ${formatTime(sleep.end)} (${formatTarvisFixedNumber(sleep.durationMinutes, 0)} minutes)`,
      )
      .join("; ")}${sleeps.length > 3 ? `; and ${wholeNumber(sleeps.length - 3)} more` : ""}. ${caveat}`,
    caveat,
    evidence: [
      contextEvidence(
        `planned-${eventKind}-sleep-context`,
        "Nearby recorded sleep",
        `${wholeNumber(sleeps.length)} sleep record${sleeps.length === 1 ? "" : "s"} overlapping the bounded incident window. ${caveat}`,
        timeline.range,
        sleeps,
      ),
    ],
  };
}

function otherContextFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
): InsightFinding | undefined {
  const context = timeline.context.filter(
    (event) =>
      event.kind !== "meal" &&
      event.kind !== "activity" &&
      event.kind !== "sleep",
  );
  if (!context.length) return undefined;
  const caveat = categoryTimingCaveat(eventKind);
  return {
    id: `planned-${eventKind}-nearby-context`,
    kind: "context-clue",
    category: "context",
    title: "Other records near the episode",
    summary: `${context
      .slice(0, 3)
      .map((event) => `${contextTitle(event)} at ${formatTime(event.start)}`)
      .join("; ")}${context.length > 3 ? `; and ${wholeNumber(context.length - 3)} more` : ""}. ${caveat}`,
    caveat,
    evidence: [
      contextEvidence(
        `planned-${eventKind}-other-context`,
        "Other nearby recorded context",
        `${wholeNumber(context.length)} other context record${context.length === 1 ? "" : "s"} in the bounded incident window. ${caveat}`,
        timeline.range,
        context,
      ),
    ],
  };
}

function sensorGaps(readings: readonly GlucoseReading[]): SensorGap[] {
  const groups = new Map<number, GlucoseReading[]>();
  readings.forEach((reading) => {
    groups.set(reading.timestamp, [
      ...(groups.get(reading.timestamp) ?? []),
      reading,
    ]);
  });
  const ordered = [...groups.entries()].sort(([left], [right]) => left - right);
  return ordered.slice(1).flatMap(([timestamp, after], index) => {
    const [previousTimestamp, before] = ordered[index]!;
    const gapMs = timestamp - previousTimestamp;
    return gapMs > SENSOR_CONTINUITY_LIMIT_MS
      ? [
          {
            before,
            after,
            durationMinutes: Math.round(gapMs / 60_000),
          },
        ]
      : [];
  });
}

function sensorGapFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
  episode?: GlucoseEpisode,
): InsightFinding | undefined {
  const gaps = sensorGaps(timeline.glucose);
  if (!gaps.length && episode?.endStatus !== "sensor-gap") return undefined;
  const represented = gaps.flatMap((gap) => [
    ...gap.before.slice(0, 1),
    ...gap.after.slice(0, 1),
  ]);
  const longest = Math.max(0, ...gaps.map(({ durationMinutes }) => durationMinutes));
  const description = `${wholeNumber(gaps.length)} observed interval${gaps.length === 1 ? "" : "s"} between glucose readings longer than ${wholeNumber(12)} minutes${
    longest ? `; the longest was ${wholeNumber(longest)} minutes` : ""
  }. Missing sensor time makes chronology incomplete`;
  const evidence: EvidenceReference = {
    id: `planned-${eventKind}-sensor-gaps`,
    label: "Sensor continuity around the episode",
    description,
    range: timeline.range,
    recordIds: unique(represented.map(({ id }) => id)),
    examples: represented.slice(0, 5).map(glucosePreview),
  };
  return {
    id: `planned-${eventKind}-data-quality`,
    kind: "limitation",
    category: "data-quality",
    title: "Sensor gaps limit the episode chronology",
    summary: `${description}. T1 Arc does not assume glucose stayed steady during a gap or infer a cause across missing sensor time.`,
    caveat:
      "The observed end of an episode at a sensor gap is not proof of recovery.",
    evidence: [evidence],
  };
}

function requestedEvidenceCheckFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
  explicitCategories: ReadonlySet<TarvisEvidenceCategory>,
  explicitContextChecks: ReadonlySet<TarvisExplicitContextCheck>,
  explicitDataQualityChecks: ReadonlySet<TarvisExplicitDataQualityCheck>,
  episode?: GlucoseEpisode,
): InsightFinding | undefined {
  const requested = new Set(
    [...explicitCategories].filter((category) => category !== "glucose"),
  );
  if (!requested.size) return undefined;

  const scopeLabel = episode
    ? "bounded episode window"
    : "exact requested period";
  const summaries: string[] = [];
  const recordIds: string[] = [];
  const examples: EvidenceRecordPreview[] = [];
  let hasEmptyResult = false;
  let hasContinuityLimitation = false;
  const addFinding = (label: string, finding: InsightFinding | undefined) => {
    if (!finding) return false;
    summaries.push(`${label}: ${finding.summary}`);
    finding.evidence.forEach((reference) => {
      recordIds.push(...reference.recordIds);
      examples.push(...reference.examples);
    });
    return true;
  };
  const addEmpty = (label: string, recordLabel: string) => {
    hasEmptyResult = true;
    summaries.push(
      `${label}: no ${recordLabel} were loaded from the ${scopeLabel}.`,
    );
  };

  if (requested.has("insulin")) {
    if (
      !addFinding("Insulin", insulinFinding(eventKind, timeline))
    ) {
      addEmpty("Insulin", "insulin or pump-state records");
    }
  }
  if (requested.has("food")) {
    if (!addFinding("Food", mealFinding(eventKind, timeline))) {
      addEmpty("Food", "meal records");
    }
  }
  if (requested.has("activity")) {
    if (!addFinding("Activity", activityFinding(eventKind, timeline))) {
      addEmpty("Activity", "activity records");
    }
  }
  if (requested.has("sleep")) {
    if (!addFinding("Sleep", sleepFinding(eventKind, timeline))) {
      addEmpty("Sleep", "sleep records");
    }
  }
  if (requested.has("context")) {
    const addSpecificContextCheck = (
      check: Exclude<TarvisExplicitContextCheck, "context">,
      label: string,
      recordLabel: string,
      matches: (event: HealthContextEvent) => boolean,
    ) => {
      if (!explicitContextChecks.has(check)) return;
      const events = timeline.context.filter(matches);
      if (!events.length) {
        hasEmptyResult = true;
        summaries.push(
          `${label}: no ${recordLabel}s were loaded from the ${scopeLabel}.`,
        );
        return;
      }
      const caveat = categoryTimingCaveat(eventKind);
      summaries.push(
        `${label}: ${wholeNumber(events.length)} ${recordLabel}${events.length === 1 ? " was" : "s were"} loaded from the ${scopeLabel}: ${events
          .slice(0, 3)
          .map((event) => `${contextTitle(event)} at ${formatTime(event.start)}`)
          .join("; ")}. ${caveat}`,
      );
      recordIds.push(...events.map(({ id }) => id));
      examples.push(...events.slice(0, 5).map(contextPreview));
    };
    addSpecificContextCheck(
      "illness",
      "Illness",
      "illness note record",
      (event) => event.kind === "note" && event.category === "illness",
    );
    addSpecificContextCheck(
      "stress",
      "Stress",
      "stress note record",
      (event) => event.kind === "note" && event.category === "stress",
    );
    addSpecificContextCheck(
      "hormones",
      "Hormones",
      "hormone note record",
      (event) => event.kind === "note" && event.category === "hormones",
    );
    addSpecificContextCheck(
      "medication",
      "Medication",
      "medication record",
      (event) => event.kind === "medication",
    );
    addSpecificContextCheck(
      "ketones",
      "Ketones",
      "manually recorded ketone reading",
      isManualKetoneEvent,
    );
    if (
      explicitContextChecks.size === 0 ||
      explicitContextChecks.has("context")
    ) {
      if (
        !addFinding("Other context", otherContextFinding(eventKind, timeline))
      ) {
        addEmpty("Other context", "other context records");
      }
    }
  }
  if (requested.has("data-quality")) {
    const checks = explicitDataQualityChecks.size
      ? explicitDataQualityChecks
      : new Set<TarvisExplicitDataQualityCheck>(
          TARVIS_EXPLICIT_DATA_QUALITY_CHECK_IDS,
        );
    if (checks.has("coverage")) {
      const completeness = buildDataCompletenessReport(timeline).glucose;
      summaries.push(
        `Data quality: observed glucose coverage was ${formatTarvisFixedNumber(completeness.coveragePercent, 1)}% across the ${scopeLabel}, with ${formatTarvisFixedNumber(completeness.missingMinutes, 1)} uncovered minutes and a longest uncovered interval of ${formatTarvisFixedNumber(completeness.longestGapMinutes, 1)} minutes.`,
      );
      hasContinuityLimitation ||= completeness.coveragePercent < 100;
      recordIds.push(...timeline.glucose.map(({ id }) => id));
      examples.push(...representativeGlucosePreviews(timeline.glucose));
    }
    if (checks.has("freshness")) {
      const sourceFreshness = ["current", "delayed", "stale", "missing"]
        .map((freshness) => ({
          freshness,
          count: timeline.sources.filter(
            (source) => source.freshness === freshness,
          ).length,
        }))
        .filter(({ count }) => count > 0)
        .map(({ freshness, count }) => `${wholeNumber(count)} ${freshness}`)
        .join(", ");
      summaries.push(
        timeline.sources.length
          ? `Source freshness at review time: ${sourceFreshness} across ${wholeNumber(timeline.sources.length)} reported source status${timeline.sources.length === 1 ? "" : "es"}. This does not by itself establish historical completeness inside the episode window.`
          : "Source freshness at review time: no source-status records were available, so freshness could not be confirmed.",
      );
      hasContinuityLimitation ||=
        timeline.sources.length === 0 ||
        timeline.sources.some(({ freshness }) => freshness !== "current");
      recordIds.push(...timeline.sources.map(({ id }) => id));
    }
    if (checks.has("gaps")) {
      const gaps = sensorGaps(timeline.glucose);
      const timestampCount = new Set(
        timeline.glucose.map(({ timestamp }) => timestamp),
      ).size;
      summaries.push(
        timestampCount < 2
          ? `Only ${wholeNumber(timestampCount)} glucose timestamp${timestampCount === 1 ? " was" : "s were"} loaded, so intervals between readings could not be assessed.`
          : gaps.length
            ? `${wholeNumber(gaps.length)} interval${gaps.length === 1 ? "" : "s"} between loaded glucose timestamps exceeded ${wholeNumber(12)} minutes; the longest was ${wholeNumber(Math.max(...gaps.map(({ durationMinutes }) => durationMinutes)))} minutes. Missing sensor time makes chronology incomplete, and T1 Arc does not infer a cause across it.`
            : `Across ${wholeNumber(timestampCount)} loaded glucose timestamps, no interval longer than ${wholeNumber(12)} minutes was observed. This supports only the chronology between those readings and does not prove complete sensor coverage before the first reading, after the last reading, or outside the window.`,
      );
      hasContinuityLimitation ||=
        timestampCount < 2 || gaps.length > 0;
      recordIds.push(...timeline.glucose.map(({ id }) => id));
      examples.push(...representativeGlucosePreviews(timeline.glucose));
    }
  }

  if (hasEmptyResult) {
    summaries.push(
      "An empty result is not proof that those events did not occur; they may not have been recorded or available from the connected sources.",
    );
  }
  const description = summaries.join(" ");
  const uniqueExamples = [
    ...new Map(examples.map((example) => [example.id, example])).values(),
  ].slice(0, 5);
  const evidence: EvidenceReference = {
    id: `planned-${eventKind}-explicit-requested-checks`,
    label: "The evidence checks explicitly requested by the user",
    description,
    range: timeline.range,
    recordIds: unique(recordIds),
    examples: uniqueExamples,
  };
  const caveats = ["Nearby timing is context, not proof of cause."];
  if (hasEmptyResult) {
    caveats.push(
      "An empty record search does not prove that an event did not occur.",
    );
  }
  if (requested.has("data-quality")) {
    const checks = explicitDataQualityChecks.size
      ? explicitDataQualityChecks
      : new Set<TarvisExplicitDataQualityCheck>(
          TARVIS_EXPLICIT_DATA_QUALITY_CHECK_IDS,
        );
    if (checks.has("gaps") || checks.has("coverage")) {
      caveats.push(
        "Observed readings and intervals do not prove complete historical sensor coverage.",
      );
    }
    if (checks.has("freshness")) {
      caveats.push(
        "Current source status does not prove what source freshness was throughout the historical window.",
      );
    }
  }

  return {
    id: `planned-${eventKind}-requested-evidence-availability`,
    kind:
      hasEmptyResult || hasContinuityLimitation
        ? "limitation"
        : "context-clue",
    category: "data-quality",
    title: "The evidence checks you requested",
    summary: description,
    caveat: caveats.join(" "),
    evidence: [evidence],
  };
}

function eventFindings(
  selected: SelectedEpisode,
  timeline: TimelineData,
  categories: ReadonlySet<TarvisEvidenceCategory>,
  explicitCategories: ReadonlySet<TarvisEvidenceCategory>,
  explicitContextChecks: ReadonlySet<TarvisExplicitContextCheck>,
  explicitDataQualityChecks: ReadonlySet<TarvisExplicitDataQualityCheck>,
  excludedDataQualityChecks: ReadonlySet<TarvisExplicitDataQualityCheck>,
) {
  const findings: (InsightFinding | undefined)[] = [
    eventOverviewFinding(selected, timeline),
    requestedEvidenceCheckFinding(
      selected.episode.kind,
      timeline,
      explicitCategories,
      explicitContextChecks,
      explicitDataQualityChecks,
      selected.episode,
    ),
    categories.has("food") && !explicitCategories.has("food")
      ? mealFinding(selected.episode.kind, timeline)
      : undefined,
    categories.has("insulin") && !explicitCategories.has("insulin")
      ? insulinFinding(selected.episode.kind, timeline)
      : undefined,
    categories.has("activity") && !explicitCategories.has("activity")
      ? activityFinding(selected.episode.kind, timeline)
      : undefined,
    categories.has("sleep") && !explicitCategories.has("sleep")
      ? sleepFinding(selected.episode.kind, timeline)
      : undefined,
    categories.has("context") && !explicitCategories.has("context")
      ? otherContextFinding(selected.episode.kind, timeline)
      : undefined,
    explicitCategories.has("data-quality") ||
    excludedDataQualityChecks.has("gaps")
      ? undefined
      : sensorGapFinding(
          selected.episode.kind,
          timeline,
          selected.episode,
        ),
  ];
  return findings.filter((finding): finding is InsightFinding => Boolean(finding));
}

function noEpisodeFinding(
  eventKind: "high" | "low",
  timeline: TimelineData,
  generatedAt: number,
): InsightFinding {
  const label = eventKind === "high" ? "high" : "low";
  const threshold =
    eventKind === "high" ? TARGET_HIGH_MMOL_L : TARGET_LOW_MMOL_L;
  const relation = eventKind === "high" ? "above" : "below";
  if (!timeline.glucose.length) {
    return {
      id: `planned-${eventKind}-no-readings`,
      kind: "limitation",
      category: "data-quality",
      title: `No glucose readings were available for the requested ${label}`,
      summary: `T1 Arc loaded the exact requested period but received no glucose readings, so it cannot identify or investigate a ${label} from these records. This is missing evidence, not proof that no ${label} occurred.`,
      caveat:
        "No event or cause can be inferred while the requested glucose record is unavailable.",
      evidence: [
        evidenceForSearch(
          `planned-${eventKind}-empty-search`,
          "Requested glucose period",
          timeline,
          generatedAt,
        ),
      ],
    };
  }
  return {
    id: "glucose-overview",
    kind: "limitation",
    category: "glucose",
    title: `No recorded ${label} threshold crossing in the requested period`,
    summary: `Across ${wholeNumber(timeline.glucose.length)} loaded glucose readings, none crossed ${relation} ${regionalGlucose(threshold)}, so there is no supported ${label} episode for T1 Arc to investigate in this exact period. This describes the available readings only and does not prove that no ${label} occurred during missing sensor time.`,
    caveat:
      "Missing sensor time can hide an event; T1 Arc does not invent readings or a cause.",
    evidence: [
      evidenceForSearch(
        `planned-${eventKind}-threshold-search`,
        "Glucose readings searched for the requested episode",
        timeline,
        generatedAt,
      ),
    ],
  };
}

function reportSummary(
  eventKind: "high" | "low",
  selected: SelectedEpisode | undefined,
  current: TimelineData,
) {
  const label = eventKind === "high" ? "high" : "low";
  if (!current.glucose.length) {
    return {
      headline: `No glucose data for the requested ${label}`,
      summary:
        "I checked the exact period you named, but there weren’t any glucose readings available to support an episode review.",
    };
  }
  if (!selected) {
    return {
      headline: `No recorded ${label} in the requested period`,
      summary: `I checked the exact period you named and couldn’t find a reading across the ${label} threshold in the available sensor data.`,
    };
  }
  return {
    headline:
      selected.detection === "sustained"
        ? `The ${label} on ${formatShortDate(toDateKey(selected.episode.start))}`
        : `The isolated ${label} on ${formatShortDate(toDateKey(selected.episode.start))}`,
    summary: `I found the ${label} you’re asking about and pulled together the records from the six hours before it through two hours afterwards. That lets us see what overlaps, but it still can’t prove one exact cause.`,
  };
}

/**
 * Builds the bounded evidence menu used after a validated AI evidence plan.
 * The model never chooses record IDs or expands a time range: local code loads
 * the exact planned periods, selects the event, and assembles all provenance.
 */
export async function loadPlannedGlucoseEpisodeEvidence({
  selectedEventKind,
  currentRange,
  previousRange,
  selectedCategories,
  explicitCategories = [],
  explicitContextChecks = [],
  excludedContextChecks = [],
  explicitDataQualityChecks = [],
  excludedDataQualityChecks = [],
  generatedAt,
  loadTimelineData,
}: LoadPlannedGlucoseEpisodeEvidenceOptions): Promise<TarvisEvidenceLookup> {
  assertTimeRange("currentRange", currentRange);
  assertTimeRange("previousRange", previousRange);
  if (!Number.isFinite(generatedAt) || generatedAt < 0) {
    throw new RangeError("generatedAt must be a finite timestamp.");
  }

  // Deliberately await the exact current period first. Nothing else is loaded
  // until local code has found a supported episode to centre the context on.
  const current = restrictTimelineToRange(
    await loadTimelineData({ ...currentRange }),
    currentRange,
  );
  const eligibleCurrent: TimelineData = {
    ...current,
    glucose: current.glucose.filter(({ timestamp }) => timestamp <= generatedAt),
  };
  const selected = selectEpisode(eligibleCurrent.glucose, selectedEventKind);
  const contextRange = selected
    ? incidentContextRange(selected.episode, generatedAt)
    : undefined;
  const [incident, previous] = await Promise.all([
    selected && contextRange
      ? loadTimelineData(contextRange).then((timeline) =>
          restrictTimelineToRange(timeline, contextRange),
        )
      : Promise.resolve(eligibleCurrent),
    loadTimelineData({ ...previousRange }).then((timeline) =>
      restrictTimelineToRange(timeline, previousRange),
    ),
  ]);

  const explicit = new Set(
    explicitCategories.filter((category) => ALLOWED_CATEGORIES.has(category)),
  );
  const categories = requestedCategories([
    ...selectedCategories,
    ...explicit,
  ]);
  const explicitContext = new Set(explicitContextChecks);
  const excludedContext = new Set(excludedContextChecks);
  const explicitDataQuality = new Set(explicitDataQualityChecks);
  const excludedDataQuality = new Set(excludedDataQualityChecks);
  const evidenceCurrent = withoutExcludedContextChecks(
    eligibleCurrent,
    excludedContext,
  );
  const evidenceIncident = withoutExcludedContextChecks(
    incident,
    excludedContext,
  );
  const evidencePrevious = withoutExcludedContextChecks(
    previous,
    excludedContext,
  );
  const plannedFindings = selected
    ? eventFindings(
        selected,
        evidenceIncident,
        categories,
        explicit,
        explicitContext,
        explicitDataQuality,
        excludedDataQuality,
      )
    : [noEpisodeFinding(selectedEventKind, evidenceCurrent, generatedAt),
       requestedEvidenceCheckFinding(
         selectedEventKind,
         evidenceCurrent,
         explicit,
         explicitContext,
         explicitDataQuality,
       ),
       explicit.has("data-quality") || excludedDataQuality.has("gaps")
          ? undefined
          : sensorGapFinding(selectedEventKind, evidenceCurrent)].filter(
         (finding): finding is InsightFinding => Boolean(finding),
       );
  const summary = reportSummary(selectedEventKind, selected, evidenceCurrent);
  const baseReport = buildInsightReport(
    evidenceCurrent,
    evidencePrevious,
    generatedAt,
  );
  const plannedIds = new Set(plannedFindings.map(({ id }) => id));
  const report = {
    ...baseReport,
    ...summary,
    findings: [
      ...plannedFindings,
      ...baseReport.findings.filter(
        (finding) => {
          const category = plannerCategoryForInsightCategory(
            finding.category,
          );
          return (
            categories.has(category) &&
            !explicit.has(category) &&
            !(
              finding.id === "glucose-data-completeness" &&
              (excludedDataQuality.has("coverage") ||
                excludedDataQuality.has("gaps"))
            ) &&
            !plannedIds.has(finding.id)
          );
        },
      ),
    ],
  };
  const includeGlucoseCoverageContext =
    !excludedDataQuality.has("coverage") &&
    (!explicit.has("data-quality") ||
      explicitDataQuality.size === 0 ||
      explicitDataQuality.has("coverage"));
  const lookup = buildTarvisEvidencePacket(report, {
    includeGlucoseCoverageContext,
  });
  const requestedCheck = plannedFindings.find(({ id }) =>
    id.endsWith("requested-evidence-availability"),
  );
  if (requestedCheck) {
    lookup.packet.requiredFindingIds = [requestedCheck.id];
  }
  lookup.packet.comparison.current = redactUnselectedSummaryCategories(
    lookup.packet.comparison.current,
    categories,
  );
  lookup.packet.comparison.previous = redactUnselectedSummaryCategories(
    lookup.packet.comparison.previous,
    categories,
  );

  // The generic packet builder gives manually logged ketones priority. For an
  // incident packet the event-specific menu must remain first, while ketones
  // still remain available in their selected context category.
  const plannedOrder = new Map(
    plannedFindings.map((finding, index) => [finding.id, index]),
  );
  lookup.packet.findings.sort((left, right) => {
    const leftOrder = plannedOrder.get(left.id);
    const rightOrder = plannedOrder.get(right.id);
    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return 0;
  });
  return lookup;
}
