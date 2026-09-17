import type { EvidenceReference } from '@/domain/insights';

/**
 * Resolves evidence-chart routing before the inspector considers the legacy
 * generic overlay. Omission metadata is authoritative even if corrupted or
 * transitional state also contains a visualization payload.
 */
export function resolveEvidenceInspectorVisualization(
  evidence?: EvidenceReference,
) {
  const visualizationOmission = evidence?.visualizationOmission;
  const visualization = visualizationOmission
    ? undefined
    : evidence?.visualization;
  return {
    exactQueryWithoutVisualization: Boolean(
      visualizationOmission ||
        (evidence?.calculation?.kind === 'tarvis-local-glucose-v1' &&
          !visualization),
    ),
    visualization,
    visualizationOmission,
  };
}
