import type { FoodLabelDraft } from '@/data/food/foodLabelCapture';
import type { LabelConvention } from '@/data/food/labelConvention';
import { formatRegionalNumberInput, normalizeRegionalNumberInput } from '@/domain/regionalNumberInput';

export const LABEL_REVIEW_FIELDS = [
  ['serving', 'Label amount'], ['carbs', 'Carbohydrate'], ['energyKcal', 'Energy'],
  ['protein', 'Protein'], ['fat', 'Fat'], ['fibre', 'Fibre'],
  ['sugars', 'Sugars'], ['saturatedFat', 'Saturated fat'],
] as const;
export type LabelReviewField = typeof LABEL_REVIEW_FIELDS[number][0];
export type LabelReviewValues = Record<LabelReviewField, string>;
type Regional = { locale: string; energyUnit: 'kcal' | 'kJ' };

export function labelReviewValues(draft: FoodLabelDraft, regional: Regional): LabelReviewValues {
  return Object.fromEntries(LABEL_REVIEW_FIELDS.map(([field]) => {
    const value = draft.fields[field] ?? draft.suggestions?.[field];
    return [field, value === undefined ? '' : formatRegionalNumberInput(
      value * (field === 'energyKcal' && regional.energyUnit === 'kJ' ? 4.184 : 1), regional.locale, 2)];
  })) as LabelReviewValues;
}

/** Review-only candidates cannot reach the food form until the user confirms them. */
export function checkedLabelDraft(values: LabelReviewValues, unit: 'g' | 'ml',
  convention: LabelConvention | undefined, checked: boolean, regional: Regional,
  source?: FoodLabelDraft,
): { draft?: FoodLabelDraft; error?: string } {
  if (!convention) return { error: 'Choose the label format on this pack.' };
  if (!checked) return { error: 'Check the amount and each value against the label first.' };
  const fields: FoodLabelDraft['fields'] = { unit };
  const original = source ? labelReviewValues(source, regional) : undefined;
  for (const [field, label] of LABEL_REVIEW_FIELDS) {
    if (!values[field].trim()) continue;
    const parsed = normalizeRegionalNumberInput(values[field], regional.locale);
    if (!parsed || parsed.value < 0) return { error: `Enter a valid ${label.toLowerCase()} value, or leave it blank.` };
    const canonical = source?.fields[field] ?? source?.suggestions?.[field];
    fields[field] = original?.[field] === values[field] && canonical !== undefined ? canonical
      : parsed.value / (field === 'energyKcal' && regional.energyUnit === 'kJ' ? 4.184 : 1);
  }
  if (!fields.serving || fields.serving > 2000) return { error: 'Enter the amount these values describe, from the label (up to 2,000 g or ml).' };
  for (const [field, label] of LABEL_REVIEW_FIELDS) {
    if (field === 'serving' || fields[field] === undefined) continue;
    const maximum = fields.serving * (field === 'energyKcal' ? 15 : unit === 'g' ? 1 : 2);
    if (fields[field]! > maximum) return { error: `Check ${label.toLowerCase()} and the label amount; they do not agree.` };
  }
  if (unit === 'g' && (fields.carbs ?? 0) + (fields.fat ?? 0) + (fields.protein ?? 0) > fields.serving * 1.02) {
    return { error: 'Carbohydrate, fat and protein exceed the label amount. Check the column and decimal points.' };
  }
  if (fields.sugars !== undefined && fields.carbs !== undefined && fields.sugars > fields.carbs + 0.5) {
    return { error: 'Sugars exceed carbohydrate. Check both against the same label column.' };
  }
  if (fields.saturatedFat !== undefined && fields.fat !== undefined && fields.saturatedFat > fields.fat + 0.5) {
    return { error: 'Saturated fat exceeds total fat. Check both against the same label column.' };
  }
  return { draft: { fields, labelConvention: convention, basisLabel: `Per ${fields.serving} ${unit}`,
    confidence: { basis: 'clear', carbs: fields.carbs === undefined ? 'missing' : 'clear' }, warnings: [] } };
}
