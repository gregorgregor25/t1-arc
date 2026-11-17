import { describe, expect, it } from 'vitest';

import { parseTarvisGeneralEducationAnswer } from '@/data/tarvis/generalEducation';
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

type Position = 'headline' | 'answer' | 'limitation';

function parseAt(position: Position, sentence: string) {
  return parseTarvisAnswer(JSON.stringify({
    headline: position === 'headline' ? sentence : 'Your records',
    answer: position === 'answer' ? sentence : 'The records for this period are shown below.',
    confidence: 'moderate',
    evidenceIds: ['current-glucose'],
    limitations: position === 'limitation' ? [sentence] : [],
  }), packet);
}

function parsePersonal(answer: string) {
  return parseAt('answer', answer);
}

// Past-tense or plainly descriptive statements about recorded events.
const HARMLESS_DESCRIPTIONS = [
  'You logged 30 g carbs at 13:00.',
  'AAPS recorded a 0.4 U SMB at 08:12.',
  'The record shows a temporary basal of 0.8 U/h from 02:00 to 02:30.',
  'AAPS delivered 0.4 U as an SMB at 02:10.',
  'You took 4 units of insulin at 08:00, and glucose was 7.2 mmol/L an hour later.',
  'You logged two units of insulin at 07:45.',
  'You have 3 meal entries with carbs recorded on Tuesday.',
  'Between 13:00 and 14:00 you have 2 bolus records.',
  'Your glucose was lower after the 4 U bolus at 12:30.',
  'Overall, lower readings appeared after the insulin records.',
  'The loop set a temporary basal of 0.6 U/h at 03:00.',
  'Records show a change in basal delivery at 03:00.',
  'There was no change in insulin delivery overnight.',
  'Basal: increase of 0.2 U/h at 03:00, recorded by AAPS.',
  'Basal was increased to 1.1 U/h by AAPS at 04:00.',
  'The low was treated with 15 g of glucose tablets at 15:10.',
  'You had a correction bolus of 2 U at 21:00.',
  'The bolus wizard suggested 3.2 U and 3.0 U was delivered.',
  'AAPS delivered three SMBs between 01:00 and 02:00.',
  'The pump recorded a 1.2 U correction bolus at 22:15.',
  'Glooko lists a 4.5 U meal bolus at 12:40.',
  'Nightscout shows 45 g of carbs entered at 18:30.',
  'Your carb records total 120 g on Saturday.',
  'A temporary target of 8.0 mmol/L was active from 16:00 to 17:00.',
  'An extended bolus of 2.0 U ran over 2 hours from 19:00.',
  'AAPS suspended insulin delivery from 03:10 to 03:40.',
  'Basal delivery was 0.0 U/h during the suspension.',
  'There were no bolus records between 14:00 and 18:00.',
  'The profile switch to 90% was recorded at 21:00.',
  'Total recorded insulin was 38.2 U on Monday.',
  'Your readings were in the target range for 72% of the time. Readings should be read alongside the coverage figure.',
];

// Instructions, dose suggestions and setting recommendations. Each one must be
// rejected wherever it appears in the answer.
const DIRECTIVES = [
  // The three sentences the reviewer found getting through.
  'Take two units of insulin.',
  'For your next meal take 2 units of insulin.',
  'You should now take 2 units of insulin.',
  // Spelled-out and fractional amounts.
  'Take two units.',
  'Give yourself three units before lunch.',
  'Inject half a unit now.',
  'You need two more units.',
  'Two units would cover that meal.',
  'One more unit would bring you into range.',
  // "Consider", "try", "you might want to", "go ahead and", "it would help to".
  'Consider two units for that meal.',
  'Consider a correction of one unit.',
  'You might want to take a unit.',
  'You may want to bolus a little earlier.',
  'You might want to increase your basal overnight.',
  'Try two units next time.',
  'Try a slightly lower ratio.',
  'Go ahead and take the correction.',
  'Go ahead and bolus for the pizza.',
  'It would help to raise your target overnight.',
  'It would help to lower your basal before exercise.',
  'It would be sensible to give a small correction.',
  // Setting changes.
  'Increase your basal by 10%.',
  'Decrease your carb ratio to 1:12.',
  'Raise your target to 6.5 mmol/L.',
  'Lower your ISF.',
  'Lower your insulin sensitivity factor to 2.5.',
  'Raise your ratio slightly.',
  'Cut your basal by a third.',
  'Suspend the pump for an hour.',
  'Set a temporary target of 8 mmol/L before exercise.',
  'Set a temp basal of 50% for 2 hours.',
  'Switch to your exercise profile.',
  'Lowering your basal overnight is an option.',
  'Your ratio is too strong.',
  // Pre-bolus, correction and carbohydrate instructions.
  'Pre-bolus fifteen minutes before breakfast.',
  'A pre-bolus of 15 minutes would help.',
  'Correct with two units.',
  'Correct with 1.5 U if you are above 14.',
  'Eat 15 g of fast-acting carbs.',
  'Eat fifteen grams of carbohydrate.',
  'Have a 15 g snack.',
  'Drink some juice.',
  'Treat the low with glucose tablets.',
  // Passive and impersonal forms.
  '2 units should be taken before the meal.',
  'Two units should be given now.',
  'A correction of 1 U is advisable.',
  'Your next bolus should be 3 U.',
  'The right dose here is 3 U.',
  // Prefixes, adverbs and reminders.
  'Now take 2 U.',
  'So, take 2 units.',
  'Please give 1 unit of insulin.',
  'Just bolus 2 units.',
  'Simply eat 20 g of carbs.',
  "Don't forget your bolus.",
  'Remember to bolus for snacks.',
  'Make sure you take your basal.',
  "Let's add a unit.",
  'Adding a unit at lunch may help.',
  'Skip the SMB.',
  'Next time, give the bolus 20 minutes earlier.',
  'Before your next meal, bolus 4 U.',
  'Take 2 U; then check again.',
  // A directive after a true description in the same sentence.
  'AAPS recorded a 0.4 U SMB at 08:12, so take 2 units now.',
  // Earlier regression list.
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
  // Curly apostrophes as models often write them.
  'You’d better take 2 units.',
  'Don’t skip your bolus.',
];

