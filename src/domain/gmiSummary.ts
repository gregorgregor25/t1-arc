import { calculateGlucoseStatistics } from './glucoseStatistics';
import type { GlucoseReading, TimeRange } from './models';

export function gmiSummary(readings: readonly GlucoseReading[], range: TimeRange) {
  const stats = calculateGlucoseStatistics({ readings, range });
  const representative = range.end - range.start >= 14 * 86_400_000 && stats.coveragePercent >= 70;
  const percent = stats.glucoseManagementIndicatorPercent;
  return {
    percent,
    mmolMol: percent === null ? null : Math.round((percent - 2.15) * 10.929),
    coveragePercent: stats.coveragePercent,
    representative,
    latestAt: readings.reduce<number | undefined>((latest, reading) =>
      reading.timestamp >= range.start && reading.timestamp < range.end
        ? Math.max(latest ?? 0, reading.timestamp) : latest, undefined),
  };
}
