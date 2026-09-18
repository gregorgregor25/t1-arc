import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DaymarkGlucoseDisplay, { GarminCompanionStatus } from '../../modules/daymark-glucose-display';
import { useAppTheme } from '@/theme/theme';
import { SectionCard } from './SectionCard';

const descriptions: Record<string, string> = {
  disabled: 'Choose your paired Garmin watch to share glucose with it.',
  starting: 'Connecting to Garmin Connect…',
  disconnected: 'Watch disconnected. The newest reading will be sent when it reconnects.',
  'app-missing': 'Install T1 Arc Beta on this watch and open it once, then check again.',
  'checking-app': 'Checking for the watch companion…',
  confirmed: 'The watch acknowledged the latest update.',
  sending: 'Waiting for the watch to acknowledge the update…',
  unconfirmed: 'No acknowledgement after three attempts. Open Garmin Connect and check the watch.',
};

const setupSteps = [
  ['1. Set up the two phone apps', [
    'On your Android phone, open T1 Arc Garmin Beta. Connect your glucose source and check the reading and its time. The beta has separate settings from your normal T1 Arc app.',
    'On the same phone, install or open Garmin Connect (Garmin’s own app). Sign in to your Garmin account and pair your Venu 2 Plus using Garmin Connect.',
    'Now leave Garmin Connect and return to T1 Arc Garmin Beta on your phone. Tap Sources → Displays & watch. In the Glucose at a glance section near the top, turn on Keep glucose visible. Allow notifications if Android asks. Keep this switch on during testing.',
    'All Sources and Displays & watch instructions in this guide refer to T1 Arc Garmin Beta on your phone. Keep your normal CGM app and alerts available.',
  ]],
  ['2. On your computer: extract the tester pack', [
    'On a Windows PC or Mac, download the T1Arc-Garmin-Beta-0.4.zip attachment from the GitHub beta release linked by the person inviting you. Extract the ZIP (on Windows, right-click it and choose Extract All). Choose the tester ZIP, not GitHub’s Source code download.',
    'Inside the extracted folder, T1Arc-Garmin-Beta-Android.apk is for the phone. The watch folder contains separate Garmin files. Installing the phone APK does not install anything on the watch.',
  ]],
  ['3. On your computer: find the watch folder', [
    'Connect the Venu 2 Plus to your computer using the watch’s USB data cable. On Windows, open File Explorer → This PC → your Garmin watch, then Internal Storage if shown. Open the GARMIN folder on the watch, then its APPS folder.',
    'On a Mac, an MTP file-transfer app may be needed to browse the watch. If you cannot see the watch or its GARMIN/APPS folder, contact the person who invited you before continuing.',
  ]],
  ['4. On your computer: copy the companion to the watch', [
    'In the tester pack you extracted on your computer, open the watch folder. Copy T1Arc-venu2plus.prg from that folder into the GARMIN/APPS folder on the connected watch. Do not copy the ZIP or Android APK to the watch.',
    'T1Arc-venu2plus.prg is only for Venu 2 Plus. For another model, use its exact matching file listed in TESTER-GUIDE.md in the tester pack. Never rename another model’s file to make it fit.',
  ]],
  ['5. On your watch: open T1 Arc Beta once', [
    'Safely eject the watch from your computer and unplug its USB cable. On the watch itself, open its app list, find T1 Arc Beta and open it once. This registers the companion to receive updates when you return to your watch face.',
  ]],
  ['6. On your phone: choose the Garmin watch', [
    'Open T1 Arc Garmin Beta on your phone. Tap Sources → Displays & watch, then scroll down to the Garmin section. If this guide is open, tap Close instructions.',
    'In that Garmin section, tap Check Garmin connection. Choose mmol/L or mg/dL, then tap your watch in the paired-watch list. Pairing in Garmin Connect (step 1) and selecting the watch in T1 Arc Garmin Beta are both needed.',
    'Wait for T1 Arc Garmin Beta on the phone to say “The watch acknowledged the latest update”. On the watch, open T1 Arc Beta and compare its value, units and measurement time with the reading in the phone beta. If your watch is missing from the phone’s list, open Garmin Connect on the phone and check that the watch is paired and connected; then return to the Garmin section in T1 Arc Garmin Beta and check again.',
  ]],
  ['7. On your watch: display the complication', [
    'Choose a watch face that supports third-party Connect IQ complications. In that face’s own settings, choose T1 Arc glucose (beta) for a complication slot. Depending on the face, its settings may be on the watch or in the Connect IQ Store app on your phone. These are the watch face’s settings, not the Sources screen in T1 Arc Garmin Beta. The exact menu depends on the face.',
    'Check that the face shows the full reading time and units. An ordinary stock data field may not support this complication. If your face cannot select it, Venu 2 Plus testers can use the optional diagnostic face: reconnect the watch to the computer, copy watch/T1Arc-Diagnostic-venu2plus.prg from the extracted tester pack into the watch’s GARMIN/APPS folder, then safely eject it. On the watch, select T1 Arc Diagnostic as the watch face. Keep the T1 Arc Beta companion installed and open it once before switching to the face.',
  ]],
  ['8. Test the watch and send feedback from the phone', [
    'On the watch, return to the chosen watch face. Lock your phone and check that new readings continue to arrive on the watch. Follow TESTER-GUIDE.md in the extracted tester pack for the full test checklist.',
    'If something goes wrong, unlock the phone and open T1 Arc Garmin Beta → Sources → Displays & watch → Garmin. Tap Share diagnostic report before tapping Check Garmin connection or restarting. In Android’s share menu, choose your email or messaging app, select the person helping you test, attach a short description and send it. Creating a report does not send it automatically.',
    'Include what happened, the approximate time, your watch firmware and watch face name. On the watch, OLD means stale and D means delayed or a source error. Always check the reading time.',
  ]],
] as const;

