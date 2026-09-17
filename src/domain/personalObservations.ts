import type { HealthContextEvent, MealEvent } from './models';

export type BodyLocation = { side: 'front' | 'back'; x?: number; y?: number; label?: string };
export type PersonalObservation =
  | { kind: 'hypo-treatment'; food: string; quantity: number; unit: string; carbsGrams: number }
  | { kind: 'food-incomplete' }
  | { kind: 'lab-result'; test: string; value: number; unit: string; laboratory?: string }
  | { kind: 'site-change'; device: 'pump' | 'sensor'; location: BodyLocation };

function text(value: unknown, maximum: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim().length > maximum || (required && !value.trim())) throw new Error('Enter a valid description.');
  return value.trim() || undefined;
}
function number(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Enter a number between ${min} and ${max}.`);
  return value;
}
export function validateBodyLocation(value: unknown): BodyLocation {
  if (!value || typeof value !== 'object') throw new Error('Choose or describe the body location.');
  const location = value as Record<string, unknown>;
  if (location.side !== 'front' && location.side !== 'back') throw new Error('Choose front or back.');
  const label = text(location.label, 120, false);
  const coordinates = location.x === undefined && location.y === undefined ? {} : { x: number(location.x, 0, 1), y: number(location.y, 0, 1) };
  if (!label && !('x' in coordinates)) throw new Error('Tap the body map or describe the location.');
  return { side: location.side, ...coordinates, ...(label ? { label } : {}) };
}
export function validatePersonalObservation(value: unknown): PersonalObservation {
  if (!value || typeof value !== 'object') throw new Error('This saved observation could not be read.');
  const data = value as Record<string, unknown>;
  switch (data.kind) {
    case 'hypo-treatment': return { kind: data.kind, food: text(data.food, 120)!, quantity: number(data.quantity, 0.01, 10000), unit: text(data.unit, 30)!, carbsGrams: number(data.carbsGrams, 0.1, 1000) };
    case 'food-incomplete': return { kind: data.kind };
    case 'lab-result': {
      const test = text(data.test, 80)!;
      const unit = text(data.unit, 40)!;
      const result = number(data.value, 0, 100000);
      if (test === 'HbA1c' && (!['%', 'mmol/mol'].includes(unit) || result <= 0 || result > (unit === '%' ? 30 : 300))) throw new Error('Check the HbA1c value and units against your laboratory result.');
      return { kind: data.kind, test, unit, value: result, laboratory: text(data.laboratory, 120, false) };
    }
    case 'site-change':
      if (data.device !== 'pump' && data.device !== 'sensor') throw new Error('Choose pump or sensor.');
      return { kind: data.kind, device: data.device, location: validateBodyLocation(data.location) };
    default: throw new Error('Unknown observation type.');
  }
}
export function parsePersonalObservation(value: string | null | undefined): PersonalObservation | undefined {
  if (!value) return undefined;
  try { return validatePersonalObservation(JSON.parse(value)); } catch { return undefined; }
}
export function observationDescription(observation: PersonalObservation) {
  switch (observation.kind) {
    case 'hypo-treatment': return `User recorded treating a hypo with ${observation.quantity} ${observation.unit} ${observation.food}; ${observation.carbsGrams} g carbohydrate. This is treatment history, not a meal or an insulin recommendation.`;
    case 'food-incomplete': return 'User reports that some food was not logged for this period. Logged nutrients are incomplete; do not infer total intake, fasting or absence of food.';
    case 'lab-result': return `Laboratory result entered by the user: ${observation.test} ${observation.value} ${observation.unit}${observation.laboratory ? `, ${observation.laboratory}` : ''}. A measured result, separate from sensor-derived GMI.`;
    case 'site-change': return `User recorded ${observation.device} placement: ${observation.location.side}${observation.location.label ? `, ${observation.location.label}` : ''}${observation.location.x !== undefined ? ` (map ${Math.round(observation.location.x * 100)}%, ${Math.round(observation.location.y! * 100)}%)` : ''}. This records actual placement, not a placement recommendation.`;
  }
}
/** Keep a hypo's original note ID for editing, backup, and evidence references. */
export function presentPersonalObservation(event: HealthContextEvent): HealthContextEvent {
  const observation = event.observation;
  if (event.kind !== 'note' || observation?.kind !== 'hypo-treatment') return event;
  const meal: MealEvent = { ...event, kind: 'meal', mealType: 'snack', purpose: 'hypo-treatment', title: `Hypo treatment · ${observation.food}`, carbsGrams: observation.carbsGrams, nutritionDetail: 'summary' };
  return meal;
}
