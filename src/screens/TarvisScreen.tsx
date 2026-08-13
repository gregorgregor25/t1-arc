import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppScreen } from '@/components/AppScreen';
import { SectionCard } from '@/components/SectionCard';
import { buildTarvisEvidencePacket } from '@/data/tarvis/evidencePacket';
import { compactTarvisEvidence } from '@/data/tarvis/evidenceCompaction';
import {
  buildTarvisEvidencePresentation,
  TarvisEvidencePresentation,
} from '@/data/tarvis/evidencePresentation';
import { askTarvis } from '@/data/tarvis/openAiClient';
import {
  buildLocalGlucoseAnswer,
  localGlucoseClockBoundaryCapability,
  rangeForLocalGlucoseIntent,
} from '@/data/tarvis/localGlucoseAnswer';
import {
  buildLocalGlucoseRangeAnswer,
  rangeForLocalGlucoseRangeIntent,
} from '@/data/tarvis/localGlucoseRangeAnswer';
import {
  buildLocalPersonalDataAnswer,
  rangesForLocalPersonalDataIntent,
} from '@/data/tarvis/localPersonalDataAnswer';
import { coordinateTarvisRequest } from '@/data/tarvis/requestCoordinator';
import {
  clearTarvisConversation,
  loadTarvisConversation,
  MAX_STORED_TARVIS_EXCHANGES,
  saveTarvisConversation,
  StoredTarvisExchange,
  TarvisConversationStorageLimitError,
} from '@/data/tarvis/conversationStore';
import { formatTarvisConversation } from '@/data/tarvis/conversationExport';
import type { GlucoseAnswerBundleV2 } from '@/data/tarvis/glucoseAnswerBundleV2';
import {
  describeTarvisIntent,
  PendingTarvisClarification,
  resolveTarvisIntent,
  TarvisIntentHistoryEntry,
  TarvisIntentV1,
} from '@/data/tarvis/intent';
import {
  clearTarvisApiKey,
  loadTarvisSettings,
  saveTarvisApiKey,
} from '@/data/tarvis/secureStore';
import {
  TarvisAnswer,
  TarvisConversationTurn,
  TarvisEvidenceLookup,
  TarvisRequestMetrics,
  TarvisUsage,
} from '@/data/tarvis/types';
import { EvidenceReference, InsightReport } from '@/domain/insights';
import { GlucoseReading, TimelineData, TimeRange } from '@/domain/models';
import { formatDate, toDateKey } from '@/domain/time';
import { useAndroidBack } from '@/hooks/useAndroidBack';
import { useAppTheme } from '@/theme/theme';

const SUGGESTIONS = [
  'What was my average glucose over the last three days between midnight and 7 a.m.?',
  'How many low-glucose events have I had in the last 30 days?',
  'What patterns are worth reviewing?',
];

interface ChatExchange {
  id: string;
  question: string;
  answer: TarvisAnswer;
  evidence: TarvisEvidenceLookup;
  clarificationQuestion?: string;
  intent?: TarvisIntentV1;
  presentation?: TarvisEvidencePresentation;
  requestMetrics?: TarvisRequestMetrics;
  answerBundle?: GlucoseAnswerBundleV2;
}

interface Props {
  asOf: number;
  liveData: boolean;
  report: InsightReport;
  loadGlucoseReadings?(range: TimeRange): Promise<GlucoseReading[]>;
  loadTimelineData?(range: TimeRange): Promise<TimelineData>;
  loadReportForRange?(
    current: TimeRange,
    previous: TimeRange,
    generatedAt: number,
  ): Promise<InsightReport>;
  onBack(): void;
  onInspectEvidence(evidence: EvidenceReference): void;
}

function confidenceLabel(confidence: TarvisAnswer['confidence']) {
  switch (confidence) {
    case 'high':
      return 'Answer confidence: High';
    case 'moderate':
      return 'Answer confidence: Moderate';
    default:
      return 'Answer confidence: Limited';
  }
}

