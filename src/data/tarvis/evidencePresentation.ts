import {
  TarvisAnswer,
  TarvisConversationTurn,
  TarvisEvidencePacket,
  TarvisInsightWindowSummary,
} from './types';

export type TarvisEvidenceMetricId =
  | 'average-glucose'
  | 'low-events'
  | 'high-events'
  | 'time-below-range'
  | 'time-in-range'
  | 'time-above-range';

export interface TarvisEvidenceMetric {
  id: TarvisEvidenceMetricId;
  label: string;
  value: number | null;
  decimals: 0 | 1;
  unit?: 'mmol/L' | '%';
}

export interface TarvisEvidenceWindowPresentation {
  label: string;
  range: { start: number; end: number };
  recordCount: number;
  coveragePercent: number;
  coverageStatus: 'sufficient' | 'limited' | 'unavailable';
  metrics: TarvisEvidenceMetric[];
}

export interface TarvisEvidencePresentation {
  kind:
    | 'average-glucose'
    | 'low-events'
    | 'high-events'
    | 'glucose-events'
    | 'time-in-range'
    | 'glucose-summary';
  title: string;
  detail: string;
  windows: TarvisEvidenceWindowPresentation[];
}

interface QuestionSignals {
  average: boolean;
  lowEvents: boolean;
  highEvents: boolean;
  timeInRange: boolean;
  comparison: boolean;
}

const MIN_SUMMARY_COVERAGE_PERCENT = 70;

function coverageStatus(summary: TarvisInsightWindowSummary) {
  if (summary.glucoseReadings === 0) return 'unavailable' as const;
  return summary.coveragePercent < MIN_SUMMARY_COVERAGE_PERCENT
    ? ('limited' as const)
    : ('sufficient' as const);
}

function questionSignals(question: string): QuestionSignals {
  const normalized = question.trim().toLocaleLowerCase('en-GB');
  const mentionsGlucose = /\b(glucose|blood sugar|sugar|cgm)\b/.test(normalized);
  return {
    average:
      mentionsGlucose &&
      /\b(average|mean|avg)\b/.test(normalized),
    lowEvents:
      /\b(lows|low(?:[- ]glucose)? events?|hypos?|hypoglyc(?:aemia|emia)(?: events?)?)\b/.test(
        normalized,
      ),
    highEvents:
      /\b(highs|high(?:[- ]glucose)? events?|hypers?|hyperglyc(?:aemia|emia)(?: events?)?)\b/.test(
        normalized,
      ),
    timeInRange: /\b(time in range|tir|timing range)\b/.test(normalized),
    comparison:
      /\b(compare|compared|comparison|versus|vs\.?|previous|prior|change|changed|different|difference)\b/.test(
        normalized,
      ),
  };
}

function hasMetricSignal(signals: QuestionSignals) {
  return (
    signals.average ||
    signals.lowEvents ||
    signals.highEvents ||
    signals.timeInRange
  );
}

const CONTEXTUAL_METRIC_FOLLOW_UP =
  /\b(?:what|how) about\b|\b(?:and|compare)(?: it| that| them)?\b|\b(?:previous|prior|earlier|recent|current) period\b/i;

function resolvedQuestionSignals(
  question: string,
  history: TarvisConversationTurn[] = [],
): QuestionSignals {
  const current = questionSignals(question);
  if (
    hasMetricSignal(current) ||
    !CONTEXTUAL_METRIC_FOLLOW_UP.test(question)
  ) {
    return current;
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn?.role !== 'user') continue;
    const previous = questionSignals(turn.text);
    if (!hasMetricSignal(previous)) continue;
    return {
      ...previous,
      comparison: current.comparison || previous.comparison,
    };
  }
  return current;
}

function metricsFor(
  summary: TarvisInsightWindowSummary,
  signals: QuestionSignals,
): TarvisEvidenceMetric[] {
  const metrics: TarvisEvidenceMetric[] = [];
  const status = coverageStatus(summary);
  const observedLabel = (label: string) =>
    status === 'limited' ? `Observed ${label.toLowerCase()}` : label;
  if (signals.average) {
    metrics.push({
      id: 'average-glucose',
      label: observedLabel('Average glucose'),
      value: status === 'unavailable' ? null : summary.glucoseAverage,
      decimals: 1,
      unit: 'mmol/L',
    });
  }
  if (signals.lowEvents) {
    metrics.push({
      id: 'low-events',
      label: observedLabel('Sustained lows'),
      value: status === 'unavailable' ? null : summary.lowGlucoseRuns,
      decimals: 0,
    });
  }
  if (signals.highEvents) {
    metrics.push({
      id: 'high-events',
      label: observedLabel('Sustained highs'),
      value: status === 'unavailable' ? null : summary.highGlucoseRuns,
      decimals: 0,
    });
  }
  if (signals.timeInRange) {
    metrics.push(
      {
        id: 'time-below-range',
        label: observedLabel('Below range'),
        value: status === 'unavailable' ? null : summary.timeBelowPercent,
        decimals: 1,
        unit: '%',
      },
      {
        id: 'time-in-range',
        label: observedLabel('In range'),
        value: status === 'unavailable' ? null : summary.timeInRangePercent,
        decimals: 1,
        unit: '%',
      },
      {
        id: 'time-above-range',
        label: observedLabel('Above range'),
        value: status === 'unavailable' ? null : summary.timeAbovePercent,
        decimals: 1,
        unit: '%',
      },
    );
  }
  return metrics;
}

