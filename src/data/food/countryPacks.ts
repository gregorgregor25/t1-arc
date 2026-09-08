import type { SQLiteDatabase } from 'expo-sqlite';
import type { File } from 'expo-file-system';
import manifests from './country-packs.manifest.json';
import { COUNTRY_PACK_ASSETS } from './countryPackAssets';
import { canonicalFoodBarcode } from './barcodeIdentity';
import { abandonedCountryPackFileNames, isOwnedCountryPackFileName } from './countryPackRecovery';
import {
  type CountryFoodPackManifest, type CountryPackRow, countryPackQuery,
  countryPackRowToFood, inflateCountryPackGzip, installVerifiedCountryPack, throwIfPackCancelled,
  validateCountryPackManifest, verifyCountryPackChunks,
} from './countryPackValidation';
import type { FoodCandidate } from './types';

export { countryPackMatchEvidence } from './countryPackValidation';
export type { CountryFoodPackManifest } from './countryPackValidation';
export const COUNTRY_FOOD_PACKS = manifests as readonly CountryFoodPackManifest[];

export interface CountryFoodPackStatus {
  id: string; countryCode: string; label: string; version: string;
  foodCount: number; sizeBytes: number; bundled: boolean; optional: boolean;
  state: 'available' | 'installing' | 'installed' | 'error' | 'unavailable';
  installedVersion?: string; progress?: number; error?: string;
}

interface RegistryRow { id: string; file_name: string; manifest_json: string; enabled: number }
interface PackOptions { signal?: AbortSignal }
interface SearchOptions extends PackOptions { countryCode: string; locale?: string; limit?: number }
const statuses = new Map<string, Partial<CountryFoodPackStatus>>();
const listeners = new Set<() => void>();
const locks = new Map<string, Promise<unknown>>();
let registryPromise: Promise<SQLiteDatabase> | undefined;
let catalogueRevision = 0;
// Expo's automatic sqlite3_next_stmt sweep also finalizes FTS5-owned internal
// statements, which FTS5 frees again on close (expo/expo#38168). Our awaited
// getAll/getFirst/run helpers finalize their own statements before close.
const PACK_SQLITE_OPTIONS = { useNewConnection: true, finalizeUnusedStatementsBeforeClosing: false };
const loadNativeModules = () => Promise.all([
  import('expo-file-system'), import('expo-sqlite'), import('expo-crypto'),
]);
let nativeModulesPromise: ReturnType<typeof loadNativeModules> | undefined;

/** Invalidate consumers' result caches after an install/remove, never on progress. */
export function getCountryFoodPackRevision(): number { return catalogueRevision; }

async function native() {
  nativeModulesPromise ??= loadNativeModules().catch((error: unknown) => {
    nativeModulesPromise = undefined;
    throw error;
  });
  const [filesystem, sqlite, crypto] = await nativeModulesPromise;
  const directory = new filesystem.Directory(filesystem.Paths.document, 'food-catalogues-v1');
  directory.create({ intermediates: true, idempotent: true });
  return { filesystem, sqlite, crypto, directory };
}

async function registry() {
  registryPromise ??= (async () => {
    const runtime = await native();
    const { sqlite, directory } = runtime;
    // Entirely separate from the encrypted/private health-record database.
    const db = await sqlite.openDatabaseAsync('catalogue-registry.db', PACK_SQLITE_OPTIONS, directory.uri);
    await db.execAsync(`CREATE TABLE IF NOT EXISTS active_packs (
      id TEXT PRIMARY KEY, file_name TEXT NOT NULL, manifest_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
    );`);
    // Every installer awaits this promise before staging any file. Recovery is
    // therefore a startup barrier: no live install can race the all-pack sweep.
    await recoverAbandonedPackFiles(db, COUNTRY_FOOD_PACKS.map((pack) => pack.id), runtime);
    return db;
  })().catch((error: unknown) => { registryPromise = undefined; throw error; });
  return registryPromise;
}

