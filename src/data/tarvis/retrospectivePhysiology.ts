import type { EvidenceRecordPreview } from "@/domain/insights";
import type { ActivityEvent, TimeRange } from "@/domain/models";
import { formatShortDate, formatTime, toDateKey } from "@/domain/time";
import {
  formatDistance,
  formatElevation,
  formatEnergy,
  formatRegionalNumber,
  formatSpeed,
} from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

const MINUTE_MS = 60_000;
const WORKOUT_START_TOLERANCE_MS = 5 * MINUTE_MS;
const WORKOUT_END_TOLERANCE_MS = 10 * MINUTE_MS;
const MAX_EVIDENCE_PREVIEWS = 5;

export const RETROSPECTIVE_PHYSIOLOGY_SYNC_STALE_MS = 24 * 60 * MINUTE_MS;
export const RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT = 5_000;

export const RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS = [
  "workout",
  "steps",
  "distance",
  "elevation_gained",
  "active_calories",
  "heart_rate",
  "workout_power",
  "workout_speed",
  "walking_cadence",
  "cycling_cadence",
] as const;

export type RetrospectivePhysiologyRecordKind =
  (typeof RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS)[number];

export type RetrospectivePhysiologyCategory =
  "steps" | "distance" | "active_calories" | "workouts" | "heart_rate";

export type RetrospectivePhysiologyCoverageStatus =
  "current" | "missing" | "stale" | "unsynced" | "disabled" | "unavailable";

export type RetrospectivePhysiologyCoverageReason =
  | "records-loaded"
  | "no-overlapping-records"
  | "sync-stale"
  | "never-synced"
  | "category-disabled"
  | "preference-unavailable"
  | "needs-source"
  | "candidate-limit"
  | "load-failed";

export interface RetrospectivePhysiologyCandidate {
  id: string;
  kind: RetrospectivePhysiologyRecordKind;
  sourcePackage: string;
  sourceLabel: string;
  start: number;
  end: number;
  value?: number;
  unit?: string;
  workoutTitle?: string;
  perceivedExertion?: number;
}

/**
 * The complete allowlisted record contract that may leave the persistence
 * layer. It deliberately has no raw payload, notes, device or account fields.
 */
export type RetrospectivePhysiologyRecord = RetrospectivePhysiologyCandidate;

export interface RetrospectivePhysiologyPreference {
  category: RetrospectivePhysiologyCategory;
  enabled: boolean;
  preferredSourcePackage?: string;
}

export interface RetrospectivePhysiologySyncState {
  category: RetrospectivePhysiologyCategory;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  recordCount: number;
  lastErrorCode?: string;
}

export interface RetrospectivePhysiologyAlternateSource {
  sourcePackage: string;
  sourceLabel: string;
  recordCount: number;
}

export interface RetrospectivePhysiologyCoverage {
  category: RetrospectivePhysiologyCategory;
  status: RetrospectivePhysiologyCoverageStatus;
  reason?: RetrospectivePhysiologyCoverageReason;
  recordCount: number;
  selectedSourcePackage?: string;
  selectedSourceLabel?: string;
  alternateSources?: RetrospectivePhysiologyAlternateSource[];
  lastAttemptAt?: number;
  lastSuccessAt?: number;
}

export interface RetrospectivePhysiology {
  activityId: string;
  /** The unchanged four-hour-before/two-hour-after loader request range. */
  range: TimeRange;
  /** Records here still overlap the actual activity, not merely range. */
  records: RetrospectivePhysiologyRecord[];
  coverage: RetrospectivePhysiologyCoverage[];
  loadedCandidateCount?: number;
  truncated?: boolean;
}

export interface RetrospectivePhysiologyLoadRequest {
  activity: ActivityEvent;
  range: TimeRange;
}

export type RetrospectivePhysiologyLoader = (
  request: RetrospectivePhysiologyLoadRequest,
) => Promise<RetrospectivePhysiology>;

const PHYSIOLOGY_CATEGORIES: RetrospectivePhysiologyCategory[] = [
  "steps",
  "distance",
  "active_calories",
  "workouts",
  "heart_rate",
];

const KIND_CATEGORY: Record<
  RetrospectivePhysiologyRecordKind,
  RetrospectivePhysiologyCategory
> = {
  workout: "workouts",
  steps: "steps",
  distance: "distance",
  elevation_gained: "distance",
  active_calories: "active_calories",
  heart_rate: "heart_rate",
  workout_power: "workouts",
  workout_speed: "workouts",
  walking_cadence: "workouts",
  cycling_cadence: "workouts",
};

const VALUE_CONTRACT: Partial<
  Record<
    RetrospectivePhysiologyRecordKind,
    { unit: string; minimum: number; maximum: number }
  >
