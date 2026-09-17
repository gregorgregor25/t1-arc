import { describe, expect, it, vi } from 'vitest';
import { zonedWallClockCandidates } from '@/domain/time';
import { parseGlookoTextFiles } from '@/data/import/glookoCsv';

describe('regional timestamp calculation cost', () => {
  it('measures repeated five-minute timestamps without changing their instants', () => {
    const format = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    try {
      for (let index = 0; index < 288; index += 1) {
        const candidates = zonedWallClockCandidates('2026-06-08', Math.floor(index / 12), (index % 12) * 5, 0, 'Europe/London');
        expect(candidates).toEqual([Date.parse('2026-06-07T23:00:00Z') + index * 300_000]);
      }
      console.info(`T1ArcTimeCalculationCount records=288 formatter_calls=${format.mock.calls.length}`);
      expect(format.mock.calls.length).toBeLessThan(1600);
    } finally {
      format.mockRestore();
    }
  });

  it('retains exact instants through an autumn rollback in a large ordered export', () => {
    const start = Date.parse('2026-10-01T00:00:00Z');
    const rows = 33 * 288;
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      second: '2-digit', hourCycle: 'h23' });
    const text = ['Timestamp,Glucose Value (mmol/L),Serial number',
      ...Array.from({ length: rows }, (_, index) => `${formatter.format(start + index * 300_000).replace(',', '')},6.5,FIXTURE`)].join('\n');
    const preview = parseGlookoTextFiles([{ name: 'cgm_data_1.csv', text }], start + rows * 300_000,
      { timeZone: 'Europe/London', dateOrder: 'day-first' });
    expect(preview.unsafeTimestampLocale).toBe(false);
    expect(preview.glucose).toHaveLength(rows);
    expect(preview.glucose.every((reading, index) => reading.timestamp === start + index * 300_000)).toBe(true);
    expect(new Set(preview.glucose.map((reading) => reading.id)).size).toBe(rows);
  }, 30_000);
});
