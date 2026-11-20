import { describe, expect, it, vi } from 'vitest';

import { loadAapsCardSnapshot, type AapsCardSnapshotReader } from '@/data/aaps/aapsCardSnapshot';
import type { AapsContextObservation, AapsLocalStatus } from '@/data/aaps/types';
import type { GlucoseReading } from '@/domain/models';

const NOW = Date.UTC(2026, 10, 2, 12);
const status: AapsLocalStatus = { supported: true, selectedSourceId: 'aaps-local',
  writeEpoch: 4, selectionGeneration: 7, bufferedCount: 0 };
const context: AapsContextObservation = { id: 'capture', receivedAt: NOW,
  writeEpoch: 4, selectionGeneration: 7, reconciliationScope: 'local', iobUnits: -0.4, cobGrams: 0 };
const reading: GlucoseReading = { id: 'glucose', timestamp: NOW - 60_000,
  receivedAt: NOW, sourceId: 'aaps-local', mmolL: 6.2, quality: 'measured', trend: 'flat' };

function reader(): AapsCardSnapshotReader {
  return { status: vi.fn().mockResolvedValue(status), context: vi.fn().mockResolvedValue(context),
    latest: vi.fn().mockResolvedValue(reading), history: vi.fn().mockResolvedValue([reading]) };
}

describe('AAPS combined card snapshot', () => {
  it('drains context before reading only the selected local glucose and four-hour trace', async () => {
    const source = reader();
    const order: string[] = [];
    source.context = vi.fn(async () => { order.push('context'); return context; });
    source.latest = vi.fn(async () => { order.push('latest'); return reading; });
    const result = await loadAapsCardSnapshot(source);
    expect(order).toEqual(['context', 'latest']);
    expect(source.history).toHaveBeenCalledWith({ start: reading.timestamp - 4 * 3_600_000, end: reading.timestamp + 1 });
    expect(result).toMatchObject({ kind: 'aaps', reading, history: [reading], context });
  });

  it.each([
    { ...status, selectedSourceId: 'none' },
    { ...status, selectionGeneration: 9 },
    { ...status, writeEpoch: 5 },
    { ...status, supported: false },
  ])('rejects a switch or privacy epoch change during the encrypted reads', async (after) => {
    const source = reader();
    source.status = vi.fn().mockResolvedValueOnce(status).mockResolvedValueOnce(after);
    expect(await loadAapsCardSnapshot(source)).toEqual({ kind: 'changed' });
  });

  it.each([
    { ...context, reconciliationScope: 'restored' as const },
    { ...context, selectionGeneration: 6 },
    { ...context, writeEpoch: 3 },
  ])('never attaches archival or another session’s estimates', async (other) => {
    const source = reader();
    source.context = vi.fn().mockResolvedValue(other);
    expect(await loadAapsCardSnapshot(source)).toMatchObject({ kind: 'aaps', reading, context: undefined });
  });

  it('retains estimates without glucose and does not request an invented trace', async () => {
    const source = reader();
    source.latest = vi.fn().mockResolvedValue(undefined);
    expect(await loadAapsCardSnapshot(source)).toMatchObject({ kind: 'aaps', reading: undefined, history: [], context });
    expect(source.history).not.toHaveBeenCalled();
  });

  it('does not drain or query personal records for another glucose source', async () => {
    const source = reader();
    source.status = vi.fn().mockResolvedValue({ ...status, selectedSourceId: undefined });
    expect(await loadAapsCardSnapshot(source)).toEqual({ kind: 'other' });
    expect(source.context).not.toHaveBeenCalled();
    expect(source.latest).not.toHaveBeenCalled();
  });

  it('does not pass another source or restored glucose into the AAPS card', async () => {
    const source = reader();
    source.latest = vi.fn().mockResolvedValue({ ...reading, sourceId: 'aaps-restored' });
    source.history = vi.fn().mockResolvedValue([reading, { ...reading, sourceId: 'glooko-export' }]);
    expect(await loadAapsCardSnapshot(source)).toMatchObject({ kind: 'aaps', reading: undefined, history: [reading] });
  });

  it('fails the whole snapshot on a database error instead of returning partly fresh values', async () => {
    const source = reader();
    source.history = vi.fn().mockRejectedValue(new Error('encrypted read failed'));
    await expect(loadAapsCardSnapshot(source)).rejects.toThrow('encrypted read failed');
  });
});
