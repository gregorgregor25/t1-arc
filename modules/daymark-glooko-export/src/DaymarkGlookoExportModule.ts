import { NativeModule, requireNativeModule } from 'expo';

import {
  GlookoCredentialSetupResult,
  GlookoCredentialStatus,
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
  extractReportTextAsync(uri: string): Promise<string>;
  extractReportDataAsync(uri: string): Promise<GlookoReportExtraction>;
  openCredentialSetupAsync(): Promise<GlookoCredentialSetupResult>;
  getCredentialStatusAsync(): Promise<GlookoCredentialStatus>;
  clearCredentialsAsync(): Promise<boolean>;
  clearSessionAsync(): Promise<boolean>;
}

export default requireNativeModule<DaymarkGlookoExportModule>(
  'DaymarkGlookoExport',
);
