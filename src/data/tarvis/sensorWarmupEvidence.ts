import { buildDataCompletenessReport } from '@/domain/dataCompleteness';
import type { EvidenceRecordPreview } from '@/domain/insights';
import type { TimelineData } from '@/domain/models';
import { isRecordedSensorStart, sensorWarmupWindow } from '@/domain/sensorChange';
import { sensorModel } from '@/domain/sensorModels';
import { sourceSupports } from '@/domain/sourceCapabilities';
import { formatTarvisLocalDateTime } from './timePresentation';

/** Explains only missing time intersecting a recorded, source-matched expectation.
 * Coverage and glucose values remain untouched, including readings inside warm-up. */
export function sensorWarmupEvidence(data: TimelineData) {
  const gaps = buildDataCompletenessReport(data).glucose.gaps;
  const sourceIds = new Set(data.glucose.map((reading) => reading.sourceId));
  data.sources.filter((source) => sourceSupports(source.capabilities, 'glucose')).forEach((source) => sourceIds.add(source.id));
  const matches = data.context.filter(isRecordedSensorStart).flatMap((event) => {
    const window = sensorWarmupWindow(event);
    if (!window || !event.sensorGlucoseSourceId || !sourceIds.has(event.sensorGlucoseSourceId)) return [];
    const missing = gaps.flatMap((gap) => {
      const start = Math.max(window.start, gap.start, data.range.start);
      const end = Math.min(window.end, gap.end, data.range.end);
      return end > start ? [{ start, end }] : [];
    });
    return missing.length ? [{ event, window, missing }] : [];
  });
  const examples: EvidenceRecordPreview[] = matches.map(({ event, window, missing }) => ({
    id: event.id, kind: 'context', timestamp: event.start, primary: event.title, sourceId: event.sourceId,
    secondary: `Expected warm-up: ${formatTarvisLocalDateTime(window.start)} to ${formatTarvisLocalDateTime(window.end)} (${event.sensorWarmupMinutes} minutes). Missing time within it: ${missing.map((gap) => `${formatTarvisLocalDateTime(gap.start)} to ${formatTarvisLocalDateTime(gap.end)}`).join('; ')}.`,
  }));
  const sentences = matches.slice(0, 5).map(({ event, window }) =>
    `Missing readings within ${formatTarvisLocalDateTime(window.start)} to ${formatTarvisLocalDateTime(window.end)} are consistent with the expected ${event.sensorWarmupMinutes}-minute warm-up for ${sensorModel(event.sensorModelId)?.label ?? 'the sensor'} following your recorded sensor change.`);
  return {
    summary: sentences.length ? ` ${sentences.join(' ')} Missing time outside these windows remains unexplained by sensor warm-up. Actual readings and coverage figures are unchanged.` : '',
    recordIds: matches.map(({ event }) => event.id), examples,
  };
}
