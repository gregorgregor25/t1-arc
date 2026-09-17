import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discardFoodLabelPhoto, recognizeFoodLabelPhoto } from '@/data/food/foodLabelRecognition';

const fixture = vi.hoisted(() => ({
  files: new Set<string>(),
  constructed: [] as string[],
  removed: [] as string[],
  copyFailure: false,
  native: vi.fn(),
  platform: { OS: 'android' },
}));

vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/');
      fixture.constructed.push(this.uri);
    }
    get exists() { return fixture.files.has(this.uri); }
    copy(destination: File) {
      fixture.files.add(destination.uri);
      if (fixture.copyFailure) throw new Error('Temporary copy failed.');
    }
    delete() { fixture.removed.push(this.uri); fixture.files.delete(this.uri); }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/');
    }
    create() { /* In-memory owned directory. */ }
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///app/cache' } } };
});
vi.mock('expo-crypto', () => ({ randomUUID: () => '12345678-1234-1234-1234-123456789abc' }));
vi.mock('react-native', () => ({ Platform: fixture.platform }));
vi.mock('../modules/t1arc-food-label', () => ({ default: { recognizeAsync: fixture.native } }));

const cameraUri = 'file:///app/cache/Camera/abcdef12-abcd-abcd-abcd-abcdef123456.jpg';
const ownedUri = 'file:///app/cache/food-label-capture/label-12345678-1234-1234-1234-123456789abc.jpg';

beforeEach(() => {
  fixture.files.clear();
  fixture.constructed.length = 0;
  fixture.removed.length = 0;
  fixture.copyFailure = false;
  fixture.platform.OS = 'android';
  fixture.native.mockReset();
  fixture.native.mockResolvedValue({ lines: [{ text: 'Per 100 g' }, { text: 'Carbohydrate 20 g' }] });
});

describe('owned nutrition-label photo lifecycle', () => {
  it('removes the camera original before recognition and the owned copy after returning a review-only draft', async () => {
    fixture.files.add(cameraUri);
    fixture.native.mockImplementation(async (uri: string) => {
      expect(uri).toBe(ownedUri);
      expect(fixture.files.has(cameraUri)).toBe(false);
      expect(fixture.files.has(ownedUri)).toBe(true);
      return { lines: [{ text: 'Per 100 g' }, { text: 'Carbohydrate 20 g' }] };
    });
    const draft = await recognizeFoodLabelPhoto(cameraUri);
    expect(draft.fields.carbs).toBe(20);
    expect(fixture.files.size).toBe(0);
    expect(fixture.removed).toEqual([cameraUri, ownedUri]);
  });

  it('cleans both original and partially copied image when the copy fails', async () => {
    fixture.files.add(cameraUri);
    fixture.copyFailure = true;
    await expect(recognizeFoodLabelPhoto(cameraUri)).rejects.toThrow('Temporary copy failed.');
    expect(fixture.native).not.toHaveBeenCalled();
    expect(fixture.files.size).toBe(0);
  });

  it('cleans the owned copy after a deferred native failure without publishing a draft', async () => {
    fixture.files.add(cameraUri);
    let failNative!: (reason: Error) => void;
    fixture.native.mockReturnValue(new Promise((_resolve, reject) => { failNative = reject; }));
    const pending = recognizeFoodLabelPhoto(cameraUri);
    const rejected = expect(pending).rejects.toThrow('The label photo could not be read.');
    await vi.waitFor(() => expect(fixture.native).toHaveBeenCalledOnce());
    expect(fixture.files.has(cameraUri)).toBe(false);
    expect(fixture.files.has(ownedUri)).toBe(true);
    failNative(new Error('The label photo could not be read.'));
    await rejected;
    expect(fixture.files.size).toBe(0);
  });

  it('discards a captured original even when recognition is unavailable', async () => {
    fixture.files.add(cameraUri);
    fixture.platform.OS = 'ios';
    await expect(recognizeFoodLabelPhoto(cameraUri)).rejects.toThrow('unavailable');
    expect(fixture.native).not.toHaveBeenCalled();
    expect(fixture.files.size).toBe(0);
  });

  it.each([
    'file:///app/cache/Camera/../health.db',
    'file:///app/cache/Camera/%2e%2e%2fhealth.db',
    'file:///app/cache/Camera/nested/abcdef.jpg',
    'file:///app/cache/Camera/abcdef.png',
    'file:///app/cache/Camera-copy/abcdef.jpg',
    'file:///other/cache/Camera/abcdef.jpg',
    'content://camera/abcdef.jpg',
  ])('does not open or remove an unowned input URI: %s', async (uri) => {
    fixture.files.add(uri);
    await expect(recognizeFoodLabelPhoto(uri)).rejects.toThrow('new label photo');
    await discardFoodLabelPhoto(uri);
    expect(fixture.files.has(uri)).toBe(true);
    expect(fixture.constructed).toEqual([]);
    expect(fixture.removed).toEqual([]);
    expect(fixture.native).not.toHaveBeenCalled();
  });

  it('discard is idempotent and only removes the known camera output', async () => {
    fixture.files.add(cameraUri);
    const unrelated = 'file:///app/cache/report.pdf';
    fixture.files.add(unrelated);
    await discardFoodLabelPhoto(cameraUri);
    await discardFoodLabelPhoto(cameraUri);
    expect([...fixture.files]).toEqual([unrelated]);
    expect(fixture.removed).toEqual([cameraUri]);
  });
});
