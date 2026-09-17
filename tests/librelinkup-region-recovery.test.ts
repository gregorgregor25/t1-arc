import { describe, expect, it, vi } from 'vitest';
import { LibreLinkUpClient } from '@/data/libreLinkUp/LibreLinkUpClient';
import type { LibreLinkUpSession } from '@/data/libreLinkUp/types';

const credentials = { email: 'follower@example.com', password: 'test-only', topLevelDomain: 'io' as const };
const measurement = { FactoryTimestamp: '9/16/2026 10:30:00 PM', ValueInMgPerDl: 180, TrendArrow: 3 };
const connections = { status: 0, data: [{ patientId: 'patient-1', glucoseMeasurement: measurement }] };
const graph = { status: 0, data: { graphData: [measurement] } };
const redirect = (region: unknown) => ({ status: 0, data: { redirect: true, region } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(responses: Response[], region = '') {
  const queue = [...responses];
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error('Unexpected request');
    return next;
  });
  const saved: LibreLinkUpSession[] = [];
  const client = new LibreLinkUpClient(credentials, async () => 'account-hash', fetchMock, {
    token: 'saved-token', expiresAt: Date.now() + 3_600_000, userId: 'user-1', region,
    version: '4.17.0', accountEmail: credentials.email, patientId: 'patient-1',
  }, session => { saved.push(session); });
  return { client, fetchMock, saved };
}

describe('LibreLinkUp regional recovery during data requests', () => {
  it('follows the VPN-style connections redirect without signing in again and remembers the route', async () => {
    const { client, fetchMock, saved } = setup([
      response(redirect('eu')), response(connections), response(graph),
      response(connections), response(graph),
    ]);
    const snapshot = await client.getSnapshot();
    await client.getSnapshot();
    expect(snapshot.readings.at(-1)?.mmolL).toBe(10);
    expect(snapshot.session).toMatchObject({ region: 'eu', token: 'saved-token', patientId: 'patient-1' });
    expect(saved.some(session => session.region === 'eu')).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.libreview.io/llu/connections',
      'https://api-eu.libreview.io/llu/connections',
      'https://api-eu.libreview.io/llu/connections/patient-1/graph',
      'https://api-eu.libreview.io/llu/connections',
      'https://api-eu.libreview.io/llu/connections/patient-1/graph',
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer saved-token', 'Account-Id': 'account-hash' } });
      expect(options?.body).toBeUndefined();
    }
  });

  it('also follows a graph redirect while preserving the selected patient', async () => {
    const { client, fetchMock } = setup([response(connections), response(redirect('eu2')), response(graph)], 'eu');
    expect((await client.getSnapshot()).selectedPatientId).toBe('patient-1');
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('https://api-eu2.libreview.io/llu/connections/patient-1/graph');
  });

  it.each([undefined, '', 'https://other.example', 'eu/../../other', 'eu.example', 42])('rejects an invalid region %s without forwarding credentials', async region => {
    const { client, fetchMock } = setup([response(redirect(region))]);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: 'invalid-response', message: 'LibreLinkUp returned an invalid account region.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getSession().region).toBe('');
  });

  it('stops a redirect to the same region immediately', async () => {
    const { client, fetchMock } = setup([response(redirect('eu'))], 'eu');
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: 'invalid-response', message: expect.stringContaining('regional server') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds alternating region redirects', async () => {
    const { client, fetchMock } = setup([response(redirect('eu')), response(redirect('eu2')), response(redirect('eu'))]);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [429, 0, 'rate-limited'],
    [200, 4, 'action-required'],
    [200, 2, 'invalid-credentials'],
    [503, 0, 'network'],
  ])('honours HTTP %s / account status %s before any redirect', async (httpStatus, status, code) => {
    const { client, fetchMock } = setup([response({ ...redirect('eu'), status }, httpStatus)]);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not treat a false redirect marker as an instruction', async () => {
    const { client, fetchMock } = setup([response({ status: 0, data: { redirect: false, region: 'eu' } })]);
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: 'invalid-response', message: expect.stringContaining('patient connection list') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can renew an actually rejected token after following a redirect', async () => {
    const { client, fetchMock } = setup([
      response(redirect('eu')), response({}, 401),
      response({ status: 0, data: { user: { id: 'user-1' }, authTicket: { token: 'renewed', expires: 4_102_444_800 } } }),
      response(connections), response(graph),
    ]);
    const snapshot = await client.getSnapshot();
    expect(snapshot.session.token).toBe('renewed');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/login'))).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
