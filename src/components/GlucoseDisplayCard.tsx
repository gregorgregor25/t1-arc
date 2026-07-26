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
  GlucoseDisplayStatus,
} from '../../modules/daymark-glucose-display';
import { updateGlucoseDisplayFromHistory } from '@/data/glucoseDisplay/glucoseDisplayCoordinator';
import { relativeAge } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import { GlucoseAppearanceSettingsScreen } from './GlucoseAppearanceSettings';

const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';

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
        aodServiceEnabled: false,
        aodOverlayVisible: false,
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
          'Daymark needs notification access to keep your glucose, direction and freshness visible outside the app.',
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
            'Android notification access is off. Allow it to show glucose outside Daymark.',
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
          'Glucose at a glance is active. Daymark will refresh the value in the background.',
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
      'Because this private APK was installed outside Google Play, Android first asks you to trust its restricted settings. Open Daymark app info, tap the three-dot menu, choose “Allow restricted settings”, then return here and open Accessibility. Daymark cannot approve this for you.',
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
            and age without sound or vibration. While enabled, Daymark checks
            LibreLinkUp every minute, including when the app is closed.
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
                  ? 'Enable the Daymark service, not its shortcut button'
                  : 'Optional value and direction on the locked dark screen'
            }
            disabled={busy}
            label="Glucose on always-on display"
            onValueChange={requestAod}
            value={Boolean(status?.aodDesired)}
          />
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
            Used in Daymark, the notification and always-on display
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
            1. In Daymark app info, tap the three-dot menu and choose “Allow
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
              1 · Open Daymark app info
            </Text>
          </Pressable>
          <Text
            style={[
              styles.recoveryInstructions,
              { color: colors.textSecondary },
            ]}
          >
            2. Return here, open Accessibility, select “Daymark glucose on
            always-on display”, and turn on the main service switch. Leave its
            Accessibility shortcut off—the floating Daymark button is not the
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