> = {
  steps: { unit: "count", minimum: 0, maximum: 1_000_000 },
  distance: { unit: "m", minimum: 0, maximum: 1_000_000 },
  elevation_gained: { unit: "m", minimum: 0, maximum: 100_000 },
  active_calories: { unit: "kcal", minimum: 0, maximum: 100_000 },
  heart_rate: { unit: "bpm", minimum: 20, maximum: 300 },
  workout_power: { unit: "w", minimum: 0, maximum: 5_000 },
  workout_speed: { unit: "m/s", minimum: 0, maximum: 100 },
  walking_cadence: { unit: "rpm", minimum: 0, maximum: 300 },
  cycling_cadence: { unit: "rpm", minimum: 0, maximum: 300 },
};

const KIND_ORDER = new Map(
  RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS.map((kind, index) => [kind, index]),
);

function activityEnd(activity: ActivityEvent) {
  return activity.end ?? activity.start + activity.durationMinutes * MINUTE_MS;
}

function finiteTimestamp(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function overlapsHalfOpenActivity(
  candidate: RetrospectivePhysiologyCandidate,
  activity: ActivityEvent,
) {
  const end = activityEnd(activity);
  if (candidate.end === candidate.start) {
    return candidate.start >= activity.start && candidate.start < end;
  }
  return candidate.start < end && candidate.end > activity.start;
}

function sanitizedText(value: string | undefined) {
  const clean = value?.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 120) : undefined;
}

function sanitizeCandidate(
  candidate: RetrospectivePhysiologyCandidate,
): RetrospectivePhysiologyRecord | undefined {
  if (
    !RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS.includes(
      candidate.kind as RetrospectivePhysiologyRecordKind,
    ) ||
    !candidate.id.trim() ||
    !candidate.sourcePackage.trim() ||
    !finiteTimestamp(candidate.start) ||
    !finiteTimestamp(candidate.end) ||
    candidate.end < candidate.start
  ) {
    return undefined;
  }
  if (candidate.kind !== "workout") {
    const contract = VALUE_CONTRACT[candidate.kind];
    if (
      !contract ||
      candidate.unit !== contract.unit ||
      candidate.value === undefined ||
      !Number.isFinite(candidate.value) ||
      candidate.value < contract.minimum ||
      candidate.value > contract.maximum
    ) {
      return undefined;
    }
  }
  const perceivedExertion =
    candidate.kind === "workout" &&
    candidate.perceivedExertion !== undefined &&
    Number.isFinite(candidate.perceivedExertion) &&
    candidate.perceivedExertion >= 0 &&
    candidate.perceivedExertion <= 10
      ? candidate.perceivedExertion
      : undefined;
  return {
    id: candidate.id,
    kind: candidate.kind,
    sourcePackage: candidate.sourcePackage.trim(),
    sourceLabel:
      sanitizedText(candidate.sourceLabel) ?? candidate.sourcePackage.trim(),
    start: candidate.start,
    end: candidate.end,
    ...(candidate.kind === "workout"
      ? {
          workoutTitle: sanitizedText(candidate.workoutTitle),
          perceivedExertion,
        }
      : { value: candidate.value, unit: candidate.unit }),
  };
}

function healthConnectPackage(sourceId: string) {
  const prefix = "health-connect:";
  return sourceId.startsWith(prefix)
    ? sourceId.slice(prefix.length).trim() || undefined
    : undefined;
}

function associatedActivityPackages(activity: ActivityEvent) {
  return [activity.sourceId, ...(activity.corroboratingSourceIds ?? [])]
    .map(healthConnectPackage)
    .filter((value): value is string => Boolean(value));
}

function matchesSelectedWorkout(
  record: RetrospectivePhysiologyRecord,
  activity: ActivityEvent,
  associatedPackages: ReadonlySet<string>,
) {
  if (record.kind !== "workout") return true;
  if (record.id === activity.id) return true;
  if (
    associatedPackages.size > 0 &&
    !associatedPackages.has(record.sourcePackage)
  ) {
    return false;
  }
  return (
    Math.abs(record.start - activity.start) <= WORKOUT_START_TOLERANCE_MS &&
    Math.abs(record.end - activityEnd(activity)) <= WORKOUT_END_TOLERANCE_MS
  );
}

function sourceGroups(records: readonly RetrospectivePhysiologyRecord[]) {
  const groups = new Map<
    string,
    { sourcePackage: string; sourceLabel: string; recordCount: number }
  >();
  for (const record of records) {
    const existing = groups.get(record.sourcePackage);
    groups.set(record.sourcePackage, {
      sourcePackage: record.sourcePackage,
      sourceLabel: record.sourceLabel,
      recordCount: (existing?.recordCount ?? 0) + 1,
    });
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.sourceLabel.localeCompare(right.sourceLabel) ||
      left.sourcePackage.localeCompare(right.sourcePackage),
  );
}

