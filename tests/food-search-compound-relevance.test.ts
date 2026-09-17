import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import rawManifests from '@/data/food/country-packs.manifest.json';
import {
  type CountryFoodPackManifest, type CountryPackRow, countryPackMatchEvidence,
  countryPackQuery, countryPackRowToFood,
} from '@/data/food/countryPackValidation';
import { searchCofidFoods } from '@/data/food/cofidCatalog';
import { createFoodSearchEngine } from '@/data/food/foodSearch';
import { type FoodSearchSeed, rankFoodSearchSeeds } from '@/data/food/foodSearchRanking';

const reference = searchCofidFoods('bread')[0]!;
function seed(id: string, name: string, query: string, rank: number, fields: string[] = []): FoodSearchSeed {
  return {
    food: { ...reference, id, externalId: id, name },
    origins: ['offline-catalogue'],
    searchEvidence: { query, rank, fields },
  };
}

describe('whole-word food search relevance', () => {
  it.each([
    ['bread', 'Breadfruit raw', 'White bread'],
    ['egg', 'Eggplant raw', 'Boiled egg'],
    ['brot', 'Brotfrucht roh', 'Roggen Brot'],
  ])('ranks complete %s words before unrelated compound prefixes', (query, compound, wholeWord) => {
    const ranked = rankFoodSearchSeeds(query, [
      seed('compound', compound, query, 0),
      seed('whole-word', wholeWord, query, 10),
    ]);
    expect(ranked.map(({ food, match }) => [food.id, match])).toEqual([
      ['whole-word', 'tokens'], ['compound', 'fuzzy'],
    ]);
  });

  it('keeps real phrase prefixes above token matches and partial-word typeahead available', () => {
    expect(rankFoodSearchSeeds('bread', [
      seed('token', 'White bread', 'bread', 0),
      seed('phrase', 'Bread with seeds', 'bread', 1),
    ]).map(({ food, match }) => [food.id, match])).toEqual([
      ['phrase', 'prefix'], ['token', 'tokens'],
    ]);
    expect(rankFoodSearchSeeds('brea', [seed('partial', 'Bread with seeds', 'brea', 0)])).toHaveLength(1);
  });

  it('applies the same word boundary to bilingual aliases and preserves same-tier upstream order', () => {
    const ranked = rankFoodSearchSeeds('brot', [
      seed('fruit', 'Breadfruit raw', 'brot', 0, ['Brotfrucht roh']),
      seed('rye', 'Rye bread', 'brot', 1, ['Roggenbrot', 'Brot']),
      seed('wheat', 'White bread', 'brot', 2, ['Weizenbrot', 'Brot']),
    ]);
    expect(ranked.map(({ food, match }) => [food.id, match])).toEqual([
      ['rye', 'tokens'], ['wheat', 'tokens'], ['fruit', 'fuzzy'],
    ]);
  });

  it('retains unsegmented Japanese prefix matches', () => {
    expect(rankFoodSearchSeeds('米', [seed('rice', '米粉', '米', 0)])[0]?.match).toBe('prefix');
    expect(rankFoodSearchSeeds('ご', [seed('rice', 'ごはん', 'ご', 0)])[0]?.match).toBe('prefix');
  });

  it.each(['en-GB', 'de-DE'])('finds actual BLS bread records before breadfruit for brot in %s', async (locale) => {
    const pack = (rawManifests as CountryFoodPackManifest[]).find(({ id }) => id === 'de-bls')!;
    const db = new DatabaseSync(join(resolve('assets/food-packs'), pack.fileName), { readOnly: true });
    try {
      const engine = createFoodSearchEngine({
        loadStoredCandidates: async () => [],
        providers: [{
          id: 'de-bls', label: pack.label, kind: 'offline',
          matchEvidence: countryPackMatchEvidence,
          search(query, { limit }) {
            // The same bounded FTS retrieval used by the on-device country pack.
            const rows = db.prepare(`SELECT f.* FROM food_search s JOIN foods f ON f.rowid=s.rowid
              WHERE food_search MATCH ? ORDER BY bm25(food_search), f.source_id LIMIT ?`)
              .all(countryPackQuery(query), limit) as unknown as CountryPackRow[];
            return rows.flatMap((row) => {
              const candidate = countryPackRowToFood(row, pack, locale);
              return candidate ? [candidate] : [];
            });
          },
        }],
      });
      const result = await engine.search('brot', { limit: 20, mode: 'typeahead' });
      const ids = result.results.map(({ food }) => food.externalId);
      expect(ids).toContain('B221000'); // Original BLS Roggenbrot.
      expect(ids).not.toContain('F523100'); // Brotfrucht remains a lower-confidence match.
      expect(ids).toHaveLength(20);
      expect(ids.every((id) => id.startsWith('B'))).toBe(true);
      const more = await engine.search('brot', { limit: 40, mode: 'typeahead' });
      expect(more.results.map(({ food }) => food.externalId)).toContain('B311000'); // Original BLS Weizenbrot/Weißbrot.
      const fruit = await engine.search('Brotfrucht', { limit: 20, mode: 'typeahead' });
      expect(fruit.results[0]?.food.externalId).toBe('F523100');
      const fruitRow = db.prepare('SELECT * FROM foods WHERE source_id=?').get('F523100') as unknown as CountryPackRow;
      expect(JSON.parse(fruitRow.aliases_json)).not.toContain('Brot');
      expect(result.providers[0]?.state).toBe('success');
    } finally { db.close(); }
  });
});
