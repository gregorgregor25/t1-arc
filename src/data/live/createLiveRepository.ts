import { CombinedDiabetesRepository } from '@/data/contracts';
import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import { LibreLinkUpCredentials } from '@/data/libreLinkUp/types';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';

import { ImportedInsulinSource } from './ImportedInsulinSource';
import { StoredContextSource } from './StoredContextSource';

export function createLiveRepository(credentials: LibreLinkUpCredentials) {
  const healthRecords = new SqliteHealthRecordStore();
  return new CombinedDiabetesRepository(
    new DirectLibreLinkUpSource(
      credentials,
      new SqliteGlucoseHistoryStore(),
    ),
    new ImportedInsulinSource(healthRecords),
    new StoredContextSource(healthRecords),
  );
}
