import { NativeModule, registerWebModule } from 'expo';

import {
  GlookoCredentialSetupResult,
  GlookoCredentialStatus,
  GlookoCredentialCommitLease,
  GlookoDataResetLease,
  GlookoDataCommitLease,
  GlookoExportResult,
  GlookoReportExtraction,
} from './T1ArcGlookoExport.types';

class T1ArcGlookoExportModule extends NativeModule<Record<string, never>> {
  async setRegionalPreferencesAsync(_timeZone: string, _region: 'eu' | 'us') {
    return false;
  }

  async startExportAsync(_days: number): Promise<GlookoExportResult> {
    throw new Error('The on-device Glooko export connector requires Android.');
  }

  async startRangeExportAsync(
    _startDate: string,
    _endDate: string,
  ): Promise<GlookoExportResult> {
    throw new Error('The on-device Glooko export connector requires Android.');
  }

  async startSilentExportAsync(_days: number): Promise<GlookoExportResult> {
    throw new Error(
      'Automatic Glooko refresh requires the Android on-device connector.',
    );
  }

  async startSilentReportExportAsync(
    _days: number,
  ): Promise<GlookoExportResult> {
    throw new Error(
      'Automatic Glooko report refresh requires the Android on-device connector.',
    );
  }

  async startSilentRangeExportAsync(
    _startDate: string,
    _endDate: string,
  ): Promise<GlookoExportResult> {
    throw new Error(
      'Automatic Glooko history requires the Android on-device connector.',
    );
  }

  async getLastTraceAsync() {
    return null;
  }

  async releaseDownloadAsync(_uri: string) {
    return false;
  }

  async releaseReportArtifactAsync(_uri: string) {
    return false;
  }

  async getPendingSharedReportAsync() {
    return null;
  }

  async acknowledgeSharedReportAsync(_uri: string) {
    return false;
  }

  async releaseReportInboxAccessAsync(_uri: string) {
    return true;
  }

  async clearReportArtifactsAsync() {
    return true;
  }

  async extractReportTextAsync(_uri: string) {
    throw new Error('Glooko PDF report import requires Android.');
  }

  async extractReportDataAsync(_uri: string): Promise<GlookoReportExtraction> {
    throw new Error('Glooko PDF report import requires Android.');
  }

  async openCredentialSetupAsync(
    _existingDataBindingRequired: boolean,
  ): Promise<GlookoCredentialSetupResult> {
    throw new Error(
      'Encrypted automatic Glooko sign-in requires the Android connector.',
    );
  }

  async getCredentialStatusAsync(): Promise<GlookoCredentialStatus> {
    return { configured: false, credentialGeneration: 0 };
  }

  async beginCredentialCommitAsync(
    _credentialGeneration: number,
  ): Promise<GlookoCredentialCommitLease> {
    return { acquired: false };
  }

  async endCredentialCommitAsync(_token: string) {
    return false;
  }

  async beginDataCommitAsync(): Promise<GlookoDataCommitLease> {
    return { acquired: false };
  }

  async endDataCommitAsync(_token: string) {
    return false;
  }

  async beginDataResetAsync(): Promise<GlookoDataResetLease> {
    return { acquired: false };
  }

  async endDataResetAsync(_token: string) {
    return false;
  }

  async clearCredentialsAsync() {
    return false;
  }

  async clearSessionAsync() {
    return false;
  }
}

export default registerWebModule(
  T1ArcGlookoExportModule,
  'T1ArcGlookoExport',
);
