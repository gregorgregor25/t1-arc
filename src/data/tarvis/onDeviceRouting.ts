import {
  isReadyTarvisIntent,
  TarvisIntentResolution,
} from './intent';
import { TarvisAnswer } from './types';

const LOCALLY_EXECUTABLE_GLUCOSE_METRICS = new Set([
  'glucose.mean',
  'glucose.time_in_range',
  'glucose.low_episodes',
  'glucose.high_episodes',
]);

export type TarvisOnDeviceRoute =
  | { kind: 'scoped-glucose' }
  | { kind: 'capability'; answer: TarvisAnswer }
  | { kind: 'legacy' };

function answer(
  headline: string,
  copy: string,
  limitation: string,
): TarvisAnswer {
  return {
    headline,
    answer: copy,
    confidence: 'limited',
    evidenceIds: [],
    limitations: [limitation],
  };
}

function isRecognisedGlucoseRequest(resolution: TarvisIntentResolution) {
  return (
    resolution.intent.domain?.value === 'glucose' &&
    (resolution.intent.metrics.length > 0 ||
      resolution.literals.clockWindows.length > 0)
  );
}

function locallyExecutableReadyShape(
  resolution: Extract<TarvisIntentResolution, { outcome: { status: 'ready' } }>,
) {
  const { intent } = resolution;
  if (
    !intent.metrics.every(({ value }) =>
      LOCALLY_EXECUTABLE_GLUCOSE_METRICS.has(value),
    )
  ) {
    return false;
  }
  if (intent.clockWindow === null) return true;
  return (
    intent.comparison === null &&
    intent.temporalScope.value.kind === 'recent_local_days' &&
    intent.temporalScope.value.include === 'most_recent_completed_windows'
  );
}

/**
 * Keeps high-priority glucose calculations fail-closed. A request with an
 * explicit metric or clock window is never handed to a model to reinterpret
 * after the deterministic resolver found ambiguity or missing capability.
 */
export function routeTarvisIntent(
  resolution: TarvisIntentResolution,
): TarvisOnDeviceRoute {
  if (isReadyTarvisIntent(resolution)) {
    if (resolution.intent.domain.value !== 'glucose') return { kind: 'legacy' };
    if (locallyExecutableReadyShape(resolution)) {
      return { kind: 'scoped-glucose' };
    }
    return {
      kind: 'capability',
      answer: answer(
        'I can’t calculate that safely yet',
        'I recognised the requested glucose metric, but the exact local calculation is not available yet. I won’t substitute a different metric or time period.',
        'No calculation or OpenAI request was made for this unsupported calculation shape.',
      ),
    };
  }

  if (!isRecognisedGlucoseRequest(resolution)) return { kind: 'legacy' };

  if (resolution.outcome.status === 'needs_clarification') {
    return {
      kind: 'capability',
      answer: answer(
        'One detail before I calculate that',
        `${resolution.outcome.message} ${resolution.outcome.clarification}`.trim(),
        'No calculation or OpenAI request was made because the requested meaning was not unambiguous.',
      ),
    };
  }

  return {
    kind: 'capability',
    answer: answer(
      'I can’t calculate that safely yet',
      `${resolution.outcome.message} I won’t substitute a different metric or time window.`,
      'No calculation or OpenAI request was made for this unsupported request.',
    ),
  };
}