function selectedPackageForCategory({
  records,
  preference,
  associatedPackages,
}: {
  records: readonly RetrospectivePhysiologyRecord[];
  preference: RetrospectivePhysiologyPreference;
  associatedPackages: readonly string[];
}) {
  if (preference.preferredSourcePackage) {
    return {
      selectedSourcePackage: preference.preferredSourcePackage,
      ambiguous: false,
    };
  }
  const recordPackages = [
    ...new Set(records.map(({ sourcePackage }) => sourcePackage)),
  ];
  if (recordPackages.length > 1) {
    return { selectedSourcePackage: undefined, ambiguous: true };
  }
  return {
    selectedSourcePackage: recordPackages[0] ?? associatedPackages[0],
    ambiguous: false,
  };
}

function coverageStatus({
  hasRecords,
  preference,
  sync,
  ambiguous,
  asOf,
}: {
  hasRecords: boolean;
  preference?: RetrospectivePhysiologyPreference;
  sync?: RetrospectivePhysiologySyncState;
  ambiguous: boolean;
  asOf: number;
}): Pick<RetrospectivePhysiologyCoverage, "status" | "reason"> {
  if (!preference) {
    return { status: "unavailable", reason: "preference-unavailable" };
  }
  if (!preference.enabled) {
    return { status: "disabled", reason: "category-disabled" };
  }
  if (ambiguous) {
    return { status: "unavailable", reason: "needs-source" };
  }
  if (sync?.lastSuccessAt === undefined) {
    return { status: "unsynced", reason: "never-synced" };
  }
  const failedAfterSuccess =
    Boolean(sync.lastErrorCode) &&
    (sync.lastAttemptAt === undefined ||
      sync.lastAttemptAt >= sync.lastSuccessAt);
  const syncAge = Math.max(0, asOf - sync.lastSuccessAt);
  if (
    !Number.isFinite(sync.lastSuccessAt) ||
    failedAfterSuccess ||
    syncAge > RETROSPECTIVE_PHYSIOLOGY_SYNC_STALE_MS
  ) {
    return { status: "stale", reason: "sync-stale" };
  }
  return hasRecords
    ? { status: "current", reason: "records-loaded" }
    : { status: "missing", reason: "no-overlapping-records" };
}

export function buildRetrospectivePhysiology({
  activity,
  range,
  candidates,
  preferences,
  syncStates,
  asOf,
  truncated = false,
  loadedCandidateCount = candidates.length,
}: {
  activity: ActivityEvent;
  range: TimeRange;
  candidates: readonly RetrospectivePhysiologyCandidate[];
  preferences: readonly RetrospectivePhysiologyPreference[];
  syncStates: readonly RetrospectivePhysiologySyncState[];
  asOf: number;
  truncated?: boolean;
  loadedCandidateCount?: number;
}): RetrospectivePhysiology {
  const associatedPackages = associatedActivityPackages(activity);
  const associatedPackageSet = new Set(associatedPackages);
  const valid = candidates
    .map(sanitizeCandidate)
    .filter((record): record is RetrospectivePhysiologyRecord =>
      Boolean(record),
    )
    .filter((record) => overlapsHalfOpenActivity(record, activity))
    .filter((record) =>
      matchesSelectedWorkout(record, activity, associatedPackageSet),
    );
  const preferenceByCategory = new Map(
    preferences.map((preference) => [preference.category, preference]),
  );
  const syncByCategory = new Map(
    syncStates.map((sync) => [sync.category, sync]),
  );
  const selectedRecords: RetrospectivePhysiologyRecord[] = [];
  const coverage = PHYSIOLOGY_CATEGORIES.map((category) => {
    const preference = preferenceByCategory.get(category);
    const categoryRecords = valid.filter(
      (record) => KIND_CATEGORY[record.kind] === category,
    );
    const selection = preference
      ? selectedPackageForCategory({
          records: categoryRecords,
          preference,
          associatedPackages,
        })
      : { selectedSourcePackage: undefined, ambiguous: false };
    const records =
      preference?.enabled &&
      !selection.ambiguous &&
      !(truncated && !preference.preferredSourcePackage)
        ? categoryRecords.filter(
            (record) =>
              !selection.selectedSourcePackage ||
              record.sourcePackage === selection.selectedSourcePackage,
          )
        : [];
    selectedRecords.push(...records);
    const alternates = sourceGroups(
      selection.selectedSourcePackage
        ? categoryRecords.filter(
            ({ sourcePackage }) =>
              sourcePackage !== selection.selectedSourcePackage,
          )
        : categoryRecords,
    );
    const selectedSource = sourceGroups(records)[0];
    const sync = syncByCategory.get(category);
    // The safety bound applies before per-category selection. Once reached,
    // even an explicit preferred package cannot prove that later rows for an
    // enabled category were absent or complete. Retained preferred-source rows
    // remain inspectable evidence, but coverage must fail closed.
    const boundedCoverageUnknown = Boolean(preference?.enabled) && truncated;
    return {
      category,
      ...(boundedCoverageUnknown
        ? {
            status: "unavailable" as const,
            reason: "candidate-limit" as const,
          }
        : coverageStatus({
            hasRecords: records.length > 0,
            preference,
            sync,
            ambiguous: selection.ambiguous,
            asOf,
          })),
      recordCount: records.length,
      selectedSourcePackage: selection.selectedSourcePackage,
      selectedSourceLabel: selectedSource?.sourceLabel,
      alternateSources: alternates.length ? alternates : undefined,
      lastAttemptAt: sync?.lastAttemptAt,
      lastSuccessAt: sync?.lastSuccessAt,
    } satisfies RetrospectivePhysiologyCoverage;
  });

  selectedRecords.sort(
    (left, right) =>
      left.start - right.start ||
      (KIND_ORDER.get(left.kind) ?? Number.MAX_SAFE_INTEGER) -
        (KIND_ORDER.get(right.kind) ?? Number.MAX_SAFE_INTEGER) ||
      left.id.localeCompare(right.id),
  );
  return {
    activityId: activity.id,
    range: { ...range },
    records: selectedRecords,
    coverage,
    loadedCandidateCount: Math.max(0, loadedCandidateCount),
    truncated,
  };
}