// Not enough structure to tell a record from an instruction, so it is rejected.
const AMBIGUOUS = [
  'Bolus at 12:30: 4.0 U (source: AAPS).',
];

// Phrasings found by the second independent review, plus close variants.
const REVIEW_DIRECTIVES = [
  'A 2 U correction is indicated.',
  'Proceed with 3 U.',
  'You logged 3 U at lunch; repeat this dose at dinner.',
  'You logged 30 g at 13:00, so repeat that amount at dinner.',
  'AAPS delivered 0.4 U at 08:00 - do that again before lunch.',
  'Bolus 3 units now.',
  'A 2 U correction would bring you back into range.',
  'Set a temp target of 8.',
  "You'll want to have 15 g of glucose.",
  'Dose 4u.',
  'Up your ratio to 1:8.',
  'Suspend the pump.',
  '2U should do it.',
  'Resume insulin delivery.',
  'Go with 2 units.',
  'Turn the pump off for an hour.',
  'A further 1.5 U is warranted.',
  'Bump the basal to 1.2 U/h.',
  'Pause insulin for 30 minutes.',
  'Dial in 2 U.',
  'Lower basal by 10% overnight.',
  'Glucose tablets, 15 g, right away.',
  'Try 4 U for that meal next time.',
  'Cover the pizza with 6 U.',
  'Program a 2 U bolus.',
  'Cut the morning basal to 0.7 U/h.',
  'Give 1 U.',
  'Your next bolus: 4 U.',
  '3 U for dinner.',
  'A 1 U correction is justified.',
  'An extra 10 g of carbs is advised.',
  'Restart the basal at 0.8 U/h.',
];

const REVIEW_EDUCATION_DIRECTIVES = [
  'Up your ratio to 1:8.',
  'Resume insulin delivery.',
  'Pause insulin for 30 minutes.',
  'Bump the basal overnight.',
  'Proceed with a correction.',
  'Turn off the pump.',
  'Dose 4u before meals.',
  'Suspend the pump.',
  'Restart the basal after exercise.',
  'Insulin explains a lot; repeat the bolus if glucose stays high.',
];

const REVIEW_HARMLESS = [
  'Your mean glucose was the same on both days.',
  'The pump was off from 12:00 until 12:30.',
  'Time in range was 68% yesterday, the same as the day before.',
  'AAPS resumed insulin delivery at 03:40.',
  'The bolus wizard calculated 3.2 U at 12:30.',
  'Glooko imported 12 bolus records for Monday.',
  'You entered 20 g of carbs at 10:15.',
  'Insulin on board peaked at 3.1 U around 13:00.',
  'Basal delivery was paused from 03:10 to 03:40.',
  'You took 2 U at 08:00; glucose was 9.1 mmol/L at 09:00.',
];

