import { describe, expect, it } from 'vitest';

import {
  buildHealthConnectExternalIdFilter,
  buildHealthConnectReconciliationFilter,
  healthConnectParentRecordIds,
  HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY,
} from '@/data/healthConnect/healthConnectReconciliation';

describe('Health Connect reconciliation', () => {
  it('covers every supported category, including nutrition', () => {
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.nutrition).toEqual([
      'nutrition',
    ]);
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.vitals).toContain(
      'blood_pressure_diastolic',
    );
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.blood_glucose).toEqual([
      'blood_glucose',
    ]);
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.distance).toEqual([
      'distance',
      'elevation_gained',
      'floors_climbed',
    ]);
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.workouts).toEqual([
      'workout',
      'workout_power',
      'workout_speed',
      'walking_cadence',
      'cycling_cadence',
    ]);
    expect(
      HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.body_composition,
    ).toContain('basal_metabolic_rate');
    expect(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY.cycle).toEqual([
      'menstruation_period',
      'menstruation_flow',
      'ovulation_test',
      'basal_body_temperature',
      'cervical_mucus',
      'intermenstrual_bleeding',
    ]);
    expect(Object.keys(HEALTH_CONNECT_RECORD_KINDS_BY_CATEGORY)).toHaveLength(
      13,
    );
  });

  it('limits deletion reconciliation to the completed time window', () => {
    const filter = buildHealthConnectReconciliationFilter(
      'heart_rate',
      1_000,
      9_000,
      12_000,
    );

    expect(filter.whereSql).toContain('kind IN (?, ?)');
    expect(filter.whereSql).toContain('start_ms < ?');
    expect(filter.whereSql).toContain('end_ms >= ?');
    expect(filter.whereSql).toContain('imported_at_ms <> ?');
    expect(filter.whereSql).not.toContain('source_package = ?');
    expect(filter.parameters).toEqual([
      'heart_rate',
      'resting_heart_rate',
      9_000,
      1_000,
      12_000,
    ]);
  });

  it('never removes archived records from an unselected source', () => {
    const filter = buildHealthConnectReconciliationFilter(
      'steps',
      1_000,
      9_000,
      12_000,
      'com.sec.android.app.shealth',
    );

    expect(filter.whereSql).toContain('source_package = ?');
    expect(filter.parameters.at(-1)).toBe(
      'com.sec.android.app.shealth',
    );
  });

  it('reconciles sampled and compound changes by their parent record id', () => {
    expect(
      healthConnectParentRecordIds([
        {
          externalId: 'heart-parent:1000',
          parentExternalId: 'heart-parent',
          kind: 'heart_rate',
          sourcePackage: 'com.sec.android.app.shealth',
          startTimeMs: 1_000,
          endTimeMs: 1_000,
          lastModifiedTimeMs: 2_000,
          recordingMethod: 2,
          clientRecordVersion: 1,
          value: 90,
          unit: 'bpm',
        },
        {
          externalId: 'heart-parent:2000',
          parentExternalId: 'heart-parent',
          kind: 'heart_rate',
          sourcePackage: 'com.sec.android.app.shealth',
          startTimeMs: 2_000,
          endTimeMs: 2_000,
          lastModifiedTimeMs: 2_000,
          recordingMethod: 2,
          clientRecordVersion: 1,
          value: 88,
          unit: 'bpm',
        },
      ]),
    ).toEqual(['heart-parent']);
  });

  it('builds a bound deletion filter for both direct and child records', () => {
    const filter = buildHealthConnectExternalIdFilter(['one', 'two', 'one']);
    expect(filter?.whereSql).toContain('external_id IN (?, ?)');
    expect(filter?.whereSql).toContain('parent_external_id IN (?, ?)');
    expect(filter?.parameters).toEqual(['one', 'two', 'one', 'two']);
    expect(buildHealthConnectExternalIdFilter([])).toBeUndefined();
  });
});
