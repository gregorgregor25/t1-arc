import { EvidenceReference, InsightReport } from "@/domain/insights";

export type TarvisConfidence = "high" | "moderate" | "limited";

export interface TarvisEvidenceItem {
  id: string;
  label: string;
  description: string;
  range: { start: number; end: number };
  recordCount: number;
  examples: {
    id: string;
    kind: string;
    timestamp: number;
    primary: string;
    secondary: string;
    sourceId: string;
  }[];
}

export type TarvisInsightWindowSummary = Omit<
  InsightReport["current"],
  | "timeBelowPercent"
  | "timeInRangePercent"
  | "timeAbovePercent"
  | "highGlucoseRuns"
  | "lowGlucoseRuns"
  | "lateMeals"
> & {
  timeBelowPercent: number | null;
  timeInRangePercent: number | null;
  timeAbovePercent: number | null;
  highGlucoseRuns: number | null;
  lowGlucoseRuns: number | null;
  /** Null when meal records were unavailable or deliberately not selected. */
  lateMeals: number | null;
};

export interface TarvisEvidencePacket {
  schemaVersion: 1;
  timezone: string;
  units: { glucose: "mmol/L"; weight: "kg"; distance: "km" };
  generatedAt: number;
  /** Locally required findings that hosted ranking may not omit. */
  requiredFindingIds?: string[];
  comparison: {
    currentRange: { start: number; end: number };
    previousRange: { start: number; end: number };
    headline: string;
    summary: string;
    current: TarvisInsightWindowSummary;
    previous: TarvisInsightWindowSummary;
  };
  findings: {
    id: string;
    kind: string;
    category: InsightReport["findings"][number]["category"];
    title: string;
    summary: string;
    caveat?: string;
    evidenceIds: string[];
  }[];
  evidence: TarvisEvidenceItem[];
}

export interface TarvisReviewedKnowledgeItem {
  id: string;
  jurisdiction: "UK";
  summary: string;
  sourceTitle: string;
  sourceUrl: string;
  recommendationRefs: string[];
  reviewedAt: string;
}

export interface TarvisGuidanceReference {
  knowledgeId: string;
  jurisdiction: "UK";
  sourceTitle: string;
  sourceUrl: string;
  recommendationRefs: string[];
  reviewedAt: string;
}

/**
 * A bounded, locally verified incident dossier for model-led explanation.
 * The model may decide which recorded factors are worth discussing, but it
 * cannot alter the chronology, calculations, evidence IDs, or limitations.
 */
export interface TarvisRetrospectiveEvidencePacket {
  schemaVersion: 1;
  requestMode: "retrospective";
  timezone: string;
  units: { glucose: "mmol/L"; insulin: "U"; carbohydrates: "g" };
  generatedAt: number;
  verifiedReview: {
    headline: string;
    chronology: string;
    confidence: TarvisConfidence;
    limitations: string[];
    eventKind: "low" | "high" | "drop" | "neutral";
    eventObserved: boolean;
    activityContributionSupported: boolean;
  };
  reviewedKnowledge: TarvisReviewedKnowledgeItem[];
  evidence: TarvisEvidenceItem[];
}

export type TarvisModelEvidencePacket =
  TarvisEvidencePacket | TarvisRetrospectiveEvidencePacket;

export function isTarvisRetrospectiveEvidencePacket(
  packet: TarvisModelEvidencePacket,
): packet is TarvisRetrospectiveEvidencePacket {
  return "requestMode" in packet && packet.requestMode === "retrospective";
}

export interface TarvisAnswer {
  /** Local safety boundaries are not conclusions supported by personal records. */
  responseKind?: 'safety-boundary' | 'general-education';
  headline: string;
  answer: string;
  confidence: TarvisConfidence;
  evidenceIds: string[];
  limitations: string[];
  /** Rich, versioned presentation returned by the direct on-device TARV1S route. */
  directPresentation?: TarvisDirectAnswerPresentation;
}

export type TarvisDirectAnswerKind =
  | 'fact'
  | 'comparison'
  | 'pattern'
  | 'explanation'
  | 'guidance'
  | 'general';

export interface TarvisDirectAnswerPresentation {
  version: 1;
  kind: TarvisDirectAnswerKind;
  /** Meaningful provenance only; model/implementation details are never user-facing. */
  source?: 'records' | 'guidance' | 't1arc';
  headline: string;
  summary: string;
  confidence: TarvisConfidence;
  primaryMetric: { label: string; value: string; unit: string } | null;
  keyFindings: { title: string; detail: string }[];
  interpretation: string | null;
  evidence: { label: string; detail: string; evidenceId?: string | null }[];
  limitations: string[];
  followUpQuestions: string[];
  safetyNotice: string | null;
}

export interface TarvisConversationTurn {
  role: "user" | "assistant";
  text: string;
  modelSharing?: "local-only";
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
  /** Whether any part of this request was sent to the configured model. */
  modelRequestSent: boolean;
  /** Where the prose shown to the user came from. */
  answerSource: "hosted" | "local";
  requestMetrics?: TarvisRequestMetrics;
}

export interface TarvisRequestMetrics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  evidenceCharacters: number;
  /** Internal performance telemetry; never shown as answer provenance. */
  durationMs?: number;
  modelDurationMs?: number;
  localToolDurationMs?: number;
  modelTurns?: number;
  localToolCallCount?: number;
}

export interface TarvisEvidenceLookup {
  packet: TarvisEvidencePacket;
  references: Map<string, EvidenceReference>;
}
