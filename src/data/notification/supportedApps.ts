import type { NotificationCaptureRule } from '../../../modules/t1arc-notification-source';

export type NotificationAppOption = NotificationCaptureRule & {
  detail: string;
};

export const DIAEXPERT_MMOLL_PACKAGE = 'com.microtech.aidexx.diaexport.mmoll';

export const SUPPORTED_NOTIFICATION_APPS: NotificationAppOption[] = [
  {
    packageName: 'com.dexcom.g7',
    displayName: 'Dexcom G7',
    detail: 'Dexcom G7 glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.dexcom.cgm',
    displayName: 'Dexcom G6',
    detail: 'Dexcom G6 glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.dexcom.one.region1',
    displayName: 'Dexcom ONE+',
    detail: 'Dexcom ONE+ region 1 notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.dexcom.one.region2',
    displayName: 'Dexcom ONE+',
    detail: 'Dexcom ONE+ region 2 notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.camdiab.camapsfx',
    displayName: 'CamAPS FX',
    detail: 'mmol/L app notification',
    captureGlucose: true,
    captureInsulin: true,
    glucoseUnit: 'mmolL',
  },
  {
    packageName: 'com.camdiab.camapsfx.mgdl',
    displayName: 'CamAPS FX',
    detail: 'mg/dL app notification',
    captureGlucose: true,
    captureInsulin: true,
    glucoseUnit: 'mgDl',
  },
  {
    packageName: 'com.insulet.myblue.pdm',
    displayName: 'Omnipod 5',
    detail: 'Glucose and available IOB context',
    captureGlucose: true,
    captureInsulin: true,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.medtronic.diabetes.minimedmobile.eu',
    displayName: 'MiniMed Mobile',
    detail: 'European app notification',
    captureGlucose: true,
    captureInsulin: true,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.medtronic.diabetes.minimedmobile.usa',
    displayName: 'MiniMed Mobile',
    detail: 'US app notification',
    captureGlucose: true,
    captureInsulin: true,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.senseonics.gen2.plus',
    displayName: 'Eversense',
    detail: 'Eversense E3 notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'esel.esel',
    displayName: 'ESEL',
    detail: 'Eversense local notification bridge',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.gluroo.gluroo',
    displayName: 'Gluroo',
    detail: 'Glucose and available IOB context',
    captureGlucose: true,
    captureInsulin: true,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.medtrum.easycare',
    displayName: 'Medtrum EasySense',
    detail: 'Local Medtrum app notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.microtech.aidexx.cgm',
    displayName: 'AiDEX',
    detail: 'AiDEX glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.microtechmd.cgms',
    displayName: 'AiDEX',
    detail: 'AiDEX glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.microtechmd.cgms.mmol',
    displayName: 'AiDEX',
    detail: 'mmol/L glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'mmolL',
  },
  {
    packageName: 'com.microtechmd.cgms.mgdl',
    displayName: 'AiDEX',
    detail: 'mg/dL glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'mgDl',
  },
  {
    packageName: DIAEXPERT_MMOLL_PACKAGE,
    displayName: 'DiaExpert',
    detail: 'mmol/L glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'mmolL',
  },
  {
    packageName: 'com.isens.csair',
    displayName: 'CareSens Air',
    detail: 'CareSens Air glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.sinocare.ican.health',
    displayName: 'iCan CGM',
    detail: 'iCan glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.signos.signos',
    displayName: 'Signos',
    detail: 'Signos glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
  {
    packageName: 'com.signos.core',
    displayName: 'Signos',
    detail: 'Signos glucose notification',
    captureGlucose: true,
    captureInsulin: false,
    glucoseUnit: 'auto',
  },
];

export function insulinCapableSupportedNotificationApp(packageName: string) {
  return SUPPORTED_NOTIFICATION_APPS.find(
    (app) => app.packageName === packageName && app.captureInsulin,
  );
}

/**
 * Retrospective IOB is deliberately narrower than captureInsulin. A package is
 * admitted only after reviewed synthetic parser-contract cases cover zero,
 * sign handling and ambiguous duplicate values. Those cases do not establish
 * the real notification layout; redacted native-bridge capture and real-device
 * acceptance remain separate release checks.
 */
export const TIMESTAMPED_IOB_EVIDENCE_PACKAGES = [
  'com.insulet.myblue.pdm',
] as const;

export function timestampedIobEvidenceApp(packageName: string) {
  if (
    !(TIMESTAMPED_IOB_EVIDENCE_PACKAGES as readonly string[]).includes(
      packageName,
    )
  ) {
    return undefined;
  }
  return insulinCapableSupportedNotificationApp(packageName);
}

/** Enforces package-level unit guarantees even for an older saved rule. */
export function fixedNotificationUnit(packageName: string) {
  const configured = SUPPORTED_NOTIFICATION_APPS.find(
    (app) => app.packageName === packageName,
  )?.glucoseUnit;
  return configured && configured !== 'auto' ? configured : undefined;
}

export function normalizeKnownNotificationRule(
  rule: NotificationCaptureRule,
): NotificationCaptureRule {
  const fixedUnit = fixedNotificationUnit(rule.packageName);
  const evidenceApp = timestampedIobEvidenceApp(rule.packageName);
  if (!fixedUnit && !evidenceApp) return rule;
  return {
    ...rule,
    captureInsulin: evidenceApp ? true : rule.captureInsulin,
    glucoseUnit: fixedUnit ?? rule.glucoseUnit,
  };
}
