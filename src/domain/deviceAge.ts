import { formatClock, formatDay } from './exportTime';
import type { ContextNoteEvent, HealthContextEvent } from './models';
import { recordSourceLabel } from './recordSourceLabels';
import { formatRegionalNumber } from './regionalFormat';

export const EXPECTED_SENSOR_LIFE_OPTIONS = [10, 14, 15] as const;
export type ExpectedSensorLifeDays = (typeof EXPECTED_SENSOR_LIFE_OPTIONS)[number];

export function isExpectedSensorLifeDays(value: unknown): value is ExpectedSensorLifeDays {
  return EXPECTED_SENSOR_LIFE_OPTIONS.includes(value as ExpectedSensorLifeDays);
}

export type DeviceChangeKind = 'sensor' | 'site';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Older changes are treated as missing rather than shown as a stale age. */
export const DEVICE_AGE_MAXIMUM_DAYS = 30;

const IMPORTED_TITLES: Record<string, DeviceChangeKind> = {
  'site change': 'site',
  'sensor change': 'sensor',
  'sensor start': 'sensor',
};

/**
 * Which change a record describes, if any. Only explicit records count: a
 * manual sensor start, a manual site-change placement, or an imported
 * AAPS/Nightscout "Site Change", "Sensor Change" or "Sensor Start" event.
 * Nothing is inferred from glucose gaps or free-text notes.
 */
export function deviceChangeKind(event: HealthContextEvent): DeviceChangeKind | undefined {
  if (event.kind !== 'note') return undefined;
  if (event.origin === 'manual') {
    if (event.observation?.kind === 'site-change') return event.observation.device === 'pump' ? 'site' : 'sensor';
    if (event.category === 'sensor' && event.sensorStarted === true) return 'sensor';
    return undefined;
  }
  if (event.origin !== 'imported') return undefined;
  const kind = IMPORTED_TITLES[event.title.trim().replace(/\s+/g, ' ').toLowerCase()];
  if (kind === 'site' && event.category !== 'pump') return undefined;
  if (kind === 'sensor' && event.category !== 'sensor') return undefined;
  return kind;
}

/** The most recent change of each kind that has already happened. */
export function latestDeviceChanges(
  events: readonly HealthContextEvent[],
  now: number,
): Partial<Record<DeviceChangeKind, ContextNoteEvent>> {
  const latest: Partial<Record<DeviceChangeKind, ContextNoteEvent>> = {};
  events.forEach((event) => {
    const kind = deviceChangeKind(event);
    if (!kind || event.kind !== 'note' || event.start > now) return;
    const current = latest[kind];
    if (!current || event.start > current.start || (event.start === current.start && event.id > current.id)) {
      latest[kind] = event;
    }
  });
  return latest;
}

export interface DeviceAgeChip {
  kind: DeviceChangeKind;
  label: string;
  accessibilityLabel: string;
  startedAt: number;
  /** Plain description of the record the age was calculated from. */
  source: string;
  event: ContextNoteEvent;
}

type Settings = { locale: string; timeZone: string };

function count(value: number, settings: Settings) {
  return formatRegionalNumber(value, settings.locale, { maximumFractionDigits: 0 });
}

function sourceText(event: ContextNoteEvent, settings: Settings) {
  const when = `${formatDay(event.start, settings)}, ${formatClock(event.start, settings)}`;
  if (event.origin === 'manual') {
    const what = event.observation?.kind === 'site-change' ? `${event.observation.device === 'pump' ? 'Pump site' : 'Sensor'} placement` : 'Sensor change';
    return `${what} recorded by you in T1 Arc for ${when}.`;
  }
  const from = event.sourceLabel ?? recordSourceLabel(event.sourceId);
  return `“${event.title}” imported from ${from} for ${when}.`;
}

/**
 * Elapsed-time ages, so a clock change or time-zone change never adds or
 * removes a day. Sensor day 1 is the first 24 hours after the change.
 */
export function deviceAgeChip(
  kind: DeviceChangeKind,
  event: ContextNoteEvent,
  now: number,
  settings: Settings,
  expectedSensorLife?: ExpectedSensorLifeDays | null,
): DeviceAgeChip | undefined {
  const elapsed = now - event.start;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= DEVICE_AGE_MAXIMUM_DAYS * DAY) return undefined;
  const source = sourceText(event, settings);
  if (kind === 'sensor') {
    const day = Math.floor(elapsed / DAY) + 1;
    const life = expectedSensorLife ?? null;
    const label = life === null
      ? `Sensor day ${count(day, settings)}`
      : day <= life
        ? `Sensor day ${count(day, settings)} of ${count(life, settings)}`
        : `Sensor day ${count(day, settings)} · past ${count(life, settings)} days`;
    return { kind, label, accessibilityLabel: `${label}. ${source}`, startedAt: event.start, source, event };
  }
  const days = Math.floor(elapsed / DAY);
  const hours = Math.floor(elapsed / HOUR);
  const label = days >= 1
    ? `Site ${count(days, settings)} ${days === 1 ? 'day' : 'days'}`
    : hours >= 1
      ? `Site ${count(hours, settings)} ${hours === 1 ? 'hour' : 'hours'}`
      : 'Site under 1 hour';
  return { kind, label, accessibilityLabel: `${label}. ${source}`, startedAt: event.start, source, event };
}

export function deviceAgeChips(
  events: readonly HealthContextEvent[],
  now: number,
  settings: Settings,
  expectedSensorLife?: ExpectedSensorLifeDays | null,
): DeviceAgeChip[] {
  const latest = latestDeviceChanges(events, now);
  return (['sensor', 'site'] as const).flatMap((kind) => {
    const event = latest[kind];
    const chip = event ? deviceAgeChip(kind, event, now, settings, expectedSensorLife) : undefined;
    return chip ? [chip] : [];
  });
}
