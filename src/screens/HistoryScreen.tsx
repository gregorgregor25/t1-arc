import Ionicons from "@expo/vector-icons/Ionicons";
import {
  NavigationProp,
  RouteProp,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { AppMenuButton } from "@/components/AppMenuButton";
import {
  CombinedTimeline,
  DEFAULT_TIMELINE_LAYERS,
  GLUCOSE_ONLY_TIMELINE_LAYERS,
  INSULIN_ONLY_TIMELINE_LAYERS,
  TimelineLayerVisibility,
} from "@/components/CombinedTimeline";
import { ContextEventList } from "@/components/ContextEventList";
import { DateNavigator } from "@/components/DateNavigator";
import { DailySummaryCard } from "@/components/DailySummaryCard";
import { EmptyState } from "@/components/EmptyState";
import { EvidenceRecordInspector } from "@/components/EvidenceRecordInspector";
import { FoodDiaryCard } from "@/components/FoodDiaryCard";
import { FoodLoggerCard } from "@/components/FoodLoggerCard";
import { ErrorCard } from "@/components/ErrorCard";
import { GlucoseProfileCard } from "@/components/GlucoseProfileCard";
import { InsulinEventList } from "@/components/InsulinEventList";
import { LoadingCard } from "@/components/LoadingCard";
import { MetabolicSummaryCard } from "@/components/MetabolicSummaryCard";
import { ManualContextCard } from "@/components/ManualContextCard";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SectionCard } from "@/components/SectionCard";
import { EvidenceReference } from "@/domain/insights";
import {
  type BolusDelivery,
  HealthContextEvent,
  TimelineData,
} from "@/domain/models";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { buildInsulinReconciliation } from "@/domain/dataCompleteness";
import { calculateGlucoseStats } from "@/domain/stats";
import { historySelectionForRequest, historySelectionLabel, isHistoryRangeSelection, type HistoryRangeSelection } from '@/domain/historySelection';
import { summarizeInsulinRange } from "@/domain/timelineInsulinSummary";
import {
  addDays,
  DateKey,
  formatDate,
  multiDayRange,
  toDateKey,
} from "@/domain/time";
import { useTimeline } from "@/hooks/useTimeline";
import { useFoodLogs } from "@/hooks/useFoodLogs";
import { FoodLog } from "@/data/food/types";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import type { RootTabParamList } from "@/navigation/AppNavigator";
import { sourceSettingsRouteParams } from "@/navigation/sourceNavigation";
import { useAppTheme } from "@/theme/theme";
import { healthDateAfterTodayChange } from "./healthDateSelection";

type HistoryRange = "1d" | "3d" | "7d" | "30d";
const RANGE_DAYS: Record<HistoryRange, number> = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "30d": 30,
};

const HistoryTimeline = memo(CombinedTimeline);

interface PopulatedHistoryContentProps {
  data: TimelineData;
  days: number;
  deleteManualContext(id: string): Promise<boolean>;
  deleteManualInsulin(id: string): Promise<boolean>;
  foodError?: string;
  foodLogs: FoodLog[];
  onEditFoodLog(log: FoodLog): void;
  onEditManualContext(event: HealthContextEvent): void;
  onEditManualInsulin(delivery: BolusDelivery): void;
  onInspect(evidence: EvidenceReference): void;
  onLayersChange(layers: TimelineLayerVisibility): void;
  onSelectDay(date: DateKey): void;
  selectedDate: DateKey;
  timelineLayers: TimelineLayerVisibility;
  today: DateKey;
  summaryLabel?: string;
  multiDay?: boolean;
}