export function unavailableRetrospectivePhysiology(
  activity: ActivityEvent,
  range: TimeRange,
): RetrospectivePhysiology {
  return {
    activityId: activity.id,
    range: { ...range },
    records: [],
    coverage: PHYSIOLOGY_CATEGORIES.map((category) => ({
      category,
      status: "unavailable",
      reason: "load-failed",
      recordCount: 0,
    })),
    loadedCandidateCount: 0,
    truncated: false,
  };
}

interface CandidateRow {
  id: string;
  kind: string;
  source_package: string;
  display_name: string | null;
  start_ms: number;
  end_ms: number;
  value: number | null;
  unit: string | null;
  workout_title: unknown;
  workout_rpe: unknown;
}

interface SyncRow {
  category: string;
  last_attempt_at_ms?: number | null;
  last_success_at_ms?: number | null;
  record_count?: number;
  last_error_code?: string | null;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  recordCount?: number;
  lastErrorCode?: string;
}

function isPhysiologyCategory(
  value: string,
): value is RetrospectivePhysiologyCategory {
  return PHYSIOLOGY_CATEGORIES.includes(
    value as RetrospectivePhysiologyCategory,
  );
}

function candidateFromRow(row: CandidateRow) {
  return {
    id: row.id,
    kind: row.kind as RetrospectivePhysiologyRecordKind,
    sourcePackage: row.source_package,
    sourceLabel: row.display_name ?? row.source_package,
    start: row.start_ms,
    end: row.end_ms,
    value: row.value ?? undefined,
    unit: row.unit ?? undefined,
    workoutTitle:
      typeof row.workout_title === "string" ? row.workout_title : undefined,
    perceivedExertion:
      typeof row.workout_rpe === "number" ? row.workout_rpe : undefined,
  } satisfies RetrospectivePhysiologyCandidate;
}

const ALLOWED_KIND_SQL = RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS.map(
  (kind) => `'${kind}'`,
).join(", ");

