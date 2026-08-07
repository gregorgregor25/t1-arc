import { describe, expect, it } from 'vitest';

import {
  chooseAutomaticHealthConnectSource,
  healthConnectSourceDisplayName,
} from '@/data/healthConnect/healthConnectSourcePolicy';

const NOW = Date.UTC(2026, 6, 28, 10);
const RECENT = NOW - 10 * 60 * 1000;

describe('automatic Health Connect source policy', () => {
  it('distinguishes legacy phone steps and known bridge apps', () => {
    expect(healthConnectSourceDisplayName('android', 'This phone')).toBe(
      'This phone (legacy steps)',
    );
    expect(
      healthConnectSourceDisplayName(
        'com.renpho.health',
        'com.renpho.health',
      ),
    ).toBe('Renpho Health');
  });

  it('selects the complete Health Sync step history when Samsung has no step records', () => {
    expect(
      chooseAutomaticHealthConnectSource(
        'steps',
        [
          {
            packageName: 'nl.appyhapps.healthsync',
            recordCount: 22_830,
            dataThrough: RECENT,
          },
          {
            packageName: 'com.android.healthconnect.phone.synthetic',
            recordCount: 1_597,
            dataThrough: RECENT,
          },
        ],
        NOW,
      )?.packageName,
    ).toBe('nl.appyhapps.healthsync');
  });

  it('does not replace complete recent history with a tiny direct-source sample', () => {
    expect(
      chooseAutomaticHealthConnectSource(
        'heart_rate',
        [
          {
            packageName: 'nl.appyhapps.healthsync',
            recordCount: 55_185,
            dataThrough: RECENT,
          },
          {
            packageName: 'com.sec.android.app.shealth',
            recordCount: 221,
            dataThrough: RECENT,
          },
        ],
        NOW,
      )?.packageName,
    ).toBe('nl.appyhapps.healthsync');
  });

  it('prefers fresh direct Renpho weight over a duplicated bridge copy', () => {
    expect(
      chooseAutomaticHealthConnectSource(
        'weight',
        [
          {
            packageName: 'nl.appyhapps.healthsync',
            recordCount: 70,
            dataThrough: RECENT,
          },
          {
            packageName: 'com.renpho.health',
            recordCount: 7,
            dataThrough: RECENT,
          },
        ],
        NOW,
      ),
    ).toEqual({
      packageName: 'com.renpho.health',
      reason: 'direct-device',
    });
  });

  it('uses a fresher source when another provider has stopped updating', () => {
    expect(
      chooseAutomaticHealthConnectSource(
        'sleep',
        [
          {
            packageName: 'nl.appyhapps.healthsync',
            recordCount: 5_000,
            dataThrough: NOW - 40 * 24 * 60 * 60 * 1000,
          },
          {
            packageName: 'com.sec.android.app.shealth',
            recordCount: 20,
            dataThrough: RECENT,
          },
        ],
        NOW,
      )?.packageName,
    ).toBe('com.sec.android.app.shealth');
  });
});
