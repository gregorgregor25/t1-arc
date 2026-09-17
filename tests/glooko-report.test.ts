import { afterEach, describe, expect, it } from 'vitest';

import {
  glookoReportRawRecords,
  parseGlookoReportText,
} from '@/data/glooko/glookoReport';
import { buildGlookoReportFindings } from '@/data/glooko/glookoReportEvidence';
import { MG_DL_PER_MMOL_L } from '@/domain/models';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

const REPORT_TEXT = `Example
Diabetes: Type 1  Wed, 22 Jul 2026 - Tue, 28 Jul 2026 (7 days)
Automated Mode               92% (6d 10h)
Automated: Limited            2% (3h)
Automated: Activity          18% (1d 6h)
Manual Mode                   6% (10h)
\f
Devices
General                                                                       Glucose alerts
Active CGM                                                Example CGM        Glucose High Alert Enabled                                          ON
Active Insulin Time                                                    4h     Glucose High Alert Limit                                    13.9 mmol/L
                                                                              Glucose Low Alert Enabled                                          OFF
                                                                              Glucose Low Alert Limit                                      3.9 mmol/L
                                                                              Signal Loss Alert                                                   ON
Basal                                                                         Bolus
Active basal program                                               Manual     Extended Bolus                                                     OFF
Max Basal Rate                                                2.5 Units/hr    Max Bolus                                                          20 U
Temporary Basal Enabled                                                ON     Min BG for Bolus Calc                                        3.3 mmol/L
                                                                              Reverse Correction                                                  ON
Basal                                                                         Sensitivity (ISF, correction)
Manual Active                                                                 Profile Active
00:00 (24 hr)                                                  0.7 Units/hr   00:00 (7 hr)                                                 5.3 mmol/L
                                                                              07:00 (17 hr)                                                2.8 mmol/L
Total                                                            16.8 Units
Insulin: Carb Ratios                                                          BG target range
Profile Active                                                                Profile Active
00:00 (12 hr)                                                    5 g/Unit     00:00 (24 hr)                                         6.1 (+0/-0) mmol/L
12:00 (12 hr)                                                   10 g/Unit
BG correction threshold
Profile Active
00:00 (24 hr)                                                   6.1 mmol/L
Confidential`;

const DAILY_MODE_PAGE = `\f
Example Daily Overview
Diabetes: Type 1  Wed, 22 Jul 2026 - Tue, 28 Jul 2026 (7 days)
System Details
                              22/JUL   22/JUL - 28/JUL
Automated Mode                  99%      100%
Automated: Activity              0%       15%
Automated: Limited               1%        0%
Manual                           1%        0%
Confidential`;

const MONTH_FIRST_REPORT_TEXT = `Example
Diabetes: Type 1  Tue, Aug 11, 2026 - Mon, Aug 17, 2026 (7 days)
Automated Mode               100%
Automated: Limited             7%
Automated: Activity            6%
Manual Mode                    0%
\f
Example Daily Overview
System Details
                              AUG 11   AUG 11 - AUG 17
Automated Mode                  99%      100%
Automated: Activity              4%        6%
Automated: Limited               1%        7%
Manual                           1%        0%
Confidential`;

