import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, findNodeHandle, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  acknowledgeGlucoseAlarm, cancelGlucoseAlarmSnooze, getGlucoseAlarmStatus, snoozeGlucoseAlarm,
} from '@/data/glucoseAlerts/glucoseAlarms';
import {
  customClockSnoozeUntil, GLUCOSE_ALARM_SNOOZE_MINUTES, glucoseAlarmSnoozeUntil,
  type GlucoseAlarmKind, type GlucoseAlarmStatus,
} from '@/domain/glucoseAlarms';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { AlarmAction, AlarmChoices, alarmClockLabel, alarmUntilLabel } from './GlucoseAlarmControls';
import { regionalClockUses24Hours } from './zonedDateTimePicker';

const LABELS: Record<GlucoseAlarmKind, string> = {
  low: 'Low glucose alert', high: 'High glucose alert', veryHigh: 'Very high glucose alert', stale: 'Glucose updates are missing',
};

/** Foreground controls only. Native code owns evaluation and sound playback. */
export function GlucoseAlarmHost() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [status, setStatus] = useState<GlucoseAlarmStatus>();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [observedAt, setObservedAt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [dismissedEpisode, setDismissedEpisode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [confirmation, setConfirmation] = useState<{ episodeId: string; untilMs: number }>();
  const mounted = useRef(true);
  const running = useRef(false);
  const actionBusy = useRef(false);
  const requestGeneration = useRef(0);
  const titleRef = useRef<Text>(null);

  const refresh = useCallback(async () => {
    if (running.current || actionBusy.current || AppState.currentState !== 'active') return;
    running.current = true;
    const generation = ++requestGeneration.current;
    try {
      const next = await getGlucoseAlarmStatus();
      if (mounted.current && generation === requestGeneration.current && AppState.currentState === 'active') { setStatus(next); setObservedAt(Date.now()); }
    } catch { /* A failed status read must not silence or acknowledge an alarm. */ }
    finally { running.current = false; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (Platform.OS !== 'android') return;
    let interval: ReturnType<typeof setInterval> | undefined;
    function activate() {
      if (interval) clearInterval(interval);
      interval = undefined;
      if (AppState.currentState === 'active') {
        void refresh();
        interval = setInterval(() => void refresh(), 2000);
      }
    }
    activate();
    const subscription = AppState.addEventListener('change', state => { setForeground(state === 'active'); activate(); });
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      if (interval) clearInterval(interval);
      subscription.remove();
    };
  }, [refresh]);

  async function perform(action: () => Promise<GlucoseAlarmStatus>, close = true) {
    if (actionBusy.current) return;
    actionBusy.current = true;
    requestGeneration.current += 1;
    setBusy(true); setMessage(undefined);
    try {
      const next = await action();
      if (!mounted.current) return;
      setStatus(next); setConfirmation(undefined);
      if (close) { setExpanded(false); if (next.episodeId) setDismissedEpisode(next.episodeId); }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'The alert could not be updated.');
    } finally {
      actionBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function customTime() {
    if (!status?.episodeId || busy || Platform.OS !== 'android') return;
    const episodeId = status.episodeId;
    DateTimePickerAndroid.open({
      value: new Date(Date.now() + 15 * 60_000), mode: 'time', display: 'clock',
      is24Hour: regionalClockUses24Hours(regional.locale),
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected || !mounted.current) return;
        try {
          const untilMs = customClockSnoozeUntil(selected.getHours(), selected.getMinutes());
          setConfirmation({ episodeId, untilMs }); setMessage(undefined);
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Choose a future snooze time.'); }
      },
    });
  }

  if (Platform.OS !== 'android' || !foreground || !status?.enabled || !status.activeKind || !status.episodeId) return null;
  const episodeId = status.episodeId;
  const snoozed = status.snoozedUntilMs !== null && status.snoozedUntilMs > observedAt;
  // Ordinary high stays non-interrupting on screen; the native night policy controls its notifications.
  const automaticallyExpanded = status.activeKind !== 'high' && !snoozed && !status.acknowledged && dismissedEpisode !== episodeId;
  const visible = expanded || automaticallyExpanded;
  const label = LABELS[status.activeKind];
  const detail = status.missing
    ? 'Current glucose is unavailable. This does not mean glucose has returned to range.'
    : status.readingTimestampMs !== null
      ? `Glucose measurement at ${alarmClockLabel(status.readingTimestampMs, regional.locale)}.`
      : 'Waiting for a current glucose measurement.';
  const dismiss = () => { setExpanded(false); setDismissedEpisode(episodeId); setConfirmation(undefined); };

  return (
    <>
      {!visible ? <View pointerEvents="box-none" style={[styles.bannerWrap, { bottom: insets.bottom + 78 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Manage ${label.toLowerCase()}`} onPress={() => setExpanded(true)} style={[styles.banner, { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radius.md }]}>
          <Text style={[styles.bannerTitle, { color: colors.text }]}>{label}</Text>
          <Text style={[styles.small, { color: colors.textSecondary }]}>{snoozed && status.snoozedUntilMs !== null ? `Snoozed · ${alarmUntilLabel(status.snoozedUntilMs, regional.locale, observedAt)}` : status.acknowledged ? 'Silenced · tap for snooze controls' : 'Tap for alert controls'}</Text>
        </Pressable>
      </View> : null}
      <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={dismiss} onShow={() => { const handle = findNodeHandle(titleRef.current); if (handle) AccessibilityInfo.setAccessibilityFocus(handle); }}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
          <View accessibilityViewIsModal style={[styles.panel, { backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderRadius: radius.xl, maxHeight: height - insets.top - insets.bottom - 40 }]}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{label}</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>{detail}</Text>
              {status.playbackState === 'blocked' ? <Text style={[styles.body, { color: colors.warning }]}>Sound could not start. Check T1 Arc’s alert settings and this phone’s alarm volume.</Text> : null}
              {snoozed && status.snoozedUntilMs !== null ? <Text style={[styles.body, { color: colors.accent }]}>Snoozed · {alarmUntilLabel(status.snoozedUntilMs, regional.locale, observedAt)}</Text> : null}
              {confirmation ? <View style={[styles.confirmation, { borderColor: colors.border }]}>
                <Text style={[styles.heading, { color: colors.text }]}>Snooze this alert?</Text>
                <Text style={[styles.body, { color: colors.text }]}>{alarmUntilLabel(confirmation.untilMs, regional.locale, observedAt)}</Text>
                <Text style={[styles.small, { color: colors.textSecondary }]}>Uses this phone’s local clock. Other alert levels are not snoozed.</Text>
                <AlarmChoices><AlarmAction label="Confirm snooze" primary disabled={busy} onPress={() => void perform(() => snoozeGlucoseAlarm(confirmation.episodeId, confirmation.untilMs))} /><AlarmAction label="Choose again" disabled={busy} onPress={() => { setConfirmation(undefined); customTime(); }} /><AlarmAction label="Cancel" disabled={busy} onPress={() => setConfirmation(undefined)} /></AlarmChoices>
              </View> : <>
                <Text style={[styles.heading, { color: colors.text }]}>Snooze this alert</Text>
                <AlarmChoices>{GLUCOSE_ALARM_SNOOZE_MINUTES.map(minutes => <AlarmAction key={minutes} label={minutes === 60 ? '1 hour' : `${minutes} min`} disabled={busy} onPress={() => void perform(() => snoozeGlucoseAlarm(episodeId, glucoseAlarmSnoozeUntil(minutes)))} />)}<AlarmAction label="Snooze until…" disabled={busy} onPress={customTime} /></AlarmChoices>
                {snoozed ? <AlarmAction label="Cancel snooze" disabled={busy} onPress={() => void perform(() => cancelGlucoseAlarmSnooze(episodeId), false)} /> : null}
                <AlarmAction label="Silence this alert" primary disabled={busy} onPress={() => void perform(() => acknowledgeGlucoseAlarm(episodeId))} />
                <Text style={[styles.small, { color: colors.textSecondary }]}>Silencing is not a recovery. If the alert remains unresolved, your repeat setting controls reminders. A new low or very high alert is separate.</Text>
              </>}
              {message ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.danger }]}>{message}</Text> : null}
              <AlarmAction label="Close controls" disabled={busy} onPress={dismiss} />
              <Text style={[styles.small, { color: colors.textSecondary }]}>Closing these controls does not silence the alarm.</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bannerWrap: { position: 'absolute', left: 16, right: 16 }, banner: { minHeight: 56, borderWidth: 1, paddingVertical: 11, paddingHorizontal: 15, gap: 3 }, bannerTitle: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }, panel: { width: '100%', maxWidth: 480, borderWidth: 1, overflow: 'hidden' }, content: { padding: 22, gap: 16 },
  title: { fontSize: 23, lineHeight: 30, fontWeight: '800' }, heading: { fontSize: 16, lineHeight: 23, fontWeight: '800' }, body: { fontSize: 15, lineHeight: 22 }, small: { fontSize: 12, lineHeight: 18 }, confirmation: { gap: 13, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14 },
});
