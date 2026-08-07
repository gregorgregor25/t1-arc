import DaymarkGlucoseDisplay from '../../../modules/daymark-glucose-display';

import { weeklyReviewSchedule } from '@/domain/weeklyReviewSchedule';

import { generateInsightReviewIfDue } from './insightReviewGenerator';
import {
  loadInsightReviewPreferences,
  markWeeklyReviewNotified,
} from './insightReviewPreferences';

export interface ScheduledInsightReviewResult {
  generated: boolean;
  notificationDue: boolean;
  notificationShown: boolean;
}
export async function runScheduledInsightReview(
  now = Date.now(),
): Promise<ScheduledInsightReviewResult> {
  const [generation, preferences] = await Promise.all([
    generateInsightReviewIfDue(now),
    loadInsightReviewPreferences(),
  ]);
  if (
    !preferences.weeklyNotificationEnabled ||
    !generation.saved.report.ready
  ) {
    return {
      generated: generation.changed,
      notificationDue: false,
      notificationShown: false,
    };
  }

  const schedule = weeklyReviewSchedule(
    now,
    preferences.lastNotifiedWeek,
  );
  if (!schedule.due) {
    return {
      generated: generation.changed,
      notificationDue: false,
      notificationShown: false,
    };
  }

  const notificationShown =
    await DaymarkGlucoseDisplay.showReviewReadyNotificationAsync();
  if (notificationShown) {
    await markWeeklyReviewNotified(schedule.weekKey);
  }
  return {
    generated: generation.changed,
    notificationDue: true,
    notificationShown,
  };
}
