/** Nightscout's temp-basal percent is a change from the profile rate. */
export function nightscoutBasalPercentOfProfile(change: number | null | undefined) {
  if (change == null || !Number.isFinite(change) || change < -100) {
    return undefined;
  }
  return 100 + change;
}
