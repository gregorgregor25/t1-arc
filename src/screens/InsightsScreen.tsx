import Ionicons from '@expo/vector-icons/Ionicons';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { DateNavigator } from '@/components/DateNavigator';
import { ErrorCard } from '@/components/ErrorCard';
import { EmptyState } from '@/components/EmptyState';
import { EvidenceRecordInspector } from '@/components/EvidenceRecordInspector';
import { InsightReviewHistoryCard } from '@/components/InsightReviewHistoryCard';
import { InsightReviewScheduleCard } from '@/components/InsightReviewScheduleCard';
import { LoadingCard } from '@/components/LoadingCard';
import { SafetyNote } from '@/components/SafetyNote';
import { SectionCard } from '@/components/SectionCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  EvidenceReference,
  InsightCategory,
  InsightFinding,
  InsightKind,
} from '@/domain/insights';
import { InsightPeriodDays } from '@/domain/insightRanges';
import { TimeRange } from '@/domain/models';
import {
  saveInsightReport,
  SavedInsightReport,
} from '@/data/insights/insightReportRepository';
import {
  addDays,
  dayRange,
  formatDate,
  formatTime,
  toDateKey,
} from '@/domain/time';
import { useInsights } from '@/hooks/useInsights';
import { loadInsightReport } from '@/data/insights/loadInsightReport';
import { useAndroidBack } from '@/hooks/useAndroidBack';
import { useSavedInsightReports } from '@/hooks/useSavedInsightReports';
import { useDataContext } from '@/providers/DataProvider';
import { TarvisScreen } from '@/screens/TarvisScreen';
import { useAppTheme } from '@/theme/theme';

type InsightPeriodChoice = '3' | '7' | '14' | '30';

const CATEGORY_ICON: Record<
  InsightCategory,
  keyof typeof Ionicons.glyphMap
> = {
  glucose: 'pulse-outline',
  insulin: 'water-outline',
  food: 'restaurant-outline',
  sleep: 'moon-outline',
  activity: 'walk-outline',
  heart: 'heart-outline',
  weight: 'scale-outline',
  body: 'body-outline',
  vitals: 'pulse-outline',
  hydration: 'water-outline',
  medication: 'medical-outline',
  context: 'document-text-outline',
  'data-quality': 'shield-checkmark-outline',
};

function kindLabel(kind: InsightKind) {
  switch (kind) {
    case 'observation':
      return 'OBSERVED CHANGE';
    case 'context-clue':
      return 'CONTEXT TO INSPECT';
    case 'limitation':
      return 'DATA LIMITATION';
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
  return (
    <View style={[styles.evidenceBlock, { borderColor: colors.divider }]}>
      <View style={styles.evidenceHeader}>
        <Text style={[styles.evidenceLabel, { color: colors.text }]}>
          {evidence.label}
        </Text>
        <Text style={[styles.evidenceCount, { color: colors.textTertiary }]}>
          {evidence.recordIds.length} records in calculation
        </Text>
      </View>
      <Text style={[styles.evidenceDescription, { color: colors.textSecondary }]}>
        {evidence.description} ·{' '}
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
        accessibilityLabel={`Open all ${evidence.recordIds.length} exact records for ${evidence.label}`}
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
          Open all {evidence.recordIds.length} exact records
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
  highlighted,
}: {
  finding: InsightFinding;
  expanded: boolean;
  onToggle(): void;
  onInspectRecords(evidence: EvidenceReference): void;
  highlighted: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const tone =
    finding.kind === 'limitation'
      ? colors.warning
      : finding.kind === 'context-clue'
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
      <View style={styles.findingTop}>
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
      </View>
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
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.evidenceButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name={expanded ? 'chevron-up' : 'document-text-outline'}
          size={18}
        />
        <Text style={[styles.evidenceButtonText, { color: colors.primary }]}>
          {expanded
            ? 'Hide supporting records'
            : `Inspect evidence (${finding.evidence.reduce(
                (sum, item) => sum + item.recordIds.length,
                0,
              )})`}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.evidenceStack}>
          {finding.evidence.map((evidence) => (
            <EvidenceBlock
              key={evidence.id}
              evidence={evidence}
              onInspectRecords={() => onInspectRecords(evidence)}
            />
          ))}
        </View>
      ) : null}
    </SectionCard>
  );
}

