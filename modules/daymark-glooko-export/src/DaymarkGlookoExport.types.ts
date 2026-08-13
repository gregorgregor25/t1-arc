export type GlookoExportResult =
  | {
      status: 'downloaded';
      uri: string;
      fileName: string;
      byteLength: number;
      credentialGeneration: number;
      /** Installation-keyed HMAC; never the raw Glooko account code. */
      accountFingerprint: string;
      diagnostic?: string;
    }
  | {
      status: 'cancelled';
      reason?: 'cancelled' | 'busy' | 'network' | 'timeout' | 'unknown';
      message?: string;
      diagnostic?: string;
      credentialGeneration?: number;
    }
  | {
      status: 'session-required';
      reason:
        | 'session-required'
        | 'credentials-rejected'
        | 'authentication-challenge'
        | 'region-mismatch'
        | 'session-rejected';
      message?: string;
      diagnostic?: string;
      credentialGeneration?: number;
    }
  | {
      status: 'failed';
      reason:
        | 'authentication-protocol-changed'
        | 'account-code-not-found'
        | 'account-selection-required'
        | 'http-error'
        | 'rate-limited'
        | 'server-error'
        | 'network'
        | 'timeout'
        | 'export-too-large'
        | 'invalid-zip'
        | 'export-not-authorized'
        | 'unsupported-region'
        | 'legacy-report-disabled'
        | 'device-storage'
        | 'unknown';
      message?: string;
      diagnostic?: string;
      credentialGeneration?: number;
    };

export interface GlookoCredentialStatus {
  configured: boolean;
  maskedEmail?: string;
  region?: 'eu' | 'us';
  credentialGeneration: number;
}

export type GlookoCredentialCommitLease =
  { acquired: true; token: string } | { acquired: false };

export type GlookoDataResetLease =
  { acquired: true; token: string } | { acquired: false };

export type GlookoDataCommitLease =
  { acquired: true; token: string } | { acquired: false };

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
      credentialGeneration: number;
      /** Existing encrypted credentials were attested without replacing them. */
      legacyCredentialContinuity: boolean;
    }
  | {
      status: 'cancelled';
    };
