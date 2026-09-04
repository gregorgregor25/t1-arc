import type { PumpSettingScheduleSegment } from './glookoReport';
import {
  formatGlucose,
  formatRegionalNumber,
} from '@/domain/regionalFormat';
import { formatRegionalWallClock } from '@/domain/regionalWallClock';
import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';

type GlookoScheduleRegionalSettings = Pick<
  T1ArcRegionalDefaults,
  'glucoseUnit' | 'locale'
>;

export function formatGlookoPumpScheduleSegment(
  segment: PumpSettingScheduleSegment,
  regional: GlookoScheduleRegionalSettings,
) {
  const time = formatRegionalWallClock(segment.startTime, regional.locale);
  const measurement =
    segment.unit === 'mmol/L'
      ? formatGlucose(segment.value, regional)
      : `${formatRegionalNumber(segment.value, regional.locale)} ${segment.unit}`;
  return `${time} ${measurement}`;
}
