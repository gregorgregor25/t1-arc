import { describe, expect, it } from 'vitest';

import {
  CapturedNotificationEnvelope,
  NotificationCaptureRule,
} from '../modules/daymark-notification-source';
import { parseCapturedNotification } from '@/data/notification/notificationParser';
import { NOTIFICATION_SOURCE_ID } from '@/data/notification/types';

const rule: NotificationCaptureRule = {
  packageName: 'com.insulet.myblue.pdm',
  displayName: 'Omnipod 5',
  captureGlucose: true,
  captureInsulin: true,
  glucoseUnit: 'auto',
};

function envelope(
  overrides: Partial<CapturedNotificationEnvelope> = {},
): CapturedNotificationEnvelope {
  return {
    id: 'notification-1',
    packageName: rule.packageName,
    postedAt: Date.UTC(2026, 6, 26, 12),
    receivedAt: Date.UTC(2026, 6, 26, 12, 0, 2),
    isOngoing: true,
    textLines: [],
    ...overrides,
  };
}

describe('notification source parser', () => {
  it('extracts unit-labelled mmol/L glucose and direction', () => {
    const parsed = parseCapturedNotification(
      envelope({ title: '7.8 mmol/L ↑', text: 'Rising' }),
      rule,
    );
    expect(parsed.glucose).toMatchObject({
      sourceId: NOTIFICATION_SOURCE_ID,
      mmolL: 7.8,
      trend: 'up',
    });
  });

  it('converts unit-labelled mg/dL values', () => {
    const parsed = parseCapturedNotification(
      envelope({ bigText: 'Sensor glucose 108 mg/dL →' }),
      rule,
    );
    expect(parsed.glucose?.mmolL).toBe(6);
    expect(parsed.glucose?.trend).toBe('flat');
  });

  it('does not guess a unitless number while configured for auto units', () => {
    const parsed = parseCapturedNotification(
      envelope({ title: 'Automated Mode', text: 'IOB 1.25 U' }),
      rule,
    );
    expect(parsed.glucose).toBeUndefined();
    expect(parsed.pump).toEqual({
      iobUnits: 1.25,
      mode: 'automated',
    });
  });

  it('accepts a labelled unitless glucose value with an explicit unit', () => {
    const parsed = parseCapturedNotification(
      envelope({ text: 'Sensor glucose: 126 ↗' }),
      { ...rule, glucoseUnit: 'mgDl' },
    );
    expect(parsed.glucose?.mmolL).toBe(7);
    expect(parsed.glucose?.trend).toBe('slightUp');
  });

  it('uses a plausible source event time but rejects future times', () => {
    const sourceTime = Date.UTC(2026, 6, 26, 11, 59);
    const accepted = parseCapturedNotification(
      envelope({
        notificationWhen: sourceTime,
        text: '6.4 mmol/L',
      }),
      rule,
    );
    expect(accepted.glucose?.timestamp).toBe(sourceTime);

    const rejected = parseCapturedNotification(
      envelope({
        notificationWhen: Date.UTC(2030, 0, 1),
        text: '6.4 mmol/L',
      }),
      rule,
    );
    expect(rejected.glucose?.timestamp).toBe(
      Date.UTC(2026, 6, 26, 12),
    );
  });

  it('rejects implausible glucose values', () => {
    const parsed = parseCapturedNotification(
      envelope({ text: 'Sensor glucose 999 mg/dL' }),
      rule,
    );
    expect(parsed.glucose).toBeUndefined();
  });
});
