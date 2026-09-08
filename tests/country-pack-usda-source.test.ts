import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/usda-branded-cheerios-2026-04.json';

const ambiguous = fixture.foods.find((food) => food.fdcId === 2517161)!;
const consistent = fixture.foods.find((food) => food.fdcId === 2738631)!;
const withNutrients = (nutrients: typeof consistent.foodNutrients) => ({ ...consistent, foodNutrients: nutrients });
const carbohydrate = consistent.foodNutrients.find((item) => item.nutrient.id === 1005)!;
const energy = consistent.foodNutrients.find((item) => item.nutrient.id === 1008)!;
const variants = [
  ambiguous, consistent,
  withNutrients([...consistent.foodNutrients, carbohydrate, carbohydrate]),
  withNutrients([...consistent.foodNutrients, { ...carbohydrate, amount: 74 }]),
  withNutrients([...consistent.foodNutrients, { ...energy, nutrient: { ...energy.nutrient, id: 2048 }, amount: 350 }]),
  withNutrients([...consistent.foodNutrients, { ...energy, amount: 350 }, { ...energy, nutrient: { ...energy.nutrient, id: 2048 }, amount: 350 }]),
  { ...consistent, servingSize: 240, servingSizeUnit: 'MLT' },
  { ...consistent, servingSizeUnit: 'UNKNOWN' },
  withNutrients(consistent.foodNutrients.map((item) => item.nutrient.id === 1005 ? { ...item, foodNutrientDerivation: { ...item.foodNutrientDerivation, code: 'LCSL' } } : item)),
  { ...withNutrients(consistent.foodNutrients.map((item) => item.nutrient.id === 1005 ? { ...item, amount: 130 } : item)), servingSizeUnit: 'MLT' },
];

interface Imported {
  values: (number | null)[]; quality: string[]; nutrient_conflicts: string[];
  serving_amount: number; serving_unit: string; serving_label: string; basis_unit: string;
}
const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const results = JSON.parse(execFileSync(python, ['-B', '-c',
  'import importlib.util,json,sys; spec=importlib.util.spec_from_file_location("packs",sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps([module.usda_food(row) for row in json.load(sys.stdin)]))',
  resolve('scripts/build_country_food_packs.py')], { input: JSON.stringify(variants), encoding: 'utf8' })) as (Imported | null)[];

describe('actual USDA source and deterministic importer nutrient semantics', () => {
  it('retains the exact source hash and rejects the real conflicting Cheerios record instead of choosing its last macro set', () => {
    expect(fixture.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ambiguous.foodNutrients.filter((item) => item.nutrient.id === 1005).map((item) => item.amount)).toEqual([74.4, 74.4, 21.6]);
    expect(ambiguous.preparationStateCode).toBe('UNPREPARED');
    expect(results[0]).toBeNull(); // All seven supported nutrients conflict.
  });
  it('keeps source per-100g values and normalizes the documented 28 GRM serving without scaling twice', () => {
    expect(consistent.labelNutrients.carbohydrates?.value).toBe(21);
    expect(results[1]).toMatchObject({ values: [75, 357, 14.3, 7.14, 10.7, 3.57, 0], serving_amount: 28, serving_unit: 'g', basis_unit: 'g', serving_label: '1 bowl' });
  });
  it('collapses identical same-ID values and keeps other nutrients when carbohydrate conflicts', () => {
    expect(results[2]!.values).toEqual(results[1]!.values);
    expect(results[2]!.nutrient_conflicts).toEqual([]);
    expect(results[3]!.values[0]).toBeNull();
    expect(results[3]!.quality[0]).toBe('missing');
    expect(results[3]!.values[2]).toBe(14.3);
    expect(results[3]!.nutrient_conflicts).toEqual(['carbs']);
  });
  it('does not confuse distinct energy IDs, or hide a selected-ID conflict by falling back to another ID', () => {
    expect(results[4]!.values[1]).toBe(357);
    expect(results[4]!.nutrient_conflicts).toEqual([]);
    expect(results[5]!.values[1]).toBeNull();
    expect(results[5]!.nutrient_conflicts).toEqual(['kcal']);
  });
  it('preserves MLT as a per-100ml basis with a compatible volume portion; unknown units are not guessed', () => {
    expect(results[6]).toMatchObject({ basis_unit: 'ml', serving_unit: 'ml', serving_amount: 240 });
    expect(results[7]).toBeNull();
    expect(results[9]!.values[0]).toBe(130); // A volume basis is not a 100 g mass cap.
  });
  it('keeps source less-than derivations unknown rather than reporting the bound as exact', () => {
    expect(results[8]!.values[0]).toBeNull();
    expect(results[8]!.quality[0]).toBe('trace');
  });

  it('distinguishes numeric zeros from trace/empty cells and limits compound bread aliases to explicit source names', () => {
    const checks = JSON.parse(execFileSync(python, ['-B', '-c',
      'import importlib.util,json,sys; spec=importlib.util.spec_from_file_location("packs",sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(json.dumps({"numeric":[m.numeric(v) for v in [0,"0",None,"","<0.1","traces"]],"aliases":[m.bls_search_aliases(*v) for v in [["B311000","Weizenbrot/Weißbrot","White bread/wheat bread"],["B221000","Roggenbrot","Rye bread"],["F523100","Brotfrucht roh","Breadfruit raw"],["R000000","Brotaufstrich","Bread spread"],["B000000","Gebäck","Pastry"]]]}))',
      resolve('scripts/build_country_food_packs.py')], { encoding: 'utf8' }));
    expect(checks.numeric).toEqual([[0,'reported'],[0,'reported'],[null,'missing'],[null,'missing'],[null,'trace'],[null,'trace']]);
    expect(checks.aliases).toEqual([['Brot','bread'],['Brot','bread'],[],[],[]]);
  });
});
