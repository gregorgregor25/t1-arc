import { beforeEach, describe, expect, it, vi } from 'vitest';
import manifests from '@/data/food/country-packs.manifest.json';
import { abandonedCountryPackFileNames } from '@/data/food/countryPackRecovery';

const state = vi.hoisted(() => ({
  files: new Set<string>(), deleted: [] as string[], imports: [] as string[],
  rows: [] as { id: string; file_name: string; manifest_json: string; enabled: number }[],
  connections: [] as { name: string; options: Record<string, unknown>; activeQueries: number; closes: number }[],
  packs: [] as { id: string; foodCount: number; sizeBytes: number; compressedBytes: number }[],
  registryReadGate: undefined as Promise<void> | undefined,
  registryReads: 0,
  importGate: undefined as ((name: string) => Promise<void>) | undefined,
  queryGate: undefined as Promise<void> | undefined,
  queryFailure: false, invalidDatabase: false, commitFailure: false,
}));
const base = 'file:///app/documents/food-catalogues-v1';

vi.mock('@/data/food/countryPackAssets', () => ({ COUNTRY_PACK_ASSETS: { 'ca-cnf': () => 1, 'fr-ciqual': () => 2, 'us-usda-branded': () => 3 } }));
// Actual byte/checksum/inflation behaviour has separate real-artifact tests.
vi.mock('@/data/food/countryPackValidation', async (original) => ({
  ...await original<typeof import('@/data/food/countryPackValidation')>(),
  verifyCountryPackChunks: vi.fn(async () => undefined),
  inflateCountryPackGzip: vi.fn(async () => undefined),
}));
vi.mock('expo-crypto', () => ({}));
vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/');
    }
    get name() { return this.uri.split('/').at(-1)!; }
    get exists() { return state.files.has(this.uri); }
    get size() {
      const pack = state.packs.find((item) => this.name.startsWith(`${item.id}-`));
      return (this.name.endsWith('.gz') ? pack?.compressedBytes : pack?.sizeBytes) ?? 0;
    }
    delete() { state.deleted.push(this.uri); state.files.delete(this.uri); }
    create() { state.files.add(this.uri); }
    copy(destination: File) { state.files.add(destination.uri); }
    move(destination: File) { state.files.delete(this.uri); this.uri = destination.uri; state.files.add(this.uri); }
    open() { return { readBytes: () => new Uint8Array(), close: () => undefined }; }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/');
    }
    create() { /* In-memory filesystem. */ }
    list() { return [...state.files].map((uri) => new File(uri)); }
  }
  return { File, Directory, FileMode: { ReadOnly: 1 }, Paths: { document: { uri: 'file:///app/documents' }, availableDiskSpace: 2 ** 40 } };
});
vi.mock('expo-sqlite', () => ({
  importDatabaseFromAssetAsync: async (name: string, _asset: unknown, directory: string) => {
    state.files.add(`${directory}/${name}`);
    state.imports.push(name);
    await state.importGate?.(name);
  },
  openDatabaseAsync: async (name: string, options: Record<string, unknown>) => {
    const connection = { name, options, activeQueries: 0, closes: 0 };
    state.connections.push(connection);
    const registry = name === 'catalogue-registry.db';
    const pack = state.packs.find((item) => name.startsWith(`${item.id}-`));
    return {
      execAsync: async () => undefined,
      getAllAsync: async (sql: string) => {
        if (registry) { state.registryReads++; await state.registryReadGate; return state.rows; }
        if (sql.includes('sqlite_master')) return ['foods', 'pack_metadata', 'food_search', 'food_search_data', 'food_search_idx', 'food_search_docsize', 'food_search_config'].map((table) => ({ name: table, type: 'table' }));
        connection.activeQueries++;
        try {
          await state.queryGate;
          if (state.queryFailure) throw new Error('Synthetic query failure');
          return [];
        } finally { connection.activeQueries--; }
      },
      getFirstAsync: async (sql: string, id: string) => {
        if (registry) return state.rows.find((row) => row.id === id && (!sql.includes('enabled=1') || row.enabled === 1)) ?? null;
        if (sql.includes('quick_check')) return { quick_check: state.invalidDatabase ? 'invalid' : 'ok' };
        if (sql.includes('user_version')) return { user_version: 1 };
        if (sql.includes('pack_metadata')) return { value: JSON.stringify(pack) };
        if (sql.includes('count(*)')) return { n: pack!.foodCount };
        return null;
      },
      runAsync: async (sql: string, id: string, file_name: string, manifest_json: string) => {
        if (state.commitFailure) throw new Error('Synthetic registry commit failure');
        if (sql.startsWith('UPDATE')) { const row = state.rows.find((item) => item.id === id); if (row) row.enabled = 0; }
        else { state.rows = state.rows.filter((row) => row.id !== id); state.rows.push({ id, file_name, manifest_json, enabled: 1 }); }
      },
      closeAsync: async () => {
        expect(connection.activeQueries).toBe(0);
        expect(connection.closes).toBe(0);
        // SDK's default FTS-internal statement sweep causes a native double-free.
        if (!registry) expect(options.finalizeUnusedStatementsBeforeClosing).toBe(false);
        connection.closes++;
      },
    };
  },
}));

