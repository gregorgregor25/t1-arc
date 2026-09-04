import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useRef, useState } from 'react';
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

import T1ArcGlucoseDisplay from '../../modules/t1arc-glucose-display';
import {
  loadInsightReviewPreferences,
  setWeeklyReviewNotificationEnabled,
  setWeeklyReviewTiming,
} from '@/data/insights/insightReviewPreferences';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import {
  reviewTimeLabel,
  reviewWeekdayLabel,
  weeklyReviewScheduleLabel,
} from './insightReviewSchedulePresentation';
import {
  pickerTimeForWallClock,
  regionalClockUses24Hours,
} from './zonedDateTimePicker';

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
  const { defaults: regional } = useRegionalProfile();
  const [enabled, setEnabled] = useState(false);
  const [reviewWeekday, setReviewWeekday] = useState<number>();
  const [reviewHour, setReviewHour] = useState(7);
  const [reviewMinute, setReviewMinute] = useState(0);
  const [notificationsAllowed, setNotificationsAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const reloadGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++reloadGeneration.current;
    const [preferences, reviewNotificationsAllowed] = await Promise.all([
      loadInsightReviewPreferences(),
      T1ArcGlucoseDisplay.reviewNotificationsAllowedAsync().catch(
        () => false,
      ),
    ]);
    if (reloadGeneration.current !== generation) return;
    setEnabled(preferences.weeklyNotificationEnabled);
    setReviewWeekday(preferences.reviewWeekday);
    setReviewHour(preferences.reviewHour ?? 7);
    setReviewMinute(preferences.reviewMinute ?? 0);
    setNotificationsAllowed(reviewNotificationsAllowed);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void reload();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    return () => {
      active = false;
      reloadGeneration.current += 1;
      subscription.remove();
    };
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
      await reload();
      setMessage(
        next
          ? 'Weekly reviews will be announced after the selected local time when Android next runs T1 Arc.'
          : 'Weekly review notifications are off. Reviews remain available privately in the app.',
      );
    } catch {
      setMessage('The weekly review setting could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function changeTiming(
    next: {
      reviewWeekday?: number;
      reviewHour: number;
      reviewMinute: number;
    },
  ) {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const saved = await setWeeklyReviewTiming(next);
      setReviewWeekday(saved.reviewWeekday);
      setReviewHour(saved.reviewHour ?? 7);
      setReviewMinute(saved.reviewMinute ?? 0);
      setMessage(
        `The review schedule now follows ${regional.timeZone} local time.`,
      );
    } catch {
      setMessage('The weekly review schedule could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function chooseTime() {
    if (Platform.OS !== 'android' || busy) return;
    DateTimePickerAndroid.open({
      value: pickerTimeForWallClock(reviewHour, reviewMinute),
      mode: 'time',
      is24Hour: regionalClockUses24Hours(regional.locale),
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        void changeTiming({
          reviewWeekday,
          reviewHour: selected.getHours(),
          reviewMinute: selected.getMinutes(),
        });
      },
    });
  }

  const effectiveWeekday = reviewWeekday ?? regional.firstDayOfWeek;
  const weekdayLabels = Array.from({ length: 7 }, (_, weekday) =>
    reviewWeekdayLabel(regional.locale, weekday),
  );
  const timeLabel = reviewTimeLabel(regional.locale, reviewHour, reviewMinute);
  const scheduleLabel = weeklyReviewScheduleLabel({
    hour: reviewHour,
    locale: regional.locale,
    minute: reviewMinute,
    timeZone: regional.timeZone,
    weekday: effectiveWeekday,
  });

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
            {scheduleLabel}
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
      <Text style={[styles.controlLabel, { color: colors.textTertiary }]}>
        REVIEW DAY
      </Text>
      <View style={styles.dayOptions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: reviewWeekday === undefined }}
          disabled={busy}
          onPress={() =>
            void changeTiming({
              reviewWeekday: undefined,
              reviewHour,
              reviewMinute,
            })
          }
          style={({ pressed }) => [
            styles.dayOption,
            {
              backgroundColor:
                reviewWeekday === undefined
                  ? `${colors.primary}18`
                  : colors.surfaceMuted,
              borderColor:
                reviewWeekday === undefined ? colors.primary : colors.border,
              borderRadius: radius.pill,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
        >
          <Text style={[styles.dayOptionText, { color: colors.textSecondary }]}>
            Regional
          </Text>
        </Pressable>
        {weekdayLabels.map((label, weekday) => (
          <Pressable
            accessibilityLabel={`Review on ${reviewWeekdayLabel(
              regional.locale,
              weekday,
              'long',
            )}`}
            accessibilityRole="button"
            accessibilityState={{ selected: reviewWeekday === weekday }}
            disabled={busy}
            key={weekday}
            onPress={() =>
              void changeTiming({
                reviewWeekday: weekday,
                reviewHour,
                reviewMinute,
              })
            }
            style={({ pressed }) => [
              styles.dayOption,
              {
                backgroundColor:
                  reviewWeekday === weekday
                    ? `${colors.primary}18`
                    : colors.surfaceMuted,
                borderColor:
                  reviewWeekday === weekday ? colors.primary : colors.border,
                borderRadius: radius.pill,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Text
              style={[styles.dayOptionText, { color: colors.textSecondary }]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityLabel={`Review time ${timeLabel}`}
        accessibilityRole="button"
        disabled={busy}
        onPress={chooseTime}
        style={({ pressed }) => [
          styles.timeButton,
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
          name="time-outline"
          size={17}
        />
        <Text style={[styles.timeButtonText, { color: colors.primary }]}>
          {timeLabel}
        </Text>
      </Pressable>
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
            void T1ArcGlucoseDisplay.openReviewNotificationSettingsAsync()
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
  controlLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.65,
    marginTop: 16,
  },
  dayOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
  },
  dayOption: {
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  dayOptionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  timeButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  timeButtonText: {
    fontSize: 13,
    fontWeight: '800',
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
