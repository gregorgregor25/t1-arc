import { describe, expect, it } from 'vitest';
import { parseFoodNutritionLabel, type FoodLabelOcrLine } from '@/data/food/foodLabelCapture';

// Independent review fixtures: ambiguous input must never become a confident dose-relevant value.
describe('nutrition-label independent safety regressions', () => {
  it('does not mistake a component weight for the weight of a multiplied serving', () => {
    const draft = parseFoodNutritionLabel('Serving size 2 x 25 g\nAmount per serving\nTotal carbohydrate 20 g');
    expect(draft.fields.serving).toBeUndefined();
    expect(draft.fields.carbs).toBeUndefined();
  });

  it('uses the explicit total serving mass, not the number of items or container servings', () => {
    const draft = parseFoodNutritionLabel('4 servings per container\nServing size 2 bars (50 g)\nAmount per serving\nTotal carbohydrate 30 g');
    expect(draft.fields).toMatchObject({ serving: 50, unit: 'g', carbs: 30 });
  });

  it('does not infer serving grams from a container count', () => {
    const draft = parseFoodNutritionLabel('4 servings per container\nServing size 1 bar\nAmount per serving\nTotal carbohydrate 20 g');
    expect(draft.fields).toEqual({});
  });

  it('does not mistake a per-serving carbohydrate amount for the serving mass', () => {
    const draft = parseFoodNutritionLabel('Amount per serving\nCarbohydrate per serving 20 g');
    expect(draft.fields).toEqual({});
  });

  it.each(['-5 g', '- 5 g', '−5 g'])('leaves a negative carbohydrate transcription blank: %s', (quantity) => {
    expect(parseFoodNutritionLabel(`Per 100 g\nCarbohydrate ${quantity}`).fields.carbs).toBeUndefined();
  });

  it('does not parse only the tail of an ambiguous thousands-separated serving mass', () => {
    const draft = parseFoodNutritionLabel('Serving size 1,250 g\nAmount per serving\nTotal carbohydrate 20 g');
    expect(draft.fields.serving).toBeUndefined();
    expect(draft.fields.carbs).toBeUndefined();
  });

  it('does not silently turn a spaced-thousands kJ energy amount into zero', () => {
    const draft = parseFoodNutritionLabel('Per 100 g\nEnergy 1 000 kJ\nCarbohydrate 12 g');
    expect(draft.fields.energyKcal).toBeUndefined();
    expect(draft.fields.carbs).toBe(12);
  });

  it('does not choose a basis when two explicit nutrition headings occupy separate rows', () => {
    const draft = parseFoodNutritionLabel('Per 100 g\nPer serving\nCarbohydrate 12 g');
    expect(draft.fields.carbs).toBeUndefined();
  });

  it('does not assign the only OCR nutrient value to a different header column', () => {
    const line = (text: string, left: number, top: number): FoodLabelOcrLine =>
      ({ text, left, top, width: 100, height: 20, confidence: 0.99 });
    const draft = parseFoodNutritionLabel({ lines: [
      line('Per 100 g', 180, 0), line('Per serving', 320, 12),
      line('Carbohydrate', 0, 50), line('12 g', 320, 50),
    ] });
    expect(draft.fields.carbs).toBeUndefined();
  });

  it('does not erase a competing column merely because its heading has low OCR confidence', () => {
    const draft = parseFoodNutritionLabel({ lines: [
      { text: 'Per 100 g', confidence: 0.99 },
      { text: 'Per serving', confidence: 0.45 },
      { text: 'Carbohydrate 12 g', confidence: 0.99 },
    ] });
    expect(draft.fields.carbs).toBeUndefined();
  });

  it('keeps total carbohydrates distinct from sugar, polyol and saturated-fat subrows', () => {
    const draft = parseFoodNutritionLabel('Per 100 g\nTotal carbohydrate 21,5 g 8%\nOf which sugars 5,2 g 6%\nSugar alcohol 3 g\nTotal fat 4 g\nSaturated fat 1 g');
    expect(draft.fields).toMatchObject({ carbs: 21.5, fat: 4 });
  });

  it('does not treat a sugar subrow with a parenthetical carbohydrate label as total carbohydrate', () => {
    const draft = parseFoodNutritionLabel('Per 100 g\nOf which sugars (carbohydrate) 5 g');
    expect(draft.fields.carbs).toBeUndefined();
  });

  it('reads decimal commas and ignores percentages without replacing reported kcal with kJ', () => {
    const draft = parseFoodNutritionLabel('Per 100 g\nEnergy 418 kJ / 100 kcal 5%\nCarbohydrate 20,5 g 8%\nProtein 2,25 g');
    expect(draft.fields).toMatchObject({ energyKcal: 100, carbs: 20.5, protein: 2.25 });
  });

  it('retains unknown basis and OCR-confused numbers as unknown', () => {
    expect(parseFoodNutritionLabel('Net weight 100 g\nCarbohydrate 20 g').fields).toEqual({});
    expect(parseFoodNutritionLabel('Per 100 g\nCarbohydrate 2O g').fields.carbs).toBeUndefined();
  });
});
