import type { DataSourceStatus, TimeRange } from './models';
import { recordSourceLabel } from './recordSourceLabels';
import { describeTimeZone, formatClock, formatClockNear, type ClockSettings } from './exportTime';
import { formatRegionalNumber } from './regionalFormat';

export const SOURCE_HEALTH_WINDOW_MS = 24 * 60 * 60_000;
/** A pause in glucose records at least this long is listed as a gap. */
export const NOTABLE_GLUCOSE_GAP_MS = 30 * 60_000;
export const MAX_LISTED_GAPS = 6;

export type SourceHealthKind = 'glucose' | 'insulin' | 'context';

export interface SourceHealthRecord {
  timestamp: number;
  sourceId: string;
}

/** One configured source as read from stored sync metadata and records. */
export interface SourceHealthSourceInput {
  kind: SourceHealthKind;
  status: DataSourceStatus;
  /** Records for this source inside the 24-hour window. */
  recentRecords: readonly SourceHealthRecord[];
  /** Earliest stored record for this source, if known. */
  earliestRecordAt?: number;
}

/** Same glucose timestamp stored by two sources; one is shown. */
export interface SourceDuplicateSummary {
  keptSourceId: string;
  otherSourceId: string;
  count: number;
}

export interface SourceHealthSnapshot {
  generatedAt: number;
  window: TimeRange;
  sources: SourceHealthSourceInput[];
  duplicates: SourceDuplicateSummary[];
}

export interface SourceHealthGap {
  start: number;
  end: number;
}

export type SourceAttemptOutcome = 'worked' | 'failed' | 'unfinished' | 'none';

export interface SourceHealthRow {
  id: string;
  kind: SourceHealthKind;
  label: string;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  attemptOutcome: SourceAttemptOutcome;
  newestRecordAt?: number;
  recordsLast24h: number;
  gaps: SourceHealthGap[];
  /** Plain lines in display order. */
  lines: string[];
}

export interface SourceHealthReport {
  rows: SourceHealthRow[];
  timeZoneLine: string;
  duplicateLines: string[];
}

/** Unconfigured optional sources are not shown; matches the connection summary rule. */
export function isConfiguredSource(status: DataSourceStatus) {
  if (status.origin === 'synthetic') return false;
  return Boolean(
    status.errorCode ||
      status.isLive ||
      status.dataThrough !== undefined ||
      status.lastUpdatedAt !== undefined ||
      status.lastAttemptAt !== undefined ||
      (status.recordCount ?? 0) > 0,
  );
}

const ERROR_WORDS: Readonly<Record<string, string>> = {
  network: 'could not connect. Check the phone’s internet connection.',
  authentication: 'the sign-in was not accepted.',
  'invalid-credentials': 'the sign-in was not accepted.',
  'rate-limited': 'the service asked T1 Arc to wait before checking again.',
  'action-required': 'the account needs attention in the provider’s own app.',
  'patient-selection-required': 'choose which person to follow in the provider’s own app.',
  'invalid-connection': 'the saved connection details need checking.',
  'invalid-response': 'the service replied with something T1 Arc could not read.',
  'unsupported-api': 'the service has changed in a way T1 Arc does not support yet.',
  'no-patient': 'no shared person was found on this account.',
  'sensor-state': 'the sensor is not sending readings at the moment.',
  'unbound-existing-data': 'waiting for you to confirm which account the saved records belong to.',
};

export function attemptFailureWords(errorCode: string): string {
  return ERROR_WORDS[errorCode] ?? 'the check did not complete.';
}

export function attemptOutcome(status: DataSourceStatus): SourceAttemptOutcome {
  if (status.errorCode) return 'failed';
  if (status.lastAttemptAt === undefined) {
    return status.lastUpdatedAt === undefined ? 'none' : 'worked';
  }
  if (status.lastUpdatedAt !== undefined && status.lastUpdatedAt >= status.lastAttemptAt) return 'worked';
  return 'unfinished';
}

/**
 * Pauses between records of at least `minimumGapMs` inside the window. A
 * pause at the start of the window counts only when the source has older
 * records, so a newly connected source is not reported as a gap.
 */
export function findRecordGaps(
  timestamps: readonly number[],
  window: TimeRange,
  minimumGapMs: number,
  earliestRecordAt?: number,
): SourceHealthGap[] {
  const sorted = [...new Set(timestamps)]
    .filter((value) => Number.isFinite(value) && value >= window.start && value < window.end)
    .sort((left, right) => left - right);
  const gaps: SourceHealthGap[] = [];
  const first = sorted[0];
  if (
    first !== undefined &&
    earliestRecordAt !== undefined &&
    earliestRecordAt < window.start &&
    first - window.start >= minimumGapMs
  ) {
    gaps.push({ start: window.start, end: first });
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (current - previous >= minimumGapMs) gaps.push({ start: previous, end: current });
  }
  return gaps;
}

/**
 * Exact-timestamp glucose duplicates across sources. The kept source is the
 * one with the lower rank, matching how the glucose display chooses one
 * reading per timestamp.
 */
