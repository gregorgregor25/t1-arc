import { useNavigation, useRoute } from '@react-navigation/native';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { CombinedTimeline } from '@/components/CombinedTimeline';
import { ContextEventList } from '@/components/ContextEventList';
import { CurrentGlucoseCard } from '@/components/CurrentGlucoseCard';
import { DailyContextCard } from '@/components/DailyContextCard';
import { EmptyState } from '@/components/EmptyState';
import { ErrorCard } from '@/components/ErrorCard';
import { EvidenceRecordInspector } from '@/components/EvidenceRecordInspector';
import { FoodLoggerCard } from '@/components/FoodLoggerCard';
import { FoodDiaryCard } from '@/components/FoodDiaryCard';
import { LoadingCard } from '@/components/LoadingCard';
import { ManualContextCard } from '@/components/ManualContextCard';
import { SafetyNote } from '@/components/SafetyNote';
import { SectionCard } from '@/components/SectionCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import { GlucoseStatsCard, InsulinStatsCard } from '@/components/StatsCards';
import { EvidenceReference } from '@/domain/insights';
import { HealthContextEvent } from '@/domain/models';
import { calculateGlucoseStats, calculateInsulinStats } from '@/domain/stats';
import { dayRange, formatDate } from '@/domain/time';
import { assessGlucoseTrend } from '@/domain/trend';
import { useLatestData, useTimeline } from '@/hooks/useTimeline';
import { useDailyHealthMetrics } from '@/hooks/useDailyHealthMetrics';
import { useFoodLogs } from '@/hooks/useFoodLogs';
import { FoodLog } from '@/data/food/types';
import type { RootTabParamList } from '@/navigation/AppNavigator';
import { useDataContext } from '@/providers/DataProvider';

type TodayRange = '6h' | '12h' | '24h';
const RANGE_HOURS: Record<TodayRange, number> = { '6h': 6, '12h': 12, '24h': 24 };

