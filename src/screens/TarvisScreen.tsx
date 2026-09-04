import Ionicons from "@expo/vector-icons/Ionicons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { AppScreen } from "@/components/AppScreen";
import { SectionCard } from "@/components/SectionCard";
import { TarvisWorkspaceSwitcher } from "@/components/TarvisWorkspaceSwitcher";
import { TarvisOrb } from "@/components/TarvisOrb";
import {
  buildTarvisEvidencePacket,
  selectTarvisEvidencePacket,
} from "@/data/tarvis/evidencePacket";
import { localTarvisEvidenceFallback } from "@/data/tarvis/evidenceAnswerGuardrail";
import { compactTarvisEvidence } from "@/data/tarvis/evidenceCompaction";
import {
  buildTarvisEvidencePresentation,
  TarvisEvidencePresentation,
} from "@/data/tarvis/evidencePresentation";
import {
  askTarvis,
  getTarvisRequestFailureDetails,
  planTarvisEvidenceRequest,
} from "@/data/tarvis/openAiClient";
import { isTarvisConnectionSupersededError } from "@/data/tarvis/connectionCoordinator";
import {
  createTarvisScreenLifecycleCoordinator,
  isTarvisScreenLifecycleSupersededError,
  type TarvisScreenOperationLease,
  type TarvisScreenScopeLease,
} from "@/data/tarvis/screenLifecycle";
import {
  buildLocalGlucoseAnswer,
  localGlucoseClockBoundaryCapability,
  rangeForLocalGlucoseIntent,
} from "@/data/tarvis/localGlucoseAnswer";
import {
  buildLocalGlucoseRangeAnswer,
  rangeForLocalGlucoseRangeIntent,
} from "@/data/tarvis/localGlucoseRangeAnswer";
import {
  buildLocalPersonalDataAnswer,
  rangesForLocalPersonalDataIntent,
} from "@/data/tarvis/localPersonalDataAnswer";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import { tarvisEvidencePlanClarificationAnswer } from "@/data/tarvis/evidencePlanner";
import { loadPlannedGlucoseEpisodeEvidence } from "@/data/tarvis/plannedGlucoseEpisodeEvidence";
import { loadRetrospectiveEventReview } from "@/data/tarvis/retrospectiveEventReview";
import {
  buildTarvisRetrospectiveEvidencePacket,
  mapTarvisRetrospectiveEvidenceReferences,
} from "@/data/tarvis/retrospectiveEvidencePacket";
import { resolveTarvisReviewedKnowledgeForTurn } from "@/data/tarvis/reviewedKnowledge";
import { reviewedKnowledgeAnswerForTurn } from "@/data/tarvis/reviewedKnowledgeAnswerGuardrail";
import type { RetrospectivePhysiologyLoader } from "@/data/tarvis/retrospectivePhysiology";
import type { RetrospectiveIobLoader } from "@/data/tarvis/retrospectiveIobLoader";
import { tarvisConversationTurnsForExchange } from "@/data/tarvis/modelConversationPrivacy";
import {
  getTarvisConversationPersistenceCoordinator,
  LoadedStoredTarvisExchange,
  MAX_STORED_TARVIS_EXCHANGES,
  canUpgradeTarvisConversationScope,
  sameTarvisConversationScope,
  TarvisConversationScope,
  TarvisConversationStorageLimitError,
} from "@/data/tarvis/conversationStore";
import { tarvisSettingsPresentation } from "@/data/tarvis/conversationScope";
import { formatTarvisConversation } from "@/data/tarvis/conversationExport";
import type { GlucoseAnswerBundleV2 } from "@/data/tarvis/glucoseAnswerBundleV2";
import {
  describeTarvisIntent,
  PendingTarvisClarification,
  resolveTarvisIntent,
  TarvisIntentHistoryEntry,
  TarvisIntentV1,
} from "@/data/tarvis/intent";
import {
  clearTarvisApiKey,
  loadTarvisSettings,
  saveTarvisApiKey,
} from "@/data/tarvis/secureStore";
import { loadTarvisTreatmentProfile } from "@/data/tarvis/treatmentProfile";
import {
  buildTarvisTreatmentProfileAnswer,
  treatmentProfileLoadFailureAnswer,
} from "@/data/tarvis/treatmentProfileAnswer";
import {
  TarvisAnswer,
  TarvisConversationTurn,
  TarvisDirectAnswerPresentation,
  TarvisEvidenceLookup,
  TarvisGuidanceReference,
  TarvisRequestMetrics,
  TarvisReviewedKnowledgeItem,
  TarvisResponse,
  TarvisUsage,
} from "@/data/tarvis/types";
import { EvidenceReference, InsightReport } from "@/domain/insights";
import {
  GlucoseReading,
  TimelineData,
  TimeRange,
} from "@/domain/models";
import { formatRegionalFixedNumber, formatRegionalNumber } from "@/domain/regionalFormat";
import {
  getRuntimeAnalysisTimeZone,
  getRuntimeRegionalDefaults,
} from "@/domain/regionalProfileRuntime";
import { addDays, formatDate, formatTime, toDateKey } from "@/domain/time";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useAppTheme } from "@/theme/theme";
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
  withLocalDataWriteLeaseTransaction,
} from "@/data/privacy/localDataWriteEpoch";

const SUGGESTIONS: {
  icon: keyof typeof Ionicons.glyphMap;
  question: string;
}[] = [
  {
    icon: "trending-down-outline",
    question: "Why have I been going low recently?",
  },
  {
    icon: "analytics-outline",
    question: "What patterns changed this week?",
  },
  {
    icon: "walk-outline",
    question: "How did my last workout affect glucose?",
  },
  {
    icon: "restaurant-outline",
    question: "Compare yesterday's carbs and bolus",
  },
];

function guidanceReferences(
  items: readonly TarvisReviewedKnowledgeItem[],
): TarvisGuidanceReference[] {
  return items.map((item) => ({
    knowledgeId: item.id,
    jurisdiction: item.jurisdiction,
    sourceTitle: item.sourceTitle,
    sourceUrl: item.sourceUrl,
    recommendationRefs: [...item.recommendationRefs],
    reviewedAt: item.reviewedAt,
  }));
}

function localRetrospectiveAfterHostedFailure(
  answer: TarvisAnswer,
): TarvisAnswer {
  const notice =
    "Tarv1s used the verified records on this phone because its broader AI connection was unavailable.";
  return {
    ...answer,
    limitations: [...new Set([...answer.limitations, notice])],
  };
}

function combineTarvisRequestMetrics(
  first: TarvisRequestMetrics | undefined,
  second: TarvisRequestMetrics | undefined,
): TarvisRequestMetrics | undefined {
  if (!first) return second ? { ...second } : undefined;
  if (!second) return { ...first };
  return {
    model:
      first.model === second.model
        ? first.model
        : `${first.model} + ${second.model}`,
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    totalTokens: first.totalTokens + second.totalTokens,
    estimatedCostUsd: first.estimatedCostUsd + second.estimatedCostUsd,
    evidenceCharacters: first.evidenceCharacters + second.evidenceCharacters,
    durationMs: (first.durationMs ?? 0) + (second.durationMs ?? 0),
    modelDurationMs:
      (first.modelDurationMs ?? 0) + (second.modelDurationMs ?? 0),
    localToolDurationMs:
      (first.localToolDurationMs ?? 0) + (second.localToolDurationMs ?? 0),
    modelTurns: (first.modelTurns ?? 0) + (second.modelTurns ?? 0),
    localToolCallCount:
      (first.localToolCallCount ?? 0) + (second.localToolCallCount ?? 0),
  };
}

interface ChatExchange {
  id: string;
  threadId: string;
  question: string;
  answer: TarvisAnswer;
  evidence: TarvisEvidenceLookup;
  clarificationQuestion?: string;
  intent?: TarvisIntentV1;
  presentation?: TarvisEvidencePresentation;
  requestMetrics?: TarvisRequestMetrics;
  modelRequestSent: boolean;
  answerSource: "hosted" | "local";
  modelSharing?: "local-only";
  guidanceSources: TarvisGuidanceReference[];
  answerBundle?: GlucoseAnswerBundleV2;
  createdAt: number;
  scope: TarvisConversationScope;
}

interface ConversationThreadSummary {
  id: string;
  title: string;
  updatedAt: number;
  exchangeCount: number;
}

const CONVERSATION_HISTORY_GROUPS = [
  "Today",
  "Yesterday",
  "Previous 7 days",
  "Older",
] as const;

type ConversationHistoryGroup = (typeof CONVERSATION_HISTORY_GROUPS)[number];

function conversationHistoryGroup(
  timestamp: number,
  now = Date.now(),
): ConversationHistoryGroup {
  const today = toDateKey(now);
  const key = toDateKey(timestamp);
  if (key === today) return "Today";
  if (key === addDays(today, -1)) return "Yesterday";
  if (key >= addDays(today, -7)) return "Previous 7 days";
  return "Older";
}

function conversationUpdatedLabel(timestamp: number) {
  const group = conversationHistoryGroup(timestamp);
  if (group === "Today") {
    return formatTime(timestamp);
  }
  return formatDate(toDateKey(timestamp), { day: "numeric", month: "short" });
}

interface Props {
  asOf: number;
  conversationScope: TarvisConversationScope;
  initialQuestion?: string;
  liveData: boolean;
  report: InsightReport;
  loadGlucoseReadings?(range: TimeRange): Promise<GlucoseReading[]>;
  loadTimelineData?(range: TimeRange): Promise<TimelineData>;
  loadPhysiologyData?: RetrospectivePhysiologyLoader;
  loadTimestampedIob?: RetrospectiveIobLoader;
  loadReportForRange?(
    current: TimeRange,
    previous: TimeRange,
    generatedAt: number,
  ): Promise<InsightReport>;
  onBack(): void;
  onInspectEvidence(evidence: EvidenceReference): void;
}

function confidenceLabel(confidence: TarvisAnswer["confidence"]) {
  switch (confidence) {
    case "high":
      return "How well the records support this: Strong";
    case "moderate":
      return "How well the records support this: Moderate";
    default:
      return "How well the records support this: Limited";
  }
}

function evidenceRangeLabel(range: { start: number; end: number }) {
  return `${formatDate(toDateKey(range.start), {
    day: "numeric",
    month: "short",
  })} - ${formatDate(toDateKey(range.end - 1), {
    day: "numeric",
    month: "short",
  })}`;
}

function formatEvidenceNumber(value: number, fractionDigits: number) {
  return formatRegionalFixedNumber(
    value,
    getRuntimeRegionalDefaults().locale,
    fractionDigits,
  );
}

function formatEvidenceCount(value: number) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: 0,
  });
}

