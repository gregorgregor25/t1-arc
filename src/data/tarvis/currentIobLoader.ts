import type { AapsContextObservation } from "@/data/aaps/types";
import type { NightscoutIobCobSnapshot } from "@/data/nightscout/types";

/** The latest insulin-on-board estimate AAPS or Nightscout reported. */
export interface CurrentIobEstimate {
  provenance: "aaps" | "nightscout";
  iobUnits: number;
  bolusIobUnits?: number;
  basalIobUnits?: number;
  /** When the estimate was received (AAPS) or reported (Nightscout). */
  receivedAt: number;
}

export type CurrentIobLoader = (now: number) => Promise<CurrentIobEstimate | undefined>;

interface CurrentIobSources {
  aaps(): Promise<AapsContextObservation | undefined>;
  nightscout(now: number): Promise<NightscoutIobCobSnapshot | undefined>;
}

const DEFAULT_SOURCES: CurrentIobSources = {
  aaps: async () => (await import("@/data/aaps/localAapsSource")).getLatestAapsContext(),
  nightscout: async (now) =>
    (await import("@/data/nightscout/iobCobStore")).loadDisplayableNightscoutIobCobSnapshot(now),
};

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

/**
 * Reads the estimate the Today card shows: AAPS on this phone when it is the
 * selected source, otherwise the saved Nightscout status. T1 Arc never
 * calculates insulin on board itself. Only live data has an estimate.
 */
export function createCurrentIobLoader(
  dataMode: string,
  sources: CurrentIobSources = DEFAULT_SOURCES,
): CurrentIobLoader | undefined {
  if (dataMode !== "live") return undefined;
  return async (now) => {
    const aaps = await sources.aaps();
    if (aaps) {
      return finite(aaps.iobUnits)
        ? {
            provenance: "aaps",
            iobUnits: aaps.iobUnits,
            ...(finite(aaps.bolusIobUnits) ? { bolusIobUnits: aaps.bolusIobUnits } : {}),
            ...(finite(aaps.basalIobUnits) ? { basalIobUnits: aaps.basalIobUnits } : {}),
            receivedAt: aaps.receivedAt,
          }
        : undefined;
    }
    const snapshot = await sources.nightscout(now);
    return snapshot && finite(snapshot.iobUnits)
      ? { provenance: "nightscout", iobUnits: snapshot.iobUnits, receivedAt: snapshot.timestamp }
      : undefined;
  };
}
