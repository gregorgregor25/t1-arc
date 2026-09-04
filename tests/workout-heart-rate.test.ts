import { describe, expect, it } from 'vitest';

import type { DailyMetricRecord } from '@/domain/dailyHealthMetrics';
import { summarizeWorkoutHeartRate } from '@/domain/workoutHeartRate';

function heartRate(
  id: string,
  start: number,
  value: number,
  end = start,
  sourceLabel = 'Pixel Watch',
): DailyMetricRecord {
  return {
    id,
    kind: 'heart_rate',
    sourcePackage: 'com.google.android.apps.fitness',
    sourceLabel,
    start,
    end,
    value,
    unit: 'bpm',
  };
}

describe('workout heart-rate summary', () => {
  it('includes point samples at both workout boundaries', () => {
    expect(
      summarizeWorkoutHeartRate(
        { start: 1_000, end: 2_000 },
        [heartRate('start', 1_000, 100), heartRate('end', 2_000, 140)],
      ),
    ).toMatchObject({
      averageBpm: 120,
      minimumBpm: 100,
      maximumBpm: 140,
      sampleCount: 2,
    });
  });

  it('excludes records outside the workout and intervals that only touch it', () => {
    expect(
      summarizeWorkoutHeartRate(
        { start: 1_000, end: 2_000 },
        [
          heartRate('before', 900, 70),
          heartRate('after', 2_100, 80),
          heartRate('touch-start', 500, 90, 1_000),
          heartRate('touch-end', 2_000, 100, 2_500),
        ],
      ),
    ).toBeUndefined();
  });

  it('summarises multiple selected samples and retains unique source provenance', () => {
    expect(
      summarizeWorkoutHeartRate(
        { start: 1_000, end: 2_000 },
        [
          heartRate('one', 1_100, 101, 1_100, 'Pixel Watch'),
          heartRate('two', 1_300, 126, 1_300, 'Pixel Watch'),
          heartRate('three', 1_700, 164, 1_700, 'Health Connect'),
          { ...heartRate('resting', 1_500, 55), kind: 'resting_heart_rate' },
        ],
      ),
    ).toEqual({
      averageBpm: 391 / 3,
      minimumBpm: 101,
      maximumBpm: 164,
      sampleCount: 3,
      sourceLabels: ['Pixel Watch', 'Health Connect'],
    });
  });
});
