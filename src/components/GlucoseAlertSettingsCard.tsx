import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import T1ArcGlucoseDisplay from '../../modules/t1arc-glucose-display';
import {
  getGlucoseAlarmStatus, importGlucoseAlarmSound, loadGlucoseAlarmConfiguration, openGlucoseAlarmExactAlarmSettings,
  previewGlucoseAlarmSound, saveGlucoseAlarmConfiguration, stopGlucoseAlarmPreview,
} from '@/data/glucoseAlerts/glucoseAlarms';
import {
  type GlucoseAlarmConfiguration, type GlucoseAlarmKind, type GlucoseAlarmStatus,
  validateGlucoseAlarmConfiguration,
} from '@/domain/glucoseAlarms';
import { formatGlucose, glucoseToMmolL, glucoseUnitLabel } from '@/domain/regionalFormat';
import { normalizeRegionalNumberInput } from '@/domain/regionalNumberInput';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { AlarmAction, AlarmChoices } from './GlucoseAlarmControls';
import { SectionCard } from './SectionCard';
import { pickerTimeForWallClock, regionalClockUses24Hours } from './zonedDateTimePicker';

const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';
const KINDS: { kind: GlucoseAlarmKind; label: string; enabled: 'lowEnabled' | 'highEnabled' | 'veryHighEnabled' | 'staleEnabled'; sound: 'lowSound' | 'highSound' | 'veryHighSound' | 'staleSound' }[] = [
  { kind: 'low', label: 'Low glucose', enabled: 'lowEnabled', sound: 'lowSound' },
  { kind: 'high', label: 'High glucose', enabled: 'highEnabled', sound: 'highSound' },
  { kind: 'veryHigh', label: 'Very high glucose', enabled: 'veryHighEnabled', sound: 'veryHighSound' },
  { kind: 'stale', label: 'Missing or stale readings', enabled: 'staleEnabled', sound: 'staleSound' },
];
const REPEAT_MINUTES = [0, 5, 10, 15, 20, 30, 60, 120] as const;

