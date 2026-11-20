import * as SecureStore from 'expo-secure-store';

/**
 * Remembers the one-time offer to add urgent low for someone whose alarm
 * choices predate it. Holds no glucose values or alarm choices.
 */
const URGENT_LOW_OFFER_KEY = 't1arc.glucose-alarms.urgent-low-offer.v1';

type UrgentLowOfferState = 'pending' | 'dismissed';

async function read(): Promise<UrgentLowOfferState | null> {
  try {
    const value = await SecureStore.getItemAsync(URGENT_LOW_OFFER_KEY);
    return value === 'pending' || value === 'dismissed' ? value : null;
  } catch {
    return null;
  }
}

/** True while the offer should still be shown. */
export async function loadUrgentLowOffer(): Promise<boolean> {
  return (await read()) === 'pending';
}

/** Called when saved choices predate urgent low. Never revives a dismissed offer. */
export async function noteAlarmChoicesPredateUrgentLow(): Promise<void> {
  if ((await read()) === null) await SecureStore.setItemAsync(URGENT_LOW_OFFER_KEY, 'pending');
}

/** The user dismissed the offer, or saved choices with urgent low on. */
export async function dismissUrgentLowOffer(): Promise<void> {
  await SecureStore.setItemAsync(URGENT_LOW_OFFER_KEY, 'dismissed');
}
