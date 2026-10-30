import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCycleTracking } from '@/data/cycleTracking';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  getFirst: vi.fn(),
}));

vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('@/data/persistence/t1arcDatabase', () => ({
  openT1ArcDatabase: vi.fn(async () => ({ getAllAsync: mocks.getAll, getFirstAsync: mocks.getFirst })),
}));

const importedRows = [
  { id: 'a', kind: 'menstruation_flow', start_ms: Date.parse('2026-02-01T12:00:00Z'), end_ms: Date.parse('2026-02-01T13:00:00Z'), payload_json: '{"flow":3}', source_package: 'source.a', display_name: 'A' },
  { id: 'b', kind: 'menstruation_flow', start_ms: Date.parse('2026-02-01T12:00:00Z'), end_ms: Date.parse('2026-02-01T13:00:00Z'), payload_json: '{"flow":1}', source_package: 'source.b', display_name: 'B' },
];

describe('cycle import reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAll.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM cycle_periods')) return [];
      if (sql.includes('FROM cycle_days')) return [{ date: '2026-02-01', flow: null, symptoms_json: '["Cramp"]', notes: 'Private note' }];
      return importedRows;
    });
  });

  it('does not load Health Connect cycle records without explicit category enablement', async () => {
    mocks.getFirst.mockResolvedValue(null);
    const snapshot = await loadCycleTracking();
    expect(snapshot.days).toHaveLength(1);
    expect(snapshot.days[0]?.flow).toBeUndefined();
    expect(mocks.getAll.mock.calls.some(([sql]) => sql.includes('FROM health_connect_records'))).toBe(false);
  });

  it('uses only the preferred source and combines imported flow with manual notes', async () => {
    mocks.getFirst.mockResolvedValue({ enabled: 1, preferred_source_package: 'source.b' });
    const snapshot = await loadCycleTracking();
    expect(snapshot.days).toEqual([{
      date: '2026-02-01', flow: 'light', flowSource: 'health-connect', symptoms: ['Cramp'],
      notes: 'Private note', source: 'manual', readOnly: false,
    }]);
  });

  it('chooses one automatic source when enabled with no locked source', async () => {
    mocks.getFirst.mockResolvedValue({ enabled: 1, preferred_source_package: null });
    const snapshot = await loadCycleTracking();
    expect(snapshot.days).toHaveLength(1);
    expect(['light', 'heavy']).toContain(snapshot.days[0]?.flow);
  });

  it('uses the recorded zone offset for imported historical dates', async () => {
    mocks.getFirst.mockResolvedValue({ enabled: 1, preferred_source_package: 'source.a' });
    mocks.getAll.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM cycle_periods') || sql.includes('FROM cycle_days')) return [];
      return [{
        ...importedRows[0], start_ms: Date.parse('2026-02-02T01:00:00Z'),
        end_ms: Date.parse('2026-02-02T01:00:00Z'),
        payload_json: '{"flow":3,"startZoneOffsetSeconds":-18000}',
      }];
    });
    const snapshot = await loadCycleTracking();
    expect(snapshot.days[0]?.date).toBe('2026-02-01');
  });

  it('uses the start offset for a period end when Health Connect omits its end offset', async () => {
    mocks.getFirst.mockResolvedValue({ enabled: 1, preferred_source_package: 'source.a' });
    mocks.getAll.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM cycle_periods') || sql.includes('FROM cycle_days')) return [];
      return [{
        ...importedRows[0], id: 'period-a', kind: 'menstruation_period',
        start_ms: Date.parse('2026-02-02T01:00:00Z'),
        end_ms: Date.parse('2026-02-03T03:00:00Z'),
        payload_json: '{"startZoneOffsetSeconds":-18000,"endZoneOffsetSeconds":null}',
      }];
    });
    const snapshot = await loadCycleTracking();
    expect(snapshot.periods[0]).toMatchObject({ startDate: '2026-02-01', endDate: '2026-02-02' });
  });
});
