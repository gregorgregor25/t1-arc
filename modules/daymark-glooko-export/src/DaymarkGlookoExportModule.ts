import { NativeModule, requireNativeModule } from 'expo';

import {
  GlookoCredentialSetupResult,
  GlookoCredentialStatus,
  GlookoCredentialCommitLease,
  GlookoDataResetLease,
  GlookoDataCommitLease,
  GlookoExportResult,
  GlookoReportExtraction,
} from './DaymarkGlookoExport.types';

declare class DaymarkGlookoExportModule extends NativeModule<
  Record<string, never>
> {
  startExportAsync(days: number): Promise<GlookoExportResult>;
  startRangeExportAsync(
    startDate: string,
    endDate: string,
  ): Promise<GlookoExportResult>;
  startSilentExportAsync(days: number): Promise<GlookoExportResult>;
  startSilentReportExportAsync(days: number): Promise<GlookoExportResult>;
  startSilentRangeExportAsync(
    startDate: string,
    endDate: string,
  ): Promise<GlookoExportResult>;
  getLastTraceAsync(): Promise<string | null>;
  releaseDownloadAsync(uri: string): Promise<boolean>;
  extractReportTextAsync(uri: string): Promise<string>;
  extractReportDataAsync(uri: string): Promise<GlookoReportExtraction>;
  openCredentialSetupAsync(
    legacyCredentialContinuityRequired: boolean,
  ): Promise<GlookoCredentialSetupResult>;
  getCredentialStatusAsync(): Promise<GlookoCredentialStatus>;
  beginCredentialCommitAsync(
    credentialGeneration: number,
  ): Promise<GlookoCredentialCommitLease>;
  endCredentialCommitAsync(token: string): Promise<boolean>;
  beginDataCommitAsync(): Promise<GlookoDataCommitLease>;
  endDataCommitAsync(token: string): Promise<boolean>;
  beginDataResetAsync(): Promise<GlookoDataResetLease>;
  endDataResetAsync(token: string): Promise<boolean>;
  clearCredentialsAsync(): Promise<boolean>;
  clearSessionAsync(): Promise<boolean>;
}

export default requireNativeModule<DaymarkGlookoExportModule>(
  'DaymarkGlookoExport',
);
