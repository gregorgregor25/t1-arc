import {
  ContextNoteCategory,
  ContextNoteEvent,
  MG_DL_PER_MMOL_L,
} from './models';
import { formatGlucose } from './regionalFormat';
import { temporaryTargetRange } from './temporaryTargets';
import { formatTherapyTarget } from './therapyStatePresentation';

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

/** Present imported target text in the current unit, including older saved notes. */
export function contextNoteDisplayDetail(
  event: ContextNoteEvent,
  regional: Parameters<typeof formatGlucose>[1],
) {
  if (
    event.origin !== 'imported' ||
    !['nightscout', 'aaps-local'].includes(event.sourceId) ||
    !/^temporary target$/i.test(event.title) ||
    !event.detail
  ) {
    return event.detail;
  }

  // Only rewrite the exact segment produced by the treatment importer. Keep
  // source notes, provenance and the original stored numeric precision intact.
  return event.detail
    .split(' · ')
    .map((part) => {
      const match = part.match(
        /^target (\d+(?:\.\d+)?)(?: to (\d+(?:\.\d+)?))? (.{1,12}) as recorded$/i,
      );
      if (!match) return part;
      const range = temporaryTargetRange(match[1], match[2], match[3]!, event.sourceId);
      return range
        ? `recorded target ${formatTherapyTarget(range, regional)}`
        : 'target value unavailable';
    })
    .join(' · ');
}

export function contextNoteDisplayTitle(
  event: ContextNoteEvent,
  regional: Parameters<typeof formatGlucose>[1],
) {
  const glucoseMmolL =
    event.glucoseMmolL ?? legacyContextNoteGlucoseMmolL(event.title);
  if (glucoseMmolL === undefined) return event.title;
  // Hand-entered fingerstick readings are labelled as meter readings so they
  // are never mistaken for sensor (CGM) values. Imported checks keep the
  // wording their source used.
  const label = event.origin === 'manual' ? 'Meter reading' : 'Blood glucose check';
  return `${label} · ${formatGlucose(glucoseMmolL, regional)}`;
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
