import { describe, expect, it } from 'vitest';

import { parseCapturedNotification } from '@/data/notification/notificationParser';
import {
  DIAEXPERT_MMOLL_PACKAGE,
  fixedNotificationUnit,
  normalizeKnownNotificationRule,
  SUPPORTED_NOTIFICATION_APPS,
  timestampedIobEvidenceApp,
} from '@/data/notification/supportedApps';

describe('supported notification apps', () => {
  it('uses an explicit parser-contract allowlist for retrospective IOB evidence', () => {
    expect(
      timestampedIobEvidenceApp('com.insulet.myblue.pdm')?.displayName,
    ).toBe('Omnipod 5');
    expect(timestampedIobEvidenceApp('com.gluroo.gluroo')).toBeUndefined();
    expect(
      timestampedIobEvidenceApp('com.medtronic.diabetes.minimedmobile.eu'),
    ).toBeUndefined();
    expect(timestampedIobEvidenceApp('com.dexcom.g7')).toBeUndefined();
  });

  it.each([
    ['com.camdiab.camapsfx', 'mmolL'],
    ['com.camdiab.camapsfx.mgdl', 'mgDl'],
    ['com.microtechmd.cgms.mmol', 'mmolL'],
    ['com.microtechmd.cgms.mgdl', 'mgDl'],
    [DIAEXPERT_MMOLL_PACKAGE, 'mmolL'],
  ] as const)(
    'enforces the package-defined unit for %s',
    (packageName, expectedUnit) => {
      expect(fixedNotificationUnit(packageName)).toBe(expectedUnit);
      expect(
        normalizeKnownNotificationRule({
          packageName,
          displayName: 'Test app',
          captureGlucose: true,
          captureInsulin: false,
          glucoseUnit: expectedUnit === 'mmolL' ? 'mgDl' : 'mmolL',
        }).glucoseUnit,
      ).toBe(expectedUnit);
    },
  );

  it('parses the DiaExpert mmol/L package as mmol/L, including an old saved rule', () => {
    const catalogRule = SUPPORTED_NOTIFICATION_APPS.find(
      (app) => app.packageName === DIAEXPERT_MMOLL_PACKAGE,
    );
    expect(catalogRule?.glucoseUnit).toBe('mmolL');

    const correctedRule = normalizeKnownNotificationRule({
      packageName: DIAEXPERT_MMOLL_PACKAGE,
      displayName: 'DiaExpert',
      captureGlucose: true,
      captureInsulin: false,
      glucoseUnit: 'mgDl',
    });
    const parsed = parseCapturedNotification(
      {
        id: 'diaexpert-1',
        packageName: DIAEXPERT_MMOLL_PACKAGE,
        postedAt: Date.UTC(2026, 7, 19, 0, 30),
        receivedAt: Date.UTC(2026, 7, 19, 0, 30, 1),
        isOngoing: true,
        textLines: ['6.2'],
      },
      correctedRule,
    );
    expect(correctedRule.glucoseUnit).toBe('mmolL');
    expect(parsed.glucose?.mmolL).toBe(6.2);
  });
});
