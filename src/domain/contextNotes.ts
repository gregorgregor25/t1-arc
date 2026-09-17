import {
  ContextNoteCategory,
  ContextNoteEvent,
  MG_DL_PER_MMOL_L,
} from './models';
import { formatGlucose } from './regionalFormat';

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

export function contextNoteDisplayTitle(
  event: ContextNoteEvent,
  regional: Parameters<typeof formatGlucose>[1],
) {
  const glucoseMmolL =
    event.glucoseMmolL ?? legacyContextNoteGlucoseMmolL(event.title);
  return glucoseMmolL === undefined
    ? event.title
    : `Blood glucose check · ${formatGlucose(glucoseMmolL, regional)}`;
}

function asciiDigits(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0));
}

/** Reads only the exact display shape written by older T1 Arc Glooko imports. */
export function legacyContextNoteGlucoseMmolL(title: string) {
  const match = asciiDigits(title).match(
    /^Blood glucose check ·\s*([\d.,\s\u066b\u066c]+)\s*(mg\/dL|mmol\/L)$/i,
  );
  if (!match) return undefined;
  let numberText = match[1]!
    .replace(/[\s\u066c]/g, '')
    .replace(/\u066b/g, '.');
  if (numberText.includes(',') && numberText.includes('.')) {
    const decimal = Math.max(numberText.lastIndexOf(','), numberText.lastIndexOf('.'));
    numberText = `${numberText.slice(0, decimal).replace(/[.,]/g, '')}.${numberText
      .slice(decimal + 1)
      .replace(/[.,]/g, '')}`;
  } else {
    numberText = numberText.replace(',', '.');
  }
  const value = Number(numberText);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const mmolL = match[2]!.toLowerCase() === 'mg/dl'
    ? value / MG_DL_PER_MMOL_L
    : value;
  return mmolL >= 1 && mmolL <= 40
    ? Math.round(mmolL * 100) / 100
    : undefined;
}