export function GarminCompanionCard() {
  const { colors, radius } = useAppTheme();
  const [status, setStatus] = useState<GarminCompanionStatus>();
  const [units, setUnits] = useState<'mmol/L' | 'mg/dL'>('mmol/L');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [setupVisible, setSetupVisible] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const next = await DaymarkGlucoseDisplay.getGarminStatusAsync();
      setStatus(next);
    } catch { setError('Garmin status is unavailable. Reopen T1 Arc and try again.'); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => { if (status?.units) setUnits(status.units); }, [status?.units]);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true); setError(undefined);
    try { await action(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update Garmin sync.'); }
    finally { setBusy(false); }
  }
  const button = (label: string, action: () => void, selected = false) => (
    <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled: busy }} disabled={busy}
      onPress={action} style={[styles.button, { borderColor: selected ? colors.accent : colors.border, borderRadius: radius.md }]}>
      <Text style={{ color: selected ? colors.accent : colors.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );

  return (
    <SectionCard accessibilityLabel="Garmin companion beta">
      <Text style={[styles.title, { color: colors.text }]}>Garmin · hardware beta</Text>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>
        Share glucose with T1 Arc Beta on your Garmin watch. Choose the T1 Arc glucose complication in a compatible face.
      </Text>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>
        This hardware beta needs a computer and the watch’s USB data cable to install the watch companion. It is not available in the Connect IQ Store yet. Follow the installation instructions before choosing your watch below.
      </Text>
      {button('Installation instructions', () => setSetupVisible(true))}
      <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.text }]}>
        {error || status?.error || descriptions[status?.state ?? 'starting'] || 'Garmin is unavailable on this device.'}
      </Text>
      {status?.enabled && !status.backgroundSyncEnabled ? <Text style={[styles.copy, { color: colors.warning }]}>Background glucose refresh is off. In this phone app, scroll up to Glucose at a glance and turn on Keep glucose visible.</Text> : null}
      <View style={styles.row}>
        {(['mmol/L', 'mg/dL'] as const).map((unit) => <View key={unit} style={styles.flex}>
          {button(unit, () => {
            setUnits(unit);
            if (status?.selectedDeviceId) void perform(() => DaymarkGlucoseDisplay.selectGarminDeviceAsync(status.selectedDeviceId!, unit));
          }, units === unit)}
        </View>)}
      </View>
      {status?.devices.map((device) => <View key={device.id}>
        {button(`${device.name} · ${device.connected ? 'connected' : 'offline'}`, () => void perform(() => DaymarkGlucoseDisplay.selectGarminDeviceAsync(device.id, units)), status.selectedDeviceId === device.id)}
      </View>)}
      {button('Check Garmin connection', () => void perform(() => DaymarkGlucoseDisplay.retryGarminAsync()))}
      {button('Open Garmin Connect in Play Store', () => void perform(() => Linking.openURL('https://play.google.com/store/apps/details?id=com.garmin.android.apps.connectmobile')))}
      {status?.enabled ? button('Stop sharing with Garmin', () => void perform(() => DaymarkGlucoseDisplay.selectGarminDeviceAsync('', units))) : null}
      {button('Share diagnostic report', () => void perform(() => DaymarkGlucoseDisplay.shareGarminDiagnosticsAsync()))}
      <Text style={[styles.small, { color: colors.textTertiary }]}>Beta 0.4 · If something goes wrong, share a report before checking the connection again. It includes recent connection and delivery times, phone model and software versions. No glucose values, credentials or watch identifiers. Choose who receives it in the share menu; nothing is uploaded automatically.</Text>
      {status?.confirmedAt ? <Text style={[styles.small, { color: colors.textTertiary }]}>Acknowledged {new Date(status.confirmedAt).toLocaleTimeString()} · {status.route === 'background' ? 'watch app in background' : 'watch app open'}</Text> : null}
      <Text style={[styles.small, { color: colors.textTertiary }]}>Hardware testing is in progress. Check the reading time on the watch; a face can retain an old value. OLD means stale, D means delayed or a source error. This beta shares your reading with the selected watch and its configured complication face.</Text>
      <Modal visible={setupVisible} transparent animationType="fade" onRequestClose={() => setSetupVisible(false)}>
        <View style={styles.overlay}>
          <View accessibilityViewIsModal style={[styles.guide, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Install the Garmin companion</Text>
            <ScrollView style={styles.guideScroll} contentContainerStyle={styles.guideContent}>
              <Text style={[styles.copy, { color: colors.text }]}>Venu 2 Plus hardware beta · Computer required</Text>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>There is no phone-only installation for this tester pack. If you do not have access to a computer and USB data cable, contact the person who invited you to arrange setup help.</Text>
              {setupSteps.map(([title, paragraphs]) => <View key={title} style={styles.step}>
                <Text accessibilityRole="header" style={[styles.stepTitle, { color: colors.text }]}>{title}</Text>
                {paragraphs.map((paragraph) => <Text key={paragraph} style={[styles.copy, { color: colors.textSecondary }]}>{paragraph}</Text>)}
              </View>)}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={() => setSetupVisible(false)} style={[styles.button, { borderColor: colors.border, borderRadius: radius.md }]}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Close instructions</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 20, paddingVertical: 48, justifyContent: 'center' },
  guide: { maxHeight: '100%', padding: 20 },
  guideScroll: { flexShrink: 1, marginTop: 8 },
  guideContent: { paddingBottom: 12 },
  step: { marginTop: 22 },
  stepTitle: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 19, fontWeight: '800' },
  copy: { fontSize: 13, lineHeight: 20, marginTop: 10 },
  small: { fontSize: 11, lineHeight: 17, marginTop: 12 },
  button: { borderWidth: 1, minHeight: 48, padding: 12, justifyContent: 'center', marginTop: 10 },
  row: { flexDirection: 'row', gap: 10 }, flex: { flex: 1 },
});
