import { describe, expect, it, vi } from 'vitest';

import {
  pruneRetainedGlookoSources,
  selectRetainedGlookoSources,
} from '@/data/glooko/glookoSourceRetention';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';

describe('Glooko retained source policy', () => {
  it('keeps the newest sources and an earliest-coverage recovery archive within one byte budget', () => {
    const selected = selectRetainedGlookoSources(
      [
        {
          id: 'report:new',
          kind: 'report',
          byteLength: 30,
          storedAt: 500,
          dataThrough: 500,
        },
        {
          id: 'report:previous',
          kind: 'report',
          byteLength: 20,
          storedAt: 400,
          dataThrough: 400,
        },
        {
          id: 'archive:new',
          kind: 'archive',
          byteLength: 40,
          storedAt: 500,
          dataStart: 300,
          dataThrough: 500,
        },
        {
          id: 'archive:middle',
          kind: 'archive',
          byteLength: 20,
          storedAt: 400,
          dataStart: 200,
          dataThrough: 400,
        },
        {
          id: 'archive:baseline',
          kind: 'archive',
          byteLength: 20,
          storedAt: 300,
          dataStart: 100,
          dataThrough: 300,
        },
      ],
      { maxBytes: 90, maxArchives: 3, maxReports: 2 },
    );

    expect([...selected.retainedIds]).toEqual([
      'report:new',
      'archive:new',
      'archive:baseline',
    ]);
    expect(selected.totalBytes).toBe(90);
  });

  it('applies count limits even when many tiny rolling files fit', () => {
    const selected = selectRetainedGlookoSources(
      [
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `archive:${index}`,
          kind: 'archive' as const,
          byteLength: 1,
          storedAt: index,
          dataStart: index,
          dataThrough: index,
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `report:${index}`,
          kind: 'report' as const,
          byteLength: 1,
          storedAt: index,
          dataStart: index,
          dataThrough: index,
        })),
      ],
      { maxBytes: 100, maxArchives: 3, maxReports: 2 },
    );

    expect(
      [...selected.retainedIds].filter((id) => id.startsWith('archive:')),
    ).toHaveLength(3);
    expect(
      [...selected.retainedIds].filter((id) => id.startsWith('report:')),
    ).toHaveLength(2);
  });

  it('bounds retained archives without deleting parsed import batches', async () => {
    const store = new MemoryHealthRecordStore();
    for (let index = 0; index < 5; index += 1) {
      await store.writeImport(
        {
          id: `glooko-export:batch-${index}`,
          sourceId: 'glooko-export',
          fileName: `export-${index}.zip`,
          fileSha256: `batch-${index}`,
          importedAt: index + 1,
          dataStart: index + 1,
          dataThrough: index + 2,
          skippedCount: 0,
          warnings: [],
        },
        [],
        [],
        [],
        {
          format: 'zip',
          bytes: new Uint8Array([index + 1]),
          entries: [],
        },
      );
    }

    expect(await store.getImportSourceSummary('glooko-export')).toMatchObject({
      archiveCount: 3,
      totalBytes: 3,
      dataStart: 1,
      dataThrough: 6,
    });
    expect(
      (await store.getLatestImport('glooko-export'))?.fileName,
    ).toBe('export-4.zip');
  });

  it('deletes only raw payload rows and clears duplicate extracted PDF text', async () => {
    const runAsync = vi.fn(async (..._args: unknown[]) => ({ changes: 1 }));
    const database = {
      getAllAsync: vi.fn(async <T>(query: string): Promise<T[]> => {
        if (query.includes('FROM import_source_payloads')) {
          return Array.from({ length: 5 }, (_, index) => ({
            id: `archive-${index}`,
            byte_length: 1024,
            stored_at_ms: index,
            data_start_ms: index,
            data_through_ms: index,
          })) as unknown as T[];
        }
        return Array.from({ length: 4 }, (_, index) => ({
          id: `report-${index}`,
          byte_length: 1024,
          imported_at_ms: index,
          report_start_ms: index,
          report_end_ms: index,
          preview_json: JSON.stringify(
            index === 3
              ? { subjectFingerprint: `rs1_${'a'.repeat(64)}` }
              : {},
          ),
        })) as unknown as T[];
      }),
      runAsync,
    };

    const result = await pruneRetainedGlookoSources(
      database as unknown as Parameters<typeof pruneRetainedGlookoSources>[0],
    );

    expect(result).toMatchObject({
      removedArchives: 2,
      removedReports: 2,
      retainedBytes: 5 * 1024,
    });
    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining("SET extracted_text = ''"),
      'glooko-export',
    );
    expect(runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO app_metadata'),
      'glooko-report-subject-fingerprint-v1',
      `rs1_${'a'.repeat(64)}`,
    );
    expect(
      runAsync.mock.calls.some(([query]) =>
        String(query).includes('DELETE FROM import_batches'),
      ),
    ).toBe(false);
    expect(
      runAsync.mock.calls.some(([query]) =>
        String(query).includes('DELETE FROM import_raw_records'),
      ),
    ).toBe(false);
  });
});
