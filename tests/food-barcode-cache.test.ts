import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  getFirstAsync: vi.fn(),
}));

vi.mock('@/data/persistence/daymarkDatabase', () => ({
  openDaymarkDatabase: vi.fn(async () => database),
  withDaymarkTransaction: vi.fn(),
}));

import { getCachedFoodByBarcode } from '@/data/food/foodLogRepository';

describe('local food barcode cache', () => {
  beforeEach(() => {
    database.getFirstAsync.mockReset();
  });

  it('returns a saved food without requiring a network provider', async () => {
    database.getFirstAsync.mockResolvedValue({
      id: 'user:barcode:5000157071644',
      provider: 'user',
      external_id: 'barcode:5000157071644',
      barcode: '5000157071644',
      name: 'My cereal',
      brand: 'Kitchen',
      image_url: null,
      basis_amount: 30,
      basis_unit: 'g',
      default_serving_amount: 30,
      default_serving_unit: 'g',
      last_portion_amount: 45,
      last_portion_unit: 'g',
      carbohydrate_grams: 21,
      energy_kcal: 150,
      protein_grams: 4,
      fat_grams: 2,
      fibre_grams: 3,
      sugars_grams: 5,
      saturated_fat_grams: 0.4,
      nutrition_quality_json: JSON.stringify({
        carbohydrate: 'reported',
        energy: 'reported',
        protein: 'reported',
        fat: 'reported',
        fibre: 'reported',
        sugars: 'reported',
        saturatedFat: 'reported',
      }),
      source_label: 'My foods',
      source_url: null,
      raw_payload_json: null,
    });

    await expect(
      getCachedFoodByBarcode('5000157071644'),
    ).resolves.toMatchObject({
      id: 'user:barcode:5000157071644',
      barcode: '5000157071644',
      name: 'My cereal',
      lastPortionAmount: 45,
      nutritionPerBasis: { carbohydrateGrams: 21 },
    });

    const [query, barcode] = database.getFirstAsync.mock.calls[0]!;
    expect(query).toContain("CASE provider WHEN 'user' THEN 0 ELSE 1 END");
    expect(barcode).toBe('5000157071644');
  });

  it('returns undefined when the barcode has never been saved', async () => {
    database.getFirstAsync.mockResolvedValue(null);
    await expect(
      getCachedFoodByBarcode('12345678'),
    ).resolves.toBeUndefined();
  });
});
