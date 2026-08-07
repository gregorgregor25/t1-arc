import { formatTime } from './time';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * Chooses a low-friction default in Europe/London time. It is only a UI
 * suggestion: the user can always choose a different meal type.
 */
export function suggestedMealType(timestamp: number): MealType {
  const hour = Number(formatTime(timestamp).slice(0, 2));
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}