function TarvisEvidenceSummary({
  presentation,
}: {
  presentation?: TarvisEvidencePresentation;
}) {
  const { colors, radius } = useAppTheme();
  if (!presentation) return null;

  return (
    <View
      accessibilityLabel={`${presentation.title}. ${presentation.windows
        .map(
          (window) =>
            `${window.label}, ${evidenceRangeLabel(window.range)}, ${formatEvidenceCount(window.recordCount)} ${window.recordLabel ?? "glucose readings"}${window.coveragePercent === undefined ? "" : `, ${formatEvidenceNumber(window.coveragePercent, 1)}% coverage`}. ${
              window.coverageStatus === "unavailable"
                ? "Glucose metrics are unavailable."
                : window.coverageStatus === "limited"
                  ? "Values describe observed sensor time only, not the complete period."
                  : ""
            } ${window.metrics
              .map((metric) => {
                const value =
                  metric.value === null
                    ? "not available"
                    : formatEvidenceNumber(metric.value, metric.decimals);
                return `${metric.label} ${value}${metric.unit ? ` ${metric.unit}` : ""}`;
              })
              .join(", ")}`,
        )
        .join(". ")}`}
      style={[
        styles.evidenceSummary,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <View style={styles.evidenceSummaryHeading}>
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="analytics-outline"
          size={18}
        />
        <Text style={[styles.evidenceSummaryTitle, { color: colors.text }]}>
          {presentation.title}
        </Text>
      </View>
      {presentation.windows.map((window, windowIndex) => (
        <View
          key={`${window.label}:${window.range.start}`}
          style={[
            styles.evidenceWindow,
            windowIndex > 0 && {
              borderTopColor: colors.divider,
              borderTopWidth: StyleSheet.hairlineWidth,
              marginTop: 12,
              paddingTop: 12,
            },
          ]}
        >
          <View style={styles.evidenceWindowHeading}>
            <Text
              style={[
                styles.evidenceWindowLabel,
                { color: colors.textSecondary },
              ]}
            >
              {window.label}
            </Text>
            <Text
              style={[
                styles.evidenceWindowRange,
                { color: colors.textTertiary },
              ]}
            >
              {evidenceRangeLabel(window.range)}
            </Text>
          </View>
          <View style={styles.evidenceMetrics}>
            {window.metrics.map((metric) => (
              <View key={metric.id} style={styles.evidenceMetric}>
                <Text
                  style={[
                    metric.value === null
                      ? styles.evidenceMetricUnavailable
                      : styles.evidenceMetricValue,
                    { color: colors.text },
                  ]}
                >
                  {metric.value === null
                    ? "Unavailable"
                    : formatEvidenceNumber(metric.value, metric.decimals)}
                  {metric.value !== null && metric.unit ? (
                    <Text
                      style={[
                        styles.evidenceMetricUnit,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {" "}
                      {metric.unit}
                    </Text>
                  ) : null}
                </Text>
                <Text
                  style={[
                    styles.evidenceMetricLabel,
                    { color: colors.textTertiary },
                  ]}
                >
                  {metric.label}
                </Text>
              </View>
            ))}
          </View>
          <Text
            style={[styles.evidenceCoverage, { color: colors.textTertiary }]}
          >
            {window.recordLabel ? (
              <>
                {formatEvidenceCount(window.recordCount)} {window.recordLabel}
                {window.coveragePercent === undefined
                  ? null
                  : ` | ${formatEvidenceNumber(window.coveragePercent, 1)}% coverage`}
              </>
            ) : null}
            {!window.recordLabel ? (
              <>
                {formatEvidenceCount(window.recordCount)} glucose readings |{" "}
                {window.coveragePercent === undefined
                  ? "Coverage unavailable"
                  : `${formatEvidenceNumber(window.coveragePercent, 1)}% coverage`}
              </>
            ) : null}
          </Text>
          {window.coverageStatus !== "sufficient" &&
          window.coveragePercent !== undefined ? (
            <View
              style={[
                styles.evidenceCoverageNotice,
                {
                  backgroundColor: `${colors.warning}10`,
                  borderRadius: radius.sm,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.warning}
                name="information-circle-outline"
                size={15}
              />
              <Text
                style={[
                  styles.evidenceCoverageNoticeText,
                  { color: colors.textSecondary },
                ]}
              >
                {window.coverageStatus === "unavailable"
                  ? "No glucose readings — these metrics are unavailable."
                  : "Limited coverage — values describe observed sensor time only, not the complete period."}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
      <Text
        style={[styles.evidenceSummaryNote, { color: colors.textSecondary }]}
      >
        {presentation.detail}
      </Text>
    </View>
  );
}

function directAnswerKindLabel(presentation: TarvisDirectAnswerPresentation) {
  if (presentation.source === "records") return "From your records";
  if (presentation.source === "guidance") return "Reviewed UK guidance";
  if (presentation.source === "t1arc") return "T1 Arc help";
  const { kind } = presentation;
  switch (kind) {
    case "comparison":
      return "Comparison";
    case "pattern":
      return "Pattern spotted";
    case "explanation":
      return "What may explain it";
    case "guidance":
      return "Guidance";
    case "fact":
      return "From your records";
    default:
      return "Tarv1s insight";
  }
}

function directAnswerIcon(kind: TarvisDirectAnswerPresentation["kind"]) {
  switch (kind) {
    case "comparison":
      return "git-compare-outline" as const;
    case "pattern":
      return "analytics-outline" as const;
    case "explanation":
      return "sparkles-outline" as const;
    case "guidance":
      return "shield-checkmark-outline" as const;
    default:
      return "checkmark-circle-outline" as const;
  }
}

function directConfidenceLabel(
  confidence: TarvisDirectAnswerPresentation["confidence"],
) {
  return confidence === "high"
    ? "Strong evidence"
    : confidence === "moderate"
      ? "Good evidence"
      : "Limited evidence";
}

function TarvisDirectAnswerContent({
  disabled,
  evidenceLookup,
  guidanceSources,
  onInspectEvidence,
  onFollowUp,
  presentation,
}: {
  disabled: boolean;
  evidenceLookup: TarvisEvidenceLookup;
  guidanceSources: TarvisGuidanceReference[];
  onInspectEvidence(evidence: EvidenceReference): void;
  onFollowUp(question: string): void;
  presentation: TarvisDirectAnswerPresentation;
}) {
  const { colors, radius } = useAppTheme();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [findingsVisible, setFindingsVisible] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const detailCount =
    presentation.evidence.length + presentation.limitations.length;
  const visibleFindings = findingsVisible
    ? presentation.keyFindings
    : presentation.keyFindings.slice(0, 3);
  const hiddenFindingCount = Math.max(
    0,
    presentation.keyFindings.length - visibleFindings.length,
  );

  return (
    <>
      <View style={styles.directEyebrowRow}>
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name={directAnswerIcon(presentation.kind)}
          size={18}
        />
        <View style={styles.directEyebrowCopy}>
          <Text style={[styles.directEyebrow, { color: colors.accent }]}>
            Tarv1s
          </Text>
          <Text
            style={[styles.directConfidence, { color: colors.textTertiary }]}
          >
            {directAnswerKindLabel(presentation)} ·{" "}
            {directConfidenceLabel(presentation.confidence)}
          </Text>
        </View>
      </View>

      <Text style={[styles.directHeadline, { color: colors.text }]}>
        {presentation.headline}
      </Text>

      {presentation.primaryMetric ? (
        <View
          accessible
          accessibilityLabel={`${presentation.primaryMetric.label}: ${presentation.primaryMetric.value} ${presentation.primaryMetric.unit}`}
          style={[
            styles.directMetric,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.lg,
            },
          ]}
        >
          <Text
            style={[styles.directMetricLabel, { color: colors.textSecondary }]}
          >
            {presentation.primaryMetric.label}
          </Text>
          <View style={styles.directMetricValueRow}>
            <Text style={[styles.directMetricValue, { color: colors.text }]}>
              {presentation.primaryMetric.value}
            </Text>
            {presentation.primaryMetric.unit ? (
              <Text
                style={[
                  styles.directMetricUnit,
                  { color: colors.textSecondary },
                ]}
              >
                {presentation.primaryMetric.unit}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <Text
        numberOfLines={summaryVisible ? undefined : 5}
        style={[styles.directSummary, { color: colors.textSecondary }]}
      >
        {presentation.summary}
      </Text>
      {presentation.summary.length > 360 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: summaryVisible }}
          onPress={() => setSummaryVisible((visible) => !visible)}
          style={({ pressed }) => [
            styles.directInlineAction,
            { opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Text
            style={[styles.directInlineActionText, { color: colors.primary }]}
          >
            {summaryVisible ? "Show less" : "Read the full answer"}
          </Text>
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name={summaryVisible ? "chevron-up" : "chevron-down"}
            size={16}
          />
        </Pressable>
      ) : null}

      {presentation.keyFindings.length ? (
        <View style={styles.directFindings}>
          {visibleFindings.map((finding, index) => (
            <View
              key={`${finding.title}:${index}`}
              style={styles.directFinding}
            >
              <View
                style={[
                  styles.directFindingMarker,
                  { backgroundColor: colors.accent },
                ]}
              />
              <View style={styles.directFindingCopy}>
                <Text
                  style={[styles.directFindingTitle, { color: colors.text }]}
                >
                  {finding.title}
                </Text>
                <Text
                  style={[
                    styles.directFindingDetail,
                    { color: colors.textSecondary },
                  ]}
                >
                  {finding.detail}
                </Text>
              </View>
            </View>
          ))}
          {hiddenFindingCount || findingsVisible ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: findingsVisible }}
              onPress={() => setFindingsVisible((visible) => !visible)}
              style={({ pressed }) => [
                styles.directInlineAction,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.directInlineActionText,
                  { color: colors.primary },
                ]}
              >
                {findingsVisible
                  ? "Show fewer details"
                  : `Show ${formatEvidenceCount(hiddenFindingCount)} more ${hiddenFindingCount === 1 ? "detail" : "details"}`}
              </Text>
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                name={findingsVisible ? "chevron-up" : "chevron-down"}
                size={16}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {presentation.interpretation ? (
        <View
          style={[
            styles.directInterpretation,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="sparkles-outline"
            size={17}
          />
          <View style={styles.directInterpretationCopy}>
            <Text
              style={[
                styles.directInterpretationLabel,
                { color: colors.primary },
              ]}
            >
              My read
            </Text>
            <Text
              style={[
                styles.directInterpretationText,
                { color: colors.textSecondary },
              ]}
            >
              {presentation.interpretation}
            </Text>
          </View>
        </View>
      ) : null}

      {presentation.safetyNotice ? (
        <View
          style={[
            styles.directSafety,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.warning,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.warning}
            name="medical-outline"
            size={17}
          />
          <Text
            style={[styles.directSafetyText, { color: colors.textSecondary }]}
          >
            {presentation.safetyNotice}
          </Text>
        </View>
      ) : null}

      {detailCount ? (
        <View style={[styles.directDetails, { borderColor: colors.divider }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsVisible }}
            onPress={() => setDetailsVisible((visible) => !visible)}
            style={({ pressed }) => [
              styles.directDetailsButton,
              { opacity: pressed ? 0.65 : 1 },
            ]}
          >
            <View style={styles.directDetailsButtonCopy}>
              <Text style={[styles.directDetailsTitle, { color: colors.text }]}>
                {detailsVisible ? "Hide evidence" : "See evidence"}
              </Text>
              <Text
                style={[
                  styles.directDetailsCount,
                  { color: colors.textTertiary },
                ]}
              >
                {detailCount} {detailCount === 1 ? "item" : "items"}
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name={detailsVisible ? "chevron-up" : "chevron-down"}
              size={18}
            />
          </Pressable>
          {detailsVisible ? (
            <View style={styles.directDetailsBody}>
              {presentation.evidence.map((item, index) => {
                const reference = item.evidenceId
                  ? evidenceLookup.references.get(item.evidenceId)
                  : undefined;
                const guidance = item.evidenceId?.startsWith("guidance:")
                  ? guidanceSources.find(
                      ({ knowledgeId }) =>
                        `guidance:${knowledgeId}` === item.evidenceId,
                    )
                  : undefined;
                const content = (
                  <>
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.accent}
                      name="document-text-outline"
                      size={16}
                    />
                    <View style={styles.directEvidenceCopy}>
                      <Text
                        style={[
                          styles.directEvidenceLabel,
                          { color: colors.text },
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Text
                        style={[
                          styles.directEvidenceDetail,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {item.detail}
                      </Text>
                    </View>
                    {reference || guidance ? (
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.textTertiary}
                        name={guidance ? "open-outline" : "chevron-forward"}
                        size={17}
                      />
                    ) : null}
                  </>
                );
                return reference || guidance ? (
                  <Pressable
                    key={`${item.label}:${index}`}
                    accessibilityRole="button"
                    onPress={() => {
                      if (reference) onInspectEvidence(reference);
                      else if (guidance)
                        void Linking.openURL(guidance.sourceUrl);
                    }}
                    style={({ pressed }) => [
                      styles.directEvidenceItem,
                      { opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    {content}
                  </Pressable>
                ) : (
                  <View
                    key={`${item.label}:${index}`}
                    style={styles.directEvidenceItem}
                  >
                    {content}
                  </View>
                );
              })}
              {presentation.limitations.length ? (
                <View
                  style={[
                    styles.directCaveats,
                    { borderColor: colors.divider },
                  ]}
                >
                  <Text
                    style={[
                      styles.directCaveatsTitle,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Keep in mind
                  </Text>
                  {presentation.limitations.map((item, index) => (
                    <Text
                      key={`${item}:${index}`}
                      style={[
                        styles.directCaveat,
                        { color: colors.textTertiary },
                      ]}
                    >
                      • {item}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {presentation.followUpQuestions.length ? (
        <View style={styles.directFollowUps}>
          <Text
            style={[
              styles.directFollowUpsTitle,
              { color: colors.textSecondary },
            ]}
          >
            You could ask
          </Text>
          {presentation.followUpQuestions.map((followUp, index) => (
            <Pressable
              key={`${followUp}:${index}`}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => onFollowUp(followUp)}
              style={({ pressed }) => [
                styles.directFollowUp,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
                },
              ]}
            >
              <Text style={[styles.directFollowUpText, { color: colors.text }]}>
                {followUp}
              </Text>
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                name="arrow-forward"
                size={16}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );
}

function TarvisRouteMarker({
  hostedAnswer,
  latest,
}: {
  hostedAnswer: boolean;
  latest: boolean;
}) {
  if (!latest) return null;
  return (
    <View
      accessible
      accessibilityLabel="Latest Tarv1s response"
      collapsable={false}
      importantForAccessibility="yes"
      nativeID={
        hostedAnswer ? "tarvis-response-assisted" : "tarvis-response-local"
      }
      style={styles.routeMarker}
      testID={
        hostedAnswer ? "tarvis-response-assisted" : "tarvis-response-local"
      }
    />
  );
}

type TarvisConfirmation =
  "new-conversation" | "remove-key" | "delete-conversation";

function TarvisConfirmationDialog({
  confirmation,
  onCancel,
  onConfirm,
  working,
}: {
  confirmation?: TarvisConfirmation;
  onCancel(): void;
  onConfirm(): void;
  working: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const newConversation = confirmation === "new-conversation";
  const deletingConversation = confirmation === "delete-conversation";
  const title = deletingConversation
    ? "Delete this conversation?"
    : newConversation
      ? "Start a new conversation?"
      : "Disconnect broader answers?";
  const detail = deletingConversation
    ? "This removes only this Tarv1s thread from this phone. Your health records are not affected."
    : newConversation
      ? "Your current thread will stay saved on this phone. The next question will begin a separate conversation."
      : "Tarv1s can still answer supported questions using data on this phone. Broader questions will be unavailable until you reconnect.";
  const action = deletingConversation
    ? "Delete"
    : newConversation
      ? "Start new"
      : "Disconnect";
  const cancel = newConversation
    ? "Keep this conversation"
    : deletingConversation
      ? "Cancel"
      : "Keep connected";

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={Boolean(confirmation)}
    >
      <View style={styles.confirmationFrame}>
        <Pressable
          accessibilityLabel="Cancel"
          accessibilityRole="button"
          disabled={working}
          onPress={onCancel}
          style={styles.confirmationBackdrop}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.confirmationCard,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.surfaceBorder,
              borderRadius: radius.lg,
            },
          ]}
        >
          <View
            style={[
              styles.confirmationIcon,
              {
                backgroundColor: `${colors.accent}18`,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name={
                deletingConversation
                  ? "trash-outline"
                  : newConversation
                    ? "chatbubble-ellipses-outline"
                    : "link-outline"
              }
              size={24}
            />
          </View>
          <Text
            accessibilityRole="header"
            style={[styles.confirmationTitle, { color: colors.text }]}
          >
            {title}
          </Text>
          <Text
            style={[styles.confirmationDetail, { color: colors.textSecondary }]}
          >
            {detail}
          </Text>
          <View style={styles.confirmationActions}>
            <Pressable
              accessibilityRole="button"
              disabled={working}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.confirmationButton,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: working ? 0.5 : pressed ? 0.68 : 1,
                },
              ]}
            >
              <Text
                style={[styles.confirmationButtonText, { color: colors.text }]}
              >
                {cancel}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={working}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.confirmationButton,
                {
                  backgroundColor: newConversation
                    ? colors.primary
                    : colors.danger,
                  borderColor: newConversation ? colors.primary : colors.danger,
                  borderRadius: radius.md,
                  opacity: working ? 0.5 : pressed ? 0.72 : 1,
                },
              ]}
            >
              {working ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : null}
              <Text
                style={[
                  styles.confirmationButtonText,
                  { color: colors.onPrimary },
                ]}
              >
                {action}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TarvisConversationHistory({
  onDelete,
  onOpen,
  onOpenSettings,
  threads,
}: {
  onDelete(thread: ConversationThreadSummary): void;
  onOpen(threadId: string): void;
  onOpenSettings(): void;
  threads: readonly ConversationThreadSummary[];
}) {
  const { colors, radius } = useAppTheme();
  const grouped = CONVERSATION_HISTORY_GROUPS.map((label) => ({
    label,
    threads: threads.filter(
      ({ updatedAt }) => conversationHistoryGroup(updatedAt) === label,
    ),
  })).filter(({ threads: matching }) => matching.length);

  return (
    <>
      <View style={styles.historyIntro}>
        <Text style={[styles.historyTitle, { color: colors.text }]}>
          Your conversations
        </Text>
        <Text style={[styles.historyDetail, { color: colors.textSecondary }]}>
          Each question started from the Tarv1s home lives in its own thread.
          Everything stays saved on this phone.
        </Text>
      </View>
      {grouped.length ? (
        grouped.map((group) => (
          <View key={group.label} style={styles.historyGroup}>
            <Text
              style={[styles.historyGroupTitle, { color: colors.textTertiary }]}
            >
              {group.label === "Previous 7 days"
                ? `Previous ${formatEvidenceCount(7)} days`
                : group.label}
            </Text>
            <View style={styles.historyList}>
              {group.threads.map((thread) => (
                <Pressable
                  key={thread.id}
                  accessibilityLabel={`Open conversation: ${thread.title}`}
                  accessibilityRole="button"
                  onPress={() => onOpen(thread.id)}
                  style={({ pressed }) => [
                    styles.historyRow,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.historyIcon,
                      {
                        backgroundColor: `${colors.primary}16`,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name="chatbubble-ellipses-outline"
                      size={19}
                    />
                  </View>
                  <View style={styles.historyRowCopy}>
                    <Text
                      numberOfLines={2}
                      style={[styles.historyRowTitle, { color: colors.text }]}
                    >
                      {thread.title}
                    </Text>
                    <Text
                      style={[
                        styles.historyRowMeta,
                        { color: colors.textTertiary },
                      ]}
                    >
                      {conversationUpdatedLabel(thread.updatedAt)} ·{" "}
                      {formatEvidenceCount(thread.exchangeCount)}{" "}
                      {thread.exchangeCount === 1 ? "answer" : "answers"}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityLabel={`Conversation options for ${thread.title}`}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => onDelete(thread)}
                    style={({ pressed }) => [
                      styles.historyMenuButton,
                      { opacity: pressed ? 0.55 : 1 },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.textTertiary}
                      name="ellipsis-horizontal"
                      size={20}
                    />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          </View>
        ))
      ) : (
        <SectionCard>
          <Text style={[styles.historyEmptyTitle, { color: colors.text }]}>
            No saved conversations yet
          </Text>
          <Text style={[styles.historyDetail, { color: colors.textSecondary }]}>
            Return to Tarv1s and ask a question to begin your first thread.
          </Text>
        </SectionCard>
      )}
      <Pressable
        accessibilityLabel="Open Tarv1s settings"
        accessibilityRole="button"
        onPress={onOpenSettings}
        style={({ pressed }) => [
          styles.historySettings,
          {
            borderColor: colors.border,
            borderRadius: radius.md,
            opacity: pressed ? 0.65 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.textSecondary}
          name="settings-outline"
          size={19}
        />
        <Text
          style={[styles.historySettingsText, { color: colors.textSecondary }]}
        >
          Tarv1s settings
        </Text>
      </Pressable>
    </>
  );
}

export function TarvisScreen({
  asOf,
  conversationScope,
  initialQuestion,
  liveData,
  report,
  loadGlucoseReadings,
  loadTimelineData,
  loadPhysiologyData,
  loadTimestampedIob,
  loadReportForRange,
  onBack,
  onInspectEvidence,
}: Props) {
  const { colors, radius } = useAppTheme();
  const evidence = useMemo(() => buildTarvisEvidencePacket(report), [report]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [settingsActionError, setSettingsActionError] = useState<string>();
  const [settingsWorking, setSettingsWorking] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [, setUsage] = useState<TarvisUsage>();
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);
  const [recentThreads, setRecentThreads] = useState<
    ConversationThreadSummary[]
  >([]);
  const [conversationVisible, setConversationVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [threadPendingDelete, setThreadPendingDelete] =
    useState<ConversationThreadSummary>();
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [conversationCorrupt, setConversationCorrupt] = useState(false);
  const [conversationScopeNotice, setConversationScopeNotice] = useState(false);
  const [pendingClarification, setPendingClarification] =
    useState<PendingTarvisClarification>();
  const [confirmation, setConfirmation] = useState<TarvisConfirmation>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const scrollViewRef = useRef<ScrollView>(null);
  const questionInputRef = useRef<TextInput>(null);
  const pendingScrollExchangeId = useRef<string | undefined>(undefined);
  const allStoredExchanges = useRef<LoadedStoredTarvisExchange[]>([]);
  const exchangesRef = useRef<ChatExchange[]>([]);
  const activeThreadIdRef = useRef<string | undefined>(undefined);
  const workingRef = useRef(false);
  const conversationLifecycleRef = useRef<ReturnType<
    typeof createTarvisScreenLifecycleCoordinator
  > | null>(null);
  if (!conversationLifecycleRef.current) {
    conversationLifecycleRef.current = createTarvisScreenLifecycleCoordinator();
  }
  const conversationScopeLeaseRef = useRef<TarvisScreenScopeLease | undefined>(
    undefined,
  );
  const loadedConversationScopeRef = useRef<TarvisConversationScope | undefined>(
    undefined,
  );
  const conversationPersistence = getTarvisConversationPersistenceCoordinator();
  const settingsView = tarvisSettingsPresentation(
    loadingSettings ? "loading" : settingsLoadFailed ? "error" : "loaded",
    hasApiKey,
  );

  function chatExchangesFromStored(
    stored: readonly LoadedStoredTarvisExchange[],
  ): ChatExchange[] {
    return stored.map((exchange) => ({
      id: exchange.id,
      threadId: exchange.threadId,
      question: exchange.question,
      answer: exchange.answer,
      clarificationQuestion: exchange.clarificationQuestion,
      intent: exchange.intent,
      presentation: exchange.presentation,
      requestMetrics: exchange.requestMetrics,
      modelRequestSent:
        exchange.modelRequestSent ?? Boolean(exchange.requestMetrics),
      answerSource: exchange.answerSource ?? "local",
      modelSharing: exchange.modelSharing,
      guidanceSources: exchange.guidanceSources ?? [],
      answerBundle: exchange.answerBundle,
      createdAt: exchange.createdAt,
      scope: exchange.scope,
      evidence: {
        packet: evidence.packet,
        references: new Map(
          exchange.evidence.map((reference) => [reference.id, reference]),
        ),
      },
    }));
  }

  function threadSummaries(
    stored: readonly LoadedStoredTarvisExchange[],
  ): ConversationThreadSummary[] {
    const threads = new Map<string, LoadedStoredTarvisExchange[]>();
    stored
      .filter((exchange) =>
        sameTarvisConversationScope(exchange.scope, conversationScope),
      )
      .forEach((exchange) => {
        const thread = threads.get(exchange.threadId);
        if (thread) thread.push(exchange);
        else threads.set(exchange.threadId, [exchange]);
      });
    return [...threads.entries()]
      .map(([id, thread]) => {
        const ordered = [...thread].sort(
          (left, right) => left.createdAt - right.createdAt,
        );
        return {
          id,
          title: ordered[0]?.question ?? "Tarv1s conversation",
          updatedAt: ordered.at(-1)?.createdAt ?? 0,
          exchangeCount: ordered.length,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function createThreadId() {
    return `thread:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }

  useEffect(() => {
    const draft = initialQuestion?.trim();
    if (draft) setQuestion(draft);
  }, [initialQuestion]);

  const refreshSettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsActionError(undefined);
    try {
      const settings = await loadTarvisSettings();
      setHasApiKey(settings.hasApiKey);
      setSettingsLoadFailed(false);
      setUsage(settings.usage);
    } catch {
      setSettingsLoadFailed(true);
      setSettingsActionError(
        "Tarv1s could not open its saved connection. Retry before changing the connection.",
      );
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadTarvisSettings()
      .then((settings) => {
        if (!active) return;
        setHasApiKey(settings.hasApiKey);
        setSettingsLoadFailed(false);
        setSettingsActionError(undefined);
        setUsage(settings.usage);
      })
      .catch(() => {
        if (!active) return;
        setSettingsLoadFailed(true);
        setSettingsActionError(
          "Tarv1s could not open its saved connection. Retry before changing the connection.",
        );
      })
      .finally(() => {
        if (active) setLoadingSettings(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useLayoutEffect(() => {
    const previousScope = loadedConversationScopeRef.current;
    const bindingUpgrade = Boolean(
      previousScope &&
        canUpgradeTarvisConversationScope(previousScope, conversationScope),
    );
    const previouslyActiveThreadId = activeThreadIdRef.current;
    const operationWasRunning = workingRef.current;
    loadedConversationScopeRef.current = conversationScope;
    const scopeLease = conversationLifecycleRef.current!.enterScope(
      conversationScope.identity,
    );
    conversationScopeLeaseRef.current = scopeLease;
    if (!bindingUpgrade) {
      allStoredExchanges.current = [];
      exchangesRef.current = [];
      activeThreadIdRef.current = undefined;
      pendingScrollExchangeId.current = undefined;
      setExchanges([]);
      setRecentThreads([]);
      setConversationVisible(false);
      setHistoryVisible(false);
      setThreadPendingDelete(undefined);
      setPendingClarification(undefined);
      setConversationCorrupt(false);
      setConversationScopeNotice(false);
      setError(undefined);
    }
    workingRef.current = false;
    setConversationLoaded(false);
    setWorking(false);
    void conversationPersistence
      .load()
      .then(async (result) => {
        scopeLease.assertCurrent();
        if (result.status === "corrupt") {
          allStoredExchanges.current = [];
          exchangesRef.current = [];
          setConversationCorrupt(true);
          setConversationLoaded(false);
          setError(undefined);
          return;
        }
        let stored = result.exchanges;
        if (bindingUpgrade && previousScope) {
          const upgraded = stored.map((exchange) =>
            sameTarvisConversationScope(exchange.scope, previousScope)
              ? { ...exchange, scope: conversationScope }
              : exchange,
          );
          if (upgraded.some((exchange, index) => exchange !== stored[index])) {
            await conversationPersistence.replace(upgraded);
            scopeLease.assertCurrent();
            stored = upgraded;
          }
        }
        allStoredExchanges.current = stored;
        const scoped = stored.filter((exchange) =>
          sameTarvisConversationScope(exchange.scope, conversationScope),
        );
        setConversationScopeNotice(stored.length > 0 && scoped.length === 0);
        const summaries = threadSummaries(scoped);
        const latestThreadId =
          bindingUpgrade &&
          previouslyActiveThreadId &&
          summaries.some(({ id }) => id === previouslyActiveThreadId)
            ? previouslyActiveThreadId
            : summaries[0]?.id;
        const latestStored = latestThreadId
          ? scoped.filter((exchange) => exchange.threadId === latestThreadId)
          : [];
        const restored = chatExchangesFromStored(latestStored);
        activeThreadIdRef.current = latestThreadId;
        setRecentThreads(summaries);
        exchangesRef.current = restored;
        setExchanges(restored);
        const clarificationQuestion =
          latestStored.at(-1)?.clarificationQuestion;
        if (clarificationQuestion) {
          const resolution = resolveTarvisIntent(clarificationQuestion, {
            now: liveData ? Date.now() : asOf,
            timezone: getRuntimeAnalysisTimeZone(),
          });
          if (resolution.outcome.status === "needs_clarification") {
            setPendingClarification({
              question: clarificationQuestion,
              resolution,
            });
          }
        }
        setConversationCorrupt(false);
        setConversationLoaded(true);
        if (bindingUpgrade && operationWasRunning) {
          setError(
            "Your local records finished verifying while Tarv1s was working. The saved conversation is still here; please send that question again.",
          );
        }
      })
      .catch((reason) => {
        if (isTarvisScreenLifecycleSupersededError(reason)) return;
        try {
          scopeLease.assertCurrent();
        } catch (scopeError) {
          if (isTarvisScreenLifecycleSupersededError(scopeError)) return;
          throw scopeError;
        }
        setError(
          "The saved Tarv1s conversation could not be loaded. Sending is disabled to protect the existing conversation; close and reopen Tarv1s to retry.",
        );
      });
    return () => {
      scopeLease.close();
      if (conversationScopeLeaseRef.current === scopeLease) {
        conversationScopeLeaseRef.current = undefined;
      }
    };
    // `identity` is the canonical scope boundary. Live clock/report refreshes
    // deliberately must not reload, cancel, or rebind the active conversation;
    // the other values are snapshots consumed only when that identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationScope.identity]);

  function storedExchanges(
    items: ChatExchange[],
  ): LoadedStoredTarvisExchange[] {
    return items.map((exchange) => ({
      id: exchange.id,
      threadId: exchange.threadId,
      question: exchange.question,
      answer: exchange.answer,
      clarificationQuestion: exchange.clarificationQuestion,
      intent: exchange.intent,
      presentation: exchange.presentation,
      requestMetrics: exchange.requestMetrics,
      modelRequestSent: exchange.modelRequestSent,
      answerSource: exchange.answerSource,
      modelSharing: exchange.modelSharing,
      guidanceSources: exchange.guidanceSources,
      answerBundle: exchange.answerBundle,
      createdAt: exchange.createdAt,
      scope: exchange.scope,
      evidence: exchange.answer.evidenceIds.flatMap((id) => {
        const reference = exchange.evidence.references.get(id);
        return reference ? [reference] : [];
      }),
    }));
  }

  async function appendExchange(
    {
      answer,
      clarificationQuestion,
      evidenceLookup,
      intent,
      nextPendingClarification,
      presentation,
      prompt,
      requestMetrics,
      modelRequestSent = false,
      answerSource = "local",
      modelSharing,
      guidanceSources = [],
      answerBundle,
    }: {
      answer: TarvisAnswer;
      clarificationQuestion?: string;
      evidenceLookup: TarvisEvidenceLookup;
      intent?: TarvisIntentV1;
      presentation?: TarvisEvidencePresentation;
      prompt: string;
      requestMetrics?: TarvisRequestMetrics;
      modelRequestSent?: boolean;
      answerSource?: "hosted" | "local";
      modelSharing?: "local-only";
      guidanceSources?: TarvisGuidanceReference[];
      answerBundle?: GlucoseAnswerBundleV2;
      nextPendingClarification: PendingTarvisClarification | undefined;
    },
    writeLease: LocalDataWriteLease,
    operation: TarvisScreenOperationLease,
  ) {
    operation.assertCurrent();
    const threadId = activeThreadIdRef.current;
    if (!threadId) {
      throw new Error("Tarv1s could not identify the active conversation.");
    }
    const currentExchanges = exchangesRef.current;
    const createdAt = Date.now();
    const exchangeId = `${createdAt}:${currentExchanges.length}`;
    const next = [
      ...currentExchanges,
      {
        id: exchangeId,
        threadId,
        question: prompt,
        answer,
        clarificationQuestion,
        evidence: evidenceLookup,
        intent,
        presentation,
        requestMetrics,
        modelRequestSent,
        answerSource,
        modelSharing,
        guidanceSources,
        answerBundle,
        createdAt,
        scope: conversationScope,
      },
    ].slice(-MAX_STORED_TARVIS_EXCHANGES);
    let combined: LoadedStoredTarvisExchange[] | undefined;
    let persistenceError: unknown;
    if (conversationLoaded) {
      const retained = allStoredExchanges.current.filter(
        (exchange) =>
          !sameTarvisConversationScope(exchange.scope, conversationScope) ||
          exchange.threadId !== threadId,
      );
      combined = [...retained, ...storedExchanges(next)].slice(
        -MAX_STORED_TARVIS_EXCHANGES,
      );
      try {
        operation.assertCurrent();
        const result = await conversationPersistence.save(combined, writeLease);
        if (result === "superseded") return;
        operation.assertCurrent();
      } catch (reason) {
        if (isLocalDataWriteSupersededError(reason)) throw reason;
        operation.assertCurrent();
        persistenceError = reason;
      }
    }
    const publish = async () => {
      operation.assertCurrent();
      setConversationScopeNotice(false);
      setPendingClarification(nextPendingClarification);
      pendingScrollExchangeId.current = exchangeId;
      exchangesRef.current = next;
      setExchanges(next);
      if (combined) {
        allStoredExchanges.current = combined;
        setRecentThreads(threadSummaries(combined));
      }
      if (persistenceError) {
        setError(
          persistenceError instanceof TarvisConversationStorageLimitError
            ? `The answer was shown, but it was not saved. ${persistenceError.message}`
            : "The answer was shown, but this conversation could not be saved.",
        );
      }
    };
    operation.assertCurrent();
    await withLocalDataWriteLeaseTransaction(writeLease, publish);
    operation.assertCurrent();
  }

  async function exportConversation() {
    if (!exchanges.length) return;
    try {
      await Share.share({
        title: "Ask Tarv1s conversation",
        message: formatTarvisConversation(storedExchanges(exchanges)),
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The conversation could not be exported.",
      );
    }
  }

  function confirmNewConversation() {
    if (!exchangesRef.current.length || workingRef.current) return;
    setConfirmation("new-conversation");
  }

  function startNewConversation() {
    if (workingRef.current) return;
    setConfirmation(undefined);
    activeThreadIdRef.current = undefined;
    exchangesRef.current = [];
    setExchanges([]);
    setConversationVisible(false);
    setPendingClarification(undefined);
    setQuestion("");
    setError(undefined);
    requestAnimationFrame(() => questionInputRef.current?.focus());
  }

  async function recoverCorruptConversation() {
    if (workingRef.current) return;
    const scopeLease = conversationScopeLeaseRef.current;
    if (!scopeLease || scopeLease.identity !== conversationScope.identity) {
      return;
    }
    let operation: TarvisScreenOperationLease;
    try {
      operation = scopeLease.beginOperation();
    } catch (reason) {
      if (isTarvisScreenLifecycleSupersededError(reason)) return;
      throw reason;
    }
    workingRef.current = true;
    setWorking(true);
    setError(undefined);
    try {
      await conversationPersistence.replace([]);
      operation.assertCurrent();
      allStoredExchanges.current = [];
      exchangesRef.current = [];
      activeThreadIdRef.current = undefined;
      setExchanges([]);
      setRecentThreads([]);
      setConversationVisible(false);
      setPendingClarification(undefined);
      setConversationCorrupt(false);
      setConversationScopeNotice(false);
      setConversationLoaded(true);
    } catch (reason) {
      if (isTarvisScreenLifecycleSupersededError(reason)) return;
      try {
        operation.assertCurrent();
      } catch (scopeError) {
        if (isTarvisScreenLifecycleSupersededError(scopeError)) return;
        throw scopeError;
      }
      setError(
        "The unreadable conversation could not be removed. Sending remains disabled so it cannot be overwritten.",
      );
    } finally {
      if (operation.isCurrent()) {
        workingRef.current = false;
        setWorking(false);
      }
      operation.release();
    }
  }

  function openConversationThread(threadId: string) {
    if (workingRef.current) return;
    const stored = allStoredExchanges.current
      .filter(
        (exchange) =>
          exchange.threadId === threadId &&
          sameTarvisConversationScope(exchange.scope, conversationScope),
      )
      .sort((left, right) => left.createdAt - right.createdAt);
    if (!stored.length) return;
    const restored = chatExchangesFromStored(stored);
    activeThreadIdRef.current = threadId;
    exchangesRef.current = restored;
    setExchanges(restored);
    setQuestion("");
    setError(undefined);
    const clarificationQuestion = stored.at(-1)?.clarificationQuestion;
    if (clarificationQuestion) {
      const resolution = resolveTarvisIntent(clarificationQuestion, {
        now: liveData ? Date.now() : asOf,
        timezone: getRuntimeAnalysisTimeZone(),
      });
      setPendingClarification(
        resolution.outcome.status === "needs_clarification"
          ? { question: clarificationQuestion, resolution }
          : undefined,
      );
    } else {
      setPendingClarification(undefined);
    }
    setConversationVisible(true);
  }

  async function deleteConversationThread() {
    const thread = threadPendingDelete;
    if (!thread || workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    setError(undefined);
    try {
      const retained = allStoredExchanges.current.filter(
        (exchange) => exchange.threadId !== thread.id,
      );
      await conversationPersistence.replace(retained);
      allStoredExchanges.current = retained;
      setRecentThreads(threadSummaries(retained));
      if (activeThreadIdRef.current === thread.id) {
        activeThreadIdRef.current = undefined;
        exchangesRef.current = [];
        setExchanges([]);
        setConversationVisible(false);
        setPendingClarification(undefined);
      }
      setThreadPendingDelete(undefined);
      setConfirmation(undefined);
    } catch {
      setConfirmation(undefined);
      setError(
        "That conversation could not be deleted. It remains saved on this phone.",
      );
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  }

  const handleBack = useCallback(() => {
    if (confirmation) {
      if (!working && !settingsWorking) setConfirmation(undefined);
      return;
    }
    if (settingsVisible) {
      setSettingsVisible(false);
      setApiKey("");
      setError(undefined);
      return;
    }
    if (historyVisible) {
      setHistoryVisible(false);
      setError(undefined);
      return;
    }
    if (conversationVisible) {
      setConversationVisible(false);
      return;
    }
    onBack();
  }, [
    confirmation,
    conversationVisible,
    historyVisible,
    onBack,
    settingsVisible,
    settingsWorking,
    working,
  ]);
  useAndroidBack(
    Boolean(
      confirmation || settingsVisible || historyVisible || conversationVisible,
    ),
    handleBack,
  );

  async function saveKey() {
    if (working || settingsWorking) return;
    setSettingsActionError(undefined);
    setSettingsWorking(true);
    try {
      const writeLease = await acquireLocalDataWriteLease();
      await saveTarvisApiKey(apiKey, writeLease);
      setApiKey("");
      setHasApiKey(true);
      setSettingsVisible(false);
    } catch (reason) {
      if (isLocalDataWriteSupersededError(reason)) return;
      setSettingsActionError(
        reason instanceof Error
          ? reason.message
          : "The key could not be stored.",
      );
    } finally {
      setSettingsWorking(false);
    }
  }

  function removeKey() {
    if (working || settingsWorking) return;
    setConfirmation("remove-key");
  }

  function disconnectBroaderAnswers() {
    if (working || settingsWorking) return;
    setConfirmation(undefined);
    setSettingsActionError(undefined);
    setSettingsWorking(true);
    void clearTarvisApiKey()
      .then(() => {
        setHasApiKey(false);
        setApiKey("");
      })
      .catch(() => {
        setSettingsActionError(
          "The saved key could not be removed. It remains connected on this phone.",
        );
      })
      .finally(() => setSettingsWorking(false));
  }

  async function sendQuestion(value = question) {
    const prompt = value.trim();
    if (!prompt || workingRef.current || !conversationLoaded) return;
    const scopeLease = conversationScopeLeaseRef.current;
    if (!scopeLease || scopeLease.identity !== conversationScope.identity) {
      return;
    }
    let operation: TarvisScreenOperationLease;
    try {
      operation = scopeLease.beginOperation();
    } catch (reason) {
      if (isTarvisScreenLifecycleSupersededError(reason)) return;
      throw reason;
    }
    const startsNewThread = !conversationVisible;
    if (startsNewThread || !activeThreadIdRef.current) {
      activeThreadIdRef.current = createThreadId();
      exchangesRef.current = [];
      setExchanges([]);
      setPendingClarification(undefined);
    }
    workingRef.current = true;
    setConversationVisible(true);
    setQuestion("");
    setError(undefined);
    setWorking(true);
    let writeLease: LocalDataWriteLease | undefined;
    try {
      writeLease = await acquireLocalDataWriteLease();
      const activeWriteLease = writeLease;
      operation.assertCurrent();
      const currentExchanges = startsNewThread ? [] : exchangesRef.current;
      const history: TarvisConversationTurn[] = currentExchanges.flatMap(
        (exchange) =>
          tarvisConversationTurnsForExchange({
            answer: exchange.answer.answer,
            answerSource: exchange.answerSource,
            modelSharing: exchange.modelSharing,
            headline: exchange.answer.headline,
            question: exchange.question,
          }),
      );
      const previousExchange = currentExchanges.at(-1);
      const intentHistory: TarvisIntentHistoryEntry[] = previousExchange?.intent
        ? [
            {
              turnId: previousExchange.id,
              question: previousExchange.question,
              intent: previousExchange.intent,
            },
          ]
        : [];
      const questionAsOf = liveData ? Date.now() : asOf;
      const plan = coordinateTarvisRequest({
        question: prompt,
        asOf: questionAsOf,
        conversationHistory: history,
        intentHistory,
        pendingClarification,
      });
      if (plan.kind === "answer") {
        await appendExchange(
          {
            answer: plan.answer,
            clarificationQuestion: plan.pendingClarification?.question,
            evidenceLookup: {
              packet: evidence.packet,
              references: new Map(),
            },
            nextPendingClarification: plan.pendingClarification,
            prompt,
          },
          writeLease,
          operation,
        );
        return;
      }
      if (plan.kind === "treatment-profile") {
        let answer: TarvisAnswer;
        try {
          const profile = await loadTarvisTreatmentProfile();
          operation.assertCurrent();
          await assertLocalDataWriteLeaseCurrent(activeWriteLease);
          answer = buildTarvisTreatmentProfileAnswer(
            profile,
            getRuntimeRegionalDefaults().locale,
          );
        } catch (reason) {
          if (
            isLocalDataWriteSupersededError(reason) ||
            isTarvisScreenLifecycleSupersededError(reason)
          ) {
            throw reason;
          }
          operation.assertCurrent();
          await assertLocalDataWriteLeaseCurrent(activeWriteLease);
          answer = treatmentProfileLoadFailureAnswer();
        }
        await appendExchange(
          {
            answer,
            answerSource: "local",
            modelRequestSent: false,
            modelSharing: "local-only",
            evidenceLookup: {
              packet: evidence.packet,
              references: new Map(),
            },
            nextPendingClarification: undefined,
            prompt,
          },
          activeWriteLease,
          operation,
        );
        return;
      }
      if (plan.kind === "scoped-glucose") {
        if (!loadGlucoseReadings) {
          throw new Error("Your local glucose data is not ready yet.");
        }
        const recurring = plan.intent.clockWindow !== null;
        const range = recurring
          ? rangeForLocalGlucoseIntent(plan.intent, questionAsOf)
          : rangeForLocalGlucoseRangeIntent(plan.intent, questionAsOf);
        const readings = await loadGlucoseReadings(range);
        const local = recurring
          ? buildLocalGlucoseAnswer({
              asOf: questionAsOf,
              intent: plan.intent,
              readings,
            })
          : buildLocalGlucoseRangeAnswer({
              asOf: questionAsOf,
              intent: plan.intent,
              readings,
            });
        const localEvidence = compactTarvisEvidence(
          Array.isArray(local.evidence) ? local.evidence : [local.evidence],
        );
        await appendExchange(
          {
            answer: local.answer,
            evidenceLookup: {
              packet: evidence.packet,
              references: new Map(
                localEvidence.map((reference) => [reference.id, reference]),
              ),
            },
            intent: plan.intent,
            nextPendingClarification: undefined,
            presentation: local.presentation,
            answerBundle: local.answerBundle,
            prompt,
          },
          writeLease,
          operation,
        );
        return;
      }
      if (plan.kind === "scoped-personal-data") {
        if (!loadTimelineData) {
          throw new Error("Your local health data is not ready yet.");
        }
        const ranges = rangesForLocalPersonalDataIntent(
          plan.intent,
          questionAsOf,
        );
        const [currentTimeline, previousTimeline] = await Promise.all([
          loadTimelineData(ranges.current),
          ranges.previous
            ? loadTimelineData(ranges.previous)
            : Promise.resolve(undefined),
        ]);
        const local = buildLocalPersonalDataAnswer({
          asOf: questionAsOf,
          intent: plan.intent,
          current: currentTimeline,
          previous: previousTimeline,
        });
        const localEvidence = compactTarvisEvidence(local.evidence);
        await appendExchange(
          {
            answer: local.answer,
            evidenceLookup: {
              packet: evidence.packet,
              references: new Map(
                localEvidence.map((reference) => [reference.id, reference]),
              ),
            },
            intent: plan.intent,
            nextPendingClarification: undefined,
            presentation: local.presentation,
            prompt,
          },
          writeLease,
          operation,
        );
        return;
      }

      if (plan.kind === "retrospective-event") {
        if (!loadTimelineData) {
          throw new Error("Your local health data is not ready yet.");
        }
        const local = await loadRetrospectiveEventReview({
          question: prompt,
          searchRange: plan.range,
          loadTimelineData,
          loadPhysiologyData,
          loadTimestampedIob,
        });
        const localEvidence = compactTarvisEvidence(local.evidence);
        if (local.outcome === "ready" && !settingsLoadFailed && hasApiKey) {
          const retrospectivePacket = buildTarvisRetrospectiveEvidencePacket(
            local,
            questionAsOf,
          );
          const retrospectiveGuidance = guidanceReferences(
            retrospectivePacket.reviewedKnowledge,
          );
          let response: TarvisResponse;
          try {
            response = await askTarvis(
              prompt,
              retrospectivePacket,
              history,
              writeLease,
              { signal: operation.signal, safetyHistory: history },
            );
          } catch (reason) {
            if (
              isLocalDataWriteSupersededError(reason) ||
              isTarvisConnectionSupersededError(reason) ||
              isTarvisScreenLifecycleSupersededError(reason)
            ) {
              throw reason;
            }
            const requestFailure = getTarvisRequestFailureDetails(reason);
            operation.assertCurrent();
            await assertLocalDataWriteLeaseCurrent(writeLease);
            await appendExchange(
              {
                answer: localRetrospectiveAfterHostedFailure(local.answer),
                answerSource: "local",
                modelSharing: "local-only",
                modelRequestSent: requestFailure?.modelRequestSent ?? false,
                evidenceLookup: {
                  packet: evidence.packet,
                  references: new Map(
                    localEvidence.map((reference) => [reference.id, reference]),
                  ),
                },
                guidanceSources: retrospectiveGuidance,
                nextPendingClarification: undefined,
                prompt,
                requestMetrics: requestFailure?.requestMetrics,
              },
              writeLease,
              operation,
            );
            if (requestFailure?.usage) {
              await withLocalDataWriteLeaseTransaction(writeLease, async () => {
                operation.assertCurrent();
                setUsage(requestFailure.usage!);
              });
            }
            return;
          }
          await appendExchange(
            {
              answer: response.answer,
              answerSource: response.answerSource,
              modelSharing: "local-only",
              modelRequestSent: response.modelRequestSent,
              evidenceLookup: {
                packet: evidence.packet,
                references:
                  mapTarvisRetrospectiveEvidenceReferences(localEvidence),
              },
              guidanceSources: retrospectiveGuidance,
              nextPendingClarification: undefined,
              prompt,
              requestMetrics: response.requestMetrics,
            },
            writeLease,
            operation,
          );
          await withLocalDataWriteLeaseTransaction(writeLease, async () => {
            operation.assertCurrent();
            setUsage(response.usage);
          });
          operation.assertCurrent();
          return;
        }
        const localGuidance =
          local.outcome === "ready"
            ? guidanceReferences(
                buildTarvisRetrospectiveEvidencePacket(local, questionAsOf)
                  .reviewedKnowledge,
              )
            : [];
        await appendExchange(
          {
            answer: local.answer,
            modelSharing: "local-only",
            evidenceLookup: {
              packet: evidence.packet,
              references: new Map(
                localEvidence.map((reference) => [reference.id, reference]),
              ),
            },
            guidanceSources: localGuidance,
            nextPendingClarification: undefined,
            prompt,
          },
          writeLease,
          operation,
        );
        return;
      }

      if (plan.kind === "model-plan") {
        const appendPlanningUnavailable = async (
          answer: TarvisAnswer,
          failure?: ReturnType<typeof getTarvisRequestFailureDetails>,
        ) => {
          await appendExchange(
            {
              answer,
              answerSource: "local",
              modelRequestSent: failure?.modelRequestSent ?? false,
              modelSharing: "local-only",
              evidenceLookup: {
                packet: evidence.packet,
                references: new Map(),
              },
              nextPendingClarification: undefined,
              prompt,
              requestMetrics: failure?.requestMetrics,
            },
            activeWriteLease,
            operation,
          );
          if (failure?.usage) {
            await withLocalDataWriteLeaseTransaction(
              activeWriteLease,
              async () => {
                operation.assertCurrent();
                setUsage(failure.usage!);
              },
            );
          }
        };

        if (settingsLoadFailed) {
          await appendPlanningUnavailable({
            headline: "I could not open the saved connection",
            answer:
              "Your secure settings did not load, so I couldn’t ask the AI to plan this evidence search. Close and reopen Tarv1s to retry.",
            confidence: "limited",
            evidenceIds: [],
            limitations: ["No health records left this phone."],
          });
          return;
        }
        if (!hasApiKey) {
          await appendPlanningUnavailable({
            headline: "Connect broader answers for that question",
            answer:
              "To interpret that question and request the right T1 Arc evidence, open Tarv1s settings and connect your OpenAI project.",
            confidence: "limited",
            evidenceIds: [],
            limitations: [
              "No health records were loaded and nothing left this phone.",
            ],
          });
          return;
        }

        let planning: Awaited<ReturnType<typeof planTarvisEvidenceRequest>>;
        try {
          planning = await planTarvisEvidenceRequest(
            prompt,
            plan.options,
            activeWriteLease,
            { signal: operation.signal, safetyHistory: history },
          );
        } catch (reason) {
          if (
            isLocalDataWriteSupersededError(reason) ||
            isTarvisConnectionSupersededError(reason) ||
            isTarvisScreenLifecycleSupersededError(reason)
          ) {
            throw reason;
          }
          operation.assertCurrent();
          await assertLocalDataWriteLeaseCurrent(activeWriteLease);
          await appendPlanningUnavailable(
            plan.fallback.answer,
            getTarvisRequestFailureDetails(reason),
          );
          return;
        }
        await withLocalDataWriteLeaseTransaction(activeWriteLease, async () => {
          operation.assertCurrent();
          setUsage(planning.usage);
        });
        if (planning.plan.kind === "clarify") {
          await appendExchange(
            {
              answer: tarvisEvidencePlanClarificationAnswer(planning.plan),
              answerSource: "local",
              modelRequestSent: true,
              modelSharing: "local-only",
              evidenceLookup: {
                packet: evidence.packet,
                references: new Map(),
              },
              nextPendingClarification: undefined,
              prompt,
              requestMetrics: planning.requestMetrics,
            },
            activeWriteLease,
            operation,
          );
          return;
        }
        if (!loadTimelineData) {
          throw new Error("Your local health data is not ready yet.");
        }

        const plannedEvidence = await loadPlannedGlucoseEpisodeEvidence({
          selectedEventKind: planning.plan.eventKind,
          currentRange: planning.plan.range.current,
          previousRange: planning.plan.range.previous,
          selectedCategories: planning.plan.categoryIds,
          explicitCategories: planning.plan.explicitCategoryIds,
          explicitContextChecks: planning.plan.explicitContextChecks,
          excludedContextChecks: planning.plan.excludedContextChecks,
          explicitDataQualityChecks: planning.plan.explicitDataQualityChecks,
          excludedDataQualityChecks: planning.plan.excludedDataQualityChecks,
          generatedAt: questionAsOf,
          loadTimelineData,
        });
        operation.assertCurrent();
        await assertLocalDataWriteLeaseCurrent(activeWriteLease);
        const localAnswer = localTarvisEvidenceFallback(plannedEvidence.packet);
        const localPresentation = buildTarvisEvidencePresentation(
          prompt,
          plannedEvidence.packet,
          localAnswer,
          plan.history,
        );

        let response: TarvisResponse;
        try {
          response = await askTarvis(
            prompt,
            plannedEvidence.packet,
            plan.history,
            activeWriteLease,
            {
              signal: operation.signal,
              packetIsPreselected: true,
              safetyHistory: history,
            },
          );
        } catch (reason) {
          if (
            isLocalDataWriteSupersededError(reason) ||
            isTarvisConnectionSupersededError(reason) ||
            isTarvisScreenLifecycleSupersededError(reason)
          ) {
            throw reason;
          }
          operation.assertCurrent();
          await assertLocalDataWriteLeaseCurrent(activeWriteLease);
          const failure = getTarvisRequestFailureDetails(reason);
          await appendExchange(
            {
              answer: localRetrospectiveAfterHostedFailure(localAnswer),
              answerSource: "local",
              modelRequestSent: true,
              modelSharing: "local-only",
              evidenceLookup: plannedEvidence,
              nextPendingClarification: undefined,
              presentation: localPresentation,
              prompt,
              requestMetrics: combineTarvisRequestMetrics(
                planning.requestMetrics,
                failure?.requestMetrics,
              ),
            },
            activeWriteLease,
            operation,
          );
          await withLocalDataWriteLeaseTransaction(
            activeWriteLease,
            async () => {
              operation.assertCurrent();
              setUsage(failure?.usage ?? planning.usage);
            },
          );
          return;
        }

        await appendExchange(
          {
            answer: response.answer,
            answerSource: response.answerSource,
            modelRequestSent: true,
            modelSharing: "local-only",
            evidenceLookup: plannedEvidence,
            nextPendingClarification: undefined,
            presentation: buildTarvisEvidencePresentation(
              prompt,
              plannedEvidence.packet,
              response.answer,
              plan.history,
            ),
            prompt,
            requestMetrics: combineTarvisRequestMetrics(
              planning.requestMetrics,
              response.requestMetrics,
            ),
          },
          activeWriteLease,
          operation,
        );
        await withLocalDataWriteLeaseTransaction(activeWriteLease, async () => {
          operation.assertCurrent();
          setUsage(response.usage);
        });
        operation.assertCurrent();
        return;
      }

      const reviewedKnowledge = resolveTarvisReviewedKnowledgeForTurn({
        educationRoute: plan.kind === "model-education",
        previousKnowledgeIds: previousExchange?.guidanceSources.map(
          ({ knowledgeId }) => knowledgeId,
        ),
        previousQuestion: previousExchange?.question,
        question: prompt,
      });
      if (reviewedKnowledge.length > 0) {
        await appendExchange(
          {
            answer: reviewedKnowledgeAnswerForTurn(
              prompt,
              reviewedKnowledge,
              Boolean(previousExchange),
            ),
            answerSource: "local",
            modelRequestSent: false,
            evidenceLookup: {
              packet: evidence.packet,
              references: new Map(),
            },
            guidanceSources: guidanceReferences(reviewedKnowledge),
            intent: plan.kind === "model-education" ? plan.intent : undefined,
            nextPendingClarification: undefined,
            prompt,
          },
          writeLease,
          operation,
        );
        return;
      }

      const reportForQuestion =
        plan.kind === "model-evidence" &&
        plan.evidenceRanges &&
        loadReportForRange
          ? await loadReportForRange(
              plan.evidenceRanges.current,
              plan.evidenceRanges.previous,
              questionAsOf,
            )
          : undefined;
      const rawEvidenceForQuestion =
        plan.kind === "model-education"
          ? undefined
          : reportForQuestion
            ? buildTarvisEvidencePacket(reportForQuestion)
            : evidence;
      const evidenceForQuestion =
        plan.kind === "model-evidence" && rawEvidenceForQuestion
          ? {
              ...rawEvidenceForQuestion,
              packet: selectTarvisEvidencePacket(
                prompt,
                rawEvidenceForQuestion.packet,
              ),
            }
          : rawEvidenceForQuestion;
      const localEvidenceAnswer =
        plan.kind === "model-evidence" && evidenceForQuestion
          ? localTarvisEvidenceFallback(evidenceForQuestion.packet)
          : undefined;
      const localEvidencePresentation =
        localEvidenceAnswer && evidenceForQuestion
          ? buildTarvisEvidencePresentation(
              prompt,
              evidenceForQuestion.packet,
              localEvidenceAnswer,
              plan.history,
            )
          : undefined;
      const appendLocalEvidenceFallback = async (
        failure?: ReturnType<typeof getTarvisRequestFailureDetails>,
      ) => {
        if (!localEvidenceAnswer || !evidenceForQuestion) return false;
        await appendExchange(
          {
            answer: localEvidenceAnswer,
            answerSource: "local",
            modelRequestSent: failure?.modelRequestSent ?? false,
            evidenceLookup: evidenceForQuestion,
            intent: plan.intent,
            nextPendingClarification: undefined,
            presentation: localEvidencePresentation,
            prompt,
            requestMetrics: failure?.requestMetrics,
          },
          activeWriteLease,
          operation,
        );
        if (failure?.usage) {
          await withLocalDataWriteLeaseTransaction(
            activeWriteLease,
            async () => {
              operation.assertCurrent();
              setUsage(failure.usage!);
            },
          );
        }
        return true;
      };

      if (settingsLoadFailed) {
        if (await appendLocalEvidenceFallback()) return;
        await appendExchange(
          {
            answer: {
              headline: "I could not open the saved connection",
              answer:
                "Your secure settings did not load. Close and reopen Tarv1s to retry. Supported calculations still work on this phone.",
              confidence: "limited",
              evidenceIds: [],
              limitations: ["Nothing left this phone."],
            },
            evidenceLookup: { packet: evidence.packet, references: new Map() },
            nextPendingClarification: undefined,
            prompt,
          },
          writeLease,
          operation,
        );
        return;
      }
      if (!hasApiKey) {
        if (await appendLocalEvidenceFallback()) return;
        await appendExchange(
          {
            answer: {
              headline: "Connect broader answers for that question",
              answer:
                "Supported personal calculations still work on this phone. To ask broader questions, open Tarv1s settings and connect your OpenAI project.",
              confidence: "limited",
              evidenceIds: [],
              limitations: ["Nothing left this phone."],
            },
            evidenceLookup: { packet: evidence.packet, references: new Map() },
            nextPendingClarification: undefined,
            prompt,
          },
          writeLease,
          operation,
        );
        return;
      }

      let response: TarvisResponse;
      try {
        response = await askTarvis(
          prompt,
          evidenceForQuestion?.packet,
          plan.history,
          writeLease,
          { signal: operation.signal, safetyHistory: history },
        );
      } catch (reason) {
        if (
          isLocalDataWriteSupersededError(reason) ||
          isTarvisConnectionSupersededError(reason) ||
          isTarvisScreenLifecycleSupersededError(reason)
        ) {
          throw reason;
        }
        operation.assertCurrent();
        await assertLocalDataWriteLeaseCurrent(writeLease);
        if (
          await appendLocalEvidenceFallback(
            getTarvisRequestFailureDetails(reason),
          )
        ) {
          return;
        }
        throw reason;
      }
      await appendExchange(
        {
          answer: response.answer,
          answerSource: response.answerSource,
          modelRequestSent: response.modelRequestSent,
          evidenceLookup: evidenceForQuestion ?? {
            packet: evidence.packet,
            references: new Map(),
          },
          intent: plan.intent,
          nextPendingClarification: undefined,
          presentation: evidenceForQuestion
            ? buildTarvisEvidencePresentation(
                prompt,
                evidenceForQuestion.packet,
                response.answer,
                plan.history,
              )
            : undefined,
          prompt,
          requestMetrics: response.requestMetrics,
        },
        writeLease,
        operation,
      );
      await withLocalDataWriteLeaseTransaction(writeLease, async () => {
        operation.assertCurrent();
        setUsage(response.usage);
      });
      operation.assertCurrent();
    } catch (reason) {
      try {
        operation.assertCurrent();
      } catch (scopeError) {
        if (isTarvisScreenLifecycleSupersededError(scopeError)) return;
        throw scopeError;
      }
      if (
        isLocalDataWriteSupersededError(reason) ||
        isTarvisConnectionSupersededError(reason) ||
        isTarvisScreenLifecycleSupersededError(reason)
      ) {
        return;
      }
      if (!writeLease) {
        setQuestion(prompt);
        setError(
          reason instanceof Error
            ? reason.message
            : "Tarv1s could not start this request.",
        );
        return;
      }
      try {
        await assertLocalDataWriteLeaseCurrent(writeLease);
        operation.assertCurrent();
        const clockBoundaryCapability =
          localGlucoseClockBoundaryCapability(reason);
        if (clockBoundaryCapability) {
          await appendExchange(
            {
              answer: clockBoundaryCapability,
              evidenceLookup: {
                packet: evidence.packet,
                references: new Map(),
              },
              nextPendingClarification: undefined,
              prompt,
            },
            writeLease,
            operation,
          );
          return;
        }
        await withLocalDataWriteLeaseTransaction(writeLease, async () => {
          operation.assertCurrent();
          setQuestion(prompt);
          setError(
            reason instanceof Error
              ? reason.message
              : "Tarv1s could not answer this question.",
          );
        });
      } catch (postWorkError) {
        if (
          isLocalDataWriteSupersededError(postWorkError) ||
          isTarvisConnectionSupersededError(postWorkError) ||
          isTarvisScreenLifecycleSupersededError(postWorkError)
        ) {
          return;
        }
        try {
          operation.assertCurrent();
        } catch (scopeError) {
          if (isTarvisScreenLifecycleSupersededError(scopeError)) return;
          return;
        }
        setQuestion(prompt);
        setError(
          "Tarv1s could not safely finish this request. Nothing new was added to the conversation.",
        );
      }
    } finally {
      if (operation.isCurrent()) {
        workingRef.current = false;
        setWorking(false);
      }
      operation.release();
    }
  }

  const compactHeader = (
    <View style={styles.compactHeader}>
      <Pressable
        accessibilityLabel={
          settingsVisible
            ? "Back to Tarv1s"
            : historyVisible
              ? "Back to Tarv1s home"
              : conversationVisible
                ? "Back to Tarv1s home"
                : "Open conversation history"
        }
        accessibilityRole="button"
        onPress={() => {
          if (settingsVisible || historyVisible || conversationVisible) {
            handleBack();
            return;
          }
          setHistoryVisible(true);
          setError(undefined);
        }}
        style={({ pressed }) => [
          styles.compactHeaderButton,
          { opacity: pressed ? 0.55 : 1 },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.textSecondary}
          name={
            settingsVisible || historyVisible || conversationVisible
              ? "chevron-back"
              : "albums-outline"
          }
          size={21}
        />
      </Pressable>
      <View style={styles.compactHeaderCopy}>
        <Text
          accessibilityRole="header"
          style={[styles.compactHeaderTitle, { color: colors.text }]}
        >
          {settingsVisible
            ? "Settings"
            : historyVisible
              ? "Conversations"
              : "Tarv1s"}
        </Text>
        <Text
          style={[styles.compactHeaderSubtitle, { color: colors.textTertiary }]}
        >
          {settingsVisible
            ? "Connection and privacy"
            : historyVisible
              ? "Saved on this phone"
              : "Your health companion"}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={
          historyVisible ? "Open Tarv1s settings" : "Start a new conversation"
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: settingsVisible || working }}
        disabled={settingsVisible || working}
        onPress={() => {
          if (historyVisible) {
            setHistoryVisible(false);
            setSettingsVisible(true);
            return;
          }
          if (exchangesRef.current.length) confirmNewConversation();
          else questionInputRef.current?.focus();
        }}
        style={({ pressed }) => [
          styles.compactHeaderButton,
          { opacity: settingsVisible || working ? 0 : pressed ? 0.55 : 1 },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.textSecondary}
          name={historyVisible ? "settings-outline" : "create-outline"}
          size={22}
        />
      </Pressable>
    </View>
  );

  const canSendQuestion = Boolean(
    conversationLoaded && question.trim() && !working,
  );
  const composerFooter =
    !loadingSettings && !settingsVisible && !historyVisible ? (
      <View
        style={[
          styles.composerDock,
          {
            backgroundColor: colors.background,
            borderColor: colors.divider,
          },
        ]}
      >
        {error ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.errorCard,
              {
                backgroundColor: `${colors.danger}12`,
                borderColor: `${colors.danger}55`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.danger}
              name="alert-circle-outline"
              size={19}
            />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>
              {error}
            </Text>
          </View>
        ) : null}
        {working ? (
          <View style={styles.workingRow}>
            <TarvisOrb
              accentColor={colors.accent}
              primaryColor={colors.primary}
              size={32}
              state="thinking"
            />
            <Text style={[styles.workingText, { color: colors.textSecondary }]}>
              Tarv1s is checking the evidence…
            </Text>
          </View>
        ) : null}
        <View
          style={[
            styles.composer,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.lg,
            },
          ]}
        >
          <TextInput
            ref={questionInputRef}
            accessibilityLabel="Question for Tarv1s"
            editable={!working}
            multiline
            onChangeText={setQuestion}
            placeholder="Message Tarv1s"
            placeholderTextColor={colors.textTertiary}
            style={[styles.questionInput, { color: colors.text }]}
            value={question}
          />
          <Pressable
            accessibilityLabel="Send question"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSendQuestion }}
            disabled={!canSendQuestion}
            onPress={() => void sendQuestion()}
            style={({ pressed }) => [
              styles.sendButton,
              {
                backgroundColor: canSendQuestion
                  ? colors.primary
                  : colors.border,
                borderRadius: radius.pill,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={canSendQuestion ? colors.onPrimary : colors.textTertiary}
              name="arrow-up"
              size={21}
            />
          </Pressable>
        </View>
        <Text style={[styles.boundary, { color: colors.textTertiary }]}>
          Diabetes and personal health questions only.
        </Text>
      </View>
    ) : undefined;

  const conversationActions = exchanges.length ? (
    <View style={styles.conversationActions}>
      <Pressable
        accessibilityRole="button"
        onPress={() => void exportConversation()}
        style={({ pressed }) => [
          styles.conversationAction,
          {
            borderColor: colors.border,
            borderRadius: radius.md,
            opacity: pressed ? 0.65 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="share-outline"
          size={18}
        />
        <Text
          style={[styles.conversationActionText, { color: colors.primary }]}
        >
          Export conversation
        </Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.flex}
    >
      <AppScreen
        footer={composerFooter}
        header={compactHeader}
        scrollViewRef={scrollViewRef}
        title="Tarv1s"
      >
        {settingsVisible || historyVisible ? null : (
          <TarvisWorkspaceSwitcher
            value="tarvis"
            onChange={(value) => {
              if (value === "insights") onBack();
            }}
          />
        )}

        {loadingSettings ? (
          <SectionCard style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} />
          </SectionCard>
        ) : settingsVisible ? (
          <>
            {settingsActionError ? (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.errorCard,
                  {
                    backgroundColor: `${colors.danger}12`,
                    borderColor: `${colors.danger}55`,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.danger}
                  name="alert-circle-outline"
                  size={19}
                />
                <Text
                  style={[styles.errorText, { color: colors.textSecondary }]}
                >
                  {settingsActionError}
                </Text>
              </View>
            ) : null}
            {settingsView.showRetry ? (
              <SectionCard style={styles.keyCard}>
                <Text style={[styles.keyTitle, { color: colors.text }]}>
                  Connection status unavailable
                </Text>
                <Text
                  style={[styles.keyDetail, { color: colors.textSecondary }]}
                >
                  T1 Arc will not show an empty connection form or change the
                  saved key until the secure settings load correctly.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={settingsWorking}
                  onPress={() => void refreshSettings()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      borderRadius: radius.md,
                      opacity: settingsWorking ? 0.55 : pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  {settingsWorking ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : null}
                  <Text
                    style={[
                      styles.primaryButtonText,
                      { color: colors.onPrimary },
                    ]}
                  >
                    Retry secure settings
                  </Text>
                </Pressable>
              </SectionCard>
            ) : null}
            {settingsView.showConnectionForm ? (
              <SectionCard
                style={[
                  styles.keyCard,
                  { backgroundColor: colors.surfaceElevated },
                ]}
              >
                <View style={styles.keyHeading}>
                  <View
                    style={[
                      styles.keyIcon,
                      {
                        backgroundColor: `${colors.primary}18`,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name="key-outline"
                      size={23}
                    />
                  </View>
                  <View style={styles.keyCopy}>
                    <Text style={[styles.keyTitle, { color: colors.text }]}>
                      Connect broader answers
                    </Text>
                    <Text
                      style={[
                        styles.keyDetail,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Paste a key from your OpenAI project. It stays secure on
                      this phone and is not included in logs or backups.
                    </Text>
                  </View>
                </View>
                <TextInput
                  accessibilityLabel="OpenAI API key"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setApiKey}
                  placeholder="sk-proj-…"
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry
                  style={[
                    styles.keyInput,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      color: colors.text,
                    },
                  ]}
                  value={apiKey}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!apiKey.trim() || settingsWorking || working}
                  onPress={() => void saveKey()}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: apiKey.trim()
                        ? colors.primary
                        : colors.border,
                      borderRadius: radius.md,
                      opacity:
                        settingsWorking || working ? 0.55 : pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={
                      apiKey.trim() ? colors.onPrimary : colors.textTertiary
                    }
                    name="shield-checkmark-outline"
                    size={19}
                  />
                  <Text
                    style={[
                      styles.primaryButtonText,
                      {
                        color: apiKey.trim()
                          ? colors.onPrimary
                          : colors.textTertiary,
                      },
                    ]}
                  >
                    Save key on this phone
                  </Text>
                </Pressable>
              </SectionCard>
            ) : null}

            <SectionCard>
              <Text style={[styles.guardTitle, { color: colors.text }]}>
                Your privacy
              </Text>
              <View style={styles.guardList}>
                {[
                  "Tarv1s only shares information after you tap Send.",
                  "Tarv1s answers supported personal totals directly.",
                  "Tarv1s only answers diabetes and personal health questions and never reveals saved sign-ins.",
                  "Tarv1s never sends questions while running in the background.",
                ].map((item) => (
                  <View key={item} style={styles.guardRow}>
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.accent}
                      name="checkmark-circle-outline"
                      size={17}
                    />
                    <Text
                      style={[
                        styles.guardText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
              <Text
                style={[styles.privacyNote, { color: colors.textTertiary }]}
              >
                General diabetes questions do not include your health records.
                For some personal questions, Tarv1s first sends your question
                with a bounded list of evidence choices, but no records. It then
                sends only the selected evidence needed to answer, which can
                include food names. T1 Arc disables response storage, but OpenAI
                may retain API data for safety monitoring for up to{' '}
                {formatEvidenceCount(30)} days
                unless your project has approved Zero Data Retention.
              </Text>
              {settingsView.showRemove ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={settingsWorking || working}
                  onPress={removeKey}
                  style={({ pressed }) => [
                    styles.removeButton,
                    {
                      borderColor: `${colors.danger}66`,
                      borderRadius: radius.md,
                      opacity:
                        settingsWorking || working ? 0.55 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.danger}
                    name="trash-outline"
                    size={18}
                  />
                  <Text style={[styles.removeText, { color: colors.danger }]}>
                    Remove saved key
                  </Text>
                </Pressable>
              ) : null}
            </SectionCard>
          </>
        ) : historyVisible ? (
          <TarvisConversationHistory
            onDelete={(thread) => {
              setThreadPendingDelete(thread);
              setConfirmation("delete-conversation");
            }}
            onOpen={(threadId) => {
              setHistoryVisible(false);
              openConversationThread(threadId);
            }}
            onOpenSettings={() => {
              setHistoryVisible(false);
              setSettingsVisible(true);
              setError(undefined);
            }}
            threads={recentThreads}
          />
        ) : (
          <>
            {conversationCorrupt ? (
              <SectionCard style={styles.keyCard}>
                <View style={styles.keyHeading}>
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.danger}
                    name="warning-outline"
                    size={24}
                  />
                  <View style={styles.keyCopy}>
                    <Text style={[styles.keyTitle, { color: colors.text }]}>
                      Saved conversation needs recovery
                    </Text>
                    <Text
                      style={[
                        styles.keyDetail,
                        { color: colors.textSecondary },
                      ]}
                    >
                      The saved conversation failed its integrity check. Tarv1s
                      has not loaded or overwritten it. Remove only this
                      unreadable conversation to start again.
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={working}
                  onPress={() => void recoverCorruptConversation()}
                  style={({ pressed }) => [
                    styles.removeButton,
                    {
                      borderColor: `${colors.danger}66`,
                      borderRadius: radius.md,
                      opacity: working ? 0.55 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.danger}
                    name="trash-outline"
                    size={18}
                  />
                  <Text style={[styles.removeText, { color: colors.danger }]}>
                    Remove unreadable conversation
                  </Text>
                </Pressable>
              </SectionCard>
            ) : null}
            {conversationScopeNotice &&
            !conversationCorrupt &&
            conversationVisible ? (
              <SectionCard>
                <Text
                  style={[styles.guardText, { color: colors.textSecondary }]}
                >
                  This review has its own conversation. Answers from another
                  review or the live view are kept separate and will not
                  influence this one.
                </Text>
              </SectionCard>
            ) : null}
            {!conversationVisible ? (
              <View style={styles.introHero}>
                <TarvisOrb
                  accentColor={colors.accent}
                  primaryColor={colors.primary}
                  size={84}
                />
                <Text style={[styles.introTitle, { color: colors.text }]}>
                  What can I help you understand?
                </Text>
                <Text
                  style={[styles.introDetail, { color: colors.textSecondary }]}
                >
                  Ask about your diabetes, activity, meals, insulin or any
                  health records available in T1 Arc.
                </Text>
                <View
                  style={[
                    styles.recordsReady,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="server-outline"
                    size={15}
                  />
                  <Text
                    style={[styles.recordsReadyText, { color: colors.text }]}
                  >
                    Your T1 Arc records are ready
                  </Text>
                </View>
              </View>
            ) : null}

            {conversationVisible && exchanges.length
              ? conversationActions
              : null}

            {!conversationVisible ? (
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion.question}
                    accessibilityState={{
                      disabled: !conversationLoaded || working,
                    }}
                    accessibilityRole="button"
                    disabled={!conversationLoaded || working}
                    onPress={() => void sendQuestion(suggestion.question)}
                    style={({ pressed }) => [
                      styles.suggestion,
                      {
                        backgroundColor: pressed
                          ? colors.surfaceMuted
                          : colors.surface,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        opacity: !conversationLoaded || working ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name={suggestion.icon}
                      size={19}
                    />
                    <Text
                      style={[
                        styles.suggestionText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {suggestion.question}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {!conversationVisible && recentThreads.length ? (
              <View style={styles.recentSection}>
                <View style={styles.recentHeadingRow}>
                  <Text style={[styles.recentHeading, { color: colors.text }]}>
                    Recent conversations
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setHistoryVisible(true)}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text
                      style={[
                        styles.recentActionText,
                        { color: colors.primary },
                      ]}
                    >
                      See all
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.recentList}>
                  {recentThreads.slice(0, 3).map((thread) => (
                    <Pressable
                      key={thread.id}
                      accessibilityLabel={`Open recent conversation: ${thread.title}`}
                      accessibilityRole="button"
                      onPress={() => openConversationThread(thread.id)}
                      style={({ pressed }) => [
                        styles.recentConversation,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.primary}
                        name="chatbubble-ellipses-outline"
                        size={20}
                      />
                      <View style={styles.recentConversationCopy}>
                        <Text
                          numberOfLines={2}
                          style={[
                            styles.recentConversationTitle,
                            { color: colors.text },
                          ]}
                        >
                          {thread.title}
                        </Text>
                        <Text
                          style={[
                            styles.recentConversationMeta,
                            { color: colors.textTertiary },
                          ]}
                        >
                          {`${formatEvidenceCount(thread.exchangeCount)} ${thread.exchangeCount === 1 ? "answer" : "answers"} · Saved on this phone`}
                        </Text>
                      </View>
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.textTertiary}
                        name="chevron-forward"
                        size={18}
                      />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {conversationVisible
              ? exchanges.map((exchange, exchangeIndex) => (
                  <View
                    key={exchange.id}
                    onLayout={(event) => {
                      if (pendingScrollExchangeId.current !== exchange.id)
                        return;
                      pendingScrollExchangeId.current = undefined;
                      const y = Math.max(0, event.nativeEvent.layout.y - 12);
                      requestAnimationFrame(() => {
                        scrollViewRef.current?.scrollTo({ animated: true, y });
                      });
                    }}
                    style={styles.exchange}
                  >
                    <View
                      style={[
                        styles.userBubble,
                        {
                          backgroundColor: colors.primary,
                          borderRadius: radius.lg,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.userText, { color: colors.onPrimary }]}
                      >
                        {exchange.question}
                      </Text>
                    </View>
                    <View style={styles.assistantMessage}>
                      <View style={styles.assistantAvatar}>
                        <TarvisOrb
                          accentColor={colors.accent}
                          primaryColor={colors.primary}
                          size={34}
                          state="idle"
                        />
                      </View>
                      <View style={styles.assistantContent}>
                        {exchange.answer.directPresentation ? (
                          <TarvisDirectAnswerContent
                            disabled={working}
                            evidenceLookup={exchange.evidence}
                            guidanceSources={exchange.guidanceSources}
                            onInspectEvidence={onInspectEvidence}
                            onFollowUp={(followUp) =>
                              void sendQuestion(followUp)
                            }
                            presentation={exchange.answer.directPresentation}
                          />
                        ) : (
                          <>
                          <View style={styles.answerHeading}>
                            <Ionicons
                              accessibilityElementsHidden
                              color={colors.accent}
                              name="document-text-outline"
                              size={20}
                            />
                            <View style={styles.answerHeadingCopy}>
                              <Text
                                style={[
                                  styles.answerTitle,
                                  { color: colors.text },
                                ]}
                              >
                                {exchange.answer.headline}
                              </Text>
                              <Text
                                style={[
                                  styles.confidence,
                                  { color: colors.textTertiary },
                                ]}
                              >
                                {confidenceLabel(exchange.answer.confidence)}
                              </Text>
                            </View>
                          </View>
                          {exchange.intent ? (
                            <View
                              accessible
                              accessibilityLabel={`Answering for ${describeTarvisIntent(exchange.intent, { timezone: "local time" })}`}
                              style={[
                                styles.interpretation,
                                {
                                  backgroundColor: colors.surfaceMuted,
                                  borderColor: colors.border,
                                  borderRadius: radius.md,
                                },
                              ]}
                            >
                              <Ionicons
                                accessibilityElementsHidden
                                color={colors.primary}
                                name="calculator-outline"
                                size={15}
                              />
                              <Text
                                style={[
                                  styles.interpretationText,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                <Text style={styles.interpretationLabel}>
                                  Answering for{" "}
                                </Text>
                                {describeTarvisIntent(exchange.intent, {
                                  timezone: "local time",
                                })}
                              </Text>
                            </View>
                          ) : null}
                          <Text
                            style={[
                              styles.answerText,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {exchange.answer.answer}
                          </Text>
                          {exchange.guidanceSources.length ? (
                            <View style={styles.evidenceList}>
                              <Text
                                style={[
                                  styles.evidenceHeading,
                                  { color: colors.text },
                                ]}
                              >
                                Reviewed NICE guidance
                              </Text>
                              {exchange.guidanceSources.map((source) => (
                                <Pressable
                                  key={source.knowledgeId}
                                  accessibilityHint="Opens the NICE guidance in your browser"
                                  accessibilityLabel={`${source.sourceTitle}. Recommendations ${source.recommendationRefs.join(", ")}`}
                                  accessibilityRole="link"
                                  onPress={() => {
                                    void Linking.openURL(
                                      source.sourceUrl,
                                    ).catch(() => {
                                      setError(
                                        "The NICE guidance link could not be opened on this device.",
                                      );
                                    });
                                  }}
                                  style={({ pressed }) => [
                                    styles.evidenceButton,
                                    {
                                      backgroundColor: colors.surfaceMuted,
                                      borderRadius: radius.md,
                                      opacity: pressed ? 0.68 : 1,
                                    },
                                  ]}
                                >
                                  <Ionicons
                                    accessibilityElementsHidden
                                    color={colors.primary}
                                    name="shield-checkmark-outline"
                                    size={18}
                                  />
                                  <View style={styles.evidenceCopy}>
                                    <Text
                                      style={[
                                        styles.evidenceLabel,
                                        { color: colors.text },
                                      ]}
                                    >
                                      {source.sourceTitle}
                                    </Text>
                                    <Text
                                      style={[
                                        styles.evidenceCount,
                                        { color: colors.textTertiary },
                                      ]}
                                    >
                                      NICE recommendations{" "}
                                      {source.recommendationRefs.join(", ")}
                                    </Text>
                                  </View>
                                  <Ionicons
                                    accessibilityElementsHidden
                                    color={colors.textTertiary}
                                    name="open-outline"
                                    size={17}
                                  />
                                </Pressable>
                              ))}
                            </View>
                          ) : null}
                          <TarvisEvidenceSummary
                            presentation={exchange.presentation}
                          />
                          {exchange.answer.evidenceIds.length ? (
                            <View style={styles.evidenceList}>
                              <Text
                                style={[
                                  styles.evidenceHeading,
                                  { color: colors.text },
                                ]}
                              >
                                What Tarv1s used
                              </Text>
                              {exchange.answer.evidenceIds.map((id) => {
                                const reference =
                                  exchange.evidence.references.get(id);
                                if (!reference) return null;
                                return (
                                  <Pressable
                                    key={id}
                                    accessibilityRole="button"
                                    onPress={() => onInspectEvidence(reference)}
                                    style={({ pressed }) => [
                                      styles.evidenceButton,
                                      {
                                        backgroundColor: colors.surfaceMuted,
                                        borderRadius: radius.md,
                                        opacity: pressed ? 0.68 : 1,
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      accessibilityElementsHidden
                                      color={colors.primary}
                                      name="document-text-outline"
                                      size={18}
                                    />
                                    <View style={styles.evidenceCopy}>
                                      <Text
                                        style={[
                                          styles.evidenceLabel,
                                          { color: colors.text },
                                        ]}
                                      >
                                        {reference.label}
                                      </Text>
                                      <Text
                                        style={[
                                          styles.evidenceCount,
                                          { color: colors.textTertiary },
                                        ]}
                                      >
                                        {formatEvidenceCount(reference.recordIds.length)}{" "}
                                        {reference.recordIds.length === 1
                                          ? "record"
                                          : "records"}
                                      </Text>
                                    </View>
                                    <Ionicons
                                      accessibilityElementsHidden
                                      color={colors.textTertiary}
                                      name="chevron-forward"
                                      size={17}
                                    />
                                  </Pressable>
                                );
                              })}
                            </View>
                          ) : null}
                          {exchange.answer.limitations.length ? (
                            <View
                              style={[
                                styles.limitations,
                                { borderColor: colors.divider },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.limitationsTitle,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                Worth keeping in mind
                              </Text>
                              {exchange.answer.limitations.map((limitation) => (
                                <Text
                                  key={limitation}
                                  style={[
                                    styles.limitationText,
                                    { color: colors.textTertiary },
                                  ]}
                                >
                                  • {limitation}
                                </Text>
                              ))}
                            </View>
                          ) : null}
                          </>
                        )}
                        <TarvisRouteMarker
                          hostedAnswer={exchange.answerSource === "hosted"}
                          latest={exchangeIndex === exchanges.length - 1}
                        />
                      </View>
                    </View>
                  </View>
                ))
              : null}
          </>
        )}
      </AppScreen>
      <TarvisConfirmationDialog
        confirmation={confirmation}
        onCancel={() => {
          if (!working && !settingsWorking) {
            setConfirmation(undefined);
            setThreadPendingDelete(undefined);
          }
        }}
        onConfirm={() => {
          if (confirmation === "new-conversation") {
            startNewConversation();
          } else if (confirmation === "remove-key") {
            disconnectBroaderAnswers();
          } else if (confirmation === "delete-conversation") {
            void deleteConversationThread();
          }
        }}
        working={working || settingsWorking}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  compactHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  compactHeaderButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  compactHeaderCopy: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  compactHeaderTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: -0.25,
  },
  compactHeaderSubtitle: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 1,
  },
  loadingCard: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  keyCard: { marginBottom: 14 },
  keyHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  keyIcon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  keyCopy: { flex: 1 },
  keyTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
  },
  keyDetail: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  keyInput: {
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 15,
    marginTop: 18,
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 52,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  guardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  guardList: { gap: 9, marginTop: 13 },
  guardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  guardText: { flex: 1, fontSize: 12, lineHeight: 18 },
  privacyNote: { fontSize: 11, lineHeight: 17, marginTop: 16 },
  removeButton: {
    minHeight: 48,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  removeText: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  introHero: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
  },
  introTitle: {
    maxWidth: 330,
    marginTop: 20,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: "900",
    letterSpacing: -0.65,
    textAlign: "center",
  },
  introDetail: {
    maxWidth: 370,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  recordsReady: {
    minHeight: 38,
    width: "100%",
    maxWidth: 330,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  recordsReadyText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  conversationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 13,
  },
  conversationAction: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  conversationActionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  suggestion: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 146,
    minHeight: 104,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  suggestionText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  historyIntro: { gap: 7, marginBottom: 18 },
  historyTitle: { fontSize: 24, lineHeight: 30, fontWeight: "900" },
  historyDetail: { fontSize: 14, lineHeight: 21 },
  historyGroup: { gap: 8, marginBottom: 18 },
  historyGroupTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  historyList: { gap: 8 },
  historyRow: {
    minHeight: 82,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  historyIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  historyRowCopy: { flex: 1, gap: 3 },
  historyRowTitle: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
  historyRowMeta: { fontSize: 11, lineHeight: 16 },
  historyMenuButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  historyEmptyTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  historySettings: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 4,
  },
  historySettingsText: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  recentSection: {
    marginTop: 14,
    marginBottom: 14,
  },
  recentHeadingRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  recentHeading: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  recentList: { gap: 8 },
  recentActionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  recentConversation: {
    minHeight: 70,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  recentConversationCopy: { flex: 1 },
  recentConversationTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  recentConversationMeta: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  exchange: { gap: 9, marginBottom: 16 },
  userBubble: {
    maxWidth: "88%",
    alignSelf: "flex-end",
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderBottomRightRadius: 5,
  },
  userText: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  assistantMessage: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 2,
    paddingTop: 4,
  },
  assistantAvatar: {
    width: 34,
    height: 34,
    flexShrink: 0,
  },
  assistantContent: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  directEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  directEyebrowCopy: { flex: 1 },
  directEyebrow: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.55,
    textTransform: "uppercase",
  },
  directConfidence: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 1,
  },
  directHeadline: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "900",
    letterSpacing: -0.35,
    marginTop: 14,
  },
  directMetric: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 15,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  directMetricLabel: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 0.25,
    textTransform: "uppercase",
  },
  directMetricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  directMetricValue: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  directMetricUnit: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "800",
  },
  directSummary: {
    fontSize: 14,
    lineHeight: 22,
    marginTop: 14,
  },
  directInlineAction: {
    alignSelf: "flex-start",
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingRight: 8,
  },
  directInlineActionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  directFindings: { gap: 12, marginTop: 16 },
  directFinding: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  directFindingMarker: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
  },
  directFindingCopy: { flex: 1 },
  directFindingTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  directFindingDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 1,
  },
  directInterpretation: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 16,
    padding: 12,
  },
  directInterpretationCopy: { flex: 1 },
  directInterpretationLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  directInterpretationText: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 3,
  },
  directSafety: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 13,
    padding: 11,
  },
  directSafetyText: { flex: 1, fontSize: 11, lineHeight: 17 },
  directDetails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingTop: 4,
  },
  directDetailsButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  directDetailsButtonCopy: { flex: 1 },
  directDetailsTitle: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  directDetailsCount: { fontSize: 10, lineHeight: 15, marginTop: 1 },
  directDetailsBody: { gap: 12, paddingBottom: 4 },
  directEvidenceItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  directEvidenceCopy: { flex: 1 },
  directEvidenceLabel: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  directEvidenceDetail: { fontSize: 11, lineHeight: 17, marginTop: 1 },
  directCaveats: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingTop: 11,
  },
  directCaveatsTitle: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "800",
    marginBottom: 1,
  },
  directCaveat: { fontSize: 10, lineHeight: 16 },
  directFollowUps: { gap: 7, marginTop: 17 },
  directFollowUpsTitle: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  directFollowUp: {
    minHeight: 45,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  directFollowUpText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  answerHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  answerHeadingCopy: { flex: 1 },
  answerTitle: { fontSize: 17, lineHeight: 23, fontWeight: "800" },
  confidence: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 3,
  },
  interpretation: {
    alignItems: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  interpretationText: { flex: 1, fontSize: 11, lineHeight: 17 },
  interpretationLabel: { fontWeight: "800" },
  answerText: { fontSize: 14, lineHeight: 22, marginTop: 13 },
  evidenceSummary: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 14,
  },
  evidenceSummaryHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  evidenceSummaryTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  evidenceWindow: { marginTop: 11 },
  evidenceWindowHeading: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  evidenceWindowLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  evidenceWindowRange: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
  },
  evidenceMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 9,
  },
  evidenceMetric: {
    flexGrow: 1,
    flexBasis: 82,
  },
  evidenceMetricValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
  },
  evidenceMetricUnavailable: {
    fontSize: 12,
    lineHeight: 26,
    fontWeight: "800",
  },
  evidenceMetricUnit: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  evidenceMetricLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    marginTop: 1,
  },
  evidenceCoverage: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
  },
  evidenceCoverageNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  evidenceCoverageNoticeText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
  },
  evidenceSummaryNote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 11,
  },
  evidenceList: { gap: 8, marginTop: 16 },
  evidenceHeading: { fontSize: 12, lineHeight: 17, fontWeight: "800" },
  evidenceButton: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  evidenceCopy: { flex: 1 },
  evidenceLabel: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  evidenceCount: { fontSize: 10, lineHeight: 15, marginTop: 1 },
  limitations: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
    marginTop: 15,
    paddingTop: 12,
  },
  limitationsTitle: {
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "800",
    marginBottom: 2,
  },
  limitationText: { fontSize: 11, lineHeight: 17 },
  routeMarker: { height: 0, width: 0 },
  errorCard: {
    minHeight: 58,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 18 },
  workingRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 10,
  },
  workingText: { fontSize: 12, lineHeight: 18 },
  composerDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 9,
    paddingBottom: 8,
  },
  composer: {
    minHeight: 62,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  questionInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  sendButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  boundary: {
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 9,
    paddingHorizontal: 10,
  },
  confirmationFrame: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(5, 10, 18, 0.66)",
  },
  confirmationBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  confirmationCard: {
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 16,
  },
  confirmationIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmationTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "900",
    letterSpacing: -0.3,
    marginTop: 16,
  },
  confirmationDetail: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
  },
  confirmationActions: {
    gap: 9,
    marginTop: 20,
  },
  confirmationButton: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmationButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
  },
});
