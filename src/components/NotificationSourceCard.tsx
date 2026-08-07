import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import DaymarkNotificationSource, {
  NotificationSourceStatus,
} from '../../modules/daymark-notification-source';
import { SectionCard } from '@/components/SectionCard';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

const OMNIPOD_5_PACKAGE = 'com.insulet.myblue.pdm';

export function NotificationSourceCard({
  onConnected,
}: {
  onConnected?: () => Promise<void> | void;
}) {
  const { colors, radius } = useAppTheme();
  const { refreshData } = useDataContext();
  const [installed, setInstalled] = useState(false);
  const [status, setStatus] = useState<NotificationSourceStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refreshStatus = useCallback(async () => {
    const [nextInstalled, nextStatus] = await Promise.all([
      DaymarkNotificationSource.isPackageInstalledAsync(OMNIPOD_5_PACKAGE),
      DaymarkNotificationSource.getStatusAsync(),
    ]);
    setInstalled(nextInstalled);
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  useEffect(() => {
    void refreshStatus();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshStatus().then(async (nextStatus) => {
          if (nextStatus.enabled && nextStatus.accessGranted) {
            await onConnected?.();
          } else {
            await refreshData();
          }
        });
      }
    });
    return () => subscription.remove();
  }, [onConnected, refreshData, refreshStatus]);

  if (!installed) return null;

  const active =
    status?.enabled === true && status.accessGranted === true;

  async function enable() {
    setBusy(true);
    setError(undefined);
    try {
      const next = await DaymarkNotificationSource.setConfigurationAsync({
        enabled: true,
        rules: [
          {
            packageName: OMNIPOD_5_PACKAGE,
            displayName: 'Omnipod 5',
            captureGlucose: true,
            captureInsulin: true,
            glucoseUnit: 'auto',
          },
        ],
      });
      setStatus(next);
      if (!next.accessGranted) {
        await DaymarkNotificationSource.openNotificationAccessSettingsAsync();
      } else {
        await onConnected?.();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Notification access could not be prepared.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(undefined);
    try {
      const next = await DaymarkNotificationSource.setConfigurationAsync({
        enabled: false,
        rules: status?.rules ?? [],
      });
      setStatus(next);
      await refreshData();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The notification source could not be disabled.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${active ? colors.accent : colors.glucose}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={active ? colors.accent : colors.glucose}
            name="notifications-outline"
            size={23}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Omnipod 5 notification source
          </Text>
          <Text style={[styles.status, { color: active ? colors.accent : colors.textSecondary }]}>
            {active
              ? 'Connected on this phone'
              : status?.enabled
                ? 'Finish Android notification access'
                : 'Available to connect'}
          </Text>
        </View>
      </View>

      <Text style={[styles.body, { color: colors.textSecondary }]}>
        With your permission, T1 Arc reads only notification text posted by
        the selected health app. It processes and encrypts that information on
        this phone. It cannot control your Pod or deliver insulin.
      </Text>

      {status?.pendingCount ? (
        <Text style={[styles.meta, { color: colors.textTertiary }]}>
          {status.pendingCount} captured notification
          {status.pendingCount === 1 ? '' : 's'} waiting to be processed
        </Text>
      ) : null}

      {error || status?.lastError ? (
        <Text style={[styles.error, { color: colors.danger }]}>
          {error ?? status?.lastError}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void (active ? disable() : enable())}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: active ? colors.surfaceMuted : colors.primary,
            borderColor: active ? colors.border : colors.primary,
            borderRadius: radius.md,
          },
          pressed && !busy && { opacity: 0.78 },
        ]}
      >
        {busy ? (
          <ActivityIndicator
            color={active ? colors.textSecondary : colors.onPrimary}
          />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={active ? colors.textSecondary : colors.onPrimary}
            name={active ? 'pause-outline' : 'shield-checkmark-outline'}
            size={20}
          />
        )}
        <Text
          style={[
            styles.buttonText,
            { color: active ? colors.textSecondary : colors.onPrimary },
          ]}
        >
          {busy
            ? 'Updating…'
            : active
              ? 'Pause notification source'
              : status?.enabled
                ? 'Open notification access'
                : 'Allow notification source'}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 46,
    height: 46,
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
  status: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  body: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 20,
  },
  meta: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
  },
  error: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  button: {
    minHeight: 52,
    marginTop: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  buttonText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
});
