import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import DaymarkGlucoseDisplay from '../../modules/daymark-glucose-display';
import {
  loadInsightReviewPreferences,
  setWeeklyReviewNotificationEnabled,
} from '@/data/insights/insightReviewPreferences';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

const NOTIFICATION_PERMISSION = 'android.permission.POST_NOTIFICATIONS';

async function requestNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  if (await PermissionsAndroid.check(NOTIFICATION_PERMISSION)) return true;
  const result = await PermissionsAndroid.request(
    NOTIFICATION_PERMISSION,
    {
      title: 'Weekly T1 Arc review',
      message:
        'Allow one quiet notification when your private weekly evidence review is ready.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export function InsightReviewScheduleCard() {
  const { colors, radius } = useAppTheme();
  const [enabled, setEnabled] = useState(false);
  const [notificationsAllowed, setNotificationsAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const reload = useCallback(async () => {
    const [preferences, reviewNotificationsAllowed] = await Promise.all([
      loadInsightReviewPreferences(),
      DaymarkGlucoseDisplay.reviewNotificationsAllowedAsync().catch(
        () => false,
      ),
    ]);
    setEnabled(preferences.weeklyNotificationEnabled);
    setNotificationsAllowed(reviewNotificationsAllowed);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    return () => subscription.remove();
  }, [reload]);

  async function changeEnabled(next: boolean) {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      if (next && !(await requestNotificationPermission())) {
        setNotificationsAllowed(false);
        setMessage(
          'Android notifications are off. Allow them to receive the weekly review.',
        );
        return;
      }
      const saved = await setWeeklyReviewNotificationEnabled(next);
      setEnabled(saved.weeklyNotificationEnabled);
      if (!next) {
        await DaymarkGlucoseDisplay.cancelReviewReadyNotificationAsync();
      }
      await reload();
      setMessage(
        next
          ? 'Weekly reviews will be announced from Monday morning when Android next runs T1 Arc.'
          : 'Weekly review notifications are off. Reviews remain available privately in the app.',
      );
    } catch {
      setMessage('The weekly review setting could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SectionCard style={styles.loadingCard}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading review schedule…
        </Text>
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
              backgroundColor: `${colors.primary}16`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="calendar-clear-outline"
            size={22}
          />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Weekly evidence review
          </Text>
          <Text style={[styles.schedule, { color: colors.accent }]}>
            MONDAY MORNING · ON THIS PHONE
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Switch
            accessibilityLabel="Weekly evidence review notification"
            accessibilityState={{ checked: enabled }}
            onValueChange={(next) => void changeEnabled(next)}
            thumbColor={enabled ? colors.onPrimary : undefined}
            trackColor={{
              false: colors.border,
              true: colors.primary,
            }}
            value={enabled}
          />
        )}
      </View>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        T1 Arc quietly builds a seven-day comparison from encrypted local
        records. One privacy-safe notification opens the findings and every
        reading behind them. Android chooses the exact delivery time.
      </Text>
      <View
        style={[
          styles.privacy,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="lock-closed-outline"
          size={16}
        />
        <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
          The notification contains no glucose value or health conclusion.
        </Text>
      </View>
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.message,
            {
              color:
                enabled || !notificationsAllowed
                  ? colors.textSecondary
                  : colors.textTertiary,
            },
          ]}
        >
          {message}
        </Text>
      ) : null}
      {!notificationsAllowed ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            void DaymarkGlucoseDisplay.openReviewNotificationSettingsAsync()
          }
          style={({ pressed }) => [
            styles.settingsButton,
            {
              borderColor: colors.border,
              borderRadius: radius.md,
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="settings-outline"
            size={17}
          />
          <Text style={[styles.settingsText, { color: colors.primary }]}>
            Open Android notification settings
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  loadingCard: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    lineHeight: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  schedule: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.65,
    marginTop: 2,
  },
  detail: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 16,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  settingsButton: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 14,
  },
  settingsText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});
