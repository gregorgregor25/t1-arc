import { describe, expect, it } from 'vitest';

import {
  glookoReportRawRecords,
  parseGlookoReportText,
} from '@/data/glooko/glookoReport';
import { buildGlookoReportFindings } from '@/data/glooko/glookoReportEvidence';

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

describe('Glooko report mapping', () => {
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
    const evidence = findings.flatMap((finding) => finding.evidence);
    expect(
      evidence.every((reference) =>
        reference.examples.every(
          (example) => example.kind === 'source-record',
        ),
      ),
    ).toBe(true);
  });
});
