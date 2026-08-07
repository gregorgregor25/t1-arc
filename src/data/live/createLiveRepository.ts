import {
  CombinedDiabetesRepository,
  GlucoseSource,
} from '@/data/contracts';
import { DirectLibreLinkUpSource } from '@/data/libreLinkUp/DirectLibreLinkUpSource';
import { LibreLinkUpCredentials } from '@/data/libreLinkUp/types';
import { NightscoutGlucoseSource } from '@/data/nightscout/NightscoutGlucoseSource';
import { NightscoutTreatmentImporter } from '@/data/nightscout/NightscoutTreatmentImporter';
import { NightscoutConnection } from '@/data/nightscout/types';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import { NotificationGlucoseSource } from '@/data/notification/NotificationGlucoseSource';
import { XdripGlucoseSource } from '@/data/xdrip/XdripGlucoseSource';
import { XdripConnection } from '@/data/xdrip/types';

import { CompositeGlucoseSource } from './CompositeGlucoseSource';
import { ImportedInsulinSource } from './ImportedInsulinSource';
import { StoredContextSource } from './StoredContextSource';

export function createLiveRepository(
  credentials?: LibreLinkUpCredentials,
  nightscout?: NightscoutConnection,
  xdrip?: XdripConnection,
) {
  const healthRecords = new SqliteHealthRecordStore();
  const glucoseHistory = new SqliteGlucoseHistoryStore();
  const notificationSource = new NotificationGlucoseSource(glucoseHistory);
  const glucoseSources: GlucoseSource[] = [notificationSource];
  const nightscoutTreatments = nightscout
    ? new NightscoutTreatmentImporter(nightscout, healthRecords)
    : undefined;
  if (credentials) {
    glucoseSources.push(
      new DirectLibreLinkUpSource(credentials, glucoseHistory),
    );
  }
  if (nightscout) {
    glucoseSources.push(
      new NightscoutGlucoseSource(nightscout, glucoseHistory),
    );
  }
  if (xdrip) {
    glucoseSources.push(new XdripGlucoseSource(xdrip, glucoseHistory));
  }
  return new CombinedDiabetesRepository(
    new CompositeGlucoseSource(glucoseSources, glucoseHistory),
    new ImportedInsulinSource(healthRecords, nightscoutTreatments),
    new StoredContextSource(healthRecords),
  );
}
