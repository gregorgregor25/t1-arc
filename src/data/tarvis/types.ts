import { EvidenceReference, InsightReport } from '@/domain/insights';

export type TarvisConfidence = 'high' | 'moderate' | 'limited';

export interface TarvisEvidenceItem {
  id: string;
  label: string;
  description: string;
  range: { start: number; end: number };
  recordCount: number;
  examples: Array<{
    id: string;
    kind: string;
    timestamp: number;
    primary: string;
    secondary: string;
    sourceId: string;
  }>;
}

export type TarvisInsightWindowSummary = Omit<
  InsightReport['current'],
  | 'timeBelowPercent'
  | 'timeInRangePercent'
  | 'timeAbovePercent'
  | 'highGlucoseRuns'
  | 'lowGlucoseRuns'
> & {
  timeBelowPercent: number | null;
  timeInRangePercent: number | null;
  timeAbovePercent: number | null;
  highGlucoseRuns: number | null;
  lowGlucoseRuns: number | null;
};

export interface TarvisEvidencePacket {
  schemaVersion: 1;
  timezone: 'Europe/London';
  units: { glucose: 'mmol/L'; weight: 'kg'; distance: 'km' };
  generatedAt: number;
  comparison: {
    currentRange: { start: number; end: number };
    previousRange: { start: number; end: number };
    headline: string;
    summary: string;
    current: TarvisInsightWindowSummary;
    previous: TarvisInsightWindowSummary;
  };
  findings: Array<{
    id: string;
    kind: string;
    category: InsightReport['findings'][number]['category'];
    title: string;
    summary: string;
    caveat?: string;
    evidenceIds: string[];
  }>;
  evidence: TarvisEvidenceItem[];
}

export interface TarvisAnswer {
  headline: string;
  answer: string;
  confidence: TarvisConfidence;
  evidenceIds: string[];
  limitations: string[];
}

export interface TarvisConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface TarvisUsage {
  requestTimestamps: number[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastRequestAt?: number;
}

export interface TarvisStoredSettings {
  hasApiKey: boolean;
  usage: TarvisUsage;
}

export interface TarvisResponse {
  answer: TarvisAnswer;
  usage: TarvisUsage;
  requestMetrics?: TarvisRequestMetrics;
}

export interface TarvisRequestMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  evidenceCharacters: number;
}

export interface TarvisEvidenceLookup {
  packet: TarvisEvidencePacket;
  references: Map<string, EvidenceReference>;
}
