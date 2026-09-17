import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/foodLogger/FoodLibraryBrowser.tsx'), 'utf8');
const parsed = ts.createSourceFile('FoodLibraryBrowser.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.Node | undefined;
function visit(node: ts.Node) {
  if (!effect && ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect') effect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(parsed);
if (!effect) throw new Error('Library loading effect was not found.');
const effectSource = effect.getText(parsed);
const compiled = ts.transpileModule(`const load = ${effectSource}; export { load };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function library(overrides: Record<string, unknown> = {}) {
  const scope: Record<string, unknown> = {
    exports: {}, Promise, PAGE_SIZE: 20, offset: 0, query: '', tab: 'favourites', foodsOnly: false,
    items: [], generation: { current: 0 },
    setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout: vi.fn(), ...overrides,
  };
  for (const setter of [...new Set(effectSource.match(/\bset[A-Z]\w*(?=\()/g) ?? [])]) {
    const key = setter[3]!.toLowerCase() + setter.slice(4);
    scope[setter] = vi.fn((value: unknown) => { scope[key] = typeof value === 'function' ? value(scope[key]) : value; });
  }
  runInNewContext(compiled, scope);
  return { scope, load: (scope.exports as { load(): () => void }).load };
}

function page(total: number, prefix: string) {
  return vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({
    items: Array.from({ length: Math.max(0, Math.min(total - offset, limit)) }, (_, index) => ({
      id: `${prefix}-${offset + index}`, food: { id: `${prefix}-${offset + index}` }, isFavourite: true,
    })), hasMore: offset + limit < total,
  }));
}

describe('saved library loading interactions', () => {
  it('continues foods, recipes and meals independently past twenty favourites', async () => {
    const foods = page(35, 'food');
    const recipes = page(25, 'recipe');
    const meals = page(23, 'meal');
    const flow = library({ getFoodLibraryPage: foods, getFoodRecipePage: recipes, getMealPresetPage: meals });
    const cleanup = flow.load();
    await vi.waitFor(() => expect(flow.scope.loading).toBe(false));
    expect(flow.scope.items).toHaveLength(60);
    expect(flow.scope.hasMore).toBe(true);
    expect(foods).toHaveBeenCalledWith(expect.objectContaining({ kind: 'favourites', offset: 0, limit: 20 }));
    expect(recipes).toHaveBeenCalledWith(expect.objectContaining({ favouritesOnly: true }));
    expect(meals).toHaveBeenCalledWith(expect.objectContaining({ favouritesOnly: true }));
    cleanup();
    flow.scope.offset = 20;
    flow.load();
    await vi.waitFor(() => expect(flow.scope.loading).toBe(false));
    expect(flow.scope.items).toHaveLength(83);
    expect(flow.scope.hasMore).toBe(false);
    expect(new Set((flow.scope.items as { kind: string; value: { id: string } }[]).map(item => `${item.kind}:${item.value.id}`)).size).toBe(83);
  });

  it('limits an append picker to single foods even when favourites include recipes', async () => {
    const recipes = page(25, 'recipe');
    const meals = page(23, 'meal');
    const flow = library({ foodsOnly: true, getFoodLibraryPage: page(35, 'food'), getFoodRecipePage: recipes, getMealPresetPage: meals });
    flow.load();
    await vi.waitFor(() => expect(flow.scope.loading).toBe(false));
    expect(flow.scope.items).toHaveLength(20);
    expect(recipes).not.toHaveBeenCalled();
    expect(meals).not.toHaveBeenCalled();
  });

  it('ignores an old query response after a new query has completed', async () => {
    let finishOld!: (value: { items: unknown[]; hasMore: boolean }) => void;
    const oldRequest = new Promise<{ items: unknown[]; hasMore: boolean }>(resolve => { finishOld = resolve; });
    const foods = vi.fn().mockImplementationOnce(() => oldRequest).mockResolvedValue({ items: [{ food: { id: 'new' } }], hasMore: false });
    const flow = library({ foodsOnly: true, query: 'old', getFoodLibraryPage: foods });
    const cleanup = flow.load();
    cleanup();
    flow.scope.query = 'new';
    flow.load();
    await vi.waitFor(() => expect(flow.scope.loading).toBe(false));
    finishOld({ items: [{ food: { id: 'old' } }], hasMore: false });
    await oldRequest;
    await Promise.resolve();
    expect(flow.scope.items).toEqual([{ kind: 'food', value: { id: 'new' }, isFavourite: undefined }]);
  });
});
