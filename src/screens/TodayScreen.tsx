import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { CombinedTimeline } from '@/components/CombinedTimeline';
import { ContextEventList } from '@/components/ContextEventList';
import { CurrentGlucoseCard } from '@/components/CurrentGlucoseCard';
import { DataModeBadge } from '@/components/DataModeBadge';
import { EmptyState } from '@/components/EmptyState';
import { ErrorCard } from '@/components/ErrorCard';
import { LoadingCard } from '@/components/LoadingCard';
import { SafetyNote } from '@/components/SafetyNote';
import { SectionCard } from '@/components/SectionCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SourceStatusCard } from '@/components/SourceStatusCard';
import { GlucoseStatsCard, InsulinStatsCard } from '@/components/StatsCards';
import { calculateGlucoseStats, calculateInsulinStats } from '@/domain/stats';
import { dayRange, formatDate } from '@/domain/time';
import { useLatestData, useTimeline } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';

type TodayRange = '6h' | '12h' | '24h';
const RANGE_HOURS: Record<TodayRange, number> = { '6h': 6, '12h': 12, '24h': 24 };

export function TodayScreen() {
  const {
    dataMode,
    now,
    refreshData,
    sourceError,
    syncing,
    today,
  } = useDataContext();
  const [rangeChoice, setRangeChoice] = useState<TodayRange>('12h');
  const range = useMemo(
    () => ({
      start: now - RANGE_HOURS[rangeChoice] * 3_600_000,
      end: now,
    }),
    [now, rangeChoice],
  );
  const selectedTimeline = useTimeline(range);
  const todayTimeline = useTimeline(dayRange(today, now));
  const latest = useLatestData();
  const glucoseSource = latest.sources.find((source) => source.label === 'Glucose');
  const insulinSource = todayTimeline.data?.sources.find(
    (source) => source.label === 'Insulin',
  );

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
    <AppScreen
      title="Today"
      eyebrow={formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
      trailing={<DataModeBadge mode={dataMode} />}
      refreshing={syncing}
      onRefresh={() => void refreshData()}
    >
      <CurrentGlucoseCard
        reading={latest.reading}
        source={glucoseSource}
        now={now}
      />
      {latest.error || sourceError ? (
        <View style={styles.latestError}>
          <ErrorCard message={latest.error ?? sourceError!} />
        </View>
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
              events={selectedTimeline.data.context}
              limit={6}
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
                detail="Real glucose is shown on its own. Import a Glooko CSV export in Sources when you want delayed pump records alongside it."
              />
            </SectionCard>
          ) : (
            <InsulinStatsCard stats={insulinStats} />
          )
        ) : (
          <LoadingCard label="Calculating insulin totals…" />
        )}
      </View>

      <SectionHeading
        title="Freshness"
        detail="Current glucose and delayed insulin are never conflated."
      />
      {latest.loading ? (
        <LoadingCard label="Checking source status…" />
      ) : (
        <SourceStatusCard sources={latest.sources} now={now} />
      )}
      <View style={styles.safety}>
        <SafetyNote />
      </View>
    </AppScreen>
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
