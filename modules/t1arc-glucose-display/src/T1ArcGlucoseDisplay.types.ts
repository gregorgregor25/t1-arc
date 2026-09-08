import { GlucoseAppearanceSettings } from '../../../src/domain/glucoseAppearance';

export type GlucoseDisplayFreshness =
  'current' | 'delayed' | 'stale' | 'missing';

export type GlucoseDisplayTrendOrigin = 'source' | 'calculated' | 'unavailable';

export type GlucoseAlertKind = 'low' | 'high' | 'stale';

export type GlucoseAlertChannelState = 'allowed' | 'blocked' | 'unavailable';

export type GlucoseAlertLockScreenVisibility =
  'public' | 'private' | 'secret' | 'default';

export interface GlucoseAlertChannelStatus {
  kind: GlucoseAlertKind;
  channelId: string;
  state: GlucoseAlertChannelState;
  permissionGranted: boolean;
  appNotificationsEnabled: boolean;
  appNotificationsAllowed: boolean;
  channelExists: boolean;
  groupBlocked: boolean;
  importance: number;
  soundConfigured: boolean;
  vibrationConfigured: boolean;
  lockScreenVisibility: GlucoseAlertLockScreenVisibility;
  payloadGlucoseVisibleOnLockScreen: boolean;
  bypassesDoNotDisturb: boolean;
}

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
  androidAutoProjected: boolean;
  aodLastEvent?: string;
  aodLastError?: string;
  latestMmolL?: number;
  latestTimestamp?: number;
  latestTrend?: string;
  latestTrendOrigin?: GlucoseDisplayTrendOrigin;
  latestSourceLabel?: string;
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

export type WatchFaceId = 'meridian' | 'chronograph' | 'atelier' | 'pace' | 'summit';

export type WatchFaceResultCode =
  | 'ready' | 'active' | 'activation_required' | 'unsupported'
  | 'companion_update_required' | 'unreachable' | 'busy' | 'uncertain' | 'failed';

export interface WatchFaceResult {
  code: WatchFaceResultCode;
  supported: boolean;
  active?: boolean;
  activationUsed?: boolean;
  activationDenied?: boolean;
  installedFaceId?: WatchFaceId;
  retiredFaceId?: 'orbit';
  installedVersion?: number;
  catalog?: WatchFaceId[];
}

export interface WatchFaceDeviceStatus extends WatchFaceResult {
  nodeId: string;
  watchName: string;
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

export interface GlucoseDisplayPublicationSnapshot {
  mmolL: number;
  trend: string;
  timestampMs: number;
  sourceLabel: string;
  sourceHasError: boolean;
  trendOrigin: GlucoseDisplayTrendOrigin;
}

export type { GlucoseAppearanceSettings };
