import type { EvidenceReference } from '@/domain/insights';
import {
  compactEvidenceQueryVisualization,
  MAX_EVIDENCE_QUERY_CHART_POINTS,
} from '@/domain/evidenceQueryChart';

function omission(
  reference: EvidenceReference,
  originalKind: NonNullable<EvidenceReference['visualization']>['kind'],
  sourcePointCount: number,
  maximumDisplayPoints: number,
): EvidenceReference {
  return {
    ...reference,
    description: `${reference.description} The chart was omitted because ${sourcePointCount} display vertices exceeded the safe on-phone limit of ${maximumDisplayPoints}; every exact record ID remains available in All records.`,
    visualization: undefined,
    visualizationOmission: {
      reason: 'display-point-budget',
      originalKind,
      sourcePointCount,
      maximumDisplayPoints,
    },
  };
}

/**
 * Applies before the evidence enters React state and again at the storage
 * boundary. This keeps both first render and replay bounded and idempotent.
 */
export function compactTarvisEvidenceReference(
  reference: EvidenceReference,
  maximumDisplayPoints = MAX_EVIDENCE_QUERY_CHART_POINTS,
): EvidenceReference {
  if (!reference.visualization || reference.visualizationOmission) {
    return reference;
  }
  const maximum = Math.max(16, Math.floor(maximumDisplayPoints));
  if (reference.visualization.kind === 'recurring-clock-overlay-v1') {
    const sourcePointCount =
      reference.visualization.aggregatePoints.length +
      reference.visualization.windows.reduce(
        (sum, window) => sum + window.points.length,
        0,
      );
    return sourcePointCount > maximum
      ? omission(
          reference,
          reference.visualization.kind,
          sourcePointCount,
          maximum,
        )
      : reference;
  }
  const sourcePointCount = reference.visualization.windows.reduce(
    (sum, window) => sum + (window.sampling?.sourceSampleCount ?? window.points.length),
    0,
  );
  const compacted = compactEvidenceQueryVisualization(
    reference.visualization,
    maximum,
  );
  return compacted
    ? {
        ...reference,
        visualization: compacted,
        visualizationOmission: undefined,
      }
    : omission(
        reference,
        reference.visualization.kind,
        sourcePointCount,
        maximum,
      );
}

export function compactTarvisEvidence(
  references: readonly EvidenceReference[],
  maximumDisplayPoints = MAX_EVIDENCE_QUERY_CHART_POINTS,
) {
  return references.map((reference) =>
    compactTarvisEvidenceReference(reference, maximumDisplayPoints),
  );
}
