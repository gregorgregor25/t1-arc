import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  carbRatioAtLocalMinute,
  clearTarvisTreatmentProfile,
  loadTarvisTreatmentProfile,
  saveTarvisTreatmentProfile,
} from '@/data/tarvis/treatmentProfile';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock('expo-secure-store', () => secureStore);

describe('Tarv1s treatment profile', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('saves a sorted, bounded manual schedule', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(123_456);
    const profile = await saveTarvisTreatmentProfile([
      { id: 'evening', startMinute: 18 * 60, gramsPerUnit: 12 },
      { id: 'morning', startMinute: 0, gramsPerUnit: 9.54 },
    ]);
    expect(profile.carbRatioSchedule).toEqual([
      { id: 'morning', startMinute: 0, gramsPerUnit: 9.5 },
      { id: 'evening', startMinute: 1080, gramsPerUnit: 12 },
    ]);
    expect(carbRatioAtLocalMinute(profile, 60)?.gramsPerUnit).toBe(9.5);
    expect(carbRatioAtLocalMinute(profile, 1_200)?.gramsPerUnit).toBe(12);
    expect(secureStore.setItemAsync).toHaveBeenCalledOnce();
  });

  it('fails closed for corrupt or unsafe saved values', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        schemaVersion: 1,
        source: 'manual',
        confirmedAt: 123,
        carbRatioSchedule: [
          { id: 'bad', startMinute: 0, gramsPerUnit: 0.1 },
        ],
      }),
    );
    await expect(loadTarvisTreatmentProfile()).rejects.toThrow(
      'could not be read safely',
    );
  });

  it('clears the local profile explicitly', async () => {
    await clearTarvisTreatmentProfile();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledOnce();
  });
});