describe('treatment directive filter', () => {
  it('has the regression coverage the safety review asked for', () => {
    expect(DIRECTIVES.length).toBeGreaterThanOrEqual(40);
    expect(HARMLESS_DESCRIPTIONS.length).toBeGreaterThanOrEqual(15);
  });

  it.each(HARMLESS_DESCRIPTIONS)('allows a past-tense or descriptive record: %s', (sentence) => {
    expect(containsTreatmentDirective(sentence)).toBe(false);
    expect(parsePersonal(sentence).answer).toBe(sentence);
    expect(parseAt('limitation', sentence).limitations).toEqual([sentence]);
  });

  it.each(DIRECTIVES)('blocks a directive in the headline, answer and limitations: %s', (sentence) => {
    expect(containsTreatmentDirective(sentence)).toBe(true);
    for (const position of ['headline', 'answer', 'limitation'] as const) {
      expect(() => parseAt(position, sentence), position).toThrow(/safe evidence boundary/i);
    }
  });

  it.each(AMBIGUOUS)('rejects a sentence it cannot classify safely: %s', (sentence) => {
    expect(() => parsePersonal(sentence)).toThrow(/safe evidence boundary/i);
  });

  it('blocks a directive hidden after harmless descriptions', () => {
    const answer = 'You logged 30 g carbs at 13:00. AAPS delivered 0.4 U as an SMB. Next time, take 2 units.';
    expect(() => parsePersonal(answer)).toThrow(/safe evidence boundary/i);
    expect(() => parsePersonal('You logged 30 g carbs at 13:00.\nTake two units of insulin')).toThrow(/safe evidence boundary/i);
  });

  it.each([
    'You took 2 units at lunch. Do the same tonight.',
    'You took 2 units last time; do the same today.',
    'You logged 30 g at 13:00. Same again tomorrow.',
    'AAPS delivered 0.4 U. Repeat that before dinner.',
    'You took 4 units. Give that again.',
  ])('blocks an instruction that refers back to a recorded dose: %s', (answer) => {
    expect(() => parsePersonal(answer)).toThrow(/safe evidence boundary/i);
  });

  it.each([
    'Take two units of insulin.',
    'For your next meal take 2 units of insulin.',
    'You should now take 2 units of insulin.',
    'Go ahead and bolus for the pizza.',
    'Pre-bolus fifteen minutes before breakfast.',
    'You might want to increase your basal overnight.',
    'Next time, bolus earlier.',
    'Raise your target to 6.5 mmol/L.',
  ])('blocks the same directives in a general education answer: %s', (sentence) => {
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify({
      kind: 'explanation', headline: 'How boluses work', answer: sentence, limitations: [],
    }))).toThrow(/safety boundary|safe evidence boundary/i);
  });

  it('still allows descriptive education about treatment', () => {
    const answer = 'A pre-bolus is insulin given some minutes before eating. Insulin lowers glucose, and activity can increase insulin sensitivity.';
    expect(parseTarvisGeneralEducationAnswer(JSON.stringify({
      kind: 'explanation', headline: 'How boluses work', answer, limitations: [],
    })).answer.answer).toBe(answer);
  });

  it('still allows ordinary sentences that are not about treatment', () => {
    const answer = 'You logged 30 g carbs at 13:00. Coverage was 92% for this period. Readings after 22:00 were sparse.';
    expect(parsePersonal(answer).answer).toBe(answer);
  });

  it('checks the headline and limitations as well as the answer', () => {
    expect(() => parseTarvisAnswer(JSON.stringify({
      headline: 'Increase your basal', answer: 'You logged 30 g carbs at 13:00.', confidence: 'moderate', evidenceIds: ['current-glucose'], limitations: [],
    }), packet)).toThrow(/safe evidence boundary/i);
    expect(() => parseTarvisAnswer(JSON.stringify({
      headline: 'Records', answer: 'You logged 30 g carbs at 13:00.', confidence: 'moderate', evidenceIds: ['current-glucose'], limitations: ['You should lower your target.'],
    }), packet)).toThrow(/safe evidence boundary/i);
  });

  it.each(REVIEW_DIRECTIVES)('blocks a directive found by the second review: %s', (sentence) => {
    expect(containsTreatmentDirective(sentence)).toBe(true);
    expect(() => parsePersonal(sentence)).toThrow(/safe evidence boundary/i);
  });

  it.each(REVIEW_EDUCATION_DIRECTIVES)('blocks it in a general education answer too: %s', (sentence) => {
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify({
      kind: 'explanation', headline: 'How boluses work', answer: sentence, limitations: [],
    }))).toThrow(/safety boundary|safe evidence boundary/i);
  });

  it.each(REVIEW_HARMLESS)('allows a descriptive comparison or recorded state: %s', (sentence) => {
    expect(containsTreatmentDirective(sentence)).toBe(false);
    expect(parsePersonal(sentence).answer).toBe(sentence);
  });
});
