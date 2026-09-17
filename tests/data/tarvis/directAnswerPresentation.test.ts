import {
  limitTarvisVisibleDecimalPrecision,
  parseTarvisDirectAnswerPresentation,
} from '@/data/tarvis/directAnswerPresentation';
import type { TarvisDirectAnswerPresentation } from '@/data/tarvis/types';
import { describe, expect, test } from 'vitest';

const presentation: TarvisDirectAnswerPresentation = {
  version: 1,
  kind: 'comparison',
  source: 'records',
  headline: 'Time in range was 91.6666667%',
  summary: 'It took 38.716666 minutes and averaged 7.12345 mmol/L.',
  confidence: 'high',
  primaryMetric: { label: 'Time in range', value: '91.6666667', unit: '%' },
  keyFindings: [{ title: 'Duration 38.716666', detail: 'A value of -1.235 was observed.' }],
  interpretation: 'Version 1.6.9 and address 192.0.2.69 remain intact.',
  evidence: [{ label: 'Evidence 7.9999', detail: 'Coverage 99.9999%', evidenceId: 'evidence.1.2345' }],
  limitations: ['A rounded result of 0.004 is close to zero.'],
  followUpQuestions: ['Compare with 12.3456%?'],
  safetyNotice: null,
};

describe('TARV1S visible number precision', () => {
  test('limits every user-visible decimal to two places without changing identifiers', () => {
    const formatted = limitTarvisVisibleDecimalPrecision(presentation);

    expect(formatted.headline).toBe('Time in range was 91.67%');
    expect(formatted.summary).toBe('It took 38.72 minutes and averaged 7.12 mmol/L.');
    expect(formatted.primaryMetric?.value).toBe('91.67');
    expect(formatted.keyFindings[0]).toEqual({
      title: 'Duration 38.72',
      detail: 'A value of -1.24 was observed.',
    });
    expect(formatted.interpretation).toBe(
      'Version 1.6.9 and address 192.0.2.69 remain intact.',
    );
    expect(formatted.evidence[0]).toEqual({
      label: 'Evidence 8',
      detail: 'Coverage 100%',
      evidenceId: 'evidence.1.2345',
    });
    expect(formatted.limitations[0]).toBe('A rounded result of 0 is close to zero.');
    expect(formatted.followUpQuestions[0]).toBe('Compare with 12.35%?');
  });

  test('applies the precision ceiling while parsing a model answer', () => {
    const parsed = parseTarvisDirectAnswerPresentation(JSON.stringify(presentation));
    expect(parsed.summary).toContain('38.72 minutes');
    expect(parsed.summary).not.toContain('38.716666');
  });

  test('does not reject a structurally valid answer because the model supplied extra detail', () => {
    const detailed: TarvisDirectAnswerPresentation = {
      ...presentation,
      summary: 'A'.repeat(700),
      keyFindings: Array.from({ length: 6 }, (_, index) => ({
        title: `Finding ${index + 1}`,
        detail: 'Useful supporting detail.',
      })),
      evidence: Array.from({ length: 7 }, (_, index) => ({
        label: `Evidence ${index + 1}`,
        detail: 'A verified local evidence reference.',
        evidenceId: `evidence.${index + 1}`,
      })),
    };

    const parsed = parseTarvisDirectAnswerPresentation(JSON.stringify(detailed));

    expect(parsed.summary).toHaveLength(700);
    expect(parsed.keyFindings).toHaveLength(6);
    expect(parsed.evidence).toHaveLength(7);
  });
});
