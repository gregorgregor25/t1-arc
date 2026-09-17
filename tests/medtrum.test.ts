import { describe, expect, it } from 'vitest';

import {
  medtrumDraftFromSaved,
  normalizeMedtrumConnection,
  resolveMedtrumDraftConnection,
} from '@/data/medtrum/connection';
import {
  MedtrumGlucoseSource,
  medtrumGlucoseMmolL,
} from '@/data/medtrum/MedtrumGlucoseSource';
import { MEDTRUM_SOURCE_ID } from '@/data/medtrum/types';
import { MemoryGlucoseHistoryStore } from '@/data/persistence/GlucoseHistoryStore';

describe('Medtrum EasyFollow connection', () => {
  it('uses the explicit account unit instead of guessing from the value', () => {
    expect(medtrumGlucoseMmolL(126, 'mgDl')).toBeCloseTo(6.99, 2);
    expect(medtrumGlucoseMmolL(20, 'mmolL')).toBe(20);
    expect(medtrumGlucoseMmolL(20, 'mgDl')).toBeCloseTo(1.11, 2);
  });

  it('requires a distinct follower username and password', () => {
    expect(() => normalizeMedtrumConnection('', '', 'eu')).toThrowError(
      expect.objectContaining({ code: 'invalid-connection' }),
    );
  });

  it('reuses password and patient only for the same normalized account identity', () => {
    const saved = normalizeMedtrumConnection(
      'follower',
      'protected',
      'eu',
      'patient-one',
      'Alex',
    );
    expect(
      resolveMedtrumDraftConnection({
        saved,
        username: ' follower ',
        password: '',
        region: 'eu',
      }),
    ).toMatchObject({
      password: 'protected',
      patientId: 'patient-one',
      patientName: 'Alex',
    });
    expect(() =>
      resolveMedtrumDraftConnection({
        saved,
        username: 'different-follower',
        password: '',
        region: 'eu',
      }),
    ).toThrowError('Enter the password');
    expect(
      resolveMedtrumDraftConnection({
        saved,
        username: 'different-follower',
        password: 'new-password',
        region: 'fr',
      }),
    ).toEqual({
      username: 'different-follower',
      password: 'new-password',
      region: 'fr',
      glucoseUnit: 'mmolL',
      patientId: undefined,
      patientName: undefined,
    });
    expect(medtrumDraftFromSaved(saved)).toEqual({
      username: 'follower',
      password: '',
      region: 'eu',
      glucoseUnit: 'mmolL',
      patients: [],
    });
  });

  it('authenticates, chooses a sole followed patient and imports current plus graph data', async () => {
    const now = Date.UTC(2026, 7, 14, 14, 0);
    const patientId = 'patient@example.test';
    const requested: string[] = [];
    const responses = [
      new Response(JSON.stringify({ res: 'OK' }), {
        status: 200,
        headers: { 'Set-Cookie': 'session=protected; Path=/; HttpOnly' },
      }),
      new Response(
        JSON.stringify({
          res: 'OK',
          monitorlist: [{ username: patientId, real_name: 'Alex' }],
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          res: 'OK',
          monitorlist: [
            {
              username: patientId,
              real_name: 'Alex',
              sensor_status: {
                glucose: 7.1,
                glucoseRate: 8,
                updateTime: (now - 2 * 60_000) / 1000,
                serial: 255,
                sensorId: 23,
                sequence: 700,
              },
            },
          ],
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          res: 'OK',
          data: [['record', (now - 10 * 60_000) / 1000, 6.7, 6.8, 'C', 0]],
        }),
        { status: 200 },
      ),
    ];
    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requested.push(`${String(input)} ${JSON.stringify(init?.headers ?? {})}`);
      return responses.shift()!;
    }) as typeof fetch;
    const store = new MemoryGlucoseHistoryStore();
    const source = new MedtrumGlucoseSource(
      { username: 'follower', password: 'secret', region: 'eu' },
      store,
      fetcher,
      () => now,
    );

    const result = await source.verifyConnection();

    expect(result.connection).toMatchObject({
      patientId,
      patientName: 'Alex',
    });
    expect(result.latest).toMatchObject({
      mmolL: 7.1,
      trend: 'flat',
      sourceId: MEDTRUM_SOURCE_ID,
      sourceDeviceId: '000000FF-23',
    });
    expect(requested[2]).toContain('session=protected');
    expect(requested[3]).toContain('/mobile/ajax/download?flag=sg');
    await expect(
      store.getReadings(
        { start: now - 60 * 60_000, end: now },
        MEDTRUM_SOURCE_ID,
      ),
    ).resolves.toHaveLength(2);
  });

  it('returns a patient choice before storing a multi-patient connection', async () => {
    const responses = [
      new Response(JSON.stringify({ res: 'OK' }), {
        status: 200,
        headers: { 'Set-Cookie': 'session=protected; Path=/' },
      }),
      new Response(
        JSON.stringify({
          res: 'OK',
          monitorlist: [
            { username: 'one', real_name: 'One' },
            { username: 'two', real_name: 'Two' },
          ],
        }),
        { status: 200 },
      ),
    ];
    const source = new MedtrumGlucoseSource(
      { username: 'follower', password: 'secret', region: 'eu' },
      new MemoryGlucoseHistoryStore(),
      (async () => responses.shift()!) as typeof fetch,
    );
    const result = await source.verifyConnection();
    expect(result.patients.map((patient) => patient.name)).toEqual([
      'One',
      'Two',
    ]);
    expect(result.connection).toBeUndefined();
  });
});
