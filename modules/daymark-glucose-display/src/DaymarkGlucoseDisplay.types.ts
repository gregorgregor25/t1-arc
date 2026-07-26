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
  latestMmolL?: number;
  latestTimestamp?: number;
  freshness: GlucoseDisplayFreshness;
}
