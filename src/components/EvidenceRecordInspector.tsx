import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EvidenceReference } from '@/domain/insights';
import { DailyMetricRecord } from '@/domain/dailyHealthMetrics';
import { TimelineData } from '@/domain/models';
import { getDailyHealthMetricSnapshot } from '@/data/healthConnect/dailyHealthMetrics';
import { getHealthMetricRecordsByIds } from '@/data/healthConnect/dailyHealthMetrics';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { ImportRawRecord } from '@/data/persistence/HealthRecordStore';
import { formatDate, toDateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { RecordList } from './RecordList';
import { HealthMetricRecordList } from './HealthMetricRecordList';
import { FoodDiaryCard } from './FoodDiaryCard';
import { EvidenceGlucoseOverlay } from './EvidenceGlucoseOverlay';
import { FullscreenChartModal } from './FullscreenChart';
import { useFoodLogs } from '@/hooks/useFoodLogs';

interface Props {
  evidence?: EvidenceReference;
  onClose(): void;
}

function timelineIds(
  data: TimelineData,
  healthRecords: DailyMetricRecord[],
  sourceRecords: ImportRawRecord[],
) {
  return new Set([
    ...data.glucose.map((record) => record.id),
    ...data.basal.map((record) => record.id),
    ...data.boluses.map((record) => record.id),
    ...(data.dailyInsulinTotals ?? []).map((record) => record.id),
    ...data.context.map((record) => record.id),
    ...healthRecords.map((record) => record.id),
    ...sourceRecords.map((record) => record.id),
  ]);
}

function timelineRecordIds(data: TimelineData) {
  return new Set([
    ...data.glucose.map((record) => record.id),
    ...data.basal.map((record) => record.id),
    ...data.boluses.map((record) => record.id),
    ...(data.dailyInsulinTotals ?? []).map((record) => record.id),
    ...data.context.map((record) => record.id),
  ]);
}

export function EvidenceRecordInspector({ evidence, onClose }: Props) {
  const { colors, radius } = useAppTheme();
  const { dataMode, repository, revision } = useDataContext();
  const [data, setData] = useState<TimelineData>();
  const [healthRecords, setHealthRecords] = useState<
    DailyMetricRecord[]
  >([]);
  const [sourceRecords, setSourceRecords] = useState<ImportRawRecord[]>([]);
  const [error, setError] = useState<string>();
  const [visibleCount, setVisibleCount] = useState(100);
  const [view, setView] = useState<'visual' | 'records'>('visual');
  const [visualExpanded, setVisualExpanded] = useState(false);
  const [visualGlucose, setVisualGlucose] = useState<
    TimelineData['glucose']
  >();
  const [visualLoading, setVisualLoading] = useState(false);
  const foodHistory = useFoodLogs({
    start: evidence?.range.start ?? 0,
    end: evidence?.range.end ?? 1,
  });

  useEffect(() => {
    setVisibleCount(100);
    setView('visual');
    setVisualExpanded(false);
    setVisualGlucose(undefined);
  }, [evidence]);

  const hasGlucoseEvidence = Boolean(
    evidence?.examples.some((example) => example.kind === 'glucose') ||
      data?.glucose.length,
  );

  useEffect(() => {
    let active = true;
    if (!evidence || view !== 'visual' || !hasGlucoseEvidence) {
      return () => {
        active = false;
      };
    }
    setVisualLoading(true);
    void new SqliteGlucoseHistoryStore()
      .getReadingsByIds(evidence.recordIds)
      .then((readings) => {
        if (active) setVisualGlucose(readings);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'The glucose visualisation could not be loaded.',
        );
      })
      .finally(() => {
        if (active) setVisualLoading(false);
      });
    return () => {
      active = false;
    };
  }, [evidence, hasGlucoseEvidence, view]);

  useEffect(() => {
    let active = true;
    setData(undefined);
    setHealthRecords([]);
    setSourceRecords([]);
    setError(undefined);
    if (!evidence || (!repository && dataMode !== 'live')) {
      return () => {
        active = false;
      };
    }
    const visibleRecordIds = evidence.recordIds.slice(0, visibleCount);
    const load =
      dataMode === 'live'
        ? Promise.all([
            new SqliteGlucoseHistoryStore().getReadingsByIds(
              visibleRecordIds,
            ),
            new SqliteHealthRecordStore().getRecordsByIds(visibleRecordIds),
            getHealthMetricRecordsByIds(visibleRecordIds),
            new SqliteHealthRecordStore().getRawSourceRecordsByIds(
              visibleRecordIds,
            ),
          ]).then(([glucose, health, metrics, raw]) => ({
            timeline: {
              range: evidence.range,
              glucose,
              basal: health.basal,
              boluses: health.boluses,
              dailyInsulinTotals: health.dailyInsulinTotals,
              context: health.context,
              sources: [],
            } satisfies TimelineData,
            healthRecords: metrics,
            sourceRecords: raw,
          }))
        : Promise.all([
            repository!.getTimeline(evidence.range),
            getDailyHealthMetricSnapshot(evidence.range),
          ]).then(([timeline, health]) => ({
            timeline,
            healthRecords: health.records.filter((record) =>
              visibleRecordIds.includes(record.id),
            ),
            sourceRecords: [],
          }));
    void load
      .then(
        ({
          timeline,
          healthRecords: loadedHealthRecords,
          sourceRecords: loadedSourceRecords,
        }) => {
        if (!active) return;
        setData(timeline);
        setHealthRecords(loadedHealthRecords);
        setSourceRecords(loadedSourceRecords);
        },
      )
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'The supporting records could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, [dataMode, evidence, repository, revision, visibleCount]);

  const loadedResolution = useMemo(() => {
    if (!data || !evidence) return undefined;
    const available = timelineIds(data, healthRecords, sourceRecords);
    const requested = new Set(evidence.recordIds.slice(0, visibleCount));
    const resolved = [...requested].filter((id) => available.has(id)).length;
    return { checked: requested.size, resolved };
  }, [data, evidence, healthRecords, sourceRecords, visibleCount]);

  const referencedHealthRecords = useMemo(() => {
    if (!evidence) return [];
    const requested = new Set(evidence.recordIds);
    return healthRecords.filter((record) => requested.has(record.id));
  }, [evidence, healthRecords]);
  const hasReferencedTimelineRecords = useMemo(() => {
    if (!data || !evidence) return false;
    const available = timelineRecordIds(data);
    return evidence.recordIds.some((id) => available.has(id));
  }, [data, evidence]);
  const referencedMeals = useMemo(() => {
    if (!data || !evidence) return [];
    const requested = new Set(evidence.recordIds);
    return data.context.filter(
      (record) => record.kind === 'meal' && requested.has(record.id),
    );
  }, [data, evidence]);
  const referencedFoodLogs = useMemo(() => {
    if (!evidence) return [];
    const requested = new Set(evidence.recordIds);
    return foodHistory.logs.filter((log) =>
      requested.has(log.contextEventId),
    );
  }, [evidence, foodHistory.logs]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={Boolean(evidence)}
    >
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.accent }]}>
              EXACT CALCULATION INPUTS
            </Text>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>
              {evidence?.label ?? 'Supporting records'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close supporting records"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              {
                backgroundColor: pressed
                  ? colors.surfaceMuted
                  : 'transparent',
                borderRadius: radius.pill,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.textSecondary}
              name="close"
              size={25}
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {evidence ? (
            <View
              style={[
                styles.explainer,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <View style={styles.explainerTop}>
                <View
                  style={[
                    styles.shield,
                    {
                      backgroundColor: `${colors.accent}18`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="document-text-outline"
                    size={22}
                  />
                </View>
                <View style={styles.explainerCopy}>
                  <Text style={[styles.explainerTitle, { color: colors.text }]}>
                    No hidden evidence
                  </Text>
                  <Text style={[styles.explainerBody, { color: colors.textSecondary }]}>
                    {evidence.description}. Every record ID used for this claim
                    is resolved against the same normalised local data.
                  </Text>
                </View>
              </View>
              <View style={[styles.summaryRow, { borderColor: colors.divider }]}>
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {loadedResolution?.resolved ?? 0}
                  </Text>
                  <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                    SHOWN
                  </Text>
                </View>
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {evidence.recordIds.length}
                  </Text>
                  <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                    REFERENCED
                  </Text>
                </View>
                <View style={styles.summaryDates}>
                  <Text style={[styles.summaryDate, { color: colors.textSecondary }]}>
                    {formatDate(toDateKey(evidence.range.start), {
                      day: 'numeric',
                      month: 'short',
                    })}
                    {' – '}
                    {formatDate(toDateKey(evidence.range.end - 1), {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </Text>
                  <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                    EUROPE/LONDON
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {error ? (
            <View
              style={[
                styles.stateCard,
                {
                  backgroundColor: `${colors.danger}10`,
                  borderColor: `${colors.danger}55`,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.danger}
                name="alert-circle-outline"
                size={22}
              />
              <Text style={[styles.stateText, { color: colors.textSecondary }]}>
                {error}
              </Text>
            </View>
          ) : !data || !evidence ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Resolving exact record IDs…
              </Text>
            </View>
          ) : (
            <>
              {hasGlucoseEvidence ? (
                <View
                  style={[
                    styles.viewControl,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  {(['visual', 'records'] as const).map((option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      onPress={() => setView(option)}
                      style={[
                        styles.viewOption,
                        view === option && {
                          backgroundColor: colors.surfaceElevated,
                          borderColor: colors.primary,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={
                          view === option
                            ? colors.primary
                            : colors.textSecondary
                        }
                        name={
                          option === 'visual'
                            ? 'analytics-outline'
                            : 'list-outline'
                        }
                        size={18}
                      />
                      <Text
                        style={[
                          styles.viewOptionText,
                          {
                            color:
                              view === option
                                ? colors.primary
                                : colors.textSecondary,
                          },
                        ]}
                      >
                        {option === 'visual'
                          ? 'Visualise data'
                          : 'All records'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {loadedResolution &&
              loadedResolution.resolved < loadedResolution.checked ? (
                <View
                  style={[
                    styles.stateCard,
                    {
                      backgroundColor: `${colors.warning}10`,
                      borderColor: `${colors.warning}55`,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.warning}
                    name="warning-outline"
                    size={22}
                  />
                  <Text style={[styles.stateText, { color: colors.textSecondary }]}>
                    {loadedResolution.checked - loadedResolution.resolved}{' '}
                    loaded
                    record ID
                    {loadedResolution.checked - loadedResolution.resolved === 1
                      ? ''
                      : 's'}{' '}
                    could not be resolved. This claim should be treated as
                    incomplete until the source history is restored.
                  </Text>
                </View>
              ) : null}
              {view === 'visual' && hasGlucoseEvidence ? (
                visualLoading || !visualGlucose ? (
                  <View style={styles.loading}>
                    <ActivityIndicator color={colors.primary} />
                    <Text
                      style={[
                        styles.loadingText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Preparing the comparison…
                    </Text>
                  </View>
                ) : (
                  <EvidenceGlucoseOverlay
                    onExpand={() => setVisualExpanded(true)}
                    readings={visualGlucose}
                  />
                )
              ) : hasReferencedTimelineRecords ? (
                <>
                  {referencedMeals.length ? (
                    <FoodDiaryCard
                      events={referencedMeals}
                      logs={referencedFoodLogs}
                      readOnly
                    />
                  ) : null}
                  <RecordList
                    data={data}
                    emptyMessage="None of the referenced records could be resolved locally."
                    filter="all"
                    headerTitle="All supporting records"
                    recordIds={evidence.recordIds}
                    visibleCount={visibleCount}
                    onShowMore={() =>
                      setVisibleCount((count) => count + 100)
                    }
                  />
                </>
              ) : null}
              <HealthMetricRecordList
                initiallyExpanded
                records={referencedHealthRecords}
              />
              <SourceEvidenceRecordList records={sourceRecords} />
            </>
          )}
        </ScrollView>
        <FullscreenChartModal
          detail="Up to seven days overlaid in Europe/London time"
          onClose={() => setVisualExpanded(false)}
          title="Day-to-day glucose"
          visible={visualExpanded && Boolean(visualGlucose)}
        >
          {visualGlucose ? (
            <EvidenceGlucoseOverlay expanded readings={visualGlucose} />
          ) : null}
        </FullscreenChartModal>
      </SafeAreaView>
    </Modal>
  );
}

function sourceRecordRows(record: ImportRawRecord) {
  try {
    const payload = JSON.parse(record.payloadJson) as Record<string, unknown>;
    const ignored = new Set(['reportStart', 'reportEnd']);
    return Object.entries(payload)
      .filter(([key, value]) => !ignored.has(key) && value !== undefined)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          const schedule = value
            .map((segment) => {
              if (typeof segment !== 'object' || segment === null) return '';
              const item = segment as Record<string, unknown>;
              return `${String(item.startTime ?? '')} ${String(
                item.value ?? '',
              )} ${String(item.unit ?? '')}`.trim();
            })
            .filter(Boolean)
            .join(', ');
          return [key, schedule || 'None'] as const;
        }
        if (typeof value === 'boolean') {
          return [key, value ? 'On' : 'Off'] as const;
        }
        return [key, String(value)] as const;
      });
  } catch {
    return [['Source record', 'The retained payload could not be displayed.']] as const;
  }
}

function sourceRecordLabel(kind: string) {
  if (kind === 'pump-mode-summary') return 'Omnipod operating modes';
  if (kind === 'pump-mode-daily') return 'Daily Omnipod operating modes';
  if (kind === 'pump-state-interval') return 'Timed Omnipod pump state';
  if (kind === 'pump-settings') return 'Omnipod settings snapshot';
  return kind.replace(/[-_]+/g, ' ');
}

function SourceEvidenceRecordList({
  records,
}: {
  records: ImportRawRecord[];
}) {
  const { colors, radius } = useAppTheme();
  if (!records.length) return null;
  return (
    <View style={styles.sourceRecords}>
      <Text style={[styles.sourceRecordsTitle, { color: colors.text }]}>
        Source report evidence
      </Text>
      {records.map((record) => (
        <View
          key={record.id}
          style={[
            styles.sourceRecord,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.lg,
            },
          ]}
        >
          <View style={styles.sourceRecordHeader}>
            <Ionicons
              accessibilityElementsHidden
              color={colors.insulin}
              name="document-text-outline"
              size={18}
            />
            <View style={styles.sourceRecordHeaderCopy}>
              <Text style={[styles.sourceRecordTitle, { color: colors.text }]}>
                {sourceRecordLabel(record.recordKind)}
              </Text>
              <Text
                style={[
                  styles.sourceRecordMeta,
                  { color: colors.textTertiary },
                ]}
              >
                {record.sourceFile}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.sourceRecordRows,
              { borderTopColor: colors.divider },
            ]}
          >
            {sourceRecordRows(record).map(([label, value]) => (
              <View key={label} style={styles.sourceRecordRow}>
                <Text
                  style={[
                    styles.sourceRecordLabel,
                    { color: colors.textTertiary },
                  ]}
                >
                  {label.replace(/([a-z])([A-Z])/g, '$1 $2')}
                </Text>
                <Text
                  selectable
                  style={[
                    styles.sourceRecordValue,
                    { color: colors.textSecondary },
                  ]}
                >
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    minHeight: 74,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
    marginTop: 2,
  },
  close: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 42,
    gap: 14,
  },
  sourceRecords: {
    gap: 10,
  },
  sourceRecordsTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  sourceRecord: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  sourceRecordHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  sourceRecordHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceRecordTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  sourceRecordMeta: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 1,
  },
  sourceRecordRows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    marginTop: 11,
    paddingTop: 11,
  },
  sourceRecordRow: {
    gap: 2,
  },
  sourceRecordLabel: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  sourceRecordValue: {
    fontSize: 11,
    lineHeight: 17,
  },
  explainer: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  explainerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  shield: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerCopy: {
    flex: 1,
  },
  explainerTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  explainerBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  summaryRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 13,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 18,
  },
  summaryMetric: {
    minWidth: 54,
  },
  summaryValue: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.65,
    marginTop: 1,
  },
  summaryDates: {
    flex: 1,
    alignItems: 'flex-end',
  },
  summaryDate: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  loading: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 18,
  },
  stateCard: {
    minHeight: 62,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  viewControl: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 5,
    flexDirection: 'row',
    gap: 5,
  },
  viewOption: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  viewOptionText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
});
