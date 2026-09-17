import type { SQLiteDatabase } from 'expo-sqlite';
import { openT1ArcDatabase, withT1ArcTransaction } from '@/data/persistence/t1arcDatabase';
import { acquireLocalDataWriteLease, assertLocalDataWriteLeaseInTransaction } from '@/data/privacy/localDataWriteEpoch';
import { FOOD_PHOTO_COLUMNS, isProductPhotoUrl, validateFoodPhoto, type FoodPhotoOwner } from './foodPhotoPolicy';

export async function readFoodPhoto(owner: FoodPhotoOwner) {
  const db = await openT1ArcDatabase();
  const row = await db.getFirstAsync<{ image_data: string; source_url: string | null }>('SELECT image_data, source_url FROM food_photos WHERE id = ?', `${owner.kind}:${owner.id}`);
  return row ? { uri: row.image_data, sourceUrl: row.source_url ?? undefined } : undefined;
}

export async function writeFoodPhotoInTransaction(db: SQLiteDatabase, owner: FoodPhotoOwner, photo: string | null | undefined, sourceUrl?: string, cacheOnly = false) {
  if (photo === undefined) return;
  const id = `${owner.kind}:${owner.id}`;
  if (photo === null) { await db.runAsync('DELETE FROM food_photos WHERE id = ?', id); return; }
  validateFoodPhoto(photo);
  const column = FOOD_PHOTO_COLUMNS[owner.kind];
  await db.runAsync(`INSERT INTO food_photos (id, ${column}, image_data, source_url, created_at_ms) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) ${cacheOnly ? 'DO NOTHING' : 'DO UPDATE SET image_data = excluded.image_data, source_url = excluded.source_url, created_at_ms = excluded.created_at_ms'}`,
  id, owner.id, photo, sourceUrl ?? null, Date.now());
}

export async function cacheProductPhoto(owner: FoodPhotoOwner, load: () => Promise<string>, sourceUrl: string) {
  if (owner.kind !== 'food' || !isProductPhotoUrl(sourceUrl)) throw new Error('Unsupported product photo.');
  const lease = await acquireLocalDataWriteLease();
  let photo = validateFoodPhoto(await load());
  await withT1ArcTransaction(async db => {
    await assertLocalDataWriteLeaseInTransaction(db, lease);
    // Only cache images for foods already retained by a user action.
    if (!await db.getFirstAsync('SELECT id FROM food_catalog_cache WHERE id = ?', owner.id)) return;
    await writeFoodPhotoInTransaction(db, owner, photo, sourceUrl, true);
    const saved = await db.getFirstAsync<{ image_data: string }>('SELECT image_data FROM food_photos WHERE id = ?', `food:${owner.id}`);
    if (saved) photo = saved.image_data;
  });
  return photo;
}
