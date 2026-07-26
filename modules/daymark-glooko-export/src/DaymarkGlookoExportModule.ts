import { NativeModule, requireNativeModule } from 'expo';

import { GlookoExportResult } from './DaymarkGlookoExport.types';

declare class DaymarkGlookoExportModule extends NativeModule<
  Record<string, never>
> {
  startExportAsync(days: number): Promise<GlookoExportResult>;
  getLastTraceAsync(): Promise<string | null>;
  clearSessionAsync(): Promise<boolean>;
}

export default requireNativeModule<DaymarkGlookoExportModule>(
  'DaymarkGlookoExport',
);
