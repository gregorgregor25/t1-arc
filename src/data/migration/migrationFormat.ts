export const MAINTAINER_MIGRATION_FORMAT = 't1arc-maintainer-migration';
export const MAINTAINER_MIGRATION_VERSION = 1;
export const MAINTAINER_MIGRATION_SOURCE_BACKUP_VERSION = 16;
export const MAINTAINER_MIGRATION_MIME =
  'application/vnd.t1arc.maintainer-migration';
export const MAINTAINER_MIGRATION_EXTENSION = '.t1arc-migration';
export const MAINTAINER_MIGRATION_APPLIED_KEY =
  't1arc.migration.applied.v1';

export interface MaintainerMigrationMetadata {
  format: typeof MAINTAINER_MIGRATION_FORMAT;
  version: typeof MAINTAINER_MIGRATION_VERSION;
  createdAt: number;
  sourceBackupVersion: number;
  sourceContainerSha256: string;
  recordFingerprintSha256: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function validateMaintainerMigrationMetadata(
  value: unknown,
): MaintainerMigrationMetadata {
  if (!isPlainObject(value)) {
    throw new Error('The migration manifest is missing.');
  }
  const expectedKeys = [
    'format',
    'version',
    'createdAt',
    'sourceBackupVersion',
    'sourceContainerSha256',
    'recordFingerprintSha256',
  ];
  const keys = Object.keys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key)) ||
    value.format !== MAINTAINER_MIGRATION_FORMAT ||
    value.version !== MAINTAINER_MIGRATION_VERSION ||
    typeof value.createdAt !== 'number' ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt <= 0 ||
    value.createdAt > Date.now() + 24 * 60 * 60 * 1000 ||
    typeof value.sourceBackupVersion !== 'number' ||
    !Number.isSafeInteger(value.sourceBackupVersion) ||
    value.sourceBackupVersion !==
      MAINTAINER_MIGRATION_SOURCE_BACKUP_VERSION ||
    !isSha256(value.sourceContainerSha256) ||
    !isSha256(value.recordFingerprintSha256)
  ) {
    throw new Error('The migration manifest is invalid or unsupported.');
  }

  return {
    format: MAINTAINER_MIGRATION_FORMAT,
    version: MAINTAINER_MIGRATION_VERSION,
    createdAt: value.createdAt,
    sourceBackupVersion: value.sourceBackupVersion,
    sourceContainerSha256: value.sourceContainerSha256,
    recordFingerprintSha256: value.recordFingerprintSha256,
  };
}

export function maintainerMigrationFileName(createdAt = Date.now()) {
  const iso = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  return `T1-Arc-migration-${iso}${MAINTAINER_MIGRATION_EXTENSION}`;
}
