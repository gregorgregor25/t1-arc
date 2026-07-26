import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { DataModeBadge } from '@/components/DataModeBadge';
import { EncryptedBackupCard } from '@/components/EncryptedBackupCard';
import { GlookoImportCard } from '@/components/GlookoImportCard';
import { GlucoseDisplayCard } from '@/components/GlucoseDisplayCard';
import { HealthConnectCard } from '@/components/HealthConnectCard';
import { SectionCard } from '@/components/SectionCard';
import { LibreLinkUpClient } from '@/data/libreLinkUp/LibreLinkUpClient';
import { disableGlucoseDisplay } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import {
  clearLibreLinkUpCredentials,
  loadLibreLinkUpCredentials,
  loadLibreLinkUpSession,
  saveLibreLinkUpCredentials,
  saveLibreLinkUpSession,
  sha256,
} from '@/data/libreLinkUp/secureStore';
import {
  LibreLinkUpError,
  LibreLinkUpSnapshot,
} from '@/data/libreLinkUp/types';
import { formatTime, relativeAge } from '@/domain/time';
import { useLatestData } from '@/hooks/useTimeline';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; snapshot: LibreLinkUpSnapshot; testedAt: number }
  | { kind: 'error'; error: LibreLinkUpError };

function maskEmail(value: string) {
  const [name = '', domain = ''] = value.split('@');
  if (!domain) return 'Saved follower account';
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'•'.repeat(Math.max(3, Math.min(7, name.length - visible.length)))}@${domain}`;
}

export function SourcesScreen() {
  const { colors, radius } = useAppTheme();
  const {
    backgroundSyncAvailable,
    activateLibreSnapshot,
    dataMode,
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
    (source) => source.id === 'daymark-librelinkup',
  );

  async function testConnection() {
    if (!canTest) return;
    setTestState({ kind: 'testing' });
    const credentials = {
      email: email.trim(),
      password,
      topLevelDomain: 'io' as const,
    };
    try {
      const [storedCredentials, session] = await Promise.all([
        loadLibreLinkUpCredentials(),
        loadLibreLinkUpSession(),
      ]);
      const sameCredentials =
        storedCredentials?.email.trim().toLowerCase() ===
          credentials.email.toLowerCase() &&
        storedCredentials?.password === credentials.password;
      const client = new LibreLinkUpClient(
        credentials,
        sha256,
        globalThis.fetch,
        sameCredentials ? session : undefined,
        saveLibreLinkUpSession,
      );
      const snapshot = await client.getSnapshot();
      await saveLibreLinkUpCredentials(credentials);
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
              await setDataMode('demo');
            })();
          },
        },
      ],
    );
  }

  async function chooseMode(mode: 'live' | 'demo') {
    if (mode === 'live' && !saved) {
      Alert.alert(
        'Connect LibreLinkUp first',
        'Verify and save a follower connection before using personal glucose.',
      );
      return;
    }
    await setDataMode(mode);
  }

  return (
    <AppScreen
      title="Data sources"
      eyebrow="Private connections"
      trailing={<DataModeBadge mode={dataMode} />}
      refreshing={syncing}
      onRefresh={() => void refreshData()}
    >
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
              Daymark direct glucose
            </Text>
            <View
              style={[
                styles.tag,
                {
                  backgroundColor: `${colors.accent}18`,
                  borderColor: `${colors.accent}55`,
                },
              ]}
            >
              <Text style={[styles.tagText, { color: colors.accent }]}>
                NO GDH APP
              </Text>
            </View>
          </View>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Daymark connects to your accepted LibreLinkUp follower connection,
            stores credentials with Android secure storage, and keeps glucose
            history in an encrypted SQLCipher database.
          </Text>
        </View>
      </SectionCard>

      <SectionHeading
        title="Active experience"
        detail="Personal and synthetic records are never silently combined."
      />
      <SectionCard>
        <View style={styles.modeRow}>
          <ModeButton
            active={dataMode === 'live'}
            detail={
              saved
                ? liveStatus?.dataThrough
                  ? `Data through ${formatTime(liveStatus.dataThrough)}`
                  : 'Saved connection ready'
                : 'Connection required'
            }
            icon="pulse-outline"
            label="Personal glucose"
            onPress={() => void chooseMode('live')}
          />
          <ModeButton
            active={dataMode === 'demo'}
            detail="Explore the full product"
            icon="flask-outline"
            label="Demo lab"
            onPress={() => void chooseMode('demo')}
          />
        </View>
        <Text style={[styles.modeFootnote, { color: colors.textSecondary }]}>
          {saved
            ? backgroundSyncAvailable
              ? 'Encrypted glucose collection is scheduled opportunistically in the background and refreshes every minute while Daymark is open.'
              : 'Glucose refreshes every minute while Daymark is open. Android background scheduling is currently unavailable.'
            : 'Connect LibreLinkUp below to begin collecting personal glucose.'}
        </Text>
      </SectionCard>

      <SectionHeading
        title={saved && !editing ? 'Saved connection' : 'Connect LibreLinkUp'}
        detail="UK follower accounts use the libreview.io service. Daymark never accepts account terms for you."
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
                {currentReading.timestampDiscrepancyMinutes} minutes. Daymark
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

      <SectionHeading
        title="Outside the app"
        detail="Keep current personal glucose visible with clear freshness and privacy controls."
      />
      <GlucoseDisplayCard connected={saved} />

      <SectionHeading
        title="Phone and wearable health"
        detail="Choose categories and compatible source apps without leaving this setup flow."
      />
      <HealthConnectCard onDataChanged={reloadSources} />

      <SectionHeading
        title="Delayed insulin import"
        detail="Review a Glooko export locally before adding any pump records."
      />
      <GlookoImportCard />

      <SectionHeading
        title="Your data, your copy"
        detail="Keep a portable encrypted backup without sending health data to a Daymark server."
      />
      <EncryptedBackupCard onDataChanged={reloadSources} />

      <SectionHeading title="Integration boundaries" />
      <View style={styles.stack}>
        <InfoCard
          color={colors.warning}
          icon="information-circle-outline"
          title="LibreLinkUp compatibility"
        >
          The connector implements the legacy JSON flow found in GDH’s
          MIT-licensed source. Daymark stops on encrypted responses and never
          bypasses encryption or accepts legal terms automatically.
        </InfoCard>
        <InfoCard color={colors.insulin} icon="water-outline" title="Glooko insulin">
          Complete Glooko exports are retained in encrypted on-device storage.
          Supported files are also normalised into basal, bolus and context
          records. They remain a separate delayed source and are never
          presented as a live pump connection.
        </InfoCard>
      </View>
    </AppScreen>
  );
}

function ModeButton({
  active,
  detail,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
}) {
  const { colors, radius } = useAppTheme();
  const tone = active ? colors.accent : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeButton,
        {
          backgroundColor: active ? `${colors.accent}12` : colors.surfaceMuted,
          borderColor: active ? `${colors.accent}88` : colors.border,
          borderRadius: radius.md,
        },
        pressed && { opacity: 0.72 },
      ]}
    >
      <View style={styles.modeTitleRow}>
        <Ionicons
          accessibilityElementsHidden
          color={tone}
          name={icon}
          size={21}
        />
        {active ? (
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="checkmark-circle"
            size={18}
          />
        ) : null}
      </View>
      <Text style={[styles.modeLabel, { color: colors.text }]}>{label}</Text>
      <Text style={[styles.modeDetail, { color: colors.textSecondary }]}>
        {detail}
      </Text>
    </Pressable>
  );
}

function InfoCard({
  children,
  color,
  icon,
  title,
}: {
  children: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <SectionCard>
      <View style={styles.infoHeader}>
        <Ionicons
          accessibilityElementsHidden
          color={color}
          name={icon}
          size={23}
        />
        <Text style={[styles.infoTitle, { color: colors.text }]}>{title}</Text>
      </View>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {children}
      </Text>
    </SectionCard>
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
  tag: {
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  tagText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.75,
  },
  body: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    minHeight: 122,
    padding: 14,
    borderWidth: 1,
  },
  modeTitleRow: {
    minHeight: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modeLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    marginTop: 9,
  },
  modeDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  modeFootnote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 14,
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
  stack: {
    gap: 12,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  infoTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
});
