import { GlucoseAppearanceSettings } from '../../../src/domain/glucoseAppearance';

export type GlucoseDisplayFreshness =
  | 'current'
  | 'delayed'
  | 'stale'
  | 'missing';

export interface GlucoseDisplayStatus {
  supported: boolean;
  enabled: boolean;
  notificationsAllowed: boolean;
  lockScreenVisible: boolean;
  serviceRunning: boolean;
  aodDesired: boolean;
  aodServiceEnabled: boolean;
  aodOverlayVisible: boolean;
  aodLastEvent?: string;
  aodLastError?: string;
  latestMmolL?: number;
  latestTimestamp?: number;
  freshness: GlucoseDisplayFreshness;
}

export type { GlucoseAppearanceSettings };