export function GlucoseAlertSettingsCard({ connected }: { connected: boolean }) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [configuration, setConfiguration] = useState<GlucoseAlarmConfiguration>();
  const [status, setStatus] = useState<GlucoseAlarmStatus>();
  const [thresholds, setThresholds] = useState({ low: '', high: '', veryHigh: '' });
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState<string>();
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const dirty = useRef(false);
  const mounted = useRef(true);
  const previewGeneration = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stopPreview = useCallback(async () => {
    previewGeneration.current += 1;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = undefined;
    await stopGlucoseAlarmPreview().catch(() => false);
    if (mounted.current) setPreviewing(undefined);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [next, nextStatus] = await Promise.all([loadGlucoseAlarmConfiguration(), getGlucoseAlarmStatus()]);
      if (!mounted.current) return;
      setStatus(nextStatus);
      if (!dirty.current) {
        setConfiguration(next);
        setThresholds({
          low: formatGlucose(next.lowThresholdMmolL, regional, { withUnit: false }),
          high: formatGlucose(next.highThresholdMmolL, regional, { withUnit: false }),
          veryHigh: next.veryHighThresholdMmolL === null ? '' : formatGlucose(next.veryHighThresholdMmolL, regional, { withUnit: false }),
        });
      }
    } catch (error) {
      if (mounted.current) setMessage({ error: true, text: error instanceof Error ? error.message : 'Alert settings could not be loaded.' });
    }
  }, [regional]);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (mounted.current) void refresh(); });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
      else void stopPreview();
    });
    return () => { mounted.current = false; subscription.remove(); void stopPreview(); };
  }, [refresh, stopPreview]);

  function edit(change: Partial<GlucoseAlarmConfiguration>) {
    dirty.current = true;
    setMessage(undefined);
    setConfiguration(current => current ? { ...current, ...change } : current);
  }

  async function requestNotificationPermission() {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
    if (await PermissionsAndroid.check(NOTIFICATION_PERMISSION)) return true;
    return await PermissionsAndroid.request(NOTIFICATION_PERMISSION, {
      title: 'Allow your chosen glucose alerts',
      message: 'T1 Arc needs notification permission for the glucose alerts you choose.',
      buttonPositive: 'Allow', buttonNegative: 'Not now',
    }) === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function persist() {
    if (!configuration || busy) return;
    const parse = (value: string) => {
      const number = normalizeRegionalNumberInput(value, regional.locale)?.value;
      return number === undefined ? NaN : glucoseToMmolL(number, regional.glucoseUnit);
    };
    const next: GlucoseAlarmConfiguration = {
      ...configuration, lowThresholdMmolL: parse(thresholds.low), highThresholdMmolL: parse(thresholds.high),
      veryHighThresholdMmolL: thresholds.veryHigh.trim() ? parse(thresholds.veryHigh) : null,
    };
    const error = validateGlucoseAlarmConfiguration(next);
    if (error) { setMessage({ error: true, text: error }); return; }
    if (next.enabled && !connected) { setMessage({ error: true, text: 'Connect and verify personal glucose before enabling alerts.' }); return; }
    setBusy(true); setMessage(undefined);
    try {
      await stopPreview();
      if (next.enabled && !(await requestNotificationPermission())) {
        setMessage({ error: true, text: 'Allow notifications before enabling glucose alerts.' }); return;
      }
      const nextStatus = await saveGlucoseAlarmConfiguration(next);
      if (!mounted.current) return;
      dirty.current = false; setConfiguration(next); setStatus(nextStatus);
      setMessage({ text: next.enabled ? 'Alert choices saved on this phone.' : 'T1 Arc glucose alerts are off.' });
    } catch (error) {
      if (mounted.current) setMessage({ error: true, text: error instanceof Error ? error.message : 'Alert choices could not be saved.' });
    } finally { if (mounted.current) setBusy(false); }
  }

  async function play(soundId: string) {
    if (!configuration || busy) return;
    const generation = ++previewGeneration.current;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = undefined;
    await stopGlucoseAlarmPreview().catch(() => false);
    if (generation !== previewGeneration.current || !mounted.current || AppState.currentState !== 'active') return;
    setPreviewing(soundId);
    try {
      const playing = await previewGlucoseAlarmSound(soundId, configuration.volume);
      if (generation !== previewGeneration.current || !mounted.current) { await stopGlucoseAlarmPreview().catch(() => false); return; }
      if (!playing) throw new Error('The sound preview could not start. Check the phone’s alarm volume.');
      previewTimer.current = setTimeout(() => { if (generation === previewGeneration.current) void stopPreview(); }, 6000);
    } catch (error) {
      if (generation === previewGeneration.current && mounted.current) {
        setPreviewing(undefined);
        setMessage({ error: true, text: error instanceof Error ? error.message : 'The sound could not be played.' });
      }
    }
  }

  async function chooseCustomSound(field: typeof KINDS[number]['sound']) {
    if (busy) return;
    setBusy(true); setMessage(undefined);
    let temporaryUri: string | undefined;
    try {
      await stopPreview();
      const selected = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: false, copyToCacheDirectory: true });
      if (selected.canceled) return;
      const asset = selected.assets[0]; if (!asset) return;
      temporaryUri = asset.uri;
      const sound = await importGlucoseAlarmSound(asset.uri, asset.name);
      if (!mounted.current) return;
      edit({ [field]: sound.id });
      const nextStatus = await getGlucoseAlarmStatus();
      if (!mounted.current) return;
      setStatus(nextStatus);
      setMessage({ text: `${sound.name} selected. Save alert choices to use it. No sound has been played.` });
    } catch (error) {
      if (mounted.current) setMessage({ error: true, text: error instanceof Error ? error.message : 'The sound file could not be imported.' });
    } finally {
      if (temporaryUri?.startsWith('file:')) { try { const cached = new File(temporaryUri); if (cached.exists) cached.delete(); } catch { /* Android also clears this cache. */ } }
      if (mounted.current) setBusy(false);
    }
  }

  function chooseNightTime(field: 'nightStartMinutes' | 'nightEndMinutes') {
    if (!configuration || busy || Platform.OS !== 'android') return;
    const value = configuration[field];
    DateTimePickerAndroid.open({
      value: pickerTimeForWallClock(Math.floor(value / 60), value % 60), mode: 'time', display: 'clock', is24Hour: regionalClockUses24Hours(regional.locale),
      onChange: (event, selected) => { if (event.type === 'set' && selected) edit({ [field]: selected.getHours() * 60 + selected.getMinutes() }); },
    });
  }

  const clock = (minutes: number) => new Intl.DateTimeFormat(regional.locale, { hour: 'numeric', minute: '2-digit' }).format(pickerTimeForWallClock(Math.floor(minutes / 60), minutes % 60));
  const soundName = (id: string) => id === 'pulse' ? 'Steady pulse' : id === 'notes' ? 'Two notes' : status?.customSounds.find(sound => sound.id === id)?.name ?? 'Custom sound';

  if (!configuration) return <SectionCard><Text style={[styles.body, { color: colors.textSecondary }]}>{message?.text ?? 'Loading alert choices…'}</Text></SectionCard>;

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: `${colors.warning}18`, borderRadius: radius.md }]}><Ionicons accessibilityElementsHidden name="notifications-outline" size={23} color={colors.warning} /></View>
        <View style={styles.copy}><Text style={[styles.title, { color: colors.text }]}>Glucose alerts</Text><Text style={[styles.body, { color: colors.textSecondary }]}>Choose glucose levels, sounds and quiet hours. Changes take effect when you save.</Text></View>
      </View>
      <SettingSwitch label="Allow T1 Arc alerts" detail="Uses the selected glucose source on this phone." value={configuration.enabled} disabled={busy} onChange={enabled => edit({ enabled })} />
      <SettingSwitch label="Allow alarm sounds" detail="Uses Android’s alarm audio, including while the ringer is on vibrate. Saving can sound an alert if glucose is already outside your levels." value={configuration.audioEnabled} disabled={busy || !configuration.enabled} onChange={audioEnabled => edit({ audioEnabled })} />
      {KINDS.map(item => (
        <View key={item.kind} style={[styles.section, { borderColor: colors.border }]}>
          <SettingSwitch label={item.label} detail={item.kind === 'stale' ? 'A separate warning when glucose updates stop.' : item.kind === 'high' && configuration.nightEnabled ? 'Shown silently during your night schedule.' : 'Uses the glucose threshold you choose below.'} value={configuration[item.enabled]} disabled={busy} onChange={enabled => edit({ [item.enabled]: enabled })} />
          {item.kind !== 'stale' ? <View style={styles.inputRow}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Threshold</Text>
            <TextInput accessibilityLabel={`${item.label} threshold in ${glucoseUnitLabel(regional.glucoseUnit)}`} keyboardType="decimal-pad" editable={!busy} placeholder={item.kind === 'veryHigh' ? 'Choose' : undefined} placeholderTextColor={colors.textTertiary} value={thresholds[item.kind]} onChangeText={value => { dirty.current = true; setThresholds(current => ({ ...current, [item.kind]: value })); }} style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.sm }]} />
            <Text style={[styles.unit, { color: colors.textSecondary }]}>{glucoseUnitLabel(regional.glucoseUnit)}</Text>
          </View> : null}
          <Text style={[styles.label, { color: colors.textSecondary }]}>Sound · {soundName(configuration[item.sound])}</Text>
          <AlarmChoices>
            <AlarmAction label="Steady pulse" selected={configuration[item.sound] === 'pulse'} disabled={busy} onPress={() => edit({ [item.sound]: 'pulse' })} />
            <AlarmAction label="Two notes" selected={configuration[item.sound] === 'notes'} disabled={busy} onPress={() => edit({ [item.sound]: 'notes' })} />
            <AlarmAction label="Choose audio file" disabled={busy} onPress={() => void chooseCustomSound(item.sound)} />
            {status?.customSounds.map(sound => <AlarmAction key={sound.id} label={sound.name} selected={configuration[item.sound] === sound.id} disabled={busy} onPress={() => edit({ [item.sound]: sound.id })} />)}
          </AlarmChoices>
          <Text style={[styles.foot, { color: colors.textSecondary }]}>Preview uses this phone’s alarm volume. Check that level before pressing Play.</Text>
          <AlarmChoices>
            <AlarmAction label={`Play ${item.label.toLowerCase()} sound`} disabled={busy || !!previewing} onPress={() => void play(configuration[item.sound])} />
            <AlarmAction label="Stop preview" onPress={() => void stopPreview()} />
          </AlarmChoices>
        </View>
      ))}
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.text }]}>Sound preview</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>Play is the only way to start a preview. Each sample stops after six seconds. Phone alarm volume also applies.</Text>
        <AlarmAction label={previewing ? 'Stop preview' : 'Stop preview · not playing'} onPress={() => void stopPreview()} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>Sound level</Text>
        <AlarmChoices>{[0.15, 0.35, 0.6, 1].map(volume => <AlarmAction key={volume} label={`${Math.round(volume * 100)}%`} selected={configuration.volume === volume} disabled={busy} onPress={() => { void stopPreview(); edit({ volume }); }} />)}</AlarmChoices>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Rise to chosen level</Text>
        <AlarmChoices>{[0, 3, 5, 10].map(rampSeconds => <AlarmAction key={rampSeconds} label={rampSeconds === 0 ? 'Immediately' : `${rampSeconds} sec`} selected={configuration.rampSeconds === rampSeconds} disabled={busy} onPress={() => edit({ rampSeconds })} />)}</AlarmChoices>
        <Text style={[styles.foot, { color: colors.textSecondary }]}>The built-in sounds have not been validated for waking people. Check the actual sound and volume on your own phone.</Text>
      </View>
      <View style={[styles.section, { borderColor: colors.border }]}>
        <SettingSwitch label="Night schedule" detail="Low and very high keep their chosen sounds. Ordinary high is silent, with no notification vibration. Times follow this phone’s clock." value={configuration.nightEnabled} disabled={busy} onChange={nightEnabled => edit({ nightEnabled })} />
        <AlarmChoices><AlarmAction label={`From ${clock(configuration.nightStartMinutes)}`} disabled={busy} onPress={() => chooseNightTime('nightStartMinutes')} /><AlarmAction label={`Until ${clock(configuration.nightEndMinutes)}`} disabled={busy} onPress={() => chooseNightTime('nightEndMinutes')} /></AlarmChoices>
      </View>
      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.text }]}>Repeat while unresolved</Text>
        <AlarmChoices>{REPEAT_MINUTES.map(repeatMinutes => <AlarmAction key={repeatMinutes} label={repeatMinutes === 0 ? 'Never' : repeatMinutes >= 60 ? `${repeatMinutes / 60} ${repeatMinutes === 60 ? 'hour' : 'hours'}` : `${repeatMinutes} min`} selected={configuration.repeatMinutes === repeatMinutes} disabled={busy} onPress={() => edit({ repeatMinutes })} />)}</AlarmChoices>
        <Text style={[styles.foot, { color: colors.textSecondary }]}>Snooze controls appear with an active alert: 5, 10, 15, 20 or 30 minutes, 1 hour, or a clock time you choose.</Text>
      </View>
      {status?.readinessIssues.map(issue => <Text key={issue} style={[styles.body, { color: colors.warning }]}>{issue}</Text>)}
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: message.error ? colors.danger : colors.accent }]}>{message.text}</Text> : null}
      <AlarmAction label={busy ? 'Saving…' : configuration.audioEnabled && configuration.enabled ? 'Save and arm alarm sounds' : 'Save alert choices'} primary disabled={busy} onPress={() => void persist()} />
      <AlarmAction label="Android notification settings" onPress={() => void T1ArcGlucoseDisplay.openGlucoseAlertAppSettingsAsync().catch(() => false)} />
      <AlarmAction label="Allow precise alarm timing" onPress={() => void openGlucoseAlarmExactAlarmSettings().catch(error => setMessage({ error: true, text: error instanceof Error ? error.message : 'Android alarm timing settings could not be opened.' }))} />
      <Text style={[styles.foot, { color: colors.textSecondary }]}>Phone notification and alarm permissions, alarm volume, and background restrictions still apply.</Text>
    </SectionCard>
  );
}

