import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { AutomationStatusCard } from '@/components/AutomationStatusCard';
import { DexcomClarityImportCard } from '@/components/DexcomClarityImportCard';
import { EncryptedBackupCard } from '@/components/EncryptedBackupCard';
import { GlookoImportCard } from '@/components/GlookoImportCard';
import { GlucoseDisplayCard } from '@/components/GlucoseDisplayCard';
import { GlucoseAlertSettingsCard } from '@/components/GlucoseAlertSettingsCard';
import { HealthConnectCard } from '@/components/HealthConnectCard';
import { HomeGlucoseWidgetCard } from '@/components/HomeGlucoseWidgetCard';
import { LocalDataControlCard } from '@/components/LocalDataControlCard';
import { NightscoutSourceCard } from '@/components/NightscoutSourceCard';
import { NotificationSourceCard } from '@/components/NotificationSourceCard';
import { SectionCard } from '@/components/SectionCard';
import { WearCompanionCard } from '@/components/WearCompanionCard';
import { XdripSourceCard } from '@/components/XdripSourceCard';
import { connectLibreLinkUp } from '@/data/libreLinkUp/connectLibreLinkUp';
import { disableGlucoseDisplay } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import {
  clearLibreLinkUpCredentials,
  loadLibreLinkUpCredentials,
} from '@/data/libreLinkUp/secureStore';
import {
  LibreLinkUpError,
  LibreLinkUpSnapshot,
} from '@/data/libreLinkUp/types';
import { formatTime, relativeAge } from '@/domain/time';
import { useAndroidBack } from '@/hooks/useAndroidBack';
import { useLatestData } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; snapshot: LibreLinkUpSnapshot; testedAt: number }
  | { kind: 'error'; error: LibreLinkUpError };

type SourceJump =
  | 'libre'
  | 'dexcom'
  | 'nightscout'
  | 'xdrip'
  | 'notification'
  | 'health'
  | 'glooko'
  | 'display'
  | 'privacy';

