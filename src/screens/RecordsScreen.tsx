import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppScreen, SectionHeading } from "@/components/AppScreen";
import { AppMenuButton } from "@/components/AppMenuButton";
import { DateNavigator } from "@/components/DateNavigator";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { HealthMetricCards } from "@/components/HealthMetricCards";
import { LoadingCard } from "@/components/LoadingCard";
import { SafetyNote } from "@/components/SafetyNote";
import { addDays, DateKey, dayRange } from "@/domain/time";
import { useDailyHealthMetrics } from "@/hooks/useDailyHealthMetrics";
import { useHealthTrend } from "@/hooks/useHealthTrend";
import { useDataContext } from "@/providers/DataProvider";
import { useAppTheme } from "@/theme/theme";
import {
  healthDateAfterTodayChange,
  presentHealthEmptyState,
} from "./healthDateSelection";

export function HealthScreen() {
  const { colors, radius } = useAppTheme();
  const { dataMode, earliestDate, now, refreshData, syncing, today } =
    useDataContext();
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const previousToday = useRef(today);
  useEffect(() => {
    const priorToday = previousToday.current;
    if (today === priorToday) return;
    setSelectedDate((date) =>
      healthDateAfterTodayChange(date, priorToday, today),
    );
    previousToday.current = today;
  }, [today]);
  const healthTimeBucket = Math.floor(now / (5 * 60_000)) * 5 * 60_000;
  const range = useMemo(
    () => dayRange(selectedDate, healthTimeBucket),
    [healthTimeBucket, selectedDate],
  );
  const dailyHealth = useDailyHealthMetrics(range);
  const healthTrend = useHealthTrend(selectedDate);

  const dailyError = dailyHealth.error ?? healthTrend.error;
  const hasHealthCards = healthTrend.data.some(
    (day) =>
      day.metrics.recordCount > 0 ||
      day.sleepMinutes > 0 ||
      day.workoutMinutes > 0 ||
      day.mealCount > 0 ||
      day.hormoneRecordCount > 0,
  );
  const needsSourceChoice = Boolean(
    dailyHealth.metrics?.needsSource.length ||
    dailyHealth.contextNeedsSource.length,
  );
  const healthEmptyState = presentHealthEmptyState(needsSourceChoice);

  return (
    <>
      <AppScreen
        title="Health"
        refreshing={syncing}
        onRefresh={() => void refreshData()}
        trailing={<AppMenuButton />}
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
          title="Health at a glance"
          detail="Tap any card for selected-day and seven-day detail."
        />
        {dailyError ? (
          <ErrorCard message={dailyError} />
        ) : dataMode === "live" &&
          (!dailyHealth.metrics || healthTrend.loading) ? (
          <LoadingCard label="Loading health data…" />
        ) : (
          <View style={styles.stack}>
            <HealthMetricCards
              isToday={selectedDate === today}
              metrics={dailyHealth.metrics}
              now={now}
              trend={healthTrend.data}
            />
            {!hasHealthCards ? (
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
                  title={healthEmptyState.title}
                  detail={healthEmptyState.detail}
                />
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.safety}>
          <SafetyNote />
        </View>
      </AppScreen>
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
  safety: {
    marginTop: 14,
  },
});
