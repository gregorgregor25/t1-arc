import { describe, expect, it, vi } from 'vitest';

import { digestLibreLinkUpOwnerIdentity } from '@/data/libreLinkUp/secureStore';
import { commitVerifiedLibreLinkUp } from '@/data/libreLinkUp/connectLibreLinkUp';

const crypto = vi.hoisted(() => ({
  digestStringAsync: vi.fn(async (_algorithm: string, material: string) =>
    material.padEnd(64, '0').slice(0, 64),
  ),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: crypto.digestStringAsync,
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('@/data/live/verifiedSourceActivation', () => ({
  verifiedSourceActivationOptions: vi.fn(() => ({})),
}));

const credentials = {
  email: ' Follower@Example.com ',
  password: 'secret',
  topLevelDomain: 'io' as const,
};
const session = {
  token: 'token',
  expiresAt: 4_102_444_800_000,
  userId: 'user-1',
  region: 'eu',
  version: '4.17.0',
  accountEmail: 'follower@example.com',
  patientId: 'patient-1',
};

describe('LibreLinkUp source owner identity', () => {
  it('binds the verified account user and selected patient into the digest material', async () => {
    await digestLibreLinkUpOwnerIdentity(credentials, session);
    const firstMaterial = crypto.digestStringAsync.mock.calls[0]![1];

    await digestLibreLinkUpOwnerIdentity(credentials, {
      ...session,
      patientId: 'patient-2',
    });
    const secondMaterial = crypto.digestStringAsync.mock.calls[1]![1];

    expect(firstMaterial).toContain('follower@example.com');
    expect(firstMaterial).toContain('user-1');
    expect(firstMaterial).toContain('patient-1');
    expect(secondMaterial).toContain('patient-2');
    expect(secondMaterial).not.toBe(firstMaterial);
  });

  it('rejects an unbound or account-mismatched session', async () => {
    await expect(
      digestLibreLinkUpOwnerIdentity(credentials, {
        ...session,
        patientId: undefined,
      }),
    ).rejects.toThrow(/verified account and patient/i);
    await expect(
      digestLibreLinkUpOwnerIdentity(credentials, {
        ...session,
        accountEmail: 'different@example.com',
      }),
    ).rejects.toThrow(/verified account and patient/i);
  });

  it('rejects a verified snapshot that does not bind the selected patient', async () => {
    await expect(
      commitVerifiedLibreLinkUp(
        credentials,
        {
          readings: [
            {
              id: 'libre:1',
              sourceId: 't1arc-librelinkup',
              timestamp: 1,
              receivedAt: 2,
              mmolL: 6,
              trend: 'flat',
              quality: 'measured',
            },
          ],
          patients: [{ id: 'patient-2', name: 'Different person' }],
          selectedPatientId: 'patient-2',
          session,
        },
        {
          sourceId: 't1arc-librelinkup',
          localDataWriteLease: { epoch: 0 },
          changeGeneration: 1,
          observedOwnerGeneration: 0,
          observedConnected: false,
        },
      ),
    ).rejects.toThrow(/not bound to the selected patient/i);
  });
});
