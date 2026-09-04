import {
  CombinedDiabetesRepository,
  GlucoseSource,
} from '@/data/contracts';
import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import { DexcomShareGlucoseSource } from '@/data/dexcomShare/DexcomShareGlucoseSource';
import { DexcomShareConnection } from '@/data/dexcomShare/types';
import { MedtrumGlucoseSource } from '@/data/medtrum/MedtrumGlucoseSource';
import { MedtrumConnection } from '@/data/medtrum/types';
import { LibreLinkUpCredentials } from '@/data/libreLinkUp/types';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { NightscoutTreatmentImporter } from '@/data/nightscout/NightscoutTreatmentImporter';
import { NightscoutConnection } from '@/data/nightscout/types';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { NotificationGlucoseSource } from '@/data/notification/NotificationGlucoseSource';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';
import { XdripConnection } from '@/data/xdrip/types';
import type { LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
import type { SourceConnectionWriteLease } from './sourceConnectionOwnership';

import { CompositeGlucoseSource } from './CompositeGlucoseSource';
import { ImportedInsulinSource } from './ImportedInsulinSource';
import { StoredContextSource } from './StoredContextSource';

export interface LiveSourceWriteLeases {
  libre?: SourceConnectionWriteLease;
  nightscout?: SourceConnectionWriteLease;
  xdrip?: SourceConnectionWriteLease;
  dexcomShare?: SourceConnectionWriteLease;
  medtrum?: SourceConnectionWriteLease;
}

export function createLiveRepository(
  credentials?: LibreLinkUpCredentials,
  nightscout?: NightscoutConnection,
  xdrip?: XdripConnection,
  dexcomShare?: DexcomShareConnection,
  medtrum?: MedtrumConnection,
  writeLease?: LocalDataWriteLease,
  sourceWriteLeases: LiveSourceWriteLeases = {},
) {
  const healthRecords = new SqliteHealthRecordStore(writeLease);
  const glucoseHistory = new SqliteGlucoseHistoryStore(writeLease);
  const notificationSource = new NotificationGlucoseSource(glucoseHistory);
  const glucoseSources: GlucoseSource[] = [notificationSource];
  const nightscoutHealthRecords = sourceWriteLeases.nightscout
    ? healthRecords.withSourceWriteLease(sourceWriteLeases.nightscout)
    : undefined;
  const nightscoutTreatments = nightscout && nightscoutHealthRecords
    ? new NightscoutTreatmentImporter(nightscout, nightscoutHealthRecords)
    : undefined;
  if (credentials && sourceWriteLeases.libre) {
    glucoseSources.push(
      new DirectLibreLinkUpSource(
        credentials,
        glucoseHistory.withSourceWriteLease(sourceWriteLeases.libre),
        {
          writeLease,
          sourceWriteLease: sourceWriteLeases.libre,
        },
      ),
    );
  }
  if (nightscout && sourceWriteLeases.nightscout) {
    glucoseSources.push(
      new NightscoutGlucoseSource(
        nightscout,
        glucoseHistory.withSourceWriteLease(sourceWriteLeases.nightscout),
        fetch,
        Date.now,
        undefined,
        undefined,
        undefined,
        writeLease,
        sourceWriteLeases.nightscout,
      ),
    );
  }
  if (xdrip && sourceWriteLeases.xdrip) {
    glucoseSources.push(
      new XdripGlucoseSource(
        xdrip,
        glucoseHistory.withSourceWriteLease(sourceWriteLeases.xdrip),
      ),
    );
  }
  if (dexcomShare && sourceWriteLeases.dexcomShare) {
    glucoseSources.push(
      new DexcomShareGlucoseSource(
        dexcomShare,
        glucoseHistory.withSourceWriteLease(sourceWriteLeases.dexcomShare),
      ),
    );
  }
  if (medtrum?.patientId && sourceWriteLeases.medtrum) {
    glucoseSources.push(
      new MedtrumGlucoseSource(
        medtrum,
        glucoseHistory.withSourceWriteLease(sourceWriteLeases.medtrum),
      ),
    );
  }
  return new CombinedDiabetesRepository(
    new CompositeGlucoseSource(glucoseSources, glucoseHistory),
    new ImportedInsulinSource(healthRecords, nightscoutTreatments),
    new StoredContextSource(healthRecords),
  );
}
