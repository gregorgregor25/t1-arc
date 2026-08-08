import { describe, expect, it } from 'vitest';

import { resolveEvidenceInspectorVisualization } from '@/components/evidenceInspectorVisualization';
import type { EvidenceReference } from '@/domain/insights';

function evidence(
  overrides: Partial<EvidenceReference> = {},
): EvidenceReference {
  return {
    description: 'Exact evidence',
    examples: [],
    id: 'evidence-1',
    label: 'Exact evidence',
    range: { end: 2, start: 1 },
    recordIds: [],
    ...overrides,
  };
}

describe('evidence inspector visualization routing', () => {
  it('treats a combined comparison omission without calculation metadata as an exact no-chart state', () => {
    const state = resolveEvidenceInspectorVisualization(
      evidence({
        visualizationOmission: {
          maximumDisplayPoints: 2_400,
          originalKind: 'period-comparison-v1',
          reason: 'display-point-budget',
          sourcePointCount: 4_800,
        },
      }),
    );

    expect(state.exactQueryWithoutVisualization).toBe(true);
    expect(state.visualization).toBeUndefined();
  });

  it('makes an event omission authoritative over a stray visualization payload', () => {
    const strayVisualization = {
      kind: 'event-timeline-v1',
    } as unknown as NonNullable<EvidenceReference['visualization']>;
    const state = resolveEvidenceInspectorVisualization(
      evidence({
        visualization: strayVisualization,
        visualizationOmission: {
          maximumDisplayPoints: 2_400,
          originalKind: 'event-timeline-v1',
          reason: 'display-point-budget',
          sourcePointCount: 2_401,
        },
      }),
    );

    expect(state.exactQueryWithoutVisualization).toBe(true);
    expect(state.visualization).toBeUndefined();
    expect(state.visualizationOmission?.originalKind).toBe(
      'event-timeline-v1',
    );
  });

  it('still allows legacy generic evidence only when no exact-query marker exists', () => {
    expect(
      resolveEvidenceInspectorVisualization(evidence()),
    ).toMatchObject({
      exactQueryWithoutVisualization: false,
      visualization: undefined,
      visualizationOmission: undefined,
    });
  });
});
