import type { TarvisDirectAnswerPresentation } from '@/data/tarvis/types';
import { formatTarvisNumber } from './regionalNumberPresentation';

type JsonRecord = Record<string, unknown>;

export const TARVIS_DIRECT_ANSWER_FORMAT = {
  type: 'json_schema',
  name: 'tarvis_answer_v1',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'version',
      'kind',
      'source',
      'headline',
      'summary',
      'confidence',
      'primaryMetric',
      'keyFindings',
      'interpretation',
      'evidence',
      'limitations',
      'followUpQuestions',
      'safetyNotice',
    ],
    properties: {
      version: { type: 'integer', enum: [1] },
      kind: {
        type: 'string',
        enum: ['fact', 'comparison', 'pattern', 'explanation', 'guidance', 'general'],
      },
      source: {
        type: 'string',
        enum: ['records', 'guidance', 't1arc'],
      },
      headline: { type: 'string' },
      summary: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'moderate', 'limited'] },
      primaryMetric: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'value', 'unit'],
            properties: {
              label: { type: 'string' },
              value: { type: 'string' },
              unit: { type: 'string' },
            },
          },
          { type: 'null' },
        ],
      },
      keyFindings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'detail'],
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
          },
        },
      },
      interpretation: {
        anyOf: [
          { type: 'string' },
          { type: 'null' },
        ],
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['label', 'detail', 'evidenceId'],
          properties: {
            label: { type: 'string' },
            detail: { type: 'string' },
            evidenceId: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
            },
          },
        },
      },
      limitations: {
        type: 'array',
        items: { type: 'string' },
      },
      followUpQuestions: {
        type: 'array',
        items: { type: 'string' },
      },
      safetyNotice: {
        anyOf: [
          { type: 'string' },
          { type: 'null' },
        ],
      },
    },
  },
} as const;

export function parseTarvisDirectAnswerPresentation(
  value: string,
): TarvisDirectAnswerPresentation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('TARV1S returned an unreadable structured answer.');
  }
  if (!isTarvisDirectAnswerPresentation(parsed)) {
    throw new Error('TARV1S returned an invalid structured answer.');
  }
  return limitTarvisVisibleDecimalPrecision(parsed);
}

/**
 * The model may repeat source precision that is useful for calculation but
 * visually noisy in an answer. Keep raw records untouched and enforce the
 * app-wide presentation ceiling at the final TARV1S boundary.
 */
export function limitTarvisVisibleDecimalPrecision(
  presentation: TarvisDirectAnswerPresentation,
): TarvisDirectAnswerPresentation {
  const format = (text: string) =>
    text.replace(
      /(^|[^\d.+-])([+-]?\d+\.\d{3,})(?![\d.eE])/g,
      (_match, prefix: string, literal: string) => {
        const value = Number(literal);
        if (!Number.isFinite(value)) return `${prefix}${literal}`;
        const rounded = formatTarvisNumber(Object.is(value, -0) ? 0 : value, {
          maximumFractionDigits: 2,
        });
        return `${prefix}${rounded}`;
      },
    );

  return {
    ...presentation,
    headline: format(presentation.headline),
    summary: format(presentation.summary),
    primaryMetric: presentation.primaryMetric
      ? {
          ...presentation.primaryMetric,
          label: format(presentation.primaryMetric.label),
          value: format(presentation.primaryMetric.value),
          unit: format(presentation.primaryMetric.unit),
        }
      : null,
    keyFindings: presentation.keyFindings.map((finding) => ({
      title: format(finding.title),
      detail: format(finding.detail),
    })),
    interpretation:
      presentation.interpretation === null
        ? null
        : format(presentation.interpretation),
    evidence: presentation.evidence.map((item) => ({
      ...item,
      label: format(item.label),
      detail: format(item.detail),
    })),
    limitations: presentation.limitations.map(format),
    followUpQuestions: presentation.followUpQuestions.map(format),
    safetyNotice:
      presentation.safetyNotice === null
        ? null
        : format(presentation.safetyNotice),
  };
}

export function isTarvisDirectAnswerPresentation(
  value: unknown,
): value is TarvisDirectAnswerPresentation {
  if (!record(value) || value.version !== 1) return false;
  if (!['fact', 'comparison', 'pattern', 'explanation', 'guidance', 'general'].includes(String(value.kind))) {
    return false;
  }
  if (
    value.source !== undefined &&
    !['records', 'guidance', 't1arc'].includes(String(value.source))
  ) {
    return false;
  }
  if (
    !nonEmptyString(value.headline) ||
    !nonEmptyString(value.summary) ||
    !['high', 'moderate', 'limited'].includes(String(value.confidence))
  ) {
    return false;
  }
  if (value.primaryMetric !== null && !metric(value.primaryMetric)) return false;
  if (!structuredItems(value.keyFindings)) return false;
  if (value.interpretation !== null && !nonEmptyString(value.interpretation)) return false;
  if (!structuredItems(value.evidence, true)) return false;
  if (!strings(value.limitations)) return false;
  if (!strings(value.followUpQuestions)) return false;
  return value.safetyNotice === null || nonEmptyString(value.safetyNotice);
}

function record(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function metric(value: unknown) {
  return (
    record(value) &&
    nonEmptyString(value.label) &&
    nonEmptyString(value.value) &&
    typeof value.unit === 'string'
  );
}

function structuredItems(
  value: unknown,
  evidenceItems = false,
) {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        nonEmptyString(item.title ?? item.label) &&
        nonEmptyString(item.detail) &&
        (!evidenceItems ||
          item.evidenceId === undefined ||
          item.evidenceId === null ||
          nonEmptyString(item.evidenceId)),
    )
  );
}

function strings(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every(nonEmptyString)
  );
}
