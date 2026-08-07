import { describe, expect, it } from 'vitest';

import { DexcomImportLifecycle } from '@/data/import/dexcomImportLifecycle';

describe('Dexcom import byte lifecycle', () => {
  it('wipes bytes returned after the picker UI has unmounted', () => {
    const lifecycle = new DexcomImportLifecycle();
    lifecycle.activate();
    const generation = lifecycle.beginSelection();
    lifecycle.dispose();
    const bytes = Uint8Array.from([1, 2, 3]);

    expect(lifecycle.isCurrent(generation)).toBe(false);
    expect(lifecycle.trackPreparation(bytes)).toBe(false);
    expect([...bytes]).toEqual([0, 0, 0]);
  });

  it('defers wiping parser-owned bytes until the late task settles', () => {
    const lifecycle = new DexcomImportLifecycle();
    lifecycle.activate();
    const bytes = Uint8Array.from([4, 5, 6]);

    expect(lifecycle.trackPreparation(bytes)).toBe(true);
    lifecycle.dispose();
    expect([...bytes]).toEqual([4, 5, 6]);

    lifecycle.release(bytes);
    expect([...bytes]).toEqual([0, 0, 0]);
  });

  it('wipes a retained preview immediately on unmount', () => {
    const lifecycle = new DexcomImportLifecycle();
    lifecycle.activate();
    const bytes = Uint8Array.from([7, 8, 9]);

    lifecycle.trackPreparation(bytes);
    expect(lifecycle.retainPreview(bytes)).toBe(true);
    lifecycle.dispose();

    expect([...bytes]).toEqual([0, 0, 0]);
  });

  it('keeps import-owned bytes intact until the database call settles', () => {
    const lifecycle = new DexcomImportLifecycle();
    lifecycle.activate();
    const bytes = Uint8Array.from([10, 11, 12]);

    lifecycle.trackPreparation(bytes);
    lifecycle.retainPreview(bytes);
    expect(lifecycle.beginImport(bytes)).toBe(true);
    expect(lifecycle.beginImport(bytes)).toBe(false);
    lifecycle.dispose();
    expect([...bytes]).toEqual([10, 11, 12]);

    lifecycle.release(bytes);
    expect([...bytes]).toEqual([0, 0, 0]);
  });
});
