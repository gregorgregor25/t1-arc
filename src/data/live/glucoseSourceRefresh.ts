import type { GlucoseSource } from '@/data/contracts';
import type { GlucoseReading } from '@/domain/models';

export interface GlucoseSourceRefreshResult {
  sourceId: string;
  status: 'fulfilled' | 'rejected';
  reason?: unknown;
  historyStatus?: 'fulfilled' | 'rejected';
}

const SOURCE_LABELS: Record<string, string> = {
  'android-notification': 'Notifications',
  'daymark-librelinkup': 'LibreLinkUp',
  nightscout: 'Nightscout',
  'xdrip-local': 'xDrip',
};

export function glucoseSourceLabel(sourceId: string) {
  return SOURCE_LABELS[sourceId] ?? 'Glucose source';
}

export function glucoseReadingChanged(
  before?: GlucoseReading,
  after?: GlucoseReading,
) {
  return (
    before?.timestamp !== after?.timestamp ||
    before?.mmolL !== after?.mmolL ||
    before?.trend !== after?.trend ||
    before?.sourceId !== after?.sourceId
  );
}

export async function refreshGlucoseSources(
  sources: GlucoseSource[],
): Promise<GlucoseSourceRefreshResult[]> {
  const settled = await Promise.allSettled(
    sources.map((source) => source.refresh?.()),
  );
  return settled.map((result, index) => ({
    sourceId: sources[index]!.sourceId,
    status: result.status,
    reason: result.status === 'rejected' ? result.reason : undefined,
  }));
}

export function glucoseAutomationSummary(
  results: GlucoseSourceRefreshResult[],
  displayUpdated: boolean,
) {
  const failed = results.filter((result) => result.status === 'rejected');
  const historyFailed = results.filter(
    (result) => result.historyStatus === 'rejected',
  );
  const completed = results.filter(
    (result) => result.status === 'fulfilled',
  );

  if (results.length === 0) {
    return {
      outcome: 'skipped' as const,
      detail: displayUpdated
        ? 'No live glucose source is connected; stored displays were checked.'
        : 'No live glucose source is connected.',
    };
  }

  if (failed.length) {
    const failedLabels = failed
      .map((result) => glucoseSourceLabel(result.sourceId))
      .join(', ');
    return {
      outcome: completed.length ? ('partial' as const) : ('failed' as const),
      detail: `${failedLabels} could not update. T1 Arc will try again automatically.`,
    };
  }

  if (historyFailed.length) {
    return {
      outcome: 'partial' as const,
      detail:
        'Current glucose updated; older Nightscout history will retry automatically.',
    };
  }

  const labels = completed
    .map((result) => glucoseSourceLabel(result.sourceId))
    .join(', ');
  return {
    outcome: displayUpdated ? ('success' as const) : ('partial' as const),
    detail: displayUpdated
      ? `${labels} checked and connected displays refreshed.`
      : `${labels} checked; a connected display will catch up later.`,
  };
}
