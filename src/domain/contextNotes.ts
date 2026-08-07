import { ContextNoteCategory } from './models';

export const CONTEXT_NOTE_CATEGORY_LABELS: Record<
  ContextNoteCategory,
  string
> = {
  illness: 'Illness',
  stress: 'Stress',
  pump: 'Pod / site',
  sensor: 'Sensor',
  hormones: 'Hormones',
  travel: 'Travel',
  other: 'Other context',
};

export function contextNoteCategoryLabel(category: ContextNoteCategory) {
  return CONTEXT_NOTE_CATEGORY_LABELS[category];
}
