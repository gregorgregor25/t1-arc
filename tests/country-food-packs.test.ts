import { createHash } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import rawManifests from '@/data/food/country-packs.manifest.json';
import {
  type CountryFoodPackManifest, type CountryPackRow, countryPackMatchEvidence,
  countryPackQuery, countryPackRowToFood, installVerifiedCountryPack,
  inflateCountryPackGzip, validateCountryPackManifest, verifyCountryPackChunks,
} from '@/data/food/countryPackValidation';
import { rankFoodSearchSeeds } from '@/data/food/foodSearchRanking';

const packs = rawManifests as CountryFoodPackManifest[];
const digest = async (bytes: Uint8Array<ArrayBuffer>) => createHash('sha256').update(bytes).digest('hex');
const assets = resolve('assets/food-packs');

describe('indexed official food catalogue artifacts', () => {
  for (const pack of packs.filter((entry) => !entry.optional)) {
    it(`${pack.id}: validates the actual file, schema, count, FTS and nutrient rows`, async () => {
      validateCountryPackManifest(pack);
      const path = join(assets, pack.fileName);
      const fd = openSync(path, 'r');
      try {
        await verifyCountryPackChunks(pack, (length) => {
          const bytes = new Uint8Array(length);
          return bytes.subarray(0,readSync(fd,bytes));
        },digest);
      } finally { closeSync(fd); }
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        expect(db.prepare('PRAGMA quick_check').get()).toMatchObject({quick_check:'ok'});
        expect(db.prepare('SELECT count(*) AS n FROM foods').get()).toMatchObject({n:pack.foodCount});
        const query = pack.id === 'fr-ciqual' ? 'pain' : pack.id === 'de-bls' ? 'hafer' : 'cheese';
        const rows = db.prepare(`SELECT f.* FROM food_search s JOIN foods f ON f.rowid=s.rowid
          WHERE food_search MATCH ? ORDER BY bm25(food_search) LIMIT 20`).all(countryPackQuery(query)) as unknown as CountryPackRow[];
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          const candidate = countryPackRowToFood(row,pack,'en-GB');
          expect(candidate).not.toBeNull();
          expect(candidate!.nutrientDefinitions?.carbohydrate).toBe(pack.carbohydrateDefinition);
          expect(candidate!.basisAmount).toBe(100);
        }
        const rowsAll = db.prepare('SELECT * FROM foods').all() as unknown as CountryPackRow[];
        expect(rowsAll.filter((row) => !countryPackRowToFood(row,pack)).length).toBe(0);
        expect(db.prepare('EXPLAIN QUERY PLAN SELECT * FROM foods WHERE barcode=?').all('00076014101088')
          .some((row) => String(row.detail).includes('foods_barcode'))).toBe(true);
      } finally { db.close(); }
    });
  }

  it('preserves the actual CNF source numbers and bilingual rank evidence', () => {
    const pack = packs.find((p) => p.id === 'ca-cnf')!;
    const db = new DatabaseSync(join(assets,pack.fileName),{readOnly:true});
    try {
      const row = db.prepare("SELECT * FROM foods WHERE source_id='2'").get() as unknown as CountryPackRow;
      const candidate = countryPackRowToFood(row,pack,'fr-CA')!;
      expect(candidate.name).toBe('Soufflé au fromage');
      expect(candidate.nutritionPerBasis).toMatchObject({ carbohydrateGrams:5.911, energyKcal:204, proteinGrams:9.54415, fatGrams:15.7047 });
      expect(rankFoodSearchSeeds('cheese souffle',[{food:candidate,origins:['offline-catalogue'],searchEvidence:{query:'cheese souffle',rank:0,...countryPackMatchEvidence(candidate)}}])).toHaveLength(1);
      expect(countryPackRowToFood({...row,carbs:NaN},pack)).toBeNull();
      expect(countryPackRowToFood({...row,carbs:-1},pack)).toBeNull();
      expect(countryPackRowToFood({...row,names_json:'not json'},pack)).toBeNull();
    } finally { db.close(); }
  });

  it('keeps trace values unknown rather than adding an invented zero', () => {
    const pack = packs.find((p) => p.id === 'fr-ciqual')!;
    const db = new DatabaseSync(join(assets,pack.fileName),{readOnly:true});
    try {
      const row = db.prepare(`SELECT * FROM foods WHERE quality_json LIKE '%trace%' LIMIT 1`).get() as unknown as CountryPackRow;
      const candidate = countryPackRowToFood(row,pack)!;
      const keys = ['carbohydrateGrams','energyKcal','proteinGrams','fatGrams','fibreGrams','sugarsGrams','saturatedFatGrams'] as const;
      const quality = JSON.parse(row.quality_json) as string[];
      quality.forEach((status,index) => { if(status==='trace') expect(candidate.nutritionPerBasis[keys[index]!]).toBeUndefined(); });
    } finally { db.close(); }
  });

  it('preserves real numeric zeros from the original BLS spreadsheet', () => {
    const pack = packs.find((p) => p.id === 'de-bls')!;
    const db = new DatabaseSync(join(assets,pack.fileName),{readOnly:true});
    try {
      const row = db.prepare("SELECT * FROM foods WHERE source_id='N110000'").get() as unknown as CountryPackRow;
      expect(JSON.parse(row.names_json)).toMatchObject({ en: 'Drinking water', de: 'Trinkwasser' });
      expect(JSON.parse(row.quality_json)).toEqual(Array(7).fill('reported'));
      expect(countryPackRowToFood(row,pack)!.nutritionPerBasis).toMatchObject({
        carbohydrateGrams: 0, energyKcal: 0, proteinGrams: 0, fatGrams: 0,
        fibreGrams: 0, sugarsGrams: 0, saturatedFatGrams: 0,
      });
    } finally { db.close(); }
  });

  it('packages the large optional US snapshot as a compressed asset with verified chunks', async () => {
    const pack = packs.find((p) => p.id === 'us-usda-branded')!;
    expect(pack.optional).toBe(true);
    expect(pack.bundled).toBe(true);
    expect(pack.foodCount).toBeGreaterThan(300000);
    expect(pack.compressedBytes).toBeLessThan(45*1024*1024);
    const fd = openSync(join(assets,pack.assetFileName!),'r');
    try {
      await verifyCountryPackChunks({...pack,sizeBytes:pack.compressedBytes,sha256:pack.compressedSha256!,chunkSha256:pack.compressedChunkSha256!},(length) => {
        const bytes = new Uint8Array(length);
        return bytes.subarray(0,readSync(fd,bytes));
      },digest);
    } finally { closeSync(fd); }
  });

  it('stream-expands the real US asset to disk and retrieves an indexed barcode without loading the database into JS', async () => {
    const pack=packs.find((p)=>p.id==='us-usda-branded')!;
    const directory=mkdtempSync(join(tmpdir(),'t1arc-public-food-pack-test-'));
    const path=join(directory,'catalogue.db');
    const input=openSync(join(assets,pack.assetFileName!),'r');
    const output=openSync(path,'w');
    const hash=createHash('sha256');
    let largestRead=0;
    try {
      await inflateCountryPackGzip(pack,(length)=>{
        largestRead=Math.max(largestRead,length);
        const bytes=new Uint8Array(length);
        return bytes.subarray(0,readSync(input,bytes));
      },(chunk)=>{writeSync(output,chunk);hash.update(chunk);});
    } finally { closeSync(input);closeSync(output); }
    try {
      expect(largestRead).toBeLessThanOrEqual(16384);
      expect(hash.digest('hex')).toBe(pack.sha256);
      const db=new DatabaseSync(path,{readOnly:true});
      try {
        expect(db.prepare('PRAGMA quick_check').get()).toMatchObject({quick_check:'ok'});
        expect(db.prepare('SELECT count(*) AS n FROM foods').get()).toMatchObject({n:pack.foodCount});
        const example=db.prepare('SELECT barcode FROM foods LIMIT 1').get() as { barcode: string };
        const row=db.prepare('SELECT * FROM foods WHERE barcode=?').get(example.barcode) as unknown as CountryPackRow;
        expect(countryPackRowToFood(row,pack)).not.toBeNull();
        const volumeRow=db.prepare("SELECT * FROM foods WHERE serving_unit='ml' AND serving_label <> '' AND carbs <= 100 LIMIT 1").get() as unknown as CountryPackRow;
        expect(volumeRow).toBeDefined();
        expect(volumeRow.serving_unit).toBe('ml');
        const volumeCandidate=countryPackRowToFood(volumeRow,pack)!;
        expect(volumeCandidate.basisUnit).toBe('ml');
        expect(volumeCandidate.defaultServingUnit).toBe('ml');
        expect(volumeCandidate.defaultServingAmount).toBe(volumeRow.serving_amount);
        expect(volumeCandidate.servingLabel).toBe(volumeRow.serving_label);
        const incompatibleVolume = countryPackRowToFood({ ...volumeRow, basis_unit: 'g' }, pack)!;
        expect(incompatibleVolume.defaultServingUnit).toBe('g');
        expect(incompatibleVolume.defaultServingAmount).toBe(100);
        expect(incompatibleVolume.servingLabel).toBeUndefined();
        expect(volumeCandidate.catalogueObservedAt).toBe(Date.UTC(2026,3,30));
        expect(db.prepare("SELECT * FROM foods WHERE source_id='2517161'").get()).toBeUndefined();
        const cheerios=db.prepare("SELECT * FROM foods WHERE source_id='2738631'").get() as unknown as CountryPackRow;
        expect(countryPackRowToFood(cheerios,pack)).toMatchObject({ basisUnit: 'g', defaultServingAmount: 28, servingLabel: '1 bowl', nutritionPerBasis: { carbohydrateGrams: 75 } });
        const conflicting = db.prepare("SELECT * FROM foods WHERE nutrient_conflicts_json LIKE '%carbs%' LIMIT 1").get() as unknown as CountryPackRow;
        const incomplete = countryPackRowToFood(conflicting,pack)!;
        expect(incomplete.nutritionPerBasis.carbohydrateGrams).toBeUndefined();
        expect(incomplete.nutritionQuality.carbohydrate).toBe('missing');
        expect(incomplete.nutrientDefinitions?.note).toContain('Conflicting source carbohydrate');
        expect(db.prepare("SELECT source_date FROM foods WHERE source_date LIKE '%/%' LIMIT 1").get()).toBeUndefined();
      } finally { db.close(); }
    } finally { unlinkSync(path);rmdirSync(directory); }
  },30000);
});

