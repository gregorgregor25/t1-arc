import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Alert } from '@/components/appAlert';
import { SectionCard } from '@/components/SectionCard';
import { SupportReportCard } from '@/components/SupportReportCard';
import {
  copySupportEmailAsync,
  getCommunityReminderStatusAsync,
  setCommunityReminderEnabledAsync,
} from '@/data/feedback/communityReminder';
import type { RootTabParamList } from '@/navigation/AppNavigator';
import { COMMUNITY_SUBREDDIT_URL } from '@/navigation/appLinks';
import { useAppTheme } from '@/theme/theme';

const SUPPORT_EMAIL = 'support@t1arc.com';
type FeedbackKind = 'problem' | 'feature' | 'general';
const kinds: { id: FeedbackKind; label: string; subject: string }[] = [
  { id: 'problem', label: 'Report a problem', subject: 'T1 Arc problem report' },
  { id: 'feature', label: 'Suggest a feature', subject: 'T1 Arc feature suggestion' },
  { id: 'general', label: 'General feedback', subject: 'T1 Arc feedback' },
];

export function FeedbackScreen() {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { colors, radius } = useAppTheme();
  const [kind, setKind] = useState<FeedbackKind>('general');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [notificationsAllowed, setNotificationsAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const sequence = useRef(0);
  const mutationInFlight = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (mutationInFlight.current) return;
    const request = ++sequence.current;
    try {
      const status = await getCommunityReminderStatusAsync();
      if (request !== sequence.current) return;
      setReminderEnabled(status.enabled);
      setNotificationsAllowed(status.notificationsAllowed);
      setStatusError(false);
    } catch {
      if (request === sequence.current) setStatusError(true);
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void refreshStatus();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshStatus();
    });
    return () => { sequence.current++; subscription.remove(); };
  }, [refreshStatus]));

  async function changeReminder(enabled: boolean) {
    const request = ++sequence.current;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const status = await setCommunityReminderEnabledAsync(enabled);
      if (request === sequence.current) {
        setReminderEnabled(status.enabled);
        setNotificationsAllowed(status.notificationsAllowed);
        setStatusError(false);
      }
    } catch {
      if (request === sequence.current) Alert.alert('Reminder unavailable', 'Please try again.');
    } finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function emailSupport() {
    const subject = kinds.find(item => item.id === kind)?.subject ?? 'T1 Arc feedback';
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    try { await Linking.openURL(url); }
    catch { Alert.alert('No email app available', `Email ${SUPPORT_EMAIL} from your usual email service, or copy the address below.`); }
  }

  async function openSubreddit() {
    try { await Linking.openURL(COMMUNITY_SUBREDDIT_URL); }
    catch { Alert.alert('Could not open Reddit', 'Please try again later.'); }
  }

  return <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable accessibilityRole="button" onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Sources')}>
        <View style={styles.backRow}><Ionicons name="chevron-back" size={21} color={colors.primary} /><Text style={[styles.back, { color: colors.primary }]}>Back</Text></View>
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Help me make T1 Arc better</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        I’d love to hear how T1 Arc is working for you. What’s useful? What’s frustrating? What’s missing? Your feedback helps me decide what to improve next, and even a few words can make a difference.
      </Text>
      <SectionCard>
        <Text style={[styles.heading, { color: colors.text }]}>What would you like to share?</Text>
        {kinds.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: kind === item.id }}
          onPress={() => setKind(item.id)} style={[styles.choice, { borderColor: kind === item.id ? colors.primary : colors.border, borderRadius: radius.md }]}>
          <Ionicons name={kind === item.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.primary} />
          <Text style={[styles.choiceText, { color: colors.text }]}>{item.label}</Text>
        </Pressable>)}
        <Pressable accessibilityRole="button" onPress={() => { void emailSupport(); }} style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: radius.md }]}>
          <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Email support</Text>
        </Pressable>
        <Text selectable style={[styles.address, { color: colors.textSecondary }]}>{SUPPORT_EMAIL}</Text>
        <Pressable accessibilityRole="button" onPress={() => { void copySupportEmailAsync().then(() => Alert.alert('Address copied', SUPPORT_EMAIL)).catch(() => Alert.alert('Could not copy address', SUPPORT_EMAIL)); }}>
          <Text style={[styles.link, { color: colors.primary }]}>Copy email address</Text>
        </Pressable>
        <Text style={[styles.small, { color: colors.textSecondary }]}>Only what you choose to write is shared. No health records or technical logs are attached automatically.</Text>
      </SectionCard>
      <SectionCard>
        <Text style={[styles.heading, { color: colors.text }]}>Talk with the community</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>Share ideas and discuss T1 Arc with other users on Reddit. A Reddit account may be needed to post.</Text>
        <Pressable accessibilityRole="button" onPress={() => { void openSubreddit(); }} style={[styles.secondaryButton, { borderColor: colors.border, borderRadius: radius.md }]}>
          <Text style={[styles.buttonText, { color: colors.text }]}>Visit the T1 Arc subreddit</Text>
        </Pressable>
      </SectionCard>
      <SectionCard>
        <View style={styles.row}>
          <View style={styles.fill}>
            <Text style={[styles.heading, { color: colors.text }]}>Weekly feedback reminder</Text>
            <Text style={[styles.small, { color: colors.textSecondary }]}>One invitation each week. Turn it off any time.</Text>
          </View>
          <Switch accessibilityLabel="Weekly feedback reminder" value={reminderEnabled} disabled={busy || loading || statusError}
            onValueChange={value => { void changeReminder(value); }} trackColor={{ true: colors.primary }} />
        </View>
        {statusError ? <Pressable accessibilityRole="button" onPress={() => { setLoading(true); void refreshStatus(); }}><Text style={[styles.link, { color: colors.primary }]}>Could not load reminder status. Tap to retry.</Text></Pressable> : null}
        {reminderEnabled && !notificationsAllowed ? <Text style={[styles.small, { color: colors.warning }]}>Allow T1 Arc notifications in your phone settings to receive reminders.</Text> : null}
        {reminderEnabled && !notificationsAllowed ? <Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings().catch(() => Alert.alert('Settings unavailable', 'Open your phone’s app settings to allow T1 Arc notifications.')); }}><Text style={[styles.link, { color: colors.primary }]}>Open notification settings</Text></Pressable> : null}
      </SectionCard>
      <SupportReportCard />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, content: { padding: 20, paddingBottom: 42, gap: 16 },
  backRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  back: { fontSize: 18, fontWeight: '600' },
  title: { fontSize: 29, lineHeight: 36, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
  choice: { padding: 12, borderWidth: 1, marginTop: 10, minHeight: 48, alignItems: 'center', flexDirection: 'row', gap: 10 },
  choiceText: { fontSize: 16 }, primaryButton: { minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  secondaryButton: { minHeight: 50, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonText: { fontSize: 16, fontWeight: '700' }, address: { marginTop: 16, fontSize: 15 },
  link: { fontSize: 15, fontWeight: '600', paddingVertical: 8 }, small: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