function seedActive(id = 'ca-cnf', old = false) {
  const pack = manifests.find((entry) => entry.id === id)!;
  const file_name = `${id}-${'a'.repeat(16)}-1780000000000-active.db`;
  state.files.add(`${base}/${file_name}`);
  state.rows.push({ id, file_name, manifest_json: JSON.stringify(old ? { ...pack, sha256: 'b'.repeat(64) } : pack), enabled: 1 });
  return file_name;
}

beforeEach(() => {
  vi.resetModules();
  state.files.clear(); state.deleted.length = 0; state.imports.length = 0; state.rows = [];
  state.connections.length = 0; state.packs = manifests;
  state.registryReadGate = undefined; state.registryReads = 0; state.importGate = undefined;
  state.queryGate = undefined; state.queryFailure = false; state.invalidDatabase = false; state.commitFailure = false;
});

describe('country-pack crash recovery and connection ownership', () => {
  it('selects only exact generated staging/orphan names, never registry, journals, prefixes or traversal', () => {
    const pending = 'ca-cnf-1780000000000-abc123.pending.db';
    const gzip = 'us-usda-branded-1780000000000-ab123.pending.gz';
    const final = `ca-cnf-${'b'.repeat(16)}-1780000000000-ab123.db`;
    const unrelated = ['catalogue-registry.db', 'catalogue-registry.db-journal', 'health.db', 'ca-cnf-private-notes.db', `../${pending}`, `${pending}/child`, `${pending}-wal`, 'unknown-1780000000000-ab123.pending.db'];
    expect(abandonedCountryPackFileNames([pending, gzip, final, ...unrelated], ['ca-cnf', 'us-usda-branded'], [final])).toEqual([pending, gzip]);
  });

  it('recovers process-death staging and rename-before-commit orphans while preserving active previous files', async () => {
    const active = seedActive('us-usda-branded', true);
    const abandoned = ['us-usda-branded-1780000000000-dead.pending.db', 'us-usda-branded-1780000000000-dead.pending.gz', `us-usda-branded-${'b'.repeat(16)}-1780000000000-orphan.db`];
    for (const name of [...abandoned, 'catalogue-registry.db', 'us-usda-branded-user-notes.db']) state.files.add(`${base}/${name}`);
    const outside = `file:///other/${abandoned[0]}`;
    state.files.add(outside);
    const api = await import('@/data/food/countryPacks');
    await api.getCountryFoodPackStatuses();
    expect(state.deleted.sort()).toEqual(abandoned.map((name) => `${base}/${name}`).sort());
    expect(state.files.has(`${base}/${active}`)).toBe(true);
    expect(state.files.has(outside)).toBe(true);
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]!.closes).toBe(0);
  });

  it('finishes startup recovery before a concurrent install can create any live staging file', async () => {
    let resume!: () => void;
    state.registryReadGate = new Promise<void>((resolve) => { resume = resolve; });
    const api = await import('@/data/food/countryPacks');
    const status = api.getCountryFoodPackStatuses();
    const install = api.installCountryFoodPack('ca-cnf');
    await vi.waitFor(() => expect(state.registryReads).toBe(1));
    expect(state.imports).toEqual([]);
    state.registryReadGate = undefined; resume();
    await Promise.all([status, install]);
    expect(state.rows).toHaveLength(1);
    expect(state.files.has(`${base}/${state.rows[0]!.file_name}`)).toBe(true);
    expect(state.connections.every((connection) => connection.options.useNewConnection === true)).toBe(true);
  });

  it('does not sweep live staging during status refresh or a different pack install', async () => {
    let resume!: () => void;
    state.importGate = (name) => name.startsWith('ca-cnf-') ? new Promise<void>((resolve) => { resume = resolve; }) : Promise.resolve();
    const api = await import('@/data/food/countryPacks');
    const install = api.installCountryFoodPack('ca-cnf');
    await vi.waitFor(() => expect(state.imports).toHaveLength(1));
    const live = `${base}/${state.imports[0]}`;
    await Promise.all([api.getCountryFoodPackStatuses(), api.getCountryFoodPackStatuses(), api.installCountryFoodPack('fr-ciqual')]);
    expect(state.files.has(live)).toBe(true);
    expect(state.deleted).not.toContain(live);
    resume(); await install;
    expect(state.rows).toHaveLength(2);
  });

  it.each(['cancel', 'query-error'])('awaits a %s query before closing its unique handle; queued reads and status remain isolated', async (mode) => {
    seedActive();
    let resume!: () => void;
    state.queryGate = new Promise<void>((resolve) => { resume = resolve; });
    const api = await import('@/data/food/countryPacks');
    const controller = new AbortController();
    const first = api.searchCountryPackFoods('cheese', { countryCode: 'CA', signal: controller.signal });
    const rejected = expect(first).rejects.toThrow(mode === 'cancel' ? 'cancelled' : 'Synthetic query failure');
    await vi.waitFor(() => expect(state.connections.some((item) => item.activeQueries === 1)).toBe(true));
    const second = api.searchCountryPackFoods('bread', { countryCode: 'CA' });
    await api.getCountryFoodPackStatuses();
    expect(state.connections.filter((item) => item.name !== 'catalogue-registry.db')).toHaveLength(1);
    expect(state.connections.every((item) => item.closes === 0)).toBe(true);
    if (mode === 'cancel') controller.abort(); else state.queryFailure = true;
    resume(); await rejected;
    state.queryFailure = false;
    await second;
    const readers = state.connections.filter((item) => item.name !== 'catalogue-registry.db');
    expect(readers).toHaveLength(2);
    expect(readers.every((item) => item.closes === 1 && item.options.useNewConnection === true && item.options.finalizeUnusedStatementsBeforeClosing === false)).toBe(true);
  });

  it('preserves the active registry file on validation failure and closes validation once', async () => {
    const active = seedActive('ca-cnf', true);
    state.invalidDatabase = true;
    const api = await import('@/data/food/countryPacks');
    await expect(api.installCountryFoodPack('ca-cnf')).rejects.toThrow('Invalid food catalogue database');
    expect(state.rows[0]!.file_name).toBe(active);
    expect([...state.files]).toEqual([`${base}/${active}`]);
    expect(state.connections.find((item) => item.name.endsWith('.pending.db'))!.closes).toBe(1);
  });

  it('recovers the final-file orphan after rename succeeds but registry publication fails', async () => {
    const active = seedActive('ca-cnf', true);
    state.commitFailure = true;
    const api = await import('@/data/food/countryPacks');
    await expect(api.installCountryFoodPack('ca-cnf')).rejects.toThrow('Synthetic registry commit failure');
    expect(state.rows[0]!.file_name).toBe(active);
    const orphan = [...state.files].find((uri) => uri !== `${base}/${active}`)!;
    expect(orphan).toBeDefined();
    expect(orphan.endsWith('.pending.db')).toBe(false);
    // A new JS process loses all in-memory install state but retains files/registry.
    vi.resetModules();
    const restarted = await import('@/data/food/countryPacks');
    await restarted.getCountryFoodPackStatuses();
    expect(state.deleted).toContain(orphan);
    expect([...state.files]).toEqual([`${base}/${active}`]);
  });

  it('explicit removal also uses exact owned names, preserving same-prefix unrelated and other-pack files', async () => {
    const active = seedActive();
    const unrelated = `${base}/ca-cnf-private-notes.db`;
    const otherPack = `${base}/fr-ciqual-1780000000000-live.pending.db`;
    state.files.add(unrelated);
    const api = await import('@/data/food/countryPacks');
    await api.getCountryFoodPackStatuses();
    // Added after the startup sweep to represent another pack's live work.
    state.files.add(otherPack);
    await api.removeCountryFoodPack('ca-cnf');
    expect(state.rows[0]!.enabled).toBe(0);
    expect(state.files.has(`${base}/${active}`)).toBe(false);
    expect(state.files.has(unrelated)).toBe(true);
    expect(state.files.has(otherPack)).toBe(true);
  });

  it('upgrades an already-enabled obsolete US data revision before barcode lookup', async () => {
    seedActive('us-usda-branded', true);
    state.rows[0]!.manifest_json = JSON.stringify({ ...JSON.parse(state.rows[0]!.manifest_json), dataRevision: 1 });
    const api = await import('@/data/food/countryPacks');
    await api.lookupCountryPackBarcode('00016000322622', { countryCode: 'US' });
    expect(state.imports).toHaveLength(1);
    expect(JSON.parse(state.rows[0]!.manifest_json).dataRevision).toBe(2);
    expect(JSON.parse(state.rows[0]!.manifest_json).sha256).toBe(manifests.find((item) => item.id === 'us-usda-branded')!.sha256);
  });

  it('does not fall back to the unsafe old US revision when validation of its replacement fails', async () => {
    const active = seedActive('us-usda-branded', true);
    state.rows[0]!.manifest_json = JSON.stringify({ ...JSON.parse(state.rows[0]!.manifest_json), dataRevision: 1 });
    state.invalidDatabase = true;
    const api = await import('@/data/food/countryPacks');
    await expect(api.lookupCountryPackBarcode('00016000322622', { countryCode: 'US' })).rejects.toThrow('Invalid food catalogue database');
    expect(state.rows[0]!.file_name).toBe(active);
    expect(state.connections.filter((item) => item.name === active)).toHaveLength(0);
  });

  it('does not auto-enable or upgrade an explicitly disabled optional pack', async () => {
    seedActive('us-usda-branded', true);
    state.rows[0]!.enabled = 0;
    const api = await import('@/data/food/countryPacks');
    expect(await api.lookupCountryPackBarcode('00016000322622', { countryCode: 'US' })).toBeNull();
    expect(state.imports).toEqual([]);
  });
});
