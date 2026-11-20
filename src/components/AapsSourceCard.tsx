import Ionicons from '@expo/vector-icons/Ionicons';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import {
  DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL,
  loadAapsNightscoutTreatmentFill,
  saveAapsNightscoutTreatmentFill,
} from '@/data/aaps/aapsTreatmentFill';
import {
  disableAapsLocalSource,
  enableAapsLocalSource,
  getAapsLocalSourceStatus,
} from '@/data/aaps/localAapsSource';
import {
  loadAapsLocalTreatmentRoute,
  saveAapsLocalTreatmentRoute,
} from '@/data/aaps/localAapsTreatments';
import { seedNightscoutHistoryAfterSourceChange } from '@/data/nightscout/historyStateStore';
import { loadNightscoutConnection } from '@/data/nightscout/secureStore';
import { formatTime, relativeAge } from '@/domain/time';
import { type SourceReloadOptions, useDataContext } from '@/providers/DataProvider';
import { startForegroundInterval } from '@/hooks/foregroundInterval';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type Status = Awaited<ReturnType<typeof getAapsLocalSourceStatus>>;

function siteHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'your Nightscout site';
  }
}

export function AapsSourceCard({
  foodTotals,
  onDataChanged,
  onOpenNightscout,
}: {
  /** "Count carbs from" choice, shown while AAPS is the selected source. */
  foodTotals?: ReactNode;
  onDataChanged?: (options?: SourceReloadOptions) => Promise<void> | void;
  onOpenNightscout?: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const { now, revision, demoMode, setDataMode } = useDataContext();
  const [status, setStatus] = useState<Status>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const refreshGeneration = useRef(0);
  const [nightscoutHost, setNightscoutHost] = useState<string | null>();
  const [fillEnabled, setFillEnabled] = useState(DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL);
  const [fillWorking, setFillWorking] = useState(false);
  const [fillError, setFillError] = useState<string>();
  // The on-phone treatment route is off until the user turns it on.
  const [localRouteEnabled, setLocalRouteEnabled] = useState(false);
  const [localRouteWorking, setLocalRouteWorking] = useState(false);
  const [localRouteError, setLocalRouteError] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadNightscoutConnection().catch(() => undefined),
      loadAapsNightscoutTreatmentFill().catch(() => undefined),
      loadAapsLocalTreatmentRoute().catch(() => false),
    ]).then(([connection, preference, localRoute]) => {
      if (!active) return;
      setNightscoutHost(connection ? siteHost(connection.baseUrl) : null);
      setFillEnabled(preference?.enabled ?? DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL);
      setLocalRouteEnabled(localRoute);
    });
    return () => {
      active = false;
    };
  }, [revision]);

  async function changeFill(enabled: boolean) {
    if (fillWorking) return;
    setFillWorking(true);
    setFillError(undefined);
    try {
      const saved = await saveAapsNightscoutTreatmentFill(enabled);
      setFillEnabled(saved.enabled);
      if (saved.enabled) {
        // Read the last 14 days of treatments again, now that they are
        // wanted. Best effort: the choice itself is already saved.
        await seedNightscoutHistoryAfterSourceChange('fill-enabled').catch(() => undefined);
      }
      await onDataChanged?.({ refreshNow: saved.enabled });
    } catch {
      setFillError('The Nightscout history choice could not be saved. Try again.');
    } finally {
      setFillWorking(false);
    }
  }

  async function changeLocalRoute(enabled: boolean) {
    if (localRouteWorking) return;
    setLocalRouteWorking(true);
    setLocalRouteError(undefined);
    try {
      setLocalRouteEnabled(await saveAapsLocalTreatmentRoute(enabled));
      await onDataChanged?.();
    } catch {
      setLocalRouteError('The on-phone AAPS treatment choice could not be saved. Try again.');
    } finally {
      setLocalRouteWorking(false);
    }
  }

  const refreshStatus = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const next = await getAapsLocalSourceStatus();
      if (generation !== refreshGeneration.current) return;
      setStatus(next);
      setError(undefined);
    } catch {
      if (generation !== refreshGeneration.current) return;
      setError('T1 Arc could not read the AAPS source status. Try again.');
    } finally {
      if (generation === refreshGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refreshStatus);
    // Paused in the background; refreshed straight away on return.
    const stop = startForegroundInterval(() => void refreshStatus(), 30_000, AppState, {
      runOnResume: true,
    });
    return () => {
      refreshGeneration.current += 1;
      stop();
    };
  }, [refreshStatus, revision]);

  const selected = status?.selectedSourceId === 'aaps-local';

  async function chooseSource() {
    if (working) return;
    refreshGeneration.current += 1;
    setWorking(true);
    setError(undefined);
    try {
      // Choosing a personal source is an explicit exit from demonstration data.
      // The lower-level selector still refuses intake while demo mode is saved.
      if (!selected && demoMode) {
        // Fence cached cloud glucose before leaving demo, including if setup fails.
        await disableAapsLocalSource();
        await setDataMode('live');
      }
      const next = selected
        ? await disableAapsLocalSource()
        : await enableAapsLocalSource();
      setStatus(next);
      await onDataChanged?.();
    } catch (reason) {
      await refreshStatus();
      setError(
        reason instanceof Error
          ? reason.message
          : 'The AAPS source could not be changed. Try again.',
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <SectionCard accessibilityLabel="AAPS local source">
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.text }]}>AAPS on this phone</Text>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
      </View>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Glucose from Juggluco through AAPS, with AAPS estimates for insulin on board and carbs on board, and the boluses and carbs AAPS recorded.
      </Text>
      <Text style={[styles.status, { color: selected ? colors.accent : colors.textSecondary }]}>
        {selected ? 'Selected glucose source' : 'Not selected'}
      </Text>
      {selected ? (
        <View style={styles.readings}>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            AAPS update: {status?.lastReceivedAt === undefined ? 'Waiting for AAPS' : relativeAge(status.lastReceivedAt, now)}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Sensor reading: {status?.latestGlucoseTimestamp === undefined
              ? 'No glucose received yet'
              : `${formatTime(status.latestGlucoseTimestamp)} · ${relativeAge(status.latestGlucoseTimestamp, now)}`}
          </Text>
        </View>
      ) : null}
      {selected ? (
        <View style={[styles.fill, { borderColor: colors.border }]}>
          <View style={styles.fillRow}>
            <View style={styles.fillCopy}>
              <Text style={[styles.fillTitle, { color: colors.text }]}>
                Fill insulin and carb history from my Nightscout site
              </Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                T1 Arc reads the boluses, carbs, temporary basals, profile switches, temporary targets and pump suspensions that AAPS uploaded to Nightscout. This uses the internet and your saved Nightscout read token. Nothing is sent to Nightscout, and glucose still comes only from AAPS on this phone.
              </Text>
            </View>
            {nightscoutHost ? (
              <Switch
                accessibilityLabel="Fill insulin and carb history from my Nightscout site"
                accessibilityState={{ disabled: fillWorking }}
                disabled={fillWorking}
                onValueChange={(value) => void changeFill(value)}
                thumbColor={fillEnabled ? colors.primary : colors.textTertiary}
                trackColor={{ false: colors.border, true: `${colors.primary}66` }}
                value={fillEnabled}
              />
            ) : null}
          </View>
          {nightscoutHost ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {fillEnabled
                ? `On · reading treatment history from ${nightscoutHost}`
                : `Off · ${nightscoutHost} is connected but not read while AAPS is selected`}
            </Text>
          ) : nightscoutHost === null ? (
            <>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Connect your Nightscout site first. Its glucose readings are not used while AAPS is selected.
              </Text>
              {onOpenNightscout ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onOpenNightscout}
                  style={({ pressed }) => [
                    styles.linkButton,
                    { borderColor: colors.border, borderRadius: radius.md, opacity: pressed ? 0.72 : 1 },
                  ]}
                >
                  <Text style={[styles.linkText, { color: colors.primary }]}>Set up Nightscout</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {fillError ? (
            <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{fillError}</Text>
          ) : null}
        </View>
      ) : null}
      {selected && foodTotals ? <View style={styles.foodTotals}>{foodTotals}</View> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{error}</Text> : null}
      {(status?.droppedCount ?? 0) > 0 ? (
        <Text accessibilityRole="alert" style={[styles.body, { color: colors.warning }]}>
          Some older AAPS updates exceeded the local buffer while history syncing was unavailable. History may contain gaps.
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: moreOpen }}
        accessibilityHint={moreOpen ? 'Hides more AAPS options' : 'Shows the treatment broadcast option and how to connect AAPS'}
        onPress={() => setMoreOpen((open) => !open)}
        style={({ pressed }) => [styles.moreButton, { borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}
      >
        <Text style={[styles.fillTitle, { color: colors.primary }]}>More options</Text>
        <Ionicons accessibilityElementsHidden color={colors.primary} name={moreOpen ? 'chevron-up' : 'chevron-down'} size={18} />
      </Pressable>
      {moreOpen ? (
        <View>
          {selected ? (
            <View style={[styles.fill, { borderColor: colors.border }]}>
              <View style={styles.fillRow}>
                <View style={styles.fillCopy}>
                  <Text style={[styles.fillTitle, { color: colors.text }]}>
                    Also read AAPS&apos;s xDrip+ treatment broadcasts on this phone
                  </Text>
                  <Text style={[styles.body, { color: colors.textSecondary }]}>
                    Android cannot confirm that these messages come from AAPS, so another app on this phone could send look-alike records. Records received this way are labelled &quot;sender not verified&quot;. Your Nightscout site is the checked route: when both have the same record, T1 Arc uses the Nightscout copy.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Also read AAPS's xDrip+ treatment broadcasts on this phone"
                  accessibilityHint="Android cannot confirm these messages come from AAPS"
                  accessibilityState={{ disabled: localRouteWorking }}
                  disabled={localRouteWorking}
                  onValueChange={(value) => void changeLocalRoute(value)}
                  thumbColor={localRouteEnabled ? colors.primary : colors.textTertiary}
                  trackColor={{ false: colors.border, true: `${colors.primary}66` }}
                  value={localRouteEnabled}
                />
              </View>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {localRouteEnabled
                  ? 'On · records from the broadcast are kept with the label "sender not verified"'
                  : 'Off · treatment broadcasts on this phone are ignored'}
              </Text>
              {localRouteError ? (
                <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{localRouteError}</Text>
              ) : null}
            </View>
          ) : null}
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            In AAPS, enable Config Builder → Synchronization → External Companion Apps for glucose, IOB and COB. To also record boluses, carbs, temporary targets and profile switches without Nightscout, enable Synchronization → xDrip+ and turn on the on-phone broadcast option above. T1 Arc only reads what AAPS shares; it cannot control the pump. If AAPS stops updating, T1 Arc will not switch sources automatically. The existing watch receives glucose; IOB and COB stay on the phone.
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: loading || working || !status?.supported }}
        disabled={loading || working || !status?.supported}
        onPress={() => void chooseSource()}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: selected ? colors.surfaceMuted : colors.primary,
            borderColor: selected ? colors.border : colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.72 : loading || working || !status?.supported ? 0.55 : 1,
          },
        ]}
      >
        <Text style={[styles.buttonText, { color: selected ? colors.text : colors.onPrimary }]}>
          {working ? 'Updating source…' : selected ? 'Stop using AAPS' : 'Use AAPS as glucose source'}
        </Text>
      </Pressable>
      {status && !status.supported ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          This build does not include the AAPS local receiver.
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 18, fontWeight: '700', lineHeight: 24 },
  body: { fontSize: 14, lineHeight: 21 },
  status: { fontSize: 14, fontWeight: '700', lineHeight: 21, marginTop: 12 },
  readings: { gap: 3, marginTop: 8 },
  button: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', marginTop: 18, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 20, marginTop: 16 },
  fill: { borderTopWidth: StyleSheet.hairlineWidth, gap: 8, marginTop: 16, paddingTop: 14 },
  fillRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  fillCopy: { flex: 1, gap: 4 },
  fillTitle: { fontSize: 15, fontWeight: '700', lineHeight: 21 },
  linkButton: { alignItems: 'center', alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  linkText: { fontSize: 15, fontWeight: '700' },
  foodTotals: { marginTop: 16 },
  moreButton: { alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, minHeight: 48, paddingTop: 4 },
});