export function InsightsScreen() {
  const { colors, radius } = useAppTheme();
  const {
    dataMode,
    earliestDate,
    now,
    repository,
    refreshData,
    syncing,
    today,
  } = useDataContext();
  const latestCompleteDate = addDays(today, -1);
  const [periodChoice, setPeriodChoice] =
    useState<InsightPeriodChoice>('7');
  const periodDays = Number(periodChoice) as InsightPeriodDays;
  const [comparisonEndDate, setComparisonEndDate] =
    useState(latestCompleteDate);
  const insightState = useInsights(periodDays, comparisonEndDate);
  const loadTarvisGlucoseReadings = useCallback(
    async (range: TimeRange) => {
      if (!repository) {
        throw new Error('Your local glucose data is not ready yet.');
      }
      return (await repository.getTimeline(range)).glucose;
    },
    [repository],
  );
  const reviewHistory = useSavedInsightReports();
  const scrollViewRef = useRef<ScrollView>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reviewsVisible, setReviewsVisible] = useState(false);
  const [allFindingsVisible, setAllFindingsVisible] = useState(false);
  const [tarvisVisible, setTarvisVisible] = useState(false);
  const [selectedEvidence, setSelectedEvidence] =
    useState<EvidenceReference>();
  const [selectedReview, setSelectedReview] =
    useState<SavedInsightReport>();
  const loadTarvisReportForPeriod = useCallback(
    async (requestedDays: InsightPeriodDays) => {
      if (!repository) {
        throw new Error('Your local health data is not ready yet.');
      }
      const historicalEnd = selectedReview?.report.currentRange.end;
      return loadInsightReport({
        repository,
        dataMode,
        periodDays: requestedDays,
        comparisonEndDate: historicalEnd
          ? toDateKey(historicalEnd - 1)
          : latestCompleteDate,
        now: historicalEnd ?? now,
      });
    },
    [dataMode, latestCompleteDate, now, repository, selectedReview],
  );
  const requestedRangeEnd = dayRange(
    comparisonEndDate,
    Date.now(),
  ).end;
  const cachedReport = reviewHistory.reports.find(
    (saved) =>
      Math.round(
        (saved.report.currentRange.end -
          saved.report.currentRange.start) /
          86_400_000,
      ) === periodDays &&
      saved.report.currentRange.end === requestedRangeEnd,
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

  const findings = useMemo(
    () => activeReport?.findings ?? [],
    [activeReport],
  );
  const visibleFindings = allFindingsVisible
    ? findings
    : findings.slice(0, 3);

  useEffect(() => {
    if (dataMode !== 'live') {
      setSelectedReview(undefined);
      return;
    }
    const currentSaved = reviewHistory.reports.find(
      (report) => report.id === activeReviewId,
    );
    if (currentSaved && !currentSaved.viewedAt) {
      void reviewHistory.markViewed(currentSaved.id);
    }
  }, [
    activeReviewId,
    dataMode,
    reviewHistory.markViewed,
    reviewHistory.reports,
  ]);

  useEffect(() => {
    if (
      dataMode !== 'live' ||
      !isLatestRollingWeek ||
      !insightState.report ||
      !insightState.report.ready
    ) {
      return;
    }
    void saveInsightReport(insightState.report)
      .then(() => reviewHistory.reload())
      .catch(() => undefined);
  }, [
    dataMode,
    isLatestRollingWeek,
    insightState.report,
    reviewHistory.reload,
  ]);

  function selectReview(report: SavedInsightReport) {
    setPeriodChoice('7');
    setComparisonEndDate(toDateKey(report.report.currentRange.end - 1));
    setSelectedReview(report);
    setExpanded(new Set());
    setSelectedEvidence(undefined);
    void reviewHistory.markViewed(report.id);
  }

  function resetComparisonState() {
    setSelectedReview(undefined);
    setExpanded(new Set());
    setSelectedEvidence(undefined);
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
    !tarvisVisible &&
      Boolean(selectedReview || allFindingsVisible || reviewsVisible),
    handleNestedBack,
  );

  if (tarvisVisible && activeReport) {
    return (
      <>
        <TarvisScreen
          asOf={selectedReview?.report.currentRange.end ?? now}
          liveData={dataMode === 'live' && !selectedReview}
          report={activeReport}
          loadGlucoseReadings={loadTarvisGlucoseReadings}
          loadReportForPeriod={loadTarvisReportForPeriod}
          onBack={() => setTarvisVisible(false)}
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
    <>
      <AppScreen
      title="Insights"
      eyebrow="Evidence, not guesses"
      refreshing={syncing}
      onRefresh={() => void refreshData()}
      scrollViewRef={scrollViewRef}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: !activeReport || !hasGlucoseEvidence,
        }}
        disabled={!activeReport || !hasGlucoseEvidence}
        onPress={() => setTarvisVisible(true)}
        style={({ pressed }) => [
          styles.tarvisLaunch,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: `${colors.accent}66`,
            borderRadius: radius.lg,
            opacity:
              !activeReport || !hasGlucoseEvidence
                ? 0.55
                : pressed
                  ? 0.72
                  : 1,
          },
        ]}
      >
        <View
          style={[
            styles.tarvisIcon,
            {
              backgroundColor: `${colors.accent}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="sparkles"
            size={24}
          />
        </View>
        <View style={styles.tarvisCopy}>
          <Text style={[styles.tarvisEyebrow, { color: colors.accent }]}>
            TARV1S
          </Text>
          <Text style={[styles.tarvisTitle, { color: colors.text }]}>
            Ask Tarv1s
          </Text>
          <Text
            style={[styles.tarvisDetail, { color: colors.textSecondary }]}
          >
            Ask naturally about your data, continue the conversation, then
            inspect the records behind every supported claim.
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="arrow-forward"
          size={20}
        />
      </Pressable>

      <SectionHeading
        title="Comparison window"
        detail="One completed period against the same period immediately before it."
      />
      <SectionCard style={styles.comparisonCard}>
        <SegmentedControl
          accessibilityLabel="Insight comparison window"
          options={[
            { value: '3', label: '3D' },
            { value: '7', label: '7D' },
            { value: '14', label: '14D' },
            { value: '30', label: '30D' },
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
            caption={
              comparisonEndDate === latestCompleteDate
                ? 'Latest complete day'
                : 'Period ends'
            }
          />
        </View>
      </SectionCard>

      {dataMode === 'live' && hasGlucoseEvidence ? (
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
              name={reviewsVisible ? 'chevron-up' : 'chevron-down'}
              size={18}
            />
          </Pressable>
          {reviewsVisible ? (
            <View style={styles.reviewStack}>
              <InsightReviewScheduleCard />
              {periodDays === 7 && reviewHistory.reports.length ? (
                <InsightReviewHistoryCard
                  reports={reviewHistory.reports}
                  selectedId={activeReviewId}
                  onSelect={selectReview}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {insightState.error ? (
        <ErrorCard message={insightState.error} />
      ) : !activeReport ? (
        <LoadingCard
          label={`Comparing two ${periodDays}-day evidence windows…`}
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
            style={[
              styles.hero,
              { backgroundColor: colors.surfaceElevated },
            ]}
          >
            <Text style={[styles.heroEyebrow, { color: colors.accent }]}>
              {activePeriodDays} DAYS ENDING{' '}
              {formatDate(
                toDateKey(activeReport.currentRange.end - 1),
                { day: 'numeric', month: 'short' },
              ).toUpperCase()}{' '}
              VS PREVIOUS {activePeriodDays}
            </Text>
            {insightState.loading ? (
              <Text style={[styles.updating, { color: colors.textTertiary }]}>
                Updating with the latest local records…
              </Text>
            ) : null}
            <Text style={[styles.heroTitle, { color: colors.text }]}>
              {activeReport.headline}
            </Text>
            <Text style={[styles.heroSummary, { color: colors.textSecondary }]}>
              {activeReport.summary}
            </Text>
            <View style={[styles.metricRow, { borderColor: colors.divider }]}>
              <View style={styles.metric}>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  Time in range
                </Text>
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {activeReport.current.timeInRangePercent}%
                </Text>
                <Text style={[styles.metricDelta, { color: colors.textTertiary }]}>
                  was {activeReport.previous.timeInRangePercent}%
                </Text>
              </View>
              <View style={styles.metric}>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  Coverage
                </Text>
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {activeReport.current.coveragePercent}%
                </Text>
                <Text style={[styles.metricDelta, { color: colors.textTertiary }]}>
                  {activeReport.current.glucoseReadings} readings
                </Text>
              </View>
            </View>
            <View style={styles.signalRow}>
              <View
                style={[
                  styles.signal,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Text
                  style={[styles.signalLabel, { color: colors.textSecondary }]}
                >
                  Average
                </Text>
                <Text style={[styles.signalValue, { color: colors.text }]}>
                  {activeReport.current.glucoseAverage?.toFixed(1) ??
                    '—'}
                </Text>
                <Text
                  style={[styles.signalUnit, { color: colors.textTertiary }]}
                >
                  mmol/L
                </Text>
              </View>
              <View
                style={[
                  styles.signal,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Text
                  style={[styles.signalLabel, { color: colors.textSecondary }]}
                >
                  Variability
                </Text>
                <Text style={[styles.signalValue, { color: colors.text }]}>
                  {activeReport.current.glucoseCvPercent === null
                    ? '—'
                    : `${activeReport.current.glucoseCvPercent}%`}
                </Text>
                <Text
                  style={[styles.signalUnit, { color: colors.textTertiary }]}
                >
                  coefficient
                </Text>
              </View>
              <View
                style={[
                  styles.signal,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Text
                  style={[styles.signalLabel, { color: colors.textSecondary }]}
                >
                  Sustained runs
                </Text>
                <Text style={[styles.signalValue, { color: colors.text }]}>
                  {activeReport.current.highGlucoseRuns +
                    activeReport.current.lowGlucoseRuns}
                </Text>
                <Text
                  style={[styles.signalUnit, { color: colors.textTertiary }]}
                >
                  high + low
                </Text>
              </View>
            </View>
          </SectionCard>

          <SectionHeading
            title="Findings and evidence"
            detail={
              findings.length > 3 && !allFindingsVisible
                ? `Showing the three most relevant of ${findings.length} findings.`
                : 'Open a finding only when you want its calculation and records.'
            }
          />
          <View style={styles.findingStack}>
            {visibleFindings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                expanded={expanded.has(finding.id)}
                highlighted={false}
                onToggle={() => toggleFinding(finding.id)}
                onInspectRecords={setSelectedEvidence}
              />
            ))}
          </View>
          {findings.length > 3 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setAllFindingsVisible((visible) => !visible)
              }
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
                  ? 'Show top three'
                  : `View all ${findings.length} findings`}
              </Text>
            </Pressable>
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
  tarvisLaunch: {
    minHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 2,
  },
  tarvisIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tarvisCopy: {
    flex: 1,
  },
  tarvisEyebrow: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 1,
  },
  tarvisTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    marginTop: 1,
  },
  tarvisDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  comparisonCard: {
    padding: 12,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reviewCopy: {
    flex: 1,
  },
  reviewTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
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
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  heroTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
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
    flexDirection: 'row',
    gap: 24,
    marginTop: 20,
    paddingTop: 18,
  },
  metric: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricDelta: {
    fontSize: 10,
    lineHeight: 15,
  },
  signalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  signal: {
    flex: 1,
    minWidth: 86,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  signalLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  signalValue: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  signalUnit: {
    fontSize: 9,
    lineHeight: 13,
  },
  askRow: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  suggestion: {
    minHeight: 38,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  suggestionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  answerCard: {
    marginTop: 12,
  },
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  answerTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
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
  allFindingsButton: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  allFindingsText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  findingCard: {
    padding: 18,
  },
  findingTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  findingIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findingCopy: {
    flex: 1,
  },
  findingKind: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  findingTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
    marginTop: 2,
  },
  findingSummary: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  caveat: {
    fontSize: 11,
    lineHeight: 17,
    fontStyle: 'italic',
    marginTop: 7,
  },
  evidenceButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  evidenceButtonText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  evidenceLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 9,
  },
  exampleTime: {
    width: 38,
    fontSize: 10,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  exampleCopy: {
    flex: 1,
  },
  examplePrimary: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 10,
  },
  openRecordsText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  safety: {
    marginTop: 18,
  },
});