async function recoverAbandonedPackFiles(
  reg: SQLiteDatabase, ids: readonly string[], runtime: Awaited<ReturnType<typeof native>>,
) {
  const rows = await reg.getAllAsync<RegistryRow>('SELECT * FROM active_packs');
  const { directory, filesystem } = runtime;
  try {
    const files = directory.list().filter((entry): entry is File => entry instanceof filesystem.File);
    const abandoned = new Set(abandonedCountryPackFileNames(files.map((file) => file.name), ids,
      rows.map((row) => row.file_name)));
    for (const file of files) {
      // An immediate child with an exact generated name is the only deletion target.
      if (!abandoned.has(file.name) || file.uri !== new filesystem.File(directory, file.name).uri) continue;
      try { if (file.exists) file.delete(); } catch { /* Retry on next install/start; preserve referenced files. */ }
    }
  } catch { /* An unavailable directory must not prevent reading the active catalogue. */ }
}

function packById(id: string) {
  const pack = COUNTRY_FOOD_PACKS.find((item) => item.id === id);
  if (!pack) throw new Error('Unknown food catalogue.');
  validateCountryPackManifest(pack);
  return pack;
}

function emit(id: string, update: Partial<CountryFoodPackStatus>) {
  if ((update.state === 'installed' || update.state === 'available') && statuses.get(id)?.state !== update.state) catalogueRevision += 1;
  statuses.set(id, update);
  for (const listener of listeners) { try { listener(); } catch { /* UI listeners cannot interrupt installation. */ } }
}

function locked<T>(id: string, action: () => Promise<T>): Promise<T> {
  const task = (locks.get(id) ?? Promise.resolve()).catch(() => undefined).then(action);
  locks.set(id, task);
  void task.finally(() => { if (locks.get(id) === task) locks.delete(id); }).catch(() => undefined);
  return task;
}

export function subscribeCountryFoodPackStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function getCountryFoodPackStatuses(): Promise<CountryFoodPackStatus[]> {
  const rows = await (await registry()).getAllAsync<RegistryRow>('SELECT * FROM active_packs');
  return COUNTRY_FOOD_PACKS.map((pack) => {
    const installed = rows.find((row) => row.id === pack.id && row.enabled === 1);
    let installedVersion: string | undefined;
    if (installed) { try { installedVersion = (JSON.parse(installed.manifest_json) as CountryFoodPackManifest).version; } catch { /* Reinstall repairs invalid metadata. */ } }
    return { id: pack.id, countryCode: pack.countryCode, label: pack.label, version: pack.version,
      foodCount: pack.foodCount, sizeBytes: pack.sizeBytes, bundled: pack.bundled, optional: !!pack.optional,
      state: installedVersion ? 'installed' : pack.bundled ? 'available' : 'unavailable', installedVersion,
      ...statuses.get(pack.id) };
  });
}

async function verifyFile(file: File, pack: CountryFoodPackManifest, signal?: AbortSignal, onProgress?: (n: number) => void) {
  const { filesystem, crypto } = await native();
  if (!file.exists || file.size !== pack.sizeBytes) throw new Error('Food catalogue size does not match.');
  const handle = file.open(filesystem.FileMode.ReadOnly);
  try {
    await verifyCountryPackChunks(pack, (size) => handle.readBytes(size), async (bytes) => {
      const result = await crypto.digest(crypto.CryptoDigestAlgorithm.SHA256, bytes);
      return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }, { signal, onProgress });
  } finally { handle.close(); }
}

