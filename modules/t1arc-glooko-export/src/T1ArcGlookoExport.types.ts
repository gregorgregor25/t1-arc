export type GlookoExportResult =
  | {
      status: 'downloaded';
      uri: string;
      fileName: string;
      byteLength: number;
      credentialGeneration: number;
      /** Confirmed IANA clock used by this account's offset-free exports. */
      timeZone: string;
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
      timeZone?: string;
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
      timeZone?: string;
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
        | 'invalid-pdf'
        | 'report-not-available'
        | 'export-not-authorized'
        | 'unsupported-region'
        | 'legacy-report-disabled'
        | 'device-storage'
        | 'unknown';
      message?: string;
      diagnostic?: string;
      credentialGeneration?: number;
      timeZone?: string;
    };

export interface GlookoCredentialStatus {
  configured: boolean;
  maskedEmail?: string;
  region?: 'eu' | 'us';
  /** Present only after the account/export clock has been confirmed. */
  timeZone?: string;
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
  /** Installation-keyed HMAC of the report name/DOB; never the raw identity. */
  subjectFingerprint?: string;
  pumpTrackIntervals: GlookoPumpTrackInterval[];
}

export interface GlookoSharedReport {
  uri: string;
  fileName: string;
  byteLength: number;
}

export type GlookoCredentialSetupResult =
  | {
      status: 'saved';
      maskedEmail?: string;
      credentialGeneration: number;
      timeZone: string;
      /** The user approved binding this account to restored/imported Glooko rows. */
      existingDataBindingApproved: boolean;
    }
  | {
      status: 'cancelled';
    };
