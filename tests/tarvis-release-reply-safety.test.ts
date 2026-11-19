import { describe, expect, it } from 'vitest';

import { parseTarvisGeneralEducationAnswerOrBoundary } from '@/data/tarvis/generalEducation';
import { containsTreatmentDirective } from '@/data/tarvis/guardrails';
import { coordinateTarvisRequest } from '@/data/tarvis/requestCoordinator';

const explanation = (answer: string, headline = 'Explanation', limitations: string[] = []) =>
  JSON.stringify({ kind: 'explanation', headline, answer, limitations });

describe('release reply safety', () => {
  it.each([
    'For a swim, why not disconnect your pump?',
    'Exercise changes glucose. For a swim, why not disconnect your pump?',
    'During exercise, how about suspending your pump?',
    'For dinner, what about increasing your insulin?',
    'Why not try lowering your basal?',
    'That sounds about right.',
    'That seems reasonable.',
    'Insulin is a hormone. That sounds about right.',
  ])('withholds an indirect recommendation or ungrounded verdict: %s', (answer) => {
    expect(parseTarvisGeneralEducationAnswerOrBoundary(explanation(answer)).acceptedHostedAnswer).toBe(false);
    expect(containsTreatmentDirective(answer)).toBe(true);
  });

  it('checks suggestions in headlines and limitations', () => {
    const safe = 'Exercise can affect glucose through several mechanisms.';
    const unsafe = 'For a swim, why not disconnect your pump?';
    expect(parseTarvisGeneralEducationAnswerOrBoundary(explanation(safe, unsafe)).acceptedHostedAnswer).toBe(false);
    expect(parseTarvisGeneralEducationAnswerOrBoundary(explanation(safe, 'Exercise', [unsafe])).acceptedHostedAnswer).toBe(false);
  });

  it.each([
    'basal today and should it be higher',
    'carbs today and insulin needed',
  ])('refuses mixed record and treatment requests before loading evidence: %s', (question) => {
    const plan = coordinateTarvisRequest({ question, asOf: Date.parse('2030-11-12T14:30:00Z'), conversationHistory: [] });
    expect(plan).toMatchObject({ kind: 'answer', source: 'safety' });
  });

  it.each([
    'Exercise can affect insulin sensitivity.',
    'Discuss individual decisions with your diabetes team.',
    'A temporary target is a recorded setting with a start time and duration.',
  ])('preserves general explanations: %s', (answer) => {
    expect(parseTarvisGeneralEducationAnswerOrBoundary(explanation(answer)).acceptedHostedAnswer).toBe(true);
  });

  it.each([
    'AAPS recorded a 0.3 U bolus at 07:45.',
    'The pump was suspended from 10:00 to 10:15.',
    'There is not enough sensor data to compare the two periods.',
  ])('preserves descriptive recorded events: %s', (answer) => {
    expect(containsTreatmentDirective(answer)).toBe(false);
  });
});
