import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
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

import T1ArcGlucoseDisplay from '../../modules/t1arc-glucose-display';
import type {
  GlucoseAlertChannelStatus,
  GlucoseAlertKind,
} from '../../modules/t1arc-glucose-display';
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
import {
  formatGlucose,
  glucoseToMmolL,
  glucoseUnitLabel,
} from '@/domain/regionalFormat';
import { normalizeRegionalNumberInput } from '@/domain/regionalNumberInput';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import {
  glucoseAlertChannelLabel,
  glucoseAlertChannelPresentation,
  glucoseAlertSettingsDestination,
} from './glucoseAlertChannelPresentation';
import { SectionCard } from './SectionCard';

const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';
const REPEAT_OPTIONS: {
  label: string;
  value: GlucoseAlertRepeatMinutes;
}[] = [
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
  const { defaults: regional } = useRegionalProfile();
  const [preferences, setPreferences] = useState<GlucoseAlertPreferences>();
  const [lowText, setLowText] = useState('');
  const [highText, setHighText] = useState('');
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState<GlucoseAlertKind>();
  const [channelStatuses, setChannelStatuses] = useState<
    GlucoseAlertChannelStatus[]
  >([]);
  const [channelStatusError, setChannelStatusError] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  }>();
  const channelRefreshGeneration = useRef(0);
  const preferencesRefreshGeneration = useRef(0);

  const refreshChannelStatuses = useCallback(async () => {
    const generation = ++channelRefreshGeneration.current;
    try {
      const statuses =
        await T1ArcGlucoseDisplay.getGlucoseAlertChannelStatusesAsync();
      if (Platform.OS === 'android' && statuses.length === 0) {
        throw new Error('Android returned no glucose alert channels.');
      }
      if (channelRefreshGeneration.current !== generation) return;
      setChannelStatuses(statuses);
      setChannelStatusError(false);
    } catch {
      if (channelRefreshGeneration.current !== generation) return;
      setChannelStatuses([]);
      setChannelStatusError(true);
    }
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++preferencesRefreshGeneration.current;
    const next = await loadGlucoseAlertPreferences();
    if (preferencesRefreshGeneration.current !== generation) return;
    setPreferences(next);
    setLowText(
      formatGlucose(next.lowThresholdMmolL, regional, { withUnit: false }),
    );
    setHighText(
      formatGlucose(next.highThresholdMmolL, regional, { withUnit: false }),
    );
    await refreshChannelStatuses();
  }, [refreshChannelStatuses, regional]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      active = false;
      preferencesRefreshGeneration.current += 1;
      channelRefreshGeneration.current += 1;
      subscription.remove();
    };
  }, [refresh]);

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

  async function persist(next: GlucoseAlertPreferences, evaluateNow = false) {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await saveGlucoseAlertPreferences(next);
      setPreferences(next);
      if (evaluateNow) {
        await resetGlucoseAlertState();
        await updateGlucoseDisplayFromHistory({ allowUnchangedSkip: true });
      }
      await refreshChannelStatuses();
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
      await refreshChannelStatuses();
      setMessage({
        tone: 'error',
        text: 'Notification permission is required before T1 Arc can alert you.',
      });
      return;
    }
    // Saving the preference mirrors independent native alert ownership. It
    // must not silently switch on the optional ongoing glucose display.
    await persist({ ...preferences, enabled }, true);
  }

  async function setCategoryEnabled(kind: GlucoseAlertKind, enabled: boolean) {
    if (!preferences || busy) return;
    if (enabled && !(await requestNotificationPermission())) {
      await refreshChannelStatuses();
      setMessage({
        tone: 'error',
        text: 'Notification permission is required before this alert can be enabled.',
      });
      return;
    }
    const next =
      kind === 'low'
        ? { ...preferences, lowEnabled: enabled }
        : kind === 'high'
          ? { ...preferences, highEnabled: enabled }
          : { ...preferences, staleEnabled: enabled };
    await persist(next, true);
  }

  async function sendTestAlert(kind: GlucoseAlertKind) {
    if (busy || testBusy) return;
    setTestBusy(kind);
    setMessage(undefined);
    try {
      const posted =
        await T1ArcGlucoseDisplay.showGlucoseTestAlertAsync(kind);
      await refreshChannelStatuses();
      setMessage({
        tone: posted ? 'success' : 'error',
        text: posted
          ? `${glucoseAlertChannelLabel(kind)} test sent. Check sound, vibration and lock-screen privacy.`
          : `Android did not allow the ${glucoseAlertChannelLabel(kind).toLowerCase()} test. Review this channel’s settings.`,
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'The test alert could not be sent.',
      });
    } finally {
      setTestBusy(undefined);
    }
  }

  async function openChannelSettings(kind: GlucoseAlertKind) {
    try {
      const destination = glucoseAlertSettingsDestination(channelStatus(kind));
      if (destination === 'app') {
        await T1ArcGlucoseDisplay.openGlucoseAlertAppSettingsAsync();
      } else {
        await T1ArcGlucoseDisplay.openGlucoseAlertChannelSettingsAsync(kind);
      }
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Android notification settings could not be opened.',
      });
    }
  }

  function channelStatus(kind: GlucoseAlertKind) {
    return channelStatuses.find((status) => status.kind === kind);
  }

  async function saveThresholds() {
    if (!preferences) return;
    const lowDisplay = normalizeRegionalNumberInput(
      lowText,
      regional.locale,
    )?.value;
    const highDisplay = normalizeRegionalNumberInput(
      highText,
      regional.locale,
    )?.value;
    if (lowDisplay === undefined || highDisplay === undefined) {
      setMessage({
        tone: 'error',
        text: 'Enter valid low and high glucose thresholds.',
      });
      return;
    }
    const low = glucoseToMmolL(lowDisplay, regional.glucoseUnit);
    const high = glucoseToMmolL(highDisplay, regional.glucoseUnit);
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
    setLowText(formatGlucose(low, regional, { withUnit: false }));
    setHighText(formatGlucose(high, regional, { withUnit: false }));
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
          <View style={[styles.thresholdPanel, { borderColor: colors.border }]}>
            <SettingSwitch
              detail="Alert when a current reading enters or stays below your low threshold."
              disabled={busy}
              label="Low glucose"
              onChange={(lowEnabled) =>
                void setCategoryEnabled('low', lowEnabled)
              }
              value={preferences.lowEnabled}
            />
            <AlertChannelControl
              enabled={preferences.lowEnabled}
              kind="low"
              onOpenSettings={() => void openChannelSettings('low')}
              onRetry={() => void refreshChannelStatuses()}
              onTest={() => void sendTestAlert('low')}
              queryError={channelStatusError}
              status={channelStatus('low')}
              working={testBusy === 'low'}
            />
            <ThresholdInput
              disabled={!preferences.lowEnabled || busy}
              label="Low threshold"
              onChange={setLowText}
              unit={glucoseUnitLabel(regional.glucoseUnit)}
              value={lowText}
            />
            <SettingSwitch
              detail="Alert when a current reading enters or stays above your high threshold."
              disabled={busy}
              label="High glucose"
              onChange={(highEnabled) =>
                void setCategoryEnabled('high', highEnabled)
              }
              value={preferences.highEnabled}
            />
            <AlertChannelControl
              enabled={preferences.highEnabled}
              kind="high"
              onOpenSettings={() => void openChannelSettings('high')}
              onRetry={() => void refreshChannelStatuses()}
              onTest={() => void sendTestAlert('high')}
              queryError={channelStatusError}
              status={channelStatus('high')}
              working={testBusy === 'high'}
            />
            <ThresholdInput
              disabled={!preferences.highEnabled || busy}
              label="High threshold"
              onChange={setHighText}
              unit={glucoseUnitLabel(regional.glucoseUnit)}
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
              <Text
                style={[styles.saveThresholdsText, { color: colors.primary }]}
              >
                Save thresholds
              </Text>
            </Pressable>
          </View>

          <SettingSwitch
            detail="Alert after the latest personal glucose reading is more than 12 minutes old."
            disabled={busy}
            label="Stale readings"
            onChange={(staleEnabled) =>
              void setCategoryEnabled('stale', staleEnabled)
            }
            value={preferences.staleEnabled}
          />
          <AlertChannelControl
            enabled={preferences.staleEnabled}
            kind="stale"
            onOpenSettings={() => void openChannelSettings('stale')}
            onRetry={() => void refreshChannelStatuses()}
            onTest={() => void sendTestAlert('stale')}
            queryError={channelStatusError}
            status={channelStatus('stale')}
            working={testBusy === 'stale'}
          />

          <View style={styles.repeatSection}>
            <Text style={[styles.settingLabel, { color: colors.text }]}>
              Repeat while still in the same zone
            </Text>
            <Text
              style={[styles.settingDetail, { color: colors.textSecondary }]}
            >
              A new zone always alerts once. Choose whether an unresolved zone
              may alert again.
            </Text>
            <View style={styles.repeatOptions}>
              {REPEAT_OPTIONS.map((option) => {
                const selected = preferences.repeatMinutes === option.value;
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
                        borderColor: selected ? colors.primary : colors.border,
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
        </>
      ) : null}

      {message ? (
        <Text
          accessibilityLiveRegion={
            message.tone === 'error' ? 'assertive' : 'polite'
          }
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

function AlertChannelControl({
  enabled,
  kind,
  onOpenSettings,
  onRetry,
  onTest,
  queryError,
  status,
  working,
}: {
  enabled: boolean;
  kind: GlucoseAlertKind;
  onOpenSettings(): void;
  onRetry(): void;
  onTest(): void;
  queryError: boolean;
  status?: GlucoseAlertChannelStatus;
  working: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const presentation = status
    ? glucoseAlertChannelPresentation(status, enabled)
    : queryError
      ? {
          tone: 'blocked' as const,
          summary: 'Android status unavailable',
          detail:
            'T1 Arc could not read this channel. Retry or open Android settings.',
        }
      : {
          tone: 'attention' as const,
          summary: 'Checking Android settings…',
          detail: 'Channel details are not available yet.',
        };
  const statusColor =
    presentation.tone === 'blocked'
      ? colors.danger
      : presentation.tone === 'attention'
        ? colors.warning
        : presentation.tone === 'allowed'
          ? colors.accent
          : colors.textTertiary;
  const canTest = enabled && status?.state === 'allowed' && !working;
  const label = glucoseAlertChannelLabel(kind);

  return (
    <View
      accessibilityLabel={`${label} Android delivery. ${presentation.summary}. ${presentation.detail}`}
      style={[
        styles.channelStatus,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <Text style={[styles.channelSummary, { color: statusColor }]}>
        {presentation.summary}
      </Text>
      <Text style={[styles.channelDetail, { color: colors.textSecondary }]}>
        {presentation.detail}
      </Text>
      <View style={styles.channelActions}>
        {queryError ? (
          <Pressable
            accessibilityLabel={`Retry ${label.toLowerCase()} Android status`}
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.channelAction,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderRadius: radius.sm,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="refresh-outline"
              size={16}
            />
            <Text style={[styles.channelActionText, { color: colors.primary }]}>
              Retry status
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityLabel={`Send ${label.toLowerCase()} test alert`}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canTest, busy: working }}
          disabled={!canTest}
          onPress={onTest}
          style={({ pressed }) => [
            styles.channelAction,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: radius.sm,
              opacity: canTest ? (pressed ? 0.68 : 1) : 0.5,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="notifications-outline"
            size={16}
          />
          <Text style={[styles.channelActionText, { color: colors.primary }]}>
            {working ? 'Sending…' : 'Send test alert'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Open ${label.toLowerCase()} Android settings`}
          accessibilityRole="button"
          onPress={onOpenSettings}
          style={({ pressed }) => [
            styles.channelAction,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: radius.sm,
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="options-outline"
            size={16}
          />
          <Text style={[styles.channelActionText, { color: colors.primary }]}>
            Android settings
          </Text>
        </Pressable>
      </View>
    </View>
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
        <Text style={[styles.settingLabel, { color: colors.text }]}>
          {label}
        </Text>
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
  unit,
}: {
  disabled: boolean;
  label: string;
  onChange(value: string): void;
  value: string;
  unit: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.inputRow}>
      <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={styles.inputValue}>
        <TextInput
          accessibilityLabel={`${label} in ${unit}`}
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
        <Text style={[styles.unit, { color: colors.textTertiary }]}>
          {unit}
        </Text>
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
  channelStatus: {
    padding: 11,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  channelSummary: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  channelDetail: {
    fontSize: 11,
    lineHeight: 16,
  },
  channelActions: {
    marginTop: 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  channelAction: {
    minHeight: 42,
    paddingHorizontal: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  channelActionText: {
    fontSize: 12,
    lineHeight: 17,
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