describe('pack installation boundary', () => {
  it('rejects corruption, truncation and appended bytes before activation', async () => {
    const pack = packs.find((p) => p.id==='ca-cnf')!;
    const original = readFileSync(join(assets,pack.fileName));
    for (const kind of ['corrupt','truncated','appended']) {
      const bytes = Uint8Array.from(kind==='truncated' ? original.subarray(0,-1) : kind==='appended' ? Buffer.concat([original,Buffer.from([0])]) : original);
      if(kind==='corrupt') bytes[4096] = (bytes[4096] ?? 0)^0xff;
      let offset=0;
      await expect(verifyCountryPackChunks(pack,(n) => {const out=bytes.slice(offset,offset+n);offset+=out.length;return out;},digest)).rejects.toThrow();
    }
  });

  it.each(['verify','cancel','commit'])('a %s failure keeps the prior working pack and discards staging', async (failure) => {
    const previous='known-working.db';
    let active=previous;
    let discarded=false;
    const controller=new AbortController();
    await expect(installVerifiedCountryPack({
      prepare:async ()=>'replacement.pending.db',
      verify:async ()=>{if(failure==='verify') throw new Error('checksum mismatch');if(failure==='cancel') controller.abort();},
      activate:async (file)=>{if(failure==='commit') throw new Error('registry write failed');active=file;},
      discard:async ()=>{discarded=true;},
    },controller.signal)).rejects.toThrow();
    expect(active).toBe(previous);
    expect(discarded).toBe(true);
  });

  it('requires a trusted safe manifest and parameterizes FTS syntax', () => {
    expect(countryPackQuery('rice" OR 1=1; --')).toBe('"rice"* AND "or"* AND "1"* AND "1"*');
    expect(countryPackQuery('épinard')).toBe('"epinard"*');
    expect(countryPackQuery('*')).toBeNull();
    expect(() => validateCountryPackManifest({...packs[0]!,fileName:'../health.db'})).toThrow();
    expect(() => validateCountryPackManifest({...packs[0]!,chunkSha256:[]})).toThrow();
  });
});