function presentationKind(signals: QuestionSignals) {
  const selected = [
    signals.average,
    signals.lowEvents,
    signals.highEvents,
    signals.timeInRange,
  ].filter(Boolean).length;
  if (selected > 1) return 'glucose-summary' as const;
  if (signals.average) return 'average-glucose' as const;
  if (signals.lowEvents) return 'low-events' as const;
  if (signals.highEvents) return 'high-events' as const;
  return 'time-in-range' as const;
}

function presentationTitle(signals: QuestionSignals) {
  const kind = presentationKind(signals);
  switch (kind) {
    case 'average-glucose':
      return 'Average glucose for this period';
    case 'low-events':
      return 'Low-glucose events in this period';
    case 'high-events':
      return 'High-glucose events in this period';
    case 'time-in-range':
      return 'Time in range for this period';
    default:
      return 'Glucose summary for this period';
  }
}

function presentationDetail(
  signals: QuestionSignals,
) {
  const details: string[] = [];
  if (signals.average) {
    details.push('The average is weighted across observed sensor time');
  }
  if (signals.lowEvents || signals.highEvents) {
    const thresholds = [
      signals.lowEvents ? 'below 3.9 mmol/L' : '',
      signals.highEvents ? 'above 10.0 mmol/L' : '',
    ]
      .filter(Boolean)
      .join(' or ');
    details.push(
      `A sustained event is ${thresholds}, with at least two readings spanning four minutes and no gap over 12 minutes`,
    );
  }
  if (signals.timeInRange) {
    details.push(
      'Range percentages use observed sensor time between 3.9 and 10.0 mmol/L',
    );
  }
  return `${details.join('. ')}.`;
}

function windowsFor(
  packet: TarvisEvidencePacket,
  signals: QuestionSignals,
): TarvisEvidenceWindowPresentation[] {
  const windowFor = (
    label: string,
    range: { start: number; end: number },
    summary: TarvisInsightWindowSummary,
  ): TarvisEvidenceWindowPresentation => ({
    label,
    range,
    recordCount: summary.glucoseReadings,
    coveragePercent: summary.coveragePercent,
    coverageStatus: coverageStatus(summary),
    metrics: metricsFor(summary, signals),
  });
  const windows = [
    windowFor(
      signals.comparison ? 'Recent period' : 'Requested period',
      packet.comparison.currentRange,
      packet.comparison.current,
    ),
  ];
  if (signals.comparison) {
    windows.push(
      windowFor(
        'Previous period',
        packet.comparison.previousRange,
        packet.comparison.previous,
      ),
    );
  }
  return windows;
}

function metricAnswer(metric: TarvisEvidenceMetric) {
  if (metric.value === null) return undefined;
  const value = metric.value.toFixed(metric.decimals);
  switch (metric.id) {
    case 'average-glucose':
      return `average glucose was ${value} mmol/L`;
    case 'low-events':
      return `${value} sustained low-glucose event${metric.value === 1 ? ' was' : 's were'} observed`;
    case 'high-events':
      return `${value} sustained high-glucose event${metric.value === 1 ? ' was' : 's were'} observed`;
    case 'time-below-range':
      return `${value}% of observed sensor time was below range`;
    case 'time-in-range':
      return `${value}% was in range`;
    case 'time-above-range':
      return `${value}% was above range`;
  }
}

function guardedWindowAnswer(window: TarvisEvidenceWindowPresentation) {
  if (window.coverageStatus === 'unavailable') {
    return `${window.label} has no glucose readings, so the requested glucose result is unavailable.`;
  }
  const values = window.metrics.flatMap((metric) => {
    const copy = metricAnswer(metric);
    return copy ? [copy] : [];
  });
  if (window.coverageStatus === 'limited') {
    return `${window.label} has ${window.coveragePercent}% sensor coverage. In the available readings, ${values.join(', ')}. These are observed values, not complete-period estimates.`;
  }
  return `${window.label} has ${window.coveragePercent}% sensor coverage; ${values.join(', ')}.`;
}

