import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { FoodLookupError, normaliseFoodBarcode } from '@/data/food/openFoodFacts';
import { recipeNutritionPerServing, servingFromRecipe } from '@/data/food/recipes';
import { createUserFoodCandidate } from '@/data/food/userFood';
import { shouldTryFoodDataCentralBarcodeFallback } from '@/data/food/usdaFoodDataCentral';
import type { FoodCandidate, FoodRecipe } from '@/data/food/types';
import { customFoodFormFromCandidate, EMPTY_CUSTOM_FOOD } from '@/components/foodLogger/myFoodPresentation';
import { customFoodFormFromLabelDraft } from '@/components/foodLogger/labelPresentation';
import { appendFoodSelection } from '@/components/foodLogger/savedFoodPicker';
import { barcodeCacheLookupPlan, canUseStaleBarcodeFallback, staleBarcodeFallbackMessage } from '@/components/foodLogger/searchPresentation';
import { defaultFoodInputUnit, foodAmountFromCanonical, foodAmountToCanonical } from '@/data/food/foodMeasurement';
import { defaultFoodServingAmount, initialFoodPortionAmount } from '@/data/food/servings';

const loggerSource = readFileSync(resolve(process.cwd(), 'src/components/FoodLoggerCard.tsx'), 'utf8');
const parsed = ts.createSourceFile('FoodLoggerCard.tsx', loggerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function handlerSource(name: string) {
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!found) throw new Error(`Missing logger handler ${name}`);
  return found.getText(parsed);
}

function controlHandlerSource(label: string) {
  let found: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const matches = attributes.some((attribute) => attribute.name.getText(parsed) === 'accessibilityLabel' &&
        attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === label);
      const handler = attributes.find((attribute) => attribute.name.getText(parsed) === 'onPress')?.initializer;
      if (matches && handler && ts.isJsxExpression(handler)) found = handler.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!found) throw new Error(`Missing control handler ${label}`);
  return found.getText(parsed);
}

/** Runs actual production handlers with controlled IO, including awaits/state setters.
 * The native app is not loaded; this checks behavior rather than source substrings.
 */
