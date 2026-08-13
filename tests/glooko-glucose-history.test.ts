import { describe, expect, it } from 'vitest';

import {
  clearGlookoGlucoseHistory,
  writeGlookoGlucoseHistory,
} from '@/data/import/glookoGlucoseImport';
import {
  GLOOKO_CGM_SOURCE_ID,
  parseGlookoTextFiles,
} from '@/data/import/glookoCsv';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';
import { strToU8 } from 'fflate';

const IMPORTED_AT = Date.parse('2026-07-26T08:00:00+01:00');

describe('Glooko historical glucose persistence', () => {
  it('is idempotent and can be removed without touching live history', async () => {
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings([
      {
        id: 'notification:1',
        sourceId: 'notification',
        timestamp: IMPORTED_AT,
        receivedAt: IMPORTED_AT,
        mmolL: 6.5,
        trend: 'flat',
        quality: 'measured',
      },
    ]);
    const readings = parseGlookoTextFiles(
      [
        {
          name: 'cgm_data_1.csv',
          text: `Timestamp,Glucose Value (mmol/L)
2026-07-25 08:00:00,6.2
2026-07-25 08:05:00,6.4`,
        },
      ],
      IMPORTED_AT,
    ).glucose;

    await expect(writeGlookoGlucoseHistory(store, readings)).resolves.toBe(2);
    await expect(writeGlookoGlucoseHistory(store, readings)).resolves.toBe(0);
    await expect(
      store.getBounds(GLOOKO_CGM_SOURCE_ID),
    ).resolves.toMatchObject({ count: 2 });
    await expect(clearGlookoGlucoseHistory(store)).resolves.toBe(2);
    await expect(store.getBounds()).resolves.toMatchObject({ count: 1 });
  });

  it('streams a large byte-backed CGM file and recognises export variants', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => {
      const timestamp = new Date(Date.UTC(2026, 5, 1) + index * 5 * 60_000)
        .toISOString()
        .replace('T', ' ')
        .replace('.000Z', '');
      return `${timestamp},${index === 0 ? '<90' : 90},SN-${index}`;
    });
    const bytes = strToU8(
      `Date and Time,CGM Value (mg/dL),Device Serial Number\n${rows.join(
        '\n',
      )}`,
    );
    expect(bytes.byteLength).toBeGreaterThan(256 * 1024);

    const preview = parseGlookoTextFiles(
      [{ name: 'cgm_data_1.csv', bytes }],
      IMPORTED_AT,
    );

    expect(preview.glucose).toHaveLength(10_000);
    expect(preview.glucose[0]).toMatchObject({
      quality: 'estimated',
      sourceDeviceId: 'SN-0',
    });
    expect(preview.glucose[0]!.mmolL).toBeCloseTo(90 / 18.016, 2);
  });

  it('preserves same-time readings from separate source devices', async () => {
    const readings = parseGlookoTextFiles(
      [
        {
          name: 'cgm_data_1.csv',
          text: `Timestamp,Glucose Value (mmol/L),Device Serial Number
2026-07-25 08:00:00,6.2,SENSOR-A
2026-07-25 08:00:00,6.4,SENSOR-B`,
        },
      ],
      IMPORTED_AT,
    ).glucose;

    expect(readings).toHaveLength(2);
    expect(new Set(readings.map((reading) => reading.id)).size).toBe(2);
    const store = new MemoryGlucoseHistoryStore();
    await store.upsertReadings(readings);
    await expect(store.getBounds(GLOOKO_CGM_SOURCE_ID)).resolves.toMatchObject({
      count: 2,
    });
  });
});
