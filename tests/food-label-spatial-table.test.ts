import { describe, expect, it } from 'vitest';
import { parseFoodNutritionLabel, type FoodLabelOcrLine } from '@/data/food/foodLabelCapture';

function word(text: string, left: number, top: number, width = 50, height = 24, confidence = 0.85): FoodLabelOcrLine {
  return { text, left, top, width, height, confidence };
}
function row(...elements: FoodLabelOcrLine[]): FoodLabelOcrLine {
  const left = Math.min(...elements.map(e => e.left!)), top = Math.min(...elements.map(e => e.top!));
  return { text: elements.map(e => e.text).join(' '), left, top,
    width: Math.max(...elements.map(e => e.left! + e.width!)) - left,
    height: Math.max(...elements.map(e => e.top! + e.height!)) - top,
    confidence: Math.min(...elements.map(e => e.confidence!)), elements };
}
const header = () => [row(word('Per', 270, 160, 35)), row(word('100g', 256, 190, 55))];
const simpleTable = () => [...header(), row(word('Carbohydrate', 40, 260, 150)), row(word('12.5g', 268, 257, 47)),
  row(word('Protein', 40, 310, 80)), row(word('4.0g', 270, 322, 45))];

describe('positioned nutrition column review', () => {
  it('recovers gently tilted rows and split headings without promoting candidates', () => {
    const result = parseFoodNutritionLabel({ lines: simpleTable() });
    expect(result.fields).toEqual({});
    expect(result.suggestions).toEqual({ serving: 100, unit: 'g', carbs: 12.5, protein: 4 });
  });
  it('does not take a missing per-100g value from the serving or reference columns', () => {
    const lines = simpleTable().filter(line => line.text !== '12.5g');
    lines.push(row(word('Per', 370, 160, 35)), row(word('1/4 pot', 345, 190, 65)), row(word('RI', 440, 175, 24)),
      row(word('5.3g', 370, 257, 37), word('260g', 420, 257, 33)));
    const result = parseFoodNutritionLabel({ lines });
    expect(result.suggestions?.carbs).toBeUndefined();
    expect(result.suggestions?.protein).toBe(4);
  });
  it('isolates reference intake and reads separate kJ/kcal rows in their printed order', () => {
    const lines = [...header(), row(word('Energy kJ', 30, 238, 71, 31)), row(word('Energy kcal', 33, 265, 86, 29)),
      row(word('425', 272, 228, 40, 19)), row(word('102', 277, 257, 35, 19)),
      row(word('5318400', 374, 224, 84, 29)), row(word('1282000', 374, 255, 83, 24)),
      row(word('Carbohydrate', 42, 360, 104, 21)), row(word('4.2g', 269, 356, 46, 23)),
      row(word('5.3g', 371, 353, 36, 22), word('260g', 420, 353, 32, 22))];
    expect(parseFoodNutritionLabel({ lines }).suggestions).toEqual({ serving: 100, unit: 'g', energyKcal: 102, carbs: 4.2 });
  });
  it('does not project a curved label tangent into the salt row', () => {
    const protein = row(word('Protein', 47, 443, 52)); protein.angle = 9.5;
    const salt = row(word('Salt', 49, 474, 25, 19)); salt.angle = 11.3;
    const result = parseFoodNutritionLabel({ lines: [...header(), protein, salt,
      row(word('4.0g', 271, 456, 44, 21)), row(word('0.10g', 264, 491, 52, 21))] });
    expect(result.suggestions?.protein).toBe(4);
  });
  it('rejects conflicting cells, competing bases and low-confidence selected values', () => {
    expect(parseFoodNutritionLabel({ lines: [...simpleTable(), row(word('20g', 270, 259, 44))] }).suggestions?.carbs).toBeUndefined();
    expect(parseFoodNutritionLabel({ lines: [...simpleTable(), row(word('Per', 400, 160), word('100g', 456, 190))] }).suggestions?.carbs).toBeUndefined();
    const low = simpleTable(); low[3] = row(word('12.5g', 268, 257, 47, 24, 0.3));
    expect(parseFoodNutritionLabel({ lines: low }).suggestions?.carbs).toBeUndefined();
  });
  it('never repairs a lost decimal, digit/unit substitution or less-than value', () => {
    for (const value of ['4.29', 'Og', '<0.5g', '05g', '1O.5g']) {
      const lines = simpleTable(); lines[3] = row(word(value, 268, 257, 47));
      expect(parseFoodNutritionLabel({ lines }).suggestions?.carbs).toBeUndefined();
    }
  });
  it('does not borrow a close, tall serving cell from its own explicit header', () => {
    const lines = simpleTable().filter(line => line.text !== '12.5g');
    lines.push(row(word('per', 320, 160, 35), word('15g', 330, 190, 30)),
      row(word('2.5g', 312, 257, 48, 40)));
    expect(parseFoodNutritionLabel({ lines }).suggestions?.carbs).toBeUndefined();
  });
  it('does not move an orphaned value into the next surviving nutrient row', () => {
    const lines = simpleTable().filter(line => line.text !== 'Carbohydrate');
    expect(parseFoodNutritionLabel({ lines }).suggestions?.protein).not.toBe(12.5);
  });
  it('accepts explicit units in row names, including plain text input', () => {
    const result = parseFoodNutritionLabel('Typical values per 100g\nEnergy (kcal) 272\nFat (g) 21.6\nCarbohydrate (g) 10.5');
    expect(result.fields).toMatchObject({ energyKcal: 272, fat: 21.6, carbs: 10.5 });
    expect(parseFoodNutritionLabel('Per 100g\nCarbohydrate (9) 10.5').fields.carbs).toBeUndefined();
  });
  it('keeps crop and overview disagreements blank even for isolated cells', () => {
    const changed = simpleTable(); changed[3] = row(word('1.25g', 268, 257, 47));
    const result = parseFoodNutritionLabel({ lines: changed, overviewLines: simpleTable() });
    expect(result.fields.carbs).toBeUndefined();
    expect(result.suggestions?.carbs).toBeUndefined();
    expect(result.suggestions?.protein).toBe(4);
  });
  it('locates one numeric column when the per-100g title is offset to the left', () => {
    const lines = [row(word('Typical', 20, 100, 70), word('values', 100, 100, 60), word('per', 170, 100, 30), word('100g', 210, 100)),
      row(word('Fat [g]', 20, 200, 70)), row(word('21.6', 340, 200, 40)),
      row(word('Carbohydrate (g)', 20, 250, 180)), row(word('10.5', 340, 250, 40)),
      row(word('Protein [(g)', 20, 300, 120)), row(word('6.4', 350, 300, 30))];
    expect(parseFoodNutritionLabel({ lines }).suggestions).toEqual({ serving: 100, unit: 'g', fat: 21.6, carbs: 10.5, protein: 6.4 });
    const competing = [...lines, row(word('15g', 370, 100, 30))];
    expect(parseFoodNutritionLabel({ lines: competing }).suggestions?.carbs).toBeUndefined();
  });
  it('does not substitute converted kJ when the printed kcal cells span columns', () => {
    const lines = [...header(), row(word('Energy', 40, 240, 90)), row(word('2747kJ', 256, 230, 55)),
      row(word('667kcal 100kcal', 240, 257, 200)),
      row(word('Fat', 40, 310, 50)), row(word('70.8g', 265, 310, 50))];
    const overview = [...header(), row(word('Energy', 40, 240, 90)), row(word('667kcal', 256, 240, 55)),
      row(word('Fat', 40, 310, 50)), row(word('70.8g', 265, 310, 50))];
    expect(parseFoodNutritionLabel({ lines }).suggestions?.energyKcal).toBeUndefined();
    expect(parseFoodNutritionLabel({ lines, overviewLines: overview }).suggestions?.energyKcal).toBe(667);
  });
});
