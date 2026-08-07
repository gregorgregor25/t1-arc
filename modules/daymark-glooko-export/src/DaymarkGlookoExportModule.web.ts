import { NativeModule, registerWebModule } from 'expo';

import {
  GlookoCredentialSetupResult,
  GlookoCredentialStatus,
  GlookoExportResult,
  GlookoReportExtraction,
} from './DaymarkGlookoExport.types';

class DaymarkGlookoExportModule extends NativeModule<Record<string, never>> {
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

  async extractReportTextAsync(_uri: string) {
    throw new Error('Glooko PDF report import requires Android.');
  }

  async extractReportDataAsync(
    _uri: string,
  ): Promise<GlookoReportExtraction> {
    throw new Error('Glooko PDF report import requires Android.');
  }

  async openCredentialSetupAsync(): Promise<GlookoCredentialSetupResult> {
    throw new Error(
      'Encrypted automatic Glooko sign-in requires the Android connector.',
    );
  }

  async getCredentialStatusAsync(): Promise<GlookoCredentialStatus> {
    return { configured: false };
  }

  async clearCredentialsAsync() {
    return false;
  }

  async clearSessionAsync() {
    return false;
  }
}

export default registerWebModule(
  DaymarkGlookoExportModule,
  'DaymarkGlookoExport',
);
