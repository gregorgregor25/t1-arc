import type { FoodLabelDraft, FoodLabelOcrLine } from './foodLabelCapture';

type Nutrient = Exclude<keyof FoodLabelDraft['fields'], 'serving' | 'unit'>;
type Box = FoodLabelOcrLine & { left: number; top: number; width: number; height: number };
const framed = (line: FoodLabelOcrLine): line is Box =>
  [line.left, line.top, line.width, line.height].every(value => typeof value === 'number' && Number.isFinite(value)) &&
  line.width! > 0 && line.height! > 0;
const right = (box: Box) => box.left + box.width;
const cx = (box: Box) => box.left + box.width / 2;
const cy = (box: Box) => box.top + box.height / 2;
const readable = (box: Box) => box.confidence !== undefined && Number.isFinite(box.confidence) && box.confidence >= 0.6;

/** Read one explicitly headed column using native word boxes, not text order.
 * No fuzzy digit repair, unit inference, serving conversion or nutrient estimates.
 * Return review candidates only; legacy/unpositioned/paragraph input stays with
 * the text parser. Missing neighbouring cells cannot shift the selected column.
 */
export function spatialNutritionTable(
  source: FoodLabelOcrLine[], fieldOf: (text: string) => Nutrient | undefined,
  valuesOf: (text: string, field: Nutrient) => number[],
): FoodLabelDraft['fields'] | undefined {
  const lines = source.slice(0, 200).filter(framed);
  const words = lines.flatMap(line => line.elements?.slice(0, 30).filter(framed) ?? []);
  if (!words.length) return undefined;
  const headers = words.filter(word => /^100\s*(g|ml)[|:]?$/i.test(word.text));
  // Repeated per-100 headings can describe prepared/as-sold tables. Do not choose.
  if (headers.length !== 1) return undefined;
  const header = headers[0]!;
  if (!readable(header)) return undefined;
  const headingLine = lines.find(line => line.elements?.includes(header));
  const per = /\bper\s*100\s*(g|ml)\b/i.test(headingLine?.text ?? '') || words.some(word =>
    /^per$/i.test(word.text) && readable(word) &&
    Math.abs(cx(word) - cx(header)) <= header.width &&
    header.top - word.top >= 0 && header.top - word.top <= header.height * 2.5);
  if (!per) return undefined;
  const otherHeaders = words.filter(word => word !== header && Math.abs(cy(word) - cy(header)) <= header.height * 1.5 &&
    /^(?:\d+(?:[.,]\d+)?\s*(?:g|ml)|RI\*?|%RI|serving|portion|pot|bagel)$/i.test(word.text));
  const unit = /ml[|:]?$/i.test(header.text) ? 'ml' : 'g';
  const labelLines = lines.filter(line => fieldOf(line.text) || /^\s*(salt|sodium|(?:of which\s+)?(?:polyols|mono|poly)[-\s])/i.test(line.text));
  const labels = labelLines.filter(line => line.left < header.left && cy(line) > cy(header));
  if (labels.length < 2) return undefined;
  // A nutrient label containing its value or crossing the selected column is a
  // paragraph/merged line, not an independently located table label.
  if (labels.some(line => right(line) > header.left + header.width / 2)) return undefined;
  const tableBottom = Math.max(...labels.map(line => line.top + line.height)) + header.height * 2;
  let columnRight = right(header);
  if (/\btypical\s*values\b/i.test(headingLine?.text ?? '') && !otherHeaders.length) {
    // A single-column table may put "per 100g" in the title, left of the values.
    // Require one aligned numeric column beside at least three nutrient labels.
    const numeric = words.filter(word => word.top > cy(header) && word.top < tableBottom &&
      word.left > Math.max(...labels.map(right)) && /^\d+(?:[.,]\d{1,2})?(?:g|kcal|kj)?$/i.test(word.text));
    if (numeric.length >= 3) {
      const edges = numeric.map(right).sort((a, b) => a - b);
      const median = edges[Math.floor(edges.length / 2)]!;
      if (numeric.every(word => Math.abs(right(word) - median) <= word.height * 1.5)) columnRight = median;
    }
  }
  const cells = words.filter(word => word.top > cy(header) && word.top < tableBottom &&
    word.left >= header.left - header.height * 5 &&
    Math.abs(right(word) - columnRight) <= Math.max(header.height, word.height) * 1.4 &&
    !otherHeaders.some(other => Math.abs(right(word) - right(other)) <= Math.abs(right(word) - columnRight)));
  const energyLabels = labels.filter(label => fieldOf(label.text) === 'energyKcal').sort((a, b) => cy(a) - cy(b));
  const firstMacroY = Math.min(...labels.filter(label => fieldOf(label.text) !== 'energyKcal').map(cy));
  // A merged box can contain kcal values from several columns. If that printed
  // row cannot be assigned, do not replace it with a converted kJ value: printed
  // units can disagree, and the overview may still resolve the actual kcal cell.
  const printedKcal = words.some(word => word.top > cy(header) && cy(word) < firstMacroY && /kcal/i.test(word.text));
  const energyCells = cells.filter(cell => cy(cell) < firstMacroY - cell.height / 2).sort((a, b) => cy(a) - cy(b));
  const pairedEnergy = new Map<Box, Box>();
  // Separate Energy kJ / Energy kcal rows can be tilted halfway between baselines.
  // Pair in order only when both explicit units and exactly two cells survive.
  if (energyLabels.length === 2 && energyCells.length === 2 &&
    energyLabels.some(label => /\bkj\b/i.test(label.text)) && energyLabels.some(label => /\bkcal\b/i.test(label.text)) &&
    energyLabels.every((label, index) => Math.abs(cy(label) - cy(energyCells[index]!)) <= label.height * 1.5)) {
    energyCells.forEach((cell, index) => pairedEnergy.set(cell, energyLabels[index]!));
  }
  const found = new Map<Nutrient, { value: number; kcal: boolean }[]>();
  const invalid = new Set<Nutrient>();
  for (const cell of cells) {
    // Use neighbouring row centres, not extrapolated word angles: a tangent on a
    // curved pot can point into the next row at the far side of the label.
    const candidates = labels.map(label => {
      return { label, distance: Math.abs(cy(cell) - cy(label)) };
    }).sort((a, b) => a.distance - b.distance);
    const paired = pairedEnergy.get(cell);
    const best = paired ? { label: paired, distance: Math.abs(cy(cell) - cy(paired)) } : candidates[0];
    if (!best) continue;
    const field = fieldOf(best.label.text);
    if (!field) continue;
    if (cell.left < right(best.label) - cell.height / 2) continue;
    const tolerance = Math.max(cell.height, best.label.height) * 0.95;
    if (!paired && (best.distance > tolerance || (candidates[1] && candidates[1].distance - best.distance < cell.height * 0.2))) continue;
    if (!readable(best.label) || !readable(cell)) { invalid.add(field); continue; }
    let valueText = cell.text;
    // Units printed in the row name are explicit units, not missing units.
    if (/^\d+(?:[.,]\d{1,2})?$/.test(valueText)) {
      if (field !== 'energyKcal' && /[[(]+\s*g\s*[)\]]/i.test(best.label.text)) valueText += 'g';
      else if (field === 'energyKcal' && /\bkcal\b/i.test(best.label.text)) valueText += 'kcal';
      else if (field === 'energyKcal' && /\bkj\b/i.test(best.label.text)) valueText += 'kJ';
    }
    const values = valuesOf(`${best.label.text} ${valueText}`, field);
    if (values.length !== 1 || values[0]! > (field === 'energyKcal' ? 1500 : unit === 'g' ? 100 : 200)) {
      invalid.add(field); continue;
    }
    const entries = found.get(field) ?? [];
    entries.push({ value: values[0]!, kcal: /kcal/i.test(valueText) });
    found.set(field, entries);
  }
  const result: FoodLabelDraft['fields'] = { serving: 100, unit };
  for (const [field, all] of found) {
    // Printed kJ and kcal are independently rounded; prefer the printed kcal row.
    const entries = field === 'energyKcal' && all.some(entry => entry.kcal) ? all.filter(entry => entry.kcal) : all;
    if (field === 'energyKcal' && printedKcal && !entries.some(entry => entry.kcal)) continue;
    const values = [...new Set(entries.map(entry => entry.value))];
    if ((!invalid.has(field) || field === 'energyKcal' && entries.every(entry => entry.kcal)) && values.length === 1) result[field] = values[0];
  }
  return result;
}
