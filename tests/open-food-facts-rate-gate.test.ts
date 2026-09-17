import { describe, expect, it, vi } from 'vitest';

import {
  OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS,
  createOpenFoodFactsRateGate,
  lookupOpenFoodFactsBarcode,
  searchOpenFoodFactsProducts,
} from '@/data/food/openFoodFacts';

const searchPayload = JSON.stringify({
  hits: [
    {
      code: '5000157071644',
      product_name: 'Heinz baked beans',
      brands: ['Heinz'],
      nutriments: { carbohydrates_100g: 12.5 },
    },
  ],
});

const productPayload = JSON.stringify({
  status: 'success',
  product: {
    code: '5000157071644',
    product_name: 'Heinz baked beans',
    nutriments: { carbohydrates_100g: 12.5 },
  },
});

function controlledGate() {
  let now = 10_000;
  const delays: number[] = [];
  const gate = createOpenFoodFactsRateGate({
    now: () => now,
    wallNow: () => Date.UTC(2026, 7, 18) + now,
    delay: async (milliseconds, signal) => {
      if (signal?.aborted) throw new Error('cancelled');
      delays.push(milliseconds);
      now += milliseconds;
    },
  });
  return {
    gate,
    delays,
    get now() {
      return now;
    },
    set now(value: number) {
      now = value;
    },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe('Open Food Facts endpoint rate gate', () => {
  it('queues deliberate searches instead of returning silently incomplete results', async () => {
    const clock = controlledGate();
    const fetcher = vi.fn(async () => new Response(searchPayload, { status: 200 }));

    await searchOpenFoodFactsProducts('baked beans', fetcher, {
      rateGate: clock.gate,
    });
    await searchOpenFoodFactsProducts('tomato soup', fetcher, {
      rateGate: clock.gate,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(clock.delays).toEqual([
      0,
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.search,
    ]);
  });

  it('uses an independent, faster product-read gate for barcode lookups', async () => {
    const clock = controlledGate();
    const fetcher = vi.fn(async () => new Response(productPayload, { status: 200 }));

    await lookupOpenFoodFactsBarcode('5000157071644', fetcher, {
      rateGate: clock.gate,
    });
    await lookupOpenFoodFactsBarcode('5000157071645', fetcher, {
      rateGate: clock.gate,
    });

    expect(clock.delays).toEqual([
      0,
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.product,
    ]);
  });

  it('honours Retry-After before the next physical request', async () => {
    const clock = controlledGate();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('Busy', {
          status: 429,
          headers: { 'Retry-After': '20' },
        }),
      )
      .mockResolvedValueOnce(new Response(searchPayload, { status: 200 }));

    await expect(
      searchOpenFoodFactsProducts('baked beans', fetcher, {
        rateGate: clock.gate,
      }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    await searchOpenFoodFactsProducts('tomato soup', fetcher, {
      rateGate: clock.gate,
    });

    expect(clock.delays).toEqual([0, 20_000]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('re-checks a later Retry-After while a queued caller is already sleeping', async () => {
    let now = 10_000;
    const pending: { milliseconds: number; release: () => void }[] = [];
    const gate = createOpenFoodFactsRateGate({
      now: () => now,
      wallNow: () => Date.UTC(2026, 7, 18) + now,
      delay: async (milliseconds) => {
        if (milliseconds <= 0) return;
        await new Promise<void>((resolve) => {
          pending.push({
            milliseconds,
            release() {
              now += milliseconds;
              resolve();
            },
          });
        });
      },
    });

    // The first physical request has started. A second caller is then queued
    // on the normal interval while that request is still in flight.
    await gate.waitForTurn('search');
    const queued = gate.waitForTurn('search');
    await flushMicrotasks();
    expect(pending.map((item) => item.milliseconds)).toEqual([
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.search,
    ]);

    gate.observeResponse(
      'search',
      new Response('Busy', {
        status: 429,
        headers: { 'Retry-After': '20' },
      }),
    );
    pending.shift()!.release();
    await flushMicrotasks();

    // The original interval elapsed, but the response imposed a later shared
    // deadline. The queued call must wait the remainder instead of dispatching.
    expect(pending.map((item) => item.milliseconds)).toEqual([13_500]);
    pending.shift()!.release();
    await queued;
  });

  it('cancels a caller waiting behind an earlier queued turn', async () => {
    let releaseFirst!: () => void;
    const gate = createOpenFoodFactsRateGate({
      minimumIntervalMs: { product: 0, search: 0 },
      delay: async () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    });
    const first = gate.waitForTurn('search');
    await flushMicrotasks();

    const controller = new AbortController();
    const second = gate.waitForTurn('search', controller.signal);
    controller.abort();
    await expect(second).rejects.toThrow('cancelled');

    releaseFirst();
    await first;
  });

  it('preserves the remaining interval across a wall-clock rollback', async () => {
    const clock = controlledGate();
    await clock.gate.waitForTurn('search');
    clock.now -= 1_000;
    await clock.gate.waitForTurn('search');

    expect(clock.delays).toEqual([
      0,
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.search,
    ]);
  });

  it('reserves separate slots for concurrent callers before either fetch starts', async () => {
    const clock = controlledGate();
    await Promise.all([
      clock.gate.waitForTurn('product'),
      clock.gate.waitForTurn('product'),
      clock.gate.waitForTurn('product'),
    ]);
    expect(clock.delays).toEqual([
      0,
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.product,
      OPEN_FOOD_FACTS_MINIMUM_INTERVAL_MS.product,
    ]);
  });
});
