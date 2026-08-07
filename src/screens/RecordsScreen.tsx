import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { ContextEventList } from '@/components/ContextEventList';
import { DateNavigator } from '@/components/DateNavigator';
import { EmptyState } from '@/components/EmptyState';
import { ErrorCard } from '@/components/ErrorCard';
import { EvidenceRecordInspector } from '@/components/EvidenceRecordInspector';
import { HealthConnectSourceRecordList } from '@/components/HealthConnectSourceRecordList';
import { HealthOverviewCard } from '@/components/HealthOverviewCard';
import { HealthTrendsCard } from '@/components/HealthTrendsCard';
import { LoadingCard } from '@/components/LoadingCard';
import { ManualContextCard } from '@/components/ManualContextCard';
import { SafetyNote } from '@/components/SafetyNote';
import { SegmentedControl } from '@/components/SegmentedControl';
import { addDays, DateKey, dayRange } from '@/domain/time';
import { EvidenceReference } from '@/domain/insights';
import { HealthContextEvent } from '@/domain/models';
import { useDailyHealthMetrics } from '@/hooks/useDailyHealthMetrics';
import { useHealthConnectSourceRecords } from '@/hooks/useHealthConnectSourceRecords';
import { useHealthTrend } from '@/hooks/useHealthTrend';
import { useTimeline } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

type HealthTrendRange = '7' | '30' | '90';

export function HealthScreen() {
  const { colors, radius } = useAppTheme();
  const {
    earliestDate,
    now,
    refreshData,
    syncing,
    today,
  } = useDataContext();
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const [trendRange, setTrendRange] =
    useState<HealthTrendRange>('30');
  const [recordsVisible, setRecordsVisible] = useState(false);
  const [selectedEvidence, setSelectedEvidence] =
    useState<EvidenceReference>();
  const [selectedContextToEdit, setSelectedContextToEdit] =
    useState<HealthContextEvent>();
  const healthTimeBucket = Math.floor(now / (5 * 60_000)) * 5 * 60_000;
  const range = useMemo(
    () => dayRange(selectedDate, healthTimeBucket),
    [healthTimeBucket, selectedDate],
  );
  const timeline = useTimeline(range);
  const dailyHealth = useDailyHealthMetrics(range);
  const healthTrend = useHealthTrend(selectedDate);
  const longerHealthTrend = useHealthTrend(
    selectedDate,
    Number(trendRange),
  );
  const sourceHealth = useHealthConnectSourceRecords(
    range,
    recordsVisible,
  );

  const dailyError =
    timeline.error ?? dailyHealth.error ?? healthTrend.error;
  const noDailyRecords = Boolean(
    dailyHealth.metrics?.recordCount === 0 &&
      !timeline.data?.context.some((event) => event.kind !== 'meal'),
  );

  return (
    <>
      <AppScreen
        title="Health"
        eyebrow="Movement, recovery and context"
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

        <SectionHeading
          title="Daily overview"
          detail="The health signals that add useful context to this day."
        />
        {dailyError ? (
          <ErrorCard message={dailyError} />
        ) : timeline.loading || !timeline.data ? (
          <LoadingCard label="Loading health data…" />
        ) : (
          <View style={styles.stack}>
            <HealthOverviewCard
              events={timeline.data.context}
              contextNeedsSource={dailyHealth.contextNeedsSource}
              isToday={selectedDate === today}
              metrics={dailyHealth.metrics}
              range={range}
              trend={healthTrend.data}
            />
            {noDailyRecords ? (
              <View
                style={[
                  styles.empty,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <EmptyState
                  title="No health records for this day"
                  detail="Connect Samsung Health in Sources or add context below."
                />
              </View>
            ) : null}
            <ManualContextCard
              compact
              editingEvent={selectedContextToEdit}
              initialTimestamp={now}
              onEditEnd={() => setSelectedContextToEdit(undefined)}
            />
            <ContextEventList
              events={timeline.data.context.filter(
                (event) => event.kind !== 'meal',
              )}
              limit={3}
              onEditManualContext={setSelectedContextToEdit}
              onInspect={setSelectedEvidence}
              timeline={timeline.data}
            />
          </View>
        )}

        <SectionHeading
          title="Explore patterns"
          detail="Choose a period, then move between health categories inside the card."
        />
        <SegmentedControl
          accessibilityLabel="Health trend range"
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
          value={trendRange}
          onChange={setTrendRange}
        />
        <View style={styles.trend}>
          {longerHealthTrend.error ? (
            <ErrorCard message={longerHealthTrend.error} />
          ) : longerHealthTrend.loading ? (
            <LoadingCard label="Loading health trends…" />
          ) : (
            <HealthTrendsCard
              days={Number(trendRange)}
              trend={longerHealthTrend.data}
            />
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: recordsVisible }}
          onPress={() => setRecordsVisible((visible) => !visible)}
          style={({ pressed }) => [
            styles.recordsButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.recordsIcon,
              {
                backgroundColor: `${colors.primary}14`,
                borderRadius: radius.sm,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="list-outline"
              size={19}
            />
          </View>
          <View style={styles.recordsCopy}>
            <Text style={[styles.recordsTitle, { color: colors.text }]}>
              Exact health records
            </Text>
            <Text
              style={[
                styles.recordsDetail,
                { color: colors.textSecondary },
              ]}
            >
              Open the underlying Health Connect entries for this day.
            </Text>
          </View>
          <Ionicons
            accessibilityElementsHidden
            color={colors.textTertiary}
            name={recordsVisible ? 'chevron-up' : 'chevron-down'}
            size={19}
          />
        </Pressable>

        {recordsVisible ? (
          <View style={styles.records}>
            {sourceHealth.error ? (
              <ErrorCard message={sourceHealth.error} />
            ) : sourceHealth.loading ? (
              <LoadingCard label="Loading exact health records…" />
            ) : (
              <HealthConnectSourceRecordList
                loadingMore={sourceHealth.loadingMore}
                onShowMore={sourceHealth.loadMore}
                records={sourceHealth.records}
                totalRecords={sourceHealth.totalRecords}
              />
            )}
          </View>
        ) : null}
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
  stack: {
    gap: 12,
  },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  trend: {
    marginTop: 10,
  },
  recordsButton: {
    minHeight: 76,
    marginTop: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  recordsIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordsCopy: {
    flex: 1,
  },
  recordsTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  recordsDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  records: {
    marginTop: 10,
  },
  safety: {
    marginTop: 14,
  },
});
