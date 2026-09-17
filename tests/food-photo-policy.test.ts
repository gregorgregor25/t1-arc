import { describe, expect, it } from 'vitest';
import { FOOD_PHOTO } from './fixtures/food-photo';
import { isProductPhotoUrl, validateFoodPhoto } from '@/data/food/foodPhotoPolicy';
import { parseFoodNutritionLabel } from '@/data/food/foodLabelCapture';
import { customFoodFormFromLabelDraft } from '@/components/foodLogger/labelPresentation';
import { EMPTY_CUSTOM_FOOD, customFoodDraftFromForm, customFoodFormFromCandidate } from '@/components/foodLogger/myFoodPresentation';
import { createUserFoodCandidate } from '@/data/food/userFood';

describe('private food photo boundary', () => {
  it('accepts the normalized JPEG and rejects metadata, malformed data and oversized images', () => {
    expect(validateFoodPhoto(FOOD_PHOTO)).toBe(FOOD_PHOTO);
    const jpeg = Buffer.from(FOOD_PHOTO.split(',')[1]!, 'base64');
    const withMetadata = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([255, 225, 0, 8, 69, 120, 105, 102, 0, 0]), jpeg.subarray(2)]);
    expect(() => validateFoodPhoto(`data:image/jpeg;base64,${withMetadata.toString('base64')}`)).toThrow(/metadata/);
    for (const bad of ['file:///private.jpg', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,AAAA', `data:image/jpeg;base64,${'A'.repeat(400000)}`]) expect(() => validateFoodPhoto(bad)).toThrow();
  });
  it('restricts downloads to the product image host over HTTPS', () => {
    expect(isProductPhotoUrl('https://images.openfoodfacts.org/images/products/1.jpg')).toBe(true);
    for (const url of ['http://images.openfoodfacts.org/1.jpg', 'https://images.openfoodfacts.org.evil.test/1.jpg', 'https://user:password@images.openfoodfacts.org/1.jpg', 'https://images.openfoodfacts.org:8080/1.jpg', 'file:///private.jpg']) expect(isProductPhotoUrl(url)).toBe(false);
  });
});

describe('reviewed label to saved food', () => {
  const regional = { countryCode: 'GB', energyUnit: 'kcal' as const, locale: 'en-GB', measurementSystem: 'metric' as const };
  it.each(['uk-eu', 'us', 'other'] as const)('preserves barcode, photo and printed carbohydrate for %s labels', convention => {
    const parsed = parseFoodNutritionLabel('Per 100 g\nCarbohydrate 37 g\nof which sugars 10 g\nFibre 4 g\nFat 8 g\nof which saturates 2 g');
    const form = customFoodFormFromLabelDraft({ ...EMPTY_CUSTOM_FOOD, name: 'Test food', photoData: FOOD_PHOTO }, { ...parsed, labelConvention: convention }, regional);
    const draft = customFoodDraftFromForm(form, '012345678905', regional);
    expect(draft).toMatchObject({ barcode: '012345678905', photoData: FOOD_PHOTO, servingAmount: 100, servingUnit: 'g', nutritionPerServing: { carbohydrateGrams: 37, sugarsGrams: 10, fibreGrams: 4, saturatedFatGrams: 2 } });
    const food = createUserFoodCandidate(draft);
    expect(food.nutrientDefinitions?.carbohydrate).toBe(convention === 'uk-eu' ? 'available' : convention === 'us' ? 'total' : 'unknown');
    expect(customFoodFormFromCandidate(food, regional).labelConvention).toBe(convention);
  });
});
