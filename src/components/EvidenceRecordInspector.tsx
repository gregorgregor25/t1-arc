import Ionicons from "@expo/vector-icons/Ionicons";
import { AskTarvisButton } from './AskTarvisButton';
import { createTarvisEventEntry, createTarvisPeriodEntry, createTarvisHealthEntry } from '@/domain/tarvisEntry';
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EvidenceReference } from "@/domain/insights";
import { DailyMetricRecord } from "@/domain/dailyHealthMetrics";
import { TimelineData } from "@/domain/models";
import {
  getDailyHealthMetricSnapshot,
  getHealthMetricRecordsByIds,
} from "@/data/healthConnect/dailyHealthMetrics";
import { SqliteGlucoseHistoryStore } from "@/data/persistence/SqliteGlucoseHistoryStore";
import { SqliteHealthRecordStore } from "@/data/persistence/SqliteHealthRecordStore";
import { ImportRawRecord } from "@/data/persistence/HealthRecordStore";
import { formatGlookoPumpScheduleSegment } from "@/data/glooko/glookoReportPresentation";
import { formatDate, formatTime, toDateKey } from "@/domain/time";
import { evidenceTimeZoneLabel } from "@/domain/evidenceTimeZonePresentation";
import { formatGlucose, formatRegionalNumber } from "@/domain/regionalFormat";
import type { T1ArcRegionalDefaults } from "@/domain/regionalProfile";
import {
  NotificationEventStore,
  type TimestampedNotificationIob,
} from "@/data/notification/NotificationEventStore";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { RecordList } from "./RecordList";
import { HealthMetricRecordList } from "./HealthMetricRecordList";
import { FoodDiaryCard } from "./FoodDiaryCard";
import { EvidenceGlucoseOverlay } from "./EvidenceGlucoseOverlay";
import { EvidenceClockWindowOverlay } from "./EvidenceClockWindowOverlay";
import { EvidenceQueryChart } from "./EvidenceQueryChart";
import { resolveEvidenceInspectorVisualization } from "./evidenceInspectorVisualization";
import {
  collectEvidenceRecordIds,
  EvidenceRequestSnapshot,
  evidenceRequestKey,
  evidenceResolutionValue,
  evidenceSnapshotForRequest,
  nextEvidenceVisibleCount,
  shouldShowEvidencePagination,
} from "./evidenceResolutionPresentation";
import { notificationIobEvidenceRows } from "./notificationIobEvidencePresentation";
import { FullscreenChartModal } from "./FullscreenChart";
import { useFoodLogs } from "@/hooks/useFoodLogs";

interface Props {
  evidence?: EvidenceReference;
  onClose(): void;
}

interface RecordLoadResult {
  data?: TimelineData;
  error?: string;
  failed: boolean;
  healthRecords: DailyMetricRecord[];
  notificationIobRecords: TimestampedNotificationIob[];
  sourceRecords: ImportRawRecord[];
}

interface VisualLoadResult {
  error?: string;
  glucose?: TimelineData["glucose"];
  loading: boolean;
}

