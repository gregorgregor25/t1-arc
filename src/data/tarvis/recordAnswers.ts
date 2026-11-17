import { DEVICE_AGE_MAXIMUM_DAYS, latestDeviceChanges } from "@/domain/deviceAge";
import type { EvidenceReference } from "@/domain/insights";
import type {
  ContextNoteEvent,
  HealthContextEvent,
  TimeRange,
  TimelineData,
} from "@/domain/models";
import { recordSourceLabel } from "@/domain/recordSourceLabels";
import { FUTURE_CLOCK_SKEW_TOLERANCE_MS, formatTime, relativeAge } from "@/domain/time";

import type { CurrentIobEstimate } from "./currentIobLoader";

import { formatTarvisNumber } from "./regionalNumberPresentation";
import type { DeviceChangeQuestion, RecordedChangeKind, RecordQuestion } from "./recordQuestions";
import { formatTarvisLocalDateTime } from "./timePresentation";
import type { TarvisAnswer } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface RecordAnswerResult {
  answer: TarvisAnswer;
  evidence: EvidenceReference[];
}

const CHANGE_LABELS: Record<RecordedChangeKind, { title: string; noun: string }> = {
  site: { title: "Site change", noun: "site change" },
  sensor: { title: "Sensor change", noun: "sensor change" },
  insulin: { title: "Cartridge or reservoir change", noun: "cartridge or reservoir change" },
};

/** The period read for device-change questions: the last 30 days. */
export function recordQuestionRange(question: RecordQuestion, asOf: number): TimeRange {
  void question;
  return { start: asOf - DEVICE_AGE_MAXIMUM_DAYS * DAY_MS, end: asOf };
}

/**
 * "Insulin Change" is not a device-age kind on Today, so it is matched here
 * with the same imported-title rule: an imported pump note titled
 * "Insulin Change".
 */
function isInsulinChange(event: HealthContextEvent): event is ContextNoteEvent {
  return (
    event.kind === "note" &&
    event.origin === "imported" &&
    event.category === "pump" &&
    event.title.trim().replace(/\s+/g, " ").toLowerCase() === "insulin change"
  );
}

function latestInsulinChange(events: readonly HealthContextEvent[], asOf: number) {
  let latest: ContextNoteEvent | undefined;
  for (const event of events) {
    if (!isInsulinChange(event) || event.start > asOf) continue;
    if (!latest || event.start > latest.start || (event.start === latest.start && event.id > latest.id)) {
      latest = event;
    }
  }
  return latest;
}

/** Elapsed time in days and hours, not calendar days. */
function elapsedAge(ms: number) {
  const totalHours = Math.max(0, Math.floor(ms / HOUR_MS));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const number = (value: number) => formatTarvisNumber(value, { maximumFractionDigits: 0 });
  const dayText = days ? `${number(days)} day${days === 1 ? "" : "s"}` : "";
  const hourText = `${number(hours)} hour${hours === 1 ? "" : "s"}`;
  if (!days) return totalHours ? hourText : "under 1 hour";
  return hours ? `${dayText} ${hourText}` : dayText;
}

function sourceText(event: ContextNoteEvent) {
  return event.origin === "manual"
    ? "recorded by you in T1 Arc"
    : `from ${event.sourceLabel ?? recordSourceLabel(event.sourceId)}`;
}

/**
 * Builds the answer for "When did I last change my site?" and similar, from
 * the context events stored for the last 30 days. Each line names the record,
 * its time, where it came from and how long ago it was.
 */
export function buildDeviceChangeAnswer({
  question,
  timeline,
  asOf,
}: {
  question: DeviceChangeQuestion;
  timeline: Pick<TimelineData, "context" | "range">;
  asOf: number;
}): RecordAnswerResult {
  const oldest = asOf - DEVICE_AGE_MAXIMUM_DAYS * DAY_MS;
  const recent = timeline.context.filter((event) => event.start >= oldest);
  const devices = latestDeviceChanges(recent, asOf);
  const found: { kind: RecordedChangeKind; event: ContextNoteEvent }[] = [];
  const lines = question.changes.map((kind) => {
    const event = kind === "insulin" ? latestInsulinChange(recent, asOf) : devices[kind];
    const label = CHANGE_LABELS[kind];
    if (!event) {
      return `${label.title}: no ${label.noun} record is stored for the last ${formatTarvisNumber(DEVICE_AGE_MAXIMUM_DAYS, { maximumFractionDigits: 0 })} days.`;
    }
    found.push({ kind, event });
    return `${label.title}: last recorded ${formatTarvisLocalDateTime(event.start)}, ${sourceText(event)}. That was ${elapsedAge(asOf - event.start)} ago.`;
  });
  const headline =
    question.changes.length === 1
      ? `Last ${CHANGE_LABELS[question.changes[0]!].noun}`
      : "Last recorded changes";
  const evidence: EvidenceReference[] = found.length
    ? [
        {
          id: "recorded-device-changes",
          label: "Recorded change notes",
          description: `The newest stored record of each change asked about, from the last ${formatTarvisNumber(DEVICE_AGE_MAXIMUM_DAYS, { maximumFractionDigits: 0 })} days.`,
          range: { start: oldest, end: asOf },
          recordIds: found.map(({ event }) => event.id),
          examples: found.map(({ kind, event }) => ({
            id: event.id,
            kind: "context",
            timestamp: event.start,
            primary: CHANGE_LABELS[kind].title,
            secondary: event.sourceLabel ?? recordSourceLabel(event.sourceId),
            sourceId: event.sourceId,
          })),
        },
      ]
    : [];
  return {
    answer: {
      headline,
      answer: lines.join("\n"),
      confidence: found.length === question.changes.length ? "moderate" : "limited",
      evidenceIds: evidence.map(({ id }) => id),
      limitations: [
        "Only explicit change records count: a site, sensor or insulin change note from AAPS or Nightscout, or one you entered in T1 Arc. Nothing is inferred from glucose gaps.",
      ],
    },
    evidence,
  };
}

