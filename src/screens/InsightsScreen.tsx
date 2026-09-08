import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import type { RootTabParamList } from '@/navigation/AppNavigator';
import { isTarvisEntry, type TarvisEntry } from '@/domain/tarvisEntry';

import { AppScreen, SectionHeading } from "@/components/AppScreen";
import { AppMenuButton } from "@/components/AppMenuButton";
import { DateNavigator } from "@/components/DateNavigator";
import { EmptyState } from "@/components/EmptyState";
import { EvidenceRecordInspector } from "@/components/EvidenceRecordInspector";
import { InsightReviewHistoryCard } from "@/components/InsightReviewHistoryCard";
import { InsightReviewScheduleCard } from "@/components/InsightReviewScheduleCard";
import { LoadingCard } from "@/components/LoadingCard";
import { SafetyNote } from "@/components/SafetyNote";
import { SectionCard } from "@/components/SectionCard";
import { SegmentedControl } from "@/components/SegmentedControl";
import {
  DEFAULT_TARVIS_WORKSPACE,
  TarvisWorkspaceSwitcher,
  type TarvisWorkspace,
} from "@/components/TarvisWorkspaceSwitcher";
import {
  EvidenceReference,
  InsightCategory,
  InsightFinding,
  InsightKind,
} from "@/domain/insights";
import { InsightPeriodDays } from "@/domain/insightRanges";
import { groupInsightFindingsForDashboard } from "@/domain/insightDashboard";
import { TimeRange } from "@/domain/models";
import {
  saveInsightReport,
  SavedInsightReport,
} from "@/data/insights/insightReportRepository";
import {
  addDays,
  dayRange,
  formatDate,
  formatTime,
  toDateKey,
} from "@/domain/time";
import { useInsights } from "@/hooks/useInsights";
import { loadInsightReport, loadInsightReportForRanges } from "@/data/insights/loadInsightReport";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useSavedInsightReports } from "@/hooks/useSavedInsightReports";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import {
  formatGlucose,
  formatRegionalNumber,
  glucoseUnitLabel,
} from "@/domain/regionalFormat";
import { TarvisScreen } from "@/screens/TarvisScreen";
import { loadRetrospectivePhysiology } from "@/data/tarvis/retrospectivePhysiology";
import { createRetrospectiveIobLoader } from "@/data/tarvis/retrospectiveIobLoader";
import { useAppTheme } from "@/theme/theme";
import {
  resolveInsightRequestPresentation,
  resolveInsightReviewAccess,
  resolveTarvisLaunchContext,
  resolveLiveTarvisLaunchContext,
} from "@/data/tarvis/conversationScope";

type InsightPeriodChoice = "3" | "7" | "14" | "30";

const CATEGORY_ICON: Record<InsightCategory, keyof typeof Ionicons.glyphMap> = {
  glucose: "pulse-outline",
  insulin: "water-outline",
  food: "restaurant-outline",
  sleep: "moon-outline",
  activity: "walk-outline",
  heart: "heart-outline",
  weight: "scale-outline",
  body: "body-outline",
  vitals: "pulse-outline",
  hydration: "water-outline",
  medication: "medical-outline",
  context: "document-text-outline",
  "data-quality": "shield-checkmark-outline",
};

function kindLabel(kind: InsightKind) {
  switch (kind) {
    case "observation":
      return "OBSERVED CHANGE";
    case "context-clue":
      return "CONTEXT TO INSPECT";
    case "limitation":
      return "DATA LIMITATION";
  }
}