export async function loadRetrospectivePhysiology({
  activity,
  range,
  asOf = Date.now(),
}: RetrospectivePhysiologyLoadRequest & {
  asOf?: number;
}): Promise<RetrospectivePhysiology> {
  try {
    // Keep the pure review contract usable in tests and non-native runtimes;
    // the encrypted SQLite dependency is needed only by the production loader.
    const [{ openT1ArcDatabase }, { loadHealthConnectPreferences }] =
      await Promise.all([
        import("@/data/persistence/t1arcDatabase"),
        import("@/data/healthConnect/healthConnectRepository"),
      ]);
    const database = await openT1ArcDatabase();
    const strictActivityRange = {
      start: Math.max(range.start, activity.start),
      end: Math.min(range.end, activityEnd(activity)),
    };
    const [candidateRows, loadedPreferences, syncRows] = await Promise.all([
      database.getAllAsync<CandidateRow>(
        `SELECT r.id, r.kind, r.source_package, s.display_name,
           r.start_ms, r.end_ms, r.value, r.unit,
           CASE WHEN r.kind = 'workout' AND json_valid(r.payload_json)
             THEN json_extract(r.payload_json, '$.title') END AS workout_title,
           CASE WHEN r.kind = 'workout' AND json_valid(r.payload_json)
             THEN json_extract(r.payload_json, '$.rateOfPerceivedExertion')
           END AS workout_rpe
         FROM health_connect_records r
         LEFT JOIN health_connect_sources s
           ON s.package_name = r.source_package
         WHERE r.kind IN (${ALLOWED_KIND_SQL})
           AND r.start_ms < ?
           AND (
             r.end_ms > ?
             OR (r.end_ms = r.start_ms AND r.start_ms >= ?)
           )
         ORDER BY r.start_ms ASC, r.id ASC
         LIMIT ${RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT + 1}`,
        strictActivityRange.end,
        strictActivityRange.start,
        strictActivityRange.start,
      ),
      loadHealthConnectPreferences(),
      database.getAllAsync<SyncRow>(
        `SELECT category, last_attempt_at_ms, last_success_at_ms,
           record_count, last_error_code
         FROM health_connect_sync_state
         WHERE category IN (
           'steps', 'distance', 'active_calories', 'workouts', 'heart_rate'
         )`,
      ),
    ]);
    const truncated =
      candidateRows.length > RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT;
    const boundedRows = candidateRows.slice(
      0,
      RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT,
    );
    return buildRetrospectivePhysiology({
      activity,
      range,
      asOf,
      candidates: boundedRows.map(candidateFromRow),
      preferences: loadedPreferences.flatMap((preference) =>
        isPhysiologyCategory(preference.category)
          ? [
              {
                category: preference.category,
                enabled: preference.enabled,
                preferredSourcePackage: preference.preferredSourcePackage,
              },
            ]
          : [],
      ),
      syncStates: syncRows.flatMap((row) =>
        isPhysiologyCategory(row.category)
          ? [
              {
                category: row.category,
                lastAttemptAt:
                  row.last_attempt_at_ms ?? row.lastAttemptAt ?? undefined,
                lastSuccessAt:
                  row.last_success_at_ms ?? row.lastSuccessAt ?? undefined,
                recordCount: row.record_count ?? row.recordCount ?? 0,
                lastErrorCode:
                  row.last_error_code ?? row.lastErrorCode ?? undefined,
              },
            ]
          : [],
      ),
      loadedCandidateCount: boundedRows.length,
      truncated,
    });
  } catch {
    return unavailableRetrospectivePhysiology(activity, range);
  }
}

const COVERAGE_LABEL: Record<RetrospectivePhysiologyCategory, string> = {
  steps: "Step coverage",
  distance: "Distance coverage",
  active_calories: "Active energy coverage",
  workouts: "Workout-metric coverage",
  heart_rate: "Heart-rate coverage",
};

const PREVIEW_KIND_LABEL: Record<RetrospectivePhysiologyRecordKind, string> = {
  workout: "Workout",
  steps: "Steps",
  distance: "Distance",
  elevation_gained: "Elevation gained",
  active_calories: "Active energy",
  heart_rate: "Heart rate",
  workout_power: "Workout power",
  workout_speed: "Workout speed",
  walking_cadence: "Walking cadence",
  cycling_cadence: "Cycling cadence",
};

const ADDITIVE_INTERVAL_LABEL: Partial<
  Record<RetrospectivePhysiologyRecordKind, string>
> = {
  steps: "step",
  distance: "distance",
  elevation_gained: "elevation-gain",
  active_calories: "active-energy",
};

function rounded(value: number, digits = 0) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: digits,
  });
}

function recordValue(record: RetrospectivePhysiologyRecord) {
  if (record.kind === "workout") {
    return record.workoutTitle ?? "Workout";
  }
  const value = record.value!;
  if (record.kind === "steps") return `${rounded(value)} steps`;
  if (record.kind === "distance")
    return formatDistance(value, getRuntimeRegionalDefaults());
  if (record.kind === "elevation_gained")
    return `${formatElevation(value, getRuntimeRegionalDefaults())} gained`;
  if (record.kind === "active_calories")
    return formatEnergy(value, getRuntimeRegionalDefaults());
  if (record.kind === "heart_rate") return `${rounded(value)} bpm`;
  if (record.kind === "workout_power") return `${rounded(value)} W`;
  if (record.kind === "workout_speed")
    return formatSpeed(value, getRuntimeRegionalDefaults());
  if (record.kind === "walking_cadence") {
    return `${rounded(value)} steps/min`;
  }
  return `${rounded(value)} rpm`;
}

