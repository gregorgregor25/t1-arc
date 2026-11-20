/**
 * Plain names for the stored `sourceId` of a record. Used where several
 * sources are summarised together (source health, exports, reports). The
 * raw `sourceId` stays available next to the name for provenance.
 */
const RECORD_SOURCE_LABELS: Readonly<Record<string, string>> = {
  'android-notification': 'Phone notification source',
  't1arc-librelinkup': 'LibreLinkUp',
  'dexcom-share': 'Dexcom Share',
  'dexcom-cgm': 'Dexcom Clarity glucose history',
  'dexcom-clarity-export': 'Dexcom Clarity export',
  'medtrum-easyfollow': 'Medtrum',
  nightscout: 'Nightscout',
  'xdrip-local': 'xDrip',
  'aaps-local': 'AAPS on this phone',
  'aaps-restored': 'Restored AAPS history',
  'aaps-history': 'Earlier AAPS history',
  'glooko-export': 'Glooko',
  'glooko-cgm': 'Glooko glucose history',
  hevy: 'Hevy',
  't1arc-manual': 'Entered in T1 Arc',
  't1arc-food': 'Food diary in T1 Arc',
  't1arc-context': 'Health context in T1 Arc',
  't1arc-live-glucose': 'Glucose',
  'demo-t1arc-glucose': 'Demo glucose',
  'demo-glooko': 'Demo insulin',
  'demo-t1arc-context': 'Demo context',
};

export function recordSourceLabel(sourceId: string): string {
  const known = RECORD_SOURCE_LABELS[sourceId];
  if (known) return known;
  if (sourceId.startsWith('health-connect:')) return 'Health Connect';
  if (sourceId.startsWith('t1arc-manual')) return 'Entered in T1 Arc';
  return 'Other source';
}

/** Distinct plain names in first-seen order. */
export function recordSourceLabels(sourceIds: Iterable<string>): string[] {
  const labels: string[] = [];
  for (const sourceId of sourceIds) {
    const label = recordSourceLabel(sourceId);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}