/** Matches the Today card: older estimates are flagged as possibly out of date. */
export const CURRENT_IOB_FRESH_MS = 12 * 60 * 1000;

const IOB_COPY = {
  aaps: {
    reporter: "AAPS",
    via: "",
    provenance: "This is AAPS's own estimate, received on this phone. T1 Arc did not calculate it.",
    clockAhead: "The estimate receipt time is ahead of this phone’s clock, so its age can't be checked.",
  },
  nightscout: {
    reporter: "Your looping system",
    via: " through Nightscout",
    provenance: "This is your looping system's own estimate, read from Nightscout. T1 Arc did not calculate it.",
    clockAhead: "The estimate time is ahead of this phone’s clock, so its age can't be checked.",
  },
} as const;

const NO_IOB_ESTIMATE =
  "No insulin-on-board estimate is available. T1 Arc shows the estimate AAPS or Nightscout reports and does not calculate its own.";

function units(value: number) {
  return `${formatTarvisNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} U`;
}

/**
 * Builds the answer for "What is my IOB now?" from the estimate AAPS or
 * Nightscout last reported. It reports the value, who calculated it and how
 * old it is, and nothing else.
 */
export function buildCurrentIobAnswer({
  estimate,
  liveData,
  asOf,
}: {
  estimate: CurrentIobEstimate | undefined;
  /** False for sample data and saved reports, which have no current estimate. */
  liveData: boolean;
  asOf: number;
}): RecordAnswerResult {
  const limitations = [
    "Insulin on board is an estimate made by AAPS or your looping system, not a record of delivered insulin.",
  ];
  if (!liveData || !estimate) {
    return {
      answer: {
        headline: "Insulin on board",
        answer: liveData
          ? NO_IOB_ESTIMATE
          : "A current insulin-on-board estimate is only shown for live data from AAPS or Nightscout. T1 Arc does not calculate its own.",
        confidence: "limited",
        evidenceIds: [],
        limitations,
      },
      evidence: [],
    };
  }
  const copy = IOB_COPY[estimate.provenance];
  const clockAhead = estimate.receivedAt - asOf > FUTURE_CLOCK_SKEW_TOLERANCE_MS;
  const fresh = !clockAhead && asOf - estimate.receivedAt <= CURRENT_IOB_FRESH_MS;
  const parts = [
    estimate.bolusIobUnits !== undefined ? `Bolus part: ${units(estimate.bolusIobUnits)}.` : "",
    estimate.basalIobUnits !== undefined ? `Basal part: ${units(estimate.basalIobUnits)}.` : "",
  ].filter(Boolean);
  const when = fresh
    ? `at ${formatTime(estimate.receivedAt)} (${relativeAge(estimate.receivedAt, asOf)})`
    : `at ${formatTarvisLocalDateTime(estimate.receivedAt)}${clockAhead ? "" : ` (${relativeAge(estimate.receivedAt, asOf)})`}`;
  const reported = `${copy.reporter} reported ${units(estimate.iobUnits)} of insulin on board${copy.via} ${when}.`;
  const sentences = [
    fresh || clockAhead ? "" : "The latest insulin-on-board estimate is not current.",
    reported,
    ...parts,
    estimate.iobUnits < 0 ? "A value below zero can happen in this estimate." : "",
    clockAhead ? copy.clockAhead : "",
    copy.provenance,
  ].filter(Boolean);
  return {
    answer: {
      headline: "Insulin on board",
      answer: sentences.join(" "),
      confidence: fresh ? "moderate" : "limited",
      evidenceIds: [],
      limitations,
    },
    evidence: [],
  };
}
