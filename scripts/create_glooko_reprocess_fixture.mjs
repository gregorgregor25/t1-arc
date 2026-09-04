import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { strToU8, zipSync } from 'fflate';

const destination = resolve(
  process.argv[2] ?? '.build/glooko-misreported-sizes.zip',
);
const bolus = `Name:Regression fixture\tDate Range:2026-07-20 - 2026-07-21
Timestamp\tBolus Type\tDose (units)\tCarbs (g)\tNotes
2026-07-20 09:17:50\tNormal\t4.8\t45\tBreakfast
2026-07-20 12:37:50\tCorrection\t1.2\t0\tCorrection`;
const basal = `Name:Regression fixture\tDate Range:2026-07-20 - 2026-07-21
Timestamp\tBasal Rate (units/hr)\tDuration (min)\tType
2026-07-20 00:00:00\t0.60\t30\tScheduled
2026-07-20 00:30:00\t0.80\t30\tScheduled`;
const archive = zipSync({
  'export/bolus_data_1.csv': strToU8(bolus),
  'export/basal_data_1.csv': strToU8(basal),
});
const advertisedSize = 30 * 1024 * 1024;
let entriesChanged = 0;
for (let index = 0; index <= archive.length - 46; index += 1) {
  if (
    archive[index] !== 0x50 ||
    archive[index + 1] !== 0x4b ||
    archive[index + 2] !== 0x01 ||
    archive[index + 3] !== 0x02
  ) {
    continue;
  }
  archive[index + 24] = advertisedSize & 0xff;
  archive[index + 25] = (advertisedSize >>> 8) & 0xff;
  archive[index + 26] = (advertisedSize >>> 16) & 0xff;
  archive[index + 27] = (advertisedSize >>> 24) & 0xff;
  entriesChanged += 1;
}
if (entriesChanged !== 2) {
  throw new Error(`Expected two central-directory entries; found ${entriesChanged}.`);
}
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, archive);
console.log(destination);
