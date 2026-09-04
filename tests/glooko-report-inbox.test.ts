import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chooseGlookoReportInbox,
  clearGlookoReportInbox,
  getGlookoReportInboxStatus,
  scanGlookoReportInbox,
} from '@/data/glooko/glookoReportInbox';

const mocks = vi.hoisted(() => ({
  stored: null as string | null,
  directoryExists: true,
  directoryName: 'primary:Download',
  pickedUri: 'content://reports/tree/primary%3ADownload',
  entries: [] as {
    uri: string;
    name: string;
    type: string;
    exists: boolean;
    size: number;
    lastModified?: number | null;
  }[],
  cancelPicker: false,
  releasedUris: [] as string[],
  releaseSucceeds: true,
}));

vi.mock('../modules/t1arc-glooko-export', () => ({
  default: {
    releaseReportInboxAccessAsync: vi.fn(async (uri: string) => {
      mocks.releasedUris.push(uri);
      return mocks.releaseSucceeds;
    }),
  },
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => mocks.stored),
  setItemAsync: vi.fn(async (_key: string, value: string) => {
    mocks.stored = value;
  }),
  deleteItemAsync: vi.fn(async () => {
    mocks.stored = null;
  }),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: vi.fn(async (_algorithm: string, input: string) =>
    `snapshot:${input}`,
  ),
}));

vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    name: string;
    type: string;
    exists: boolean;
    size: number;
    lastModified: number | null;

    constructor(entry: (typeof mocks.entries)[number]) {
      this.uri = entry.uri;
      this.name = entry.name;
      this.type = entry.type;
      this.exists = entry.exists;
      this.size = entry.size;
      this.lastModified = entry.lastModified ?? null;
    }
  }

  class Directory {
    static async pickDirectoryAsync() {
      if (mocks.cancelPicker) throw new Error('cancelled');
      return new Directory(mocks.pickedUri);
    }

    uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists() {
      return mocks.directoryExists;
    }

    get name() {
      return mocks.directoryName;
    }

    list() {
      return mocks.entries.map((entry) => new File(entry));
    }
  }

  return { Directory, File };
});

describe('Glooko report inbox', () => {
  beforeEach(() => {
    mocks.stored = null;
    mocks.directoryExists = true;
    mocks.directoryName = 'primary:Download';
    mocks.entries = [];
    mocks.cancelPicker = false;
    mocks.releasedUris = [];
    mocks.releaseSucceeds = true;
  });

  it('persists an Android folder grant without exposing it in sync state', async () => {
    await expect(chooseGlookoReportInbox()).resolves.toMatchObject({
      configured: true,
      accessible: true,
      folderLabel: 'Download',
    });
    expect(JSON.parse(mocks.stored ?? '{}')).toMatchObject({
      uri: mocks.pickedUri,
    });
    await expect(getGlookoReportInboxStatus()).resolves.toMatchObject({
      configured: true,
      accessible: true,
    });
  });

  it('returns cancellation without replacing the previous folder', async () => {
    mocks.stored = JSON.stringify({
      uri: mocks.pickedUri,
      selectedAt: 123,
    });
    mocks.cancelPicker = true;
    await expect(chooseGlookoReportInbox()).resolves.toEqual({
      cancelled: true,
    });
    expect(JSON.parse(mocks.stored)).toMatchObject({ selectedAt: 123 });
    expect(mocks.releasedUris).toEqual([]);
  });

  it('releases the previous SAF grant when the selected folder changes', async () => {
    const previousUri = 'content://reports/tree/primary%3AOld';
    mocks.stored = JSON.stringify({ uri: previousUri, selectedAt: 123 });

    await expect(chooseGlookoReportInbox()).resolves.toMatchObject({
      configured: true,
    });

    expect(mocks.releasedUris).toEqual([previousUri]);
    expect(JSON.parse(mocks.stored ?? '{}')).toMatchObject({
      uri: mocks.pickedUri,
    });
  });

  it('keeps the previous folder and reports when Android cannot release its grant', async () => {
    const previousUri = 'content://reports/tree/primary%3AOld';
    mocks.stored = JSON.stringify({ uri: previousUri, selectedAt: 123 });
    mocks.releaseSucceeds = false;

    await expect(chooseGlookoReportInbox()).rejects.toThrow(
      'could not replace',
    );

    expect(JSON.parse(mocks.stored ?? '{}')).toMatchObject({
      uri: previousUri,
      selectedAt: 123,
    });
    expect(mocks.releasedUris).toEqual([previousUri, mocks.pickedUri]);
  });

  it('scans only readable PDFs within the safety limit, newest first', async () => {
    mocks.stored = JSON.stringify({
      uri: mocks.pickedUri,
      selectedAt: 123,
    });
    mocks.entries = [
      {
        uri: 'content://reports/old',
        name: 'glooko-old.pdf',
        type: 'application/pdf',
        exists: true,
        size: 1_000,
        lastModified: 10,
      },
      {
        uri: 'content://reports/new',
        name: 'new-report',
        type: 'application/pdf',
        exists: true,
        size: 2_000,
        lastModified: 20,
      },
      {
        uri: 'content://reports/text',
        name: 'notes.txt',
        type: 'text/plain',
        exists: true,
        size: 500,
        lastModified: 30,
      },
      {
        uri: 'content://reports/large',
        name: 'large.pdf',
        type: 'application/pdf',
        exists: true,
        size: 26 * 1024 * 1024,
        lastModified: 40,
      },
    ];
    await expect(scanGlookoReportInbox()).resolves.toMatchObject({
      status: 'ready',
      candidates: [
        { uri: 'content://reports/new' },
        { uri: 'content://reports/old' },
      ],
    });
  });

  it('reports a revoked folder grant and can forget the folder', async () => {
    mocks.stored = JSON.stringify({
      uri: mocks.pickedUri,
      selectedAt: 123,
    });
    mocks.directoryExists = false;
    await expect(scanGlookoReportInbox()).resolves.toMatchObject({
      status: 'unavailable',
    });
    await clearGlookoReportInbox();
    expect(mocks.releasedUris).toEqual([mocks.pickedUri]);
    await expect(getGlookoReportInboxStatus()).resolves.toEqual({
      configured: false,
      accessible: false,
    });
  });

  it('retains the folder metadata when its persisted grant cannot be released', async () => {
    mocks.stored = JSON.stringify({
      uri: mocks.pickedUri,
      selectedAt: 123,
    });
    mocks.releaseSucceeds = false;

    await expect(clearGlookoReportInbox()).rejects.toThrow(
      'could not be released',
    );
    expect(JSON.parse(mocks.stored ?? '{}')).toMatchObject({
      uri: mocks.pickedUri,
    });
  });
});
