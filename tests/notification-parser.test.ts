import { describe, expect, it } from 'vitest';

import {
  CapturedNotificationEnvelope,
  NotificationCaptureRule,
} from '../modules/t1arc-notification-source';
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

  it('rejects a negative IOB value instead of stripping its sign', () => {
    const parsed = parseCapturedNotification(
      envelope({ text: 'IOB -1.2 U' }),
      rule,
    );
    expect(parsed.pump?.iobUnits).toBeUndefined();
  });

  it('fails closed on distinct IOB values but accepts identical repeated labels', () => {
    const ambiguous = parseCapturedNotification(
      envelope({ title: 'IOB 1.2 U', text: 'IOB 2.4 U' }),
      rule,
    );
    expect(ambiguous.pump?.iobUnits).toBeUndefined();

    const duplicate = parseCapturedNotification(
      envelope({ title: 'IOB 1.2 U', text: 'IOB 1.20 U' }),
      rule,
    );
    expect(duplicate.pump?.iobUnits).toBe(1.2);
  });

  it.each([
    'IOB 3.5 mmol/L',
    'IOB 5 minutes',
    'IOB 42 carbs',
    'IOB 1.25',
  ])('requires an explicit insulin unit and rejects %s', (text) => {
    const parsed = parseCapturedNotification(envelope({ text }), rule);
    expect(parsed.pump?.iobUnits).toBeUndefined();
  });

  it.each([
    ['IOB 0 U', 0],
    ['IOB 1,25 units', 1.25],
    ['insulin on board: 2.4 unit', 2.4],
  ] as const)('accepts explicit insulin units in %s', (text, expected) => {
    const parsed = parseCapturedNotification(envelope({ text }), rule);
    expect(parsed.pump?.iobUnits).toBe(expected);
  });

  it('accepts a unitless value recovered from a custom notification view', () => {
    const parsed = parseCapturedNotification(
      envelope({ textLines: ['5.2'] }),
      { ...rule, glucoseUnit: 'mmolL' },
    );
    expect(parsed.glucose?.mmolL).toBe(5.2);
  });

  it.each([
    ['Arabic-Indic digits', '٧٫٨ mmol/L ↑', 7.8],
    ['Persian digits', '۷٫۸ mmol/L ↑', 7.8],
    ['full-width digits', '１０８ mg/dL →', 6],
  ] as const)(
    'normalises %s before parsing an explicitly unit-labelled value',
    (_label, text, expected) => {
      const parsed = parseCapturedNotification(envelope({ text }), rule);
      expect(parsed.glucose?.mmolL).toBe(expected);
    },
  );

  it('normalises locale digits for an explicitly configured value-only rule', () => {
    const parsed = parseCapturedNotification(
      envelope({ textLines: ['٦٫١'] }),
      { ...rule, glucoseUnit: 'mmolL' },
    );
    expect(parsed.glucose?.mmolL).toBe(6.1);
  });

  it('does not guess between several unlabelled custom-view numbers', () => {
    const parsed = parseCapturedNotification(
      envelope({ textLines: ['5.2', '6.1'] }),
      { ...rule, glucoseUnit: 'mmolL' },
    );
    expect(parsed.glucose).toBeUndefined();
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
