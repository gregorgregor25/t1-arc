import { describe, expect, it, vi } from 'vitest';

import { createOpenFoodFactsRateGate, searchOpenFoodFactsPage } from '@/data/food/openFoodFacts';
import { openFoodFactsCountryTag } from '@/data/food/openFoodFactsCountries';

function options() {
  return { rateGate: createOpenFoodFactsRateGate({ minimumIntervalMs: { search: 0, product: 0 } }) };
}

describe('Open Food Facts pages and country taxonomy', () => {
  it('uses provider country IDs rather than generated English names', () => {
    expect(openFoodFactsCountryTag('CZ')).toBe('en:czech-republic');
    expect(openFoodFactsCountryTag('GB')).toBe('en:united-kingdom');
    expect(openFoodFactsCountryTag('DE')).toBe('en:germany');
    expect(openFoodFactsCountryTag('ZZ')).toBeUndefined();
  });

  it('sends explicit page two and preserves continuation when unusable hits were filtered', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      hits: [{ code: '5000157071644', product_name: 'Incomplete bread', nutriments: {} }],
      page_count: 3,
      count: 41,
    })));
    const response = await searchOpenFoodFactsPage('bread', fetcher, {
      ...options(), page: 2, countryCode: 'CZ', languageTag: 'cs-CZ',
    });
    expect(response).toEqual({ foods: [], hasMore: true });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      q: 'bread countries_tags:"en:czech-republic"', page: 2, page_size: 20, langs: ['cs'],
    });
  });

  it('removes country filtering only on an explicit worldwide request', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ hits: [], page_count: 0 })));
    const response = await searchOpenFoodFactsPage('pain', fetcher, {
      ...options(), countryCode: 'FR', languageTag: 'fr-CA', countryScope: 'worldwide',
    });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.q).toBe('pain');
    expect(body.langs).toEqual(['fr']);
    expect(body.fields).toContain('product_name_fr');
    expect(response.hasMore).toBe(false);
  });

  it('bounds remote capacity and does not advertise a page beyond the cap', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ hits: [], page_count: 900 })));
    const response = await searchOpenFoodFactsPage('bread', fetcher, { ...options(), page: 900, pageSize: 900 });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ page: 10, page_size: 50 });
    expect(response.hasMore).toBe(false);
  });

  it('falls back to the raw hit count when older response metadata is absent', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ hits: [
      { code: '5000157071644', product_name: 'Bread', nutriments: {} },
    ] })));
    expect((await searchOpenFoodFactsPage('bread', fetcher, { ...options(), pageSize: 1 })).hasMore).toBe(true);
  });
});
