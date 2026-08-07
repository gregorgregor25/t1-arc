export type GlookoExportResult =
  | {
      status: 'downloaded';
      uri: string;
      fileName: string;
      byteLength: number;
      diagnostic?: string;
    }
  | {
      status: 'cancelled';
      reason?: 'cancelled' | 'busy' | 'network' | 'timeout' | 'unknown';
      message?: string;
      diagnostic?: string;
    }
  | {
      status: 'session-required';
      reason: 'session-required' | 'credentials-rejected';
      message?: string;
      diagnostic?: string;
    };

export interface GlookoCredentialStatus {
  configured: boolean;
  maskedEmail?: string;
}

export type GlookoPumpTrackKind = 'activity-mode' | 'automated-pause';

export interface GlookoPumpTrackInterval {
  dateLabel: string;
  startMinute: number;
  endMinute: number;
  kind: GlookoPumpTrackKind;
  pageNumber: number;
}

export interface GlookoReportExtraction {
  text: string;
  pumpTrackIntervals: GlookoPumpTrackInterval[];
}

export type GlookoCredentialSetupResult =
  | {
      status: 'saved';
      maskedEmail?: string;
    }
  | {
      status: 'cancelled';
    };
