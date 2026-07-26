import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { DataModeBadge } from '@/components/DataModeBadge';
import { DateNavigator } from '@/components/DateNavigator';
import { ErrorCard } from '@/components/ErrorCard';
import { FoodLoggerCard } from '@/components/FoodLoggerCard';
import { LoadingCard } from '@/components/LoadingCard';
import { ManualContextCard } from '@/components/ManualContextCard';
import { RecordFilter, RecordList } from '@/components/RecordList';
import { SafetyNote } from '@/components/SafetyNote';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SourceStatusCard } from '@/components/SourceStatusCard';
import {
  addDays,
  DateKey,
  dayRange,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import { useTimeline } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

export function RecordsScreen() {
  const { colors, radius } = useAppTheme();
  const {
    dataMode,
    deleteManualContext,
    now,
    refreshData,
    syncing,
    today,
    earliestDate,
  } = useDataContext();
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const [filter, setFilter] = useState<RecordFilter>('all');
  const [visibleCount, setVisibleCount] = useState(60);
  const range = useMemo(() => dayRange(selectedDate, now), [now, selectedDate]);
  const timeline = useTimeline(range);

  useEffect(() => {
    setVisibleCount(60);
  }, [filter, selectedDate]);

  function confirmDeleteContext(id: string, title: string) {
    Alert.alert(
      'Delete manual entry?',
      `"${title}" will be removed from Daymark. Imported records are unaffected.`,
      [
        { text: 'Keep entry', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteManualContext(id).then((deleted) => {
              if (!deleted) {
                Alert.alert(
                  'Entry not removed',
                  'Only context entered manually in Daymark can be deleted here.',
                );
              }
            });
          },
        },
      ],
    );
  }

  return (
    <AppScreen
      title="Records"
      eyebrow="Inspect the source data"
      trailing={<DataModeBadge mode={dataMode} />}
      refreshing={syncing}
      onRefresh={() => void refreshData()}
    >
      <View
        style={[
          styles.explainer,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <Text style={[styles.explainerTitle, { color: colors.text }]}>
          Values before conclusions
        </Text>
        <Text style={[styles.explainerText, { color: colors.textSecondary }]}>
          These are the normalised records used by the chart and statistics.
          {dataMode === 'demo' ? ' They are explicitly synthetic.' : ''}
          {' '}No hidden scoring or AI interpretation is applied.
        </Text>
      </View>

      {dataMode === 'live' ? (
        <>
          <SectionHeading
            title="Log"
            detail="Food search stays offline; personal entries stay separate from imported device records."
          />
          <FoodLoggerCard
            initialTimestamp={
              selectedDate === today
                ? now
                : zonedDateTimeToTimestamp(selectedDate, 12)
            }
          />
          <ManualContextCard
            initialTimestamp={
              selectedDate === today
                ? now
                : zonedDateTimeToTimestamp(selectedDate, 12)
            }
          />
        </>
      ) : null}

      <SectionHeading title="Date and record type" />
      <DateNavigator
        date={selectedDate}
        canGoBack={selectedDate > earliestDate}
        canGoForward={selectedDate < today}
        onBack={() => setSelectedDate((date) => addDays(date, -1))}
        onForward={() => setSelectedDate((date) => addDays(date, 1))}
        isToday={selectedDate === today}
      />
      <SegmentedControl
        accessibilityLabel="Record type"
        options={[
          { value: 'all', label: 'All' },
          { value: 'glucose', label: 'Glucose' },
          { value: 'insulin', label: 'Insulin' },
          { value: 'context', label: 'Context' },
        ]}
        value={filter}
        onChange={setFilter}
      />

      <SectionHeading
        title="Underlying records"
        detail="Times are shown in Europe/London."
      />
      {timeline.error ? (
        <ErrorCard message={timeline.error} />
      ) : timeline.loading || !timeline.data ? (
        <LoadingCard label="Loading source records…" />
      ) : (
        <View style={styles.stack}>
          <SourceStatusCard sources={timeline.data.sources} now={now} />
          <RecordList
            data={timeline.data}
            filter={filter}
            visibleCount={visibleCount}
            onDeleteManualContext={confirmDeleteContext}
            onShowMore={() => setVisibleCount((count) => count + 60)}
          />
          <SafetyNote />
        </View>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  explainer: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  explainerTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  explainerText: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  stack: {
    gap: 12,
  },
});