function maskEmail(value: string) {
  const [name = '', domain = ''] = value.split('@');
  if (!domain) return 'Saved follower account';
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'•'.repeat(Math.max(3, Math.min(7, name.length - visible.length)))}@${domain}`;
}

export function SourcesScreen() {
  const { colors, radius } = useAppTheme();
  const {
    activateLibreSnapshot,
    refreshData,
    reloadSources,
    setDataMode,
    syncing,
  } = useDataContext();
  const latest = useLatestData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(true);
  const [testState, setTestState] = useState<TestState>({ kind: 'idle' });
  const scrollViewRef = useRef<ScrollView | null>(null);
  const [activeSource, setActiveSource] = useState<SourceJump>();

  useEffect(() => {
    let active = true;
    void loadLibreLinkUpCredentials().then((credentials) => {
      if (!active || !credentials) return;
      setEmail(credentials.email);
      setPassword(credentials.password);
      setSaved(true);
      setEditing(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const canTest =
    email.trim().includes('@') &&
    password.length > 0 &&
    testState.kind !== 'testing';

  const currentReading = useMemo(() => {
    if (testState.kind !== 'success') return undefined;
    return testState.snapshot.readings[testState.snapshot.readings.length - 1];
  }, [testState]);

  const liveStatus = latest.sources.find(
    (source) =>
      source.id === 'daymark-live-glucose' ||
      source.id === 'daymark-librelinkup',
  );
  const glucoseSourceReady = saved || Boolean(liveStatus?.isLive);

  async function testConnection() {
    if (!canTest) return;
    setTestState({ kind: 'testing' });
    const credentials = {
      email: email.trim(),
      password,
      topLevelDomain: 'io' as const,
    };
    try {
      const snapshot = await connectLibreLinkUp(credentials);
      await activateLibreSnapshot(snapshot);
      setSaved(true);
      setEditing(false);
      setTestState({ kind: 'success', snapshot, testedAt: Date.now() });
    } catch (error) {
      setTestState({
        kind: 'error',
        error:
          error instanceof LibreLinkUpError
            ? error
            : new LibreLinkUpError(
                'network',
                error instanceof Error
                  ? error.message
                  : 'The connection could not be tested.',
              ),
      });
    }
  }

  function confirmClear() {
    Alert.alert(
      'Remove saved LibreLinkUp connection?',
      'This removes the saved email, password and session. Previously collected glucose history stays encrypted on this Pixel.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await disableGlucoseDisplay().catch(() => undefined);
              await clearLibreLinkUpCredentials();
              setEmail('');
              setPassword('');
              setSaved(false);
              setEditing(true);
              setTestState({ kind: 'idle' });
              await setDataMode('live');
            })();
          },
        },
      ],
    );
  }

  const showChangedPersonalData = useCallback(async () => {
    await reloadSources();
  }, [reloadSources]);

  function resetConnectionUiAfterErase() {
    setEmail('');
    setPassword('');
    setSaved(false);
    setEditing(true);
    setTestState({ kind: 'idle' });
  }

  function showSource(source: SourceJump) {
    setActiveSource(source);
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    });
  }

  const showSourceOverview = useCallback(() => {
    setActiveSource(undefined);
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  useAndroidBack(Boolean(activeSource), showSourceOverview);

  return (
    <AppScreen
      title="Data sources"
      eyebrow="Private connections"
      refreshing={syncing}
      onRefresh={() => void refreshData()}
      scrollViewRef={scrollViewRef}
    >
      {activeSource ? (
        <SourceDetailHeader
          onBack={showSourceOverview}
          source={activeSource}
        />
      ) : (
        <>
      <SectionCard
        style={[styles.hero, { backgroundColor: colors.surfaceElevated }]}
      >
        <View
          style={[
            styles.heroIcon,
            {
              backgroundColor: `${colors.glucose}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.glucose}
            name="shield-checkmark-outline"
            size={26}
          />
        </View>
        <View style={styles.heroCopy}>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Private, on-device connections
            </Text>
          </View>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Pick what you want to manage. Only that panel opens; your
            credentials and copied health data remain encrypted on this phone.
          </Text>
        </View>
      </SectionCard>

      <SectionHeading
        title="Connections"
        detail="Open one source, display or privacy area at a time."
      />
      <SourceJumpGrid active={activeSource} onSelect={showSource} />

          <SectionHeading
            title="Automatic updates"
            detail="What Android has actually refreshed in the background."
          />
          <AutomationStatusCard />
        </>
      )}

      {activeSource === 'libre' ? (
      <View>
        <SectionHeading
          title={saved && !editing ? 'Saved connection' : 'Connect LibreLinkUp'}
          detail="UK follower accounts use the libreview.io service. T1 Arc never accepts account terms for you."
        />

        {saved && !editing ? (
          <SectionCard>
          <View style={styles.savedRow}>
            <View
              style={[
                styles.savedIcon,
                { backgroundColor: `${colors.accent}18` },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.accent}
                name="lock-closed-outline"
                size={22}
              />
            </View>
            <View style={styles.savedCopy}>
              <Text style={[styles.savedTitle, { color: colors.text }]}>
                Saved securely on this Pixel
              </Text>
              <Text style={[styles.savedEmail, { color: colors.textSecondary }]}>
                {maskEmail(email)}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!canTest}
            onPress={() => void testConnection()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: canTest
                  ? colors.primary
                  : colors.surfaceMuted,
                borderRadius: radius.md,
              },
              pressed && canTest && { opacity: 0.78 },
            ]}
          >
            {testState.kind === 'testing' ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Ionicons
                accessibilityElementsHidden
                color={canTest ? colors.onPrimary : colors.textTertiary}
                name="refresh-outline"
                size={20}
              />
            )}
            <Text
              style={[
                styles.primaryButtonText,
                { color: canTest ? colors.onPrimary : colors.textTertiary },
              ]}
            >
              {testState.kind === 'testing'
                ? 'Checking securely…'
                : 'Retest saved connection'}
            </Text>
          </Pressable>
          <View style={styles.secondaryRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing(true)}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: colors.border, borderRadius: radius.md },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                Change account
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={confirmClear}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: colors.border, borderRadius: radius.md },
                pressed && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.danger }]}>
                Remove
              </Text>
            </Pressable>
          </View>
          </SectionCard>
        ) : (
          <SectionCard>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.text }]}>
              LibreLinkUp email
            </Text>
            <TextInput
              accessibilityLabel="LibreLinkUp email"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              style={[
                styles.input,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  color: colors.text,
                },
              ]}
              textContentType="emailAddress"
              value={email}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.text }]}>
              LibreLinkUp password
            </Text>
            <View
              style={[
                styles.passwordRow,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                },
              ]}
            >
              <TextInput
                accessibilityLabel="LibreLinkUp password"
                autoCapitalize="none"
                autoComplete="password"
                autoCorrect={false}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!passwordVisible}
                style={[styles.passwordInput, { color: colors.text }]}
                textContentType="password"
                value={password}
              />
              <Pressable
                accessibilityLabel={
                  passwordVisible ? 'Hide password' : 'Show password'
                }
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setPasswordVisible((visible) => !visible)}
                style={({ pressed }) => [
                  styles.eyeButton,
                  pressed && { opacity: 0.58 },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textSecondary}
                  name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                />
              </Pressable>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={!canTest}
            onPress={() => void testConnection()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: canTest
                  ? colors.primary
                  : colors.surfaceMuted,
                borderRadius: radius.md,
              },
              pressed && canTest && { opacity: 0.78 },
            ]}
          >
            {testState.kind === 'testing' ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Ionicons
                accessibilityElementsHidden
                color={canTest ? colors.onPrimary : colors.textTertiary}
                name="shield-checkmark-outline"
                size={20}
              />
            )}
            <Text
              style={[
                styles.primaryButtonText,
                { color: canTest ? colors.onPrimary : colors.textTertiary },
              ]}
            >
              {testState.kind === 'testing'
                ? 'Checking securely…'
                : 'Test, save and use connection'}
            </Text>
          </Pressable>
          {saved ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing(false)}
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>
                Cancel account change
              </Text>
            </Pressable>
          ) : null}
          </SectionCard>
        )}

        {testState.kind === 'success' && currentReading ? (
          <SectionCard
          accessibilityLabel="LibreLinkUp connection verified"
          style={[
            styles.resultCard,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: `${colors.accent}55`,
            },
          ]}
        >
          <View
            style={[styles.resultIcon, { backgroundColor: `${colors.accent}1E` }]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name="checkmark"
              size={22}
            />
          </View>
          <View style={styles.resultCopy}>
            <Text style={[styles.resultTitle, { color: colors.text }]}>
              Connected and activated
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Received {currentReading.mmolL.toFixed(1)} mmol/L at{' '}
              {formatTime(currentReading.timestamp)} (
              {relativeAge(currentReading.timestamp, testState.testedAt)}).
            </Text>
            <Text style={[styles.meta, { color: colors.textTertiary }]}>
              {testState.snapshot.readings.length} readings received · encrypted
              history enabled
            </Text>
            {(currentReading.timestampDiscrepancyMinutes ?? 0) > 5 ? (
              <Text style={[styles.timestampWarning, { color: colors.warning }]}>
                LibreLinkUp supplied factory and local timestamps that differ by{' '}
                {currentReading.timestampDiscrepancyMinutes} minutes. T1 Arc
                retained both for diagnosis.
              </Text>
            ) : null}
          </View>
          </SectionCard>
        ) : null}

        {testState.kind === 'error' ? (
          <SectionCard
          accessibilityLabel="LibreLinkUp connection error"
          style={[
            styles.resultCard,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: `${colors.danger}55`,
            },
          ]}
        >
          <View
            style={[styles.resultIcon, { backgroundColor: `${colors.danger}18` }]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.danger}
              name="alert"
              size={21}
            />
          </View>
          <View style={styles.resultCopy}>
            <Text style={[styles.resultTitle, { color: colors.text }]}>
              Connection not verified
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {testState.error.message}
            </Text>
            <Text style={[styles.meta, { color: colors.textTertiary }]}>
              Error: {testState.error.code}
            </Text>
          </View>
          </SectionCard>
        ) : null}
      </View>
      ) : null}

      {activeSource === 'nightscout' ? (
      <View>
        <SectionHeading
          title="Nightscout glucose and treatments"
          detail="Connect a user-owned Nightscout site with read-only access to the records its uploader supplies."
        />
        <NightscoutSourceCard />
      </View>
      ) : null}

      {activeSource === 'dexcom' ? (
      <View>
        <SectionHeading
          title="Dexcom history and live options"
          detail="Clarity CSV adds history. Nightscout or xDrip can supply current readings when your Dexcom data already reaches them."
        />
        <DexcomClarityImportCard
          onOpenNightscout={() => showSource('nightscout')}
          onOpenXdrip={() => showSource('xdrip')}
        />
      </View>
      ) : null}

      {activeSource === 'xdrip' ? (
      <View>
        <SectionHeading
          title="Local glucose endpoint"
          detail="Read a same-phone xDrip-compatible feed without another T1 Arc server."
        />
        <XdripSourceCard />
      </View>
      ) : null}

      {activeSource === 'display' ? (
        <View>
          <SectionHeading
            title="Glucose at a glance"
            detail="Notification, lock-screen, widget and alert controls."
          />
          <View style={styles.cardStack}>
            <GlucoseDisplayCard connected={glucoseSourceReady} />
            <GlucoseAlertSettingsCard connected={glucoseSourceReady} />
            <HomeGlucoseWidgetCard />
          </View>
          <SectionHeading
            title="Wear OS"
            detail="Current glucose and explicit freshness on your wrist."
          />
          <WearCompanionCard />
        </View>
      ) : null}

      {activeSource === 'notification' ? (
      <View>
        <SectionHeading
          title="Notification source"
          detail="Read glucose posted by a compatible CGM app on this phone."
        />
        <NotificationSourceCard onConnected={showChangedPersonalData} />
      </View>
      ) : null}

      {activeSource === 'health' ? (
      <View>
        <SectionHeading
          title="Phone and wearable health"
          detail="Samsung Health, Renpho and other approved Health Connect data."
        />
        <HealthConnectCard onDataChanged={showChangedPersonalData} />
      </View>
      ) : null}

      {activeSource === 'glooko' ? (
      <View>
        <SectionHeading
          title="Insulin history"
          detail="Keep your Omnipod history up to date from Glooko."
        />
        <GlookoImportCard />
      </View>
      ) : null}

      {activeSource === 'privacy' ? (
        <View>
          <SectionHeading
            title="Your data, your copy"
            detail="Portable encrypted backup without a T1 Arc server."
          />
          <EncryptedBackupCard onDataChanged={showChangedPersonalData} />
          <SectionHeading
            title="Device data controls"
            detail="Inspect or remove local data from this device."
          />
          <LocalDataControlCard onErased={resetConnectionUiAfterErase} />
        </View>
      ) : null}

    </AppScreen>
  );
}

