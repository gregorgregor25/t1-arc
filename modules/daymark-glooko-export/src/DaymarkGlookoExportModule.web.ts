import { NativeModule, registerWebModule } from 'expo';

import { GlookoExportResult } from './DaymarkGlookoExport.types';

class DaymarkGlookoExportModule extends NativeModule<Record<string, never>> {
  async startExportAsync(_days: number): Promise<GlookoExportResult> {
    throw new Error('The on-device Glooko export connector requires Android.');
  }

  async getLastTraceAsync() {
    return null;
  }

  async clearSessionAsync() {
    return false;
  }
}

export default registerWebModule(
  DaymarkGlookoExportModule,
  'DaymarkGlookoExport',
);
