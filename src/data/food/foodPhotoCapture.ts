import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import FoodLabelModule from '../../../modules/t1arc-food-label';
import { isProductPhotoUrl, validateFoodPhoto } from './foodPhotoPolicy';

export async function prepareFoodPhoto(cameraUri: string, consume = true) {
  const prefix = `${Paths.cache.uri.replace(/\/$/, '')}/Camera/`;
  if (!cameraUri.startsWith(prefix) || !/^[a-fA-F0-9-]+\.jpg$/.test(cameraUri.slice(prefix.length))) throw new Error('Take a new photo in the app.');
  const original = new File(cameraUri);
  let copy: File | undefined;
  try {
    if (!FoodLabelModule?.preparePhotoAsync) throw new Error('Photo capture needs the updated Android app.');
    const directory = new Directory(Paths.cache, 'food-label-capture');
    await directory.create({ idempotent: true, intermediates: true });
    copy = new File(directory, `label-${randomUUID()}.jpg`);
    await original.copy(copy);
    return validateFoodPhoto(await FoodLabelModule.preparePhotoAsync(copy.uri));
  } finally {
    if (copy?.exists) await copy.delete();
    if (consume && original.exists) await original.delete();
  }
}

let downloads = 0;
const waiting: (() => void)[] = [];
const pending = new Map<string, Promise<string>>();

async function downloadProductPhoto(url: string) {
  if (downloads >= 2) await new Promise<void>(resolve => { waiting.push(resolve); });
  else downloads++;
  try { return validateFoodPhoto(await FoodLabelModule!.productPhotoAsync(url)); }
  finally { const next = waiting.shift(); if (next) next(); else downloads--; }
}

export async function loadProductPhoto(url: string) {
  if (!isProductPhotoUrl(url) || !FoodLabelModule?.productPhotoAsync) throw new Error('The product photo is unavailable.');
  const existing = pending.get(url);
  if (existing) return existing;
  const request = downloadProductPhoto(url).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}