const PopulatedHistoryContent = memo(function PopulatedHistoryContent({
  data,
  days,
  deleteManualContext,
  deleteManualInsulin,
  foodError,
  foodLogs,
  onEditFoodLog,
  onEditManualContext,
  onEditManualInsulin,
  onInspect,
  onLayersChange,
  onSelectDay,
  selectedDate,
  timelineLayers,
  today,
  summaryLabel,
  multiDay = days > 1,
}: PopulatedHistoryContentProps) {
  const glucoseStats = useMemo(
    () => calculateGlucoseStats(data.glucose, data.range),
    [data.glucose, data.range],
  );
  const insulinSummary = useMemo(
    () =>
      summarizeInsulinRange(
        data.basal,
        data.boluses,
        data.range,
        data.dailyInsulinTotals,
      ),
    [data.basal, data.boluses, data.dailyInsulinTotals, data.range],
  );
  const insulinReconciliation = useMemo(
    () => buildInsulinReconciliation(data),
    [data],
  );
  const insulinMissing = data.sources.some(
    (source) => source.label === "Insulin" && source.freshness === "missing",
  );
  const contextEvents = useMemo(
    () => data.context.filter((event) => event.kind !== "meal"),
    [data.context],
  );

  return (
    <View style={styles.stack}>
      <HistoryTimeline
        data={data}
        layers={timelineLayers}
        onLayersChange={onLayersChange}
      />
      {days > 1 ? (
        <>
          <GlucoseProfileCard data={data} onInspect={onInspect} />
          <DailySummaryCard data={data} onSelect={onSelectDay} />
        </>
      ) : null}
      <FoodDiaryCard
        events={data.context}
        logs={foodLogs}
        onEditManualContext={onEditManualContext}
        onEditFoodLog={onEditFoodLog}
        timeline={data}
        onInspect={onInspect}
      />
      {foodError ? (
        <ErrorCard
          message={`Food details are temporarily unavailable. ${foodError}`}
        />
      ) : null}
      <ContextEventList
        events={contextEvents}
        onDeleteManualKetone={deleteManualContext}
        onEditManualContext={onEditManualContext}
        onInspect={onInspect}
        timeline={data}
      />
      <MetabolicSummaryCard
        glucose={glucoseStats}
        insulin={insulinSummary.stats}
        insulinMissing={insulinMissing}
        reconciliation={insulinReconciliation}
        summary={insulinSummary}
        label={
          summaryLabel ?? (selectedDate === today && days === 1
            ? "Today so far"
            : days === 1
              ? "Selected day"
              : `${days}-day range`)
        }
      />
      {!insulinMissing ? (
        <InsulinEventList
          boluses={data.boluses}
          multiDay={multiDay}
          onDeleteManualInsulin={deleteManualInsulin}
          onEditManualInsulin={onEditManualInsulin}
        />
      ) : null}
    </View>
  );
});

