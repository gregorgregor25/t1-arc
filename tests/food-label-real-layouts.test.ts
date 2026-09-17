import { describe, expect, it } from 'vitest';
import { parseFoodNutritionLabel, type FoodLabelOcrLine } from '@/data/food/foodLabelCapture';
import { checkedLabelDraft, labelReviewValues } from '@/components/foodLogger/labelReview';
import { customFoodFormFromLabelDraft } from '@/components/foodLogger/labelPresentation';
import { EMPTY_CUSTOM_FOOD } from '@/components/foodLogger/myFoodPresentation';

const regional = { locale: 'en-GB', energyUnit: 'kcal' as const };
const line = (text: string, left: number, top: number, confidence = 0.95): FoodLabelOcrLine =>
  ({ text, left, top, width: 100, height: 20, confidence });

describe('real-package layout regressions and explicit review', () => {
  it('accepts newly legible zero and protein from detail without correcting OCR letters', () => {
    const draft = parseFoodNutritionLabel({
      overviewLines: [line('Per 100g', 0, 0), line('Sugars Og', 0, 30), line('Protein 7.0g', 0, 60, 0.4)],
      lines: [line('Per 100g', 0, 0), line('Sugars 0g', 0, 30), line('Protein 7.0g', 0, 60)],
    });
    expect(draft.fields).toMatchObject({ protein: 7, sugars: 0 });
  });
  it('rejects conflicting decimal reads and different bases across detail and overview', () => {
    const original = [line('Per 100g', 0, 0), line('Carbohydrate 15.2g', 0, 30)];
    const conflicting = parseFoodNutritionLabel({ overviewLines: original,
      lines: [line('Per 100g', 0, 0), line('Carbohydrate 1.52g', 0, 30)] });
    expect(conflicting.fields.carbs).toBeUndefined();
    expect(conflicting.suggestions?.carbs).toBeUndefined();
    expect(parseFoodNutritionLabel({ overviewLines: original,
      lines: [line('Serving size 50g', 0, 0), line('Amount per serving', 0, 30), line('Carbohydrate 15.2g', 0, 60)] }).fields).toEqual({});
  });
  it('recognizes named serving columns without using the serving value as per 100g', () => {
    expect(parseFoodNutritionLabel('Per 100g per bagel thin 45g\nCarbohydrate 37.9g 17.1g\nFat 5.0g 2.2g').fields)
      .toMatchObject({ carbs: 37.9, fat: 5 });
    expect(parseFoodNutritionLabel('per 2 biscuits per 100g\nCarbohydrate 25.9g 69g').fields.carbs).toBe(69);
    expect(parseFoodNutritionLabel('per bagel per 100g\nCarbohydrate 17.1g').fields.carbs).toBeUndefined();
  });
  it('keeps wrapped headings in column order', () => {
    const input = { lines: [line('per bagel', 400, 0), line('per 100g', 200, 20), line('thin 45g', 400, 20),
      line('Carbohydrate', 0, 70), line('37.9g', 200, 70), line('17.1g', 400, 70)] };
    expect(parseFoodNutritionLabel(input).fields.carbs).toBe(37.9);
  });
  it('reads paragraph nutrients and separates a later explicitly headed serving paragraph', () => {
    const draft = parseFoodNutritionLabel('Nutrition: Typical values per 100g:\nEnergy 2942kJ/715kcal; Fat 78.7g of which\n' +
      'saturates 35.2g, mono-unsaturates 30.6g,\npolyunsaturates 8.8g; Carbohydrate 0.9g\n' +
      'of which sugars 0.5g; Fibre 0.5g; Protein 0.6g;\nSalt 1.01g.\n' +
      'Per 2 teaspoons (10g): Energy 294kJ/72kcal\nfat 7.9g | saturates 3.5g | carbohydrate <0.5g');
    expect(draft.fields).toEqual({ serving: 100, unit: 'g', energyKcal: 715, fat: 78.7,
      saturatedFat: 35.2, carbs: 0.9, sugars: 0.5, fibre: 0.5, protein: 0.6 });
  });
  it('does not silently repair missing decimal points, units or ambiguous numbers', () => {
    for (const value of ['09g', '05g', '0.9', '0.9q', '0,900g', '<0.5g']) {
      const draft = parseFoodNutritionLabel({ lines: [line('Per 100g', 0, 0), line(`Carbohydrate ${value}`, 0, 50, 0.7)] });
      expect(draft.fields.carbs).toBeUndefined();
      expect(draft.suggestions?.carbs).toBeUndefined();
    }
  });
  it('never maps sugar alcohols to sugars', () => {
    expect(parseFoodNutritionLabel('Per 100g\nSugar alcohol 3g\nCarbohydrate 20g').fields.sugars).toBeUndefined();
  });
  it('offers legible lower-confidence text for review without populating the saved-food form', () => {
    const draft = parseFoodNutritionLabel({ lines: [line('Per 100g', 200, 0, 0.79),
      line('Carbohydrate', 0, 50), line('15.2g', 200, 50, 0.7), line('Protein 7.0g', 0, 100, 0.4)] });
    expect(draft.fields).toEqual({});
    expect(draft.suggestions).toMatchObject({ serving: 100, unit: 'g', carbs: 15.2 });
    expect(draft.suggestions?.protein).toBeUndefined();
    expect(customFoodFormFromLabelDraft(EMPTY_CUSTOM_FOOD, draft, regional).carbs).toBe('');
    const values = labelReviewValues(draft, regional);
    expect(checkedLabelDraft(values, 'g', 'uk-eu', false, regional).draft).toBeUndefined();
    const reviewed = checkedLabelDraft(values, 'g', 'uk-eu', true, regional).draft!;
    expect(reviewed.fields).toEqual({ serving: 100, unit: 'g', carbs: 15.2 });
    expect(reviewed.suggestions).toBeUndefined();
  });
  it('requires a format and amount, permits corrections, and keeps missing nutrients missing', () => {
    const values = labelReviewValues(parseFoodNutritionLabel('Per 100g\nCarbohydrate 15.2g'), regional);
    expect(checkedLabelDraft(values, 'g', undefined, true, regional).error).toBeDefined();
    expect(checkedLabelDraft({ ...values, serving: '' }, 'g', 'uk-eu', true, regional).error).toBeDefined();
    expect(checkedLabelDraft({ ...values, carbs: '12.5' }, 'g', 'uk-eu', true, regional).draft?.fields)
      .toEqual({ serving: 100, unit: 'g', carbs: 12.5 });
  });
  it('rejects implausible totals and subset nutrients at confirmation', () => {
    const values = labelReviewValues(parseFoodNutritionLabel('Per 100g\nCarbohydrate 50g'), regional);
    for (const change of [{ fat: '70' }, { sugars: '80' }, { fat: '2', saturatedFat: '10' }, { carbs: '500' }, { carbs: '-1' }]) {
      expect(checkedLabelDraft({ ...values, ...change }, 'g', 'uk-eu', true, regional).draft).toBeUndefined();
    }
  });
  it('handles decimal commas and energy display without subtracting US fibre or sugar', () => {
    const regional = { locale: 'de-DE', energyUnit: 'kJ' as const };
    const values = labelReviewValues(parseFoodNutritionLabel('Per 100g\nCarbohydrate 20.5g\nFibre 5g\nSugars 2g\nEnergy 100kcal'), regional);
    expect(values.carbs).toBe('20,5');
    expect(checkedLabelDraft(values, 'g', 'us', true, regional).draft?.fields)
      .toMatchObject({ carbs: 20.5, fibre: 5, sugars: 2 });
    expect(checkedLabelDraft(values, 'g', 'us', true, regional).draft?.fields.energyKcal).toBeCloseTo(100, 8);
  });
});