const SOURCE_JUMPS: Array<{
  source: SourceJump;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  {
    source: 'libre',
    label: 'LibreLinkUp',
    detail: 'Direct follower',
    icon: 'pulse-outline',
  },
  {
    source: 'dexcom',
    label: 'Dexcom',
    detail: 'History + live routes',
    icon: 'analytics-outline',
  },
  {
    source: 'nightscout',
    label: 'Nightscout',
    detail: 'Read-only site',
    icon: 'cloud-outline',
  },
  {
    source: 'xdrip',
    label: 'xDrip endpoint',
    detail: 'Local /sgv.json',
    icon: 'git-network-outline',
  },
  {
    source: 'notification',
    label: 'Notifications',
    detail: 'Compatible CGM app',
    icon: 'notifications-outline',
  },
  {
    source: 'health',
    label: 'Health Connect',
    detail: 'Health, activity and food',
    icon: 'fitness-outline',
  },
  {
    source: 'glooko',
    label: 'Glooko',
    detail: 'Pump history',
    icon: 'archive-outline',
  },
  {
    source: 'display',
    label: 'Displays & watch',
    detail: 'Glanceable glucose',
    icon: 'watch-outline',
  },
  {
    source: 'privacy',
    label: 'Backup & privacy',
    detail: 'Your local data',
    icon: 'shield-checkmark-outline',
  },
];

