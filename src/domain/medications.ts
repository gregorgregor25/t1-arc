import { MedicationEvent } from './models';

export interface MedicationPreset {
  key: string;
  title: string;
  amount?: number;
  unit?: string;
  lastLoggedAt: number;
  useCount: number;
}

export function medicationPresets(events: MedicationEvent[], limit = 6) {
  const presets = new Map<string, MedicationPreset>();
  for (const event of [...events].sort((left, right) => right.start - left.start)) {
    const title = event.title.trim();
    const unit = event.unit?.trim();
    const key = [
      title.toLocaleLowerCase('en-GB'),
      event.amount ?? '',
      unit?.toLocaleLowerCase('en-GB') ?? '',
    ].join('|');
    const existing = presets.get(key);
    if (existing) {
      existing.useCount += 1;
      continue;
    }
    presets.set(key, {
      key,
      title,
      amount: event.amount,
      unit,
      lastLoggedAt: event.start,
      useCount: 1,
    });
  }
  return [...presets.values()]
    .sort(
      (left, right) =>
        right.useCount - left.useCount ||
        right.lastLoggedAt - left.lastLoggedAt,
    )
    .slice(0, Math.max(0, Math.min(20, Math.floor(limit))));
}