function evidenceRangeLabel(range: { start: number; end: number }) {
  return `${formatDate(toDateKey(range.start), {
    day: 'numeric',
    month: 'short',
  })} - ${formatDate(toDateKey(range.end - 1), {
    day: 'numeric',
    month: 'short',
  })}`;
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
            `${window.label}, ${evidenceRangeLabel(window.range)}, ${window.recordCount} ${window.recordLabel ?? 'glucose readings'}${window.coveragePercent === undefined ? '' : `, ${window.coveragePercent}% coverage`}. ${
              window.coverageStatus === 'unavailable'
                ? 'Glucose metrics are unavailable.'
                : window.coverageStatus === 'limited'
                  ? 'Values describe observed sensor time only, not the complete period.'
                  : ''
            } ${window.metrics
              .map((metric) => {
                const value =
                  metric.value === null
                    ? 'not available'
                    : metric.value.toFixed(metric.decimals);
                return `${metric.label} ${value}${metric.unit ? ` ${metric.unit}` : ''}`;
              })
              .join(', ')}`,
        )
        .join('. ')}`}
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
                    ? 'Unavailable'
                    : metric.value.toFixed(metric.decimals)}
                  {metric.value !== null && metric.unit ? (
                    <Text
                      style={[
                        styles.evidenceMetricUnit,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {' '}
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
                {window.recordCount.toLocaleString()} {window.recordLabel}
                {window.coveragePercent === undefined
                  ? null
                  : ` | ${window.coveragePercent}% coverage`}
              </>
            ) : null}
            {!window.recordLabel ? (
              <>
                {window.recordCount.toLocaleString()} glucose readings |{' '}
                {window.coveragePercent}% coverage
              </>
            ) : null}
          </Text>
          {window.coverageStatus !== 'sufficient' &&
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
                {window.coverageStatus === 'unavailable'
                  ? 'No glucose readings — these metrics are unavailable.'
                  : 'Limited coverage — values describe observed sensor time only, not the complete period.'}
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

function TarvisRouteMarker({
  latest,
  usedOpenAi,
}: {
  latest: boolean;
  usedOpenAi: boolean;
}) {
  if (!latest) return null;
  return (
    <View
      accessible
      accessibilityLabel="Latest TARV1S response"
      collapsable={false}
      importantForAccessibility="yes"
      nativeID={
        usedOpenAi ? 'tarvis-response-assisted' : 'tarvis-response-local'
      }
      style={styles.routeMarker}
      testID={
        usedOpenAi ? 'tarvis-response-assisted' : 'tarvis-response-local'
      }
    />
  );
}

export function TarvisScreen({
  asOf,
  liveData,
  report,
  loadGlucoseReadings,
  loadTimelineData,
  loadReportForRange,
  onBack,
  onInspectEvidence,
}: Props) {
  const { colors, radius } = useAppTheme();
  const evidence = useMemo(() => buildTarvisEvidencePacket(report), [report]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [usage, setUsage] = useState<TarvisUsage>();
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [pendingClarification, setPendingClarification] =
    useState<PendingTarvisClarification>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const scrollViewRef = useRef<ScrollView>(null);
  const pendingScrollExchangeId = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void loadTarvisSettings()
      .then((settings) => {
        if (!active) return;
        setHasApiKey(settings.hasApiKey);
        setSettingsLoadFailed(false);
        setUsage(settings.usage);
      })
      .catch(() => {
        if (!active) return;
        setSettingsLoadFailed(true);
        setError(
          'Tarv1s could not open its saved connection. Close and reopen Tarv1s to try again. Questions answered on this phone still work.',
        );
      })
      .finally(() => {
        if (active) setLoadingSettings(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadTarvisConversation()
      .then((stored) => {
        if (!active) return;
        const restored = stored.map((exchange) => ({
          id: exchange.id,
          question: exchange.question,
          answer: exchange.answer,
          clarificationQuestion: exchange.clarificationQuestion,
          intent: exchange.intent,
          presentation: exchange.presentation,
          requestMetrics: exchange.requestMetrics,
          answerBundle: exchange.answerBundle,
          evidence: {
            packet: evidence.packet,
            references: new Map(
              exchange.evidence.map((reference) => [reference.id, reference]),
            ),
          },
        }));
        setExchanges(restored);
        const clarificationQuestion = stored.at(-1)?.clarificationQuestion;
        if (clarificationQuestion) {
          const resolution = resolveTarvisIntent(clarificationQuestion, {
            now: liveData ? Date.now() : asOf,
            timezone: 'Europe/London',
          });
          if (resolution.outcome.status === 'needs_clarification') {
            setPendingClarification({
              question: clarificationQuestion,
              resolution,
            });
          }
        }
        setConversationLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setError(
          'The saved Tarv1s conversation could not be loaded. Sending is disabled to protect the existing conversation; close and reopen Tarv1s to retry.',
        );
      });
    return () => {
      active = false;
    };
  }, []);

  function storedExchanges(items: ChatExchange[]): StoredTarvisExchange[] {
    return items.map((exchange) => ({
      id: exchange.id,
      question: exchange.question,
      answer: exchange.answer,
      clarificationQuestion: exchange.clarificationQuestion,
      intent: exchange.intent,
      presentation: exchange.presentation,
      requestMetrics: exchange.requestMetrics,
      answerBundle: exchange.answerBundle,
      evidence: exchange.answer.evidenceIds.flatMap((id) => {
        const reference = exchange.evidence.references.get(id);
        return reference ? [reference] : [];
      }),
    }));
  }

  function appendExchange({
    answer,
    clarificationQuestion,
    evidenceLookup,
    intent,
    presentation,
    prompt,
    requestMetrics,
    answerBundle,
  }: {
    answer: TarvisAnswer;
    clarificationQuestion?: string;
    evidenceLookup: TarvisEvidenceLookup;
    intent?: TarvisIntentV1;
    presentation?: TarvisEvidencePresentation;
    prompt: string;
    requestMetrics?: TarvisRequestMetrics;
    answerBundle?: GlucoseAnswerBundleV2;
  }) {
    const exchangeId = `${Date.now()}:${exchanges.length}`;
    pendingScrollExchangeId.current = exchangeId;
    setExchanges((current) => {
      const next = [
        ...current,
        {
          id: exchangeId,
          question: prompt,
          answer,
          clarificationQuestion,
          evidence: evidenceLookup,
          intent,
          presentation,
          requestMetrics,
          answerBundle,
        },
      ].slice(-MAX_STORED_TARVIS_EXCHANGES);
      if (conversationLoaded) {
        void saveTarvisConversation(storedExchanges(next)).catch((reason) => {
          setError(
            reason instanceof TarvisConversationStorageLimitError
              ? `The answer was shown, but it was not saved. ${reason.message}`
              : 'The answer was shown, but this conversation could not be saved.',
          );
        });
      }
      return next;
    });
  }

  async function exportConversation() {
    if (!exchanges.length) return;
    try {
      await Share.share({
        title: 'Ask Tarv1s conversation',
        message: formatTarvisConversation(storedExchanges(exchanges)),
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The conversation could not be exported.',
      );
    }
  }

  function confirmNewConversation() {
    if (!exchanges.length) return;
    Alert.alert(
      'Start a new conversation?',
      'The saved Tarv1s conversation on this phone will be cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start new',
          style: 'destructive',
          onPress: () => {
            setWorking(true);
            void clearTarvisConversation()
              .then(() => {
                setExchanges([]);
                setPendingClarification(undefined);
                setError(undefined);
              })
              .catch(() => {
                setError(
                  'The saved conversation could not be cleared. It has been left intact so no history is lost.',
                );
              })
              .finally(() => setWorking(false));
          },
        },
      ],
    );
  }

  const handleBack = useCallback(() => {
    if (settingsVisible) {
      setSettingsVisible(false);
      setApiKey('');
      setError(undefined);
      return;
    }
    onBack();
  }, [onBack, settingsVisible]);
  useAndroidBack(true, handleBack);

  async function saveKey() {
    setError(undefined);
    try {
      await saveTarvisApiKey(apiKey);
      setApiKey('');
      setHasApiKey(true);
      setSettingsVisible(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'The key could not be stored.',
      );
    }
  }

  function removeKey() {
    Alert.alert(
      'Disconnect broader answers?',
      'Tarv1s can still answer supported questions using data on this phone. Broader questions will be unavailable until you reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void clearTarvisApiKey().then(() => {
              setHasApiKey(false);
              setApiKey('');
              setError(undefined);
            });
          },
        },
      ],
    );
  }

  async function sendQuestion(value = question) {
    const prompt = value.trim();
    if (!prompt || working || !conversationLoaded) return;
    setQuestion('');
    setError(undefined);
    setWorking(true);
    const history: TarvisConversationTurn[] = exchanges.flatMap((exchange) => [
      { role: 'user' as const, text: exchange.question },
      {
        role: 'assistant' as const,
        text: `${exchange.answer.headline}\n${exchange.answer.answer}`,
      },
    ]);
    const previousExchange = exchanges.at(-1);
    const intentHistory: TarvisIntentHistoryEntry[] = previousExchange?.intent
      ? [
          {
            turnId: previousExchange.id,
            question: previousExchange.question,
            intent: previousExchange.intent,
          },
        ]
      : [];
    try {
      const questionAsOf = liveData ? Date.now() : asOf;
      const plan = coordinateTarvisRequest({
        question: prompt,
        asOf: questionAsOf,
        conversationHistory: history,
        intentHistory,
        pendingClarification,
      });
      if (plan.kind === 'answer') {
        setPendingClarification(plan.pendingClarification);
        appendExchange({
          answer: plan.answer,
          clarificationQuestion: plan.pendingClarification?.question,
          evidenceLookup: {
            packet: evidence.packet,
            references: new Map(),
          },
          prompt,
        });
        return;
      }
      if (plan.kind === 'scoped-glucose') {
        setPendingClarification(undefined);
        if (!loadGlucoseReadings) {
          throw new Error('Your local glucose data is not ready yet.');
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
        appendExchange({
          answer: local.answer,
          evidenceLookup: {
            packet: evidence.packet,
            references: new Map(
              localEvidence.map((reference) => [reference.id, reference]),
            ),
          },
          intent: plan.intent,
          presentation: local.presentation,
          answerBundle: local.answerBundle,
          prompt,
        });
        return;
      }
      if (plan.kind === 'scoped-personal-data') {
        setPendingClarification(undefined);
        if (!loadTimelineData) {
          throw new Error('Your local health data is not ready yet.');
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
        appendExchange({
          answer: local.answer,
          evidenceLookup: {
            packet: evidence.packet,
            references: new Map(
              localEvidence.map((reference) => [reference.id, reference]),
            ),
          },
          intent: plan.intent,
          presentation: local.presentation,
          prompt,
        });
        return;
      }

      setPendingClarification(undefined);
      if (settingsLoadFailed) {
        appendExchange({
          answer: {
            headline: 'I could not open the saved connection',
            answer:
              'Your secure settings did not load. Close and reopen Tarv1s to retry. Supported calculations still work on this phone.',
            confidence: 'limited',
            evidenceIds: [],
            limitations: [
              'Nothing left this phone.',
            ],
          },
          evidenceLookup: { packet: evidence.packet, references: new Map() },
          prompt,
        });
        return;
      }
      if (!hasApiKey) {
        appendExchange({
          answer: {
            headline: 'Connect broader answers for that question',
            answer:
              'Supported personal calculations still work on this phone. To ask broader questions, open Tarv1s settings and connect your OpenAI project.',
            confidence: 'limited',
            evidenceIds: [],
            limitations: [
              'Nothing left this phone.',
            ],
          },
          evidenceLookup: { packet: evidence.packet, references: new Map() },
          prompt,
        });
        return;
      }

      const reportForQuestion =
        plan.kind === 'model-evidence' &&
        plan.evidenceRanges &&
        loadReportForRange
          ? await loadReportForRange(
              plan.evidenceRanges.current,
              plan.evidenceRanges.previous,
              questionAsOf,
            )
          : undefined;
      const evidenceForQuestion =
        plan.kind === 'model-education'
          ? undefined
          : reportForQuestion
            ? buildTarvisEvidencePacket(reportForQuestion)
            : evidence;
      const response = await askTarvis(
        prompt,
        evidenceForQuestion?.packet,
        plan.history,
      );
      setUsage(response.usage);
      appendExchange({
        answer: response.answer,
        evidenceLookup: evidenceForQuestion ?? {
          packet: evidence.packet,
          references: new Map(),
        },
        intent: plan.intent,
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
      });
    } catch (reason) {
      const clockBoundaryCapability =
        localGlucoseClockBoundaryCapability(reason);
      if (clockBoundaryCapability) {
        setPendingClarification(undefined);
        appendExchange({
          answer: clockBoundaryCapability,
          evidenceLookup: { packet: evidence.packet, references: new Map() },
          prompt,
        });
        return;
      }
      setQuestion(prompt);
      setError(
        reason instanceof Error
          ? reason.message
          : 'TARV1S could not answer this question.',
      );
    } finally {
      setWorking(false);
    }
  }

  const trailing = (
    <Pressable
      accessibilityLabel="TARV1S settings"
      accessibilityRole="button"
      onPress={() => {
        setSettingsVisible(true);
        setError(undefined);
      }}
      style={({ pressed }) => [
        styles.headerButton,
        {
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          borderColor: colors.border,
          borderRadius: radius.pill,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.textSecondary}
        name="settings-outline"
        size={20}
      />
    </Pressable>
  );

  const canSendQuestion = Boolean(
    conversationLoaded && question.trim() && !working,
  );
  const composerFooter =
    !loadingSettings && !settingsVisible ? (
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
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.workingText, { color: colors.textSecondary }]}>
              TARV1S is checking the evidence…
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
            accessibilityLabel="Question for TARV1S"
            editable={!working}
            multiline
            onChangeText={setQuestion}
            placeholder="Ask about your diabetes or health data"
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

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <AppScreen
        eyebrow="Your diabetes data companion"
        footer={composerFooter}
        scrollViewRef={scrollViewRef}
        title="Ask Tarv1s"
        trailing={trailing}
      >
        <Pressable
          accessibilityLabel="Back to insights"
          accessibilityRole="button"
          onPress={handleBack}
          style={({ pressed }) => [
            styles.backButton,
            { opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="chevron-back"
            size={18}
          />
          <Text style={[styles.backText, { color: colors.primary }]}>
            {settingsVisible ? 'Back to TARV1S' : 'Back to insights'}
          </Text>
        </Pressable>

        {loadingSettings ? (
          <SectionCard style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} />
          </SectionCard>
        ) : settingsVisible ? (
          <>
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
                    style={[styles.keyDetail, { color: colors.textSecondary }]}
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
                disabled={!apiKey.trim()}
                onPress={() => void saveKey()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: apiKey.trim()
                      ? colors.primary
                      : colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={apiKey.trim() ? colors.onPrimary : colors.textTertiary}
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

            <SectionCard>
              <Text style={[styles.guardTitle, { color: colors.text }]}>
                Your privacy
              </Text>
              <View style={styles.guardList}>
                {[
                  'Tarv1s only shares information after you tap Send.',
                  'Tarv1s answers supported personal totals directly.',
                  'Tarv1s only answers diabetes and personal health questions and never reveals saved sign-ins.',
                  'Tarv1s never sends questions while running in the background.',
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
                General diabetes questions do not share your health records.
                When you ask about your own patterns, Tarv1s shares only the
                information needed to answer that question. These conversations
                are not stored by OpenAI.
              </Text>
              {hasApiKey ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={removeKey}
                  style={({ pressed }) => [
                    styles.removeButton,
                    {
                      borderColor: `${colors.danger}66`,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
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
        ) : (
          <>
            <SectionCard
              style={[
                styles.introCard,
                { backgroundColor: colors.surfaceElevated },
              ]}
            >
              <View style={styles.introTop}>
                <View
                  style={[
                    styles.assistantIcon,
                    {
                      backgroundColor: `${colors.accent}18`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="sparkles"
                    size={25}
                  />
                </View>
                <View style={styles.introCopy}>
                  <Text style={[styles.introTitle, { color: colors.text }]}>
                    Ask Tarv1s
                  </Text>
                  <Text
                    style={[
                      styles.introDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Talk things through with Tarv1s in your own words. It uses
                    your records to give a clear answer, and you can always see
                    what it used.
                  </Text>
                </View>
              </View>
              {exchanges.length ? (
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
                      style={[
                        styles.conversationActionText,
                        { color: colors.primary },
                      ]}
                    >
                      Export conversation
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={confirmNewConversation}
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
                      color={colors.textSecondary}
                      name="add-circle-outline"
                      size={18}
                    />
                    <Text
                      style={[
                        styles.conversationActionText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      New conversation
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </SectionCard>

            {!exchanges.length ? (
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    accessibilityState={{
                      disabled: !conversationLoaded || working,
                    }}
                    accessibilityRole="button"
                    disabled={!conversationLoaded || working}
                    onPress={() => void sendQuestion(suggestion)}
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
                    <Text
                      style={[
                        styles.suggestionText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {suggestion}
                    </Text>
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name="arrow-forward"
                      size={17}
                    />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {exchanges.map((exchange, exchangeIndex) => (
              <View
                key={exchange.id}
                onLayout={(event) => {
                  if (pendingScrollExchangeId.current !== exchange.id) return;
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
                  <Text style={[styles.userText, { color: colors.onPrimary }]}>
                    {exchange.question}
                  </Text>
                </View>
                <SectionCard style={styles.answerCard}>
                  <View style={styles.answerHeading}>
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.accent}
                      name="sparkles-outline"
                      size={20}
                    />
                    <View style={styles.answerHeadingCopy}>
                      <Text
                        style={[styles.answerTitle, { color: colors.text }]}
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
                      accessibilityLabel={`Answering for ${describeTarvisIntent(exchange.intent, { timezone: 'UK time' })}`}
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
                          Answering for{' '}
                        </Text>
                        {describeTarvisIntent(exchange.intent, {
                          timezone: 'UK time',
                        })}
                      </Text>
                    </View>
                  ) : null}
                  <Text
                    style={[styles.answerText, { color: colors.textSecondary }]}
                  >
                    {exchange.answer.answer}
                  </Text>
                  <TarvisEvidenceSummary presentation={exchange.presentation} />
                  {exchange.answer.evidenceIds.length ? (
                    <View style={styles.evidenceList}>
                      <Text
                        style={[styles.evidenceHeading, { color: colors.text }]}
                      >
                        What Tarv1s used
                      </Text>
                      {exchange.answer.evidenceIds.map((id) => {
                        const reference = exchange.evidence.references.get(id);
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
                                {reference.recordIds.length}{' '}
                                {reference.recordIds.length === 1
                                  ? 'record'
                                  : 'records'}
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
                  <TarvisRouteMarker
                    latest={exchangeIndex === exchanges.length - 1}
                    usedOpenAi={Boolean(exchange.requestMetrics)}
                  />
                </SectionCard>
              </View>
            ))}
          </>
        )}
      </AppScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerButton: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 38,
    marginBottom: 10,
  },
  backText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  loadingCard: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCard: { marginBottom: 14 },
  keyHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  keyIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCopy: { flex: 1 },
  keyTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  guardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  guardList: { gap: 9, marginTop: 13 },
  guardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  guardText: { flex: 1, fontSize: 12, lineHeight: 18 },
  privacyNote: { fontSize: 11, lineHeight: 17, marginTop: 16 },
  removeButton: {
    minHeight: 48,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  removeText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  introCard: { marginBottom: 14 },
  introTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  assistantIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introCopy: { flex: 1 },
  introTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800' },
  introDetail: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  conversationActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 13,
  },
  conversationAction: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  conversationActionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  suggestions: { gap: 9, marginBottom: 14 },
  suggestion: {
    minHeight: 51,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  suggestionText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  exchange: { gap: 9, marginBottom: 16 },
  userBubble: {
    maxWidth: '88%',
    alignSelf: 'flex-end',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderBottomRightRadius: 5,
  },
  userText: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
  answerCard: { padding: 17 },
  answerHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  answerHeadingCopy: { flex: 1 },
  answerTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  confidence: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 3,
  },
  interpretation: {
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  interpretationText: { flex: 1, fontSize: 11, lineHeight: 17 },
  interpretationLabel: { fontWeight: '800' },
  answerText: { fontSize: 14, lineHeight: 22, marginTop: 13 },
  evidenceSummary: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 14,
  },
  evidenceSummaryHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  evidenceSummaryTitle: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  evidenceWindow: { marginTop: 11 },
  evidenceWindowHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  evidenceWindowLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  evidenceWindowRange: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
  },
  evidenceMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    fontWeight: '800',
  },
  evidenceMetricUnavailable: {
    fontSize: 12,
    lineHeight: 26,
    fontWeight: '800',
  },
  evidenceMetricUnit: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  evidenceMetricLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    marginTop: 1,
  },
  evidenceCoverage: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
  },
  evidenceCoverageNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  evidenceCoverageNoticeText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
  },
  evidenceSummaryNote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 11,
  },
  evidenceList: { gap: 8, marginTop: 16 },
  evidenceHeading: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  evidenceButton: {
    minHeight: 54,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  evidenceCopy: { flex: 1 },
  evidenceLabel: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
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
    fontWeight: '800',
    marginBottom: 2,
  },
  limitationText: { fontSize: 11, lineHeight: 17 },
  routeMarker: { height: 0, width: 0 },
  errorCard: {
    minHeight: 58,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 18 },
  workingRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    alignItems: 'flex-end',
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boundary: {
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 9,
    paddingHorizontal: 10,
  },
});
