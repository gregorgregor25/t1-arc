import { describe, expect, it } from 'vitest';
import { parseFoodNutritionLabel, type FoodLabelOcrLine } from '@/data/food/foodLabelCapture';

describe('review-only English nutrition label parsing', () => {
  it('reads an explicit US serving weight, Calories, grams and daily-value percentages', () => {
    const draft = parseFoodNutritionLabel('Nutrition Facts\nServing size 1 bar (55 g)\nAmount per serving\nCalories 150\nTotal Fat 8g 10%\nTotal Carbohydrate 37g 13%\nDietary Fiber 4g\nProtein 3g');
    expect(draft.fields).toEqual({ serving: 55, unit: 'g', energyKcal: 150, fat: 8, carbs: 37, fibre: 4, protein: 3 });
    expect(draft.confidence).toEqual({ basis: 'clear', carbs: 'clear' });
    expect(draft.warnings).toContain('Check every value against the label before saving.');
  });

  it('selects the explicit UK per-100g column from a complete two-column table', () => {
    expect(parseFoodNutritionLabel('Per 100 g Per portion (30 g)\nEnergy 840 kJ / 200 kcal 252 kJ / 60 kcal\nFat 10g 3g\nCarbohydrate 20g 6g\nProtein 5g 1.5g').fields)
      .toEqual({ serving: 100, unit: 'g', energyKcal: 200, fat: 10, carbs: 20, protein: 5 });
  });

  it('retains the correct column when the portion column comes first', () => {
    expect(parseFoodNutritionLabel('Per portion (30 g) Per 100 g\nCarbohydrate 6g 20g').fields.carbs).toBe(20);
  });

  it('retains volume as volume and explicit zero without inventing density or other nutrients', () => {
    expect(parseFoodNutritionLabel('Per 100 ml\nCarbohydrate 4,5 g\nFat 0g').fields)
      .toEqual({ serving: 100, unit: 'ml', carbs: 4.5, fat: 0 });
  });

  it('converts explicitly reported kJ to canonical kcal without inferring missing energy', () => {
    expect(parseFoodNutritionLabel('Per 100 g\nEnergy 418.4 kJ').fields.energyKcal).toBe(100);
    expect(parseFoodNutritionLabel('Per 100 g\nCarbohydrate 20g').fields.energyKcal).toBeUndefined();
  });

  it.each(['Carbohydrate <0.5g', 'Carbohydrate trace', 'Carbohydrate 2O g', 'Carbohydrate 101 g', 'Carbohydrate 1/2 g', 'Carbohydrate ~5g'])('leaves uncertain or implausible nutrition blank: %s', (row) => {
    expect(parseFoodNutritionLabel(`Per 100 g\n${row}`).fields.carbs).toBeUndefined();
  });

  it('does not choose between repeated prepared and as-sold tables', () => {
    expect(parseFoodNutritionLabel('Per 100 g as sold\nCarbohydrate 20g\nPer 100 g prepared\nCarbohydrate 5g').fields).toEqual({});
  });

  it('does not choose one of two conflicting readings or fill omitted units', () => {
    expect(parseFoodNutritionLabel('Per 100 g\nCarbohydrate 20g\nCarbohydrate 30g').fields.carbs).toBeUndefined();
    expect(parseFoodNutritionLabel('Per 100 g\nCarbohydrate 20').fields.carbs).toBeUndefined();
  });

  it('leaves incomplete two-column rows blank rather than assigning one value to a basis', () => {
    expect(parseFoodNutritionLabel('Per 100 g Per serving\nCarbohydrate 6g').fields.carbs).toBeUndefined();
  });

  it('reconstructs visual rows and preserves left-to-right OCR blocks', () => {
    const line = (text: string, left: number, top: number): FoodLabelOcrLine =>
      ({ text, left, top, width: 100, height: 20, confidence: 0.99 });
    const draft = parseFoodNutritionLabel({ lines: [line('20g', 200, 100), line('Per 100 g', 200, 0),
      line('Carbohydrate', 0, 100), line('6g', 400, 100), line('Per serving', 400, 0)] });
    expect(draft.fields.carbs).toBe(20);
  });

  it('keeps low-confidence nutrients blank while retaining other clearly read fields', () => {
    const draft = parseFoodNutritionLabel({ lines: [
      { text: 'Per 100 g', confidence: 0.99 }, { text: 'Carbohydrate 20 g', confidence: 0.65 },
      { text: 'Fat 4 g', confidence: 0.99 },
    ] });
    expect(draft.fields).toEqual({ serving: 100, unit: 'g', fat: 4 });
    expect(draft.confidence.carbs).toBe('uncertain');
  });

  it('bounds OCR input and does not derive a missing or count-only serving mass', () => {
    expect(parseFoodNutritionLabel('').fields).toEqual({});
    expect(parseFoodNutritionLabel('Serving size 1 cup\nAmount per serving\nCarbohydrate 20 g').fields).toEqual({});
    expect(parseFoodNutritionLabel({ lines: Array.from({ length: 250 }, () => ({ text: 'unreadable' })) }).fields).toEqual({});
  });
});
