import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADDITIONAL_FOOD_TABS, appendFoodSelection, savedFoodLibraryVisible } from '@/components/foodLogger/savedFoodPicker';

describe('adding another saved food', () => {
  const first = { food: { id: 'porridge' }, rowId: 'existing-row', amount: '1.25', canonicalAmount: 42.525, amountEdited: true, unit: 'serving' };
  const second = { food: { id: 'milk' }, rowId: 'new-row', amount: '100', canonicalAmount: 100, amountEdited: false, unit: 'ml' };

  it('keeps edited portions and row identities when a saved food is added', () => {
    const draft = [first];
    const result = appendFoodSelection(draft, second);
    expect(result).toEqual([first, second]);
    expect(result[0]).toBe(first);
    expect(result[0]?.canonicalAmount).toBe(42.525);
    expect(draft).toEqual([first]);
  });

  it('does not accidentally duplicate a food or replace its edited amount', () => {
    const draft = [first];
    expect(appendFoodSelection(draft, { ...first, amount: '100', canonicalAmount: 100 })).toBe(draft);
    expect(appendFoodSelection(draft, { ...first, rowId: 'another-row' }, true)).toHaveLength(2);
  });

  it('can open and cancel the picker without changing the current draft', () => {
    const draft = [first];
    expect(savedFoodLibraryVisible('', draft.length, false)).toBe(false);
    expect(savedFoodLibraryVisible('', draft.length, true)).toBe(true);
    expect(savedFoodLibraryVisible('', draft.length, false)).toBe(false);
    expect(draft).toEqual([first]);
    expect(savedFoodLibraryVisible('milk', draft.length, true)).toBe(false);
    expect(savedFoodLibraryVisible('', 0, false)).toBe(true);
  });

  it('offers only single-food tabs while preserving whole-meal replacement guards', () => {
    expect(ADDITIONAL_FOOD_TABS.map(({ id }) => id)).toEqual(['recent', 'favourites', 'my-foods']);
    const source = readFileSync('src/components/FoodLoggerCard.tsx', 'utf8');
    expect(source).toContain('!selected.length && !query.trim() && library.recipes.length');
    expect(source).toContain('!selected.length && !query.trim() && library.meals.length');
    expect(source).toContain('setAdditionalSavedFoodsOpen(value => !value)');
    expect(source).toContain('setSelected((items) => appendFoodSelection(');
    expect(source).toContain('setCopyMode("append")');
  });
});