describe('Glooko report mapping', () => {
  it('normalises US pump-report glucose settings from mg/dL to canonical mmol/L', () => {
    const usReport = REPORT_TEXT
      .replace('13.9 mmol/L', '250 mg/dL')
      .replace('3.9 mmol/L', '70 mg/dL')
      .replace('3.3 mmol/L', '60 mg/dL')
      .replace('5.3 mmol/L', '95 mg/dL')
      .replace('2.8 mmol/L', '50 mg/dL')
      .replace(/6\.1 \(\+0\/-0\) mmol\/L/g, '110 (+0/-0) mg/dL')
      .replace('6.1 mmol/L', '110 mg/dL');
    const settings = parseGlookoReportText(usReport).settings;
    expect(settings?.glucoseHighAlertLimitMmolL).toBeCloseTo(
      250 / MG_DL_PER_MMOL_L,
      4,
    );
    expect(settings?.glucoseLowAlertLimitMmolL).toBeCloseTo(
      70 / MG_DL_PER_MMOL_L,
      4,
    );
    expect(settings?.minimumBgForBolusCalculationMmolL).toBeCloseTo(
      60 / MG_DL_PER_MMOL_L,
      4,
    );
    expect(settings?.sensitivitySchedule[0]?.value).toBeCloseTo(
      95 / MG_DL_PER_MMOL_L,
      4,
    );
    expect(settings?.targetSchedule[0]?.value).toBeCloseTo(
      110 / MG_DL_PER_MMOL_L,
      4,
    );
  });

  it('does not treat an unparseable settings-page shell as a settings snapshot', () => {
    const preview = parseGlookoReportText(`Daily Overview
Active basal program
Insulin: Carb Ratios
Confidential`);

    expect(preview.settings).toBeUndefined();
    expect(preview.warnings).toContain(
      'No Omnipod device-settings page was found in this report.',
    );
  });

  it('maps Omnipod mode percentages and device settings without inferring delivery', () => {
    const preview = parseGlookoReportText(REPORT_TEXT);

    expect(preview.modeSummary).toEqual({
      automatedPercent: 92,
      activityPercent: 18,
      limitedPercent: 2,
      manualPercent: 6,
    });
    expect(preview.settings).toMatchObject({
      activeCgm: 'Example CGM',
      activeInsulinHours: 4,
      activeBasalProgram: 'Manual',
      maxBasalRateUnitsPerHour: 2.5,
      temporaryBasalEnabled: true,
      extendedBolusEnabled: false,
      maxBolusUnits: 20,
      minimumBgForBolusCalculationMmolL: 3.3,
      reverseCorrectionEnabled: true,
      glucoseHighAlertEnabled: true,
      glucoseHighAlertLimitMmolL: 13.9,
      glucoseLowAlertEnabled: false,
      glucoseLowAlertLimitMmolL: 3.9,
      signalLossAlertEnabled: true,
    });
    expect(preview.settings?.basalSchedule).toEqual([
      {
        startTime: '00:00',
        durationMinutes: 1_440,
        value: 0.7,
        unit: 'U/h',
      },
    ]);
    expect(preview.settings?.carbRatioSchedule).toHaveLength(2);
    expect(preview.settings?.sensitivitySchedule).toHaveLength(2);
    expect(preview.settings?.targetSchedule).toHaveLength(1);
    expect(preview.settings?.correctionThresholdSchedule).toHaveLength(1);
    expect(preview.warnings).toEqual([]);
  });

  it('creates small, deduplicatable evidence records rather than storing claims', () => {
    const preview = parseGlookoReportText(REPORT_TEXT);
    const records = glookoReportRawRecords(
      preview,
      'glooko-report.pdf',
      Date.parse('2026-07-28T18:00:00+01:00'),
    );

    expect(records.map((record) => record.recordKind)).toEqual([
      'pump-mode-summary',
      'pump-settings',
    ]);
    expect(records.every((record) => record.sourceId === 'glooko-export')).toBe(
      true,
    );
    expect(JSON.parse(records[0]!.payloadJson)).toMatchObject({
      reportStart: preview.reportStart,
      reportEnd: preview.reportEnd,
      automatedPercent: 92,
    });
  });

  it('indexes overlapping Daily Overview mode summaries by day', () => {
    const preview = parseGlookoReportText(
      `${REPORT_TEXT}${DAILY_MODE_PAGE}`,
    );
    expect(preview.dailyModeSummaries).toEqual([
      {
        dateKey: '2026-07-22',
        timestamp: expect.any(Number),
        summary: {
          automatedPercent: 99,
          activityPercent: 0,
          limitedPercent: 1,
          manualPercent: 1,
        },
      },
    ]);
    const records = glookoReportRawRecords(
      preview,
      'glooko-report.pdf',
      Date.parse('2026-07-28T18:00:00+01:00'),
    );
    expect(records.map((record) => record.recordKind)).toContain(
      'pump-mode-daily',
    );
    expect(
      JSON.parse(
        records.find(
          (record) => record.recordKind === 'pump-mode-daily',
        )!.payloadJson,
      ),
    ).toMatchObject({
      dateKey: '2026-07-22',
      automatedPercent: 99,
    });
    const overlapping = glookoReportRawRecords(
      {
        ...preview,
        reportStart: (preview.reportStart ?? 0) + 86_400_000,
        reportEnd: (preview.reportEnd ?? 0) + 86_400_000,
      },
      'next-rolling-report.pdf',
      Date.parse('2026-07-29T18:00:00+01:00'),
    );
    expect(
      overlapping.find(
        (record) => record.recordKind === 'pump-mode-daily',
      )?.id,
    ).toBe(
      records.find(
        (record) => record.recordKind === 'pump-mode-daily',
      )?.id,
    );
  });

  it('maps PDF pump tracks into exact local activity and pause intervals', () => {
    const preview = parseGlookoReportText(REPORT_TEXT, [
      {
        dateLabel: '27/Jul',
        startMinute: 10 * 60 + 15,
        endMinute: 12 * 60 + 5,
        kind: 'activity-mode',
        pageNumber: 13,
      },
      {
        dateLabel: '27/Jul',
        startMinute: 13 * 60 + 10,
        endMinute: 13 * 60 + 35,
        kind: 'automated-pause',
        pageNumber: 13,
      },
    ]);

    expect(preview.pumpStateIntervals).toHaveLength(2);
    expect(preview.pumpStateIntervals[0]).toMatchObject({
      kind: 'activity-mode',
      start: Date.parse('2026-07-27T10:15:00+01:00'),
      end: Date.parse('2026-07-27T12:05:00+01:00'),
      sourcePage: 13,
    });
    const records = glookoReportRawRecords(
      preview,
      'glooko-report.pdf',
      Date.parse('2026-07-28T18:00:00+01:00'),
    );
    const states = records.filter(
      (record) => record.recordKind === 'pump-state-interval',
    );
    expect(states).toHaveLength(2);
    expect(JSON.parse(states[1]!.payloadJson)).toMatchObject({
      kind: 'automated-pause',
      start: Date.parse('2026-07-27T13:10:00+01:00'),
      end: Date.parse('2026-07-27T13:35:00+01:00'),
    });
  });

  it('maps month-first Glooko report and Daily Overview dates', () => {
    const preview = parseGlookoReportText(MONTH_FIRST_REPORT_TEXT);

    expect(preview.reportStart).toBe(
      Date.parse('2026-08-11T00:00:00+01:00'),
    );
    expect(preview.reportEnd).toBe(
      Date.parse('2026-08-18T00:00:00+01:00'),
    );
    expect(preview.dailyModeSummaries).toEqual([
      {
        dateKey: '2026-08-11',
        timestamp: expect.any(Number),
        summary: {
          automatedPercent: 99,
          activityPercent: 4,
          limitedPercent: 1,
          manualPercent: 1,
        },
      },
    ]);
  });

  it('does not index an Activity track that materially disagrees with the report summary', () => {
    const preview = parseGlookoReportText(
      `${REPORT_TEXT}${DAILY_MODE_PAGE}`,
      [
        {
          dateLabel: '27/Jul',
          startMinute: 10 * 60,
          endMinute: 10 * 60 + 15,
          kind: 'activity-mode',
          pageNumber: 13,
        },
        {
          dateLabel: '27/Jul',
          startMinute: 13 * 60 + 10,
          endMinute: 13 * 60 + 35,
          kind: 'automated-pause',
          pageNumber: 13,
        },
      ],
    );

    expect(preview.pumpStateIntervals).toHaveLength(1);
    expect(preview.pumpStateIntervals[0]?.kind).toBe('automated-pause');
    expect(preview.warnings).toContain(
      'The timed Activity track did not agree with the report summary, so its exact Activity windows were not indexed.',
    );
  });

  it('makes pump modes and settings available to evidence-grounded analysis', () => {
    const preview = parseGlookoReportText(REPORT_TEXT);
    const records = glookoReportRawRecords(
      preview,
      'glooko-report.pdf',
      Date.parse('2026-07-28T18:00:00+01:00'),
    );
    const findings = buildGlookoReportFindings(records, {
      start: Date.parse('2026-07-21T00:00:00+01:00'),
      end: Date.parse('2026-07-28T00:00:00+01:00'),
    });

    expect(findings.map((finding) => finding.id)).toEqual([
      'glooko-pump-modes',
      'glooko-pump-settings',
    ]);
    expect(findings[0]?.summary).toContain('Activity 18%');
    expect(findings[1]?.evidence[0]?.examples[0]?.secondary).toContain(
      'carb ratio:',
    );
    expect(findings[1]?.evidence[0]?.examples[0]?.secondary).toContain(
      'target: 00:00 6.1 mmol/L',
    );
    const evidence = findings.flatMap((finding) => finding.evidence);
    expect(
      evidence.every((reference) =>
        reference.examples.every(
          (example) => example.kind === 'source-record',
        ),
      ),
    ).toBe(true);
  });

  it('uses regional digits in pump-report evidence copy', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'ar-EG',
    });
    const preview = parseGlookoReportText(REPORT_TEXT);
    const records = glookoReportRawRecords(
      preview,
      'glooko-report.pdf',
      Date.parse('2026-07-28T18:00:00+01:00'),
    );
    const findings = buildGlookoReportFindings(records, {
      start: Date.parse('2026-07-21T00:00:00+01:00'),
      end: Date.parse('2026-07-28T00:00:00+01:00'),
    });

    expect(findings[0]?.summary).toContain('Activity ١٨%');
    expect(findings[1]?.evidence[0]?.examples[0]?.secondary).toContain(
      '٠٫٧ U/h',
    );
  });

  it('converts canonical glucose schedules for US evidence copy', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'us',
      countryCode: 'US',
      languageTag: 'en-US',
      glucoseUnit: 'mgDl',
    });
    const preview = parseGlookoReportText(REPORT_TEXT);
    const records = glookoReportRawRecords(
      preview,
      'glooko-report.pdf',
      Date.parse('2026-07-28T18:00:00+01:00'),
    );
    const findings = buildGlookoReportFindings(records, {
      start: Date.parse('2026-07-21T00:00:00+01:00'),
      end: Date.parse('2026-07-28T00:00:00+01:00'),
    });
    const settings = findings[1]?.evidence[0]?.examples[0]?.secondary;

    expect(settings).toContain('target: 12:00 AM 110 mg/dL');
    expect(settings).toContain(
      'sensitivity: 12:00 AM 95 mg/dL, 07:00 AM 50 mg/dL',
    );
    expect(settings).toContain('basal: 12:00 AM 0.7 U/h');
  });
});
