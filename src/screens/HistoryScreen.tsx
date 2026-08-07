import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { CombinedTimeline } from '@/components/CombinedTimeline';
import { ContextEventList } from '@/components/ContextEventList';
import { DateNavigator } from '@/components/DateNavigator';
import { DailySummaryCard } from '@/components/DailySummaryCard';
import { EmptyState } from '@/components/EmptyState';
import { EvidenceRecordInspector } from '@/components/EvidenceRecordInspector';
import { FoodDiaryCard } from '@/components/FoodDiaryCard';
import { FoodLoggerCard } from '@/components/FoodLoggerCard';
import { ErrorCard } from '@/components/ErrorCard';
import { GlucoseProfileCard } from '@/components/GlucoseProfileCard';
import { InsulinEventList } from '@/components/InsulinEventList';
import { LoadingCard } from '@/components/LoadingCard';
import { ManualContextCard } from '@/components/ManualContextCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SectionCard } from '@/components/SectionCard';
import { GlucoseStatsCard, InsulinStatsCard } from '@/components/StatsCards';
import { EvidenceReference } from '@/domain/insights';
import { HealthContextEvent } from '@/domain/models';
import { buildInsulinReconciliation } from '@/domain/dataCompleteness';
import { calculateGlucoseStats, calculateInsulinStats } from '@/domain/stats';
import {
  addDays,
  DateKey,
  multiDayRange,
} from '@/domain/time';
import { useTimeline } from '@/hooks/useTimeline';
import { useFoodLogs } from '@/hooks/useFoodLogs';
import { FoodLog } from '@/data/food/types';
import { useDataContext } from '@/providers/DataProvider';

type HistoryRange = '1d' | '3d' | '7d' | '30d';
const RANGE_DAYS: Record<HistoryRange, number> = {
  '1d': 1,
  '3d': 3,
  '7d': 7,
  '30d': 30,
};

export function HistoryScreen() {
  const {
    now,
    refreshData,
    syncing,
    today,
    earliestDate,
  } = useDataContext();
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const [rangeChoice, setRangeChoice] = useState<HistoryRange>('1d');
  const [selectedEvidence, setSelectedEvidence] =
    useState<EvidenceReference>();
  const [selectedContextToEdit, setSelectedContextToEdit] =
    useState<HealthContextEvent>();
  const [selectedFoodLogToEdit, setSelectedFoodLogToEdit] =
    useState<FoodLog>();
  const days = RANGE_DAYS[rangeChoice];
  const range = useMemo(
    () => multiDayRange(selectedDate, days, now),
    [days, now, selectedDate],
  );
  const timeline = useTimeline(range);
  const foodHistory = useFoodLogs(range);
  const glucoseStats = timeline.data
    ? calculateGlucoseStats(timeline.data.glucose, range)
    : undefined;
  const insulinStats = timeline.data
    ? calculateInsulinStats(timeline.data.basal, timeline.data.boluses, range)
    : undefined;
  const insulinReconciliation = timeline.data
    ? buildInsulinReconciliation(timeline.data)
    : undefined;
  const insulinMissing = timeline.data?.sources.some(
    (source) => source.label === 'Insulin' && source.freshness === 'missing',
  );
  const timelineIsEmpty = Boolean(
    timeline.data &&
      timeline.data.glucose.length === 0 &&
      timeline.data.basal.length === 0 &&
      timeline.data.boluses.length === 0 &&
      timeline.data.context.length === 0,
  );

  return (
    <>
      <AppScreen
      title="History"
      eyebrow="Encrypted personal history"
      refreshing={syncing}
      onRefresh={() => void refreshData()}
    >
      <DateNavigator
        date={selectedDate}
        canGoBack={selectedDate > earliestDate}
        canGoForward={selectedDate < today}
        onBack={() => setSelectedDate((date) => addDays(date, -1))}
        onForward={() => setSelectedDate((date) => addDays(date, 1))}
        onDateChange={setSelectedDate}
        earliestDate={earliestDate}
        latestDate={today}
        isToday={selectedDate === today}
      />
      <SegmentedControl
        accessibilityLabel="History range"
        options={[
          { value: '1d', label: 'Day' },
          { value: '3d', label: '3D' },
          { value: '7d', label: '7D' },
          { value: '30d', label: '30D' },
        ]}
        value={rangeChoice}
        onChange={setRangeChoice}
      />

      <SectionHeading
        title="Combined timeline"
        detail={`${days === 1 ? 'Selected day' : `${days} days ending on the selected date`}.`}
      />
      {timeline.error ? (
        <ErrorCard message={timeline.error} />
      ) : timeline.loading || !timeline.data ? (
        <LoadingCard label="Loading historical data…" />
      ) : timelineIsEmpty ? (
        <SectionCard>
          <EmptyState
            title="No personal history yet"
            detail="Connect a source or add food and health context. T1 Arc will keep the records on this phone as your history grows."
          />
        </SectionCard>
      ) : (
        <View style={styles.stack}>
          <CombinedTimeline data={timeline.data} />
          {days > 1 ? (
            <>
              <GlucoseProfileCard
                data={timeline.data}
                onInspect={setSelectedEvidence}
              />
              <DailySummaryCard
                data={timeline.data}
                onSelect={(date) => {
                  setSelectedDate(date);
                  setRangeChoice('1d');
                }}
              />
            </>
          ) : null}
          <FoodDiaryCard
            events={timeline.data.context}
            logs={foodHistory.logs}
            onEditManualContext={setSelectedContextToEdit}
            onEditFoodLog={setSelectedFoodLogToEdit}
            timeline={timeline.data}
            onInspect={setSelectedEvidence}
          />
          <ContextEventList
            events={timeline.data.context.filter(
              (event) => event.kind !== 'meal',
            )}
            onEditManualContext={setSelectedContextToEdit}
            onInspect={setSelectedEvidence}
            timeline={timeline.data}
          />
          <GlucoseStatsCard
            stats={glucoseStats!}
            label={days === 1 ? 'Selected day' : `${days}-day range`}
          />
          {insulinMissing ? (
            <SectionCard>
              <EmptyState
                title="No personal insulin history yet"
                detail="Glucose history remains available. Connect an insulin source to see delivered insulin alongside it."
              />
            </SectionCard>
          ) : (
            <>
              <InsulinStatsCard
                stats={insulinStats!}
                reconciliation={insulinReconciliation}
                label={days === 1 ? 'Selected day' : `${days}-day total`}
              />
              <InsulinEventList
                boluses={timeline.data.boluses}
                multiDay={days > 1}
              />
            </>
          )}
        </View>
      )}
      </AppScreen>
      <ManualContextCard
        editingEvent={selectedContextToEdit}
        initialTimestamp={now}
        onEditEnd={() => setSelectedContextToEdit(undefined)}
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
  stack: {
    gap: 12,
  },
});
