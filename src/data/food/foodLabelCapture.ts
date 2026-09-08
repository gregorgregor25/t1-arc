/** Review-only label extraction. It never estimates nutrition or writes a food. */
export type FoodLabelConfidence = 'clear' | 'uncertain' | 'missing';

export interface FoodLabelOcrLine {
  text: string;
  confidence?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface FoodLabelOcrResult {
  lines: FoodLabelOcrLine[];
}

export interface FoodLabelDraft {
  fields: {
    serving?: number;
    unit?: 'g' | 'ml';
    carbs?: number;
    energyKcal?: number;
    protein?: number;
    fat?: number;
    fibre?: number;
  };
  basisLabel: string;
  confidence: { basis: FoodLabelConfidence; carbs: FoodLabelConfidence };
  warnings: string[];
}

interface LabelRow { text: string; certain: boolean }
interface LabelBasis { amount: number; unit: 'g' | 'ml'; column: number; columns: number }
type NutrientField = 'carbs' | 'energyKcal' | 'protein' | 'fat' | 'fibre';

const NUMBER = '(\\d+(?:[.,]\\d{1,2})?)';
const LOW_CONFIDENCE = 0.8;

function decimal(value: string) {
  return Number(value.replace(',', '.'));
}

/** Align separate OCR blocks by their visual row, preserving left/right columns. */
function labelRows(input: string | FoodLabelOcrResult): LabelRow[] {
  if (typeof input === 'string') {
    return input.slice(0, 40_000).split(/\r?\n/).slice(0, 200)
      .map((text) => ({ text: text.slice(0, 600).normalize('NFKC'), certain: true }));
  }
  const lines = input.lines.slice(0, 200).filter((line) => typeof line.text === 'string');
  const framed = lines.every((line) => [line.left, line.top, line.width, line.height]
    .every((value) => typeof value === 'number' && Number.isFinite(value)) && (line.height ?? 0) > 0);
  const groups: FoodLabelOcrLine[][] = [];
  if (framed) {
    for (const line of [...lines].sort((a, b) => a.top! + a.height! / 2 - b.top! - b.height! / 2)) {
      const previous = groups.at(-1);
      const anchor = previous?.[0];
      if (anchor && Math.abs(line.top! + line.height! / 2 - anchor.top! - anchor.height! / 2) <=
        Math.min(line.height!, anchor.height!) * 0.45) previous!.push(line);
      else groups.push([line]);
    }
  } else groups.push(...lines.map((line) => [line]));
  return groups.map((group) => ({
    text: group.sort((a, b) => (a.left ?? 0) - (b.left ?? 0)).map((line) => line.text.slice(0, 600))
      .join(' ').slice(0, 1_200).normalize('NFKC'),
    certain: group.every((line) => line.confidence === undefined ||
      (Number.isFinite(line.confidence) && line.confidence >= LOW_CONFIDENCE)),
  }));
}

function findBasis(rows: LabelRow[]): LabelBasis | undefined {
  const explicitHeading = /\b(?:per\s+(?:100\s*(?:g|ml)|serving|portion)|serving size|portion size)\b/i;
  if (rows.some((row) => !row.certain && explicitHeading.test(row.text))) return undefined;
  const certainRows = rows.filter((row) => row.certain).map((row) => row.text.toLowerCase());
  const text = certainRows.join('\n');
  // Require an actual nutrition-column header, not a packet weight such as "Net 100 g".
  const hundredRows = certainRows.filter((row) =>
    /\b(?:per|pour|par|pro)\s*100\s*(?:g|ml)\b/.test(row) ||
    /^\s*100\s*(?:g|ml)\s*$/.test(row) ||
    /(?:typical values|nutrition(?:al)? (?:information|values))\s*100\s*(?:g|ml)\b/.test(row));
  const hundred = hundredRows.flatMap((row) => [...row.matchAll(/\b100\s*(g|ml)\b/g)]);
  if (hundred.length > 1) return undefined; // prepared/as-sold or competing bases
  if (hundred.length === 1) {
    const header = hundredRows[0]!;
    // Separate OCR header rows do not establish which value belongs to which column.
    if (certainRows.some((row) => row !== header && !rowField(row) &&
      !/\b(?:serving size|portion size)\b/.test(row) &&
      /\bper\s+(?:serving|portion|pack|pot|slice|\d+\s*(?:g|ml))\b/.test(row))) return undefined;
    const otherColumns = [...header.matchAll(/\bper\s+(?:(?:serving|portion|pack|pot|slice)\b|\d+(?:[.,]\d+)?\s*(?:g|ml)\b)/g)];
    const hundredIndex = header.indexOf(hundred[0]![0]);
    const other = otherColumns.filter((match) => !/100\s*(g|ml)/.test(match[0]));
    // A serving-size statement elsewhere does not imply a second nutrition column.
    if (other.length > 1) return undefined;
    return { amount: 100, unit: hundred[0]![1] as 'g' | 'ml',
      columns: other.length ? 2 : 1,
      column: other.length && other[0]!.index! < hundredIndex ? 1 : 0 };
  }
  if (!/\b(?:per\s+(?:serving|portion)|amount per serving)\b/.test(text)) return undefined;
  const servingRows = certainRows.filter((row) => !rowField(row) && /\b(?:serving size|portion size|per serving|per portion)\b/.test(row));
  if (servingRows.some((row) => /\d\s*(?:x|×)\s*\d|[-−–+]\s*\d|\d\s+\d{3}\b/.test(row))) return undefined;
  const portions = servingRows.flatMap((row) => [...row.matchAll(new RegExp(`(?<![\\w.,])${NUMBER}\\s*(g|ml)\\b`, 'g'))]);
  const unique = new Map(portions.map((match) => [`${decimal(match[1]!)}:${match[2]}`, match]));
  if (unique.size !== 1) return undefined;
  const portion = [...unique.values()][0]!;
  const amount = decimal(portion[1]!);
  if (!(amount > 0 && amount <= 2_000)) return undefined;
  return { amount, unit: portion[2] as 'g' | 'ml', columns: 1, column: 0 };
}

function rowField(text: string): NutrientField | undefined {
  if (/^\s*(?:(?:total\s+)?carbohydrates?|carbs?)\b/i.test(text)) return 'carbs';
  if (/^\s*(?:energy|calories)\b/i.test(text) && !/calories\s+from/i.test(text)) return 'energyKcal';
  if (/^\s*proteins?\b/i.test(text)) return 'protein';
  if (/^\s*(?:total\s+)?fat\b/i.test(text)) return 'fat';
  if (/^\s*(?:dietary\s+)?fib(?:re|er)\b/i.test(text)) return 'fibre';
  return undefined;
}

function rowValues(text: string, field: NutrientField): number[] {
  // Inequalities, trace amounts and OCR letter/digit substitutions require a person.
  if (/[<>≤≥≈~]|\bless than\b|\btrace\b|\babout\b|\d\s*[/⁄]\s*\d/i.test(text)) return [];
  if (/[-−–+]\s*\d|\d\s+\d{3}\b/.test(text)) return [];
  const quantity = (unit: string) => [...text.matchAll(new RegExp(`(?<![\\w.,])${NUMBER}\\s*(?:${unit})\\b`, 'gi'))]
    .map((match) => decimal(match[1]!));
  if (field !== 'energyKcal') return quantity('g|grams?');
  const kcal = quantity('kcal');
  if (kcal.length) return kcal;
  const kj = quantity('kj');
  if (kj.length) return kj.map((value) => Math.round(value / 4.184 * 100) / 100);
  if (/^\s*calories\b/i.test(text)) {
    return [...text.replace(/^\s*calories\b/i, '').matchAll(new RegExp(`(?<![\\w.,])${NUMBER}(?![\\d.,]|\\s*%)`, 'g'))]
      .map((match) => decimal(match[1]!));
  }
  return [];
}

export function parseFoodNutritionLabel(input: string | FoodLabelOcrResult): FoodLabelDraft {
  const rows = labelRows(input);
  const basis = findBasis(rows);
  const fields: FoodLabelDraft['fields'] = {};
  const found = new Map<NutrientField, { values: number[]; uncertain: boolean }>();
  for (const row of rows) {
    const field = rowField(row.text);
    if (!field) continue;
    const values = row.certain ? rowValues(row.text, field) : [];
    const existing = found.get(field) ?? { values: [], uncertain: false };
    if (!basis || values.length !== basis.columns) existing.uncertain = true;
    else {
      const value = values[basis.column]!;
      const maximum = basis.amount * (field === 'energyKcal' ? 15 : basis.unit === 'g' ? 1 : 2);
      if (!Number.isFinite(value) || value < 0 || value > maximum) existing.uncertain = true;
      else existing.values.push(value);
    }
    found.set(field, existing);
  }
  if (basis) {
    fields.serving = basis.amount;
    fields.unit = basis.unit;
    for (const [field, result] of found) {
      const unique = [...new Set(result.values)];
      if (!result.uncertain && unique.length === 1) fields[field] = unique[0];
    }
  }
  const warnings = ['Check every value against the label before saving.'];
  if (!basis) warnings.push('The nutrition basis is unclear. Enter the weight or volume and nutrition values from the label.');
  if (fields.carbs === undefined) warnings.push('Carbohydrate could not be read with a clear basis. Enter it from the label.');
  if ([...found.values()].some((entry) => entry.uncertain || new Set(entry.values).size !== 1)) {
    warnings.push('Uncertain numbers or columns were left blank.');
  }
  return {
    fields,
    basisLabel: basis ? `Per ${basis.amount} ${basis.unit}` : 'Basis needs review',
    confidence: { basis: basis ? 'clear' : rows.length ? 'uncertain' : 'missing',
      carbs: fields.carbs !== undefined ? 'clear' : found.has('carbs') ? 'uncertain' : 'missing' },
    warnings,
  };
}
