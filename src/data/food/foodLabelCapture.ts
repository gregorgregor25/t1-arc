import type { LabelConvention } from './labelConvention';
import { spatialNutritionTable } from './foodLabelTable';
/** Review-only label extraction. It never estimates nutrition or writes a food. */
export type FoodLabelConfidence = 'clear' | 'uncertain' | 'missing';

export interface FoodLabelOcrLine {
  text: string;
  confidence?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  angle?: number;
  elements?: FoodLabelOcrLine[];
}

export interface FoodLabelOcrResult {
  lines: FoodLabelOcrLine[];
  /** Original full-photo pass, retained to reject conflicting higher-detail reads. */
  overviewLines?: FoodLabelOcrLine[];
}

export interface FoodLabelDraft {
  labelConvention?: LabelConvention;
  /** Lower-confidence transcriptions. Never apply these without explicit human review. */
  suggestions?: FoodLabelDraft['fields'];
  fields: {
    serving?: number;
    unit?: 'g' | 'ml';
    carbs?: number;
    energyKcal?: number;
    protein?: number;
    fat?: number;
    fibre?: number;
    sugars?: number;
    saturatedFat?: number;
  };
  basisLabel: string;
  confidence: { basis: FoodLabelConfidence; carbs: FoodLabelConfidence };
  warnings: string[];
}

interface LabelRow { text: string; certain: boolean }
interface LabelBasis { amount: number; unit: 'g' | 'ml'; column: number; columns: number }
type NutrientField = 'carbs' | 'energyKcal' | 'protein' | 'fat' | 'fibre' | 'sugars' | 'saturatedFat';

const NUMBER = '(\\d+(?:[.,]\\d{1,2})?)';
const LOW_CONFIDENCE = 0.8;
const REVIEW_CONFIDENCE = 0.6;
const COLUMN_HEADING = /\bper\s+(?:\d+(?:[.,]\d+)?\s*(?:g|ml)\b|(?:\d+\s+)?(?:serving|portion|pack|pot|slice|bagel|biscuit|bar|teaspoon|tablespoon|cup|piece)s?\b)/gi;

function decimal(value: string) {
  return Number(value.replace(',', '.'));
}

/** Align separate OCR blocks by their visual row, preserving left/right columns. */
function labelRows(input: string | FoodLabelOcrResult, confidence: number): LabelRow[] {
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
  // A table header can wrap above its per-100g neighbour. Combine only adjacent
  // heading groups; never move a nutrient or value between rows/columns.
  for (let index = 0; index < groups.length - 1; index++) {
    const first = groups[index]!;
    const second = groups[index + 1]!;
    const heading = (group: FoodLabelOcrLine[]) => group.some(line => /\bper\s/i.test(line.text)) &&
      !group.some(line => rowField(line.text));
    if (framed && heading(first) && heading(second) &&
      Math.abs(second[0]!.top! - first[0]!.top!) <= Math.max(first[0]!.height!, second[0]!.height!) * 2) {
      groups.splice(index, 2, [...first, ...second]);
    }
  }
  return groups.map((group) => ({
    text: group.sort((a, b) => (a.left ?? 0) - (b.left ?? 0)).map((line) => line.text.slice(0, 600))
      .join(' ').slice(0, 1_200).normalize('NFKC'),
    certain: group.every((line) => line.confidence === undefined ||
      (Number.isFinite(line.confidence) && line.confidence >= confidence)),
  }));
}

function findBasis(rows: LabelRow[]): LabelBasis | undefined {
  const explicitHeading = /\b(?:per\s+(?:\d|serving|portion|pack|pot|slice|bagel|biscuit|bar|teaspoon|tablespoon|cup|piece)|serving size|portion size)/i;
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
      [...row.matchAll(COLUMN_HEADING)].length > 0)) return undefined;
    const otherColumns = [...header.matchAll(COLUMN_HEADING)];
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
  if (/^\s*sugars?\s+alcohols?\b/i.test(text)) return undefined;
  if (/^\s*(?:(?:total\s+)?carbohydrates?|carbs?)\b/i.test(text)) return 'carbs';
  if (/^\s*(?:energy|calories)\b/i.test(text) && !/calories\s+from/i.test(text)) return 'energyKcal';
  if (/^\s*proteins?\b/i.test(text)) return 'protein';
  if (/^\s*(?:total\s+)?fat\b/i.test(text)) return 'fat';
  if (/^\s*(?:(?:of which|total)\s+)?sugars?\b/i.test(text)) return 'sugars';
  if (/^\s*(?:of which\s+)?(?:saturates|saturated(?:\s+fat)?)\b/i.test(text)) return 'saturatedFat';
  if (/^\s*(?:dietary\s+)?fib(?:re|er)\b/i.test(text)) return 'fibre';
  return undefined;
}

