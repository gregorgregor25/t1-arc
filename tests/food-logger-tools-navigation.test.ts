import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { FoodLookupError, normaliseFoodBarcode } from '@/data/food/openFoodFacts';
import { shouldTryFoodDataCentralBarcodeFallback } from '@/data/food/usdaFoodDataCentral';
import { createUserFoodCandidate } from '@/data/food/userFood';
import { foodInputUnits } from '@/data/food/foodMeasurement';
import { EMPTY_CUSTOM_FOOD, customFoodDraftFromForm, customFoodFormFromCandidate,
  myFoodSelectionUnitIsCompatible } from '@/components/foodLogger/myFoodPresentation';
import { appendFoodSelection } from '@/components/foodLogger/savedFoodPicker';
import { barcodeCacheLookupPlan, canUseStaleBarcodeFallback,
  staleBarcodeFallbackMessage } from '@/components/foodLogger/searchPresentation';
import type { FoodCandidate } from '@/data/food/types';

const source = readFileSync(resolve(process.cwd(), 'src/components/FoodLoggerCard.tsx'), 'utf8');
const parsed = ts.createSourceFile('FoodLoggerCard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(predicate: (node: ts.Node) => boolean, start: ts.Node = parsed): ts.Node {
  let match: ts.Node | undefined;
  function visit(node: ts.Node) { if (!match && predicate(node)) match = node; if (!match) ts.forEachChild(node, visit); }
  visit(start);
  if (!match) throw new Error('Production food navigation node not found');
  return match;
}
function handler(name: string) {
  return findNode(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(parsed);
}
function attribute(node: ts.JsxOpeningElement, name: string) {
  return node.attributes.properties.filter(ts.isJsxAttribute).find(item => item.name.getText(parsed) === name)?.initializer;
}
const toolsElement = findNode(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === 'FoodToolsPage') as ts.JsxElement;
let toolsContainer: ts.Node = toolsElement;
while (!ts.isJsxExpression(toolsContainer)) toolsContainer = toolsContainer.parent;
const toolsExpression = (toolsContainer as ts.JsxExpression).expression!.getText(parsed);
const selectedMode = (findNode(node => ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'foodToolSelected') as ts.VariableDeclaration).initializer!.getText(parsed);
const moreButton = findNode(node => ts.isJsxElement(node) && attribute(node.openingElement, 'accessibilityLabel')?.getText(parsed) === '"More ways to add food"') as ts.JsxElement;
const moreHandler = (attribute(moreButton.openingElement, 'onPress') as ts.JsxExpression).expression!.getText(parsed);

type Element = { type: string; props: Record<string, unknown>; children: unknown[] };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('type' in value)) return [];
  const node = value as Element;
  return [node, ...node.children.flatMap(elements)];
}
function copy(value: unknown): string {
  if (Array.isArray(value)) return value.map(copy).join(' ');
  if (value && typeof value === 'object' && 'children' in value) return copy((value as Element).children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
const regional = { countryCode: 'US', locale: 'en-US', measurementSystem: 'metric', energyUnit: 'kcal' };
const food: FoodCandidate = { ...createUserFoodCandidate({ name: 'Tools cereal', servingAmount: 100,
  servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 60 } }, 1, 'tools'),
  id: 'open-food-facts:012345678905', externalId: '012345678905', provider: 'open-food-facts', barcode: '012345678905',
};
const originalSelected = [{ rowId: 'existing', food: { ...food, id: 'existing' }, amount: '50', unit: 'g' }];

/** Executes actual production handlers and the complete tools JSX subtree. */
function navigation(overrides: Record<string, unknown> = {}) {
  const names = ['backFromFoodTools', 'takeCustomFoodFormOwnership', 'updateCustomFood',
    'addCustomFood', 'resolveBarcode', 'addFood'];
  const code = `${names.map(handler).join('\n')}
    const openMore = ${moreHandler};
    function renderTools() { const foodToolSelected = ${selectedMode}; return ${toolsExpression}; }
    export { ${names.join(', ')}, openMore, renderTools };`;
  const scope: Record<string, unknown> = { exports: {}, Error, Date, fetch: vi.fn(),
    open: true, moreWaysOpen: false, customOpen: false, quickCarbOpen: false,
    barcodeEntryOpen: false, catalogueToolsOpen: false, customSaving: false,
    barcodeLookingUp: false, barcode: '', barcodeError: undefined, barcodeMessage: undefined,
    error: undefined, editingMyFoodId: undefined, customFood: { ...EMPTY_CUSTOM_FOOD },
    quickCarbs: '', quickCarbLabel: '', cameraSettingsRequired: false, selected: [...originalSelected],
    barcodeLookupLock: { current: false }, barcodeRequestGeneration: { current: 0 },
    colors: {}, styles: {}, radius: {}, regional, EMPTY_CUSTOM_FOOD, foodInputUnits,
    FoodLookupError, normaliseFoodBarcode, shouldTryFoodDataCentralBarcodeFallback,
    customFoodDraftFromForm, customFoodFormFromCandidate, myFoodSelectionUnitIsCompatible,
    appendFoodSelection, barcodeCacheLookupPlan, canUseStaleBarcodeFallback, staleBarcodeFallbackMessage,
    Keyboard: { dismiss: vi.fn(), isVisible: vi.fn(() => false) },
    invalidateDraftCopyUndo: vi.fn(), addQuickCarbs: vi.fn(), loadSuggestions: vi.fn(async () => undefined),
    selectedFoodState: (candidate: FoodCandidate) => ({ rowId: candidate.id, food: candidate, amount: '100', unit: candidate.basisUnit }),
    createMyFood: vi.fn(async () => ({ ...food, id: 'user:new', provider: 'user' })),
    updateMyFood: vi.fn(async () => ({ ...food, id: 'user:edited', provider: 'user' })),
    acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })), assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined),
    getFoodBarcodeCacheEntry: vi.fn(async () => undefined), lookupCountryPackBarcode: vi.fn(async () => null),
    lookupOpenFoodFactsBarcode: vi.fn(async () => food), lookupFoodDataCentralBarcode: vi.fn(async () => food),
    cacheFoodBarcodeLookup: vi.fn(async () => undefined), isLocalDataWriteSupersededError: () => false,
    h: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    ...overrides,
  };
  for (const component of ['View', 'Pressable', 'Text', 'TextInput', 'Ionicons', 'ActivityIndicator', 'FoodToolsPage', 'FoodCatalogueExtras']) scope[component] = component;
  for (const setter of [...new Set(code.match(/\bset[A-Z]\w*\b/g))]) {
    if (scope[setter]) continue;
    const key = setter[3]!.toLowerCase() + setter.slice(4);
    scope[setter] = vi.fn((value: unknown) => { scope[key] = typeof value === 'function' ? value(scope[key]) : value; });
  }
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'h' }, fileName: 'tools.tsx' }).outputText, scope);
  const call = scope.exports as Record<string, (...args: unknown[]) => unknown>;
  const tree = () => elements(call.renderTools!());
  const press = (label: string) => {
    const target = tree().find(node => node.type === 'Pressable' &&
      (node.props.accessibilityLabel === label || copy(node).trim().startsWith(label)));
    if (!target) throw new Error(`Visible tool control not found: ${label}`);
    return (target.props.onPress as () => unknown)();
  };
  return { scope, call, tree, press };
}
function deferred<T>() {
  let settle!: (value: T) => void;
  return { promise: new Promise<T>(resolve => { settle = resolve; }), resolve: (value: T) => settle(value) };
}

