import { generateInsightReviewIfDue } from './insightReviewGenerator';
import {
  publishWeeklyReviewNotificationIfDue,
} from './insightReviewPreferences';
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

export interface ScheduledInsightReviewResult {
  generated: boolean;
  notificationDue: boolean;
  notificationShown: boolean;
}
export async function runScheduledInsightReview(
  now = Date.now(),
  lease?: LocalDataWriteLease,
): Promise<ScheduledInsightReviewResult> {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const generation = await generateInsightReviewIfDue(
    now,
    undefined,
    writeLease,
  );
  if (!generation.saved.report.ready) {
    return {
      generated: generation.changed,
      notificationDue: false,
      notificationShown: false,
    };
  }

  const publication = await publishWeeklyReviewNotificationIfDue(
    now,
    writeLease,
  );
  return {
    generated: generation.changed,
    notificationDue: publication.due,
    notificationShown: publication.shown,
  };
}