export function summarizeExactDuplicates(
  records: readonly SourceHealthRecord[],
  rank: (sourceId: string) => number,
): SourceDuplicateSummary[] {
  const byTimestamp = new Map<number, Set<string>>();
  records.forEach((record) => {
    const sources = byTimestamp.get(record.timestamp) ?? new Set<string>();
    sources.add(record.sourceId);
    byTimestamp.set(record.timestamp, sources);
  });
  const counts = new Map<string, SourceDuplicateSummary>();
  byTimestamp.forEach((sources) => {
    if (sources.size < 2) return;
    const ordered = [...sources].sort(
      (left, right) => rank(left) - rank(right) || (left < right ? -1 : left > right ? 1 : 0),
    );
    const kept = ordered[0]!;
    ordered.slice(1).forEach((other) => {
      const key = `${kept}\u0000${other}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { keptSourceId: kept, otherSourceId: other, count: 1 });
    });
  });
  return [...counts.values()].sort((left, right) => right.count - left.count);
}

export interface SourceHealthFormatSettings extends ClockSettings {
  /** Label for kept/other sources; defaults to the shared record-source names. */
  sourceLabel?: (sourceId: string) => string;
}

const KIND_NOUN: Record<SourceHealthKind, string> = {
  glucose: 'glucose',
  insulin: 'insulin',
  context: 'records',
};

function count(value: number, locale: string) {
  return formatRegionalNumber(value, locale, { maximumFractionDigits: 0 });
}

function describeRow(
  input: SourceHealthSourceInput,
  window: TimeRange,
  now: number,
  settings: SourceHealthFormatSettings,
): SourceHealthRow {
  const { status } = input;
  const times = input.recentRecords.map((record) => record.timestamp);
  const recordsLast24h = new Set(times).size;
  const newestRecordAt = status.dataThrough ?? (times.length ? Math.max(...times) : undefined);
  const outcome = attemptOutcome(status);
  const gaps = input.kind === 'glucose'
    ? findRecordGaps(times, window, NOTABLE_GLUCOSE_GAP_MS, input.earliestRecordAt)
    : [];
  const at = (timestamp: number) => formatClockNear(timestamp, now, settings);
  const lines: string[] = [];
  lines.push(
    status.lastUpdatedAt === undefined
      ? 'No successful update recorded yet.'
      : `Last successful update: ${at(status.lastUpdatedAt)}.`,
  );
  if (outcome === 'failed' && status.errorCode) {
    lines.push(
      `Last check${status.lastAttemptAt === undefined ? '' : ` at ${at(status.lastAttemptAt)}`}: ${attemptFailureWords(status.errorCode)}`,
    );
  } else if (outcome === 'unfinished' && status.lastAttemptAt !== undefined) {
    lines.push(`Last check at ${at(status.lastAttemptAt)} has not finished or did not save a result.`);
  } else if (outcome === 'worked' && status.lastAttemptAt !== undefined) {
    lines.push(`Last check at ${at(status.lastAttemptAt)} worked.`);
  }
  lines.push(
    newestRecordAt === undefined
      ? 'No records have arrived yet.'
      : `Records through ${at(newestRecordAt)}.`,
  );
  lines.push(
    recordsLast24h === 0
      ? 'No records received in the last 24 hours.'
      : `${count(recordsLast24h, settings.locale)} ${recordsLast24h === 1 ? 'record' : 'records'} in the last 24 hours.`,
  );
  if (input.kind !== 'glucose') {
    const contributors = [...new Set(input.recentRecords.map((record) => record.sourceId))]
      .map((sourceId) => (settings.sourceLabel ?? recordSourceLabel)(sourceId))
      .filter((label, index, all) => all.indexOf(label) === index);
    if (contributors.length) lines.push(`From: ${contributors.join(', ')}.`);
  }
  const noun = KIND_NOUN[input.kind];
  gaps.slice(0, MAX_LISTED_GAPS).forEach((gap) => {
    lines.push(`No ${noun} ${formatClock(gap.start, settings)}–${formatClock(gap.end, settings)}.`);
  });
  if (gaps.length > MAX_LISTED_GAPS) {
    const more = gaps.length - MAX_LISTED_GAPS;
    lines.push(`${count(more, settings.locale)} more ${more === 1 ? 'gap' : 'gaps'} in the last 24 hours.`);
  }
  return {
    id: status.id,
    kind: input.kind,
    label: status.label,
    ...(status.lastUpdatedAt === undefined ? {} : { lastSuccessAt: status.lastUpdatedAt }),
    ...(status.lastAttemptAt === undefined ? {} : { lastAttemptAt: status.lastAttemptAt }),
    attemptOutcome: outcome,
    ...(newestRecordAt === undefined ? {} : { newestRecordAt }),
    recordsLast24h,
    gaps,
    lines,
  };
}

/** Plain-language health of each configured source over the last 24 hours. */
export function buildSourceHealthReport(
  snapshot: SourceHealthSnapshot,
  settings: SourceHealthFormatSettings,
): SourceHealthReport {
  const label = settings.sourceLabel ?? recordSourceLabel;
  const seen = new Set<string>();
  const rows = snapshot.sources
    .filter((source) => isConfiguredSource(source.status))
    .filter((source) => {
      if (seen.has(source.status.id)) return false;
      seen.add(source.status.id);
      return true;
    })
    .map((source) => describeRow(source, snapshot.window, snapshot.generatedAt, settings));
  return {
    rows,
    timeZoneLine: `Times are shown in ${describeTimeZone(settings.timeZone, settings.locale, snapshot.generatedAt)}, from this phone’s settings.`,
    duplicateLines: snapshot.duplicates.map((duplicate) =>
      `Same glucose ${duplicate.count === 1 ? 'reading' : 'readings'} also from ${label(duplicate.otherSourceId)} (${count(duplicate.count, settings.locale)} in the last 24 hours); kept ${label(duplicate.keptSourceId)}.`,
    ),
  };
}