function timestampLabel(record: RetrospectivePhysiologyRecord) {
  if (record.end === record.start) return formatTime(record.start);
  const end =
    toDateKey(record.end) === toDateKey(record.start)
      ? formatTime(record.end)
      : `${formatShortDate(toDateKey(record.end))} at ${formatTime(record.end)}`;
  return `${formatTime(record.start)}–${end}`;
}

function previewRecords(records: readonly RetrospectivePhysiologyRecord[]) {
  const chosen: RetrospectivePhysiologyRecord[] = [];
  for (const kind of RETROSPECTIVE_PHYSIOLOGY_RECORD_KINDS) {
    const record = records.find((candidate) => candidate.kind === kind);
    if (record) chosen.push(record);
    if (chosen.length === MAX_EVIDENCE_PREVIEWS) break;
  }
  for (const record of records) {
    if (chosen.length === MAX_EVIDENCE_PREVIEWS) break;
    if (!chosen.some(({ id }) => id === record.id)) chosen.push(record);
  }
  return chosen.map((record): EvidenceRecordPreview => ({
    id: record.id,
    kind: "health-metric",
    timestamp: record.start,
    primary:
      record.kind === "workout"
        ? recordValue(record)
        : `${PREVIEW_KIND_LABEL[record.kind]} · ${recordValue(record)}`,
    secondary: `${record.sourceLabel} · ${timestampLabel(record)}`,
    sourceId: `health-connect:${record.sourcePackage}`,
  }));
}

function average(records: readonly RetrospectivePhysiologyRecord[]) {
  return (
    records.reduce((sum, record) => sum + (record.value ?? 0), 0) /
    records.length
  );
}

function sampleSummary(
  records: readonly RetrospectivePhysiologyRecord[],
  label: string,
  unit: string,
  digits = 0,
) {
  const values = records.map((record) => record.value!);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span =
    minimum === maximum
      ? `${rounded(minimum, digits)} ${unit}`
      : `${rounded(minimum, digits)}–${rounded(maximum, digits)} ${unit}`;
  return `${rounded(records.length)} ${label} sample${records.length === 1 ? "" : "s"}: ${span}${
    records.length === 1
      ? ""
      : ` (average ${rounded(average(records), digits)} ${unit})`
  }`;
}

function fullyInsideActivity(
  record: RetrospectivePhysiologyRecord,
  activity: ActivityEvent,
) {
  return record.start >= activity.start && record.end <= activityEnd(activity);
}

function aggregateSummary(
  records: readonly RetrospectivePhysiologyRecord[],
  activity: ActivityEvent,
) {
  const included = records.filter((record) =>
    fullyInsideActivity(record, activity),
  );
  if (!included.length) return undefined;
  if (hasOverlappingIntervals(included)) return undefined;
  const value = included.reduce((sum, record) => sum + record.value!, 0);
  const kind = records[0]!.kind;
  if (kind === "steps") return `${rounded(value)} steps`;
  if (kind === "distance")
    return `${formatDistance(value, getRuntimeRegionalDefaults())} distance`;
  if (kind === "elevation_gained") {
    return `${formatElevation(value, getRuntimeRegionalDefaults())} elevation gained`;
  }
  return `${formatEnergy(value, getRuntimeRegionalDefaults())} active energy`;
}

function hasOverlappingIntervals(
  records: readonly RetrospectivePhysiologyRecord[],
) {
  const sorted = [...records].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  let previous: RetrospectivePhysiologyRecord | undefined;
  let furthestEnd = Number.NEGATIVE_INFINITY;
  for (const record of sorted) {
    const duplicatePoint =
      previous !== undefined &&
      previous.start === previous.end &&
      record.start === record.end &&
      previous.start === record.start;
    if (duplicatePoint || record.start < furthestEnd) return true;
    if (record.end > furthestEnd) furthestEnd = record.end;
    previous = record;
  }
  return false;
}

