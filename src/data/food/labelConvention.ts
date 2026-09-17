export type LabelConvention = 'uk-eu' | 'us' | 'other';
export const LABEL_CONVENTIONS = [
  { value: 'uk-eu', label: 'UK / EU', detail: 'Use Carbohydrate, not “of which sugars”. Fibre is listed separately; do not subtract it again.' },
  { value: 'us', label: 'US', detail: 'Use Total Carbohydrate as printed. It includes fibre. We do not subtract fibre, sugars or sugar alcohols.' },
  { value: 'other', label: 'Other / unsure', detail: 'Copy the printed carbohydrate value. Keep its meaning unchanged; no automatic deductions are applied.' },
] as const;
export function labelConventionDefinitions(convention?: LabelConvention) {
  if (convention === undefined) return undefined;
  const option = LABEL_CONVENTIONS.find(item => item.value === convention);
  if (!option) throw new Error('Choose the label format.');
  return { carbohydrate: convention === 'uk-eu' ? 'available' as const : convention === 'us' ? 'total' as const : 'unknown' as const, energy: 'reported' as const, note: `${option.label} label. ${option.detail}` };
}
