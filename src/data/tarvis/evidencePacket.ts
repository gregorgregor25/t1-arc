import {
  classifyInsightQuestion,
  EvidenceReference,
  InsightReport,
} from '@/domain/insights';

import {
  TarvisEvidenceLookup,
  TarvisEvidencePacket,
} from './types';

const MAX_FINDINGS = 18;
const MAX_EXAMPLES_PER_EVIDENCE = 5;

export function buildTarvisEvidencePacket(
  report: InsightReport,
): TarvisEvidenceLookup {
  const references = new Map<string, EvidenceReference>();
  const findings = report.findings.slice(0, MAX_FINDINGS).map((finding) => {
    const evidenceIds: string[] = [];
    finding.evidence.forEach((reference) => {
      references.set(reference.id, reference);
      evidenceIds.push(reference.id);
    });
    return {
      id: finding.id,
      kind: finding.kind,
      category: finding.category,
      title: finding.title,
      summary: finding.summary,
      caveat: finding.caveat,
      evidenceIds,
    };
  });

  const packet: TarvisEvidencePacket = {
    schemaVersion: 1,
    timezone: 'Europe/London',
    units: {
      glucose: 'mmol/L',
      weight: 'kg',
      distance: 'km',
    },
    generatedAt: report.generatedAt,
    comparison: {
      currentRange: report.currentRange,
      previousRange: report.previousRange,
      headline: report.headline,
      summary: report.summary,
      current: report.current,
      previous: report.previous,
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

export function evidenceIds(packet: TarvisEvidencePacket) {
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
      categories.has(finding.category) ||
      finding.category === 'data-quality',
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
