import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import DaymarkGlucoseDisplay, {
  AodPosition,
  AodSize,
  GlucoseDisplayStatus,
} from '../../modules/daymark-glucose-display';
import { updateGlucoseDisplayFromHistory } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import { relativeAge } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import { GlucoseAppearanceSettingsScreen } from './GlucoseAppearanceSettings';

const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';

const AOD_POSITIONS: Array<{ label: string; value: AodPosition }> = [
  { label: 'Top left', value: 'topLeft' },
  { label: 'Top centre', value: 'topCenter' },
  { label: 'Top right', value: 'topRight' },
  { label: 'Middle left', value: 'middleLeft' },
  { label: 'Middle centre', value: 'middleCenter' },
  { label: 'Middle right', value: 'middleRight' },
  { label: 'Bottom left', value: 'bottomLeft' },
  { label: 'Bottom centre', value: 'bottomCenter' },
  { label: 'Bottom right', value: 'bottomRight' },
];

const AOD_SIZES: Array<{ label: string; value: AodSize }> = [
  { label: 'Small', value: 'small' },
  { label: 'Standard', value: 'standard' },
  { label: 'Large', value: 'large' },
];

interface GlucoseDisplayCardProps {
  connected: boolean;
}

function statusTone(
  status: GlucoseDisplayStatus | undefined,
  colors: ReturnType<typeof useAppTheme>['colors'],
) {
  if (!status?.enabled) return colors.textTertiary;
  if (!status.notificationsAllowed) return colors.danger;
  if (status.freshness === 'current') return colors.glucose;
  if (status.freshness === 'delayed') return colors.warning;
  return colors.danger;
}

