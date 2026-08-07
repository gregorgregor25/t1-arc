export type SourceCapabilityKind =
  | 'glucose'
  | 'basal-events'
  | 'bolus-events'
  | 'daily-insulin-totals'
  | 'pump-state-events'
  | 'pump-profile'
  | 'carbohydrates'
  | 'health-context';

export type SourceDataFidelity =
  | 'source-event'
  | 'source-summary'
  | 'report-derived'
  | 'locally-derived';

export interface SourceCapability {
  kind: SourceCapabilityKind;
  fidelity: SourceDataFidelity;
  detail?: string;
}

export const GLOOKO_IMPORT_CAPABILITIES: readonly SourceCapability[] = [
  { kind: 'glucose', fidelity: 'source-event' },
  { kind: 'basal-events', fidelity: 'source-event' },
  { kind: 'bolus-events', fidelity: 'source-event' },
  { kind: 'daily-insulin-totals', fidelity: 'source-summary' },
  {
    kind: 'pump-state-events',
    fidelity: 'report-derived',
    detail: 'Activity Mode and automated-pause intervals can come from Glooko Daily Overview reports.',
  },
] as const;

export const NIGHTSCOUT_GLUCOSE_CAPABILITIES: readonly SourceCapability[] = [
  { kind: 'glucose', fidelity: 'source-event' },
  {
    kind: 'bolus-events',
    fidelity: 'source-event',
    detail: 'Available when the connected Nightscout uploader stores insulin treatments.',
  },
  {
    kind: 'basal-events',
    fidelity: 'source-event',
    detail: 'Available for reported temporary-basal treatments; profile schedules stay separate.',
  },
  { kind: 'carbohydrates', fidelity: 'source-event' },
  { kind: 'pump-state-events', fidelity: 'source-event' },
  {
    kind: 'pump-profile',
    fidelity: 'source-summary',
    detail: 'Programmed basal schedules are retained as profiles, not invented delivery.',
  },
] as const;

export function sourceSupports(
  capabilities: readonly SourceCapability[] | undefined,
  kind: SourceCapabilityKind,
) {
  return capabilities?.some((capability) => capability.kind === kind) ?? false;
}
