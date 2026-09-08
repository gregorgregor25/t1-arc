import type { DataSourceStatus } from './models';

function snapshotTime(source: DataSourceStatus): number {
  return Math.max(0, ...[source.lastAttemptAt, source.lastUpdatedAt, source.dataThrough]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
}

export function connectionIssues(sources: readonly DataSourceStatus[]): DataSourceStatus[] {
  const byId = new Map<string, DataSourceStatus>();
  for (const source of sources) {
    const previous = byId.get(source.id);
    // A cached timeline may trail the current-source snapshot. Judge each
    // connection once, using its newest observation, not its worst old state.
    if (!previous || snapshotTime(source) > snapshotTime(previous)) byId.set(source.id, source);
  }
  return [...byId.values()].filter(source => {
    if (source.origin === 'synthetic' || source.origin === 'manual') return false;
    // Unconfigured optional sources are not unfinished tasks for the user.
    if (!source.errorCode && !source.isLive && source.dataThrough === undefined && source.lastUpdatedAt === undefined) return false;
    // Delayed can be the expected cadence of a successful history import.
    // Reading age remains visible on the glucose/source screens.
    return Boolean(source.errorCode) || source.freshness === 'stale' || source.freshness === 'missing';
  });
}

const SETTINGS_TARGETS = {
  't1arc-librelinkup': 'libre', 'dexcom-share': 'dexcom', 'medtrum-easyfollow': 'medtrum',
  nightscout: 'nightscout', 'xdrip-local': 'xdrip', 'android-notification': 'notification',
  'health-connect': 'health', hevy: 'hevy',
} as const;

/** Aggregate glucose/insulin IDs do not establish which provider needs repair. */
export function connectionSettingsTarget(sourceId: string) {
  if (sourceId.startsWith('health-connect:')) return 'health' as const;
  return Object.prototype.hasOwnProperty.call(SETTINGS_TARGETS, sourceId)
    ? SETTINGS_TARGETS[sourceId as keyof typeof SETTINGS_TARGETS] : undefined;
}