function sourceSentence(
  sourceLabel: string,
  records: readonly RetrospectivePhysiologyRecord[],
  activity: ActivityEvent,
) {
  const parts: string[] = [];
  const workouts = records.filter(({ kind }) => kind === "workout");
  for (const workout of workouts.slice(0, 1)) {
    parts.push(
      `the overlapping workout as “${workout.workoutTitle ?? activity.title}”${
        workout.perceivedExertion === undefined
          ? ""
          : ` with perceived exertion ${rounded(workout.perceivedExertion, 1)}/10`
      }`,
    );
  }
  for (const kind of [
    "steps",
    "distance",
    "elevation_gained",
    "active_calories",
  ] as const) {
    const matching = records.filter((record) => record.kind === kind);
    const summary = aggregateSummary(matching, activity);
    if (summary) parts.push(summary);
  }
  const heartRate = records.filter(({ kind }) => kind === "heart_rate");
  if (heartRate.length) {
    parts.push(sampleSummary(heartRate, "heart-rate", "bpm"));
  }
  const power = records.filter(({ kind }) => kind === "workout_power");
  if (power.length) parts.push(sampleSummary(power, "power", "W"));
  const speed = records.filter(({ kind }) => kind === "workout_speed");
  if (speed.length) parts.push(sampleSummary(speed, "speed", "m/s", 1));
  const walkingCadence = records.filter(
    ({ kind }) => kind === "walking_cadence",
  );
  if (walkingCadence.length) {
    parts.push(sampleSummary(walkingCadence, "walking-cadence", "steps/min"));
  }
  const cyclingCadence = records.filter(
    ({ kind }) => kind === "cycling_cadence",
  );
  if (cyclingCadence.length) {
    parts.push(sampleSummary(cyclingCadence, "cycling-cadence", "rpm"));
  }
  return parts.length
    ? `${sourceLabel} recorded ${parts.join("; ")} during the activity.`
    : undefined;
}

function coverageSentence(coverage: RetrospectivePhysiologyCoverage) {
  const label = COVERAGE_LABEL[coverage.category];
  if (coverage.status === "current") return undefined;
  if (coverage.status === "missing") {
    return `${label} was missing: a recent successful Health Connect sync had no selected-source record overlapping this activity.`;
  }
  if (coverage.status === "stale") {
    return `${label} was stale: the category has not synced successfully recently, so stored evidence may be incomplete.`;
  }
  if (coverage.status === "unsynced") {
    return `${label} was unsynced: there is no successful local sync for that selected category.`;
  }
  if (coverage.status === "disabled") {
    return `${label} was disabled in T1 Arc, so it was not used in this review.`;
  }
  if (coverage.reason === "needs-source") {
    return `${label} was unavailable because multiple overlapping Health Connect sources were present without one selected source.`;
  }
  if (coverage.reason === "preference-unavailable") {
    return `${label} was unavailable because its local Health Connect category preference was not available.`;
  }
  if (coverage.reason === "candidate-limit") {
    return `${label} was unavailable because the bounded read reached its safety limit before source completeness could be established.`;
  }
  return `${label} was unavailable because its local Health Connect evidence could not be loaded.`;
}

function coverageDescription(
  coverage: readonly RetrospectivePhysiologyCoverage[],
) {
  return coverage
    .map((item) => `${COVERAGE_LABEL[item.category]} ${item.status}`)
    .join("; ");
}

export interface RetrospectivePhysiologyPresentation {
  sentences: string[];
  limitations: string[];
  evidenceDescription: string;
  previews: EvidenceRecordPreview[];
}

