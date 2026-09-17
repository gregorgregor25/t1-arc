import { File } from 'expo-file-system';
import T1ArcBackupCrypto from '../../../modules/t1arc-backup-crypto';
import { reportPayload, type ResponseReport } from '@/data/tarvis/responseReport';
import { acquireLocalDataWriteLease, assertLocalDataWriteLeaseCurrent } from '@/data/privacy/localDataWriteEpoch';

/** Save only the consented preview. No background export or broad folder permission. */
export async function exportSupportReport(report: ResponseReport): Promise<'saved' | 'cancelled'> {
  const checked = reportPayload(report);
  const lease = await acquireLocalDataWriteLease();
  const file = new File(await T1ArcBackupCrypto.createWorkingFileAsync('.txt'));
  try {
    file.write(`Reference: ${checked.id}\nApp version: ${checked.version}\n\n${checked.text}`);
    await assertLocalDataWriteLeaseCurrent(lease);
    const result = await T1ArcBackupCrypto.saveTemporaryFileAsync(file.uri, `T1-Arc-support-${checked.id}.txt`, 'text/plain');
    return result.status;
  } finally {
    await T1ArcBackupCrypto.removeTemporaryFileAsync(file.uri).catch(() => undefined);
  }
}
