import { MG_DL_PER_MMOL_L } from './models';

/** Nightscout omits units for its mg/dL wire format; local AAPS sends them. */
function temporaryTargetUnit(units: unknown, sourceId: string) {
  if (units != null && typeof units !== 'string') return undefined;
  switch (units?.trim().toLowerCase() ?? '') {
    case 'mmol':
    case 'mmol/l':
      return 'mmolL';
    case 'mg/dl':
      return 'mgDl';
    case '':
      return sourceId === 'nightscout' ? 'mgDl' : undefined;
    default:
      return undefined;
  }
}

/** Retain the exact canonical value when the source unit and target are valid. */
function temporaryTargetMmolL(value: number, unit: 'mmolL' | 'mgDl' | undefined) {
  if (!unit || !Number.isFinite(value)) return undefined;
  const mmolL = unit === 'mgDl' ? value / MG_DL_PER_MMOL_L : value;
  return mmolL >= 2 && mmolL <= 25 ? mmolL : undefined;
}

function targetNumber(value: unknown) {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && value.trim() ? Number(value) : NaN;
}

/** An omitted endpoint repeats the supplied one; an invalid supplied endpoint invalidates the pair. */
export function temporaryTargetRange(bottom: unknown, top: unknown, units: unknown, sourceId: string) {
  const bottomMissing = bottom === undefined || bottom === null;
  const topMissing = top === undefined || top === null;
  if (bottomMissing && topMissing) return undefined;
  const unit = temporaryTargetUnit(units, sourceId);
  const low = temporaryTargetMmolL(targetNumber(bottomMissing ? top : bottom), unit);
  const high = temporaryTargetMmolL(targetNumber(topMissing ? bottom : top), unit);
  if (low === undefined || high === undefined || high < low) return undefined;
  return { targetLowMmolL: low, targetHighMmolL: high };
}
