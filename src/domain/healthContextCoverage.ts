import type {
  DailyHealthMetrics,
  DailyMetricCategory,
} from './dailyHealthMetrics';
import type { HealthContextEvent, TimeRange } from './models';

export type HealthContextCoverageStatus =
  | 'recorded'
  | 'missing'
  | 'source-needed';

export interface HealthContextCoverageItem {
  id:
    | 'movement'
    | 'workouts'
    | 'sleep'
    | 'heart'
    | 'body'
    | 'vitals'
    | 'hormones'
    | 'hydration';
  label: string;
  status: HealthContextCoverageStatus;
}

function overlapsRange(event: HealthContextEvent, range: TimeRange) {
  const end =
    event.end ??
    ('durationMinutes' in event
      ? event.start + event.durationMinutes * 60_000
      : event.start);
  return event.start < range.end && end >= range.start;
}

function needsAnySource(
  metrics: DailyHealthMetrics | undefined,
  categories: DailyMetricCategory[],
) {
  return categories.some((category) =>
    metrics?.needsSource.includes(category),
  );
}

function status(
  recorded: boolean,
  sourceNeeded: boolean,
): HealthContextCoverageStatus {
  if (sourceNeeded) return 'source-needed';
  return recorded ? 'recorded' : 'missing';
}

export function buildHealthContextCoverage(
  metrics: DailyHealthMetrics | undefined,
  events: HealthContextEvent[],
  range: TimeRange,
): HealthContextCoverageItem[] {
  const eventsInRange = events.filter((event) => overlapsRange(event, range));
  const hasMovement =
    metrics?.steps !== undefined ||
    metrics?.distanceKilometres !== undefined ||
    metrics?.activeCaloriesKcal !== undefined;
  const hasHeart =
    metrics?.averageHeartRateBpm !== undefined ||
    metrics?.restingHeartRateBpm !== undefined ||
    metrics?.heartRateVariabilityRmssdMs !== undefined;
  const hasBody =
    metrics?.weightKilograms !== undefined ||
    metrics?.bodyFatPercent !== undefined ||
    metrics?.leanBodyMassKilograms !== undefined ||
    metrics?.bodyWaterMassKilograms !== undefined ||
    metrics?.boneMassKilograms !== undefined ||
    metrics?.heightMetres !== undefined;
  const hasVitals =
    metrics?.bloodGlucoseMmolL !== undefined ||
    metrics?.bloodPressureSystolic !== undefined ||
    metrics?.bloodPressureDiastolic !== undefined ||
    metrics?.oxygenSaturationPercent !== undefined ||
    metrics?.respiratoryRatePerMinute !== undefined ||
    metrics?.vo2MaxMillilitresPerKilogramMinute !== undefined ||
    metrics?.bodyTemperatureCelsius !== undefined;

  return [
    {
      id: 'movement',
      label: 'Movement',
      status: status(
        hasMovement,
        needsAnySource(metrics, [
          'steps',
          'distance',
          'active_calories',
        ]),
      ),
    },
    {
      id: 'workouts',
      label: 'Workouts',
      status: status(
        eventsInRange.some((event) => event.kind === 'activity'),
        false,
      ),
    },
    {
      id: 'sleep',
      label: 'Sleep',
      status: status(
        eventsInRange.some((event) => event.kind === 'sleep'),
        false,
      ),
    },
    {
      id: 'heart',
      label: 'Heart',
      status: status(
        hasHeart,
        needsAnySource(metrics, ['heart_rate']),
      ),
    },
    {
      id: 'body',
      label: 'Body',
      status: status(
        hasBody,
        needsAnySource(metrics, ['weight', 'body_composition']),
      ),
    },
    {
      id: 'vitals',
      label: 'Vitals',
      status: status(
        hasVitals,
        needsAnySource(metrics, ['blood_glucose', 'vitals']),
      ),
    },
    {
      id: 'hormones',
      label: 'Hormones',
      status: status(
        eventsInRange.some(
          (event) =>
            event.kind === 'note' && event.category === 'hormones',
        ),
        false,
      ),
    },
    {
      id: 'hydration',
      label: 'Hydration',
      status: status(
        metrics?.hydrationLitres !== undefined,
        needsAnySource(metrics, ['hydration']),
      ),
    },
  ];
}