function SettingSwitch({ label, detail, value, disabled, onChange }: { label: string; detail: string; value: boolean; disabled: boolean; onChange(value: boolean): void }) {
  const { colors } = useAppTheme();
  return <View style={styles.settingRow}><View style={styles.copy}><Text style={[styles.label, { color: colors.text }]}>{label}</Text><Text style={[styles.foot, { color: colors.textSecondary }]}>{detail}</Text></View><Switch accessibilityLabel={label} disabled={disabled} value={value} onValueChange={onChange} thumbColor={value ? colors.primary : undefined} trackColor={{ false: colors.border, true: `${colors.primary}66` }} /></View>;
}

const styles = StyleSheet.create({
  card: { gap: 16 }, header: { flexDirection: 'row', alignItems: 'flex-start', gap: 13 }, copy: { flex: 1 }, icon: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '800' }, heading: { fontSize: 16, lineHeight: 22, fontWeight: '800' }, body: { fontSize: 13, lineHeight: 20 }, foot: { fontSize: 12, lineHeight: 18 }, label: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, gap: 10 }, settingRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, input: { minHeight: 44, minWidth: 86, paddingHorizontal: 10, paddingVertical: 7, fontSize: 16, lineHeight: 22, borderWidth: 1, textAlign: 'center', fontVariant: ['tabular-nums'] }, unit: { fontSize: 12, lineHeight: 18 },
});
