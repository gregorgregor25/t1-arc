import { describe, expect, it } from 'vitest';
import { mergeSerializedNotebooks, parseNotebook, type NotebookEntry } from '@/domain/personalNotebook';

const entry: NotebookEntry = { id: 'note', title: 'Question', answer: '', note: '', createdAt: 1_780_000_000_000,
  ownerIdentity: 'owner', dataMode: 'live', limitations: [], evidence: [] };
const largeEntry = (id: string): NotebookEntry => ({ ...entry, id, answer: 'a'.repeat(40_000), limitations: Array.from({ length: 100 }, () => 'a'.repeat(8_000)) });

describe('notebook portable validation', () => {
  it('rejects oversized local saves before they can make backups unrestorable', () => {
    expect(() => parseNotebook({ version: 1, entries: Array.from({ length: 10 }, (_, i) => largeEntry(String(i))) })).toThrow(/full/);
  });
  it('rejects an oversized merge without dropping saved items', () => {
    const left = JSON.stringify({ version: 1, entries: Array.from({ length: 5 }, (_, i) => largeEntry(`left${i}`)) });
    const right = JSON.stringify({ version: 1, entries: Array.from({ length: 5 }, (_, i) => largeEntry(`right${i}`)) });
    expect(() => mergeSerializedNotebooks(left, right)).toThrow(/too large/);
    expect(JSON.parse(left).entries).toHaveLength(5);
  });
  it('drops unknown imported fields at every retained chart level', () => {
    const parsed = parseNotebook({ version: 1, entries: [{ ...entry, extra: 'not retained', glucoseTrace: {
      range: { start: entry.createdAt, end: entry.createdAt + 60_000, extra: 'not retained' }, maximumGapMs: 720_000,
      points: [{ timestamp: entry.createdAt, mmolL: 6.5, extra: 'not retained' }], extra: 'not retained',
    } }] });
    expect(JSON.stringify(parsed)).not.toContain('extra');
  });
});