export function TodayScreen() {
  const route = useRoute<RouteProp<RootTabParamList, 'Today'>>();
  const navigation =
    useNavigation<NavigationProp<RootTabParamList, 'Today'>>();
  const {
    now,
    refreshData,
    sourceError,
    syncing,
    today,
  } = useDataContext();
  const [rangeChoice, setRangeChoice] = useState<TodayRange>('12h');
  const [selectedEvidence, setSelectedEvidence] =
    useState<EvidenceReference>();
  const [selectedContextToEdit, setSelectedContextToEdit] =
    useState<HealthContextEvent>();
  const [selectedFoodLogToEdit, setSelectedFoodLogToEdit] =
    useState<FoodLog>();
  const [foodLaunchRequest, setFoodLaunchRequest] = useState(0);
  const [contextLaunchRequest, setContextLaunchRequest] = useState(0);
  const range = useMemo(
    () => ({
      start: now - RANGE_HOURS[rangeChoice] * 3_600_000,
      end: now,
    }),
    [now, rangeChoice],
  );
  const selectedTimeline = useTimeline(range);
  const todayTimeline = useTimeline(dayRange(today, now));
  const foodHistory = useFoodLogs(dayRange(today, now));
  const dailyHealth = useDailyHealthMetrics(dayRange(today, now));
  const latest = useLatestData();
  const glucoseSource = latest.sources.find((source) => source.label === 'Glucose');
  const insulinSource = todayTimeline.data?.sources.find(
    (source) => source.label === 'Insulin',
  );
  const trendAssessment = useMemo(
    () =>
      assessGlucoseTrend(
        latest.reading,
        selectedTimeline.data?.glucose ?? [],
      ),
    [latest.reading, selectedTimeline.data?.glucose],
  );

  useEffect(() => {
    if (!route.params?.action) return;
    if (route.params.action === 'log-food') {
      setFoodLaunchRequest((value) => value + 1);
    } else if (route.params.action === 'log-context') {
      setContextLaunchRequest((value) => value + 1);
    }
    navigation.setParams({ action: undefined, request: undefined });
  }, [navigation, route.params?.action, route.params?.request]);

  const glucoseStats = selectedTimeline.data
    ? calculateGlucoseStats(selectedTimeline.data.glucose, range)
    : undefined;
  const insulinStats = todayTimeline.data
    ? calculateInsulinStats(
        todayTimeline.data.basal,
        todayTimeline.data.boluses,
        dayRange(today, now),
      )
    : undefined;

  return (
    <>
      <AppScreen
        title="Today"
        eyebrow={formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
        refreshing={syncing}
        onRefresh={() => void refreshData()}
      >
      <CurrentGlucoseCard
        reading={latest.reading}
        source={glucoseSource}
        now={now}
        trendAssessment={trendAssessment}
        onChooseSource={() => navigation.navigate('Sources')}
      />
      {latest.error || sourceError ? (
        <View style={styles.latestError}>
          <ErrorCard message={latest.error ?? sourceError!} />
        </View>
      ) : null}

      <SectionHeading
        title="Quick log"
        detail="Capture food or context while it is fresh in your mind."
      />
      <View style={styles.cardStack}>
        <FoodLoggerCard
          compact
          editingLog={selectedFoodLogToEdit}
          initialTimestamp={now}
          launchRequest={foodLaunchRequest}
          onEditEnd={() => setSelectedFoodLogToEdit(undefined)}
        />
        <ManualContextCard
          compact
          editingEvent={selectedContextToEdit}
          initialTimestamp={now}
          launchRequest={contextLaunchRequest}
          onEditEnd={() => setSelectedContextToEdit(undefined)}
        />
      </View>

      {todayTimeline.data?.context.some((event) => event.kind === 'meal') ? (
        <>
          <SectionHeading
            title="Food diary"
            detail="Meals, items and saved nutrient snapshots."
          />
          <FoodDiaryCard
            events={todayTimeline.data.context}
            logs={foodHistory.logs}
            onEditManualContext={setSelectedContextToEdit}
            onEditFoodLog={setSelectedFoodLogToEdit}
            timeline={todayTimeline.data}
            onInspect={setSelectedEvidence}
          />
        </>
      ) : null}

      <SectionHeading
        title="Timeline"
        detail="Glucose and delivered insulin, aligned in London time."
      />
      <SegmentedControl
        accessibilityLabel="Timeline range"
        options={[
          { value: '6h', label: '6 hours' },
          { value: '12h', label: '12 hours' },
          { value: '24h', label: '24 hours' },
        ]}
        value={rangeChoice}
        onChange={setRangeChoice}
      />
      <View style={styles.afterControl}>
        {selectedTimeline.error ? (
          <ErrorCard message={selectedTimeline.error} />
        ) : selectedTimeline.loading || !selectedTimeline.data ? (
          <LoadingCard label="Loading timeline…" />
        ) : (
          <View style={styles.cardStack}>
            <CombinedTimeline data={selectedTimeline.data} />
            <ContextEventList
              events={selectedTimeline.data.context.filter(
                (event) => event.kind !== 'meal',
              )}
              limit={6}
              onEditManualContext={setSelectedContextToEdit}
              onInspect={setSelectedEvidence}
              timeline={selectedTimeline.data}
            />
          </View>
        )}
      </View>

      <SectionHeading title="At a glance" detail="Deterministic calculations only." />
      <View style={styles.cardStack}>
        {glucoseStats ? (
          <GlucoseStatsCard
            stats={glucoseStats}
            label={`Last ${RANGE_HOURS[rangeChoice]} hours`}
          />
        ) : (
          <LoadingCard label="Calculating glucose statistics…" />
        )}
        {insulinStats ? (
          insulinSource?.freshness === 'missing' ? (
            <SectionCard>
              <EmptyState
                title="No Glooko insulin imported"
                detail="Your glucose remains complete on its own. Connect Glooko in Sources to add delivered insulin alongside it."
              />
            </SectionCard>
          ) : (
            <InsulinStatsCard stats={insulinStats} />
          )
        ) : (
          <LoadingCard label="Calculating insulin totals…" />
        )}
        {todayTimeline.data ? (
          <DailyContextCard
            events={todayTimeline.data.context}
            health={dailyHealth.metrics}
            contextNeedsSource={dailyHealth.contextNeedsSource}
            range={dayRange(today, now)}
          />
        ) : null}
      </View>

      <View style={styles.safety}>
        <SafetyNote />
      </View>
      </AppScreen>
      <EvidenceRecordInspector
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(undefined)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  afterControl: {
    marginTop: 12,
  },
  latestError: {
    marginTop: 12,
  },
  cardStack: {
    gap: 12,
  },
  safety: {
    marginTop: 18,
  },
});
