import type { DailyMetricRecord } from '@/domain/dailyHealthMetrics';
import type { EvidenceReference } from '@/domain/insights';
import type { HealthContextEvent } from '@/domain/models';

/** Saved nearby-record windows are context, not a calculation's input list. */
export function evidenceInspectorRecordPresentation(
  evidence: EvidenceReference | undefined,
  view: 'visual' | 'records',
  selectedEventKind?: HealthContextEvent['kind'],
) {
  const nearby = Boolean(evidence?.id.startsWith('context-window:') &&
    !evidence.calculation && !evidence.visualization);
  return {
    heading: nearby ? 'RECORDS AROUND THIS EVENT' : 'EXACT CALCULATION INPUTS',
    title: nearby ? 'Nearby records' : 'No hidden evidence',
    explanation: nearby
      ? 'The saved record list includes the selected event and its surrounding context.'
      : 'Every saved record used for this answer is shown below.',
    resolvedLabel: nearby ? 'LOADED' : 'SHOWN',
    totalLabel: nearby ? 'IN WINDOW' : 'USED',
    includeWeightRecords: !nearby || view === 'records' || selectedEventKind === 'weight',
  };
}

export function referencedHealthRecordsForView(
  records: DailyMetricRecord[],
  recordIds: readonly string[],
  includeWeightRecords: boolean,
) {
  const requested = new Set(recordIds);
  return records.filter((record) =>
    requested.has(record.id) && (includeWeightRecords || record.kind !== 'weight'),
  );
}

export function evidenceResolutionValue(
  resolution: { resolved: number } | undefined,
  failed = false,
) {
  if (resolution) return String(resolution.resolved);
  return failed ? "Unavailable" : "Checking";
}

export function collectEvidenceRecordIds(groups: {
  timelineIds: readonly string[];
  healthMetricIds: readonly string[];
  sourceRecordIds: readonly string[];
  notificationIobIds: readonly string[];
}) {
  return new Set([
    ...groups.timelineIds,
    ...groups.healthMetricIds,
    ...groups.sourceRecordIds,
    ...groups.notificationIobIds,
  ]);
}

export function nextEvidenceVisibleCount(
  visibleCount: number,
  totalCount: number,
  pageSize = 100,
) {
  return Math.min(totalCount, visibleCount + pageSize);
}

export function shouldShowEvidencePagination({
  dataMode,
  hasReferencedTimelineRecords,
  totalCount,
  visibleCount,
}: {
  dataMode: string;
  hasReferencedTimelineRecords: boolean;
  totalCount: number;
  visibleCount: number;
}) {
  return (
    visibleCount < totalCount &&
    (dataMode === "live" || !hasReferencedTimelineRecords)
  );
}

export interface EvidenceRequestIdentity {
  dataMode: string;
  evidenceId: string;
  purpose: "records" | "visual";
  range: {
    start: number;
    end: number;
  };
  recordIds: readonly string[];
  revision: number;
}

export interface EvidenceRequestSnapshot<Value> {
  key: string;
  owner: unknown;
  value: Value;
}

/**
 * Describes every value that can change which evidence an async request owns.
 * The repository itself is compared separately by reference because it cannot
 * be represented safely in a serialised key.
 */
export function evidenceRequestKey(identity: EvidenceRequestIdentity) {
  return JSON.stringify([
    identity.purpose,
    identity.dataMode,
    identity.revision,
    identity.evidenceId,
    identity.range.start,
    identity.range.end,
    identity.recordIds,
  ]);
}

/**
 * Makes a completed request invisible in the render where the evidence or
 * repository changes, before the old effect's cleanup has had a chance to run.
 */
export function evidenceSnapshotForRequest<Value>(
  snapshot: EvidenceRequestSnapshot<Value> | undefined,
  key: string | undefined,
  owner: unknown,
) {
  if (!snapshot || key === undefined) return undefined;
  return snapshot.key === key && snapshot.owner === owner
    ? snapshot.value
    : undefined;
}
