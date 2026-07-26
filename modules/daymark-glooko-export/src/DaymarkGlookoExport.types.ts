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
      message?: string;
      diagnostic?: string;
    };
