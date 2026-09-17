import type {
  HealthMigrationImportResult,
  HealthMigrationPreferenceAdapter,
  HealthBackupRecordFingerprint,
  PreparedHealthBackupRestore,
} from '@/data/backup/healthBackup';
import {
  type MaintainerMigrationMetadata,
  validateMaintainerMigrationMetadata,
} from '@/data/migration/migrationFormat';

export interface PreparedMaintainerMigration {
  backup: Extract<PreparedHealthBackupRestore, { kind: 'stream' }>;
  metadata: MaintainerMigrationMetadata;
  recordFingerprint: HealthBackupRecordFingerprint;
}

export function validatePreparedMaintainerMigration(
  backup: PreparedHealthBackupRestore,
  recordFingerprint: HealthBackupRecordFingerprint,
): PreparedMaintainerMigration {
  if (backup.kind !== 'stream') {
    throw new Error('The migration bundle does not use the supported container.');
  }
  const metadata = validateMaintainerMigrationMetadata(
    backup.manifest.migration,
  );
  if (backup.sourceVersion !== metadata.sourceBackupVersion) {
    throw new Error(
      'The migration source schema does not match its authenticated manifest.',
    );
  }
  if (
    recordFingerprint.algorithm !== 'sha256' ||
    !Number.isSafeInteger(recordFingerprint.byteLength) ||
    recordFingerprint.byteLength < 8 ||
    recordFingerprint.sha256 !== metadata.recordFingerprintSha256
  ) {
    throw new Error(
      'The migration record fingerprint does not match its manifest.',
    );
  }
  return { backup, metadata, recordFingerprint };
}

export async function readMaintainerMigrationFile(
  plaintextUri: string,
): Promise<PreparedMaintainerMigration> {
  const {
    computeHealthBackupRecordFingerprint,
    readHealthBackupFile,
  } = await import('@/data/backup/healthBackup');
  const backup = await readHealthBackupFile(plaintextUri);
  const recordFingerprint = await computeHealthBackupRecordFingerprint(
    plaintextUri,
  );
  return validatePreparedMaintainerMigration(backup, recordFingerprint);
}

export async function importMaintainerMigration(
  prepared: PreparedMaintainerMigration,
  preferenceAdapter?: HealthMigrationPreferenceAdapter,
): Promise<HealthMigrationImportResult> {
  const { importPreparedHealthMigration } = await import(
    '@/data/backup/healthBackup'
  );
  return importPreparedHealthMigration(
    prepared.backup,
    prepared.metadata,
    prepared.recordFingerprint,
    preferenceAdapter,
  );
}
