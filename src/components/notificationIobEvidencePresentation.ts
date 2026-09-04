import type { TimestampedNotificationIob } from '@/data/notification/NotificationEventStore';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';

function formatIobUnits(value: number) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: 2,
  });
}

export function notificationIobEvidenceRows(
  records: readonly TimestampedNotificationIob[],
) {
  return records.map((record) => ({
    id: record.id,
    title: `${record.sourceLabel} notification`,
    sourceId: record.sourceId,
    packageName: record.packageName,
    capturedAt: record.capturedAt,
    iobLabel: `${formatIobUnits(record.iobUnits)} U IOB`,
    provenance:
      record.origin === 'restored'
        ? 'Restored from a T1 Arc backup; original notification capture time shown. T1 Arc did not calculate or interpolate this IOB value.'
        : record.origin === 'unknown'
          ? 'This record predates provenance tracking, so T1 Arc cannot verify whether it was captured on this phone or restored from a backup. The recorded notification capture time is shown; T1 Arc did not calculate or interpolate this IOB value.'
          : 'Reported by a notification captured on this phone; not calculated or interpolated by T1 Arc.',
  }));
}