describe('separate food tools navigation', () => {
  it('keeps advanced forms/catalogue outside the meal modal and opens only the choices page from More', () => {
    const meal = findNode(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === 'Modal' &&
      attribute(node.openingElement, 'onRequestClose')?.getText(parsed) === '{handleModalBack}');
    expect(meal.getText(parsed)).not.toMatch(/<FoodCatalogueExtras|<FoodToolsPage|accessibilityLabel="(?:Custom food name|Quick carbohydrate grams|Food barcode number|Manage offline food catalogue)"/);
    const flow = navigation();
    expect(flow.tree()).toEqual([]);
    flow.call.openMore!();
    expect(flow.scope.moreWaysOpen).toBe(true);
    expect(flow.tree()[0]?.props.title).toBe('More food options');
    expect(flow.tree().filter(node => node.type === 'Pressable')).toHaveLength(4);
    expect(flow.tree().some(node => node.type === 'TextInput' || node.type === 'FoodCatalogueExtras')).toBe(false);
    expect(copy(flow.tree()[0])).not.toContain('Save meal');
    expect(flow.scope.selected).toEqual(originalSelected);
  });

  it.each([
    ['Enter a barcode number', 'Enter barcode', 'Food barcode number'],
    ['Just enter carbs', 'Enter carbs', 'Quick carbohydrate grams'],
    ['Create a food', 'Create a food', 'Custom food name'],
    ['Manage offline food catalogue', 'Offline food catalogue', 'catalogue'],
  ])('shows only the selected mode for %s', (choice, title, input) => {
    const flow = navigation({ moreWaysOpen: true }); flow.press(choice);
    expect(flow.tree()[0]?.props).toMatchObject({ title, backLabel: 'Back to food options' });
    const labels = flow.tree().filter(node => node.type === 'TextInput').map(node => node.props.accessibilityLabel);
    for (const candidate of ['Food barcode number', 'Quick carbohydrate grams', 'Custom food name']) {
      expect(labels.includes(candidate)).toBe(candidate === input);
    }
    expect(flow.tree().some(node => node.type === 'FoodCatalogueExtras')).toBe(input === 'catalogue');
    expect(flow.tree().some(node => node.props.accessibilityLabel === 'Manage offline food catalogue')).toBe(false);
    expect(copy(flow.tree()[0])).not.toContain('Save meal');
  });

  it.each([undefined, 'user:editing'])('keeps unsaved personal fields and meal rows through both Back levels and reopening, edit id %s', editingMyFoodId => {
    const draft = { ...EMPTY_CUSTOM_FOOD, name: 'Unsaved oats', carbs: '42', brand: 'My pantry' };
    const flow = navigation({ moreWaysOpen: true, customOpen: true, editingMyFoodId, customFood: draft, barcode: food.barcode });
    flow.call.backFromFoodTools!();
    expect(flow.scope.moreWaysOpen).toBe(true); expect(flow.scope.customOpen).toBe(false);
    expect(flow.scope.customFood).toBe(draft); expect(flow.scope.selected).toEqual(originalSelected);
    flow.call.backFromFoodTools!();
    expect(flow.scope.moreWaysOpen).toBe(false); expect(flow.scope.customFood).toBe(draft);
    flow.call.openMore!(); flow.press(editingMyFoodId ? 'Edit My Food' : 'Create a food');
    expect(flow.scope.customFood).toBe(draft); expect(flow.scope.editingMyFoodId).toBe(editingMyFoodId);
    expect(flow.scope.barcode).toBe(food.barcode); expect(flow.scope.selected).toEqual(originalSelected);
  });

  it('returns to the meal only after a successful custom save and does not start a duplicate save', async () => {
    const saved = deferred<FoodCandidate>();
    const createMyFood = vi.fn(() => saved.promise);
    const flow = navigation({ moreWaysOpen: true, customOpen: true, createMyFood,
      customFood: { ...EMPTY_CUSTOM_FOOD, name: 'My oats', carbs: '42' } });
    const operation = flow.call.addCustomFood!();
    await vi.waitFor(() => expect(createMyFood).toHaveBeenCalledOnce());
    await flow.call.addCustomFood!(); flow.call.backFromFoodTools!();
    expect(createMyFood).toHaveBeenCalledOnce(); expect(flow.scope.moreWaysOpen).toBe(true);
    saved.resolve({ ...food, id: 'user:new', provider: 'user' }); await operation;
    expect(flow.scope.moreWaysOpen).toBe(false); expect(flow.scope.customOpen).toBe(false);
    expect(flow.scope.selected).toEqual([originalSelected[0], expect.objectContaining({ food: expect.objectContaining({ id: 'user:new' }) })]);
  });

  it('returns a successful barcode lookup to the meal without replacing existing rows', async () => {
    const flow = navigation({ moreWaysOpen: true, barcodeEntryOpen: true });
    await flow.call.resolveBarcode!(food.barcode);
    expect(flow.scope.moreWaysOpen).toBe(false); expect(flow.scope.barcodeEntryOpen).toBe(false);
    expect(flow.scope.selected).toHaveLength(2); expect((flow.scope.selected as unknown[])[0]).toEqual(originalSelected[0]);
    expect(flow.scope.barcodeMessage).toContain('found');
  });

  it('cancels a pending barcode on Back, rejects duplicates and ignores its result after returning to the meal', async () => {
    const pending = deferred<FoodCandidate>(); const lookup = vi.fn(() => pending.promise);
    const draft = { ...EMPTY_CUSTOM_FOOD, name: 'Leave my draft alone' };
    const flow = navigation({ moreWaysOpen: true, barcodeEntryOpen: true, lookupOpenFoodFactsBarcode: lookup, customFood: draft });
    const operation = flow.call.resolveBarcode!(food.barcode);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    await flow.call.resolveBarcode!(food.barcode); expect(lookup).toHaveBeenCalledOnce();
    flow.call.backFromFoodTools!(); flow.call.backFromFoodTools!();
    expect(flow.scope.moreWaysOpen).toBe(false); expect(flow.scope.barcodeLookingUp).toBe(false);
    expect((flow.scope.barcodeLookupLock as { current: boolean }).current).toBe(false);
    pending.resolve(food); await operation;
    expect(flow.scope.cacheFoodBarcodeLookup).not.toHaveBeenCalled();
    expect(flow.scope.selected).toEqual(originalSelected); expect(flow.scope.customFood).toBe(draft);
    expect(flow.scope.barcodeMessage).toBeUndefined();
  });
});
