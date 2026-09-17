import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLUCOSE_ALERT_PREFERENCES,
  evaluateGlucoseAlert,
  GlucoseAlertPreferences,
  GlucoseAlertState,
  validateGlucoseAlertPreferences,
} from '@/domain/glucoseAlerts';
import { GlucoseReading } from '@/domain/models';

const NOW = Date.UTC(2026, 6, 27, 10);

function reading(mmolL: number, ageMinutes = 1): GlucoseReading {
  return {
    id: `reading:${mmolL}:${ageMinutes}`,
    sourceId: 'source',
    timestamp: NOW - ageMinutes * 60_000,
    receivedAt: NOW - ageMinutes * 60_000 + 2_000,
    mmolL,
    trend: 'flat',
    quality: 'measured',
  };
}

function preferences(
  override: Partial<GlucoseAlertPreferences> = {},
): GlucoseAlertPreferences {
  return {
    ...DEFAULT_GLUCOSE_ALERT_PREFERENCES,
    enabled: true,
    ...override,
  };
}

function state(
  override: Partial<GlucoseAlertState> = {},
): GlucoseAlertState {
  return { activeZone: 'normal', ...override };
}

describe('glucose alert policy', () => {
  it('is completely off by default', () => {
    const result = evaluateGlucoseAlert(
      reading(3.1),
      DEFAULT_GLUCOSE_ALERT_PREFERENCES,
      state(),
      NOW,
    );

    expect(result.zone).toBe('normal');
    expect(result.shouldNotify).toBe(false);
  });

  it('announces entry into a user-authored low or high zone once', () => {
    const low = evaluateGlucoseAlert(
      reading(3.8),
      preferences(),
      state(),
      NOW,
    );
    const high = evaluateGlucoseAlert(
      reading(14),
      preferences(),
      state(),
      NOW,
    );

    expect(low).toMatchObject({
      zone: 'low',
      shouldCancelExisting: true,
      shouldNotify: true,
    });
    expect(high).toMatchObject({
      zone: 'high',
      shouldCancelExisting: true,
      shouldNotify: true,
    });
  });

  it('uses hysteresis to avoid repeated alerts near a threshold', () => {
    const active = state({ activeZone: 'low', lastNotifiedAt: NOW - 60_000 });
    const stillLow = evaluateGlucoseAlert(
      reading(4.1),
      preferences(),
      active,
      NOW,
    );
    const resolved = evaluateGlucoseAlert(
      reading(4.3),
      preferences(),
      active,
      NOW,
    );

    expect(stillLow.zone).toBe('low');
    expect(stillLow.shouldNotify).toBe(false);
    expect(resolved.zone).toBe('normal');
    expect(resolved.shouldCancelExisting).toBe(true);
  });

  it('repeats only after the selected interval', () => {
    const active = state({
      activeZone: 'high',
      lastNotifiedAt: NOW - 29 * 60_000,
    });
    const early = evaluateGlucoseAlert(
      reading(15),
      preferences({ repeatMinutes: 30 }),
      active,
      NOW,
    );
    const due = evaluateGlucoseAlert(
      reading(15),
      preferences({ repeatMinutes: 30 }),
      active,
      NOW + 60_000,
    );
    const never = evaluateGlucoseAlert(
      reading(15),
      preferences({ repeatMinutes: 0 }),
      state({
        activeZone: 'high',
        lastNotifiedAt: NOW - 24 * 60 * 60_000,
      }),
      NOW,
    );

    expect(early.shouldNotify).toBe(false);
    expect(due.shouldNotify).toBe(true);
    expect(never.shouldNotify).toBe(false);
  });

  it('can announce stale data without treating delayed data as stale', () => {
    const options = preferences({ staleEnabled: true });
    expect(
      evaluateGlucoseAlert(reading(7, 11), options, state(), NOW).zone,
    ).toBe('normal');
    const stale = evaluateGlucoseAlert(
      reading(7, 13),
      options,
      state(),
      NOW,
    );
    expect(stale.zone).toBe('stale');
    expect(stale.shouldNotify).toBe(true);
  });

  it('does not infer stale data when no reading has ever existed', () => {
    const result = evaluateGlucoseAlert(
      undefined,
      preferences({ staleEnabled: true }),
      state(),
      NOW,
    );
    expect(result.zone).toBe('normal');
    expect(result.shouldNotify).toBe(false);
  });

  it('validates editable thresholds and repeat choices', () => {
    expect(validateGlucoseAlertPreferences(preferences())).toBeUndefined();
    expect(
      validateGlucoseAlertPreferences(
        preferences({ lowThresholdMmolL: 6.5 }),
      ),
    ).toMatch(/between 2.0 and 6.0/i);
    expect(
      validateGlucoseAlertPreferences(
        preferences({
          lowThresholdMmolL: 6,
          highThresholdMmolL: 6.5,
        }),
      ),
    ).toBeDefined();
    expect(
      validateGlucoseAlertPreferences({
        ...preferences(),
        repeatMinutes: 15 as 30,
      }),
    ).toMatch(/repeat interval/i);
  });
});
