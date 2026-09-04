import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(
    new URL(`../src/components/${name}`, import.meta.url),
    'utf8',
  );
}

function between(contents: string, start: string, end: string) {
  const startIndex = contents.indexOf(start);
  expect(startIndex, `Missing start anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  expect(endIndex, `Missing end anchor after: ${start}`).toBeGreaterThan(
    startIndex,
  );
  return contents.slice(startIndex, endIndex);
}

function betweenLast(contents: string, start: string, end: string) {
  const startIndex = contents.lastIndexOf(start);
  expect(startIndex, `Missing final start anchor: ${start}`).toBeGreaterThanOrEqual(
    0,
  );
  const endIndex = contents.indexOf(end, startIndex + start.length);
  expect(endIndex, `Missing end anchor after final: ${start}`).toBeGreaterThan(
    startIndex,
  );
  return contents.slice(startIndex, endIndex);
}

describe('source credential reveal lifecycle', () => {
  it.each([
    ['DexcomShareSourceCard.tsx', 'loadDexcomShareConnection'],
    ['MedtrumSourceCard.tsx', 'loadMedtrumConnection'],
  ])('hides the %s password whenever saved state is loaded', (name, loader) => {
    const contents = source(name);
    expect(between(contents, `void ${loader}()`, '.catch(')).toContain(
      'setPasswordVisible(false)',
    );
  });

  it.each([
    ['DexcomShareSourceCard.tsx', 'loadDexcomShareConnection'],
    ['MedtrumSourceCard.tsx', 'loadMedtrumConnection'],
  ])('does not overwrite an in-progress %s credential edit', (name, loader) => {
    const contents = source(name);
    const loadBlock = between(contents, `void ${loader}()`, '.catch(');
    expect(loadBlock).toContain('!editingDraft.current');
    expect(loadBlock).toContain('usernameDraft.current');
  });

  it.each([
    ['DexcomShareSourceCard.tsx', 'connectDexcomShare'],
    ['MedtrumSourceCard.tsx', 'connectMedtrum'],
  ])('hides the %s password after a successful save', (name, connector) => {
    const contents = source(name);
    expect(between(contents, `await ${connector}(`, '} catch (nextError)')).toContain(
      'setPasswordVisible(false)',
    );
  });

  it.each([
    ['DexcomShareSourceCard.tsx', 'disconnectDexcomShare'],
    ['MedtrumSourceCard.tsx', 'disconnectMedtrum'],
  ])('hides the %s password after disconnect', (name, disconnect) => {
    const contents = source(name);
    expect(between(contents, `await ${disconnect}()`, '} finally')).toContain(
      'setPasswordVisible(false)',
    );
  });

  it.each(['DexcomShareSourceCard.tsx', 'MedtrumSourceCard.tsx'])(
    'hides the %s password on update and cancel',
    (name) => {
      const contents = source(name);
      expect(
        between(contents, 'label="Update connection"', 'updateEditing(true)'),
      ).toContain('setPasswordVisible(false)');
      expect(
        between(
          contents,
          'function restoreSavedDraft()',
          'updateEditing(false)',
        ),
      ).toContain('setPasswordVisible(false)');
    },
  );

  it('hides both Nightscout secrets on load, save, update, cancel and disconnect', () => {
    const contents = source('NightscoutSourceCard.tsx');
    const lifecycleBlocks = [
      between(contents, 'void loadNightscoutConnection()', '.catch('),
      between(contents, 'await connectNightscout(', '} catch (nextError)'),
      between(contents, 'await disconnectNightscout()', '} catch (nextError)'),
      between(contents, '<View style={styles.actionRow}>', 'setEditing(true)'),
      betweenLast(
        contents,
        'const draft = nightscoutDraftFromSaved(saved);',
        'setError(undefined)',
      ),
    ];

    for (const block of lifecycleBlocks) {
      expect(block).toContain('setTokenVisible(false)');
      expect(block).toContain('setSecretVisible(false)');
    }
  });
});
