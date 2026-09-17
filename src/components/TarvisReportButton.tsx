import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { REPORT_REASONS, REPORT_TEXT_LIMIT, sendResponseReport, type ReportReason } from '@/data/tarvis/responseReport';
import { useAppTheme } from '@/theme/theme';
import { PrivacyPolicyLink } from '@/components/PrivacyPolicyLink';

/** Each mounted exchange owns its draft. Nothing is saved or sent on opening. */
export function TarvisReportButton({ response, disabled = false }: { response: string; disabled?: boolean }) {
  const { colors, radius } = useAppTheme();
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState('');
  const [reason, setReason] = useState<ReportReason>('incorrect');
  const [consent, setConsent] = useState(false);
  const [included, setIncluded] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [id, setId] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  const version = Application.nativeApplicationVersion ?? 'unknown';
  function open() {
    setId(Crypto.randomUUID()); setText(''); setReason('incorrect'); setConsent(false);
    setIncluded(false); setSent(false); setError(undefined); setVisible(true);
  }
  function close() {
    // Do not imply that closing an in-flight request can recall an email.
    if (active.current) return;
    setVisible(false); setText(''); setConsent(false);
  }
  async function send() {
    if (active.current || !consent || !text.trim() || disabled) return;
    const controller = new AbortController(); active.current = controller;
    setSending(true); setError(undefined);
    try {
      await sendResponseReport({ id, reason, text, version, consent }, controller.signal);
      if (!controller.signal.aborted) setSent(true);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not send your report.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setSending(false);
    }
  }
  const muted = { color: colors.textSecondary };
  const ink = { color: colors.text };
  return <>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={open} style={({ pressed }) => [styles.inline, { opacity: pressed || disabled ? 0.55 : 1 }]}>
      <Ionicons name="flag-outline" size={17} color={colors.textSecondary} accessibilityElementsHidden />
      <Text style={[styles.label, muted]}>Report response</Text>
    </Pressable>
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text accessibilityRole="header" style={[styles.heading, ink]}>{sent ? 'Thank you' : 'Report this response'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close report" disabled={sending} onPress={close} style={styles.close}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {sent ? <>
              <Text style={[styles.body, ink]}>Your report has been accepted for delivery to T1 Arc support.</Text>
              <Text style={[styles.body, muted]}>We use reports to investigate problems and improve Tarv1s. This is not an emergency or medical support service.</Text>
              <Text selectable style={[styles.body, muted]}>Reference: {id}</Text>
              <Text style={[styles.body, muted]}>For a reply or to request deletion, email support@t1arc.com with this reference. No contact address was attached automatically.</Text>
            </> : <>
              <Text style={[styles.body, muted]}>Tell us what went wrong. Nothing from your conversation is attached unless you add it below.</Text>
              <View style={styles.choices}>
                {REPORT_REASONS.map(item => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: reason === item.value }} disabled={sending} onPress={() => { setReason(item.value); setConsent(false); }} style={[styles.choice, { backgroundColor: reason === item.value ? colors.surfaceElevated : colors.surface, borderColor: reason === item.value ? colors.primary : colors.border, borderRadius: radius.md }]}>
                  <Ionicons name={reason === item.value ? 'radio-button-on' : 'radio-button-off'} size={20} color={reason === item.value ? colors.primary : colors.textSecondary} />
                  <Text style={[styles.label, ink]}>{item.label}</Text>
                </Pressable>)}
              </View>
              <Text style={[styles.label, ink]}>Message to support</Text>
              <TextInput accessibilityLabel="Message to support. Review and remove anything you do not want to share." multiline editable={!sending} maxLength={REPORT_TEXT_LIMIT} value={text} onChangeText={value => { setText(value); setConsent(false); }} placeholder="What should we look into?" placeholderTextColor={colors.textTertiary} style={[styles.input, ink, { borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md }]} />
              <Text style={[styles.small, muted]}>{text.length.toLocaleString()} / {REPORT_TEXT_LIMIT.toLocaleString()} characters</Text>
              {!included && response.trim() ? <Pressable disabled={sending} accessibilityRole="button" onPress={() => { setText(previous => `${previous}${previous ? '\n\n' : ''}Response I am reporting:\n${response}`.slice(0, REPORT_TEXT_LIMIT)); setIncluded(true); setConsent(false); }} style={styles.inline}>
                <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                <Text style={[styles.label, { color: colors.primary }]}>Include response for me to review</Text>
              </Pressable> : null}
              <Text style={[styles.body, muted]}>Only the message above, selected reason, app version ({version}) and report reference are sent. Remove any health details or other information you do not want to share. Do not include passwords or API keys.</Text>
              <Text style={[styles.body, muted]}>Sent securely through Cloudflare to support@t1arc.com, delivered to our Gmail support inbox. We keep reports while investigating them; you can request deletion using the reference below. This is not an emergency or medical support service.</Text>
              <Text selectable style={[styles.small, muted]}>Reference: {id}</Text>
              <PrivacyPolicyLink />
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: sending }} disabled={sending} onPress={() => setConsent(value => !value)} style={styles.consent}>
                <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={26} color={colors.primary} />
                <Text style={[styles.body, ink, styles.fill]}>I have reviewed this report and agree to share its contents, including any health information I have chosen to include, with T1 Arc support.</Text>
              </Pressable>
              {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.body, { color: colors.warning }]}>{error}</Text> : null}
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: sending || !consent || !text.trim() || disabled, busy: sending }} disabled={sending || !consent || !text.trim() || disabled} onPress={() => void send()} style={({ pressed }) => [styles.send, { backgroundColor: colors.primary, borderRadius: radius.md, opacity: pressed || sending || !consent || !text.trim() || disabled ? 0.5 : 1 }]}>
                {sending ? <ActivityIndicator color={colors.onPrimary} /> : null}
                <Text style={[styles.label, { color: colors.onPrimary }]}>{sending ? 'Sending report…' : 'Send report'}</Text>
              </Pressable>
            </>}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  inline: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center' },
  label: { fontSize: 14, lineHeight: 21, fontWeight: '600', flexShrink: 1 },
  body: { fontSize: 15, lineHeight: 23 },
  small: { fontSize: 12, lineHeight: 18 },
  heading: { fontSize: 22, lineHeight: 29, fontWeight: '700', flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  choices: { gap: 8 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 48, borderWidth: 1 },
  input: { minHeight: 160, padding: 14, borderWidth: 1, textAlignVertical: 'top', fontSize: 16, lineHeight: 24 },
  consent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8, minHeight: 48 },
  send: { minHeight: 52, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
});