export function GlucoseDisplayCard({
  connected,
}: GlucoseDisplayCardProps) {
  const { colors, radius } = useAppTheme();
  const [status, setStatus] = useState<GlucoseDisplayStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [appearanceVisible, setAppearanceVisible] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await DaymarkGlucoseDisplay.getStatusAsync();
      setStatus(next);
      if (next.notificationsAllowed) setPermissionDenied(false);
    } catch {
      setStatus({
        supported: false,
        enabled: false,
        notificationsAllowed: false,
        lockScreenVisible: false,
        serviceRunning: false,
        aodDesired: false,
        aodPosition: 'bottomCenter',
        aodSize: 'standard',
        aodServiceEnabled: false,
        aodOverlayVisible: false,
        androidAutoEnabled: false,
        freshness: 'missing',
      });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void DaymarkGlucoseDisplay.getStatusAsync()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) {
          setMessage('Glucose display is unavailable in this build.');
        }
      });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshStatus();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [refreshStatus]);

  async function requestNotificationPermission() {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
    const existing = await PermissionsAndroid.check(
      NOTIFICATION_PERMISSION,
    );
    if (existing) return true;
    const result = await PermissionsAndroid.request(
      NOTIFICATION_PERMISSION,
      {
        title: 'Show your current glucose',
        message:
          'T1 Arc needs notification access to keep your glucose, direction and freshness visible outside the app.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function setEnabled(enabled: boolean) {
    if (busy) return;
    if (enabled && !connected) {
      Alert.alert(
        'Connect personal glucose first',
        'Save and verify your LibreLinkUp follower connection before enabling glucose at a glance.',
      );
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      if (enabled) {
        const allowed = await requestNotificationPermission();
        if (!allowed) {
          setPermissionDenied(true);
          setMessage(
            'Android notification access is off. Allow it to show glucose outside T1 Arc.',
          );
          await refreshStatus();
          return;
        }
        setPermissionDenied(false);
        const next = await DaymarkGlucoseDisplay.enableAsync(true);
        setStatus(next);
        await updateGlucoseDisplayFromHistory();
        await refreshStatus();
        setMessage(
          'Glucose at a glance is active. T1 Arc will refresh the value in the background.',
        );
      } else {
        setStatus(await DaymarkGlucoseDisplay.disableAsync());
        setMessage('Glucose at a glance is off.');
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The glucose display setting could not be changed.',
      );
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  async function setLockScreenVisible(visible: boolean) {
    setBusy(true);
    setMessage(undefined);
    try {
      setStatus(
        await DaymarkGlucoseDisplay.setLockScreenVisibleAsync(visible),
      );
      setMessage(
        visible
          ? 'The glucose value may appear while your phone is locked.'
          : 'The value is now redacted while your phone is locked.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Lock-screen privacy could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  function requestAod(desired: boolean) {
    if (!desired) {
      setBusy(true);
      void DaymarkGlucoseDisplay.setAodDesiredAsync(false)
        .then(setStatus)
        .finally(() => setBusy(false));
      return;
    }
    Alert.alert(
      'Two Android steps are required',
      'Because this private APK was installed outside Google Play, Android first asks you to trust its restricted settings. Open T1 Arc app info, tap the three-dot menu, choose “Allow restricted settings”, then return here and open Accessibility. T1 Arc cannot approve this for you.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Start setup',
          onPress: () => {
            setBusy(true);
            setMessage(undefined);
            void DaymarkGlucoseDisplay.setAodDesiredAsync(true)
              .then(async (next) => {
                setStatus(next);
                await DaymarkGlucoseDisplay.openAppDetailsSettingsAsync();
              })
              .catch((error) =>
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Always-on display setup could not be opened.',
                ),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  async function setAodPosition(position: AodPosition) {
    if (busy || position === status?.aodPosition) return;
    setBusy(true);
    setMessage(undefined);
    try {
      setStatus(await DaymarkGlucoseDisplay.setAodPositionAsync(position));
      const label =
        AOD_POSITIONS.find((option) => option.value === position)?.label ??
        'Selected position';
      setMessage(`${label} saved. The always-on value will remain fixed there.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The always-on position could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function setAodSize(size: AodSize) {
    if (busy || size === status?.aodSize) return;
    setBusy(true);
    setMessage(undefined);
    try {
      setStatus(await DaymarkGlucoseDisplay.setAodSizeAsync(size));
      const label =
        AOD_SIZES.find((option) => option.value === size)?.label ?? 'Selected';
      setMessage(`${label} always-on display size saved.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The always-on display size could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function setAndroidAutoEnabled(enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      setStatus(
        await DaymarkGlucoseDisplay.setAndroidAutoEnabledAsync(enabled),
      );
      setMessage(
        enabled
          ? 'Android Auto glucose is on. It will appear automatically when your car connects.'
          : 'Android Auto glucose is off.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The Android Auto setting could not be changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  const tone = statusTone(status, colors);
  const enabled = Boolean(status?.enabled);
  const aodReady = Boolean(status?.aodDesired && status.aodServiceEnabled);
  const badge = !enabled
    ? 'OFF'
    : status?.notificationsAllowed
      ? status.freshness.toUpperCase()
      : 'ACCESS NEEDED';

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${tone}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={tone}
            name="phone-portrait-outline"
            size={23}
          />
        </View>
        <View style={styles.headerCopy}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>
              Glucose at a glance
            </Text>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: `${tone}18`,
                  borderColor: `${tone}55`,
                },
              ]}
            >
              <Text style={[styles.badgeText, { color: tone }]}>{badge}</Text>
            </View>
          </View>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            A prominent ongoing notification shows personal glucose, direction
            and age without sound or vibration. While enabled, T1 Arc checks
            LibreLinkUp more frequently when a new reading is expected,
            including when the app is closed.
          </Text>
        </View>
      </View>

      <SettingRow
        detail={
          connected
            ? enabled && status?.latestMmolL !== undefined
              ? `${status.latestMmolL.toFixed(1)} mmol/L · ${
                  status.latestTimestamp
                    ? relativeAge(status.latestTimestamp)
                    : status.freshness
                }`
              : 'Status bar and notification shade'
            : 'Connect LibreLinkUp first'
        }
        disabled={busy || !status?.supported}
        label="Keep glucose visible"
        onValueChange={(value) => void setEnabled(value)}
        value={enabled}
      />

      <SettingRow
        detail={
          status?.androidAutoEnabled
            ? 'Quiet car notification; open T1 Arc in the car only for the full view'
            : 'No glucose notification or full-screen car view'
        }
        disabled={busy || !status?.supported}
        label="Show glucose in Android Auto"
        onValueChange={(value) => void setAndroidAutoEnabled(value)}
        value={Boolean(status?.androidAutoEnabled)}
      />

      {enabled ? (
        <>
          <SettingRow
            detail="Turn off to hide the number until your Pixel is unlocked"
            disabled={busy}
            label="Show value on lock screen"
            onValueChange={(value) => void setLockScreenVisible(value)}
            value={Boolean(status?.lockScreenVisible)}
          />
          <SettingRow
            detail={
              aodReady
                ? 'Ready to appear after your Pixel enters always-on mode'
                : status?.aodDesired
                  ? 'Enable the T1 Arc service, not its shortcut button'
                  : 'Optional value and direction on the locked dark screen'
            }
            disabled={busy}
            label="Glucose on always-on display"
            onValueChange={requestAod}
            value={Boolean(status?.aodDesired)}
          />
          {status?.aodDesired ? (
            <AodPositionPicker
              disabled={busy}
              onChange={(position) => void setAodPosition(position)}
              onSizeChange={(size) => void setAodSize(size)}
              size={status.aodSize ?? 'standard'}
              value={status.aodPosition ?? 'bottomCenter'}
            />
          ) : null}
        </>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => setAppearanceVisible(true)}
        style={({ pressed }) => [
          styles.appearanceButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={styles.appearanceIconRow}>
          {[colors.low, colors.warning, colors.glucose, colors.high].map(
            (color, index) => (
              <View
                accessibilityElementsHidden
                key={`${color}-${index}`}
                style={[styles.appearanceDot, { backgroundColor: color }]}
              />
            ),
          )}
        </View>
        <View style={styles.appearanceCopy}>
          <Text style={[styles.appearanceTitle, { color: colors.text }]}>
            Glucose ranges and colours
          </Text>
          <Text
            style={[styles.appearanceDetail, { color: colors.textSecondary }]}
          >
            Used in T1 Arc, the notification and always-on display
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={colors.textTertiary}
          name="chevron-forward"
          size={19}
        />
      </Pressable>

      {permissionDenied || (enabled && !status?.notificationsAllowed) ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void DaymarkGlucoseDisplay.openNotificationSettingsAsync()
          }
          style={({ pressed }) => [
            styles.recoveryButton,
            {
              borderColor: colors.danger,
              borderRadius: radius.md,
              backgroundColor: `${colors.danger}0D`,
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.danger}
            name="settings-outline"
            size={19}
          />
          <Text style={[styles.recoveryText, { color: colors.danger }]}>
            Allow in Android notification settings
          </Text>
        </Pressable>
      ) : null}

      {status?.aodDesired && !status.aodServiceEnabled ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.recoveryPanel,
            {
              borderColor: `${colors.warning}66`,
              borderRadius: radius.md,
              backgroundColor: `${colors.warning}0D`,
            },
          ]}
        >
          <View style={styles.recoveryHeader}>
            <Ionicons
              accessibilityElementsHidden
              color={colors.warning}
              name="information-circle-outline"
              size={21}
            />
            <Text style={[styles.recoveryTitle, { color: colors.text }]}>
              Finish two Android permission steps
            </Text>
          </View>
          <Text
            style={[
              styles.recoveryInstructions,
              { color: colors.textSecondary },
            ]}
          >
            1. In T1 Arc app info, tap the three-dot menu and choose “Allow
            restricted settings”.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void DaymarkGlucoseDisplay.openAppDetailsSettingsAsync();
            }}
            style={({ pressed }) => [
              styles.recoveryButton,
              {
                borderColor: colors.warning,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceElevated,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.warning}
              name="settings-outline"
              size={19}
            />
            <Text style={[styles.recoveryText, { color: colors.warning }]}>
              1 · Open T1 Arc app info
            </Text>
          </Pressable>
          <Text
            style={[
              styles.recoveryInstructions,
              { color: colors.textSecondary },
            ]}
          >
            2. Return here, open Accessibility, select “T1 Arc glucose on
            always-on display”, and turn on the main service switch. Leave its
            Accessibility shortcut off—the floating T1 Arc button is not the
            always-on display.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void DaymarkGlucoseDisplay.openAccessibilitySettingsAsync();
            }}
            style={({ pressed }) => [
              styles.recoveryButton,
              {
                borderColor: colors.warning,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceElevated,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.warning}
              name="accessibility-outline"
              size={19}
            />
            <Text style={[styles.recoveryText, { color: colors.warning }]}>
              2 · Open Accessibility
            </Text>
          </Pressable>
        </View>
      ) : null}

      {aodReady ? (
        <View
          style={[
            styles.aodReadyPanel,
            {
              backgroundColor: `${colors.accent}0D`,
              borderColor: `${colors.accent}55`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="moon-outline"
            size={21}
          />
          <View style={styles.aodReadyCopy}>
            <Text style={[styles.aodReadyTitle, { color: colors.text }]}>
              Always-on service enabled
            </Text>
            <Text
              style={[
                styles.aodReadyDetail,
                { color: colors.textSecondary },
              ]}
            >
              {status?.aodLastError
                ? `Last display error: ${status.aodLastError}`
                : status?.aodLastEvent ??
                  'Lock your Pixel to test the low-power display.'}
            </Text>
          </View>
        </View>
      ) : null}

      {message ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.message,
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.sm,
            },
          ]}
        >
          {busy ? <ActivityIndicator color={colors.primary} size="small" /> : null}
          <Text style={[styles.messageText, { color: colors.textSecondary }]}>
            {message}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Android and your lock-screen privacy settings have final control over
        what is visible. Data age is always shown; stale glucose is never
        presented as current.
      </Text>
      <GlucoseAppearanceSettingsScreen
        onClose={() => setAppearanceVisible(false)}
        visible={appearanceVisible}
      />
    </SectionCard>
  );
}

function AodPositionPicker({
  disabled,
  onChange,
  onSizeChange,
  size,
  value,
}: {
  disabled: boolean;
  onChange(position: AodPosition): void;
  onSizeChange(size: AodSize): void;
  size: AodSize;
  value: AodPosition;
}) {
  const { colors, radius } = useAppTheme();
  const selectedLabel =
    AOD_POSITIONS.find((position) => position.value === value)?.label ??
    'Bottom centre';

  return (
    <View style={[styles.positionSection, { borderTopColor: colors.divider }]}>
      <View style={styles.positionHeading}>
        <View style={styles.positionCopy}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>
            Always-on position
          </Text>
          <Text style={[styles.settingDetail, { color: colors.textSecondary }]}>
            Fixed at {selectedLabel.toLowerCase()}—no automatic movement
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="locate-outline"
          size={21}
        />
      </View>
      <View
        style={[
          styles.positionGrid,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        {AOD_POSITIONS.map((position) => {
          const selected = position.value === value;
          return (
            <Pressable
              accessibilityLabel={`${position.label}${
                selected ? ', selected' : ''
              }`}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              disabled={disabled}
              key={position.value}
              onPress={() => onChange(position.value)}
              style={({ pressed }) => [
                styles.positionOption,
                {
                  backgroundColor: selected
                    ? `${colors.accent}18`
                    : colors.surfaceElevated,
                  borderColor: selected ? colors.accent : colors.border,
                  borderRadius: radius.sm,
                },
                pressed && !disabled && { opacity: 0.68 },
                disabled && { opacity: 0.48 },
              ]}
            >
              <View
                accessibilityElementsHidden
                style={[
                  styles.positionMarker,
                  {
                    backgroundColor: selected
                      ? colors.accent
                      : colors.textTertiary,
                  },
                ]}
              />
              <Text
                numberOfLines={2}
                style={[
                  styles.positionLabel,
                  {
                    color: selected ? colors.accent : colors.textSecondary,
                  },
                ]}
              >
                {position.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.sizeHeading, { color: colors.text }]}>
        Display size
      </Text>
      <View style={styles.sizeRow}>
        {AOD_SIZES.map((option) => {
          const selected = option.value === size;
          return (
            <Pressable
              accessibilityLabel={`${option.label} always-on display size${
                selected ? ', selected' : ''
              }`}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              disabled={disabled}
              key={option.value}
              onPress={() => onSizeChange(option.value)}
              style={({ pressed }) => [
                styles.sizeOption,
                {
                  backgroundColor: selected
                    ? `${colors.accent}18`
                    : colors.surfaceElevated,
                  borderColor: selected ? colors.accent : colors.border,
                  borderRadius: radius.sm,
                },
                pressed && !disabled && { opacity: 0.68 },
                disabled && { opacity: 0.48 },
              ]}
            >
              <Text
                style={[
                  styles.sizeLabel,
                  { color: selected ? colors.accent : colors.textSecondary },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SettingRow({
  detail,
  disabled,
  label,
  onValueChange,
  value,
}: {
  detail: string;
  disabled: boolean;
  label: string;
  onValueChange(value: boolean): void;
  value: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.settingRow, { borderTopColor: colors.divider }]}>
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
        accessibilityRole="switch"
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={value ? colors.onPrimary : colors.surfaceElevated}
        trackColor={{
          false: colors.border,
          true: colors.primary,
        }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  titleRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  badge: {
    minHeight: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.65,
  },
  body: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  settingRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  settingCopy: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  settingDetail: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  positionSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
  },
  positionHeading: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  positionCopy: {
    flex: 1,
  },
  positionGrid: {
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 8,
    marginTop: 8,
  },
  positionOption: {
    minHeight: 58,
    flexBasis: '30%',
    flexGrow: 1,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  positionMarker: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  positionLabel: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  sizeHeading: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: 14,
  },
  sizeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 7,
  },
  sizeOption: {
    minHeight: 48,
    flex: 1,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  sizeLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  appearanceButton: {
    minHeight: 72,
    borderWidth: 1,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 12,
  },
  appearanceIconRow: {
    width: 42,
    height: 42,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  appearanceDot: {
    width: 16,
    height: 16,
    borderRadius: 999,
  },
  appearanceCopy: {
    flex: 1,
  },
  appearanceTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  appearanceDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  recoveryButton: {
    minHeight: 50,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  recoveryPanel: {
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
  },
  recoveryHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recoveryTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  recoveryInstructions: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 9,
  },
  recoveryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  aodReadyPanel: {
    minHeight: 64,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 10,
  },
  aodReadyCopy: {
    flex: 1,
  },
  aodReadyTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  aodReadyDetail: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  message: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 10,
  },
  messageText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  footnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 12,
  },
});
