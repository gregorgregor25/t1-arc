import { describe, expect, it } from 'vitest';

import { containsTreatmentDirective, parseTarvisAnswer } from '@/data/tarvis/guardrails';
import type { TarvisEvidencePacket } from '@/data/tarvis/types';

const packet: TarvisEvidencePacket = {
  schemaVersion: 1,
  timezone: 'Europe/London',
  units: { glucose: 'mmol/L', weight: 'kg', distance: 'km' },
  generatedAt: 1,
  comparison: {
    currentRange: { start: 0, end: 86_400_000 },
    headline: 'Requested period',
    summary: 'Recorded data',
    currentOnly: true,
    current: {},
  },
  findings: [],
  evidence: [{ id: 'current-glucose', label: 'Glucose', description: 'Readings', range: { start: 0, end: 86_400_000 }, recordCount: 10, examples: [] }],
};

function parsePersonal(answer: string) {
  return parseTarvisAnswer(JSON.stringify({
    headline: 'Your records', answer, confidence: 'moderate', evidenceIds: ['current-glucose'], limitations: [],
  }), packet);
}

const HARMLESS_DESCRIPTIONS = [
  'You logged 30 g carbs at 13:00.',
  'AAPS delivered 0.4 U as an SMB at 02:10.',
  'You took 4 units of insulin at 08:00, and glucose was 7.2 mmol/L an hour later.',
  'You have 3 meal entries with carbs recorded on Tuesday.',
  'Between 13:00 and 14:00 you have 2 bolus records.',
  'Your glucose was lower after the 4 U bolus at 12:30.',
  'Overall, lower readings appeared after the insulin records.',
  'The loop set a temporary basal of 0.6 U/h at 03:00.',
  'Records show a change in basal delivery at 03:00.',
  'There was no change in insulin delivery overnight.',
  'Basal: increase of 0.2 U/h at 03:00, recorded by AAPS.',
  'Bolus at 12:30: 4.0 U (source: AAPS).',
  'Basal was increased to 1.1 U/h by AAPS at 04:00.',
  'The low was treated with 15 g of glucose tablets at 15:10.',
  'You had a correction bolus of 2 U at 21:00.',
  'The bolus wizard suggested 3.2 U and 3.0 U was delivered.',
  'Your readings were in the target range for 72% of the time. Readings should be read alongside the coverage figure.',
];

const DIRECTIVES = [
  'Take 2 units.',
  'Take 3 units now.',
  'You should bolus for that meal.',
  'You should take 3 units of insulin now.',
  'Increase your basal overnight.',
  'Consider lowering your basal tonight.',
  'I suggest a correction of 1 unit.',
  'I recommend checking whether your ratio needs a change.',
  'Try reducing your insulin-to-carb ratio.',
  'It may help to lower your target.',
  'Eat 15 g of carbs now.',
  'You need to inject insulin.',
  'Bolus 3 U for lunch.',
  'Next time, bolus earlier.',
  'Pre-bolus 15 minutes before meals.',
  'Give 1 unit.',
  'Reduce basal by 20%.',
  'Change your carb ratio to 1:8.',
  'Have 15 g of carbohydrate.',
  'Double your dose.',
  'Skip your bolus tonight.',
  "Don't bolus for that snack.",
  'You could take 1 unit.',
  "It would be worth increasing your basal.",
  'The best option is to give a correction dose.',
  'Your basal should be lowered.',
  'Your ratio should be 1:10.',
  'A 2 unit correction is needed.',
  'You need about 2 units.',
  'If glucose is high, take 2 units.',
  'Setting your basal to 0.8 U/h would help.',
  'The recommended dose is 4 U.',
  'Drink some juice to treat the low.',
];

describe('treatment directive filter', () => {
  it.each(HARMLESS_DESCRIPTIONS)('allows a past-tense or descriptive record: %s', (sentence) => {
    expect(containsTreatmentDirective(sentence)).toBe(false);
    expect(parsePersonal(sentence).answer).toBe(sentence);
  });

  it.each(DIRECTIVES)('blocks a directive, dose suggestion or setting recommendation: %s', (sentence) => {
    expect(containsTreatmentDirective(sentence)).toBe(true);
    expect(() => parsePersonal(sentence)).toThrow(/safe evidence boundary/i);
  });

  it('blocks a directive hidden after harmless descriptions', () => {
    const answer = 'You logged 30 g carbs at 13:00. AAPS delivered 0.4 U as an SMB. Next time, take 2 units.';
    expect(() => parsePersonal(answer)).toThrow(/safe evidence boundary/i);
  });

  it('checks the headline and limitations as well as the answer', () => {
    expect(() => parseTarvisAnswer(JSON.stringify({
      headline: 'Increase your basal', answer: 'You logged 30 g carbs at 13:00.', confidence: 'moderate', evidenceIds: ['current-glucose'], limitations: [],
    }), packet)).toThrow(/safe evidence boundary/i);
    expect(() => parseTarvisAnswer(JSON.stringify({
      headline: 'Records', answer: 'You logged 30 g carbs at 13:00.', confidence: 'moderate', evidenceIds: ['current-glucose'], limitations: ['You should lower your target.'],
    }), packet)).toThrow(/safe evidence boundary/i);
  });
});
