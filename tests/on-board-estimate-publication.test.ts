import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetPublishedOnBoardEstimate,
  nightscoutOnBoardPublication,
  onBoardEstimatesSupported,
  publishOnBoardEstimate,
} from '@/data/glucoseDisplay/onBoardEstimatePublication';

const NOW = Date.UTC(2026, 10, 2, 12);

describe('Nightscout insulin and carbs on board for glance surfaces', () => {
  it('keeps negative IOB and zero COB as values', () => {
    expect(nightscoutOnBoardPublication({ iobUnits: -0.4, cobGrams: 0, timestamp: NOW })).toEqual({
      provenance: 'nightscout', iobUnits: -0.4, cobGrams: 0, receivedAt: NOW,
    });
  });

  it('omits a missing value instead of sending zero', () => {
    const published = nightscoutOnBoardPublication({ iobUnits: 1.35, timestamp: NOW });
    expect(published).toEqual({ provenance: 'nightscout', iobUnits: 1.35, receivedAt: NOW });
    expect(published).not.toHaveProperty('cobGrams');
  });

  it('clears when there is nothing valid to show', () => {
    expect(nightscoutOnBoardPublication(undefined)).toBeNull();
    expect(nightscoutOnBoardPublication({ timestamp: NOW })).toBeNull();
    expect(nightscoutOnBoardPublication({ iobUnits: Number.NaN, cobGrams: -3, timestamp: NOW }))
      .toBeNull();
    expect(nightscoutOnBoardPublication({ iobUnits: 1, timestamp: Number.NaN })).toBeNull();
    expect(nightscoutOnBoardPublication({ iobUnits: 1, timestamp: 0 })).toBeNull();
  });

  it('sends a whole-millisecond report time', () => {
    expect(nightscoutOnBoardPublication({ cobGrams: 12, timestamp: NOW + 0.6 })?.receivedAt)
      .toBe(NOW + 1);
  });
});

describe('publishing the estimate to the native glance surfaces', () => {
  const update = vi.fn(async (_epoch: number, _generation: number, _estimate: unknown) => true);
  const bridge = { updateOnBoardEstimateForWriteEpochAsync: update };
  const estimate = nightscoutOnBoardPublication({ iobUnits: 1.35, cobGrams: 20, timestamp: NOW });

  beforeEach(() => {
    forgetPublishedOnBoardEstimate();
    update.mockReset();
    update.mockResolvedValue(true);
  });

  it('skips an unchanged estimate so periodic syncs do not redraw the notification', async () => {
    await expect(publishOnBoardEstimate(bridge, 3, 7, estimate)).resolves.toBe(true);
    await expect(publishOnBoardEstimate(bridge, 3, 7, estimate)).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(3, 7, estimate);
  });

  it('sends again after a new epoch, selection, value or a cleared snapshot', async () => {
    await publishOnBoardEstimate(bridge, 3, 7, estimate);
    await publishOnBoardEstimate(bridge, 4, 7, estimate);
    await publishOnBoardEstimate(bridge, 4, 8, estimate);
    await publishOnBoardEstimate(bridge, 4, 8, null);
    forgetPublishedOnBoardEstimate();
    await publishOnBoardEstimate(bridge, 4, 8, null);
    expect(update).toHaveBeenCalledTimes(5);
  });

  it('retries after a rejected or failed publication without throwing', async () => {
    update.mockResolvedValueOnce(false);
    await expect(publishOnBoardEstimate(bridge, 3, 7, estimate)).resolves.toBe(false);
    update.mockRejectedValueOnce(new Error('native failure'));
    await expect(publishOnBoardEstimate(bridge, 3, 7, estimate)).resolves.toBe(false);
    await expect(publishOnBoardEstimate(bridge, 3, 7, estimate)).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('does nothing on a native build without the bridge', async () => {
    await expect(publishOnBoardEstimate({}, 3, 7, estimate)).resolves.toBe(false);
  });

  it('reports the setting only on native builds that support it', () => {
    expect(onBoardEstimatesSupported({ supported: true, onBoardEstimatesVisible: false })).toBe(true);
    expect(onBoardEstimatesSupported({ supported: true })).toBe(false);
    expect(onBoardEstimatesSupported({ supported: false, onBoardEstimatesVisible: true })).toBe(false);
    expect(onBoardEstimatesSupported(undefined)).toBe(false);
  });
});
