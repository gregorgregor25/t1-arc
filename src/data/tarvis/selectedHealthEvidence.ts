import type { InsightCategory, InsightReport } from '@/domain/insights';
import { HEALTH_METRIC_LABELS, type TarvisHealthMetric } from '@/domain/tarvisEntry';
import { buildTarvisEvidencePacket } from './evidencePacket';

const HEALTH_CATEGORIES: Partial<Record<TarvisHealthMetric, InsightCategory>> = {
  sleep: 'sleep', nutrition: 'food', weight: 'weight', 'blood-pressure': 'vitals',
  'heart-rate': 'heart', steps: 'activity', hydration: 'hydration', distance: 'activity',
  energy: 'activity', workouts: 'activity', 'body-composition': 'body', 'health-glucose': 'vitals',
  oxygen: 'vitals', 'respiratory-rate': 'vitals', hrv: 'vitals', 'vo2-max': 'vitals',
  temperature: 'vitals', 'cycle-context': 'context',
};

/** Keep the explicitly selected Health subject ahead of generic report findings. */
export function buildSelectedHealthEvidencePacket(report: InsightReport, metric: TarvisHealthMetric) {
  const category = HEALTH_CATEGORIES[metric];
  const priority = (findingCategory: InsightCategory) => findingCategory === category ? 0
    : findingCategory === 'data-quality' ? 1 : findingCategory === 'glucose' ? 2 : 3;
  const lookup = buildTarvisEvidencePacket(category
    ? { ...report, findings: report.findings.slice().sort((a, b) => priority(a.category) - priority(b.category)) }
    : report);
  // Required findings are still locally evidence-validated by the existing
  // model selection and no-key fallback paths. No new relationship is invented
  // when the report only contains insufficient-coverage limitations.
  const requiredFindingIds = lookup.packet.findings.filter(finding => finding.category === category && finding.evidenceIds.length > 0)
    .slice(0, 2).map(finding => finding.id);
  const subject = HEALTH_METRIC_LABELS[metric];
  return { ...lookup, packet: { ...lookup.packet, requiredFindingIds, comparison: {
    ...lookup.packet.comparison,
    headline: `${subject[0]!.toUpperCase()}${subject.slice(1)} in the selected period`,
    // The selected evidence-backed finding should be the first answer text.
    // The broad report's rounded-day glucose prelude belongs to Insights, not
    // this subject-specific answer. Its findings and caveats remain available.
    summary: '',
  } } };
}
