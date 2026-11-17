import { useEffect, useState } from 'react';

import {
  glucoseAlarmSupportAvailable,
  loadGlucoseAlarmConfiguration,
} from '@/data/glucoseAlerts/glucoseAlarms';
import type { NightSchedule } from '@/domain/overnightWindow';

/**
 * The night schedule saved in alarm settings, when night alerts are turned
 * on. Reading it never saves, arms or changes an alarm. Null means "use the
 * 00:00–06:00 default".
 */
export function useNightSchedule(): NightSchedule | null {
  const [schedule, setSchedule] = useState<NightSchedule | null>(null);
  useEffect(() => {
    let active = true;
    if (!glucoseAlarmSupportAvailable()) return;
    loadGlucoseAlarmConfiguration()
      .then((configuration) => {
        if (!active) return;
        setSchedule(configuration.nightEnabled
          ? { startMinutes: configuration.nightStartMinutes, endMinutes: configuration.nightEndMinutes }
          : null);
      })
      .catch(() => {
        if (active) setSchedule(null);
      });
    return () => { active = false; };
  }, []);
  return schedule;
}