function handlers(names: string[], initial: Record<string, unknown>, controls: Record<string, string> = {}) {
  const functions = [...names.map(handlerSource), ...Object.entries(controls)
    .map(([name, label]) => `const ${name} = ${controlHandlerSource(label)};`)].join('\n');
  const scope: Record<string, unknown> = { exports: {}, Error, Date, fetch: vi.fn(), ...initial };
  const setters = [...new Set(functions.match(/\bset[A-Z]\w*(?=\()/g) ?? [])];
  for (const setter of setters) {
    const key = setter[3]!.toLowerCase() + setter.slice(4);
    if (scope[setter]) continue;
    scope[setter] = vi.fn((value: unknown) => {
      scope[key] = typeof value === 'function' ? value(scope[key]) : value;
    });
  }
  const code = ts.transpileModule(`${functions}\nexport { ${[...names, ...Object.keys(controls)].join(', ')} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, scope);
  return { scope, call: scope.exports as Record<string, (...args: unknown[]) => unknown> };
}

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { resolveValue = resolve; rejectValue = reject; });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

const food: FoodCandidate = {
  ...createUserFoodCandidate({ name: 'Test cereal', servingAmount: 100, servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 60, energyKcal: 380 } }, 1, 'fixture'),
  id: 'open-food-facts:012345678905', provider: 'open-food-facts', externalId: '012345678905', barcode: '012345678905',
};
const recipe: FoodRecipe = { id: 'recipe', name: 'Breakfast batch', mealType: 'breakfast', servings: 4,
  nutrition: { carbohydrateGrams: 120, energyKcal: 760 }, ingredients: [{ food, amount: 200, unit: 'g' }],
  isFavorite: false, createdAt: 1, updatedAt: 1 };
const regional = { countryCode: 'GB', locale: 'en-GB', measurementSystem: 'metric', energyUnit: 'kcal' };

function barcodeHarness(overrides: Record<string, unknown> = {}, extraHandlers: string[] = []) {
  const env = {
    barcodeLookupLock: { current: false }, barcodeRequestGeneration: { current: 0 }, regional,
    FoodLookupError, normaliseFoodBarcode, barcodeCacheLookupPlan, canUseStaleBarcodeFallback,
    staleBarcodeFallbackMessage, shouldTryFoodDataCentralBarcodeFallback, EMPTY_CUSTOM_FOOD,
    acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })),
    assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined),
    getFoodBarcodeCacheEntry: vi.fn(async () => undefined),
    lookupCountryPackBarcode: vi.fn(async () => null),
    lookupOpenFoodFactsBarcode: vi.fn(async () => food),
    lookupFoodDataCentralBarcode: vi.fn(async () => food),
    cacheFoodBarcodeLookup: vi.fn(async () => undefined),
    isLocalDataWriteSupersededError: (error: unknown) => error instanceof Error && error.name === 'LocalDataWriteSupersededError',
    addFood: vi.fn(() => true), ...overrides,
  };
  return { ...handlers(['resolveBarcode', 'takeCustomFoodFormOwnership', ...extraHandlers], env), env };
}

describe('food logger interactions', () => {
  it.each([
    { query: 'porridge', barcode: '' },
    { query: '', barcode: '123' },
  ])('closes search-only browsing without pretending an unsaved meal exists: %j', (lookup) => {
    const alert = vi.fn();
    const clearEditedDraft = vi.fn();
    const flow = handlers(['close'], { ...lookup, saving: false, customSaving: false, recipeSaving: false,
      customFood: { ...EMPTY_CUSTOM_FOOD }, EMPTY_CUSTOM_FOOD, editingLog: undefined, editingRecipeId: undefined,
      selected: [], title: '', quickCarbs: '', quickCarbLabel: '', Alert: { alert }, clearEditedDraft,
      barcodeRequestGeneration: { current: 1 }, barcodeLookupLock: { current: false }, open: true });
    flow.call.close!();
    expect(alert).not.toHaveBeenCalled();
    expect(flow.scope.open).toBe(false);
    expect(clearEditedDraft).toHaveBeenCalledOnce();
  });

  it.each([
    { selected: [{ food, amount: '100', unit: 'g' }] },
    { quickCarbs: '15' },
    { customFood: { ...EMPTY_CUSTOM_FOOD, name: 'Label to keep', carbs: '12' } },
  ])('still protects actual unsaved food data: %j', (draft) => {
    const alert = vi.fn();
    const flow = handlers(['close'], { saving: false, customSaving: false, recipeSaving: false,
      customFood: { ...EMPTY_CUSTOM_FOOD }, EMPTY_CUSTOM_FOOD, editingLog: undefined, editingRecipeId: undefined,
      selected: [], title: '', query: '', barcode: '', quickCarbs: '', quickCarbLabel: '',
      Alert: { alert }, open: true, ...draft });
    flow.call.close!();
    expect(alert).toHaveBeenCalledOnce();
    expect(flow.scope.open).toBe(true);
  });

  it('does not announce an incomplete food as found and opens label completion with no invented carbs', () => {
    const flow = handlers(['addFood'], { regional, customFoodFormFromCandidate, appendFoodSelection,
      invalidateDraftCopyUndo: vi.fn(), Keyboard: { dismiss: vi.fn() }, selected: [],
      selectedFoodState: vi.fn((candidate: FoodCandidate) => ({ food: candidate })) });
    expect(flow.call.addFood!({ ...food, nutritionPerBasis: { energyKcal: 380 } })).toBe(false);
    expect(flow.scope.selected).toEqual([]);
    expect(flow.scope.customFood).toMatchObject({ name: food.name, carbs: '', energy: '380' });
    expect(flow.scope.customOpen).toBe(true);
    expect(flow.scope.barcode).toBe(food.barcode);
    expect(flow.scope.barcodeMessage).toBeUndefined();
  });

  it('preserves stale catalogue status when adding an ordinary search or quick-pick food', () => {
    const flow = handlers(['addFood', 'selectedFoodState'], { regional, customFoodFormFromCandidate, appendFoodSelection,
      invalidateDraftCopyUndo: vi.fn(), Keyboard: { dismiss: vi.fn() }, selected: [],
      getRuntimeRegionalDefaults: () => regional, nextSelectedFoodRowId: () => 'fixture-row',
      defaultFoodInputUnit, initialFoodPortionAmount, foodAmountFromCanonical, defaultFoodServingAmount,
      inputNumber: (value: number) => String(value) });
    expect(flow.call.addFood!({ ...food, catalogueStatus: 'stale' })).toBe(true);
    expect(flow.scope.selected).toEqual([expect.objectContaining({ dataStatus: 'stale' })]);
    const fresh = flow.call.selectedFoodState!({ ...food, catalogueStatus: 'fresh' });
    expect(fresh).toMatchObject({ dataStatus: undefined });
    expect(flow.call.selectedFoodState!(food, undefined, 'stale')).toMatchObject({ dataStatus: 'stale' });
  });

  it('acquires the erase lease before network IO and caches only a successful complete lookup', async () => {
    const flow = barcodeHarness();
    await flow.call.resolveBarcode!(food.barcode);
    expect(flow.env.acquireLocalDataWriteLease.mock.invocationCallOrder[0]).toBeLessThan(flow.env.lookupOpenFoodFactsBarcode.mock.invocationCallOrder[0]!);
    expect(flow.env.cacheFoodBarcodeLookup).toHaveBeenCalledWith(food, { epoch: 4 });
    expect(flow.env.addFood).toHaveBeenCalledWith(food);
    expect(flow.scope.barcodeMessage).toContain('found');
    expect(flow.scope.barcodeLookingUp).toBe(false);
  });

  it.each(['fresh', 'stale', 'personal'] as const)('uses a known %s barcode without waiting for pack or remote IO', async (kind) => {
    const cached = kind === 'personal' ? { ...food, provider: 'user' as const } : food;
    const never = new Promise<FoodCandidate>(() => { /* Deliberately never completes. */ });
    const flow = barcodeHarness({
      getFoodBarcodeCacheEntry: vi.fn(async () => ({ status: kind === 'stale' ? 'stale' : 'fresh', food: cached, regionalMatch: true })),
      lookupOpenFoodFactsBarcode: vi.fn(() => never),
      lookupCountryPackBarcode: vi.fn(() => never),
    });
    await flow.call.resolveBarcode!(food.barcode);
    expect(flow.env.lookupCountryPackBarcode).not.toHaveBeenCalled();
    expect(flow.env.lookupOpenFoodFactsBarcode).not.toHaveBeenCalled();
    expect(flow.env.lookupFoodDataCentralBarcode).not.toHaveBeenCalled();
    expect(flow.env.cacheFoodBarcodeLookup).not.toHaveBeenCalled(); // Reading old details cannot reset their age.
    expect(flow.env.assertLocalDataWriteLeaseCurrent).toHaveBeenCalledWith({ epoch: 4 });
    expect(flow.env.addFood).toHaveBeenCalledExactlyOnceWith(cached, kind === 'stale' ? { dataStatus: 'stale' } : undefined);
    expect(flow.scope.barcodeLookingUp).toBe(false);
    expect(flow.env.barcodeLookupLock.current).toBe(false);
    if (kind === 'stale') expect(flow.scope.barcodeMessage).toContain('older saved details. Check the label');
  });

  it('does not treat a different-region stale barcode as an immediate local match', async () => {
    const pending = deferred<FoodCandidate>();
    const flow = barcodeHarness({
      getFoodBarcodeCacheEntry: vi.fn(async () => ({ status: 'stale', food, regionalMatch: false })),
      lookupOpenFoodFactsBarcode: vi.fn(() => pending.promise),
    });
    const operation = flow.call.resolveBarcode!(food.barcode);
    await vi.waitFor(() => expect(flow.env.lookupOpenFoodFactsBarcode).toHaveBeenCalled());
    expect(flow.env.addFood).not.toHaveBeenCalled();
    pending.resolve(food);
    await operation;
    expect(flow.env.addFood).toHaveBeenCalledExactlyOnceWith(food);
  });

  it('does not append or cache a lookup after the user closes its draft', async () => {
    const pending = deferred<FoodCandidate>();
    const flow = barcodeHarness({ lookupOpenFoodFactsBarcode: vi.fn(() => pending.promise) });
    const operation = flow.call.resolveBarcode!(food.barcode);
    await vi.waitFor(() => expect(flow.env.lookupOpenFoodFactsBarcode).toHaveBeenCalled());
    flow.env.barcodeRequestGeneration.current += 1;
    pending.resolve(food);
    await operation;
    expect(flow.env.cacheFoodBarcodeLookup).not.toHaveBeenCalled();
    expect(flow.env.addFood).not.toHaveBeenCalled();
  });

  it.each(['network', 'rate_limited'] as const)(
    'opens barcode label entry after an OFF miss even if the optional US fallback fails with %s', async (code) => {
      const fallback = vi.fn(async () => { throw new FoodLookupError(code, 'Fallback unavailable'); });
      const flow = barcodeHarness({
        regional: { ...regional, countryCode: 'US', locale: 'en-US' },
        lookupOpenFoodFactsBarcode: vi.fn(async () => { throw new FoodLookupError('not_found', 'No product matched'); }),
        lookupFoodDataCentralBarcode: fallback,
      });
      await flow.call.resolveBarcode!(food.barcode);
      expect(fallback).toHaveBeenCalledWith(food.barcode, expect.any(Function));
      expect(flow.scope.customOpen).toBe(true);
      expect(flow.scope.moreWaysOpen).toBe(true);
      expect(flow.scope.barcodeEntryOpen).toBe(false);
      expect(flow.scope.barcode).toBe(food.barcode);
      expect(flow.scope.customFood).toMatchObject({ carbs: '', energy: '' });
      expect(flow.scope.barcodeError).toContain('Enter it once from the label');
      expect(flow.scope.barcodeMessage).toBeUndefined();
      expect(flow.scope.barcodeLookingUp).toBe(false);
      expect(flow.env.barcodeLookupLock.current).toBe(false);
      expect(flow.env.cacheFoodBarcodeLookup).not.toHaveBeenCalled();
      expect(flow.env.addFood).not.toHaveBeenCalled();
    },
  );

  it.each(['complete', 'incomplete', 'not_found'] as const)(
    'keeps manual label edits when an older lookup later returns %s', async (outcome) => {
      const pending = deferred<FoodCandidate>();
      const flow = barcodeHarness({
        customFood: { ...EMPTY_CUSTOM_FOOD },
        lookupOpenFoodFactsBarcode: vi.fn(() => pending.promise),
      }, ['updateCustomFood']);
      const operation = flow.call.resolveBarcode!(food.barcode);
      await vi.waitFor(() => expect(flow.env.lookupOpenFoodFactsBarcode).toHaveBeenCalled());
      const previousGeneration = flow.env.barcodeRequestGeneration.current;
      expect(flow.env.barcodeLookupLock.current).toBe(true);
      flow.call.updateCustomFood!('name', 'My label entry');
      expect(flow.env.barcodeRequestGeneration.current).toBe(previousGeneration + 1);
      expect(flow.env.barcodeLookupLock.current).toBe(false);
      expect(flow.scope.barcodeLookingUp).toBe(false);
      flow.call.updateCustomFood!('carbs', '17');
      const manualDraft = flow.scope.customFood;
      if (outcome === 'not_found') pending.reject(new FoodLookupError('not_found', 'No product matched'));
      else pending.resolve(outcome === 'complete' ? food : { ...food, nutritionPerBasis: { energyKcal: 380 } });
      await operation;
      expect(flow.scope.customFood).toBe(manualDraft);
      expect(flow.scope.customFood).toMatchObject({ name: 'My label entry', carbs: '17' });
      expect(flow.scope.barcode).toBe(food.barcode);
      expect(flow.scope.barcodeMessage).toBeUndefined();
      expect(flow.scope.barcodeError).toBeUndefined();
      expect(flow.env.cacheFoodBarcodeLookup).not.toHaveBeenCalled();
      expect(flow.env.addFood).not.toHaveBeenCalled();
      expect(flow.env.lookupFoodDataCentralBarcode).not.toHaveBeenCalled();
    },
  );

  it.each(['edit-personal-food', 'accept-label'] as const)(
    'takes form ownership before %s so a pending barcode cannot replace the chosen form', async (action) => {
      const pending = deferred<FoodCandidate>();
      const personal = { ...food, id: 'user:personal', provider: 'user' as const, name: 'My own food' };
      const flow = barcodeHarness({ customFood: { ...EMPTY_CUSTOM_FOOD }, customFoodFormFromCandidate,
        customFoodFormFromLabelDraft, lookupOpenFoodFactsBarcode: vi.fn(() => pending.promise),
      }, ['beginEditMyFood', 'applyCapturedFoodLabel']);
      const operation = flow.call.resolveBarcode!(food.barcode);
      await vi.waitFor(() => expect(flow.env.lookupOpenFoodFactsBarcode).toHaveBeenCalled());
      if (action === 'edit-personal-food') flow.call.beginEditMyFood!(personal);
      else flow.call.applyCapturedFoodLabel!({ fields: { serving: 100, unit: 'g', carbs: 17 },
        confidence: { basis: 'clear', carbs: 'clear' }, basisLabel: 'Per 100 g', warnings: [] });
      const ownedDraft = flow.scope.customFood;
      const ownedMessage = flow.scope.barcodeMessage;
      expect(flow.env.barcodeLookupLock.current).toBe(false);
      expect(flow.scope.barcodeLookingUp).toBe(false);
      pending.resolve({ ...food, nutritionPerBasis: { energyKcal: 380 } });
      await operation;
      expect(flow.scope.customFood).toBe(ownedDraft);
      expect(flow.scope.barcodeMessage).toBe(ownedMessage);
      expect(flow.env.addFood).not.toHaveBeenCalled();
      expect(flow.env.cacheFoodBarcodeLookup).not.toHaveBeenCalled();
      if (action === 'edit-personal-food') expect(flow.scope.editingMyFoodId).toBe(personal.id);
      else expect(flow.scope.customFood).toMatchObject({ carbs: '17' });
    },
  );

  it('does not turn missing-carbohydrate completion into a success notice', async () => {
    const flow = barcodeHarness({ lookupOpenFoodFactsBarcode: vi.fn(async () => ({ ...food, nutritionPerBasis: {} })), addFood: vi.fn(() => false) });
    await flow.call.resolveBarcode!(food.barcode);
    expect(flow.env.cacheFoodBarcodeLookup).not.toHaveBeenCalled();
    expect(flow.scope.barcodeMessage).toBeUndefined();
  });

  it('checks the original erase lease before using either fresh or older local details', async () => {
    const erased = new Error('Erased while looking up food');
    erased.name = 'LocalDataWriteSupersededError';
    for (const status of ['fresh', 'stale'] as const) {
      const flow = barcodeHarness({
        getFoodBarcodeCacheEntry: vi.fn(async () => ({ status, food, regionalMatch: true })),
        lookupOpenFoodFactsBarcode: vi.fn(async () => { throw new FoodLookupError('network', 'Offline'); }),
        assertLocalDataWriteLeaseCurrent: vi.fn(async () => { throw erased; }),
      });
      await flow.call.resolveBarcode!(food.barcode);
      expect(flow.env.assertLocalDataWriteLeaseCurrent).toHaveBeenCalledWith({ epoch: 4 });
      expect(flow.env.addFood).not.toHaveBeenCalled();
      expect(flow.env.cacheFoodBarcodeLookup).not.toHaveBeenCalled();
      expect(flow.scope.barcodeLookingUp).toBe(false);
    }
  });

  it('does not save a meal or recipe while a barcode is still being resolved', async () => {
    const saveFoodRecipe = vi.fn();
    const logFood = vi.fn();
    const flow = handlers(['save', 'saveRecipe'], { barcodeLookupLock: { current: true },
      saving: false, recipeSaving: false, customSaving: false, selected: [{ food }],
      draftItems: recipe.ingredients, saveFoodRecipe, logFood });
    await flow.call.save!();
    await flow.call.saveRecipe!();
    expect(saveFoodRecipe).not.toHaveBeenCalled();
    expect(logFood).not.toHaveBeenCalled();
  });

  it('appends selected recipe servings without mutating existing portions or the saved batch', () => {
    const existing = { food, amount: '33', canonicalAmount: 33, amountEdited: true };
    const flow = handlers(['addRecipePortions'], { selected: [existing], servingFromRecipe, regional,
      invalidateDraftCopyUndo: vi.fn(), formatRegionalNumber: (value: number) => String(value),
      selectedFoodState: (candidate: FoodCandidate, amount: number) => ({ food: candidate, canonicalAmount: amount }) });
    flow.call.addRecipePortions!(recipe, 0.5);
    expect(flow.scope.selected).toEqual([existing, { food, canonicalAmount: 25 }]);
    expect(recipe.ingredients[0]?.amount).toBe(200);
    expect(flow.scope.title).toBeUndefined();
    expect(flow.scope.portionRecipe).toBeUndefined();
  });

  it('clears a saved recipe batch before offering a serving and preserves the draft on failed persistence', async () => {
    const selected = [{ food }];
    const base = { selected, draftItems: recipe.ingredients, recipeDraftRevision: { current: 0 }, recipeSaving: false, barcodeLookupLock: { current: false }, customSaving: false, recipeName: recipe.name,
      recipeServings: '4', mealType: recipe.mealType, recipes: [], editingRecipeId: undefined, regional,
      amountNumber: Number, acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })),
      assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined),
      saveFoodRecipe: vi.fn(async () => recipe), updateFoodRecipe: vi.fn(), recipeNutritionPerServing,
      displayNumber: (value: number) => String(value), isLocalDataWriteSupersededError: () => false };
    const success = handlers(['saveRecipe'], base);
    await success.call.saveRecipe!();
    expect(success.scope.selected).toEqual([]);
    expect(success.scope.portionRecipe).toBe(recipe);
    const failure = handlers(['saveRecipe'], { ...base, saveFoodRecipe: vi.fn(async () => { throw new Error('Save failed'); }) });
    await failure.call.saveRecipe!();
    expect(failure.scope.selected).toBe(selected);
    expect(failure.scope.portionRecipe).toBeUndefined();
    expect(failure.scope.error).toBe('Save failed');
  });

  it.each(['ingredients', 'title'] as const)('keeps newer %s edits when an earlier recipe batch finishes saving', async (change) => {
    const pending = deferred<FoodRecipe>();
    const selected = [{ food }];
    const revision = { current: 0 };
    const persist = vi.fn(() => pending.promise);
    const flow = handlers(['saveRecipe'], { selected, title: 'Original meal', draftItems: recipe.ingredients,
      recipeDraftRevision: revision, recipeSaving: false, barcodeLookupLock: { current: false }, customSaving: false,
      recipeName: recipe.name, recipeServings: '4', mealType: recipe.mealType, recipes: [], editingRecipeId: undefined, regional,
      amountNumber: Number, acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })),
      assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined), saveFoodRecipe: persist, updateFoodRecipe: vi.fn(),
      recipeNutritionPerServing, displayNumber: (value: number) => String(value), isLocalDataWriteSupersededError: () => false });
    const operation = flow.call.saveRecipe!();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    const newerSelection = change === 'ingredients' ? [...selected, { food }] : selected;
    const newerTitle = change === 'title' ? 'Edited meal title' : 'Original meal';
    flow.scope.selected = newerSelection;
    flow.scope.title = newerTitle;
    // The component's layout effect advances this revision after committed draft changes.
    revision.current += 1;
    pending.resolve(recipe);
    await operation;
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ ingredients: recipe.ingredients }), { epoch: 4 });
    expect(flow.scope.selected).toBe(newerSelection);
    expect(flow.scope.title).toBe(newerTitle);
    expect(flow.scope.recipeName).toBe(recipe.name);
    expect(flow.scope.portionRecipe).toBeUndefined();
    expect(flow.scope.barcodeMessage).toContain('newer draft changes are still here');
    expect(flow.scope.recipes).toEqual([recipe]);
  });

  it('remembers a converted personal portion without relabelling it as the old source serving or changing meal amounts', async () => {
    const sourceFood = { ...food, servingLabel: '1 bar (25 g)' };
    const selected = [{ rowId: 'one', food: sourceFood, portionAmount: '1.5', amount: '3', count: '2', unit: 'oz' },
      { rowId: 'two', food: sourceFood, portionAmount: '1', amount: '1', count: '1', unit: 'oz' }];
    const persist = vi.fn(async () => undefined);
    const flow = handlers(['rememberPortion'], {
      selected, portionSaving: undefined, regional, amountNumber: Number, foodAmountToCanonical,
      acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })), saveFoodPersonalServing: persist,
      assertLocalDataWriteLeaseCurrent: vi.fn(async () => undefined), loadSuggestions: vi.fn(),
      isLocalDataWriteSupersededError: () => false,
    });
    await flow.call.rememberPortion!(selected[0]);
    const canonicalAmount = foodAmountToCanonical(1.5, 'oz', 'GB');
    expect(persist).toHaveBeenCalledWith(sourceFood, { amount: canonicalAmount, unit: 'g', label: 'My portion' }, { epoch: 4 });
    const next = flow.scope.selected as typeof selected;
    expect(next.map((item) => item.amount)).toEqual(['3', '1']);
    expect(next.map((item) => item.portionAmount)).toEqual(['1.5', '1']);
    expect(next.every((item) => item.food.personalServingAmount === canonicalAmount)).toBe(true);
    expect(next.every((item) => item.food.servingLabel === '1 bar (25 g)')).toBe(true);
    expect(flow.scope.portionSaving).toBeUndefined();
  });

  it('does not report a remembered portion after its persistence fails or erase invalidates the lease', async () => {
    const selected = [{ rowId: 'one', food, portionAmount: '40', amount: '80', count: '2', unit: 'g' }];
    const base = { selected, portionSaving: undefined, regional, amountNumber: Number, foodAmountToCanonical,
      acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 4 })), loadSuggestions: vi.fn(),
      isLocalDataWriteSupersededError: () => false };
    for (const expired of [false, true]) {
      const flow = handlers(['rememberPortion'], { ...base,
        saveFoodPersonalServing: vi.fn(async () => { if (!expired) throw new Error('Write failed'); }),
        assertLocalDataWriteLeaseCurrent: vi.fn(async () => { if (expired) throw new Error('Data erased'); }),
      });
      await flow.call.rememberPortion!(selected[0]);
      expect(flow.scope.selected).toBe(selected);
      expect(flow.scope.barcodeMessage).toBeUndefined();
      expect(flow.scope.portionSaving).toBeUndefined();
    }
  });

  it('retries the failed page and country scope through the actual Retry control', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('Temporarily unavailable'))
      .mockResolvedValue({ query: 'bread', remotePage: 2, countryScope: 'worldwide' });
    const flow = handlers(['submitFoodSearch'], {
      queryReady: true, normalisedQuery: 'bread', submittedSearchActive: false,
      searchRequestGeneration: { current: 0 }, foodSearchScheduler: { request },
      Keyboard: { dismiss: vi.fn() }, searchPage: 1, searchScope: 'local',
      searchAttempt: { current: { page: 1, scope: 'local' } },
      applyFoodSearchResponse: vi.fn(),
    }, { retrySearch: 'Retry branded food search' });
    await flow.call.submitFoodSearch!(2, 'worldwide');
    expect(flow.scope.searchRetryAvailable).toBe(true);
    flow.call.retrySearch!();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    for (const call of request.mock.calls) {
      expect(call).toEqual(['bread', expect.objectContaining({ remotePage: 2, countryScope: 'worldwide' })]);
    }
  });

  it('shows local submitted-search results before remote completion and ignores superseded callbacks', async () => {
    const pending = deferred<unknown>();
    const request = vi.fn((_query: string, _options: { onLocalResults: (response: unknown) => void }) => pending.promise);
    const apply = vi.fn();
    const generation = { current: 0 };
    const flow = handlers(['submitFoodSearch'], {
      queryReady: true, normalisedQuery: 'bread', submittedSearchActive: false, visibleResults: [],
      searchRequestGeneration: generation, foodSearchScheduler: { request },
      Keyboard: { dismiss: vi.fn() }, searchAttempt: { current: { page: 1, scope: 'local' } },
      applyFoodSearchResponse: apply,
    });
    const operation = flow.call.submitFoodSearch!();
    const options = request.mock.calls[0]![1];
    const local = { query: 'bread', results: [{ food }] };
    options.onLocalResults(local);
    expect(apply).toHaveBeenCalledExactlyOnceWith(local);
    expect(flow.scope.foodSearching).toBe(true);
    generation.current += 1;
    options.onLocalResults({ query: 'old', results: [] });
    pending.resolve({ query: 'old', results: [] });
    await operation;
    expect(apply).toHaveBeenCalledOnce();
  });

  it('keeps already visible mixed results stable while loading more online results', async () => {
    const pending = deferred<unknown>();
    const request = vi.fn((_query: string, _options: { onLocalResults: (response: unknown) => void }) => pending.promise);
    const apply = vi.fn();
    const flow = handlers(['submitFoodSearch'], {
      queryReady: true, normalisedQuery: 'bread', submittedSearchActive: false, visibleResults: [{ food }],
      searchRequestGeneration: { current: 0 }, foodSearchScheduler: { request },
      Keyboard: { dismiss: vi.fn() }, searchAttempt: { current: { page: 1, scope: 'local' } },
      applyFoodSearchResponse: apply,
    });
    const operation = flow.call.submitFoodSearch!(2);
    request.mock.calls[0]![1].onLocalResults({ query: 'bread', results: [] });
    expect(apply).not.toHaveBeenCalled();
    const final = { query: 'bread', results: [{ food }], remotePage: 2 };
    pending.resolve(final);
    await operation;
    expect(apply).toHaveBeenCalledExactlyOnceWith(final, 'submitted');
  });
});