function relevantCoverageEvidenceIds(
  packet: TarvisEvidencePacket,
  signals: QuestionSignals,
) {
  const ranges = [
    { preferredId: 'current-glucose', range: packet.comparison.currentRange },
    ...(signals.comparison
      ? [
          {
            preferredId: 'previous-glucose',
            range: packet.comparison.previousRange,
          },
        ]
      : []),
  ];
  return ranges.flatMap(({ preferredId, range }) => {
    const preferred = packet.evidence.find(
      (evidence) => evidence.id === preferredId,
    );
    if (preferred) return [preferred.id];
    const fallback = packet.evidence.find(
      (evidence) =>
        evidence.range.start === range.start &&
        evidence.range.end === range.end &&
        /glucose|sensor|cgm/i.test(
          `${evidence.id} ${evidence.label} ${evidence.description}`,
        ),
    );
    return fallback ? [fallback.id] : [];
  });
}

/**
 * Low-coverage metric answers use deterministic packet values so the model
 * cannot turn an observed partial-window value into a complete-period claim.
 */
export function applyTarvisCoverageGuardrail(
  question: string,
  packet: TarvisEvidencePacket,
  answer: TarvisAnswer,
  history: TarvisConversationTurn[] = [],
): TarvisAnswer {
  const signals = resolvedQuestionSignals(question, history);
  if (!hasMetricSignal(signals)) return answer;
  const windows = windowsFor(packet, signals);
  const limitedWindows = windows.filter(
    (window) => window.coverageStatus !== 'sufficient',
  );
  if (!limitedWindows.length) return answer;
  const unavailable = limitedWindows.some(
    (window) => window.coverageStatus === 'unavailable',
  );
  const limitation = unavailable
    ? 'No glucose readings were available for at least one requested period.'
    : `At least one requested period had less than ${MIN_SUMMARY_COVERAGE_PERCENT}% sensor coverage, so its values describe observed readings only.`;
  return {
    ...answer,
    headline: unavailable
      ? signals.comparison
        ? 'Glucose comparison incomplete'
        : 'Glucose result unavailable'
      : 'Observed glucose results',
    answer: windows.map(guardedWindowAnswer).join(' '),
    confidence: 'limited',
    evidenceIds: [
      ...new Set([
        ...relevantCoverageEvidenceIds(packet, signals),
        ...answer.evidenceIds,
      ]),
    ].slice(0, 5),
    limitations: [
      limitation,
      ...answer.limitations.filter((item) => item !== limitation),
    ].slice(0, 5),
  };
}

/**
 * Builds a small, deterministic summary for the response card. Values come
 * from the same on-device report sent to Tarv1s, never from model-written text
 * or sparse evidence previews.
 */
export function buildTarvisEvidencePresentation(
  question: string,
  packet: TarvisEvidencePacket,
  answer: TarvisAnswer,
  history: TarvisConversationTurn[] = [],
): TarvisEvidencePresentation | undefined {
  const signals = resolvedQuestionSignals(question, history);
  if (
    !answer.evidenceIds.some((id) =>
      packet.evidence.some((evidence) => evidence.id === id),
    ) ||
    !hasMetricSignal(signals)
  ) {
    return undefined;
  }

  const windows = windowsFor(packet, signals);
  if (!windows[0]?.metrics.length) return undefined;

  return {
    kind: presentationKind(signals),
    title: presentationTitle(signals),
    detail: presentationDetail(signals),
    windows,
  };
}

export function isTarvisEvidencePresentation(
  value: unknown,
): value is TarvisEvidencePresentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const presentation = value as Partial<TarvisEvidencePresentation>;
  return (
    typeof presentation.kind === 'string' &&
    typeof presentation.title === 'string' &&
    typeof presentation.detail === 'string' &&
    Array.isArray(presentation.windows) &&
    presentation.windows.length > 0 &&
    presentation.windows.every(
      (window) =>
        window &&
        typeof window.label === 'string' &&
        Number.isFinite(window.range?.start) &&
        Number.isFinite(window.range?.end) &&
        typeof window.recordCount === 'number' &&
        typeof window.coveragePercent === 'number' &&
        (window.coverageStatus === 'sufficient' ||
          window.coverageStatus === 'limited' ||
          window.coverageStatus === 'unavailable') &&
        Array.isArray(window.metrics) &&
        window.metrics.every(
          (metric) =>
            metric &&
            typeof metric.id === 'string' &&
            typeof metric.label === 'string' &&
            (metric.value === null || Number.isFinite(metric.value)) &&
            (metric.decimals === 0 || metric.decimals === 1),
        ),
    )
  );
}