async function verifyDatabase(file: File, pack: CountryFoodPackManifest) {
  const { sqlite, directory } = await native();
  const db = await sqlite.openDatabaseAsync(file.name, PACK_SQLITE_OPTIONS, directory.uri);
  try {
    await db.execAsync('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    const check = await db.getFirstAsync<{ quick_check: string }>('PRAGMA quick_check');
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (check?.quick_check !== 'ok' || version?.user_version !== 1) throw new Error('Invalid food catalogue database.');
    const schema = await db.getAllAsync<{ name: string; type: string }>('SELECT name,type FROM sqlite_master');
    const tables = new Set(['foods','pack_metadata','food_search','food_search_data','food_search_idx','food_search_docsize','food_search_config']);
    if (schema.some((row) => !['table','index'].includes(row.type) || (row.type === 'table' && !tables.has(row.name)))) throw new Error('Unexpected food catalogue schema.');
    if ([...tables].some((name) => !schema.some((row) => row.name === name && row.type === 'table'))) throw new Error('Incomplete food catalogue schema.');
    const metadata = await db.getFirstAsync<{ value: string }>("SELECT value FROM pack_metadata WHERE key='manifest'");
    const stored = JSON.parse(metadata?.value ?? '{}') as CountryFoodPackManifest;
    if (stored.id !== pack.id || stored.version !== pack.version || stored.sourceSha256 !== pack.sourceSha256 || stored.foodCount !== pack.foodCount) throw new Error('Food catalogue metadata does not match.');
    const count = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM foods');
    const macroMaximum = (pack.dataRevision ?? 1) >= 2 ? "CASE basis_unit WHEN 'ml' THEN 200 ELSE 100.1 END" : '100.1';
    const invalid = await db.getFirstAsync(`SELECT source_id FROM foods WHERE
      (carbs IS NOT NULL AND carbs NOT BETWEEN 0 AND ${macroMaximum}) OR
      (kcal IS NOT NULL AND kcal NOT BETWEEN 0 AND 1100) OR
      (protein IS NOT NULL AND protein NOT BETWEEN 0 AND ${macroMaximum}) OR
      (fat IS NOT NULL AND fat NOT BETWEEN 0 AND ${macroMaximum}) OR
      (fibre IS NOT NULL AND fibre NOT BETWEEN 0 AND ${macroMaximum}) OR
      (sugars IS NOT NULL AND sugars NOT BETWEEN 0 AND ${macroMaximum}) OR
      (saturated_fat IS NOT NULL AND saturated_fat NOT BETWEEN 0 AND ${macroMaximum}) OR
      ${(pack.dataRevision ?? 1) >= 2 ? "basis_unit NOT IN ('g','ml') OR NOT json_valid(nutrient_conflicts_json) OR" : ''}
      NOT json_valid(names_json) OR NOT json_valid(aliases_json) OR NOT json_valid(quality_json) LIMIT 1`);
    if (count?.n !== pack.foodCount || invalid) throw new Error('Food catalogue contains invalid entries.');
  } finally { await db.closeAsync(); }
}

/** Uncompressed sourceUri is restricted to a local picker URI and a known pack checksum. */
export async function installCountryFoodPack(id: string, options: PackOptions & { sourceUri?: string } = {}): Promise<void> {
  const pack = packById(id);
  if (options.sourceUri && (!/^(file:\/\/\/|content:\/\/)[^\u0000-\u001f]+$/i.test(options.sourceUri) || /[?#]/.test(options.sourceUri))) throw new Error('Select a local food catalogue file.');
  return locked(id, async () => {
    throwIfPackCancelled(options.signal);
    const runtime = await native();
    const { filesystem, sqlite, directory } = runtime;
    const reg = await registry();
    // Also recover a failed attempt in this process, before the free-space check.
    // The per-pack lock excludes its live installs; other packs are not touched.
    await recoverAbandonedPackFiles(reg, [id], runtime);
    const current = await reg.getFirstAsync<RegistryRow>('SELECT * FROM active_packs WHERE id=? AND enabled=1',id);
    if (current && /^[a-z0-9.-]+\.db$/.test(current.file_name) && new filesystem.File(directory,current.file_name).exists) {
      try {
        if ((JSON.parse(current.manifest_json) as CountryFoodPackManifest).sha256 === pack.sha256) {
          emit(id, { state: 'installed', installedVersion: pack.version, progress: 1 });
          return;
        }
      } catch { /* A checked replacement repairs malformed catalogue metadata. */ }
    }
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const staged = new filesystem.File(directory, `${id}-${suffix}.pending.db`);
    const compressed = new filesystem.File(directory, `${id}-${suffix}.pending.gz`);
    const finalFile = new filesystem.File(directory, `${id}-${pack.sha256.slice(0,16)}-${suffix}.db`);
    emit(id, { state: 'installing', progress: 0 });
    try {
      const requiredSpace = pack.sizeBytes + (pack.assetCompression ? pack.compressedBytes : 0) + 8*1024*1024;
      if (filesystem.Paths.availableDiskSpace < requiredSpace) throw new Error('Not enough free space for this food catalogue.');
      await installVerifiedCountryPack({
        prepare: async () => {
          try {
            if (options.sourceUri) await new filesystem.File(options.sourceUri).copy(staged);
            else {
              const asset = COUNTRY_PACK_ASSETS[id];
              if (!asset) throw new Error('This food catalogue is not included in this app build.');
              // SDK implementation resolves the bundled Asset and copies its bytes; no DB opens here.
              await sqlite.importDatabaseFromAssetAsync(pack.assetCompression ? compressed.name : staged.name, { assetId: asset() }, directory.uri);
              if (pack.assetCompression) {
                if (!pack.compressedSha256 || !pack.compressedChunkSha256) throw new Error('Missing compressed catalogue checksums.');
                await verifyFile(compressed, { ...pack, sizeBytes: pack.compressedBytes, sha256: pack.compressedSha256, chunkSha256: pack.compressedChunkSha256 }, options.signal);
                staged.create();
                const input = compressed.open(filesystem.FileMode.ReadOnly);
                const output = staged.open(filesystem.FileMode.Truncate);
                try {
                  await inflateCountryPackGzip(pack, (length) => input.readBytes(length), (chunk) => output.writeBytes(chunk), {
                    signal: options.signal, onProgress: (n) => emit(id, { state: 'installing', progress: .4*n }),
                  });
                } finally { input.close(); output.close(); }
              }
            }
            return staged;
          } catch (error) { if (staged.exists) staged.delete(); throw error; }
        },
        verify: async (file) => {
          await verifyFile(file, pack, options.signal, (n) => emit(id, { state: 'installing', progress: .4+.5*n }));
          await verifyDatabase(file, pack);
        },
        activate: async (file) => {
          await file.move(finalFile);
          // One atomic SQLite statement publishes the immutable, already checked file.
          // The previous file is retained until a later successful install/removal.
          await reg.runAsync(`INSERT INTO active_packs(id,file_name,manifest_json,enabled) VALUES (?,?,?,1)
            ON CONFLICT(id) DO UPDATE SET file_name=excluded.file_name,manifest_json=excluded.manifest_json,enabled=1`,
          id, finalFile.name, JSON.stringify(pack));
        },
        discard: async (file) => { if (file.exists && file.uri !== finalFile.uri) file.delete(); },
      }, options.signal);
      emit(id, { state: 'installed', installedVersion: pack.version, progress: 1 });
    } catch (error) {
      emit(id, { state: 'error', error: error instanceof Error ? error.message : 'Could not prepare food catalogue.' });
      throw error;
    } finally { if (compressed.exists) compressed.delete(); }
  });
}

export async function removeCountryFoodPack(id: string): Promise<void> {
  packById(id);
  await locked(id, async () => {
    const reg = await registry();
    // Disable first; a crash cannot leave a pointer to a subsequently removed file.
    await reg.runAsync('UPDATE active_packs SET enabled=0 WHERE id=?', id);
    const { directory, filesystem } = await native();
    for (const file of directory.list()) {
      if (file instanceof filesystem.File && isOwnedCountryPackFileName(file.name, [id])
        && file.uri === new filesystem.File(directory, file.name).uri) file.delete();
    }
    emit(id, { state: 'available', installedVersion: undefined });
  });
}

async function readyPack(pack: CountryFoodPackManifest, options: PackOptions) {
  throwIfPackCancelled(options.signal);
  const reg = await registry();
  const row = await reg.getFirstAsync<RegistryRow>('SELECT * FROM active_packs WHERE id=?',pack.id);
  if (row?.enabled === 0) return false;
  if (row?.enabled === 1) {
    const current = JSON.parse(row.manifest_json) as CountryFoodPackManifest;
    if (current.sha256 === pack.sha256) return true;
    try { await installCountryFoodPack(pack.id, options); }
    catch (error) {
      throwIfPackCancelled(options.signal);
      if (!current.sha256 || (current.dataRevision ?? 1) < (pack.dataRevision ?? 1)) throw error;
    }
    return true;
  }
  if (pack.optional || !pack.bundled) return false;
  await installCountryFoodPack(pack.id, options);
  return true;
}

async function readPack<T>(pack: CountryFoodPackManifest, options: PackOptions, read: (db: SQLiteDatabase, active: CountryFoodPackManifest) => Promise<T>): Promise<T | null> {
  if (!await readyPack(pack, options)) return null;
  return locked(pack.id, async () => {
    throwIfPackCancelled(options.signal);
    const row = await (await registry()).getFirstAsync<RegistryRow>('SELECT * FROM active_packs WHERE id=? AND enabled=1',pack.id);
    if (!row || !/^[a-z0-9.-]+\.db$/.test(row.file_name)) return null;
    const active = JSON.parse(row.manifest_json) as CountryFoodPackManifest;
    validateCountryPackManifest(active);
    const { filesystem, sqlite, directory } = await native();
    if (!new filesystem.File(directory,row.file_name).exists) throw new Error('Food catalogue file is missing. Prepare the catalogue again.');
    const db = await sqlite.openDatabaseAsync(row.file_name, PACK_SQLITE_OPTIONS, directory.uri);
    try {
      await db.execAsync('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      const result = await read(db, active);
      throwIfPackCancelled(options.signal);
      return result;
    } finally { await db.closeAsync(); }
  });
}

export async function searchCountryPackFoods(query: string, options: SearchOptions): Promise<FoodCandidate[]> {
  const match = countryPackQuery(query);
  if (!match) return [];
  const packs = COUNTRY_FOOD_PACKS.filter((pack) => pack.countryCode === options.countryCode);
  const requested = Number.isFinite(options.limit) ? options.limit! : 20;
  const limit = Math.max(1,Math.min(400,Math.floor(requested)));
  const results: FoodCandidate[] = [];
  for (const pack of packs) {
    const rows = await readPack(pack, options, async (db, active) => {
      const matches = await db.getAllAsync<CountryPackRow>(`SELECT f.* FROM food_search s JOIN foods f ON f.rowid=s.rowid
        WHERE food_search MATCH ? ORDER BY bm25(food_search),f.source_id LIMIT ?`,match,limit);
      return matches.map((row) => countryPackRowToFood(row, active, options.locale)).filter((food): food is FoodCandidate => food !== null);
    });
    if (rows) results.push(...rows);
  }
  return results.slice(0,limit);
}

export async function lookupCountryPackBarcode(barcode: string, options: SearchOptions): Promise<FoodCandidate | null> {
  const canonical = canonicalFoodBarcode(barcode);
  if (!/^(?:\d{8}|\d{14})$/.test(canonical)) return null;
  for (const pack of COUNTRY_FOOD_PACKS.filter((p) => p.countryCode === options.countryCode && p.optional)) {
    const result = await readPack(pack, options, async (db, active) => {
      const row = await db.getFirstAsync<CountryPackRow>('SELECT * FROM foods WHERE barcode=?', canonical);
      return row ? countryPackRowToFood(row, active, options.locale) : null;
    });
    if (result) return result;
  }
  return null;
}
