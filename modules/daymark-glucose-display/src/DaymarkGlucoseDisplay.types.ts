import { GlucoseAppearanceSettings } from '../../../src/domain/glucoseAppearance';

export type GlucoseDisplayFreshness =
  | 'current'
  | 'delayed'
  | 'stale'
  | 'missing';

export type GlucoseDisplayTrendOrigin =
  | 'source'
  | 'calculated'
  | 'unavailable';

export type GlucoseAlertKind = 'low' | 'high' | 'stale';

export type AodPosition =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'middleLeft'
  | 'middleCenter'
  | 'middleRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';

export type AodSize = 'small' | 'standard' | 'large';

export interface GlucoseDisplayStatus {
  supported: boolean;
  enabled: boolean;
  notificationsAllowed: boolean;
  lockScreenVisible: boolean;
  serviceRunning: boolean;
  aodDesired: boolean;
  aodPosition: AodPosition;
  aodSize: AodSize;
  aodServiceEnabled: boolean;
  aodOverlayVisible: boolean;
  androidAutoEnabled: boolean;
  aodLastEvent?: string;
  aodLastError?: string;
  latestMmolL?: number;
  latestTimestamp?: number;
  freshness: GlucoseDisplayFreshness;
}

export interface WearCompanionStatus {
  supported: boolean;
  querySucceeded: boolean;
  pairedWatchCount: number;
  companionWatchCount: number;
  companionAvailable: boolean;
  watchNames: string[];
  latestReadingAvailable?: boolean;
  republishAttempted?: boolean;
  republishSucceeded?: boolean;
  error?: string;
}

export interface HomeWidgetStatus {
  supported: boolean;
  pinningSupported: boolean;
  installedCount: number;
}

export interface GlucoseDisplayHistoryPoint {
  mmolL: number;
  timestampMs: number;
}

export type { GlucoseAppearanceSettings };
