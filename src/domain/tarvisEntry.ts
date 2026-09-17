import type { HealthContextEvent, TimelineData, TimeRange } from './models';
import { addDays, dayRange, getZonedDateTimeParts, toDateKey } from './time';
import { getRuntimeRegionalDefaults } from './regionalProfileRuntime';
import { isIanaTimeZone } from './regionalProfile';
import { getCachedDateTimeFormat } from './intlFormatterCache';

export interface TarvisEntry {
  requestId: string;
  question: string;
  label: string;
  range: TimeRange;
  eventId?: string;
  sourceId?: string;
  eventKind?: HealthContextEvent['kind'];
  healthMetric?: TarvisHealthMetric;
  timeZone: string;
  ownerIdentity?: string;
  kind: 'period' | 'event' | 'health';
}

export const HEALTH_METRIC_LABELS = {
  sleep: 'sleep', nutrition: 'nutrition', weight: 'weight', 'blood-pressure': 'blood pressure',
  'heart-rate': 'heart rate', steps: 'steps', hydration: 'hydration', distance: 'distance and climbing',
  energy: 'activity energy', workouts: 'workouts', 'body-composition': 'body composition',
  'health-glucose': 'Health Connect glucose', oxygen: 'blood oxygen', 'respiratory-rate': 'respiratory rate',
  hrv: 'heart-rate variability (HRV)', 'vo2-max': 'VO2 max', temperature: 'body temperature',
  'cycle-context': 'cycle context', health: 'health records',
} as const;
export type TarvisHealthMetric = keyof typeof HEALTH_METRIC_LABELS;

const EVENT_KINDS = ['meal', 'activity', 'sleep', 'weight', 'medication', 'note'];
const validTimestamp = (value: unknown): value is number => typeof value === 'number' &&
  Number.isSafeInteger(value) && value > 0 && value < 8_640_000_000_000_000;
const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);

function validTimeZone(value: unknown): value is string {
  return boundedText(value, 100) && isIanaTimeZone(value);
}

export function isTarvisEntry(value: unknown): value is TarvisEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as TarvisEntry;
  return boundedText(entry.requestId, 160) && boundedText(entry.question, 1500) &&
    boundedText(entry.label, 1000) && ['period', 'event', 'health'].includes(entry.kind) &&
    !!entry.range && validTimestamp(entry.range.start) && validTimestamp(entry.range.end) &&
    entry.range.end > entry.range.start && entry.range.end - entry.range.start <= 366 * 86_400_000 &&
    validTimeZone(entry.timeZone) &&
    (entry.ownerIdentity === undefined || boundedText(entry.ownerIdentity, 4096)) &&
    (entry.sourceId === undefined || boundedText(entry.sourceId, 256)) &&
    (entry.eventId === undefined || boundedText(entry.eventId, 2048)) &&
    (entry.kind !== 'health' || (typeof entry.healthMetric === 'string' && Object.hasOwn(HEALTH_METRIC_LABELS, entry.healthMetric))) &&
    (entry.kind !== 'event' || (boundedText(entry.eventId, 2048) && boundedText(entry.sourceId, 256) &&
      EVENT_KINDS.includes(entry.eventKind ?? '')));
}

