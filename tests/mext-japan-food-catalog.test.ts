import { describe, expect, it } from 'vitest';

import {
  MEXT_JAPAN_CATALOG_INFO,
  getMextJapanFood,
  searchMextJapanFoods,
} from '@/data/food/mextJapanCatalog';
import { normaliseFoodSearchText } from '@/data/food/foodSearchRanking';

describe('offline Japanese food catalogue', () => {
  it('ships the attributable official MEXT 2023 dataset', () => {
    expect(MEXT_JAPAN_CATALOG_INFO.foodCount).toBe(2_538);
    expect(MEXT_JAPAN_CATALOG_INFO.dataset).toContain('増補2023年');
    expect(MEXT_JAPAN_CATALOG_INFO.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(MEXT_JAPAN_CATALOG_INFO.licence).toContain('reuse permitted');
  });

  it('preserves Japanese characters through the shared search boundary', () => {
    expect(normaliseFoodSearchText('  ご飯（精白米）  ')).toBe('こ\u3099飯 精白米');
    expect(normaliseFoodSearchText('apple, baked')).toBe('apple baked');
  });

  it('finds Japanese foods locally and exposes canonical per-100g nutrients', () => {
    const result = searchMextJapanFoods('りんご 生', 10)[0];
    expect(result).toBeDefined();
    expect(result).toMatchObject({
      provider: 'mext-jp',
      basisAmount: 100,
      basisUnit: 'g',
      sourceLabel: MEXT_JAPAN_CATALOG_INFO.dataset,
    });
    expect(result!.name).toContain('りんご');
    expect(result!.nutritionPerBasis.carbohydrateGrams).toBeTypeOf('number');
    expect(getMextJapanFood(result!.id)).toEqual(result);
  });

  it('supports compound Japanese queries without network lookup', () => {
    const results = searchMextJapanFoods('うし もも 焼き', 20);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((result) => result.name.includes('うし'))).toBe(true);
  });
});
