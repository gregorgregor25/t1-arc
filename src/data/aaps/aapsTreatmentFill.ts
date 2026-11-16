import type { SourceCapability } from '@/domain/sourceCapabilities';
import type { NightscoutHistoryImporter } from '@/data/nightscout/historySync';
import {
  acquireLocalDataWriteLease,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

import { AAPS_LOCAL_SOURCE_ID } from './types';

/**
 * When AAPS on this phone supplies glucose, the user's Nightscout site can
 * still fill insulin, carb, temporary basal, profile and target history that
 * AAPS does not share locally. Glucose always stays AAPS-only.
 *
 * The value is bound to the local data epoch, so a privacy erase discards it.
 */
export const AAPS_NIGHTSCOUT_TREATMENT_FILL_KEY =
  't1arc.aaps.nightscout-treatment-fill.v1';

export interface AapsNightscoutTreatmentFillPreference {
  enabled: boolean;
  changedAt: number;
}

/**
 * Before this option existed, a connected Nightscout site already supplied
 * treatments while AAPS supplied glucose. An unset preference keeps that.
 */
export const DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL = true;

export interface NightscoutImportPolicy {
  /** Read treatments and profiles from Nightscout. */
  importTreatments: boolean;
  /** Read glucose entries from Nightscout. Never true while AAPS is selected. */
  importGlucose: boolean;
  /** Why this policy applies, for display and tests. */
  reason: 'nightscout-or-other-source' | 'aaps-fill-on' | 'aaps-fill-off';
}

export function resolveNightscoutImportPolicy(input: {
  selectedSourceId: string | undefined;
  fillEnabled: boolean | undefined;
}): NightscoutImportPolicy {
  if (input.selectedSourceId !== AAPS_LOCAL_SOURCE_ID) {
    // Unchanged behaviour for every source other than AAPS on this phone.
    return {
      importTreatments: true,
      importGlucose: true,
      reason: 'nightscout-or-other-source',
    };
  }
  const fill = input.fillEnabled ?? DEFAULT_AAPS_NIGHTSCOUT_TREATMENT_FILL;
  return {
    importTreatments: fill,
    importGlucose: false,
    reason: fill ? 'aaps-fill-on' : 'aaps-fill-off',
  };
}

function parsePreference(
  value: unknown,
): AapsNightscoutTreatmentFillPreference | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<AapsNightscoutTreatmentFillPreference>;
  if (typeof candidate.enabled !== 'boolean') return undefined;
  if (!Number.isSafeInteger(candidate.changedAt)) return undefined;
  return { enabled: candidate.enabled, changedAt: candidate.changedAt! };
}

export async function loadAapsNightscoutTreatmentFill(
  lease?: LocalDataWriteLease,
): Promise<AapsNightscoutTreatmentFillPreference | undefined> {
  const current = lease ?? (await acquireLocalDataWriteLease());
  // Loaded lazily so source wiring does not pull native storage at import.
  const { loadEpochBoundSecureStoreValue } = await import(
    '@/data/privacy/localDataEpochSecureStore'
  );
  return loadEpochBoundSecureStoreValue(
    AAPS_NIGHTSCOUT_TREATMENT_FILL_KEY,
    current,
    parsePreference,
  );
}

export async function saveAapsNightscoutTreatmentFill(
  enabled: boolean,
  now = Date.now(),
  lease?: LocalDataWriteLease,
) {
  const current = lease ?? (await acquireLocalDataWriteLease());
  const { saveEpochBoundSecureStoreValue } = await import(
    '@/data/privacy/localDataEpochSecureStore'
  );
  const value: AapsNightscoutTreatmentFillPreference = {
    enabled,
    changedAt: now,
  };
  await saveEpochBoundSecureStoreValue(
    AAPS_NIGHTSCOUT_TREATMENT_FILL_KEY,
    value,
    current,
  );
  return value;
}

/**
 * Reads the selected glucose source and the fill choice. Any selection other
 * than AAPS on this phone keeps the existing Nightscout behaviour.
 */
export async function loadNightscoutImportPolicy(
  lease?: LocalDataWriteLease,
): Promise<NightscoutImportPolicy> {
  const { getSelectedGlucoseSourceId } = await import('./localAapsSource');
  const selectedSourceId = await getSelectedGlucoseSourceId();
  if (selectedSourceId !== AAPS_LOCAL_SOURCE_ID) {
    return resolveNightscoutImportPolicy({
      selectedSourceId,
      fillEnabled: undefined,
    });
  }
  const preference = await loadAapsNightscoutTreatmentFill(lease).catch(
    () => undefined,
  );
  return resolveNightscoutImportPolicy({
    selectedSourceId,
    fillEnabled: preference?.enabled,
  });
}

/**
 * Picks what an older-history backfill may read. While AAPS is selected the
 * backfill reads treatments only, or nothing when the fill is off.
 */
export function nightscoutHistoryImporterForPolicy(
  policy: NightscoutImportPolicy,
  sources: {
    glucoseAndTreatments: NightscoutHistoryImporter;
    treatments: { importRange(startMs: number, endMs: number): Promise<unknown> };
  },
): NightscoutHistoryImporter | undefined {
  if (policy.importGlucose) return sources.glucoseAndTreatments;
  if (!policy.importTreatments) return undefined;
  return {
    importHistoryRange: (startMs, endMs) =>
      sources.treatments.importRange(startMs, endMs),
  };
}

/**
 * While AAPS supplies glucose, Nightscout treatments are read only when the
 * user keeps the AAPS card's Nightscout fill switched on.
 */
export function gateNightscoutTreatments(
  importer: {
    readonly label: string;
    readonly capabilities: readonly SourceCapability[];
    refresh(): Promise<unknown>;
  },
  policy: () => Promise<NightscoutImportPolicy>,
) {
  return {
    label: importer.label,
    capabilities: importer.capabilities,
    async refresh() {
      if (!(await policy()).importTreatments) return undefined;
      return importer.refresh();
    },
  };
}
