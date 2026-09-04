import {
  classifyInsightQuestion,
  EvidenceReference,
  InsightReport,
} from "@/domain/insights";
import { getRuntimeAnalysisTimeZone } from "@/domain/regionalProfileRuntime";
import { formatTarvisNumber } from "./regionalNumberPresentation";

import {
  TarvisEvidenceLookup,
  TarvisEvidencePacket,
  TarvisInsightWindowSummary,
  TarvisModelEvidencePacket,
} from "./types";

const MAX_FINDINGS = 18;
const MAX_EXAMPLES_PER_EVIDENCE = 5;
const MIN_GLUCOSE_COVERAGE_PERCENT = 70;

export function toTarvisInsightWindowSummary(
  summary: InsightReport["current"],
): TarvisInsightWindowSummary {
  if (summary.glucoseReadings > 0) return { ...summary };
  return {
    ...summary,
    glucoseAverage: null,
    glucoseStandardDeviation: null,
    glucoseCvPercent: null,
    timeBelowPercent: null,
    timeInRangePercent: null,
    timeAbovePercent: null,
    highGlucoseRuns: null,
    lowGlucoseRuns: null,
  };
}

function glucoseCoverageContext(report: InsightReport) {
  const windows = [
    { label: "Recent period", summary: report.current },
    { label: "Previous period", summary: report.previous },
  ];
  const details = windows.flatMap(({ label, summary }) => {
    if (summary.glucoseReadings === 0) {
      return [
        `${label} has no glucose readings, so its glucose metrics are unavailable`,
      ];
    }
    if (summary.coveragePercent < MIN_GLUCOSE_COVERAGE_PERCENT) {
      return [
        `${label} has ${formatTarvisNumber(summary.coveragePercent, { maximumFractionDigits: 2 })}% sensor coverage, so its glucose values describe observed sensor time only and are not complete-period estimates`,
      ];
    }
    return [];
  });
  return details.length ? `${details.join(". ")}.` : undefined;
}

export function buildTarvisEvidencePacket(
  report: InsightReport,
  options: { includeGlucoseCoverageContext?: boolean } = {},
): TarvisEvidenceLookup {
  const references = new Map<string, EvidenceReference>();
  const coverageContext =
    options.includeGlucoseCoverageContext === false
      ? undefined
      : glucoseCoverageContext(report);
  const hasEmptyGlucoseWindow =
    report.current.glucoseReadings === 0 ||
    report.previous.glucoseReadings === 0;
  const eligibleFindings = report.findings.filter(
    (finding) =>
      !hasEmptyGlucoseWindow ||
      finding.category !== "glucose" ||
      finding.id === "glucose-overview",
  );
  // A manually recorded ketone value must not disappear merely because an
  // unusually rich report reached the model-packet cap. Keep this typed,
  // safety-relevant finding ahead of the otherwise stable report order.
  const sourceFindings = [
    ...eligibleFindings.filter(({ id }) => id === "recorded-ketone-readings"),
    ...eligibleFindings.filter(({ id }) => id !== "recorded-ketone-readings"),
  ].slice(0, MAX_FINDINGS);
  const findings = sourceFindings.map((finding) => {
    const evidenceIds: string[] = [];
    finding.evidence.forEach((reference) => {
      references.set(reference.id, reference);
      evidenceIds.push(reference.id);
    });
    return {
      id: finding.id,
      kind: finding.kind,
      category: finding.category,
      title:
        hasEmptyGlucoseWindow && finding.category === "glucose"
          ? "Glucose comparison has missing data"
          : finding.title,
      summary:
        finding.category === "glucose" && coverageContext
          ? hasEmptyGlucoseWindow
            ? coverageContext
            : `${coverageContext} ${finding.summary}`
          : finding.summary,
      caveat: finding.caveat,
      evidenceIds,
    };
  });

  const packet: TarvisEvidencePacket = {
    schemaVersion: 1,
    timezone: getRuntimeAnalysisTimeZone(),
    units: {
      glucose: "mmol/L",
      weight: "kg",
      distance: "km",
    },
    generatedAt: report.generatedAt,
    comparison: {
      currentRange: report.currentRange,
      previousRange: report.previousRange,
      headline: report.headline,
      summary:
        coverageContext && hasEmptyGlucoseWindow
          ? coverageContext
          : coverageContext
            ? `${coverageContext} ${report.summary}`
            : report.summary,
      current: toTarvisInsightWindowSummary(report.current),
      previous: toTarvisInsightWindowSummary(report.previous),
    },
    findings,
    evidence: [...references.values()].map((reference) => ({
      id: reference.id,
      label: reference.label,
      description: reference.description,
      range: reference.range,
      recordCount: reference.recordIds.length,
      examples: reference.examples
        .slice(0, MAX_EXAMPLES_PER_EVIDENCE)
        .map((example) => ({ ...example })),
    })),
  };
  return { packet, references };
}

export function evidenceIds(packet: TarvisModelEvidencePacket) {
  return new Set(packet.evidence.map((evidence) => evidence.id));
}

export function selectTarvisEvidencePacket(
  question: string,
  packet: TarvisEvidencePacket,
): TarvisEvidencePacket {
  const categories = new Set(classifyInsightQuestion(question));
  const broadQuestion = categories.size > 5;
  const relevantFindings = packet.findings.filter(
    (finding) =>
      categories.has(finding.category) || finding.category === "data-quality",
  );
  const findings = (
    relevantFindings.length ? relevantFindings : packet.findings
  ).slice(0, broadQuestion ? MAX_FINDINGS : 10);
  const selectedEvidenceIds = new Set(
    findings.flatMap((finding) => finding.evidenceIds),
  );
  const evidence = packet.evidence
    .filter((item) => selectedEvidenceIds.has(item.id))
    .map((item) => ({
      ...item,
      examples: item.examples.slice(0, broadQuestion ? 0 : 1),
    }));

  return {
    ...packet,
    findings,
    evidence,
  };
}
