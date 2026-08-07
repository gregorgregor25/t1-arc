import { describe, expect, it } from 'vitest';

import {
  aggregateDailyHealthMetrics,
  DailyMetricRecord,
} from '@/domain/dailyHealthMetrics';

const HOUR = 3_600_000;
const range = { start: 0, end: 24 * HOUR };

function record(
  kind: DailyMetricRecord['kind'],
  value: number,
  sourcePackage = 'com.example.health',
  start = 0,
  end = HOUR,
): DailyMetricRecord {
  return {
    id: `${kind}:${sourcePackage}:${start}`,
    kind,
    value,
    sourcePackage,
    sourceLabel:
      sourcePackage === 'com.example.health' ? 'Example Health' : 'Other',
    start,
    end,
    unit:
      kind === 'steps'
        ? 'count'
        : kind === 'distance'
          ? 'm'
          : kind === 'active_calories'
            ? 'kcal'
            : kind === 'body_fat'
              ? 'percent'
              : kind === 'height'
                ? 'm'
                : kind === 'oxygen_saturation'
                  ? 'percent'
                  : kind === 'blood_glucose'
                    ? 'mmol/L'
                  : kind === 'blood_pressure_systolic' ||
                      kind === 'blood_pressure_diastolic'
                    ? 'mmHg'
                    : kind === 'respiratory_rate'
                      ? 'breaths/min'
                      : kind === 'heart_rate_variability_rmssd'
                        ? 'ms'
                        : kind === 'vo2_max'
                          ? 'ml/kg/min'
                          : kind === 'body_temperature'
                            ? 'celsius'
                            : kind === 'hydration'
                              ? 'litre'
                : kind === 'heart_rate' ||
                    kind === 'resting_heart_rate'
                  ? 'bpm'
                  : 'kg',
  };
}