function dateAndTime(timestamp: number, timeZone: string) {
  if (!validTimestamp(timestamp) || !validTimeZone(timeZone)) throw new Error('This date is not available to inspect.');
  const date = getCachedDateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(timestamp);
  const parts = getZonedDateTimeParts(timestamp, timeZone);
  return { date, clock: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}` };
}

function defaultEventQuestion(entry: Pick<TarvisEntry, 'eventKind' | 'range' | 'timeZone'>) {
  const start = dateAndTime(entry.range.start, entry.timeZone);
  const kind = entry.eventKind === 'activity' ? 'workout' : entry.eventKind === 'note' ? 'recorded event' : entry.eventKind;
  return `What do my records show around my ${kind} at ${start.clock} on ${start.date}?`;
}

function defaultPeriodQuestion(entry: Pick<TarvisEntry, 'range' | 'timeZone'>) {
  const start = dateAndTime(entry.range.start, entry.timeZone);
  const end = dateAndTime(entry.range.end, entry.timeZone);
  return `What was my average glucose from ${start.clock} on ${start.date} to ${end.clock} on ${end.date}?`;
}

function defaultHealthQuestion(entry: Pick<TarvisEntry, 'range' | 'timeZone' | 'healthMetric'>) {
  if (!entry.healthMetric || !Object.hasOwn(HEALTH_METRIC_LABELS, entry.healthMetric)) return undefined;
  const start = dateAndTime(entry.range.start, entry.timeZone);
  const end = dateAndTime(entry.range.end, entry.timeZone);
  return `How does my ${HEALTH_METRIC_LABELS[entry.healthMetric]} relate to my glucose between ${start.clock} on ${start.date} and ${end.clock} on ${end.date}?`;
}

export function isDefaultHealthContextQuestion(entry: unknown, prompt: string, ownerIdentity: string): entry is TarvisEntry & { kind: 'health'; healthMetric: TarvisHealthMetric } {
  if (!isTarvisEntry(entry) || entry.kind !== 'health' || entry.ownerIdentity !== ownerIdentity || !boundedText(ownerIdentity, 4096)) return false;
  const expected = defaultHealthQuestion(entry);
  return expected !== undefined && entry.question === expected && prompt === expected;
}

/** Route text is not authority to bypass the normal safety and free-form question pipeline. */
export function isDefaultContextQuestion(entry: unknown, prompt: string, ownerIdentity: string): entry is TarvisEntry {
  if (!isTarvisEntry(entry) || entry.ownerIdentity !== ownerIdentity || !boundedText(ownerIdentity, 4096)) return false;
  const expected = entry.kind === 'period' ? defaultPeriodQuestion(entry) : entry.kind === 'event' ? defaultEventQuestion(entry) : undefined;
  return expected !== undefined && entry.question === expected && prompt === expected;
}

export function bindTarvisEntryToOwner(entry: TarvisEntry, ownerIdentity: string): TarvisEntry {
  const bound = { ...entry, range: { ...entry.range }, ownerIdentity };
  if (!isTarvisEntry(bound) || !boundedText(ownerIdentity, 4096)) throw new Error('The selected records are no longer available.');
  return bound;
}

export function createTarvisPeriodEntry(range: TimeRange, label = 'Selected period'): TarvisEntry {
  const { timeZone } = getRuntimeRegionalDefaults();
  const start = dateAndTime(range.start, timeZone);
  const end = dateAndTime(range.end, timeZone);
  const entry: TarvisEntry = {
    requestId: `period:${range.start}:${range.end}:${Date.now()}`,
    question: defaultPeriodQuestion({ range, timeZone }),
    label: `${label} · ${start.date}, ${start.clock} to ${start.date === end.date ? '' : `${end.date}, `}${end.clock} (${timeZone})`,
    range: { ...range }, kind: 'period', timeZone,
  };
  if (!isTarvisEntry(entry)) throw new Error('This period is not available to inspect.');
  return entry;
}

export function createTarvisEventEntry(event: HealthContextEvent): TarvisEntry {
  const { timeZone } = getRuntimeRegionalDefaults();
  const start = dateAndTime(event.start, timeZone);
  const end = event.end ?? (event.kind === 'activity' ? event.start + event.durationMinutes * 60_000 : event.start + 1);
  const range = { start: event.start, end: Math.max(event.start + 1, end) };
  const entry: TarvisEntry = {
    requestId: `event:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    question: defaultEventQuestion({ eventKind: event.kind, range, timeZone }),
    label: `${event.title} · ${start.date}, ${start.clock} (${timeZone})`,
    range, eventId: event.id, sourceId: event.sourceId, eventKind: event.kind,
    kind: 'event', timeZone,
  };
  if (!isTarvisEntry(entry)) throw new Error('This event is not available to inspect.');
  return entry;
}

