import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  isSameNightscoutBaseUrl,
  nightscoutDraftFromSaved,
  nightscoutHost,
  nightscoutOrigin,
  resolveNightscoutDraftConnection,
} from '@/data/nightscout/connection';
import {
  DEFAULT_NIGHTSCOUT_HISTORY_STATE,
  NightscoutHistoryState,
} from '@/data/nightscout/historyBackfill';
import { loadNightscoutHistoryState } from '@/data/nightscout/historyStateStore';
import {
  loadNightscoutIobCobSnapshot,
  NIGHTSCOUT_IOB_COB_MAX_AGE_MS,
} from '@/data/nightscout/iobCobStore';
import { isFreshNightscoutIobCobSnapshot } from '@/data/nightscout/iobCobSnapshot';
import { loadNightscoutConnection } from '@/data/nightscout/secureStore';
import {
  NightscoutConnection,
  NightscoutError,
  NightscoutIobCobSnapshot,
} from '@/data/nightscout/types';
import {
  addDays,
  formatDate,
  formatTime,
  relativeAge,
  toDateKey,
} from '@/domain/time';
import {
  formatGlucose,
  formatRegionalFixedNumber,
  formatRegionalNumber,
} from '@/domain/regionalFormat';
import { useDataContext } from '@/providers/DataProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import {
  dateKeyFromPickerDate,
  pickerDateForDateKey,
} from './zonedDateTimePicker';