function EvidenceBlock({
  evidence,
  onInspectRecords,
}: {
  evidence: EvidenceReference;
  onInspectRecords(): void;
}) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const recordCount = formatRegionalNumber(
    evidence.recordIds.length,
    regional.locale,
    { maximumFractionDigits: 0 },
  );
  return (
    <View style={[styles.evidenceBlock, { borderColor: colors.divider }]}>
      <View style={styles.evidenceHeader}>
        <Text style={[styles.evidenceLabel, { color: colors.text }]}>
          {evidence.label}
        </Text>
        <Text style={[styles.evidenceCount, { color: colors.textTertiary }]}>
          {recordCount} records in calculation
        </Text>
      </View>
      <Text
        style={[styles.evidenceDescription, { color: colors.textSecondary }]}
      >
        {evidence.description} ·{" "}
        {formatDate(toDateKey(evidence.range.start), {
          day: "numeric",
          month: "short",
        })}
        {" – "}
        {formatDate(toDateKey(evidence.range.end - 1), {
          day: "numeric",
          month: "short",
        })}
      </Text>
      {evidence.examples.map((record) => (
        <View key={record.id} style={styles.exampleRow}>
          <Text style={[styles.exampleTime, { color: colors.textTertiary }]}>
            {formatTime(record.timestamp)}
          </Text>
          <View style={styles.exampleCopy}>
            <Text style={[styles.examplePrimary, { color: colors.text }]}>
              {record.primary}
            </Text>
            <Text
              style={[styles.exampleSecondary, { color: colors.textSecondary }]}
            >
              {record.secondary} · {record.sourceId}
            </Text>
            <Text
              numberOfLines={1}
              selectable
              style={[styles.exampleId, { color: colors.textTertiary }]}
            >
              ID {record.id}
            </Text>
          </View>
        </View>
      ))}
      <Pressable
        accessibilityLabel={`Open all ${recordCount} records used for ${evidence.label}`}
        accessibilityRole="button"
        onPress={onInspectRecords}
        style={({ pressed }) => [
          styles.openRecordsButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.divider,
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="list-outline"
          size={17}
        />
        <Text style={[styles.openRecordsText, { color: colors.primary }]}>
          Open all {recordCount} records used
        </Text>
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="chevron-forward"
          size={16}
        />
      </Pressable>
    </View>
  );
}

function FindingCard({
  finding,
  expanded,
  onToggle,
  onInspectRecords,
  onAskTarvis,
  highlighted,
}: {
  finding: InsightFinding;
  expanded: boolean;
  onToggle(): void;
  onInspectRecords(evidence: EvidenceReference): void;
  onAskTarvis(): void;
  highlighted: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const tone =
    finding.kind === "limitation"
      ? colors.warning
      : finding.kind === "context-clue"
        ? colors.insulin
        : colors.glucose;
  return (
    <SectionCard
      style={[
        styles.findingCard,
        highlighted && {
          borderColor: `${tone}99`,
          backgroundColor: colors.surfaceMuted,
        },
      ]}
    >
      <Pressable
        accessibilityLabel={`${finding.title}. ${kindLabel(finding.kind)}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.findingTrigger,
          { opacity: pressed ? 0.68 : 1 },
        ]}
      >
        <View style={[styles.findingIcon, { backgroundColor: `${tone}16` }]}>
          <Ionicons
            accessibilityElementsHidden
            color={tone}
            name={CATEGORY_ICON[finding.category]}
            size={21}
          />
        </View>
        <View style={styles.findingCopy}>
          <Text style={[styles.findingKind, { color: tone }]}>
            {kindLabel(finding.kind)}
          </Text>
          <Text style={[styles.findingTitle, { color: colors.text }]}>
            {finding.title}
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={expanded ? colors.primary : colors.textTertiary}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
        />
      </Pressable>
      {expanded ? (
        <View style={[styles.findingBody, { borderColor: colors.divider }]}>
          <Text style={[styles.findingSummary, { color: colors.textSecondary }]}>
            {finding.summary}
          </Text>
          {finding.caveat ? (
            <Text style={[styles.caveat, { color: colors.textTertiary }]}>
              {finding.caveat}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onAskTarvis}
            style={({ pressed }) => [
              styles.askTarvisButton,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons accessibilityElementsHidden color={colors.accent} name="sparkles-outline" size={18} />
            <Text style={[styles.askTarvisText, { color: colors.text }]}>Ask Tarv1s about this</Text>
            <Ionicons accessibilityElementsHidden color={colors.textTertiary} name="arrow-forward" size={17} />
          </Pressable>
          <View style={styles.evidenceStack}>
            {finding.evidence.map((evidence) => (
              <EvidenceBlock
                key={evidence.id}
                evidence={evidence}
                onInspectRecords={() => onInspectRecords(evidence)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </SectionCard>
  );
}

function RetryErrorCard({
  actionLabel,
  message,
  onRetry,
}: {
  actionLabel: string;
  message: string;
  onRetry(): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <SectionCard>
      <View style={styles.retryErrorContent}>
        <Ionicons
          accessibilityElementsHidden
          color={colors.danger}
          name="alert-circle-outline"
          size={24}
        />
        <View style={styles.retryErrorCopy}>
          <Text style={[styles.retryErrorTitle, { color: colors.text }]}>
            Data unavailable
          </Text>
          <Text
            style={[styles.retryErrorMessage, { color: colors.textSecondary }]}
          >
            {message}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="refresh-outline"
              size={17}
            />
            <Text style={[styles.retryButtonText, { color: colors.primary }]}>
              {actionLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </SectionCard>
  );
}

export function InsightsScreen() {
  const route = useRoute<RouteProp<RootTabParamList, 'Insights'>>();
  const navigation = useNavigation<NavigationProp<RootTabParamList, 'Insights'>>();
  const [entryContext, setEntryContext] = useState<TarvisEntry>();
  const { defaults: regional } = useRegionalProfile();
  const { colors, radius } = useAppTheme();
  const {
    dataMode,
    earliestDate,
    now,
    ownerIdentity,
    repository,
    ready,
    refreshData,
    syncing,
    today,
  } = useDataContext();
  const latestCompleteDate = addDays(today, -1);
  const [periodChoice, setPeriodChoice] = useState<InsightPeriodChoice>("7");
  const periodDays = Number(periodChoice) as InsightPeriodDays;
  const [comparisonEndDate, setComparisonEndDate] =
    useState(latestCompleteDate);
  const [workspace, setWorkspace] = useState<TarvisWorkspace>(
    DEFAULT_TARVIS_WORKSPACE,
  );
  const prepareInsights =
    workspace === 'insights' ||
    dataMode !== 'live' ||
    comparisonEndDate !== latestCompleteDate;
  const insightState = useInsights(periodDays, comparisonEndDate, prepareInsights);
  const loadTarvisDefaultReport = useCallback(async () => {
    if (!repository) throw new Error('Your local health data is not ready yet.');
    return loadInsightReport({
      repository, dataMode, periodDays, comparisonEndDate, now,
    });
  }, [repository, dataMode, periodDays, comparisonEndDate, now]);
  const loadTarvisGlucoseReadings = useCallback(
    async (range: TimeRange) => {
      if (!repository) {
        throw new Error("Your local glucose data is not ready yet.");
      }
      return (await repository.getTimeline(range)).glucose;
    },
    [repository],
  );
  const loadTarvisTimelineData = useCallback(
    async (range: TimeRange) => {
      if (!repository) {
        throw new Error("Your local health data is not ready yet.");
      }
      return repository.getTimeline(range);
    },
    [repository],
  );
  const loadTarvisPhysiology = useCallback(
    (request: Parameters<typeof loadRetrospectivePhysiology>[0]) =>
      loadRetrospectivePhysiology({ ...request, asOf: now }),
    [now],
  );
  const loadTarvisTimestampedIob = useMemo(
    () => createRetrospectiveIobLoader(dataMode),
    [dataMode],
  );
  const loadTarvisReportForRange = useCallback(
    async (
      currentRange: TimeRange,
      previousRange: TimeRange,
      generatedAt: number,
    ) => {
      if (!repository) {
        throw new Error("Your local health data is not ready yet.");
      }
      return loadInsightReportForRanges({
        repository, dataMode, currentRange, previousRange, generatedAt,
      });
    },
    [repository, dataMode],
  );
  const {
    error: reviewHistoryError,
    loading: reviewHistoryLoading,
    markViewed: markReviewViewed,
    reload: reloadReviewHistory,
    reports: savedReviewReports,
  } = useSavedInsightReports(prepareInsights);
  const scrollViewRef = useRef<ScrollView>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [allFindingsVisible, setAllFindingsVisible] = useState(false);
  const [confidenceVisible, setConfidenceVisible] = useState(false);
  const [periodControlsVisible, setPeriodControlsVisible] = useState(false);
  const [tarvisDraft, setTarvisDraft] = useState<string>();
  const [selectedReview, setSelectedReview] = useState<SavedInsightReport>();
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceReference>();
  const clearTarvisEntry = useCallback(() => {
    setEntryContext(undefined);
    setTarvisDraft(undefined);
  }, []);
  const restoreTarvisEntry = useCallback((entry: TarvisEntry) => {
    if (entry.ownerIdentity !== ownerIdentity) return;
    setEntryContext(entry);
    setTarvisDraft(entry.question);
  }, [ownerIdentity]);
  useEffect(() => {
    const entry = route.params?.entry;
    if (entry === undefined) return;
    // Consume rejected commands too, so a later owner switch cannot replay them.
    navigation.setParams({ entry: undefined });
    if (!isTarvisEntry(entry) || entry.ownerIdentity !== ownerIdentity) return;
    // Explicit, one-shot navigation command; never sends a question automatically.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWorkspace('tarvis');
    setSelectedReview(undefined);
    setSelectedEvidence(undefined);
    setComparisonEndDate(latestCompleteDate);
    setEntryContext(entry);
    setTarvisDraft(entry.question);
  }, [route.params?.entry, navigation, latestCompleteDate, ownerIdentity]);
  const requestedRangeEnd = dayRange(comparisonEndDate, now).end;
  const cachedReport = savedReviewReports.find(
    (saved) =>
      Math.round(
        (saved.report.currentRange.end - saved.report.currentRange.start) /
          86_400_000,
      ) === periodDays && saved.report.currentRange.end === requestedRangeEnd,
  )?.report;
  const activeReport =
    selectedReview?.report ?? insightState.report ?? cachedReport;
  const hasGlucoseEvidence = Boolean(
    activeReport &&
    activeReport.current.glucoseReadings +
      activeReport.previous.glucoseReadings >
      0,
  );
  const isLatestRollingWeek =
    periodDays === 7 && comparisonEndDate === latestCompleteDate;
  const activeReviewId =
    selectedReview?.id ??
    (isLatestRollingWeek && activeReport
      ? `rolling-week:${activeReport.currentRange.end}`
      : undefined);
  const activePeriodDays = activeReport
    ? Math.max(
        1,
        Math.round(
          (activeReport.currentRange.end - activeReport.currentRange.start) /
            86_400_000,
        ),
      )
    : periodDays;
  const tarvisContext = useMemo(
    () =>
      activeReport
        ? resolveTarvisLaunchContext({
            dataMode,
            isLatestCompletePeriod:
              !selectedReview && comparisonEndDate === latestCompleteDate,
            now,
            ownerIdentity,
            report: activeReport,
            reviewId: selectedReview?.id,
          })
        : ready && repository
          ? resolveLiveTarvisLaunchContext({
              dataMode,
              isLatestCompletePeriod: !selectedReview && comparisonEndDate === latestCompleteDate,
              now,
              ownerIdentity,
              reviewId: selectedReview?.id,
            })
          : undefined,
    [
      activeReport,
      comparisonEndDate,
      dataMode,
      latestCompleteDate,
      now,
      ownerIdentity,
      selectedReview,
      ready,
      repository,
    ],
  );
  const activeRequest = resolveInsightRequestPresentation({
    error: insightState.error,
    hasSelectedReview: Boolean(selectedReview),
    loading: insightState.loading,
  });
  const reviewAccess = resolveInsightReviewAccess({
    dataMode,
    historyError: reviewHistoryError,
    historyLoading: reviewHistoryLoading,
    savedReviewCount: savedReviewReports.length,
  });

  useFocusEffect(
    useCallback(() => {
      setWorkspace(DEFAULT_TARVIS_WORKSPACE);
    }, []),
  );

  const findings = useMemo(() => activeReport?.findings ?? [], [activeReport]);
  const dashboardFindings = useMemo(
    () => groupInsightFindingsForDashboard(findings),
    [findings],
  );
  const reviewFindings = [
    ...dashboardFindings.changes,
    ...dashboardFindings.context,
  ];
  const confidenceFindings = dashboardFindings.confidence;
  const visibleChanges = allFindingsVisible
    ? dashboardFindings.changes
    : dashboardFindings.changes.slice(0, 3);
  const visibleContext = allFindingsVisible
    ? dashboardFindings.context
    : dashboardFindings.context.slice(0, 3);

  useEffect(() => {
    if (dataMode !== "live") {
      // Demo/replay mode must discard a live saved-review selection so it can
      // never reappear as evidence in the non-live workspace.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedReview(undefined);
      return;
    }
    const currentSaved = savedReviewReports.find(
      (report) => report.id === activeReviewId,
    );
    if (currentSaved && !currentSaved.viewedAt) {
      void markReviewViewed(currentSaved.id);
    }
  }, [
    activeReviewId,
    dataMode,
    markReviewViewed,
    savedReviewReports,
  ]);

  useEffect(() => {
    if (
      dataMode !== "live" ||
      !isLatestRollingWeek ||
      !insightState.report ||
      !insightState.report.ready
    ) {
      return;
    }
    void saveInsightReport(insightState.report)
      .then(() => reloadReviewHistory())
      .catch(() => undefined);
  }, [
    dataMode,
    isLatestRollingWeek,
    insightState.report,
    reloadReviewHistory,
  ]);

  function selectReview(report: SavedInsightReport) {
    setPeriodChoice("7");
    setComparisonEndDate(toDateKey(report.report.currentRange.end - 1));
    setSelectedReview(report);
    setExpanded(new Set());
    setSelectedEvidence(undefined);
    void markReviewViewed(report.id);
  }

  function resetComparisonState() {
    setSelectedReview(undefined);
    setExpanded(new Set());
    setSelectedEvidence(undefined);
    setConfidenceVisible(false);
    setAllFindingsVisible(false);
  }

  function choosePeriod(next: InsightPeriodChoice) {
    setPeriodChoice(next);
    resetComparisonState();
  }

  function chooseEndDate(next: typeof comparisonEndDate) {
    setComparisonEndDate(next);
    resetComparisonState();
  }

  function toggleFinding(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTarvisForFinding(finding: InsightFinding) {
    clearTarvisEntry();
    setTarvisDraft(`Help me understand this insight: ${finding.title}`);
    setWorkspace("tarvis");
  }

  function changeWorkspace(next: TarvisWorkspace) {
    clearTarvisEntry();
    setWorkspace(next);
  }

  const compactHeader = (
    <View style={styles.compactHeader}>
      <AppMenuButton />
      <View style={styles.compactHeaderCopy}>
        <Text
          accessibilityRole="header"
          style={[styles.compactHeaderTitle, { color: colors.text }]}
        >
          {workspace === "tarvis" ? "Tarv1s" : "Insights"}
        </Text>
        <Text
          style={[styles.compactHeaderSubtitle, { color: colors.textTertiary }]}
        >
          {workspace === "tarvis" ? "Your health companion" : "Your personal briefing"}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Open weekly reviews"
        accessibilityRole="button"
        onPress={() => {
          clearTarvisEntry();
          setWorkspace("insights");
          setReviewsVisible(true);
        }}
        style={({ pressed }) => [styles.compactHeaderAction, { opacity: pressed ? 0.55 : 1 }]}
      >
        <Ionicons accessibilityElementsHidden color={colors.textSecondary} name="calendar-outline" size={21} />
      </Pressable>
    </View>
  );

  const handleNestedBack = useCallback(() => {
    if (selectedReview) {
      setSelectedReview(undefined);
      return;
    }
    if (allFindingsVisible) {
      setAllFindingsVisible(false);
      return;
    }
    if (reviewsVisible) {
      setReviewsVisible(false);
    }
  }, [allFindingsVisible, reviewsVisible, selectedReview]);
  useAndroidBack(
    workspace === "insights" &&
      Boolean(selectedReview || allFindingsVisible || reviewsVisible),
    handleNestedBack,
  );

  if (workspace === "tarvis") {
    if (tarvisContext) {
      return (
        <>
          <TarvisScreen
            asOf={tarvisContext.asOf}
            selectionAsOf={now}
            conversationScope={tarvisContext.scope}
            initialQuestion={tarvisDraft}
            entryContext={entryContext}
            onClearEntry={clearTarvisEntry}
            onRestoreEntry={restoreTarvisEntry}
            liveData={tarvisContext.liveData}
            report={activeReport}
            loadDefaultReport={loadTarvisDefaultReport}
            loadGlucoseReadings={loadTarvisGlucoseReadings}
            loadTimelineData={loadTarvisTimelineData}
            loadPhysiologyData={
              tarvisContext.liveData ? loadTarvisPhysiology : undefined
            }
            loadTimestampedIob={
              tarvisContext.liveData ? loadTarvisTimestampedIob : undefined
            }
            loadReportForRange={loadTarvisReportForRange}
            onBack={() => {
              clearTarvisEntry();
              setWorkspace("insights");
            }}
            onInspectEvidence={setSelectedEvidence}
          />
          <EvidenceRecordInspector
            evidence={selectedEvidence}
            onClose={() => setSelectedEvidence(undefined)}
          />
        </>
      );
    }

    return (
      <AppScreen header={compactHeader} title="Tarv1s">
        <TarvisWorkspaceSwitcher
          value="tarvis"
          onChange={changeWorkspace}
        />
        {activeRequest.error ? (
          <RetryErrorCard
            actionLabel="Try opening Tarv1s again"
            message={activeRequest.error}
            onRetry={() => void refreshData()}
          />
        ) : (
          <LoadingCard label="Getting your local records ready for Tarv1s…" />
        )}
      </AppScreen>
    );
  }

  return (
    <>
      <AppScreen
        header={compactHeader}
        title="Insights"
        refreshing={syncing}
        onRefresh={() => void refreshData()}
        scrollViewRef={scrollViewRef}
      >
        <TarvisWorkspaceSwitcher
          value="insights"
          onChange={changeWorkspace}
        />

        <View style={styles.briefingIntro}>
          <Text style={[styles.briefingTitle, { color: colors.text }]}>Things worth knowing</Text>
          <Text style={[styles.briefingDetail, { color: colors.textSecondary }]}>A calm summary of what changed, what may be connected and how complete the records are.</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: periodControlsVisible }}
          onPress={() => setPeriodControlsVisible((visible) => !visible)}
          style={({ pressed }) => [
            styles.periodToggle,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <Ionicons accessibilityElementsHidden color={colors.primary} name="options-outline" size={19} />
          <View style={styles.periodToggleCopy}>
            <Text style={[styles.periodToggleTitle, { color: colors.text }]}>Review period</Text>
            <Text style={[styles.periodToggleDetail, { color: colors.textSecondary }]}>{formatRegionalNumber(periodDays, regional.locale, { maximumFractionDigits: 0 })} days ending {formatDate(comparisonEndDate, { day: "numeric", month: "short" })}</Text>
          </View>
          <Ionicons accessibilityElementsHidden color={colors.textTertiary} name={periodControlsVisible ? "chevron-up" : "chevron-down"} size={19} />
        </Pressable>
        {periodControlsVisible ? (
          <SectionCard style={styles.comparisonCard}>
            <SegmentedControl
              accessibilityLabel="Insight comparison window"
              options={[
                { value: "3", label: "3D" },
                { value: "7", label: "7D" },
                { value: "14", label: "14D" },
                { value: "30", label: "30D" },
              ]}
              value={periodChoice}
              onChange={choosePeriod}
            />
            <View style={styles.periodNavigator}>
              <DateNavigator
                date={comparisonEndDate}
                canGoBack={comparisonEndDate > earliestDate}
                canGoForward={comparisonEndDate < latestCompleteDate}
                onBack={() => chooseEndDate(addDays(comparisonEndDate, -1))}
                onForward={() => chooseEndDate(addDays(comparisonEndDate, 1))}
                onDateChange={chooseEndDate}
                earliestDate={earliestDate}
                latestDate={latestCompleteDate}
                isToday={false}
                caption={comparisonEndDate === latestCompleteDate ? "Latest complete day" : "Period ends"}
              />
            </View>
          </SectionCard>
        ) : null}

        {reviewAccess.showReviewArea ? (
          <View style={styles.reviewArea}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: reviewsVisible }}
              onPress={() => setReviewsVisible((visible) => !visible)}
              style={({ pressed }) => [
                styles.reviewToggle,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                name="calendar-outline"
                size={19}
              />
              <View style={styles.reviewCopy}>
                <Text style={[styles.reviewTitle, { color: colors.text }]}>
                  Weekly reviews
                </Text>
                <Text
                  style={[styles.reviewDetail, { color: colors.textSecondary }]}
                >
                  Schedule and previously saved comparisons
                </Text>
              </View>
              <Ionicons
                accessibilityElementsHidden
                color={colors.textTertiary}
                name={reviewsVisible ? "chevron-up" : "chevron-down"}
                size={18}
              />
            </Pressable>
            {reviewAccess.historyError ? (
              <RetryErrorCard
                actionLabel="Retry saved reviews"
                message={reviewAccess.historyError}
                onRetry={() =>
                  void reloadReviewHistory().catch(() => undefined)
                }
              />
            ) : null}
            {reviewsVisible ? (
              <View style={styles.reviewStack}>
                <InsightReviewScheduleCard />
                {reviewAccess.showHistoryLoading ? (
                  <LoadingCard label="Opening saved review history…" />
                ) : null}
                {reviewAccess.showHistory ? (
                  <InsightReviewHistoryCard
                    reports={savedReviewReports}
                    selectedId={activeReviewId}
                    onSelect={selectReview}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {activeRequest.error ? (
          <RetryErrorCard
            actionLabel="Try comparison again"
            message={activeRequest.error}
            onRetry={() => void refreshData()}
          />
        ) : !activeReport ? (
          <LoadingCard
            label={`Comparing two ${formatRegionalNumber(periodDays, regional.locale, { maximumFractionDigits: 0 })}-day evidence windows…`}
          />
        ) : !hasGlucoseEvidence ? (
          <SectionCard>
            <EmptyState
              title="No glucose evidence yet"
              detail="Connect a glucose source and let the encrypted history build. T1 Arc will not create a comparison or review from an empty record."
            />
          </SectionCard>
        ) : (
          <>
            <SectionCard
              style={[styles.hero, { backgroundColor: colors.surfaceElevated }]}
            >
              <Text style={[styles.heroEyebrow, { color: colors.accent }]}>
                {formatRegionalNumber(activePeriodDays, regional.locale, { maximumFractionDigits: 0 })} days ending{" "}
                {formatDate(toDateKey(activeReport.currentRange.end - 1), {
                  day: "numeric",
                  month: "short",
                })}{" "}
                · compared with the previous {formatRegionalNumber(activePeriodDays, regional.locale, { maximumFractionDigits: 0 })}
              </Text>
              {activeRequest.loading ? (
                <Text style={[styles.updating, { color: colors.textTertiary }]}>
                  Bringing your latest records together…
                </Text>
              ) : null}
              <Text style={[styles.heroTitle, { color: colors.text }]}>
                {activeReport.headline}
              </Text>
              <Text
                style={[styles.heroSummary, { color: colors.textSecondary }]}
              >
                {activeReport.summary}
              </Text>
              <View style={[styles.metricRow, { borderColor: colors.divider }]}>
                <View style={styles.metric}>
                  <Text
                    style={[
                      styles.metricLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Time in range
                  </Text>
                  <Text style={[styles.metricValue, { color: colors.text }]}>
                    {activeReport.current.timeInRangePercent}%
                  </Text>
                  <Text
                    style={[styles.metricDelta, { color: colors.textTertiary }]}
                  >
                    was {activeReport.previous.timeInRangePercent}%
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text
                    style={[
                      styles.metricLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Average glucose
                  </Text>
                  <Text style={[styles.metricValue, { color: colors.text }]}>
                    {activeReport.current.glucoseAverage === undefined || activeReport.current.glucoseAverage === null
                      ? "—"
                      : formatGlucose(activeReport.current.glucoseAverage, regional, { withUnit: false })}
                  </Text>
                  <Text
                    style={[styles.metricDelta, { color: colors.textTertiary }]}
                  >
                    {glucoseUnitLabel(regional.glucoseUnit)} · was{" "}
                    {activeReport.previous.glucoseAverage === undefined || activeReport.previous.glucoseAverage === null
                      ? "—"
                      : formatGlucose(activeReport.previous.glucoseAverage, regional, { withUnit: false })}
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text
                    style={[
                      styles.metricLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Below range
                  </Text>
                  <Text style={[styles.metricValue, { color: colors.text }]}>
                    {activeReport.current.timeBelowPercent}%
                  </Text>
                  <Text
                    style={[styles.metricDelta, { color: colors.textTertiary }]}
                  >
                    was {activeReport.previous.timeBelowPercent}%
                  </Text>
                </View>
                <View style={styles.metric}>
                  <Text
                    style={[
                      styles.metricLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Above range
                  </Text>
                  <Text style={[styles.metricValue, { color: colors.text }]}>
                    {activeReport.current.timeAbovePercent}%
                  </Text>
                  <Text
                    style={[styles.metricDelta, { color: colors.textTertiary }]}
                  >
                    was {activeReport.previous.timeAbovePercent}%
                  </Text>
                </View>
              </View>
            </SectionCard>

            {reviewFindings.length ? (
              <>
                {visibleChanges.length ? (
                  <>
                    <SectionHeading
                      title="Changes worth knowing"
                      detail="The clearest changes in glucose and insulin, ordered by likely usefulness."
                    />
                    <View style={styles.findingStack}>
                      {visibleChanges.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          expanded={expanded.has(finding.id)}
                          highlighted={false}
                          onAskTarvis={() => openTarvisForFinding(finding)}
                          onToggle={() => toggleFinding(finding.id)}
                          onInspectRecords={setSelectedEvidence}
                        />
                      ))}
                    </View>
                  </>
                ) : null}
                {visibleContext.length ? (
                  <>
                    <SectionHeading
                      title="Possible influences"
                      detail="Food, activity, sleep and other recorded context that changed nearby. These are clues, not proven causes."
                    />
                    <View style={styles.findingStack}>
                      {visibleContext.map((finding) => (
                        <FindingCard
                          key={finding.id}
                          finding={finding}
                          expanded={expanded.has(finding.id)}
                          highlighted={false}
                          onAskTarvis={() => openTarvisForFinding(finding)}
                          onToggle={() => toggleFinding(finding.id)}
                          onInspectRecords={setSelectedEvidence}
                        />
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <SectionHeading title="Changes worth knowing" />
                <SectionCard>
                  <Text style={[styles.noReviewTitle, { color: colors.text }]}>
                    No comparable change is ready yet
                  </Text>
                  <Text
                    style={[
                      styles.noReviewDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Data-confidence notes below explain what is preventing a
                    responsible comparison.
                  </Text>
                </SectionCard>
              </>
            )}
            {dashboardFindings.changes.length > 3 ||
            dashboardFindings.context.length > 3 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAllFindingsVisible((visible) => !visible)}
                style={({ pressed }) => [
                  styles.allFindingsButton,
                  {
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.allFindingsText, { color: colors.primary }]}
                >
                  {allFindingsVisible
                    ? "Show the highlights"
                    : `View all ${formatRegionalNumber(reviewFindings.length, regional.locale, { maximumFractionDigits: 0 })} findings`}
                </Text>
              </Pressable>
            ) : null}
            {confidenceFindings.length ? (
              <View style={styles.confidenceSection}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    expanded: confidenceVisible || !reviewFindings.length,
                  }}
                  onPress={() => setConfidenceVisible((visible) => !visible)}
                  style={({ pressed }) => [
                    styles.confidenceButton,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={styles.confidenceButtonCopy}>
                    <Text
                      style={[styles.confidenceTitle, { color: colors.text }]}
                    >
                      Data confidence
                    </Text>
                    <Text
                      style={[
                        styles.confidenceDetail,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {formatRegionalNumber(confidenceFindings.length, regional.locale, { maximumFractionDigits: 0 })} note
                      {confidenceFindings.length === 1 ? "" : "s"} about what
                      the records can support
                    </Text>
                  </View>
                  <Ionicons
                    color={colors.textTertiary}
                    name={
                      confidenceVisible || !reviewFindings.length
                        ? "chevron-up"
                        : "chevron-down"
                    }
                    size={20}
                  />
                </Pressable>
                {confidenceVisible || !reviewFindings.length ? (
                  <View style={styles.findingStack}>
                    {confidenceFindings.map((finding) => (
                      <FindingCard
                        key={finding.id}
                        finding={finding}
                        expanded={expanded.has(finding.id)}
                        highlighted={false}
                        onAskTarvis={() => openTarvisForFinding(finding)}
                        onToggle={() => toggleFinding(finding.id)}
                        onInspectRecords={setSelectedEvidence}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.safety}>
              <SafetyNote />
            </View>
          </>
        )}
      </AppScreen>
      <EvidenceRecordInspector
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(undefined)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  compactHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  compactHeaderCopy: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  compactHeaderTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: -0.25,
  },
  compactHeaderSubtitle: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 1,
  },
  compactHeaderAction: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  briefingIntro: {
    paddingHorizontal: 2,
    paddingTop: 3,
    paddingBottom: 17,
  },
  briefingTitle: {
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "900",
    letterSpacing: -0.55,
  },
  briefingDetail: {
    maxWidth: 540,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  periodToggle: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  periodToggleCopy: { flex: 1 },
  periodToggleTitle: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  periodToggleDetail: { fontSize: 10, lineHeight: 15, marginTop: 1 },
  retryErrorContent: {
    minHeight: 96,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  retryErrorCopy: {
    flex: 1,
  },
  retryErrorTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  retryErrorMessage: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  retryButton: {
    minHeight: 48,
    marginTop: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 7,
  },
  retryButtonText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  tarvisLaunch: {
    minHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 2,
  },
  tarvisIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  tarvisCopy: {
    flex: 1,
  },
  tarvisTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
  },
  tarvisDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  comparisonCard: {
    padding: 12,
    marginBottom: 10,
  },
  periodNavigator: {
    marginTop: 10,
  },
  reviewArea: {
    marginBottom: 12,
    marginTop: 12,
  },
  reviewToggle: {
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  reviewCopy: {
    flex: 1,
  },
  reviewTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  reviewDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  reviewStack: {
    gap: 10,
    marginTop: 10,
  },
  hero: {
    paddingHorizontal: 17,
    paddingTop: 17,
    paddingBottom: 20,
  },
  heroEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  heroTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.45,
    marginTop: 8,
  },
  heroSummary: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  updating: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 5,
  },
  metricRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 20,
    paddingTop: 18,
  },
  metric: {
    flexGrow: 1,
    flexBasis: "44%",
    minWidth: 124,
  },
  metricLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  metricValue: {
    fontSize: 25,
    lineHeight: 32,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  metricDelta: {
    fontSize: 10,
    lineHeight: 15,
  },
  askRow: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 14,
    paddingRight: 5,
  },
  askInput: {
    minHeight: 52,
    flex: 1,
    fontSize: 15,
  },
  askButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  suggestion: {
    minHeight: 38,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  suggestionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "600",
  },
  answerCard: {
    marginTop: 12,
  },
  answerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  answerTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
  },
  answerText: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  answerMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 9,
  },
  findingStack: {
    gap: 12,
  },
  noReviewTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
  },
  noReviewDetail: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 17,
  },
  confidenceSection: {
    gap: 12,
    marginTop: 18,
  },
  confidenceButton: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  confidenceButtonCopy: {
    flex: 1,
    minWidth: 0,
  },
  confidenceTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  confidenceDetail: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 15,
  },
  allFindingsButton: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  allFindingsText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  findingCard: {
    padding: 0,
    overflow: "hidden",
  },
  findingTrigger: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  findingIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  findingCopy: {
    flex: 1,
  },
  findingKind: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  findingTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
    marginTop: 2,
  },
  findingBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 15,
    paddingBottom: 15,
  },
  findingSummary: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  caveat: {
    fontSize: 11,
    lineHeight: 17,
    fontStyle: "italic",
    marginTop: 7,
  },
  askTarvisButton: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 14,
    paddingHorizontal: 12,
  },
  askTarvisText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  evidenceButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  evidenceButtonText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  evidenceStack: {
    gap: 12,
    marginTop: 12,
  },
  evidenceBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  evidenceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  evidenceLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  evidenceCount: {
    fontSize: 10,
    lineHeight: 15,
  },
  evidenceDescription: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  exampleRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 9,
  },
  exampleTime: {
    width: 38,
    fontSize: 10,
    lineHeight: 15,
    fontVariant: ["tabular-nums"],
  },
  exampleCopy: {
    flex: 1,
  },
  examplePrimary: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  exampleSecondary: {
    fontSize: 9,
    lineHeight: 14,
  },
  exampleId: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 2,
  },
  openRecordsButton: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 10,
  },
  openRecordsText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  safety: {
    marginTop: 18,
  },
});