function rowValues(text: string, field: NutrientField): number[] {
  // Inequalities, trace amounts and OCR letter/digit substitutions require a person.
  if (/[<>≤≥≈~]|\bless than\b|\btrace\b|\babout\b|\d\s*[/⁄]\s*\d/i.test(text)) return [];
  if (/[-−–+]\s*\d|\d\s+\d{3}\b/.test(text)) return [];
  // "09g" can be a lost decimal, not evidence for either 9g or 0.9g.
  if (/\b0\d/.test(text)) return [];
  // Some packs print units in the nutrient name: "Fat (g) 21.6".
  const headingUnit = field === 'energyKcal' ? /^\s*energy\s*[([]?\s*(kcal|kj)\s*[)\]]?\s+(.+)$/i
    : /^\s*[a-z\s]+[[(]+\s*(g)\s*[)\]]\s+(.+)$/i;
  const unitRow = text.match(headingUnit);
  if (unitRow && /^\d+(?:[.,]\d{1,2})?(?:\s+\d+(?:[.,]\d{1,2})?)*$/.test(unitRow[2]!)) {
    return unitRow[2]!.split(/\s+/).map(value => unitRow[1]!.toLowerCase() === 'kj'
      ? Math.round(decimal(value) / 4.184 * 100) / 100 : decimal(value));
  }
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

function nutritionRows(rows: LabelRow[]): LabelRow[] {
  // Paragraph labels repeat the whole nutrition statement for a smaller serving.
  // Only isolate that later section when both headings are explicit and the later
  // heading contains a nutrient. Competing per-100g tables remain ambiguous.
  const hundred = rows.filter(row => /\bper\s*100\s*(?:g|ml)\b/i.test(row.text));
  let selected = rows;
  if (hundred.length === 1) {
    const first = rows.indexOf(hundred[0]!);
    const next = rows.findIndex((row, index) => index > first &&
      /^\s*per\s/i.test(row.text) && /\b(?:energy|fat|carbohydrate|protein)\b/i.test(row.text) &&
      /\d+(?:[.,]\d+)?\s*(?:g|ml)\b/i.test(row.text));
    if (next >= 0) selected = rows.slice(0, next);
  }
  return selected.flatMap(row => row.text.split(/[;|]|,\s+(?=[a-z])/i).map(text => ({ ...row, text })));
}

function parseLabel(input: string | FoodLabelOcrResult, confidence: number): FoodLabelDraft {
  const rows = nutritionRows(labelRows(input, confidence));
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

function parseSingleLabel(input: string | FoodLabelOcrResult): FoodLabelDraft {
  const draft = parseLabel(input, LOW_CONFIDENCE);
  if (typeof input === 'string') return draft;
  const review = parseLabel(input, REVIEW_CONFIDENCE);
  const suggestions: FoodLabelDraft['fields'] = {};
  if (draft.fields.serving !== undefined && (draft.fields.serving !== review.fields.serving ||
    draft.fields.unit !== review.fields.unit)) return draft;
  // Same parser and ambiguity/range guards. The lower threshold supplies editable
  // review candidates only; it never promotes them into trusted form values.
  for (const field of ['serving', 'carbs', 'energyKcal', 'protein', 'fat', 'fibre', 'sugars', 'saturatedFat'] as const) {
    if (draft.fields[field] === undefined && review.fields[field] !== undefined) suggestions[field] = review.fields[field];
  }
  if (suggestions.serving !== undefined) suggestions.unit = review.fields.unit;
  if (Object.keys(suggestions).length) draft.suggestions = suggestions;
  const table = spatialNutritionTable(input.lines, rowField, rowValues);
  if (table) {
    // Spatially isolated cells are always review candidates. Using their own
    // column prevents reference-intake/serving values from poisoning the row.
    return { ...draft, fields: {}, suggestions: table, basisLabel: `Per ${table.serving} ${table.unit}`,
      warnings: ['Check every value against the label before saving.', ...(table.carbs === undefined
        ? ['Carbohydrate could not be read with a clear basis. Enter it from the label.'] : [])],
      confidence: { basis: 'uncertain', carbs: table.carbs === undefined ? 'missing' : 'uncertain' } };
  }
  return draft;
}

export function parseFoodNutritionLabel(input: string | FoodLabelOcrResult): FoodLabelDraft {
  const draft = parseSingleLabel(input);
  if (typeof input === 'string' || !input.overviewLines?.length) return draft;
  const overview = parseSingleLabel({ lines: input.overviewLines });
  const value = (source: FoodLabelDraft, field: keyof FoodLabelDraft['fields']) => source.fields[field] ?? source.suggestions?.[field];
  const amount = value(draft, 'serving');
  const originalAmount = value(overview, 'serving');
  if (amount !== undefined && originalAmount !== undefined &&
    (amount !== originalAmount || value(draft, 'unit') !== value(overview, 'unit'))) {
    return { fields: {}, basisLabel: 'Basis needs review', confidence: { basis: 'uncertain', carbs: 'uncertain' },
      warnings: ['The two reads disagree about the label amount. Enter the amount and values from one column.'] };
  }
  let conflict = false;
  for (const field of ['carbs', 'energyKcal', 'protein', 'fat', 'fibre', 'sugars', 'saturatedFat'] as const) {
    const detailed = value(draft, field);
    const original = value(overview, field);
    if (detailed !== undefined && original !== undefined && detailed !== original) {
      delete draft.fields[field];
      if (draft.suggestions) delete draft.suggestions[field];
      if (field === 'carbs') draft.confidence.carbs = 'uncertain';
      conflict = true;
    } else if (detailed === undefined && original !== undefined && amount === originalAmount && amount !== undefined) {
      // An overview-only value is still a review candidate, even when its earlier
      // confidence was high. Never merge values from a different nutrition basis.
      (draft.suggestions ??= {})[field] = original as number;
    }
  }
  if (conflict) draft.warnings.push('The two reads disagreed on some values. Those values were left blank.');
  return draft;
}
