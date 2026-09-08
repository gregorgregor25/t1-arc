export const CURRENT_T1ARC_SCHEMA_VERSION = 31;
export const STARTUP_MAINTENANCE_METADATA_KEY =
  'startup_maintenance_completed_version';

export function shouldRunVersionedStartupMaintenance(
  openedSchemaVersion: number,
  completedMaintenanceVersion?: number,
) {
  return (
    !Number.isSafeInteger(openedSchemaVersion) ||
    openedSchemaVersion < CURRENT_T1ARC_SCHEMA_VERSION ||
    completedMaintenanceVersion !== CURRENT_T1ARC_SCHEMA_VERSION
  );
}

/**
 * Runs data-repair and retention migrations once per schema version. A fresh
 * Headless JS runtime must be able to open an already-current database without
 * repeating full-table writes or payload scans.
 */
export async function runVersionedStartupMaintenance(
  openedSchemaVersion: number,
  completedMaintenanceVersion: number | undefined,
  maintenance: () => Promise<void>,
) {
  if (
    !shouldRunVersionedStartupMaintenance(
      openedSchemaVersion,
      completedMaintenanceVersion,
    )
  ) {
    return false;
  }
  await maintenance();
  return true;
}