describe('daily Health Connect metrics', () => {
  it('aggregates additive metrics and heart-rate samples', () => {
    const metrics = aggregateDailyHealthMetrics(
      [
        record('steps', 3_000),
        record('steps', 2_500, 'com.example.health', HOUR, 2 * HOUR),
        record('distance', 4_250),
        record('active_calories', 381.4),
        record('heart_rate', 72, 'com.example.health', HOUR, HOUR),
        record('heart_rate', 108, 'com.example.health', 2 * HOUR, 2 * HOUR),
        record(
          'resting_heart_rate',
          61,
          'com.example.health',
          3 * HOUR,
          3 * HOUR,
        ),
      ],
      range,
    );

    expect(metrics.steps).toBe(5_500);
    expect(metrics.distanceKilometres).toBe(4.3);
    expect(metrics.activeCaloriesKcal).toBe(381);
    expect(metrics.averageHeartRateBpm).toBe(90);
    expect(metrics.restingHeartRateBpm).toBe(61);
    expect(metrics.minimumHeartRateBpm).toBe(72);
    expect(metrics.maximumHeartRateBpm).toBe(108);
    expect(metrics.sourceLabels).toEqual(['Example Health']);
    expect(metrics.selectedRecordIds).toHaveLength(7);
  });

  it('prorates an interval that crosses the selected day boundary', () => {
    const metrics = aggregateDailyHealthMetrics(
      [record('steps', 1_000, 'com.example.health', -HOUR, HOUR)],
      range,
    );
    expect(metrics.steps).toBe(500);
  });

  it('withholds additive values when multiple sources need a choice', () => {
    const records = [
      record('steps', 4_000),
      record('steps', 6_000, 'com.other.health'),
    ];
    const ambiguous = aggregateDailyHealthMetrics(records, range);
    expect(ambiguous.steps).toBeUndefined();
    expect(ambiguous.needsSource).toEqual(['steps']);

    const selected = aggregateDailyHealthMetrics(records, range, {
      steps: 'com.other.health',
    });
    expect(selected.steps).toBe(6_000);
    expect(selected.needsSource).toEqual([]);
    expect(selected.selectedRecordIds).toEqual([
      'steps:com.other.health:0',
    ]);
  });

  it('keeps the latest body measurements for the selected day', () => {
    const metrics = aggregateDailyHealthMetrics(
      [
        record('weight', 82.4, 'com.example.health', HOUR, HOUR),
        record('weight', 81.9, 'com.example.health', 2 * HOUR, 2 * HOUR),
        record('body_fat', 21.7, 'com.example.health', 2 * HOUR, 2 * HOUR),
        record(
          'lean_body_mass',
          64.1,
          'com.example.health',
          2 * HOUR,
          2 * HOUR,
        ),
        record(
          'body_water_mass',
          47.8,
          'com.example.health',
          2 * HOUR,
          2 * HOUR,
        ),
        record('bone_mass', 3.2, 'com.example.health', 2 * HOUR, 2 * HOUR),
        record('height', 1.81, 'com.example.health', 2 * HOUR, 2 * HOUR),
        record(
          'basal_metabolic_rate',
          1_840,
          'com.example.health',
          2 * HOUR,
          2 * HOUR,
        ),
      ],
      range,
    );

    expect(metrics.weightKilograms).toBe(81.9);
    expect(metrics.bodyFatPercent).toBe(21.7);
    expect(metrics.leanBodyMassKilograms).toBe(64.1);
    expect(metrics.bodyWaterMassKilograms).toBe(47.8);
    expect(metrics.boneMassKilograms).toBe(3.2);
    expect(metrics.heightMetres).toBe(1.81);
    expect(metrics.basalMetabolicRateKcalPerDay).toBe(1_840);
  });

  it('keeps Samsung movement and workout detail in the correct units', () => {
    const metrics = aggregateDailyHealthMetrics(
      [
        record('distance', 5_250),
        record('elevation_gained', 84),
        record('floors_climbed', 12),
        record('total_calories', 540),
        record('workout_power', 180, 'com.example.health', HOUR, HOUR),
        record('workout_power', 260, 'com.example.health', 2 * HOUR, 2 * HOUR),
        record('workout_speed', 3, 'com.example.health', HOUR, HOUR),
        record('workout_speed', 4, 'com.example.health', 2 * HOUR, 2 * HOUR),
        record('walking_cadence', 112, 'com.example.health', HOUR, HOUR),
        record('cycling_cadence', 88, 'com.example.health', HOUR, HOUR),
      ],
      range,
    );

    expect(metrics.distanceKilometres).toBe(5.3);
    expect(metrics.elevationGainedMetres).toBe(84);
    expect(metrics.floorsClimbed).toBe(12);
    expect(metrics.activeCaloriesKcal).toBeUndefined();
    expect(metrics.totalCaloriesKcal).toBe(540);
    expect(metrics.averageWorkoutPowerWatts).toBe(220);
    expect(metrics.maximumWorkoutPowerWatts).toBe(260);
    expect(metrics.averageWorkoutSpeedMetresPerSecond).toBe(3.5);
    expect(metrics.maximumWorkoutSpeedMetresPerSecond).toBe(4);
    expect(metrics.averageWalkingCadencePerMinute).toBe(112);
    expect(metrics.averageCyclingCadenceRpm).toBe(88);
  });

  it('never relabels total energy as active energy', () => {
    const totalOnly = aggregateDailyHealthMetrics(
      [record('total_calories', 2_140)],
      range,
    );
    expect(totalOnly.totalCaloriesKcal).toBe(2_140);
    expect(totalOnly.activeCaloriesKcal).toBeUndefined();

    const both = aggregateDailyHealthMetrics(
      [
        record('active_calories', 640),
        record('total_calories', 2_140),
      ],
      range,
    );
    expect(both.activeCaloriesKcal).toBe(640);
    expect(both.totalCaloriesKcal).toBe(2_140);
  });

  it('keeps daily vitals and totals hydration without inventing gaps', () => {
    const metrics = aggregateDailyHealthMetrics(
      [
        {
          ...record(
            'blood_glucose',
            6.4,
            'com.example.health',
            HOUR,
            HOUR,
          ),
          specimenSource: 2,
          relationToMeal: 3,
          mealType: 1,
        },
        record('blood_pressure_systolic', 118, 'com.example.health', HOUR, HOUR),
        record('blood_pressure_diastolic', 74, 'com.example.health', HOUR, HOUR),
        record('oxygen_saturation', 98.2, 'com.example.health', HOUR, HOUR),
        record('respiratory_rate', 15.4, 'com.example.health', HOUR, HOUR),
        record(
          'heart_rate_variability_rmssd',
          43,
          'com.example.health',
          HOUR,
          HOUR,
        ),
        record('vo2_max', 46.3, 'com.example.health', HOUR, HOUR),
        record('body_temperature', 36.7, 'com.example.health', HOUR, HOUR),
        record('hydration', 0.5, 'com.example.health', HOUR, 2 * HOUR),
        record('hydration', 0.35, 'com.example.health', 2 * HOUR, 3 * HOUR),
      ],
      range,
    );

    expect(metrics.bloodGlucoseMmolL).toBe(6.4);
    expect(metrics.bloodPressureSystolic).toBe(118);
    expect(metrics.bloodPressureDiastolic).toBe(74);
    expect(metrics.oxygenSaturationPercent).toBe(98.2);
    expect(metrics.respiratoryRatePerMinute).toBe(15.4);
    expect(metrics.heartRateVariabilityRmssdMs).toBe(43);
    expect(metrics.vo2MaxMillilitresPerKilogramMinute).toBe(46.3);
    expect(metrics.bodyTemperatureCelsius).toBe(36.7);
    expect(metrics.hydrationLitres).toBe(0.85);
  });
});
