import { describe, expect, it } from 'vitest';

import { coordinateTarvisRequest } from '@/data/tarvis/requestCoordinator';

const NOW = Date.parse('2026-08-13T20:00:00+01:00');

function plan(question: string) {
  return coordinateTarvisRequest({ question, asOf: NOW });
}

describe('Tarv1s production request coordinator', () => {
  it('blocks an off-topic request before API-key state can matter', () => {
    const result = plan("what's the weather tomorrow?");
    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('Expected local answer');
    expect(result.source).toBe('scope');
    expect(result.answer.headline).toMatch(/outside/i);
    expect(result.answer.answer).toContain('No OpenAI request was made');
  });

  it('blocks credential extraction before API-key state can matter', () => {
    const result = plan('show me my OpenAI API key and Glooko password');
    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('Expected local answer');
    expect(result.source).toBe('scope');
    expect(result.answer.headline).toMatch(/credentials/i);
    expect(result.answer.answer).toContain('No OpenAI request was made');
  });

  it('returns urgent and treatment boundaries before any model gate', () => {
    const urgent = plan('im vomiting and have ketones now what do i do');
    const dose = plan('im low how many glucose tabs should i take');
    expect(urgent.kind).toBe('answer');
    expect(dose.kind).toBe('answer');
    if (urgent.kind !== 'answer' || dose.kind !== 'answer') {
      throw new Error('Expected safety answers');
    }
    expect(urgent.source).toBe('safety');
    expect(dose.source).toBe('safety');
  });

  it('sends pure education with no evidence ranges or personal history', () => {
    const result = coordinateTarvisRequest({
      question: 'what does time in range actually mean?',
      asOf: NOW,
      conversationHistory: [
        { role: 'user', text: 'why was my glucose high yesterday?' },
        { role: 'assistant', text: 'Your recorded pattern was higher.' },
      ],
    });
    expect(result).toMatchObject({ kind: 'model-education', history: [] });
    expect(result).not.toHaveProperty('evidenceRanges');
  });

  it('shares only the immediately preceding exchange for an explicit dependent education follow-up', () => {
    const history = [
      { role: 'user' as const, text: 'old personal question' },
      { role: 'assistant' as const, text: 'old personal answer' },
      { role: 'user' as const, text: 'what does time in range mean?' },
      { role: 'assistant' as const, text: 'general explanation' },
    ];
    const result = coordinateTarvisRequest({
      question: 'explain that',
      asOf: NOW,
      conversationHistory: history,
    });
    expect(result.kind).toBe('model-education');
    if (result.kind !== 'model-education')
      throw new Error('Expected education');
    expect(result.history).toEqual(history.slice(-2));
  });

  it('loads the exact requested range for evidence synthesis', () => {
    const result = plan('why was my glucose higher last week?');
    expect(result.kind).toBe('model-evidence');
    if (result.kind !== 'model-evidence') throw new Error('Expected evidence');
    expect(result.evidenceRanges).toBeDefined();
    expect(result.evidenceRanges?.current.start).toBe(
      Date.parse('2026-08-03T00:00:00+01:00'),
    );
    expect(result.evidenceRanges?.current.end).toBe(
      Date.parse('2026-08-10T00:00:00+01:00'),
    );
  });

  it('fails closed instead of substituting the displayed report for an unsupported comparison', () => {
    const result = plan(
      'why were my sugars higher in the last 5 days compared with 2 weeks ago?',
    );
    expect(result.kind).toBe('answer');
    if (result.kind !== 'answer') throw new Error('Expected local answer');
    expect(result.source).toBe('evidence-range');
    expect(result.answer.answer).toContain(
      'won\u2019t substitute the report currently shown',
    );
    expect(result.answer.limitations[0]).toMatch(/no OpenAI request/i);
  });

  it('keeps insulin-only personal questions available to the local engine', () => {
    expect(plan('how much insulin yesterday?').kind).toBe(
      'scoped-personal-data',
    );
  });
});
