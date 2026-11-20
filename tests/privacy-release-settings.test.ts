import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createLibreDraftRetention } from '@/screens/settings/libreDraftRetention';

const source = ts.createSourceFile(
  'SettingsPages.tsx',
  readFileSync('src/screens/settings/SettingsPages.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function componentInstances(name: string) {
  const matches: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === name) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return matches;
}

function enclosingConditions(node: ts.Node) {
  const conditions: ts.ConditionalExpression[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isConditionalExpression(parent)) conditions.push(parent);
  }
  return conditions;
}

describe('release backup settings', () => {
  it('clears the unsaved Libre sign-in before reopening the form after a successful erase', () => {
    const resetForm = vi.fn(() => expect(retention.read()).toBeUndefined());
    const retention = createLibreDraftRetention(resetForm);
    const draft = { email: 'tester@example.invalid', password: 'sample input', topLevelDomain: 'io' as const };
    retention.write(draft);
    expect(retention.read()).toEqual(draft);
    retention.clearAfterErase();
    expect(resetForm).toHaveBeenCalledOnce();
    expect(retention.read()).toBeUndefined();
    const controls = componentInstances('LocalDataControlCard')[0]!.getText(source);
    expect(controls).toContain('onErased={() => libreDraft?.clearAfterErase()}');
    expect(controls).toContain('hasUnsavedSignIn={Boolean(libreDraft?.read())}');
  });

  it('keeps the whole earlier-test migration disclosure development-only', () => {
    const cards = componentInstances('MaintainerMigrationCard');
    expect(cards).toHaveLength(1);
    const guard = enclosingConditions(cards[0]!).find(
      condition => condition.condition.getText(source) === '__DEV__',
    );
    expect(guard).toBeDefined();
    expect(guard!.whenFalse.kind).toBe(ts.SyntaxKind.NullKeyword);
    expect(guard!.whenTrue.getText(source)).toContain('title="Earlier test-app migration"');
    expect(guard!.whenTrue.getText(source)).toContain('<MaintainerMigrationCard');
  });

  it.each(['EncryptedBackupCard', 'LocalDataControlCard', 'PrivacyPolicyLink'])(
    'keeps %s available outside development-only controls', name => {
      const cards = componentInstances(name);
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(enclosingConditions(card).some(
          condition => condition.condition.getText(source).includes('__DEV__'),
        )).toBe(false);
      }
    },
  );
});