function SourceDetailHeader({
  onBack,
  source,
}: {
  onBack(): void;
  source: SourceJump;
}) {
  const { colors, radius } = useAppTheme();
  const item = SOURCE_JUMPS.find((candidate) => candidate.source === source)!;
  return (
    <View style={styles.detailHeader}>
      <Pressable
        accessibilityLabel="Back to all connections"
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.pill,
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="arrow-back"
          size={17}
        />
        <Text style={[styles.backText, { color: colors.primary }]}>
          All connections
        </Text>
      </Pressable>
      <Text style={[styles.detailName, { color: colors.text }]}>
        {item.label}
      </Text>
    </View>
  );
}

function SourceJumpGrid({
  active,
  onSelect,
}: {
  active?: SourceJump;
  onSelect(source: SourceJump): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.sourceJumpGrid}>
      {SOURCE_JUMPS.map((item) => {
        const selected = active === item.source;
        return (
        <Pressable
          key={item.source}
          accessibilityHint={`Opens ${item.label} controls.`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          onPress={() => onSelect(item.source)}
          style={({ pressed }) => [
            styles.sourceJump,
            {
              backgroundColor: selected
                ? `${colors.primary}12`
                : colors.surface,
              borderColor: selected ? colors.primary : colors.border,
              borderRadius: radius.md,
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <View
            style={[
              styles.sourceJumpIcon,
              {
                backgroundColor: `${colors.primary}14`,
                borderRadius: radius.sm,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name={item.icon}
              size={19}
            />
          </View>
          <View style={styles.sourceJumpCopy}>
            <Text style={[styles.sourceJumpLabel, { color: colors.text }]}>
              {item.label}
            </Text>
            <Text
              style={[
                styles.sourceJumpDetail,
                { color: colors.textSecondary },
              ]}
            >
              {item.detail}
            </Text>
          </View>
          <Ionicons
            accessibilityElementsHidden
            color={selected ? colors.primary : colors.textTertiary}
            name={selected ? 'checkmark-circle' : 'chevron-forward'}
            size={16}
          />
        </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    gap: 14,
  },
  heroIcon: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  body: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  sourceJumpGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardStack: {
    gap: 12,
  },
  detailHeader: {
    minHeight: 54,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  backButton: {
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  detailName: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'right',
  },
  sourceJump: {
    width: '48.5%',
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sourceJumpIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceJumpCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceJumpLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  sourceJumpDetail: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 1,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  savedIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedCopy: {
    flex: 1,
  },
  savedTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  savedEmail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  fieldGroup: {
    gap: 7,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  passwordRow: {
    minHeight: 52,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    minHeight: 50,
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  eyeButton: {
    width: 52,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  cancelButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  resultCard: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  resultIcon: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCopy: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  meta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },
  timestampWarning: {
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 7,
  },
});
