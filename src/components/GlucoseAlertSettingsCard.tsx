import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import DaymarkGlucoseDisplay from '../../modules/daymark-glucose-display';
import {
  loadGlucoseAlertPreferences,
  resetGlucoseAlertState,
  saveGlucoseAlertPreferences,
} from '@/data/glucoseAlerts/glucoseAlertPreferences';
import { updateGlucoseDisplayFromHistory } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import {
  GlucoseAlertPreferences,
  GlucoseAlertRepeatMinutes,
  validateGlucoseAlertPreferences,
} from '@/domain/glucoseAlerts';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';
const REPEAT_OPTIONS: Array<{
  label: string;
  value: GlucoseAlertRepeatMinutes;
}> = [
  { label: 'Never', value: 0 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
];

export function GlucoseAlertSettingsCard({
  connected,
}: {
  connected: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const [preferences, setPreferences] = useState<GlucoseAlertPreferences>();
  const [lowText, setLowText] = useState('');
  const [highText, setHighText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notificationsAllowed, setNotificationsAllowed] = useState(true);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  }>();

  async function refresh() {
    const next = await loadGlucoseAlertPreferences();
    setPreferences(next);
    setLowText(next.lowThresholdMmolL.toFixed(1));
    setHighText(next.highThresholdMmolL.toFixed(1));
    if (next.enabled) {
      setNotificationsAllowed(
        await DaymarkGlucoseDisplay.glucoseAlertsAllowedAsync().catch(
          () => false,
        ),
      );
    }
  }

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, []);

  async function requestNotificationPermission() {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
    if (await PermissionsAndroid.check(NOTIFICATION_PERMISSION)) return true;
    return (
      (await PermissionsAndroid.request(NOTIFICATION_PERMISSION, {
        title: 'Allow your chosen glucose alerts',
        message:
          'T1 Arc needs notification permission to deliver the low, high or stale alerts you switch on.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      })) === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  async function persist(
    next: GlucoseAlertPreferences,
    evaluateNow = false,
  ) {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await saveGlucoseAlertPreferences(next);
      setPreferences(next);
      if (evaluateNow) {
        await resetGlucoseAlertState();
        await updateGlucoseDisplayFromHistory();
      }
      setNotificationsAllowed(
        next.enabled
          ? await DaymarkGlucoseDisplay.glucoseAlertsAllowedAsync()
          : true,
      );
      setMessage({
        tone: 'success',
        text: next.enabled
          ? 'Alert choices saved on this phone.'
          : 'T1 Arc glucose alerts are off.',
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'The alert choices could not be saved.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function setMasterEnabled(enabled: boolean) {
    if (!preferences || busy) return;
    if (enabled && !connected) {
      setMessage({
        tone: 'error',
        text: 'Connect and verify personal glucose before enabling alerts.',
      });
      return;
    }
    if (enabled && !(await requestNotificationPermission())) {
      setNotificationsAllowed(false);
      setMessage({
        tone: 'error',
        text: 'Notification permission is required before T1 Arc can alert you.',
      });
      return;
    }
    if (enabled) {
      try {
        const display = await DaymarkGlucoseDisplay.getStatusAsync();
        if (!display.enabled) {
          await DaymarkGlucoseDisplay.enableAsync(display.lockScreenVisible);
        }
      } catch (error) {
        setMessage({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'The one-minute glucose collector could not be started.',
        });
        return;
      }
    }
    await persist({ ...preferences, enabled }, true);
  }

  async function saveThresholds() {
    if (!preferences) return;
    const low = Number(lowText.replace(',', '.'));
    const high = Number(highText.replace(',', '.'));
    const next = {
      ...preferences,
      lowThresholdMmolL: low,
      highThresholdMmolL: high,
    };
    const error = validateGlucoseAlertPreferences(next);
    if (error) {
      setMessage({ tone: 'error', text: error });
      return;
    }
    setLowText(low.toFixed(1));
    setHighText(high.toFixed(1));
    await persist(next, true);
  }

  if (!preferences) {
    return (
      <SectionCard>
        <Text style={[styles.loading, { color: colors.textSecondary }]}>
          Loading alert choices…
        </Text>
      </SectionCard>
    );
  }

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.warning}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.warning}
            name="notifications-outline"
            size={23}
          />
        </View>
        <View style={styles.headerCopy}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>
              Glucose alerts
            </Text>
            <Text
              style={[
                styles.badge,
                {
                  backgroundColor: preferences.enabled
                    ? `${colors.accent}18`
                    : colors.surfaceMuted,
                  color: preferences.enabled
                    ? colors.accent
                    : colors.textTertiary,
                },
              ]}
            >
              {preferences.enabled ? 'ON' : 'OFF'}
            </Text>
          </View>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Optional local alerts using thresholds you choose. T1 Arc’s quiet
            collector checks each minute and waits for a zone change to avoid
            repeats. Libre may also alert you.
          </Text>
        </View>
      </View>

      <SettingSwitch
        detail="Starts the quiet collector. Switching alerts off later does not switch off your other glanceable displays."
        disabled={busy}
        label="Allow T1 Arc alerts"
        onChange={(enabled) => void setMasterEnabled(enabled)}
        value={preferences.enabled}
      />

      {preferences.enabled ? (
        <>
          {!notificationsAllowed ? (
            <View
              style={[
                styles.warning,
                {
                  backgroundColor: `${colors.danger}10`,
                  borderColor: `${colors.danger}55`,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.danger}
                name="alert-circle-outline"
                size={19}
              />
              <Text style={[styles.warningText, { color: colors.textSecondary }]}>
                Android is blocking this alert channel. Open sound and vibration
                settings below to allow it.
              </Text>
            </View>
          ) : null}

          <View style={[styles.thresholdPanel, { borderColor: colors.border }]}>
            <SettingSwitch
              detail="Alert when a current reading enters or stays below your low threshold."
              disabled={busy}
              label="Low glucose"
              onChange={(lowEnabled) =>
                void persist({ ...preferences, lowEnabled }, true)
              }
              value={preferences.lowEnabled}
            />
            <ThresholdInput
              disabled={!preferences.lowEnabled || busy}
              label="Low threshold"
              onChange={setLowText}
              value={lowText}
            />
            <SettingSwitch
              detail="Alert when a current reading enters or stays above your high threshold."
              disabled={busy}
              label="High glucose"
              onChange={(highEnabled) =>
                void persist({ ...preferences, highEnabled }, true)
              }
              value={preferences.highEnabled}
            />
            <ThresholdInput
              disabled={!preferences.highEnabled || busy}
              label="High threshold"
              onChange={setHighText}
              value={highText}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void saveThresholds()}
              style={({ pressed }) => [
                styles.saveThresholds,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.saveThresholdsText, { color: colors.primary }]}>
                Save thresholds
              </Text>
            </Pressable>
          </View>

          <SettingSwitch
            detail="Alert after the latest personal glucose reading is more than 12 minutes old."
            disabled={busy}
            label="Stale readings"
            onChange={(staleEnabled) =>
              void persist({ ...preferences, staleEnabled }, true)
            }
            value={preferences.staleEnabled}
          />

          <View style={styles.repeatSection}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              Repeat while still in the same zone
            </Text>
            <Text style={[styles.settingDetail, { color: colors.textSecondary }]}>
              A new zone always alerts once. Choose whether an unresolved zone
              may alert again.
            </Text>
            <View style={styles.repeatOptions}>
              {REPEAT_OPTIONS.map((option) => {
                const selected =
                  preferences.repeatMinutes === option.value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    disabled={busy}
                    key={option.value}
                    onPress={() =>
                      void persist({
                        ...preferences,
                        repeatMinutes: option.value,
                      })
                    }
                    style={({ pressed }) => [
                      styles.repeatOption,
                      {
                        backgroundColor: selected
                          ? `${colors.primary}18`
                          : colors.surfaceMuted,
                        borderColor: selected
                          ? colors.primary
                          : colors.border,
                        borderRadius: radius.md,
                      },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.repeatText,
                        {
                          color: selected
                            ? colors.primary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void DaymarkGlucoseDisplay.openGlucoseAlertSettingsAsync()
            }
            style={({ pressed }) => [
              styles.channelButton,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
              },
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="options-outline"
              size={18}
            />
            <Text style={[styles.channelText, { color: colors.primary }]}>
              Sound and vibration
            </Text>
          </Pressable>
        </>
      ) : null}

      {message ? (
        <Text
          accessibilityLiveRegion={message.tone === 'error' ? 'assertive' : 'polite'}
          style={[
            styles.message,
            { color: message.tone === 'error' ? colors.danger : colors.accent },
          ]}
        >
          {message.text}
        </Text>
      ) : null}

      <Text style={[styles.safety, { color: colors.textTertiary }]}>
        T1 Arc alerts do not calculate doses or treatment. Confirm readings in
        your trusted glucose system before acting.
      </Text>
    </SectionCard>
  );
}

function SettingSwitch({
  detail,
  disabled,
  label,
  onChange,
  value,
}: {
  detail: string;
  disabled: boolean;
  label: string;
  onChange(value: boolean): void;
  value: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.settingDetail, { color: colors.textSecondary }]}>
          {detail}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        onValueChange={onChange}
        thumbColor={value ? colors.primary : undefined}
        trackColor={{ false: colors.border, true: `${colors.primary}66` }}
        value={value}
      />
    </View>
  );
}

function ThresholdInput({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange(value: string): void;
  value: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.inputRow}>
      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={styles.inputValue}>
        <TextInput
          accessibilityLabel={`${label} in millimoles per litre`}
          editable={!disabled}
          inputMode="decimal"
          keyboardType="decimal-pad"
          onChangeText={onChange}
          selectTextOnFocus
          style={[
            styles.input,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: radius.sm,
              color: disabled ? colors.textTertiary : colors.text,
            },
          ]}
          value={value}
        />
        <Text style={[styles.unit, { color: colors.textTertiary }]}>mmol/L</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 16,
  },
  loading: {
    fontSize: 14,
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
  },
  icon: {
    width: 45,
    height: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  body: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 19,
  },
  settingRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  settingCopy: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  settingDetail: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
  },
  warning: {
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  thresholdPanel: {
    padding: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    gap: 5,
  },
  inputRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inputLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  inputValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  input: {
    width: 72,
    minHeight: 42,
    paddingHorizontal: 10,
    borderWidth: 1,
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    width: 47,
    fontSize: 11,
    lineHeight: 16,
  },
  saveThresholds: {
    minHeight: 44,
    marginTop: 5,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveThresholdsText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  repeatSection: {
    gap: 3,
  },
  repeatOptions: {
    marginTop: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  repeatOption: {
    minHeight: 40,
    paddingHorizontal: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  channelButton: {
    minHeight: 48,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  channelText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  safety: {
    fontSize: 11,
    lineHeight: 17,
  },
});
