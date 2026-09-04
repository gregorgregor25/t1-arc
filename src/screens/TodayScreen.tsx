import { useNavigation, useRoute } from "@react-navigation/native";
import type { NavigationProp, RouteProp } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { AppMenuButton } from "@/components/AppMenuButton";
import { CombinedTimeline } from "@/components/CombinedTimeline";
import { ContextEventList } from "@/components/ContextEventList";
import { CurrentGlucoseCard } from "@/components/CurrentGlucoseCard";
import { ErrorCard } from "@/components/ErrorCard";
import { FoodLoggerCard } from "@/components/FoodLoggerCard";
import { LoadingCard } from "@/components/LoadingCard";
import {
  FloatingLogButton,
  LogEntryKind,
  LogEntryLauncher,
} from "@/components/LogEntryLauncher";
import {
  ManualContextCard,
  ManualContextKind,
} from "@/components/ManualContextCard";
import { SafetyNote } from "@/components/SafetyNote";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TodayGlanceCard } from "@/components/TodayGlanceCard";
import { isManualKetoneEvent } from "@/data/manualContext";
import { calculateGlucoseStats } from "@/domain/stats";
import { summarizeInsulinRange } from "@/domain/timelineInsulinSummary";
import { dayRange } from "@/domain/time";
import { assessGlucoseTrend } from "@/domain/trend";
import { useLatestData, useTimeline } from "@/hooks/useTimeline";
import { useDailyHealthMetrics } from "@/hooks/useDailyHealthMetrics";
import type { RootTabParamList } from "@/navigation/AppNavigator";
import { useDataContext } from "@/providers/DataProvider";

type TodayRange = "6h" | "12h" | "24h";
const RANGE_HOURS: Record<TodayRange, number> = {
  "6h": 6,
  "12h": 12,
  "24h": 24,
};

