import { Alert } from '@/components/appAlert';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SectionCard } from '@/components/SectionCard';
import { PrivacyPolicyLink } from '@/components/PrivacyPolicyLink';
import { clearDiagnosticEvents, readDiagnosticEvents } from '@/data/support/diagnosticStore';
import { SUPPORT_MESSAGE_LIMIT, supportDiagnosticSummary, supportReportText } from '@/data/support/diagnostics';
import { exportSupportReport } from '@/data/support/exportSupportReport';
import { sendResponseReport, type ResponseReport } from '@/data/tarvis/responseReport';
import { useAppTheme } from '@/theme/theme';

export function SupportReportCard() {
  const { colors, radius } = useAppTheme();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [id, setId] = useState('');
  const [diagnostics, setDiagnostics] = useState<string>();
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; abort.current?.abort(); }, []);
  const version = Application.nativeApplicationVersion ?? 'unknown';
  const ink = { color: colors.text };
  const muted = { color: colors.textSecondary };
  const ready = message.trim().length > 0 && consent && !busy;
  const preview = message.trim() ? supportReportText(message, includeDiagnostics ? diagnostics : undefined) : '';
  const fullPreview = `Reference: ${id}\nApp version: ${version}\n\n${preview}`;

  function open() {
    const current = ++generation.current;
    setMessage(''); setId(Crypto.randomUUID()); setIncludeDiagnostics(false); setConsent(false);
    setDiagnostics(undefined); setNotice(''); setError(''); setSent(false); setVisible(true);
    void readDiagnosticEvents().then(events => {
      if (current !== generation.current) return;
      setDiagnostics(supportDiagnosticSummary({ version, build: Application.nativeBuildVersion ?? 'unknown',
        os: `${Platform.OS} ${Platform.Version}`,
        model: Platform.OS === 'android' ? Platform.constants.Model : 'unknown' }, events));
    }).catch(() => {
      if (current === generation.current) setNotice('Technical diagnostics are unavailable. You can still describe and report the problem.');
    });
  }
  function dismiss() { generation.current++; setVisible(false); setMessage(''); setDiagnostics(undefined); setConsent(false); }
  function close() {
    if (active.current) return;
    if (message.trim() && !sent) {
      Alert.alert('Discard this draft?', 'Save or share the report first if you want to keep it.', [
        { text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: dismiss },
      ]);
    } else dismiss();
  }
  async function deliver(kind: 'send' | 'save' | 'share') {
    if (!ready || active.current || (kind === 'send' && sent)) return;
    active.current = true; setBusy(true); setError(''); setNotice('');
    const current = generation.current;
    const report: ResponseReport = { id, reason: 'other', text: preview, version, consent };
    try {
      if (kind === 'send') {
        const controller = new AbortController(); abort.current = controller;
        await sendResponseReport(report, controller.signal);
        if (current === generation.current) { setSent(true); setNotice('Accepted for delivery to support@t1arc.com. Keep the reference if you want to follow up.'); }
      } else if (kind === 'save') {
        const outcome = await exportSupportReport(report);
        if (current === generation.current) setNotice(outcome === 'saved' ? 'Report saved to your selected location. It has not been sent to support.' : 'Save cancelled. Your draft is still here.');
      } else {
        await Share.share({ title: 'T1 Arc problem report', message: fullPreview });
        if (current === generation.current) setNotice('The share sheet was opened. T1 Arc cannot confirm whether you sent the report.');
      }
    } catch (failure) {
      if (current === generation.current) setError(kind === 'send' && failure instanceof Error ? failure.message : 'Could not export this report. Your draft is still here; try Share or copy the preview.');
    } finally {
      active.current = false; abort.current = null;
      if (current === generation.current) setBusy(false);
    }
  }
  async function clearLog() {
    if (active.current) return;
    active.current = true; setBusy(true);
    try { await clearDiagnosticEvents(); Alert.alert('Technical log cleared', 'New technical events may be recorded as you use the app.'); }
    catch { Alert.alert('Could not clear the log', 'Please try again.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <SectionCard>
    <Text accessibilityRole="header" style={[styles.title, ink]}>Help and support</Text>
    <Text style={[styles.body, muted]}>Something not working? Send a private report or save one to email to support@t1arc.com. You do not need a GitHub account.</Text>
    <SupportAction label="Report a problem" onPress={open} disabled={busy} primary />
    <Text selectable style={[styles.body, muted]}>support@t1arc.com</Text>
    <SupportAction label="Email support" onPress={() => { void Linking.openURL('mailto:support@t1arc.com').catch(() => Alert.alert('No email app available', 'Email support@t1arc.com from your usual email service.')); }} disabled={busy} />
    <Text style={[styles.body, muted]}>Technical events stay on this phone unless you choose to share them. The log keeps at most 60 events from the last 24 hours, pruning older entries when read or updated. It contains no readings, conversations, passwords, API keys or raw error messages.</Text>
    <SupportAction label="Clear local technical log" onPress={() => { Alert.alert('Clear technical log?', 'This removes diagnostic events, not your health records. It cannot delete reports already sent or exported.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Clear log', style: 'destructive', onPress: () => void clearLog() },
    ]); }} disabled={busy} />
    <Text style={[styles.body, muted]}>Not an emergency or medical support service. If the app cannot open, contact support using the address above.</Text>
    <Modal visible={visible} onRequestClose={close} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, ink, styles.fill]}>Report a problem</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close report" disabled={busy} onPress={close} style={styles.close}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={[styles.body, muted]}>Describe the steps, what you expected and what happened. Do not include passwords or API keys. Only add an email address if you want us to reply.</Text>
            <Text style={[styles.label, ink]}>What went wrong?</Text>
            <TextInput accessibilityLabel="What went wrong?" multiline editable={!busy && !sent} maxLength={SUPPORT_MESSAGE_LIMIT} value={message}
              onChangeText={value => { setMessage(value); setConsent(false); }} textAlignVertical="top"
              style={[styles.input, ink, { borderColor: colors.border, borderRadius: radius.md }]} />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeDiagnostics, disabled: !diagnostics || busy || sent }}
              disabled={!diagnostics || busy || sent} onPress={() => { setIncludeDiagnostics(value => !value); setConsent(false); }} style={styles.check}>
              <Ionicons name={includeDiagnostics ? 'checkbox' : 'square-outline'} size={26} color={colors.primary} />
              <Text style={[styles.body, ink, styles.fill]}>Include technical diagnostics (optional)</Text>
            </Pressable>
            <Text accessibilityRole="header" style={[styles.label, ink]}>Exact report preview</Text>
            <Text selectable style={[styles.preview, ink, { backgroundColor: colors.surface, borderRadius: radius.md }]}>{fullPreview}</Text>
            <Text style={[styles.body, muted]}>Send report uses Cloudflare to deliver this preview, an “other” category and your consent to support@t1arc.com in our Gmail inbox. Nothing else from your records is attached. Reports are kept while investigated; request deletion using the reference. See the privacy policy for transport metadata.</Text>
            <Text style={[styles.body, muted]}>Save creates an unencrypted text file. Share passes the preview to an app you choose. Remove anything you do not want others to see.</Text>
            <PrivacyPolicyLink />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: busy || sent }} disabled={busy || sent}
              onPress={() => setConsent(value => !value)} style={styles.check}>
              <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={26} color={colors.primary} />
              <Text style={[styles.body, ink, styles.fill]}>I have reviewed this report and agree to send or export its contents, including any personal information I chose to add.</Text>
            </Pressable>
            {busy ? <ActivityIndicator accessibilityLabel="Preparing report" color={colors.primary} /> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={[styles.body, ink]}>{notice}</Text> : null}
            {error ? <Text accessibilityRole="alert" style={[styles.body, { color: colors.warning }]}>{error}</Text> : null}
            <SupportAction label={sent ? 'Report accepted' : 'Send report'} onPress={() => void deliver('send')} disabled={!ready || sent} primary />
            <SupportAction label="Save report to a file" onPress={() => void deliver('save')} disabled={!ready} />
            <SupportAction label="Share report" onPress={() => void deliver('share')} disabled={!ready} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </SectionCard>;
}

function SupportAction({ label, onPress, disabled = false, primary = false }: {
  label: string; onPress(): void; disabled?: boolean; primary?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, { borderColor: colors.border, borderRadius: radius.md,
      backgroundColor: primary ? colors.primary : colors.surface, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
    <Text style={[styles.label, { color: primary ? colors.onPrimary : colors.text }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, title: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, marginVertical: 8 }, label: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  button: { minHeight: 48, padding: 12, borderWidth: 1, marginTop: 12, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  input: { minHeight: 140, borderWidth: 1, padding: 12, fontSize: 16, lineHeight: 24 },
  check: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { padding: 12, fontSize: 14, lineHeight: 22 },
});
