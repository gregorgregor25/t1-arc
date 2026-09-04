import {
  CapturedNotificationEnvelope,
  NotificationCaptureRule,
} from '../../../modules/t1arc-notification-source';
import {
  MG_DL_PER_MMOL_L,
  TrendDirection,
} from '@/domain/models';

import {
  NOTIFICATION_PARSER_VERSION,
  NOTIFICATION_SOURCE_ID,
  ParsedNotificationObservation,
  PumpMode,
} from './types';

const MMOL_PATTERN =
  /(?:^|[^\d])(\d{1,2}(?:[.,]\d{1,2})?)\s*mmol(?:\s*\/\s*l|\s*l)?\b/i;
const MG_DL_PATTERN =
  /(?:^|[^\d])(\d{2,3})\s*mg\s*\/?\s*d[lL]\b/i;
const LABELLED_VALUE_PATTERN =
  /\b(?:glucose|sensor(?:\s+glucose)?|sg|bg)\b[^\d]{0,18}(\d{1,3}(?:[.,]\d{1,2})?)(?![\d.,])/i;
const VALUE_ONLY_PATTERN =
  /^\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:[↔→←↑↓↗↘⇈⇊⬆⬇]|-{1,2}|steady|flat)?\s*$/i;
const IOB_PATTERN =
  /\b(?:IOB|insulin\s+on\s+board)\b\s*[:=]?\s*([+-]?\d{1,2}(?:[.,]\d{1,2})?)(?![\d.,])\s*(?:U|units?)\b/gi;

const TREND_PATTERNS: [RegExp, TrendDirection][] = [
  [/(?:⇊|↓↓|double\s*down|doubleDown)/i, 'doubleDown'],
  [/(?:↘|slight(?:ly)?\s*down|forty\s*five\s*down|FortyFiveDown)/i, 'slightDown'],
  [/(?:↓|single\s*down|SingleDown|falling(?:\s+fast)?)/i, 'down'],
  [/(?:⇈|↑↑|double\s*up|doubleUp)/i, 'doubleUp'],
  [/(?:↗|slight(?:ly)?\s*up|forty\s*five\s*up|FortyFiveUp)/i, 'slightUp'],
  [/(?:↑|single\s*up|SingleUp|rising(?:\s+fast)?)/i, 'up'],
  [/(?:→|↔|steady|flat)/i, 'flat'],
];

function notificationText(envelope: CapturedNotificationEnvelope) {
  return [
    envelope.bigText,
    envelope.text,
    envelope.title,
    envelope.subText,
    envelope.infoText,
    ...envelope.textLines,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normaliseNotificationNumerals)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function normaliseNotificationNumerals(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u0660-\u0669]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x0660),
    )
    .replace(/[\u06f0-\u06f9]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x06f0),
    )
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, '');
}

function parseNumber(value: string) {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validMmol(value: number) {
  return value >= 1 && value <= 40;
}

function convertCandidate(
  value: number | undefined,
  unit: 'mmolL' | 'mgDl',
) {
  if (value === undefined) return undefined;
  const mmolL =
    unit === 'mgDl'
      ? Math.round((value / MG_DL_PER_MMOL_L) * 10) / 10
      : Math.round(value * 10) / 10;
  return validMmol(mmolL) ? mmolL : undefined;
}

function extractGlucose(
  texts: string[],
  rule: NotificationCaptureRule,
) {
  if (!rule.captureGlucose) return undefined;
  const combined = texts.join('\n');
  const mmol = MMOL_PATTERN.exec(combined);
  const mmolValue = convertCandidate(
    mmol?.[1] ? parseNumber(mmol[1]) : undefined,
    'mmolL',
  );
  if (mmolValue !== undefined) return mmolValue;

  const mg = MG_DL_PATTERN.exec(combined);
  const mgValue = convertCandidate(
    mg?.[1] ? parseNumber(mg[1]) : undefined,
    'mgDl',
  );
  if (mgValue !== undefined) return mgValue;

  const explicitUnit =
    rule.glucoseUnit === 'auto' ? undefined : rule.glucoseUnit;
  if (!explicitUnit) return undefined;
  const labelled = LABELLED_VALUE_PATTERN.exec(combined);
  const labelledValue = convertCandidate(
    labelled?.[1] ? parseNumber(labelled[1]) : undefined,
    explicitUnit,
  );
  if (labelledValue !== undefined) return labelledValue;

  const valueOnlyCandidates = texts
    .map((text) => VALUE_ONLY_PATTERN.exec(text))
    .map((match) =>
      convertCandidate(
        match?.[1] ? parseNumber(match[1]) : undefined,
        explicitUnit,
      ),
    )
    .filter((value): value is number => value !== undefined)
    .filter((value, index, values) => values.indexOf(value) === index);
  return valueOnlyCandidates.length === 1
    ? valueOnlyCandidates[0]
    : undefined;
}

function extractTrend(texts: string[]): TrendDirection {
  const combined = texts.join('\n');
  return (
    TREND_PATTERNS.find(([pattern]) => pattern.test(combined))?.[1] ??
    'unknown'
  );
}

function extractIob(texts: string[]) {
  const matches = [...texts.join('\n').matchAll(IOB_PATTERN)];
  if (!matches.length) return undefined;
  const values: number[] = [];
  for (const match of matches) {
    const value = match[1] ? parseNumber(match[1]) : undefined;
    if (value === undefined || value < 0 || value > 100) return undefined;
    values.push(Math.round(value * 100) / 100);
  }
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? distinct[0] : undefined;
}

function extractPumpMode(texts: string[]): PumpMode | undefined {
  const value = texts.join('\n');
  if (/\bautomated\s+mode\b/i.test(value)) return 'automated';
  if (/\bmanual\s+mode\b/i.test(value)) return 'manual';
  if (/\b(?:limited|automated\s+limited)\b/i.test(value)) return 'limited';
  return undefined;
}

function eventTimestamp(envelope: CapturedNotificationEnvelope) {
  const candidate = envelope.notificationWhen;
  if (
    candidate !== undefined &&
    candidate >= Date.UTC(2020, 0, 1) &&
    candidate <= envelope.receivedAt + 5 * 60_000
  ) {
    return candidate;
  }
  return envelope.postedAt;
}

export function parseCapturedNotification(
  envelope: CapturedNotificationEnvelope,
  rule: NotificationCaptureRule,
): ParsedNotificationObservation {
  const texts = notificationText(envelope);
  const mmolL = extractGlucose(texts, rule);
  const timestamp = eventTimestamp(envelope);
  const iobUnits = rule.captureInsulin ? extractIob(texts) : undefined;
  const mode = rule.captureInsulin ? extractPumpMode(texts) : undefined;

  return {
    envelope,
    rule,
    glucose:
      mmolL === undefined
        ? undefined
        : {
            id: `${NOTIFICATION_SOURCE_ID}:${envelope.id}:v${NOTIFICATION_PARSER_VERSION}`,
            timestamp,
            receivedAt: envelope.receivedAt,
            mmolL,
            trend: extractTrend(texts),
            quality: 'measured',
            sourceId: NOTIFICATION_SOURCE_ID,
          },
    pump:
      iobUnits === undefined && mode === undefined
        ? undefined
        : {
            iobUnits,
            mode,
          },
  };
}