export function NightscoutSourceCard() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const {
    connectNightscout,
    disconnectNightscout,
    setNightscoutHistoryTarget,
    revision,
  } = useDataContext();
  const [saved, setSaved] = useState<NightscoutConnection>();
  const [site, setSite] = useState('');
  const [token, setToken] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const [includeIobCob, setIncludeIobCob] = useState(true);
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
  const [iobCob, setIobCob] = useState<NightscoutIobCobSnapshot>();
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [diagnosticError, setDiagnosticError] = useState<string>();

  useEffect(() => {
    let active = true;
    void loadNightscoutConnection()
      .then(async (connection) => {
        if (!active) return;
        setSaved(connection);
        setTokenVisible(false);
        setSecretVisible(false);
        if (connection) {
          const draft = nightscoutDraftFromSaved(connection);
          setSite(draft.site);
          setToken(draft.accessToken);
          setApiSecret(draft.apiSecret);
          setIncludeIobCob(draft.includeIobCob);
          setEditing(false);
          try {
            const snapshot = await loadNightscoutIobCobSnapshot(connection);
            if (active) setIobCob(snapshot);
          } catch {
            if (active) {
              setIobCob(undefined);
              setDiagnosticError(
                'Current IOB and COB status could not be read. The saved Nightscout connection is still available.',
              );
            }
          }
        } else {
          setIobCob(undefined);
        }
        if (active) setLoadState('ready');
      })
      .catch(() => {
        if (active) setLoadState('unavailable');
      });
    void loadNightscoutHistoryState()
      .then((historyState) => {
        if (active) setHistory(historyState);
      })
      .catch(() => {
        if (active) {
          setDiagnosticError(
            'Nightscout history progress could not be read. The saved connection is still available.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, revision]);

  const sameBaseUrl = isSameNightscoutBaseUrl(saved, site);
  const visibleIobCob =
    iobCob && isFreshNightscoutIobCobSnapshot(iobCob) ? iobCob : undefined;

  useEffect(() => {
    if (!iobCob) return;
    const expiresIn =
      iobCob.timestamp + NIGHTSCOUT_IOB_COB_MAX_AGE_MS - Date.now();
    if (expiresIn <= 0) return;
    const timeout = setTimeout(
      () => setIobCob((current) => (current === iobCob ? undefined : current)),
      expiresIn + 50,
    );
    return () => clearTimeout(timeout);
  }, [iobCob]);

  function retryLoad() {
    setLoadState('loading');
    setDiagnosticError(undefined);
    setLoadAttempt((value) => value + 1);
  }

  function chooseHistoryTarget() {
    const today = toDateKey(Date.now());
    const suggested = history.targetDate ?? addDays(today, -3 * 365);
    DateTimePickerAndroid.open({
      value: pickerDateForDateKey(suggested),
      mode: 'date',
      minimumDate: pickerDateForDateKey('2000-01-01'),
      maximumDate: pickerDateForDateKey(today),
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        const targetDate = dateKeyFromPickerDate(selected);
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
      connection = resolveNightscoutDraftConnection({
        site,
        accessToken: token,
        apiSecret,
        includeIobCob,
        saved,
      });
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
      setApiSecret('');
      setTokenVisible(false);
      setSecretVisible(false);
      setEditing(false);
      setLatest({
        mmolL: reading.mmolL,
        timestamp: reading.timestamp,
      });
      setIobCob(
        connection.includeIobCob
          ? await loadNightscoutIobCobSnapshot(connection).catch(
              () => undefined,
            )
          : undefined,
      );
    } catch (nextError) {
      setError(
        nextError instanceof NightscoutError || nextError instanceof Error
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
      'This removes the saved site, token or API secret. Glucose, treatments and profiles already copied into encrypted T1 Arc history are kept.',
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
                setApiSecret('');
                setTokenVisible(false);
                setSecretVisible(false);
                setLatest(undefined);
                setIobCob(undefined);
                setHistory(DEFAULT_NIGHTSCOUT_HISTORY_STATE);
                setEditing(false);
                setLoadState('ready');
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
              accessibilityElementsHidden
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
                ? 'Loading Nightscout'
                : 'Nightscout unavailable'}
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
            onPress={confirmRemove}
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
                : saved.apiSecret
                  ? 'legacy API secret protected on this phone'
                  : 'public read access'}
            </Text>
            {latest ? (
              <Text style={[styles.success, { color: colors.accent }]}>
                Received {formatGlucose(latest.mmolL, regional)} at{' '}
                {formatTime(latest.timestamp)}
              </Text>
            ) : null}
            {visibleIobCob && saved.includeIobCob ? (
              <Text style={[styles.success, { color: colors.textSecondary }]}>
                {visibleIobCob.iobUnits !== undefined
                  ? `${formatRegionalFixedNumber(visibleIobCob.iobUnits, regional.locale, 1)} U IOB`
                  : 'IOB unavailable'}
                {' · '}
                {visibleIobCob.cobGrams !== undefined
                  ? `${formatRegionalNumber(Math.round(visibleIobCob.cobGrams), regional.locale, { maximumFractionDigits: 0 })} g COB`
                  : 'COB unavailable'}
                {' · '}as of {formatTime(visibleIobCob.timestamp)} ·{' '}
                {relativeAge(visibleIobCob.timestamp)}
              </Text>
            ) : saved.includeIobCob ? (
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                Current IOB and COB unavailable · no verified snapshot within{' '}
                {formatRegionalNumber(
                  Math.round(NIGHTSCOUT_IOB_COB_MAX_AGE_MS / 60_000),
                  regional.locale,
                  { maximumFractionDigits: 0 },
                )} minutes
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
        {diagnosticError ? (
          <Text style={[styles.historyError, { color: colors.danger }]}>
            {diagnosticError}
          </Text>
        ) : null}
        <View style={[styles.historyPanel, { borderColor: colors.border }]}>
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
                style={[styles.historyBody, { color: colors.textSecondary }]}
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
                  style={[
                    styles.historyButtonText,
                    { color: colors.textSecondary },
                  ]}
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
            onPress={() => {
              const draft = nightscoutDraftFromSaved(saved);
              setSite(draft.site);
              setToken(draft.accessToken);
              setApiSecret(draft.apiSecret);
              setIncludeIobCob(draft.includeIobCob);
              setTokenVisible(false);
              setSecretVisible(false);
              setEditing(true);
            }}
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
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
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
            Read-only connection with encrypted history on this phone.
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
        onChangeText={(value) => {
          if (nightscoutOrigin(site) !== nightscoutOrigin(value)) {
            setToken('');
            setApiSecret('');
          }
          setSite(value);
        }}
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
            saved?.accessToken && sameBaseUrl
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
      <Text style={[styles.label, { color: colors.text }]}>
        Legacy API secret (optional)
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
          accessibilityLabel="Nightscout legacy API secret"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setApiSecret}
          placeholder={
            saved?.apiSecret && sameBaseUrl
              ? 'Saved secret · leave blank to keep it'
              : 'Only for sites using API_SECRET'
          }
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={!secretVisible}
          style={[styles.tokenInput, { color: colors.text }]}
          value={apiSecret}
        />
        <Pressable
          accessibilityLabel={
            secretVisible
              ? 'Hide Nightscout API secret'
              : 'Show Nightscout API secret'
          }
          accessibilityRole="button"
          onPress={() => setSecretVisible((value) => !value)}
          style={styles.eye}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textSecondary}
            name={secretVisible ? 'eye-off-outline' : 'eye-outline'}
            size={21}
          />
        </Pressable>
      </View>
      {saved && !sameBaseUrl && !token && !apiSecret ? (
        <Text style={[styles.toggleDetail, { color: colors.textSecondary }]}>
          The address is different. Enter that Nightscout address’s token or API
          secret if it is not public; T1 Arc will never carry a saved credential
          to another path or origin.
        </Text>
      ) : null}
      <View style={[styles.toggleRow, { borderColor: colors.border }]}>
        <View style={styles.toggleCopy}>
          <Text style={[styles.toggleTitle, { color: colors.text }]}>
            Read IOB and COB
          </Text>
          <Text style={[styles.toggleDetail, { color: colors.textSecondary }]}>
            Also check Nightscout’s Pebble endpoint for insulin and carbs on
            board.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Read Nightscout IOB and COB"
          onValueChange={setIncludeIobCob}
          thumbColor={includeIobCob ? colors.primary : colors.textTertiary}
          trackColor={{ false: colors.border, true: `${colors.primary}66` }}
          value={includeIobCob}
        />
      </View>

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
            color={site.trim() ? colors.onPrimary : colors.textTertiary}
            name="shield-checkmark-outline"
            size={19}
          />
        )}
        <Text
          style={[
            styles.primaryText,
            {
              color: site.trim() ? colors.onPrimary : colors.textTertiary,
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
            const draft = nightscoutDraftFromSaved(saved);
            setEditing(false);
            setSite(draft.site);
            setToken(draft.accessToken);
            setApiSecret(draft.apiSecret);
            setIncludeIobCob(draft.includeIobCob);
            setTokenVisible(false);
            setSecretVisible(false);
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
  toggleRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingTop: 16,
  },
  toggleCopy: { flex: 1 },
  toggleTitle: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  toggleDetail: { fontSize: 10, lineHeight: 15, marginTop: 2 },
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
  loadIndicator: {
    marginTop: 16,
  },
  loadWarning: {
    gap: 8,
    marginTop: 12,
  },
  retryButton: {
    minHeight: 46,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
});
