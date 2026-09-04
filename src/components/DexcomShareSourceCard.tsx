import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  dexcomShareDraftFromSaved,
  dexcomShareRegionLabel,
  isSameDexcomShareIdentity,
  normalizeDexcomShareConnection,
  resolveDexcomSharePassword,
} from '@/data/dexcomShare/connection';
import { loadDexcomShareConnection } from '@/data/dexcomShare/secureStore';
import {
  DexcomShareConnection,
  DexcomShareError,
  DexcomShareRegion,
} from '@/data/dexcomShare/types';
import { formatTime, relativeAge } from '@/domain/time';
import { formatGlucose } from '@/domain/regionalFormat';
import { useDataContext } from '@/providers/DataProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

const REGIONS: DexcomShareRegion[] = ['international', 'us', 'japan'];

export function DexcomShareSourceCard({
  defaultRegion = 'international',
}: {
  defaultRegion?: DexcomShareRegion;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { connectDexcomShare, disconnectDexcomShare, revision } =
    useDataContext();
  const [saved, setSaved] = useState<DexcomShareConnection>();
  const [username, setUsername] = useState('');
  const usernameDraft = useRef('');
  const updateUsername = useCallback((value: string) => {
    usernameDraft.current = value;
    setUsername(value);
  }, []);
  const [password, setPassword] = useState('');
  const [region, setRegion] = useState<DexcomShareRegion>(defaultRegion);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const editingDraft = useRef(false);
  const updateEditing = useCallback((value: boolean) => {
    editingDraft.current = value;
    setEditing(value);
  }, []);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [latest, setLatest] = useState<{ mmolL: number; timestamp: number }>();
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void loadDexcomShareConnection()
      .then((connection) => {
        if (!active) return;
        setSaved(connection);
        if (connection && !editingDraft.current) {
          setPasswordVisible(false);
          const draft = dexcomShareDraftFromSaved(connection);
          updateUsername(draft.username);
          setRegion(draft.region);
          setPassword(draft.password);
          updateEditing(false);
        } else if (!connection && !editingDraft.current && !usernameDraft.current.trim()) {
          setRegion(defaultRegion);
        }
        setLoadState('ready');
      })
      .catch(() => {
        if (active) setLoadState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [defaultRegion, loadAttempt, revision, updateEditing, updateUsername]);

  function retryLoad() {
    setLoadState('loading');
    setLoadAttempt((value) => value + 1);
  }

  const sameIdentity = isSameDexcomShareIdentity(saved, username, region);
  const resolvedPassword = resolveDexcomSharePassword(
    saved,
    username,
    region,
    password,
  );

  function restoreSavedDraft() {
    if (!saved) return;
    const draft = dexcomShareDraftFromSaved(saved);
    updateUsername(draft.username);
    setRegion(draft.region);
    setPassword(draft.password);
    setPasswordVisible(false);
    updateEditing(false);
    setError(undefined);
  }

  async function testAndSave() {
    setError(undefined);
    let connection: DexcomShareConnection;
    try {
      connection = normalizeDexcomShareConnection(
        username,
        resolvedPassword,
        region,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Check the Dexcom details.',
      );
      return;
    }
    setWorking(true);
    try {
      const reading = await connectDexcomShare(connection);
      setSaved(connection);
      updateUsername(connection.username);
      setPassword('');
      setPasswordVisible(false);
      setLatest({ mmolL: reading.mmolL, timestamp: reading.timestamp });
      updateEditing(false);
    } catch (nextError) {
      setError(
        nextError instanceof DexcomShareError || nextError instanceof Error
          ? nextError.message
          : 'Dexcom Share could not be connected.',
      );
    } finally {
      setWorking(false);
    }
  }

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect Dexcom Share?',
      'This removes the publisher-account credentials. Glucose already copied into encrypted history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setWorking(true);
              try {
                await disconnectDexcomShare();
                setSaved(undefined);
                updateUsername('');
                setPassword('');
                setPasswordVisible(false);
                setLatest(undefined);
                updateEditing(false);
                setLoadState('ready');
              } finally {
                setWorking(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (!saved && loadState !== 'ready') {
    return (
      <SectionCard>
        <SourceHeader
          detail={
            loadState === 'loading'
              ? 'Checking the encrypted connection saved on this phone.'
              : 'T1 Arc could not safely read the saved connection. No setup state has been assumed.'
          }
          icon={
            loadState === 'loading' ? 'hourglass-outline' : 'warning-outline'
          }
          title={
            loadState === 'loading'
              ? 'Loading Dexcom Share'
              : 'Dexcom Share unavailable'
          }
        />
        {loadState === 'loading' ? (
          <ActivityIndicator
            color={colors.primary}
            style={styles.loadIndicator}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={retryLoad}
            style={({ pressed }) => [
              styles.retryButton,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              Retry
            </Text>
          </Pressable>
        )}
        {loadState === 'unavailable' ? (
          <Pressable
            accessibilityRole="button"
            onPress={confirmDisconnect}
            style={({ pressed }) => [
              styles.retryButton,
              {
                borderColor: `${colors.danger}66`,
                borderRadius: radius.md,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.danger }]}>
              Remove unreadable connection
            </Text>
          </Pressable>
        ) : null}
      </SectionCard>
    );
  }

  if (saved && !editing) {
    return (
      <SectionCard>
        <SourceHeader
          detail={`${dexcomShareRegionLabel(saved.region)} · credentials protected on this phone`}
          icon="checkmark-circle-outline"
          title="Dexcom Share connected"
        />
        {latest ? (
          <Text style={[styles.success, { color: colors.accent }]}>
            Received {formatGlucose(latest.mmolL, regional)} at{' '}
            {formatTime(latest.timestamp)} · {relativeAge(latest.timestamp)}
          </Text>
        ) : null}
        {loadState === 'unavailable' ? (
          <View style={styles.loadWarning}>
            <Text style={[styles.error, { color: colors.danger }]}>
              The saved connection could not be re-read. The last verified
              connection remains shown.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={retryLoad}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                Retry saved connection
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.actionRow}>
          <SecondaryButton
            label="Update connection"
            onPress={() => {
              const draft = dexcomShareDraftFromSaved(saved);
              updateUsername(draft.username);
              setRegion(draft.region);
              setPassword(draft.password);
              setPasswordVisible(false);
              updateEditing(true);
            }}
          />
          <SecondaryButton
            danger
            label="Disconnect"
            onPress={confirmDisconnect}
          />
        </View>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <SourceHeader
        detail="Direct current-glucose connection through your Dexcom account."
        icon="analytics-outline"
        title="Connect Dexcom Share"
      />
      <Text style={[styles.label, { color: colors.text }]}>Account region</Text>
      <View style={styles.chips}>
        {REGIONS.map((value) => {
          const active = region === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              key={value}
              onPress={() => {
                if (value !== region) setPassword('');
                setRegion(value);
              }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active
                    ? `${colors.primary}1C`
                    : colors.surfaceMuted,
                  borderColor: active ? colors.primary : colors.border,
                  borderRadius: radius.pill,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? colors.primary : colors.textSecondary },
                ]}
              >
                {value === 'international'
                  ? 'International'
                  : value === 'us'
                    ? 'US'
                    : 'Japan'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.label, { color: colors.text }]}>
        Username, email or phone
      </Text>
      <TextInput
        accessibilityLabel="Dexcom username, email or phone"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(value) => {
          if (value.trim() !== username.trim()) setPassword('');
          updateUsername(value);
        }}
        placeholder="Dexcom publisher account"
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
        value={username}
      />
      <Text style={[styles.help, { color: colors.textTertiary }]}>
        If the login is a phone number, include its country code, for example
        +44.
      </Text>
      <Text style={[styles.label, { color: colors.text }]}>Password</Text>
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
          accessibilityLabel="Dexcom password"
          autoCapitalize="none"
          autoComplete="password"
          autoCorrect={false}
          onChangeText={setPassword}
          placeholder={
            sameIdentity
              ? 'Saved password · leave blank to keep it'
              : 'Password required for this account'
          }
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={!passwordVisible}
          style={[styles.passwordInput, { color: colors.text }]}
          value={password}
        />
        <Pressable
          accessibilityLabel={
            passwordVisible ? 'Hide Dexcom password' : 'Show Dexcom password'
          }
          accessibilityRole="button"
          onPress={() => setPasswordVisible((value) => !value)}
          style={styles.eye}
        >
          <Ionicons
            color={colors.textSecondary}
            name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
            size={21}
          />
        </Pressable>
      </View>
      {saved && !sameIdentity && !password ? (
        <Text style={[styles.help, { color: colors.textTertiary }]}>
          Enter the password again because the account identity or region
          changed.
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={[styles.error, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={working || !username.trim() || !resolvedPassword}
        onPress={() => void testAndSave()}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor:
              working || !username.trim() || !resolvedPassword
                ? colors.border
                : colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        {working ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Ionicons
            color={colors.onPrimary}
            name="shield-checkmark-outline"
            size={19}
          />
        )}
        <Text
          style={[
            styles.primaryText,
            {
              color:
                working || !username.trim() || !resolvedPassword
                  ? colors.textTertiary
                  : colors.onPrimary,
            },
          ]}
        >
          {working ? 'Checking Dexcom Share…' : 'Test and save connection'}
        </Text>
      </Pressable>
      {saved ? (
        <Pressable
          accessibilityRole="button"
          onPress={restoreSavedDraft}
          style={styles.cancel}
        >
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
            Cancel changes
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );

  function SourceHeader({
    detail,
    icon,
    title,
  }: {
    detail: string;
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
  }) {
    return (
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            { backgroundColor: `${colors.glucose}16`, borderRadius: radius.md },
          ]}
        >
          <Ionicons color={colors.glucose} name={icon} size={24} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {detail}
          </Text>
        </View>
      </View>
    );
  }

  function SecondaryButton({
    danger = false,
    label,
    onPress,
  }: {
    danger?: boolean;
    label: string;
    onPress(): void;
  }) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={working}
        onPress={onPress}
        style={({ pressed }) => [
          styles.secondaryButton,
          {
            borderColor: danger ? `${colors.danger}66` : colors.border,
            borderRadius: radius.md,
            opacity: pressed || working ? 0.65 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.secondaryText,
            { color: danger ? colors.danger : colors.primary },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  body: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 6,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 40,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  chipText: { fontSize: 11, fontWeight: '800' },
  input: { minHeight: 54, borderWidth: 1, paddingHorizontal: 14, fontSize: 14 },
  passwordRow: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: { flex: 1, minHeight: 52, paddingLeft: 14, fontSize: 14 },
  eye: {
    width: 52,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  help: { fontSize: 10, lineHeight: 15, marginTop: 7 },
  error: { fontSize: 11, lineHeight: 17, marginTop: 11 },
  primaryButton: {
    minHeight: 54,
    marginTop: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  success: { fontSize: 11, lineHeight: 17, fontWeight: '700', marginTop: 14 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  secondaryText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  cancel: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  loadIndicator: { marginTop: 16 },
  loadWarning: { gap: 8, marginTop: 12 },
  retryButton: {
    minHeight: 46,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
});
