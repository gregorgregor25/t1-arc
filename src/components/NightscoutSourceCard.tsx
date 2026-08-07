import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
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
  nightscoutHost,
  normalizeNightscoutConnection,
} from '@/data/nightscout/connection';
import {
  DEFAULT_NIGHTSCOUT_HISTORY_STATE,
  NightscoutHistoryState,
} from '@/data/nightscout/historyBackfill';
import { loadNightscoutHistoryState } from '@/data/nightscout/historyStateStore';
import { loadNightscoutConnection } from '@/data/nightscout/secureStore';
import {
  NightscoutConnection,
  NightscoutError,
} from '@/data/nightscout/types';
import {
  addDays,
  formatDate,
  formatTime,
  relativeAge,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function NightscoutSourceCard() {
  const { colors, radius } = useAppTheme();
  const {
    connectNightscout,
    disconnectNightscout,
    setNightscoutHistoryTarget,
    revision,
  } = useDataContext();
  const [saved, setSaved] = useState<NightscoutConnection>();
  const [site, setSite] = useState('');
  const [token, setToken] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [latest, setLatest] = useState<{
    mmolL: number;
    timestamp: number;
  }>();
  const [history, setHistory] = useState<NightscoutHistoryState>(
    DEFAULT_NIGHTSCOUT_HISTORY_STATE,
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadNightscoutConnection(),
      loadNightscoutHistoryState(),
    ]).then(([connection, historyState]) => {
      if (active) {
        setSaved(connection);
        setHistory(historyState);
        if (connection) {
          setSite(connection.baseUrl);
          setEditing(false);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [revision]);

  function chooseHistoryTarget() {
    const today = toDateKey(Date.now());
    const suggested = history.targetDate ?? addDays(today, -3 * 365);
    DateTimePickerAndroid.open({
      value: new Date(zonedDateTimeToTimestamp(suggested, 12)),
      mode: 'date',
      minimumDate: new Date(
        zonedDateTimeToTimestamp('2000-01-01', 12),
      ),
      maximumDate: new Date(zonedDateTimeToTimestamp(today, 12)),
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        const targetDate = toDateKey(selected.getTime() + 12 * 60 * 60_000);
        const label = formatDate(targetDate, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        Alert.alert(
          'Build Nightscout history?',
          `T1 Arc will work backwards to ${label} in small encrypted blocks. It resumes automatically when the app refreshes, without sending the copied history to a T1 Arc server.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Start history',
              onPress: () => {
                void (async () => {
                  setWorking(true);
                  setError(undefined);
                  try {
                    const next = await setNightscoutHistoryTarget(targetDate);
                    setHistory(next);
                  } catch (nextError) {
                    setError(
                      nextError instanceof Error
                        ? nextError.message
                        : 'Nightscout history could not be started.',
                    );
                  } finally {
                    setWorking(false);
                  }
                })();
              },
            },
          ],
        );
      },
    });
  }

  function stopHistory() {
    Alert.alert(
      'Pause Nightscout history?',
      'Glucose and treatment records already copied to encrypted history stay on this phone. You can continue from the same point later.',
      [
        { text: 'Keep running', style: 'cancel' },
        {
          text: 'Pause',
          style: 'destructive',
          onPress: () => {
            void setNightscoutHistoryTarget(undefined).then(setHistory);
          },
        },
      ],
    );
  }

  async function testAndSave() {
    setError(undefined);
    let connection: NightscoutConnection;
    try {
      connection = normalizeNightscoutConnection(
        site,
        token || saved?.accessToken,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Check the Nightscout connection.',
      );
      return;
    }
    setWorking(true);
    try {
      const reading = await connectNightscout(connection);
      setSaved(connection);
      setSite(connection.baseUrl);
      setToken('');
      setEditing(false);
      setLatest({
        mmolL: reading.mmolL,
        timestamp: reading.timestamp,
      });
    } catch (nextError) {
      setError(
        nextError instanceof NightscoutError ||
          nextError instanceof Error
          ? nextError.message
          : 'Nightscout could not be connected.',
      );
    } finally {
      setWorking(false);
    }
  }

  function confirmRemove() {
    Alert.alert(
      'Disconnect Nightscout?',
      'This removes the saved site and read-only token. Glucose, treatments and profiles already copied into encrypted T1 Arc history are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setWorking(true);
              setError(undefined);
              try {
                await disconnectNightscout();
                setSaved(undefined);
                setSite('');
                setToken('');
                setLatest(undefined);
                setHistory(DEFAULT_NIGHTSCOUT_HISTORY_STATE);
                setEditing(false);
              } catch (nextError) {
                setError(
                  nextError instanceof Error
                    ? nextError.message
                    : 'Nightscout could not be disconnected.',
                );
              } finally {
                setWorking(false);
              }
            })();
          },
        },
      ],
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
              accessibilityElementsHidden
              color={colors.glucose}
              name="cloud-done-outline"
              size={24}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              Nightscout connected
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {nightscoutHost(saved)} ·{' '}
              {saved.accessToken
                ? 'read-only token protected on this phone'
                : 'public read access'}
            </Text>
            <Text style={[styles.capability, { color: colors.textTertiary }]}>
              Glucose plus insulin, carbohydrate, pump-state and profile data
              when this Nightscout uploader provides them. Programmed profiles
              are never presented as delivered basal.
            </Text>
            {latest ? (
              <Text style={[styles.success, { color: colors.accent }]}>
                Received {latest.mmolL.toFixed(1)} mmol/L at{' '}
                {formatTime(latest.timestamp)}
              </Text>
            ) : null}
          </View>
        </View>
        <View
          style={[styles.historyPanel, { borderColor: colors.border }]}
        >
          <View style={styles.historyHeading}>
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name={
                history.completedAt
                  ? 'checkmark-circle-outline'
                  : 'time-outline'
              }
              size={20}
            />
            <View style={styles.historyCopy}>
              <Text style={[styles.historyTitle, { color: colors.text }]}>
                {history.completedAt
                  ? 'Nightscout history complete'
                  : history.targetDate
                    ? 'Building complete history'
                    : 'Bring in your complete history'}
              </Text>
              <Text
                style={[
                  styles.historyBody,
                  { color: colors.textSecondary },
                ]}
              >
                {history.completedAt && history.targetDate
                  ? `Stored back to ${formatDate(history.targetDate, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}. New readings continue automatically.`
                  : history.targetDate
                    ? `Working backwards to ${formatDate(history.targetDate, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}${
                        history.cursorBeforeMs
                          ? ` · reached ${formatDate(
                              toDateKey(history.cursorBeforeMs),
                              {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              },
                            )}`
                          : ''
                      }.${
                        history.lastSuccessAt
                          ? ` Last progress ${relativeAge(history.lastSuccessAt)}.`
                          : ''
                      }`
                    : 'Choose the earliest date once. T1 Arc then works backwards through glucose and available treatments in safe, resumable blocks whenever Android gives it time.'}
              </Text>
              {history.lastError ? (
                <Text style={[styles.historyError, { color: colors.danger }]}>
                  Paused after an error: {history.lastError}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.historyActions}>
            <Pressable
              accessibilityRole="button"
              disabled={working}
              onPress={chooseHistoryTarget}
              style={({ pressed }) => [
                styles.historyButton,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radius.md,
                  opacity: pressed || working ? 0.65 : 1,
                },
              ]}
            >
              <Text
                style={[styles.historyButtonText, { color: colors.primary }]}
              >
                {history.targetDate ? 'Change earliest date' : 'Choose date'}
              </Text>
            </Pressable>
            {history.targetDate && !history.completedAt ? (
              <Pressable
                accessibilityRole="button"
                disabled={working}
                onPress={stopHistory}
                style={({ pressed }) => [
                  styles.pauseButton,
                  { opacity: pressed || working ? 0.65 : 1 },
                ]}
              >
                <Text
                  style={[styles.historyButtonText, { color: colors.textSecondary }]}
                >
                  Pause
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={working}
            onPress={() => setEditing(true)}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              Update connection
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={working}
            onPress={confirmRemove}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: `${colors.danger}66`,
                borderRadius: radius.md,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.danger }]}>
              Disconnect
            </Text>
          </Pressable>
        </View>
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]}>
            {error}
          </Text>
        ) : null}
      </SectionCard>
    );
  }

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
            accessibilityElementsHidden
            color={colors.glucose}
            name="cloud-outline"
            size={24}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Connect Nightscout
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Copy glucose plus available insulin treatments, carbohydrates,
            pump states and profiles directly from a Nightscout site. T1 Arc
            asks only for read access, imports the latest 14 days on
            connection, and stores the result in encrypted history.
          </Text>
        </View>
      </View>

      <Text style={[styles.label, { color: colors.text }]}>
        Nightscout HTTPS address
      </Text>
      <TextInput
        accessibilityLabel="Nightscout HTTPS address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setSite}
        placeholder="https://your-nightscout.example"
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
        value={site}
      />
      <Text style={[styles.label, { color: colors.text }]}>
        Readable access token (if required)
      </Text>
      <View
        style={[
          styles.tokenRow,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <TextInput
          accessibilityLabel="Nightscout readable access token"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setToken}
          placeholder={
            saved?.accessToken
              ? 'Saved token · leave blank to keep it'
              : 'Optional for public sites'
          }
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={!tokenVisible}
          style={[styles.tokenInput, { color: colors.text }]}
          value={token}
        />
        <Pressable
          accessibilityLabel={
            tokenVisible ? 'Hide Nightscout token' : 'Show Nightscout token'
          }
          accessibilityRole="button"
          onPress={() => setTokenVisible((value) => !value)}
          style={styles.eye}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textSecondary}
            name={tokenVisible ? 'eye-off-outline' : 'eye-outline'}
            size={21}
          />
        </Pressable>
      </View>
      <Text style={[styles.help, { color: colors.textTertiary }]}>
        Use a token with Nightscout’s readable role. Do not enter an admin
        token or API secret. A token included in the pasted site link is
        extracted and protected automatically.
      </Text>

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
        disabled={working || !site.trim()}
        onPress={() => void testAndSave()}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor:
              working || !site.trim() ? colors.border : colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        {working ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={
              site.trim() ? colors.onPrimary : colors.textTertiary
            }
            name="shield-checkmark-outline"
            size={19}
          />
        )}
        <Text
          style={[
            styles.primaryText,
            {
              color: site.trim()
                ? colors.onPrimary
                : colors.textTertiary,
            },
          ]}
        >
          {working ? 'Testing Nightscout…' : 'Test and save connection'}
        </Text>
      </Pressable>
      {saved ? (
        <Pressable
          accessibilityRole="button"
          disabled={working}
          onPress={() => {
            setEditing(false);
            setSite(saved.baseUrl);
            setToken('');
            setError(undefined);
          }}
          style={styles.cancelButton}
        >
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
            Cancel changes
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  icon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  capability: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  success: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 7,
  },
  historyPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingTop: 16,
  },
  historyHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  historyCopy: {
    flex: 1,
  },
  historyTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  historyBody: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  historyError: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 6,
  },
  historyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  historyButton: {
    minHeight: 42,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pauseButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  historyButtonText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  label: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  tokenRow: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tokenInput: {
    flex: 1,
    minHeight: 52,
    paddingLeft: 14,
    fontSize: 14,
  },
  eye: {
    width: 52,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  help: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
  },
  error: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
  },
  primaryButton: {
    minHeight: 54,
    marginTop: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
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
  cancelButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
});