export function TodayScreen() {
  const route = useRoute<RouteProp<RootTabParamList, "Today">>();
  const navigation = useNavigation<NavigationProp<RootTabParamList, "Today">>();
  const { deleteManualContext, now, refreshData, sourceError, syncing, today } =
    useDataContext();
  const [rangeChoice, setRangeChoice] = useState<TodayRange>("6h");
  const [foodLaunchRequest, setFoodLaunchRequest] = useState(0);
  const [contextLaunchRequest, setContextLaunchRequest] = useState(0);
  const [logLauncherVisible, setLogLauncherVisible] = useState(false);
  const [initialContextKind, setInitialContextKind] =
    useState<ManualContextKind>("meal");
  const [contextKindLocked, setContextKindLocked] = useState(false);
  const range = useMemo(
    () => ({
      start: now - RANGE_HOURS[rangeChoice] * 3_600_000,
      end: now,
    }),
    [now, rangeChoice],
  );
  const selectedTimeline = useTimeline(
    range,
    `today:${today}:timeline:${rangeChoice}`,
  );
  const todayTimeline = useTimeline(
    dayRange(today, now),
    `today:${today}:full-day`,
  );
  const dailyHealth = useDailyHealthMetrics(dayRange(today, now));
  const latest = useLatestData();
  const heroRange = useMemo(() => {
    const end = latest.reading?.timestamp ?? now;
    return { start: end - 4 * 3_600_000, end: end + 1 };
  }, [latest.reading?.timestamp, now]);
  const heroTimeline = useTimeline(heroRange, `today:${today}:hero`);
  const glucoseSource = latest.sources.find(
    (source) => source.label === "Glucose",
  );
  const insulinSource = todayTimeline.data?.sources.find(
    (source) => source.label === "Insulin",
  );
  const trendAssessment = useMemo(
    () =>
      assessGlucoseTrend(latest.reading, selectedTimeline.data?.glucose ?? []),
    [latest.reading, selectedTimeline.data?.glucose],
  );

  useEffect(() => {
    if (!route.params?.action) return;
    if (route.params.action === "log-food") {
      // This route parameter is a one-shot navigation command; incrementing the
      // child launch token is its intentional effect on the mounted Today screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFoodLaunchRequest((value) => value + 1);
    } else if (route.params.action === "log-context") {
      setInitialContextKind("meal");
      setContextKindLocked(false);
      setContextLaunchRequest((value) => value + 1);
    }
    navigation.setParams({ action: undefined, request: undefined });
  }, [navigation, route.params?.action, route.params?.request]);

  function chooseLogEntry(kind: LogEntryKind) {
    if (kind === "food") {
      setFoodLaunchRequest((value) => value + 1);
    } else {
      setInitialContextKind(kind);
      setContextKindLocked(true);
      setContextLaunchRequest((value) => value + 1);
    }
  }

  const glucoseStats = selectedTimeline.data
    ? calculateGlucoseStats(selectedTimeline.data.glucose, range)
    : undefined;
  const insulinSummary = todayTimeline.data
    ? summarizeInsulinRange(
        todayTimeline.data.basal,
        todayTimeline.data.boluses,
        dayRange(today, now),
        todayTimeline.data.dailyInsulinTotals,
      )
    : undefined;
  const todayKetones =
    todayTimeline.data?.context.filter(isManualKetoneEvent) ?? [];

  return (
    <View style={styles.screen}>
      <AppScreen
        title="Today"
        quietHeader
        refreshing={syncing}
        onRefresh={() => void refreshData()}
        trailing={<AppMenuButton />}
      >
        {latest.loading && !latest.reading ? (
          <LoadingCard label="Loading saved glucose…" />
        ) : (
          <CurrentGlucoseCard
            history={heroTimeline.data?.glucose}
            reading={latest.reading}
            source={glucoseSource}
            now={now}
            trendAssessment={trendAssessment}
            onChooseSource={() =>
              navigation.navigate("Sources", {
                focused: false,
                source: undefined,
              })
            }
          />
        )}
        {latest.error || sourceError ? (
          <View style={styles.latestError}>
            <ErrorCard message={latest.error ?? sourceError!} />
          </View>
        ) : null}

        <TodayGlanceCard
          events={todayTimeline.data?.context ?? []}
          glucose={glucoseStats}
          glucoseLabel={`Last ${RANGE_HOURS[rangeChoice]} hours`}
          health={dailyHealth.metrics}
          insulin={insulinSummary?.stats}
          insulinAvailable={insulinSource?.freshness !== "missing"}
          range={dayRange(today, now)}
          onOpenTimeInRange={() =>
            navigation.navigate("History", {
              focus: "glucose",
              request: String(Date.now()),
            })
          }
          onOpenInsulin={() =>
            navigation.navigate("History", {
              focus: "insulin",
              request: String(Date.now()),
            })
          }
        />

        <View style={styles.timeline}>
          {selectedTimeline.error ? (
            <ErrorCard message={selectedTimeline.error} />
          ) : selectedTimeline.loading || !selectedTimeline.data ? (
            <LoadingCard label="Loading timeline…" />
          ) : (
            <View>
              <CombinedTimeline
                data={selectedTimeline.data}
                headerAccessory={
                  <SegmentedControl
                    accessibilityLabel="Timeline range"
                    options={[
                      { value: "6h", label: "6h" },
                      { value: "12h", label: "12h" },
                      { value: "24h", label: "24h" },
                    ]}
                    value={rangeChoice}
                    onChange={setRangeChoice}
                  />
                }
                quiet
                title="Timeline"
              />
            </View>
          )}
        </View>

        {todayTimeline.error ? (
          <View style={styles.ketones}>
            <ErrorCard
              message={`Saved ketone readings are temporarily unavailable. ${todayTimeline.error}`}
            />
          </View>
        ) : todayTimeline.loading && !todayTimeline.data ? (
          <View style={styles.ketones}>
            <LoadingCard label="Loading saved ketone readings…" />
          </View>
        ) : todayKetones.length ? (
          <View style={styles.ketones}>
            <ContextEventList
              events={todayKetones}
              limit={4}
              onDeleteManualKetone={deleteManualContext}
            />
          </View>
        ) : null}

        <View style={styles.safety}>
          <SafetyNote />
        </View>
      </AppScreen>
      <FloatingLogButton
        onPress={() => setLogLauncherVisible(true)}
        style={styles.floatingButton}
      />
      <LogEntryLauncher
        onChoose={chooseLogEntry}
        onClose={() => setLogLauncherVisible(false)}
        visible={logLauncherVisible}
      />
      <FoodLoggerCard
        initialTimestamp={now}
        launchRequest={foodLaunchRequest}
        onModalShow={() => setLogLauncherVisible(false)}
        showLauncher={false}
      />
      <ManualContextCard
        initialKind={initialContextKind}
        initialTimestamp={now}
        launchRequest={contextLaunchRequest}
        lockKind={contextKindLocked}
        onModalShow={() => setLogLauncherVisible(false)}
        showLauncher={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  latestError: {
    marginTop: 12,
  },
  safety: {
    marginTop: 18,
  },
  timeline: {
    marginTop: 28,
  },
  ketones: {
    marginTop: 18,
  },
  floatingButton: {
    right: 18,
    bottom: 18,
  },
});
