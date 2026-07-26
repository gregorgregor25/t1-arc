import { SourceFreshness } from './models';

export const GLUCOSE_CURRENT_AFTER_MINUTES = 6;
export const GLUCOSE_STALE_AFTER_MINUTES = 12;

export function glucoseFreshness(
  readingTimestamp: number | undefined,
  now = Date.now(),
): SourceFreshness {
  if (readingTimestamp === undefined) return 'missing';
  const ageMinutes = (now - readingTimestamp) / 60_000;
  if (ageMinutes <= GLUCOSE_CURRENT_AFTER_MINUTES) return 'current';
  if (ageMinutes <= GLUCOSE_STALE_AFTER_MINUTES) return 'delayed';
  return 'stale';
}

export const freshnessCopy: Record<
  SourceFreshness,
  { label: string; description: string }
> = {
  current: {
    label: 'Current',
    description: 'The latest reading is within the expected update window.',
  },
  delayed: {
    label: 'Delayed',
    description: 'The source has not updated as recently as expected.',
  },
  stale: {
    label: 'Stale',
    description: 'The latest reading is too old to treat as current.',
  },
  missing: {
    label: 'Missing',
    description: 'No reading is available for this source.',
  },
};
