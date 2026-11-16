import { useCallback, useEffect, useRef, useState } from 'react';
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
import { loadNightscoutConnection } from '@/data/nightscout/secureStore';
import { formatTime, relativeAge } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
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
  onDataChanged,
  onOpenNightscout,
}: {
  onDataChanged?: () => Promise<void> | void;
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

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadNightscoutConnection().catch(() => undefined),
      loadAapsNightscoutTreatmentFill().catch(() => undefined),
    ]).then(([connection, preference]) => {
      if (!active) return;
      setNightscoutHost(connection ? siteHost(connection.baseUrl) : null);
      setFillEnabled(preference?.enabled ?? DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL);
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
      await onDataChanged?.();
    } catch {
      setFillError('The Nightscout history choice could not be saved. Try again.');
    } finally {
      setFillWorking(false);
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
    const interval = setInterval(() => void refreshStatus(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshStatus();
    });
    return () => {
      refreshGeneration.current += 1;
      clearInterval(interval);
      subscription.remove();
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
      {error ? <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>{error}</Text> : null}
      {(status?.droppedCount ?? 0) > 0 ? (
        <Text accessibilityRole="alert" style={[styles.body, { color: colors.warning }]}>
          Some older AAPS updates exceeded the local buffer while history syncing was unavailable. History may contain gaps.
        </Text>
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
      <Text style={[styles.note, { color: colors.textSecondary }]}>
        In AAPS, enable Config Builder → Synchronization → External Companion Apps for glucose, IOB and COB. To also record boluses, carbs, temporary targets and profile switches on this phone, enable Synchronization → xDrip+. T1 Arc only reads what AAPS shares; it cannot control the pump. If AAPS stops updating, T1 Arc will not switch sources automatically. The existing watch receives glucose; IOB and COB stay on the phone.
      </Text>
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
});
