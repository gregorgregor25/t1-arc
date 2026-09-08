import { isTarvisEntry, type TarvisEntry } from '@/domain/tarvisEntry';

/** Capture a selection once, before sending can yield to a newer navigation. */
export function captureTarvisEntry(
  entry: TarvisEntry | undefined,
  question: string,
  ownerIdentity: string | undefined,
): TarvisEntry | undefined {
  if (!isTarvisEntry(entry) || !ownerIdentity ||
    entry.ownerIdentity !== ownerIdentity || entry.question !== question) return undefined;
  return { ...entry, range: { ...entry.range } };
}

/** An older failed request may restore its text only while its composer is unchanged. */
export function createTarvisComposerLifecycle() {
  let revision = 0;
  return {
    replaceDraft() { revision += 1; },
    beginRequest() {
      const requestRevision = ++revision;
      return { canRestoreDraft: () => revision === requestRevision };
    },
  };
}
