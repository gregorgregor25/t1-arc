import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dismissUrgentLowOffer,
  loadUrgentLowOffer,
  noteAlarmChoicesPredateUrgentLow,
} from '@/data/glucoseAlerts/urgentLowOffer';

const store = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }),
  };
});
vi.mock('expo-secure-store', () => store);

describe('one-time urgent low offer', () => {
  beforeEach(() => { store.values.clear(); vi.clearAllMocks(); });

  it('is not offered on a new install', async () => {
    expect(await loadUrgentLowOffer()).toBe(false);
  });

  it('is offered after choices that predate urgent low, until dismissed', async () => {
    await noteAlarmChoicesPredateUrgentLow();
    expect(await loadUrgentLowOffer()).toBe(true);
    await dismissUrgentLowOffer();
    expect(await loadUrgentLowOffer()).toBe(false);
    // Loading the same older choices again never brings a dismissed offer back.
    await noteAlarmChoicesPredateUrgentLow();
    expect(await loadUrgentLowOffer()).toBe(false);
  });

  it('treats an unreadable stored value as no offer', async () => {
    store.values.set('t1arc.glucose-alarms.urgent-low-offer.v1', 'surprise');
    expect(await loadUrgentLowOffer()).toBe(false);
    store.getItemAsync.mockRejectedValueOnce(new Error('locked'));
    expect(await loadUrgentLowOffer()).toBe(false);
  });
});
