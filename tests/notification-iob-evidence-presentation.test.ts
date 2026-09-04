import { describe, expect, it } from 'vitest';

import { notificationIobEvidenceRows } from '@/components/notificationIobEvidencePresentation';

describe('notification IOB evidence presentation', () => {
  it('returns only privacy-safe provenance fields and preserves zero', () => {
    const rows = notificationIobEvidenceRows([
      {
        id: 'notification-observation:v2:native:123',
        sourceId: 'android-notification:com.insulet.myblue.pdm',
        packageName: 'com.insulet.myblue.pdm',
        sourceLabel: 'Omnipod 5',
        capturedAt: 123,
        iobUnits: 0,
        origin: 'restored',
        payload_json: 'SECRET-NOTIFICATION-TEXT',
      } as never,
    ]);

    expect(rows).toEqual([
      {
        id: 'notification-observation:v2:native:123',
        title: 'Omnipod 5 notification',
        sourceId: 'android-notification:com.insulet.myblue.pdm',
        packageName: 'com.insulet.myblue.pdm',
        capturedAt: 123,
        iobLabel: '0 U IOB',
        provenance: 'Restored from a T1 Arc backup; original notification capture time shown. T1 Arc did not calculate or interpolate this IOB value.',
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain('SECRET-NOTIFICATION-TEXT');
    expect(JSON.stringify(rows)).not.toContain('payload_json');
  });

  it('describes local, restored and pre-provenance records without overstating trust', () => {
    const base = {
      id: 'notification-observation:v2:native:123',
      sourceId: 'android-notification:com.insulet.myblue.pdm',
      packageName: 'com.insulet.myblue.pdm',
      sourceLabel: 'Omnipod 5',
      capturedAt: 123,
      iobUnits: 1.25,
    };

    const rows = notificationIobEvidenceRows([
      { ...base, id: 'local', origin: 'local' },
      { ...base, id: 'restored', origin: 'restored' },
      { ...base, id: 'unknown', origin: 'unknown' },
    ]);

    expect(rows[0]?.provenance).toContain('captured on this phone');
    expect(rows[1]?.provenance).toContain('Restored from a T1 Arc backup');
    expect(rows[2]?.provenance).toContain('predates provenance tracking');
    expect(rows[2]?.provenance).toContain('cannot verify whether it was captured');
    expect(rows[2]?.provenance).not.toMatch(/^Restored from/);
  });
});
