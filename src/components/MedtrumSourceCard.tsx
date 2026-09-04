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
  isSameMedtrumIdentity,
  medtrumDraftFromSaved,
  medtrumRegionLabel,
  resolveMedtrumDraftConnection,
} from '@/data/medtrum/connection';
import { loadMedtrumConnection } from '@/data/medtrum/secureStore';
import {
  MedtrumConnection,
  MedtrumError,
  MedtrumGlucoseUnit,
  MedtrumPatient,
  MedtrumRegion,
} from '@/data/medtrum/types';
import { formatTime, relativeAge } from '@/domain/time';
import { formatGlucose } from '@/domain/regionalFormat';
import { useDataContext } from '@/providers/DataProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function MedtrumSourceCard({
  defaultRegion = 'eu',
}: {
  defaultRegion?: MedtrumRegion;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { connectMedtrum, disconnectMedtrum, revision } = useDataContext();
  const [saved, setSaved] = useState<MedtrumConnection>();
  const [username, setUsername] = useState('');
  const usernameDraft = useRef('');
  const updateUsername = useCallback((value: string) => {
    usernameDraft.current = value;
    setUsername(value);
  }, []);
  const [password, setPassword] = useState('');
  const [region, setRegion] = useState<MedtrumRegion>(defaultRegion);
  const [glucoseUnit, setGlucoseUnit] = useState<MedtrumGlucoseUnit>(
    regional.glucoseUnit,
  );
  const [patients, setPatients] = useState<MedtrumPatient[]>([]);
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
    void loadMedtrumConnection()
      .then((connection) => {
        if (!active) return;
        setSaved(connection);
        if (connection && !editingDraft.current) {
          setPasswordVisible(false);
          const draft = medtrumDraftFromSaved(connection);
          updateUsername(draft.username);
          setRegion(draft.region);
          setGlucoseUnit(draft.glucoseUnit);
          setPassword(draft.password);
          setPatients(draft.patients);
          updateEditing(false);
        } else if (!connection && !editingDraft.current && !usernameDraft.current.trim()) {
          setRegion(defaultRegion);
          setGlucoseUnit(regional.glucoseUnit);
        }
        setLoadState('ready');
      })
      .catch(() => {
        if (active) setLoadState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [
    defaultRegion,
    loadAttempt,
    regional.glucoseUnit,
    revision,
    updateEditing,
    updateUsername,
  ]);

  function retryLoad() {
    setLoadState('loading');
    setLoadAttempt((value) => value + 1);
  }

  const sameIdentity = isSameMedtrumIdentity(
    saved,
    username,
    region,
    glucoseUnit,
  );
  const resolvedPassword =
    password || (sameIdentity ? saved?.password : '') || '';

  function restoreSavedDraft() {
    if (!saved) return;
    const draft = medtrumDraftFromSaved(saved);
    updateUsername(draft.username);
    setRegion(draft.region);
    setGlucoseUnit(draft.glucoseUnit);
    setPassword(draft.password);
    setPasswordVisible(false);
    setPatients(draft.patients);
    updateEditing(false);
    setError(undefined);
  }

  async function testAndSave(patient?: MedtrumPatient) {
    setError(undefined);
    setPatients([]);
    let connection: MedtrumConnection;
    try {
      connection = resolveMedtrumDraftConnection({
        saved,
        username,
        password,
        region,
        glucoseUnit,
        patient,
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Check the Medtrum details.',
      );
      return;
    }
    setWorking(true);
    try {
      const result = await connectMedtrum(connection);
      if (!result.connection || !result.latest) {
        setPatients(result.patients);
        return;
      }
      setSaved(result.connection);
      updateUsername(result.connection.username);
      setRegion(result.connection.region);
      setGlucoseUnit(result.connection.glucoseUnit ?? 'mmolL');
      setPassword('');
      setPasswordVisible(false);
      setLatest({
        mmolL: result.latest.mmolL,
        timestamp: result.latest.timestamp,
      });
      updateEditing(false);
    } catch (nextError) {
      setError(
        nextError instanceof MedtrumError || nextError instanceof Error
          ? nextError.message
          : 'Medtrum could not be connected.',
      );
    } finally {
      setWorking(false);
    }
  }

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect Medtrum?',
      'This removes the EasyFollow follower credentials. Glucose already copied into encrypted history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setWorking(true);
              try {
                await disconnectMedtrum();
                setSaved(undefined);
                updateUsername('');
                setPassword('');
                setPasswordVisible(false);
                setPatients([]);
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
        <View style={styles.header}>
          <View
            style={[
              styles.icon,
              {
                backgroundColor: `${colors.glucose}16`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              color={colors.glucose}
              name={
                loadState === 'loading'
                  ? 'hourglass-outline'
                  : 'warning-outline'
              }
              size={24}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              {loadState === 'loading'
                ? 'Loading Medtrum'
                : 'Medtrum unavailable'}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {loadState === 'loading'
                ? 'Checking the encrypted connection saved on this phone.'
                : 'T1 Arc could not safely read the saved connection. No setup state has been assumed.'}
            </Text>
          </View>
        </View>
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
        <View style={styles.header}>
          <View
            style={[
              styles.icon,
              {
                backgroundColor: `${colors.glucose}16`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              color={colors.glucose}
              name="checkmark-circle-outline"
              size={24}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              Medtrum connected
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {saved.patientName ?? saved.patientId} ·{' '}
              {medtrumRegionLabel(saved.region)} ·{' '}
              {(saved.glucoseUnit ?? 'mmolL') === 'mgDl'
                ? 'mg/dL account'
                : 'mmol/L account'}
            </Text>
            {latest ? (
              <Text style={[styles.success, { color: colors.accent }]}>
                Received {formatGlucose(latest.mmolL, regional)} at{' '}
                {formatTime(latest.timestamp)} · {relativeAge(latest.timestamp)}
              </Text>
            ) : null}
          </View>
        </View>
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
          <ActionButton
            label="Update connection"
            onPress={() => {
              const draft = medtrumDraftFromSaved(saved);
              updateUsername(draft.username);
              setRegion(draft.region);
              setGlucoseUnit(draft.glucoseUnit);
              setPassword(draft.password);
              setPasswordVisible(false);
              setPatients(draft.patients);
              updateEditing(true);
            }}
          />
          <ActionButton danger label="Disconnect" onPress={confirmDisconnect} />
        </View>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            { backgroundColor: `${colors.glucose}16`, borderRadius: radius.md },
          ]}
        >
          <Ionicons color={colors.glucose} name="people-outline" size={24} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Connect Medtrum
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Secure glucose connection through EasyFollow.
          </Text>
        </View>
      </View>
      <Text style={[styles.label, { color: colors.text }]}>Account glucose unit</Text>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {(['mmolL', 'mgDl'] as MedtrumGlucoseUnit[]).map((value) => {
          const active = glucoseUnit === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              key={value}
              onPress={() => {
                if (value !== glucoseUnit) setPassword('');
                setGlucoseUnit(value);
                setPatients([]);
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
                {value === 'mgDl' ? 'mg/dL' : 'mmol/L'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.label, { color: colors.text }]}>Server</Text>
      <View style={styles.chips}>
        {(['eu', 'fr'] as MedtrumRegion[]).map((value) => {
          const active = region === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              key={value}
              onPress={() => {
                if (value !== region) setPassword('');
                setRegion(value);
                setPatients([]);
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
                {value === 'eu' ? 'Europe / default' : 'France'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.label, { color: colors.text }]}>
        EasyFollow username
      </Text>
      <TextInput
        accessibilityLabel="Medtrum EasyFollow username"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(value) => {
          if (value.trim() !== username.trim()) setPassword('');
          updateUsername(value);
          setPatients([]);
        }}
        placeholder="Follower account username"
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
          accessibilityLabel="Medtrum EasyFollow password"
          autoCapitalize="none"
          autoComplete="password"
          autoCorrect={false}
          onChangeText={(value) => {
            setPassword(value);
            setPatients([]);
          }}
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
            passwordVisible ? 'Hide Medtrum password' : 'Show Medtrum password'
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
        <Text style={[styles.help, { color: colors.textSecondary }]}>
          Enter the password again because the username or server changed. T1
          Arc will ask you to choose the followed person again when needed.
        </Text>
      ) : null}
      {patients.length > 1 ? (
        <View
          style={[
            styles.patientPanel,
            { borderColor: colors.border, borderRadius: radius.md },
          ]}
        >
          <Text style={[styles.patientTitle, { color: colors.text }]}>
            Who should T1 Arc follow?
          </Text>
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            This account follows more than one person. Choose one to finish
            connecting.
          </Text>
          {patients.map((patient) => (
            <Pressable
              accessibilityRole="button"
              key={patient.id}
              onPress={() => void testAndSave(patient)}
              style={({ pressed }) => [
                styles.patientRow,
                {
                  backgroundColor: pressed
                    ? colors.surfaceMuted
                    : 'transparent',
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.patientCopy}>
                <Text style={[styles.patientName, { color: colors.text }]}>
                  {patient.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.patientId, { color: colors.textTertiary }]}
                >
                  {patient.id}
                </Text>
              </View>
              <Ionicons
                color={colors.primary}
                name="chevron-forward"
                size={19}
              />
            </Pressable>
          ))}
        </View>
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
          {working ? 'Checking Medtrum…' : 'Check account and continue'}
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

  function ActionButton({
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
  success: { fontSize: 11, lineHeight: 17, fontWeight: '700', marginTop: 7 },
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
  patientPanel: { borderWidth: 1, marginTop: 15, padding: 12 },
  patientTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  help: { fontSize: 11, lineHeight: 17, marginTop: 3 },
  patientRow: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  patientCopy: { flex: 1 },
  patientName: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  patientId: { fontSize: 10, lineHeight: 15, marginTop: 2 },
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