function timelineIds(
  data: TimelineData,
  healthRecords: DailyMetricRecord[],
  sourceRecords: ImportRawRecord[],
  notificationIobRecords: TimestampedNotificationIob[],
) {
  return collectEvidenceRecordIds({
    timelineIds: [
      ...data.glucose.map((record) => record.id),
      ...data.basal.map((record) => record.id),
      ...data.boluses.map((record) => record.id),
      ...(data.dailyInsulinTotals ?? []).map((record) => record.id),
      ...data.context.map((record) => record.id),
    ],
    healthMetricIds: healthRecords.map((record) => record.id),
    sourceRecordIds: sourceRecords.map((record) => record.id),
    notificationIobIds: notificationIobRecords.map((record) => record.id),
  });
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

function sentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function EvidenceRecordInspector({ evidence, onClose }: Props) {
  const evidenceKey = evidence
    ? `${evidence.id}:${evidence.range.start}:${evidence.range.end}:${evidence.recordIds.join("\u001f")}`
    : "closed";
  return (
    <EvidenceRecordInspectorContent
      evidence={evidence}
      key={evidenceKey}
      onClose={onClose}
    />
  );
}

function EvidenceRecordInspectorContent({ evidence, onClose }: Props) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { dataMode, repository, revision } = useDataContext();
  const [recordSnapshot, setRecordSnapshot] =
    useState<EvidenceRequestSnapshot<RecordLoadResult>>();
  const [visualSnapshot, setVisualSnapshot] =
    useState<EvidenceRequestSnapshot<VisualLoadResult>>();
  const [visibleCount, setVisibleCount] = useState(100);
  const [view, setView] = useState<"visual" | "records">("visual");
  const [visualExpanded, setVisualExpanded] = useState(false);
  const foodHistory = useFoodLogs({
    start: evidence?.range.start ?? 0,
    end: evidence?.range.end ?? 1,
  });
  const {
    exactQueryWithoutVisualization,
    visualization,
    visualizationOmission,
  } = useMemo(
    () => resolveEvidenceInspectorVisualization(evidence),
    [evidence],
  );
  const clockVisualization =
    visualization?.kind === "recurring-clock-overlay-v1"
      ? visualization
      : undefined;
  const queryVisualization =
    visualization && visualization.kind !== "recurring-clock-overlay-v1"
      ? visualization
      : undefined;
  const savedVisualization = Boolean(clockVisualization || queryVisualization);
  const requestedRecordIds = evidence?.recordIds.slice(0, visibleCount) ?? [];
  const recordRequestKey = evidence
    ? evidenceRequestKey({
        dataMode,
        evidenceId: evidence.id,
        purpose: "records",
        range: evidence.range,
        recordIds: requestedRecordIds,
        revision,
      })
    : undefined;
  const visualRequestKey = evidence
    ? evidenceRequestKey({
        dataMode,
        evidenceId: evidence.id,
        purpose: "visual",
        range: evidence.range,
        recordIds: evidence.recordIds,
        revision,
      })
    : undefined;
  const visibleRecordSnapshot = evidenceSnapshotForRequest(
    recordSnapshot,
    recordRequestKey,
    repository,
  );
  const visibleVisualSnapshot = evidenceSnapshotForRequest(
    visualSnapshot,
    visualRequestKey,
    repository,
  );
  const data = visibleRecordSnapshot?.data;
  const healthRecords = visibleRecordSnapshot?.healthRecords ?? [];
  const notificationIobRecords =
    visibleRecordSnapshot?.notificationIobRecords ?? [];
  const sourceRecords = visibleRecordSnapshot?.sourceRecords ?? [];
  const recordError = visibleRecordSnapshot?.error;
  const recordLoadFailed = visibleRecordSnapshot?.failed ?? false;
  const visualGlucose = visibleVisualSnapshot?.glucose;
  const visualError = visibleVisualSnapshot?.error;
  const displayRange = useMemo(() => {
    if (!queryVisualization?.windows.length) return evidence?.range;
    return queryVisualization.windows.reduce(
      (range, window) => ({
        end: Math.max(range.end, window.range.end),
        start: Math.min(range.start, window.range.start),
      }),
      {
        end: queryVisualization.windows[0]!.range.end,
        start: queryVisualization.windows[0]!.range.start,
      },
    );
  }, [evidence?.range, queryVisualization]);

  const hasGlucoseEvidence = Boolean(
    savedVisualization ||
    exactQueryWithoutVisualization ||
    evidence?.examples.some((example) => example.kind === "glucose") ||
    data?.glucose.length,
  );
  const needsGenericVisual = Boolean(
    evidence &&
      view === "visual" &&
      hasGlucoseEvidence &&
      !savedVisualization &&
      !exactQueryWithoutVisualization,
  );
  const visualLoading =
    needsGenericVisual && (visibleVisualSnapshot?.loading ?? true);

  useEffect(() => {
    let active = true;
    if (!evidence || !visualRequestKey || !needsGenericVisual) {
      return () => {
        active = false;
      };
    }
    const requestOwner = repository;
    void new SqliteGlucoseHistoryStore()
      .getReadingsByIds(evidence.recordIds)
      .then((readings) => {
        if (!active) return;
        setVisualSnapshot({
          key: visualRequestKey,
          owner: requestOwner,
          value: { glucose: readings, loading: false },
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setVisualSnapshot({
          key: visualRequestKey,
          owner: requestOwner,
          value: {
            error:
              reason instanceof Error
                ? reason.message
                : "The glucose visualisation could not be loaded.",
            loading: false,
          },
        });
      });
    return () => {
      active = false;
    };
  }, [
    evidence,
    exactQueryWithoutVisualization,
    hasGlucoseEvidence,
    needsGenericVisual,
    repository,
    savedVisualization,
    visualRequestKey,
    view,
  ]);

  useEffect(() => {
    let active = true;
    if (
      !evidence ||
      !recordRequestKey ||
      (!repository && dataMode !== "live")
    ) {
      return () => {
        active = false;
      };
    }
    const requestOwner = repository;
    const visibleRecordIds = evidence.recordIds.slice(0, visibleCount);
    const load =
      dataMode === "live"
        ? Promise.all([
            new SqliteGlucoseHistoryStore().getReadingsByIds(visibleRecordIds),
            new SqliteHealthRecordStore().getRecordsByIds(visibleRecordIds),
            getHealthMetricRecordsByIds(visibleRecordIds),
            new SqliteHealthRecordStore().getRawSourceRecordsByIds(
              visibleRecordIds,
            ),
            new NotificationEventStore().getTimestampedIobByIds(
              visibleRecordIds,
            ),
          ]).then(([glucose, health, metrics, raw, notificationIob]) => ({
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
            notificationIobRecords: notificationIob,
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
            notificationIobRecords: [],
            sourceRecords: [],
          }));
    void load
      .then(
        ({
          timeline,
          healthRecords: loadedHealthRecords,
          notificationIobRecords: loadedNotificationIobRecords,
          sourceRecords: loadedSourceRecords,
        }) => {
          if (!active) return;
          setRecordSnapshot({
            key: recordRequestKey,
            owner: requestOwner,
            value: {
              data: timeline,
              failed: false,
              healthRecords: loadedHealthRecords,
              notificationIobRecords: loadedNotificationIobRecords,
              sourceRecords: loadedSourceRecords,
            },
          });
        },
      )
      .catch((reason: unknown) => {
        if (!active) return;
        setRecordSnapshot((previous) => {
          const previousValue = evidenceSnapshotForRequest(
            previous,
            recordRequestKey,
            requestOwner,
          );
          return {
            key: recordRequestKey,
            owner: requestOwner,
            value: {
              data: previousValue?.data,
              error:
                reason instanceof Error
                  ? reason.message
                  : "The supporting records could not be loaded.",
              failed: true,
              healthRecords: previousValue?.healthRecords ?? [],
              notificationIobRecords:
                previousValue?.notificationIobRecords ?? [],
              sourceRecords: previousValue?.sourceRecords ?? [],
            },
          };
        });
      });
    return () => {
      active = false;
    };
  }, [dataMode, evidence, recordRequestKey, repository, visibleCount]);

  const loadedResolution = (() => {
    if (!data || !evidence) return undefined;
    const available = timelineIds(
      data,
      healthRecords,
      sourceRecords,
      notificationIobRecords,
    );
    const requested = new Set(evidence.recordIds.slice(0, visibleCount));
    const resolved = [...requested].filter((id) => available.has(id)).length;
    return { checked: requested.size, resolved };
  })();

  const referencedHealthRecords = (() => {
    if (!evidence) return [];
    const requested = new Set(evidence.recordIds);
    return healthRecords.filter((record) => requested.has(record.id));
  })();
  const hasReferencedTimelineRecords = (() => {
    if (!data || !evidence) return false;
    const available = timelineRecordIds(data);
    return evidence.recordIds.some((id) => available.has(id));
  })();
  const referencedMeals = (() => {
    if (!data || !evidence) return [];
    const requested = new Set(evidence.recordIds);
    return data.context.filter(
      (record) => record.kind === "meal" && requested.has(record.id),
    );
  })();
  const referencedFoodLogs = (() => {
    if (!evidence) return [];
    const requested = new Set(evidence.recordIds);
    return foodHistory.logs.filter((log) => requested.has(log.contextEventId));
  })();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={Boolean(evidence)}
    >
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
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
            <Text
              numberOfLines={1}
              style={[styles.headerTitle, { color: colors.text }]}
            >
              {evidence?.label ?? "Supporting records"}
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
                backgroundColor: pressed ? colors.surfaceMuted : "transparent",
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
              <AskTarvisButton onOpen={onClose} entry={() => {
                const selectedEvent = evidence.recordIds.length === 1 ? data?.context.find(event => evidence.recordIds[0] === event.id) : undefined;
                if (selectedEvent) return createTarvisEventEntry(selectedEvent);
                return evidence.calculation || evidence.examples.some(record => record.kind === 'glucose')
                  ? createTarvisPeriodEntry(evidence.range, evidence.label)
                  : createTarvisHealthEntry(evidence.range, evidence.label);
              }} />
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
                  <Text
                    style={[
                      styles.explainerBody,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {sentence(evidence.description)} Every saved record used for
                    this answer is shown below.
                  </Text>
                </View>
              </View>
              <View
                style={[styles.summaryRow, { borderColor: colors.divider }]}
              >
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {loadedResolution
                      ? formatRegionalNumber(
                          loadedResolution.resolved,
                          regional.locale,
                          { maximumFractionDigits: 0 },
                        )
                      : evidenceResolutionValue(
                          loadedResolution,
                          recordLoadFailed,
                        )}
                  </Text>
                  <Text
                    style={[
                      styles.summaryLabel,
                      { color: colors.textTertiary },
                    ]}
                  >
                    SHOWN
                  </Text>
                </View>
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {formatRegionalNumber(
                      evidence.recordIds.length,
                      regional.locale,
                      { maximumFractionDigits: 0 },
                    )}
                  </Text>
                  <Text
                    style={[
                      styles.summaryLabel,
                      { color: colors.textTertiary },
                    ]}
                  >
                    USED
                  </Text>
                </View>
                <View style={styles.summaryDates}>
                  <Text
                    style={[
                      styles.summaryDate,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {formatDate(
                      toDateKey(displayRange?.start ?? evidence.range.start),
                      {
                        day: "numeric",
                        month: "short",
                      },
                    )}
                    {" – "}
                    {formatDate(
                      toDateKey((displayRange?.end ?? evidence.range.end) - 1),
                      {
                        day: "numeric",
                        month: "short",
                      },
                    )}
                  </Text>
                  <Text
                    style={[
                      styles.summaryLabel,
                      { color: colors.textTertiary },
                    ]}
                  >
                    {evidenceTimeZoneLabel(regional.timeZone)}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {recordError &&
          !data &&
          !savedVisualization &&
          !exactQueryWithoutVisualization ? (
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
                {recordError}
              </Text>
            </View>
          ) : (!data &&
              !savedVisualization &&
              !exactQueryWithoutVisualization) ||
            !evidence ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text
                style={[styles.loadingText, { color: colors.textSecondary }]}
              >
                Resolving exact record IDs…
              </Text>
            </View>
          ) : (
            <>
              {hasGlucoseEvidence ? (
                <View
                  accessibilityRole="tablist"
                  style={[
                    styles.viewControl,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  {(["visual", "records"] as const).map((option) => (
                    <Pressable
                      key={option}
                      accessibilityLabel={
                        option === "visual" ? "Visualise data" : "All records"
                      }
                      accessibilityHint={
                        option === "records"
                          ? "Opens the complete text alternative containing every exact supporting record."
                          : "Opens the saved query-specific chart."
                      }
                      accessibilityRole="tab"
                      accessibilityState={{ selected: view === option }}
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
                          option === "visual"
                            ? "analytics-outline"
                            : "list-outline"
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
                        {option === "visual" ? "Visualise data" : "All records"}
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
                  <Text
                    style={[styles.stateText, { color: colors.textSecondary }]}
                  >
                    {loadedResolution.checked - loadedResolution.resolved}{" "}
                    loaded record ID
                    {loadedResolution.checked - loadedResolution.resolved === 1
                      ? ""
                      : "s"}{" "}
                    could not be resolved. This claim should be treated as
                    incomplete until the source history is restored.
                  </Text>
                </View>
              ) : null}
              {recordError ? (
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
                  <Text
                    style={[styles.stateText, { color: colors.textSecondary }]}
                  >
                    {recordError} The saved visual remains available, but the
                    exact records could not be opened.
                  </Text>
                </View>
              ) : null}
              {view === "visual" && hasGlucoseEvidence ? (
                queryVisualization ? (
                  <EvidenceQueryChart
                    onExpand={() => setVisualExpanded(true)}
                    onShowRecords={() => setView("records")}
                    visualization={queryVisualization}
                  />
                ) : clockVisualization ? (
                  <EvidenceClockWindowOverlay
                    aggregatePoints={clockVisualization.aggregatePoints}
                    coverageSummary={clockVisualization.coverageSummary}
                    domain={clockVisualization.domain}
                    minimumAggregateContributors={
                      clockVisualization.minimumAggregateContributors
                    }
                    missingOccurrenceLabels={
                      clockVisualization.missingOccurrenceLabels
                    }
                    onExpand={() => setVisualExpanded(true)}
                    subtitle={clockVisualization.subtitle}
                    targetRange={clockVisualization.targetRange}
                    targetRangePolicy={clockVisualization.targetRangePolicy}
                    title={clockVisualization.title}
                    traceSemantics={clockVisualization.traceSemantics}
                    units={clockVisualization.units}
                    valueDomain={clockVisualization.valueDomain}
                    windows={clockVisualization.windows}
                    overallMeanMmolL={clockVisualization.overallMeanMmolL}
                  />
                ) : exactQueryWithoutVisualization ? (
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
                    <Text
                      style={[
                        styles.stateText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {visualizationOmission
                        ? `This evidence chart needed ${formatRegionalNumber(visualizationOmission.sourcePointCount, regional.locale, { maximumFractionDigits: 0 })} display vertices, above the safe on-phone limit of ${formatRegionalNumber(visualizationOmission.maximumDisplayPoints, regional.locale, { maximumFractionDigits: 0 })}, so it was omitted to keep the app responsive. Every exact calculation record remains available in All records.`
                        : "This exact calculation does not contain a query-specific chart. No generic day overlay is shown, because it could imply the wrong hours. Use All records for the exact evidence."}
                    </Text>
                  </View>
                ) : visualError ? (
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
                    <Text
                      style={[
                        styles.stateText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {visualError} The exact records are still available in All
                      records.
                    </Text>
                  </View>
                ) : visualLoading || !visualGlucose ? (
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
              ) : data && hasReferencedTimelineRecords ? (
                <>
                  {referencedMeals.length ? (
                    <>
                      <FoodDiaryCard
                        events={referencedMeals}
                        logs={referencedFoodLogs}
                        readOnly
                      />
                      {foodHistory.error ? (
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
                          <Text
                            style={[
                              styles.stateText,
                              { color: colors.textSecondary },
                            ]}
                          >
                            Exact saved food details could not be checked. The
                            meal summary above is retained from its timeline
                            record.
                          </Text>
                        </View>
                      ) : null}
                    </>
                  ) : null}
                  <RecordList
                    data={data}
                    emptyMessage="None of the referenced records could be resolved locally."
                    filter="all"
                    headerTitle="All supporting records"
                    recordIds={evidence.recordIds}
                    visibleCount={visibleCount}
                    onShowMore={() => setVisibleCount((count) => count + 100)}
                  />
                </>
              ) : null}
              {(savedVisualization || exactQueryWithoutVisualization) &&
              !data &&
              !recordError &&
              view === "records" ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text
                    style={[
                      styles.loadingText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Resolving exact record IDs...
                  </Text>
                </View>
              ) : null}
              <HealthMetricRecordList
                initiallyExpanded
                records={referencedHealthRecords}
              />
              <NotificationIobEvidenceRecordList
                records={notificationIobRecords}
              />
              <SourceEvidenceRecordList records={sourceRecords} />
              {evidence &&
              shouldShowEvidencePagination({
                dataMode,
                hasReferencedTimelineRecords,
                totalCount: evidence.recordIds.length,
                visibleCount,
              }) ? (
                <Pressable
                  accessibilityLabel="Show more supporting records"
                  accessibilityRole="button"
                  onPress={() =>
                    setVisibleCount((count) =>
                      nextEvidenceVisibleCount(
                        count,
                        evidence.recordIds.length,
                      ),
                    )
                  }
                  style={({ pressed }) => [
                    styles.evidenceMoreButton,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.evidenceMoreButtonText,
                      { color: colors.primary },
                    ]}
                  >
                    Show more supporting records
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>
        <FullscreenChartModal
          detail={
            queryVisualization?.subtitle ??
            clockVisualization?.subtitle ??
            "Up to seven days overlaid in local time"
          }
          onClose={() => setVisualExpanded(false)}
          title={
            queryVisualization?.title ??
            clockVisualization?.title ??
            "Day-to-day glucose"
          }
          visible={
            visualExpanded &&
            Boolean(queryVisualization || clockVisualization || visualGlucose)
          }
        >
          {queryVisualization ? (
            <EvidenceQueryChart expanded visualization={queryVisualization} />
          ) : clockVisualization ? (
            <EvidenceClockWindowOverlay
              aggregatePoints={clockVisualization.aggregatePoints}
              coverageSummary={clockVisualization.coverageSummary}
              domain={clockVisualization.domain}
              expanded
              minimumAggregateContributors={
                clockVisualization.minimumAggregateContributors
              }
              missingOccurrenceLabels={
                clockVisualization.missingOccurrenceLabels
              }
              subtitle={clockVisualization.subtitle}
              targetRange={clockVisualization.targetRange}
              targetRangePolicy={clockVisualization.targetRangePolicy}
              title={clockVisualization.title}
              traceSemantics={clockVisualization.traceSemantics}
              units={clockVisualization.units}
              valueDomain={clockVisualization.valueDomain}
              windows={clockVisualization.windows}
              overallMeanMmolL={clockVisualization.overallMeanMmolL}
            />
          ) : visualGlucose ? (
            <EvidenceGlucoseOverlay expanded readings={visualGlucose} />
          ) : null}
        </FullscreenChartModal>
      </SafeAreaView>
    </Modal>
  );
}

function sourceRecordNumber(
  record: ImportRawRecord,
  key: string,
  value: number,
  regional: T1ArcRegionalDefaults,
) {
  if (
    record.recordKind === "pump-settings" &&
    [
      "minimumBgForBolusCalculationMmolL",
      "glucoseHighAlertLimitMmolL",
      "glucoseLowAlertLimitMmolL",
    ].includes(key)
  ) {
    return formatGlucose(value, regional);
  }
  const numeric = formatRegionalNumber(value, regional.locale, {
    maximumFractionDigits: 2,
  });
  if (/Percent$/.test(key)) return `${numeric}%`;
  if (/durationMinutes$/i.test(key)) return `${numeric} minutes`;
  return numeric;
}

function sourceRecordRows(
  record: ImportRawRecord,
  regional: T1ArcRegionalDefaults,
) {
  try {
    const payload = JSON.parse(record.payloadJson) as Record<string, unknown>;
    const ignored = new Set(["reportStart", "reportEnd"]);
    return Object.entries(payload)
      .filter(([key, value]) => !ignored.has(key) && value !== undefined)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          const schedule = value
            .map((segment) => {
              if (typeof segment !== "object" || segment === null) return "";
              const item = segment as Record<string, unknown>;
              if (
                record.recordKind === "pump-settings" &&
                typeof item.startTime === "string" &&
                typeof item.value === "number" &&
                (item.unit === "U/h" ||
                  item.unit === "g/U" ||
                  item.unit === "mmol/L")
              ) {
                return formatGlookoPumpScheduleSegment(
                  {
                    durationMinutes:
                      typeof item.durationMinutes === "number"
                        ? item.durationMinutes
                        : 0,
                    startTime: item.startTime,
                    unit: item.unit,
                    value: item.value,
                  },
                  regional,
                );
              }
              return `${String(item.startTime ?? "")} ${String(
                item.value ?? "",
              )} ${String(item.unit ?? "")}`.trim();
            })
            .filter(Boolean)
            .join(", ");
          return [key, schedule || "None"] as const;
        }
        if (typeof value === "boolean") {
          return [key, value ? "On" : "Off"] as const;
        }
        if (typeof value === "number") {
          return [key, sourceRecordNumber(record, key, value, regional)] as const;
        }
        return [key, String(value)] as const;
      });
  } catch {
    return [
      ["Saved details", "The original details could not be displayed."],
    ] as const;
  }
}

function sourceRecordLabel(kind: string) {
  if (kind === "pump-mode-summary") return "Omnipod operating modes";
  if (kind === "pump-mode-daily") return "Daily Omnipod operating modes";
  if (kind === "pump-state-interval") return "Timed Omnipod pump state";
  if (kind === "pump-settings") return "Omnipod settings snapshot";
  return kind.replace(/[-_]+/g, " ");
}

function SourceEvidenceRecordList({ records }: { records: ImportRawRecord[] }) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
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
            {sourceRecordRows(record, regional).map(([label, value]) => (
              <View key={label} style={styles.sourceRecordRow}>
                <Text
                  style={[
                    styles.sourceRecordLabel,
                    { color: colors.textTertiary },
                  ]}
                >
                  {label.replace(/([a-z])([A-Z])/g, "$1 $2")}
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

function NotificationIobEvidenceRecordList({
  records,
}: {
  records: TimestampedNotificationIob[];
}) {
  const { colors, radius } = useAppTheme();
  const rows = notificationIobEvidenceRows(records);
  if (!rows.length) return null;
  return (
    <View style={styles.sourceRecords}>
      <Text style={[styles.sourceRecordsTitle, { color: colors.text }]}>
        Notification-reported IOB evidence
      </Text>
      {rows.map((row) => (
        <View
          key={row.id}
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
              name="water-outline"
              size={18}
            />
            <View style={styles.sourceRecordHeaderCopy}>
              <Text style={[styles.sourceRecordTitle, { color: colors.text }]}>
                {row.title}
              </Text>
              <Text
                style={[
                  styles.sourceRecordMeta,
                  { color: colors.textTertiary },
                ]}
              >
                Recorded {formatDate(toDateKey(row.capturedAt))} at{' '}
                {formatTime(row.capturedAt)}
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.sourceRecordRows,
              { borderTopColor: colors.divider },
            ]}
          >
            {[
              ['Reported IOB', row.iobLabel],
              ['Source', row.sourceId],
              ['Package', row.packageName],
              ['Record ID', row.id],
              ['Provenance', row.provenance],
            ].map(([label, value]) => (
              <View key={label} style={styles.sourceRecordRow}>
                <Text
                  style={[
                    styles.sourceRecordLabel,
                    { color: colors.textTertiary },
                  ]}
                >
                  {label}
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "800",
    marginTop: 2,
  },
  close: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
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
    fontWeight: "800",
  },
  evidenceMoreButton: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  evidenceMoreButtonText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  sourceRecord: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  sourceRecordHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  sourceRecordHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceRecordTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
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
    fontWeight: "800",
    letterSpacing: 0.35,
    textTransform: "uppercase",
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
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  shield: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  explainerCopy: {
    flex: 1,
  },
  explainerTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
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
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 18,
  },
  summaryMetric: {
    minWidth: 54,
  },
  summaryValue: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  summaryLabel: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.65,
    marginTop: 1,
  },
  summaryDates: {
    flex: 1,
    alignItems: "flex-end",
  },
  summaryDate: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  loading: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
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
    flexDirection: "row",
    alignItems: "flex-start",
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
    flexDirection: "row",
    gap: 5,
  },
  viewOption: {
    flex: 1,
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  viewOptionText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
});
