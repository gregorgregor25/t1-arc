import { InsightReport } from './insights';

export const INSIGHT_REPORT_SCHEMA_VERSION = 2;

export function hasInsightReviewEvidence(report: InsightReport) {
  return (
    report.current.glucoseReadings + report.previous.glucoseReadings > 0
  );
}

export function insightEvidenceRecordCount(report: InsightReport) {
  return new Set(
    report.findings.flatMap((finding) =>
      finding.evidence.flatMap((evidence) => evidence.recordIds),
    ),
  ).size;
}

/**
 * Non-cryptographic change detector for a report already protected by
 * SQLCipher. Generated time is excluded so unchanged evidence does not create
 * a false new review.
 */
export function fingerprintInsightReport(report: InsightReport) {
  const stable = JSON.stringify({
    ...report,
    generatedAt: 0,
    inputGeneration: 0,
  });
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < stable.length; index += 1) {
    const code = stable.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `v${INSIGHT_REPORT_SCHEMA_VERSION}-${(first >>> 0)
    .toString(16)
    .padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function insightReportId(report: InsightReport) {
  return `rolling-week:${report.currentRange.end}`;
}
