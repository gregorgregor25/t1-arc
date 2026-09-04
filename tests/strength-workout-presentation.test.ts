import { afterEach, describe, expect, it } from 'vitest';

import { formatStrengthWorkoutSet } from '@/domain/strengthWorkoutPresentation';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

describe('strength workout presentation', () => {
  it('shows every set metric in a compact human-friendly line', () => {
    expect(
      formatStrengthWorkoutSet({
        index: 0,
        type: 'warmup',
        weightKilograms: 20,
        reps: 1,
        durationSeconds: 90,
        distanceMetres: 1_250,
        rpe: 6.5,
        customMetric: 12.25,
      }),
    ).toBe(
      'Warm-up · 20 kg · 1 rep · 1 min 30 sec · 1.25 km · RPE 6.5 · Custom metric 12.25',
    );
  });

  it('keeps zero values and omits the ordinary set type', () => {
    expect(
      formatStrengthWorkoutSet({
        index: 1,
        type: 'normal',
        weightKilograms: 0,
        reps: 0,
        durationSeconds: 0,
        distanceMetres: 0,
        rpe: 0,
        customMetric: 0,
      }),
    ).toBe('0 kg · 0 reps · 0 sec · 0 m · RPE 0 · Custom metric 0');
  });

  it('labels special and unknown set types without exposing API casing', () => {
    expect(
      formatStrengthWorkoutSet({ index: 2, type: 'dropset', reps: 8 }),
    ).toBe('Drop set · 8 reps');
    expect(
      formatStrengthWorkoutSet({ index: 3, type: 'myo_reps' }),
    ).toBe('Myo Reps');
    expect(
      formatStrengthWorkoutSet({ index: 4, type: 'normal' }),
    ).toBe('Recorded set');
  });

  it('uses regional digits for set duration components', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'ar-EG',
    });

    expect(
      formatStrengthWorkoutSet({
        index: 5,
        type: 'normal',
        reps: 2,
        durationSeconds: 90,
      }),
    ).toBe('٢ reps · ١ min ٣٠ sec');
  });
});