export function HistoryScreen() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const route = useRoute<RouteProp<RootTabParamList, "History">>();
  const navigation =
    useNavigation<NavigationProp<RootTabParamList, "History">>();
  const {
    deleteManualContext,
    deleteManualInsulin,
    now,
    refreshData,
    syncing,
    today,
    earliestDate,
    getLatestGlookoReport,
    revision,
    ownerIdentity,
  } = useDataContext();
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const [explicitSelection, setExplicitSelection] = useState<HistoryRangeSelection>();
  const activeSelection = isHistoryRangeSelection(explicitSelection, now, ownerIdentity) ? explicitSelection : undefined;
  const previousToday = useRef(today);
  useEffect(() => {
    const priorToday = previousToday.current;
    if (today === priorToday) return;
    if (explicitSelection) { previousToday.current = today; return; }
    setSelectedDate((date) =>
      healthDateAfterTodayChange(date, priorToday, today),
    );
    previousToday.current = today;
  }, [explicitSelection, today]);
  const [rangeChoice, setRangeChoice] = useState<HistoryRange>("1d");
  const [timelineLayers, setTimelineLayers] = useState<TimelineLayerVisibility>(
    DEFAULT_TIMELINE_LAYERS,
  );
  const [pumpStateCoverage, setPumpStateCoverage] = useState<{
    start: number;
    end: number;
  }>();
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceReference>();
  const [selectedContextToEdit, setSelectedContextToEdit] =
    useState<HealthContextEvent>();
  const [selectedInsulinToEdit, setSelectedInsulinToEdit] =
    useState<BolusDelivery>();
  const [selectedFoodLogToEdit, setSelectedFoodLogToEdit] = useState<FoodLog>();
  const days = RANGE_DAYS[rangeChoice];
  const range = useMemo(
    () => activeSelection ? { start: activeSelection.start, end: activeSelection.end } : multiDayRange(selectedDate, days, now),
    [activeSelection, days, now, selectedDate],
  );
  const rangeSelectionKey = activeSelection
    ? `history:selection:${activeSelection.start}:${activeSelection.end}:${activeSelection.ownerIdentity}`
    : `history:${selectedDate}:${rangeChoice}`;
  const timeline = useTimeline(range, rangeSelectionKey);
  const foodHistory = useFoodLogs(range, rangeSelectionKey);
  const selectDailySummaryDate = useCallback((date: DateKey) => {
    setExplicitSelection(undefined);
    setSelectedDate(date);
    setRangeChoice("1d");
  }, []);
  const timelineIsEmpty = Boolean(
    timeline.data &&
    timeline.data.glucose.length === 0 &&
    timeline.data.basal.length === 0 &&
    timeline.data.boluses.length === 0 &&
    (timeline.data.dailyInsulinTotals?.length ?? 0) === 0 &&
    (timeline.data.pumpStates?.length ?? 0) === 0 &&
    timeline.data.context.length === 0,
  );
  const pumpStatesOutsideRange = Boolean(
    pumpStateCoverage &&
    (pumpStateCoverage.end <= range.start ||
      pumpStateCoverage.start >= range.end),
  );

  useEffect(() => {
    let active = true;
    void getLatestGlookoReport()
      .then((report) => {
        if (!active) return;
        const hasTimedStates =
          (report?.preview.pumpStateIntervals.length ?? 0) > 0;
        const start = report?.preview.reportStart;
        const end = report?.preview.reportEnd;
        setPumpStateCoverage(
          hasTimedStates && start !== undefined && end !== undefined
            ? { start, end }
            : undefined,
        );
      })
      .catch(() => {
        if (active) setPumpStateCoverage(undefined);
      });
    return () => {
      active = false;
    };
  }, [getLatestGlookoReport, revision]);

  useEffect(() => {
    if (!route.params?.request || !route.params.focus) return;
    // Navigation request tokens are imperative commands. Applying the command
    // here resets all coupled timeline controls atomically before acknowledgement.
    const selection = historySelectionForRequest(route.params.focus, route.params.selectedRange, now, ownerIdentity);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExplicitSelection(selection);
    setSelectedDate(selection ? toDateKey(selection.end - 1) : today);
    setRangeChoice("1d");
    setTimelineLayers(
      route.params.focus === "glucose"
        ? GLUCOSE_ONLY_TIMELINE_LAYERS
        : INSULIN_ONLY_TIMELINE_LAYERS,
    );
    navigation.setParams({ focus: undefined, request: undefined, selectedRange: undefined });
  }, [navigation, now, ownerIdentity, route.params?.focus, route.params?.request, route.params?.selectedRange, today]);

  function chooseDate(date: DateKey) {
    setExplicitSelection(undefined);
    setSelectedDate(date);
  }

  return (
    <>
      <AppScreen
        title="History"
        refreshing={syncing}
        onRefresh={() => void refreshData()}
        trailing={<AppMenuButton />}
      >
        {activeSelection ? (
          <View style={[styles.selectionHeader, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
            <Text style={[styles.selectionTitle, { color: colors.text }]}>Selected period</Text>
            <Text style={[styles.selectionDescription, { color: colors.textSecondary }]}>
              {historySelectionLabel(activeSelection, regional.locale, regional.timeZone)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => selectDailySummaryDate(selectedDate)}
              style={styles.browseDays}>
              <Ionicons accessibilityElementsHidden name="calendar-outline" size={18} color={colors.primary} />
              <Text style={[styles.browseDaysLabel, { color: colors.primary }]}>Browse by day</Text>
            </Pressable>
          </View>
        ) : <DateNavigator
          date={selectedDate}
          canGoBack={selectedDate > earliestDate}
          canGoForward={selectedDate < today}
          onBack={() => chooseDate(addDays(selectedDate, -1))}
          onForward={() => chooseDate(addDays(selectedDate, 1))}
          onDateChange={chooseDate}
          earliestDate={earliestDate}
          latestDate={today}
          todayDate={today}
          isToday={selectedDate === today}
        />}
        <SegmentedControl<HistoryRange | 'selection'>
          accessibilityLabel="History range"
          options={[
            { value: "1d", label: "Day" },
            {
              value: "3d",
              label: `${formatRegionalNumber(3, regional.locale, { maximumFractionDigits: 0 })}D`,
            },
            {
              value: "7d",
              label: `${formatRegionalNumber(7, regional.locale, { maximumFractionDigits: 0 })}D`,
            },
            {
              value: "30d",
              label: `${formatRegionalNumber(30, regional.locale, { maximumFractionDigits: 0 })}D`,
            },
          ]}
          value={activeSelection ? 'selection' : rangeChoice}
          onChange={(choice) => {
            if (choice === 'selection') return;
            setExplicitSelection(undefined);
            setRangeChoice(choice);
          }}
        />

        {pumpStatesOutsideRange && pumpStateCoverage ? (
          <View
            style={[
              styles.coverageNotice,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.textTertiary}
              name="calendar-outline"
              size={17}
            />
            <Text
              style={[
                styles.coverageNoticeText,
                { color: colors.textSecondary },
              ]}
            >
              Pump-state timing is available for{" "}
              {formatDate(toDateKey(pumpStateCoverage.start), {
                day: "numeric",
                month: "short",
              })}
              {" – "}
              {formatDate(toDateKey(pumpStateCoverage.end - 1), {
                day: "numeric",
                month: "short",
              })}
              . Activity and pause controls appear when the selected range
              overlaps those dates.
            </Text>
          </View>
        ) : null}

        {!activeSelection ? <Text style={[styles.rangeCaption, { color: colors.textSecondary }]}>
          {days === 1
            ? selectedDate === today
              ? "Today so far"
              : "Selected day"
            : `${formatRegionalNumber(days, regional.locale, { maximumFractionDigits: 0 })} days ending ${formatDate(selectedDate, { day: "numeric", month: "short" })}`}
        </Text> : null}
        {timeline.error ? (
          <ErrorCard message={timeline.error} />
        ) : timeline.loading || !timeline.data ? (
          <LoadingCard label="Loading historical data…" />
        ) : timelineIsEmpty ? (
          <SectionCard>
            <EmptyState
              title="No records in this range"
              detail="Choose another date, connect a source or add a record from Today. Your saved history stays on this phone."
              icon="calendar-outline"
              action={{
                label: "Connect a source",
                onPress: () =>
                  navigation.navigate("Sources", sourceSettingsRouteParams()),
              }}
            />
          </SectionCard>
        ) : (
          <PopulatedHistoryContent
            data={timeline.data}
            days={activeSelection ? 1 : days}
            summaryLabel={activeSelection ? 'Selected period' : undefined}
            multiDay={activeSelection ? toDateKey(range.start) !== toDateKey(range.end - 1) : days > 1}
            deleteManualContext={deleteManualContext}
            deleteManualInsulin={deleteManualInsulin}
            foodError={foodHistory.error}
            foodLogs={foodHistory.logs}
            onEditFoodLog={setSelectedFoodLogToEdit}
            onEditManualContext={setSelectedContextToEdit}
            onEditManualInsulin={setSelectedInsulinToEdit}
            onInspect={setSelectedEvidence}
            onLayersChange={setTimelineLayers}
            onSelectDay={selectDailySummaryDate}
            selectedDate={selectedDate}
            timelineLayers={timelineLayers}
            today={today}
          />
        )}
      </AppScreen>
      <ManualContextCard
        editingEvent={selectedContextToEdit}
        editingInsulin={selectedInsulinToEdit}
        initialTimestamp={now}
        onEditEnd={() => {
          setSelectedContextToEdit(undefined);
          setSelectedInsulinToEdit(undefined);
        }}
        showLauncher={false}
      />
      <FoodLoggerCard
        editingLog={selectedFoodLogToEdit}
        initialTimestamp={now}
        onEditEnd={() => setSelectedFoodLogToEdit(undefined)}
        showLauncher={false}
      />
      <EvidenceRecordInspector
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(undefined)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  selectionHeader: { paddingHorizontal: 16, paddingTop: 14, marginBottom: 12 },
  selectionTitle: { fontSize: 17, fontWeight: '700' },
  selectionDescription: { fontSize: 13, lineHeight: 20, marginTop: 5 },
  browseDays: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 48 },
  browseDaysLabel: { fontSize: 14, fontWeight: '600' },
  rangeCaption: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    marginBottom: 14,
  },
  coverageNotice: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 10,
    padding: 10,
  },
  coverageNoticeText: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 15,
  },
  stack: {
    gap: 12,
  },
});
