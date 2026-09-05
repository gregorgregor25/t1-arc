import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { DateNavigator } from "@/components/DateNavigator";
import { EmptyState } from "@/components/EmptyState";
import { ErrorCard } from "@/components/ErrorCard";
import { HealthConnectSourceRecordList } from "@/components/HealthConnectSourceRecordList";
import { LoadingCard } from "@/components/LoadingCard";
import { SectionCard } from "@/components/SectionCard";
import { addDays, DateKey, dayRange } from "@/domain/time";
import { useHealthConnectSourceRecords } from "@/hooks/useHealthConnectSourceRecords";
import { useDataContext } from "@/providers/DataProvider";
import { healthDateAfterTodayChange } from "@/screens/healthDateSelection";

export function HealthConnectRecordReview() {
  const { earliestDate, now, today } = useDataContext();
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
  const timeBucket = Math.floor(now / (5 * 60_000)) * 5 * 60_000;
  const range = useMemo(
    () => dayRange(selectedDate, timeBucket),
    [selectedDate, timeBucket],
  );
  const sourceHealth = useHealthConnectSourceRecords(
    range,
    true,
    `health-connect-day:${selectedDate}`,
  );

  return (
    <View style={styles.container}>
      <DateNavigator
        date={selectedDate}
        canGoBack={selectedDate > earliestDate}
        canGoForward={selectedDate < today}
        onBack={() => setSelectedDate((date) => addDays(date, -1))}
        onForward={() => setSelectedDate((date) => addDays(date, 1))}
        onDateChange={setSelectedDate}
        earliestDate={earliestDate}
        latestDate={today}
        todayDate={today}
        isToday={selectedDate === today}
        caption="Choose a day"
      />

      {sourceHealth.error ? (
        <ErrorCard message={sourceHealth.error} />
      ) : sourceHealth.loading ? (
        <LoadingCard label="Loading imported records…" />
      ) : sourceHealth.totalRecords ? (
        <HealthConnectSourceRecordList
          initiallyExpanded
          loadingMore={sourceHealth.loadingMore}
          onShowMore={sourceHealth.loadMore}
          records={sourceHealth.records}
          totalRecords={sourceHealth.totalRecords}
        />
      ) : (
        <SectionCard>
          <EmptyState
            title="No imported records for this day"
            detail="Choose another day or import available history above."
          />
        </SectionCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
});