/** Health relationships use bounded report evidence, never the average-glucose shortcut. */
export function createTarvisHealthEntry(range: TimeRange, metricLabel: string): TarvisEntry {
  if (!boundedText(metricLabel, 80)) throw new Error('This health metric is not available to inspect.');
  const entry = createTarvisPeriodEntry(range, metricLabel);
  const normalized = metricLabel.toLowerCase().replace('₂', '2');
  const healthMetric = normalized === 'heart-rate variability' ? 'hrv'
    : (Object.entries(HEALTH_METRIC_LABELS).find(([, label]) => label.toLowerCase() === normalized)?.[0] ?? 'health') as TarvisHealthMetric;
  return { ...entry, kind: 'health', healthMetric, question: defaultHealthQuestion({ ...entry, healthMetric })! };
}

export interface TarvisSuggestion { icon: 'pulse-outline' | 'walk-outline' | 'moon-outline' | 'restaurant-outline' | 'help-circle-outline'; question: string }
export function buildTarvisSuggestions(timeline: TimelineData | undefined, asOf: number): TarvisSuggestion[] {
  const suggestions: TarvisSuggestion[] = [];
  if (!validTimestamp(asOf)) return [{ icon: 'help-circle-outline', question: 'What does time in range mean?' }];
  const yesterday = dayRange(addDays(toDateKey(asOf), -1), asOf);
  const readings = (timeline?.glucose ?? []).filter(reading => validTimestamp(reading.timestamp) &&
    reading.timestamp <= asOf && Number.isFinite(reading.mmolL) && reading.mmolL > 0 &&
    reading.timestamp >= timeline!.range.start && reading.timestamp < timeline!.range.end);
  if (readings.some(reading => reading.timestamp >= yesterday.start && reading.timestamp < yesterday.end)) {
    suggestions.push({ icon: 'pulse-outline', question: 'What was my average glucose yesterday?' });
  }
  const events = (timeline?.context ?? []).filter(event => validTimestamp(event.start) && event.start <= asOf &&
    event.start < timeline!.range.end && (event.end ?? event.start) >= timeline!.range.start)
    .slice().sort((a, b) => b.start - a.start);
  const workout = events.find(event => event.kind === 'activity' && (event.end ?? event.start) <= asOf);
  if (workout && readings.some(reading => reading.timestamp >= workout.start - 4 * 3_600_000 &&
    reading.timestamp < (workout.end ?? workout.start) + 2 * 3_600_000)) {
    try { suggestions.push({ icon: 'walk-outline', question: createTarvisEventEntry(workout).question }); }
    catch { /* An unusable imported event must not prevent the composer from opening. */ }
  }
  // Ask about yesterday only when a recorded sleep ended on that local date.
  if (events.some(event => event.kind === 'sleep' && event.end !== undefined &&
    event.end >= yesterday.start && event.end < yesterday.end && event.end <= asOf)) {
    suggestions.push({ icon: 'moon-outline', question: 'How much sleep is recorded for yesterday?' });
  }
  if (events.some(event => event.kind === 'meal' && event.start >= yesterday.start && event.start < yesterday.end &&
    event.carbsGrams !== undefined && Number.isFinite(event.carbsGrams))) {
    suggestions.push({ icon: 'restaurant-outline', question: 'How many carbs did I log yesterday?' });
  }
  if (!suggestions.length && readings.length) {
    const latest = readings.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
    suggestions.push({ icon: 'pulse-outline', question: `What was my average glucose on ${toDateKey(latest.timestamp)}?` });
  }
  if (suggestions.length < 3) suggestions.push({ icon: 'help-circle-outline', question: 'What does time in range mean?' });
  return suggestions.slice(0, 3);
}