export function presentRetrospectivePhysiology(
  physiology: RetrospectivePhysiology,
  activity: ActivityEvent,
): RetrospectivePhysiologyPresentation {
  const allLoadFailed =
    physiology.coverage.length > 0 &&
    physiology.coverage.every(
      ({ status, reason }) =>
        status === "unavailable" && reason === "load-failed",
    );
  const bySource = new Map<string, RetrospectivePhysiologyRecord[]>();
  for (const record of physiology.records) {
    const key = `${record.sourceLabel}\u0000${record.sourcePackage}`;
    const records = bySource.get(key) ?? [];
    records.push(record);
    bySource.set(key, records);
  }
  const sentences = physiology.truncated
    ? [
        `Health Connect physiology reached its ${rounded(RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT)}-record safety limit, so no physiology totals, ranges or averages are presented as complete.`,
      ]
    : [...bySource.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([key, records]) => {
          const sentence = sourceSentence(
            key.split("\u0000")[0]!,
            records,
            activity,
          );
          return sentence ? [sentence] : [];
        });
  if (allLoadFailed) {
    sentences.push(
      "Physiology coverage was unavailable because the local Health Connect evidence could not be loaded.",
    );
  } else {
    sentences.push(
      ...physiology.coverage.flatMap((coverage) => {
        const sentence = coverageSentence(coverage);
        return sentence ? [sentence] : [];
      }),
    );
  }

  const limitations = [
    "Health Connect physiology values are overlapping recorded observations only; they do not establish cause and are not a basis for insulin, carbohydrate, medication or exercise changes.",
  ];
  const additiveKinds = new Set<RetrospectivePhysiologyRecordKind>([
    "steps",
    "distance",
    "elevation_gained",
    "active_calories",
  ]);
  const partial = physiology.records.filter(
    (record) =>
      additiveKinds.has(record.kind) && !fullyInsideActivity(record, activity),
  );
  if (partial.length) {
    const labels = [
      ...new Set(
        partial.map(({ kind }) => PREVIEW_KIND_LABEL[kind].toLowerCase()),
      ),
    ];
    limitations.push(
      `${rounded(partial.length)} ${labels.join("/")} record${partial.length === 1 ? "" : "s"} partly overlapped the activity and ${partial.length === 1 ? "was" : "were"} not totalled or prorated.`,
    );
  }
  const additiveGroups = new Map<string, RetrospectivePhysiologyRecord[]>();
  for (const record of physiology.records) {
    if (
      !additiveKinds.has(record.kind) ||
      !fullyInsideActivity(record, activity)
    ) {
      continue;
    }
    const key = `${record.sourcePackage}\u0000${record.sourceLabel}\u0000${record.kind}`;
    const records = additiveGroups.get(key) ?? [];
    records.push(record);
    additiveGroups.set(key, records);
  }
  for (const [key, records] of additiveGroups) {
    if (!hasOverlappingIntervals(records)) continue;
    const [, sourceLabel, kind] = key.split("\u0000");
    limitations.push(
      `${rounded(records.length)} overlapping ${ADDITIVE_INTERVAL_LABEL[kind as RetrospectivePhysiologyRecordKind] ?? "additive"} intervals from ${sourceLabel} were kept as evidence and not totalled or prorated.`,
    );
  }
  const alternateCoverage = physiology.coverage.filter(
    ({ alternateSources }) => alternateSources?.length,
  );
  for (const coverage of alternateCoverage) {
    const alternates = [...coverage.alternateSources!].sort(
      (left, right) =>
        left.sourceLabel.localeCompare(right.sourceLabel) ||
        left.sourcePackage.localeCompare(right.sourcePackage),
    );
    const visible = alternates.slice(0, 3);
    const count = alternates.reduce(
      (sum, source) => sum + source.recordCount,
      0,
    );
    const label = COVERAGE_LABEL[coverage.category];
    const selectedSource =
      coverage.selectedSourceLabel ?? coverage.selectedSourcePackage;
    const candidateRecords = `${rounded(count)} overlapping candidate record${count === 1 ? "" : "s"} from ${visible.map(({ sourceLabel }) => sourceLabel).join(", ")}${alternates.length > visible.length ? ` and ${rounded(alternates.length - visible.length)} additional source${alternates.length - visible.length === 1 ? "" : "s"}` : ""}`;
    if (coverage.status === "disabled") {
      limitations.push(
        `${label} was disabled; ${candidateRecords} ${count === 1 ? "was" : "were"} not used.`,
      );
    } else if (coverage.reason === "needs-source") {
      limitations.push(
        `${label} had no selected source; ${candidateRecords} ${count === 1 ? "was" : "were"} kept separate and not used.`,
      );
    } else if (coverage.recordCount > 0 && selectedSource) {
      limitations.push(
        `${label} used ${selectedSource}; ${candidateRecords} ${count === 1 ? "was" : "were"} kept separate and not combined.`,
      );
    } else if (selectedSource) {
      limitations.push(
        `${label} selected ${selectedSource}, but no matching record was used; ${candidateRecords} ${count === 1 ? "was" : "were"} kept separate and not combined.`,
      );
    } else {
      limitations.push(
        `${label} did not use a source; ${candidateRecords} ${count === 1 ? "was" : "were"} kept separate and not used.`,
      );
    }
  }
  if (physiology.truncated) {
    limitations.unshift(
      `The local physiology query returned more than ${rounded(RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT)} allowlisted candidate rows; only the first ${rounded(RETROSPECTIVE_PHYSIOLOGY_CANDIDATE_LIMIT)} candidates were examined, numerical summaries were suppressed, and the evidence retains IDs only for sanitized selected-source records actually used.`,
    );
  }
  const visibleCount = Math.min(
    MAX_EVIDENCE_PREVIEWS,
    physiology.records.length,
  );
  return {
    sentences,
    limitations,
    evidenceDescription: `${rounded(physiology.records.length)} sanitized, allowlisted Health Connect record${physiology.records.length === 1 ? "" : "s"} strictly overlapped the selected activity. The preview shows ${rounded(visibleCount)} of ${rounded(physiology.records.length)}; all ${rounded(physiology.records.length)} record IDs are retained in the evidence. Coverage: ${coverageDescription(physiology.coverage)}.${physiology.truncated ? " The safety limit was reached, so numerical summaries were suppressed." : ""}`,
    previews: previewRecords(physiology.records),
  };
}
