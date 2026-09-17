import type { EvidenceReference } from '@/domain/insights';
import { buildContextEventEvidence } from '@/domain/insights';
import { calculateGlucoseStatistics, DEFAULT_OBSERVATION_GAP_MS, type GlucoseStatistics } from '@/domain/glucoseStatistics';
import { formatGlucose, formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { isDefaultContextQuestion, isTarvisEntry, type TarvisEntry } from '@/domain/tarvisEntry';
import { TARGET_HIGH_MMOL_L, TARGET_LOW_MMOL_L, type TimelineData } from '@/domain/models';
import { isEvidenceQueryVisualizationReference, type EvidenceQueryChartPoint, type EvidenceRangeTraceVisualization } from '@/domain/evidenceQueryChart';
import type { TarvisAnswer } from './types';
import { buildRetrospectiveEventReview, rangeForRetrospectiveActivity } from './retrospectiveEventReview';

function originalSelectedGlucoseTrace(entry: TarvisEntry, timeline: TimelineData, statistics: GlucoseStatistics): EvidenceRangeTraceVisualization | undefined {
  const ids = new Set(statistics.recordIds);
  const byTime = new Map<number, { timestamp: number; mmolL: number; recordIds: string[] }>();
  for (const reading of timeline.glucose) {
    if (!ids.has(reading.id)) continue;
    const existing = byTime.get(reading.timestamp);
    if (existing && existing.mmolL !== reading.mmolL) return undefined;
    if (existing) existing.recordIds.push(reading.id);
    else byTime.set(reading.timestamp, { timestamp: reading.timestamp, mmolL: reading.mmolL, recordIds: [reading.id] });
    if (byTime.size > 4_000) return undefined;
  }
  if (!byTime.size) return undefined;
  const points: EvidenceQueryChartPoint[] = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  const minimum = Math.min(TARGET_LOW_MMOL_L, ...points.map(point => point.mmolL));
  const maximum = Math.max(TARGET_HIGH_MMOL_L, ...points.map(point => point.mmolL));
  const padding = Math.max(0.5, (maximum - minimum) * 0.08);
  const trace: EvidenceRangeTraceVisualization = {
    schemaVersion: 1, kind: 'range-trace-v1', metric: 'glucose.mean', units: 'mmol/L',
    timezone: entry.timeZone, gapThresholdMilliseconds: DEFAULT_OBSERVATION_GAP_MS,
    title: 'Glucose in the selected period', subtitle: 'Original recorded values. Gaps are not filled.',
    targetRange: { minimum: TARGET_LOW_MMOL_L, maximum: TARGET_HIGH_MMOL_L },
    valueDomain: { minimum: Math.max(0, Math.floor((minimum - padding) * 10) / 10), maximum: Math.ceil((maximum + padding) * 10) / 10 },
    windows: [{ id: 'selected-period', label: entry.label, range: { ...timeline.range }, points,
      recordCount: ids.size, coveragePercent: statistics.coveragePercent,
      coverageStatus: statistics.coveragePercent >= 70 ? 'sufficient' : 'limited',
      meanMmolL: statistics.arithmeticMeanMmolL, meanPrecisionDecimals: 4,
      distribution: null, events: [],
    }],
  };
  return isEvidenceQueryVisualizationReference(trace) ? trace : undefined;
}

/** The explicit app selection is authoritative; never round-trip its boundaries through prose. */
export function selectedContextRange(entry: TarvisEntry, asOf: number) {
  if (!isTarvisEntry(entry) || !Number.isSafeInteger(asOf) || entry.range.start >= asOf || asOf >= 8_640_000_000_000_000) throw new Error('This selection is not available in the current records.');
  return entry.kind !== 'event'
    ? { start: entry.range.start, end: Math.min(entry.range.end, asOf) }
    : { start: Math.max(1, entry.range.start - 4 * 3_600_000), end: Math.min(asOf, entry.range.end + 2 * 3_600_000) };
}

export function buildSelectedContextAnswer(
  entry: TarvisEntry,
  timeline: TimelineData,
  asOf = timeline.range.end,
  ownerIdentity = entry.ownerIdentity ?? '',
): { answer: TarvisAnswer; evidence: EvidenceReference[] } {
  if (!isDefaultContextQuestion(entry, entry.question, ownerIdentity)) throw new Error('Choose these records again from your timeline.');
  const expectedRange = selectedContextRange(entry, asOf);
  if (timeline.range.start !== expectedRange.start || timeline.range.end !== expectedRange.end) {
    throw new Error('The loaded records do not match your selected period. Please try again.');
  }
  const regional = getRuntimeRegionalDefaults();
  const statistics = calculateGlucoseStatistics({ readings: timeline.glucose, range: timeline.range });
  const available = statistics.arithmeticMeanMmolL !== null;
  const coverage = `${formatRegionalNumber(statistics.coveragePercent, regional.locale, { maximumFractionDigits: 1 })}% observed glucose coverage`;
  const mean = available ? formatGlucose(statistics.arithmeticMeanMmolL!, regional) : undefined;
  const count = formatRegionalNumber(statistics.sampleCount, regional.locale, { maximumFractionDigits: 0 });
  const glucose: EvidenceReference = {
    id: `selected-glucose:${timeline.range.start}:${timeline.range.end}`,
    label: entry.kind === 'period' ? 'Selected glucose period' : 'Glucose around the selected event',
    range: { ...timeline.range }, recordIds: statistics.recordIds,
    description: `${count} distinct reading times · ${coverage}. Average uses recorded samples; missing time is not filled.`,
    examples: timeline.glucose.filter(reading => statistics.recordIds.includes(reading.id)).slice(0, 6).map(reading => ({ id: reading.id, kind: 'glucose', timestamp: reading.timestamp, primary: formatGlucose(reading.mmolL, regional), secondary: 'Recorded glucose', sourceId: reading.sourceId })),
    calculation: { kind: 'tarvis-local-glucose-v1', queryId: `selected:${timeline.range.start}:${timeline.range.end}`, algorithmVersion: statistics.algorithmVersion, metrics: [{ id: 'glucose.mean', value: statistics.arithmeticMeanMmolL, unit: 'mmol/L' }], thresholds: [], requestedWindowCount: 1, windowsWithData: available ? 1 : 0, coveragePercent: statistics.coveragePercent },
    visualization: originalSelectedGlucoseTrace(entry, timeline, statistics),
  };
  const limitations = statistics.coveragePercent < 70 ? ['There are gaps in the glucose records, so this describes the readings available, not the complete period.'] : [];
  if (entry.kind === 'period' && entry.range.end > timeline.range.end) limitations.push('This period is still in progress. Only records available so far are included.');
  if (entry.kind === 'period') return {
    answer: { headline: available ? `Your average was ${mean}` : 'No glucose readings in this period', answer: `${entry.label}. ${glucose.description}`, confidence: available && statistics.coveragePercent >= 70 ? 'high' : 'limited', evidenceIds: available ? [glucose.id] : [], limitations },
    evidence: available ? [glucose] : [],
  };
  const event = timeline.context.find(item => item.id === entry.eventId && item.sourceId === entry.sourceId);
  const actualEnd = event ? event.end ?? (event.kind === 'activity' ? event.start + event.durationMinutes * 60_000 : event.start + 1) : undefined;
  if (!event || event.kind !== entry.eventKind || event.start !== entry.range.start ||
    Math.max(event.start + 1, actualEnd!) !== entry.range.end) return { answer: { headline: 'That record has changed or is no longer available', answer: 'It may have been edited, removed or its connection may have changed. Return to your timeline to choose the record again.', confidence: 'limited', evidenceIds: [], limitations: [] }, evidence: [] };
  // Reuse the established workout chronology once its full follow-up window has
  // elapsed. Ongoing events keep a bounded factual summary without treating the
  // future as missing data. No speculative causes or treatment recommendations.
  if (event.kind === 'activity' && rangeForRetrospectiveActivity(event).end <= asOf) {
    const review = buildRetrospectiveEventReview({ question: entry.question,
      timeline: { ...timeline, context: timeline.context.filter(item => item.id !== event.id || item.sourceId === event.sourceId) },
      selectedActivityId: event.id });
    const glucoseIds = new Set(glucose.recordIds);
    return { answer: review.answer, evidence: review.evidence.map(reference =>
      glucose.visualization && reference.range.start === glucose.range.start && reference.range.end === glucose.range.end &&
      reference.recordIds.length === glucoseIds.size && reference.recordIds.every(id => glucoseIds.has(id))
        ? { ...reference, visualization: glucose.visualization } : reference) };
  }
  const reference = buildContextEventEvidence(event, timeline);
  const evidence = [reference, ...(available ? [glucose] : [])];
  const recordedDetail = reference.examples.find(item => item.id === event.id)?.secondary ?? event.title;
  return { answer: { headline: event.title, answer: `${recordedDetail}${available ? `\n\nGlucose averaged ${mean} in the surrounding period (${coverage}).` : '\n\nThere are no glucose readings in the surrounding period.'}`, confidence: 'limited', evidenceIds: evidence.map(item => item.id), limitations: [...limitations,
    ...(entry.range.end + 2 * 3_600_000 > asOf ? ['This shows the records available so far; the full follow-up period has not elapsed.'] : []),
    'Nearby records show what happened around this event, not what caused a glucose change.'] }, evidence };
}
