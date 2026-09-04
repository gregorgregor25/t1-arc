import { describe, expect, it, vi } from 'vitest';

import {
  MAINTAINER_MIGRATION_EXTENSION,
  MAINTAINER_MIGRATION_FORMAT,
  MAINTAINER_MIGRATION_MIME,
  MAINTAINER_MIGRATION_SOURCE_BACKUP_VERSION,
  maintainerMigrationFileName,
  validateMaintainerMigrationMetadata,
} from '@/data/migration/migrationFormat';
import { validatePreparedMaintainerMigration } from '@/data/migration/maintainerMigration';

const metadata = {
  format: MAINTAINER_MIGRATION_FORMAT,
  version: 1,
  createdAt: 1_750_000_000_000,
  sourceBackupVersion: 16,
  sourceContainerSha256: 'a'.repeat(64),
  recordFingerprintSha256: 'b'.repeat(64),
} as const;

describe('maintainer migration format', () => {
  it('freezes a separate T1 Arc document identity', () => {
    expect(MAINTAINER_MIGRATION_FORMAT).toBe('t1arc-maintainer-migration');
    expect(MAINTAINER_MIGRATION_MIME).toBe(
      'application/vnd.t1arc.maintainer-migration',
    );
    expect(MAINTAINER_MIGRATION_EXTENSION).toBe('.t1arc-migration');
  });

  it('accepts only the exact version-one fingerprint manifest', () => {
    expect(validateMaintainerMigrationMetadata(metadata)).toEqual(metadata);
    expect(() =>
      validateMaintainerMigrationMetadata({ ...metadata, unexpected: true }),
    ).toThrow(/invalid or unsupported/i);
    expect(() =>
      validateMaintainerMigrationMetadata({
        ...metadata,
        recordFingerprintSha256: 'A'.repeat(64),
      }),
    ).toThrow(/invalid or unsupported/i);
  });

  it('rejects an unsupported source backup schema or future creation time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'));
    expect(MAINTAINER_MIGRATION_SOURCE_BACKUP_VERSION).toBe(16);
    expect(() =>
      validateMaintainerMigrationMetadata({
        ...metadata,
        sourceBackupVersion: 15,
      }),
    ).toThrow(/invalid or unsupported/i);
    expect(() =>
      validateMaintainerMigrationMetadata({
        ...metadata,
        createdAt: Date.now() + 25 * 60 * 60 * 1000,
      }),
    ).toThrow(/invalid or unsupported/i);
    vi.useRealTimers();
  });

  it('creates a filesystem-safe T1 Arc migration filename', () => {
    expect(maintainerMigrationFileName(1_750_000_000_000)).toMatch(
      /^T1-Arc-migration-.*\.t1arc-migration$/,
    );
  });

  it('requires a streamed container whose record fingerprint matches', () => {
    const backup = {
      kind: 'stream' as const,
      manifest: { migration: metadata },
      sourceVersion: 16,
      sourceUri: 'file:///migration.container',
    } as Extract<
      Parameters<typeof validatePreparedMaintainerMigration>[0],
      { kind: 'stream' }
    >;

    expect(
      validatePreparedMaintainerMigration(backup, {
        algorithm: 'sha256',
        byteLength: 8,
        sha256: metadata.recordFingerprintSha256,
      }).metadata,
    ).toEqual(metadata);
    expect(() =>
      validatePreparedMaintainerMigration(backup, {
        algorithm: 'sha256',
        byteLength: 8,
        sha256: 'c'.repeat(64),
      }),
    ).toThrow(/fingerprint does not match/i);
    expect(() =>
      validatePreparedMaintainerMigration(
        { ...backup, sourceVersion: 15 },
        {
          algorithm: 'sha256',
          byteLength: 8,
          sha256: metadata.recordFingerprintSha256,
        },
      ),
    ).toThrow(/source schema does not match/i);
    expect(() =>
      validatePreparedMaintainerMigration(backup, {
        algorithm: 'sha256',
        byteLength: 7,
        sha256: metadata.recordFingerprintSha256,
      }),
    ).toThrow(/fingerprint does not match/i);
  });
});
