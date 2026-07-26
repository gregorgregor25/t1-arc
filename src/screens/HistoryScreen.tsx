import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { CombinedTimeline } from '@/components/CombinedTimeline';
import { ContextEventList } from '@/components/ContextEventList';
import { DataModeBadge } from '@/components/DataModeBadge';
import { DateNavigator } from '@/components/DateNavigator';
import { EmptyState } from '@/components/EmptyState';
import { ErrorCard } from '@/components/ErrorCard';
import { InsulinEventList } from '@/components/InsulinEventList';
import { LoadingCard } from '@/components/LoadingCard';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SectionCard } from '@/components/SectionCard';
import { GlucoseStatsCard, InsulinStatsCard } from '@/components/StatsCards';
import { calculateGlucoseStats, calculateInsulinStats } from '@/domain/stats';
import {
  addDays,
  DateKey,
  multiDayRange,
} from '@/domain/time';
import { useTimeline } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';

type HistoryRange = '1d' | '3d' | '7d';
const RANGE_DAYS: Record<HistoryRange, number> = { '1d': 1, '3d': 3, '7d': 7 };

export function HistoryScreen() {
  const {
    dataMode,
    now,
    refreshData,
    syncing,
    today,
    earliestDate,
  } = useDataContext();
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const [rangeChoice, setRangeChoice] = useState<HistoryRange>('1d');
  const days = RANGE_DAYS[rangeChoice];
  const range = useMemo(
    () => multiDayRange(selectedDate, days, now),
    [days, now, selectedDate],
  );
  const timeline = useTimeline(range);
  const glucoseStats = timeline.data
    ? calculateGlucoseStats(timeline.data.glucose, range)
    : undefined;
  const insulinStats = timeline.data
    ? calculateInsulinStats(timeline.data.basal, timeline.data.boluses, range)
    : undefined;
  const insulinMissing = timeline.data?.sources.some(
    (source) => source.label === 'Insulin' && source.freshness === 'missing',
  );

  return (
    <AppScreen
      title="History"
      eyebrow={
        dataMode === 'live'
          ? 'Encrypted personal history'
          : '21-day synthetic record'
      }
      trailing={<DataModeBadge mode={dataMode} />}
      refreshing={syncing}
      onRefresh={() => void refreshData()}
    >
      <DateNavigator
        date={selectedDate}
        canGoBack={selectedDate > earliestDate}
        canGoForward={selectedDate < today}
        onBack={() => setSelectedDate((date) => addDays(date, -1))}
        onForward={() => setSelectedDate((date) => addDays(date, 1))}
        isToday={selectedDate === today}
      />
      <SegmentedControl
        accessibilityLabel="History range"
        options={[
          { value: '1d', label: 'Day' },
          { value: '3d', label: '3 days' },
          { value: '7d', label: '7 days' },
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
      ) : (
        <View style={styles.stack}>
          <CombinedTimeline data={timeline.data} />
          <ContextEventList events={timeline.data.context} />
          <GlucoseStatsCard
            stats={glucoseStats!}
            label={days === 1 ? 'Selected day' : `${days}-day range`}
          />
          {insulinMissing ? (
            <SectionCard>
              <EmptyState
                title="No personal insulin history yet"
                detail="Glucose history remains available. Insulin will appear here only after a separate delayed source is connected."
              />
            </SectionCard>
          ) : (
            <>
              <InsulinStatsCard
                stats={insulinStats!}
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
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 12,
  },
});
