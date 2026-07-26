import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScreen, SectionHeading } from '@/components/AppScreen';
import { DataModeBadge } from '@/components/DataModeBadge';
import { ErrorCard } from '@/components/ErrorCard';
import { EvidenceRecordInspector } from '@/components/EvidenceRecordInspector';
import { LoadingCard } from '@/components/LoadingCard';
import { SafetyNote } from '@/components/SafetyNote';
import { SectionCard } from '@/components/SectionCard';
import {
  answerInsightQuestion,
  EvidenceReference,
  InsightAnswer,
  InsightCategory,
  InsightFinding,
  InsightKind,
} from '@/domain/insights';
import { formatDate, formatTime, toDateKey } from '@/domain/time';
import { useInsights } from '@/hooks/useInsights';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

const SUGGESTED_QUESTIONS = [
  'Why was glucose worse?',
  'When were highs different?',
  'What changed with food?',
  'Did sleep change?',
];

const CATEGORY_ICON: Record<
  InsightCategory,
  keyof typeof Ionicons.glyphMap
> = {
  glucose: 'pulse-outline',
  insulin: 'water-outline',
  food: 'restaurant-outline',
  sleep: 'moon-outline',
  activity: 'walk-outline',
  'data-quality': 'shield-checkmark-outline',
};

function kindLabel(kind: InsightKind) {
  switch (kind) {
    case 'observation':
      return 'OBSERVED CHANGE';
    case 'context-clue':
      return 'CONTEXT TO INSPECT';
    case 'limitation':
      return 'DATA LIMITATION';
  }
}

function EvidenceBlock({
  evidence,
  onInspectRecords,
}: {
  evidence: EvidenceReference;
  onInspectRecords(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.evidenceBlock, { borderColor: colors.divider }]}>
      <View style={styles.evidenceHeader}>
        <Text style={[styles.evidenceLabel, { color: colors.text }]}>
          {evidence.label}
        </Text>
        <Text style={[styles.evidenceCount, { color: colors.textTertiary }]}>
          {evidence.recordIds.length} records in calculation
        </Text>
      </View>
      <Text style={[styles.evidenceDescription, { color: colors.textSecondary }]}>
        {evidence.description} ·{' '}
        {formatDate(toDateKey(evidence.range.start), {
          day: 'numeric',
          month: 'short',
        })}
        {' – '}
        {formatDate(toDateKey(evidence.range.end - 1), {
          day: 'numeric',
          month: 'short',
        })}
      </Text>
      {evidence.examples.map((record) => (
        <View key={record.id} style={styles.exampleRow}>
          <Text style={[styles.exampleTime, { color: colors.textTertiary }]}>
            {formatTime(record.timestamp)}
          </Text>
          <View style={styles.exampleCopy}>
            <Text style={[styles.examplePrimary, { color: colors.text }]}>
              {record.primary}
            </Text>
            <Text
              style={[styles.exampleSecondary, { color: colors.textSecondary }]}
            >
              {record.secondary} · {record.sourceId}
            </Text>
            <Text
              numberOfLines={1}
              selectable
              style={[styles.exampleId, { color: colors.textTertiary }]}
            >
              ID {record.id}
            </Text>
          </View>
        </View>
      ))}
      <Pressable
        accessibilityLabel={`Open all ${evidence.recordIds.length} exact records for ${evidence.label}`}
        accessibilityRole="button"
        onPress={onInspectRecords}
        style={({ pressed }) => [
          styles.openRecordsButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.divider,
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="list-outline"
          size={17}
        />
        <Text style={[styles.openRecordsText, { color: colors.primary }]}>
          Open all {evidence.recordIds.length} exact records
        </Text>
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="chevron-forward"
          size={16}
        />
      </Pressable>
    </View>
  );
}

function FindingCard({
  finding,
  expanded,
  onToggle,
  onInspectRecords,
  highlighted,
}: {
  finding: InsightFinding;
  expanded: boolean;
  onToggle(): void;
  onInspectRecords(evidence: EvidenceReference): void;
  highlighted: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const tone =
    finding.kind === 'limitation'
      ? colors.warning
      : finding.kind === 'context-clue'
        ? colors.insulin
        : colors.glucose;
  return (
    <SectionCard
      style={[
        styles.findingCard,
        highlighted && {
          borderColor: `${tone}99`,
          backgroundColor: colors.surfaceMuted,
        },
      ]}
    >
      <View style={styles.findingTop}>
        <View style={[styles.findingIcon, { backgroundColor: `${tone}16` }]}>
          <Ionicons
            accessibilityElementsHidden
            color={tone}
            name={CATEGORY_ICON[finding.category]}
            size={21}
          />
        </View>
        <View style={styles.findingCopy}>
          <Text style={[styles.findingKind, { color: tone }]}>
            {kindLabel(finding.kind)}
          </Text>
          <Text style={[styles.findingTitle, { color: colors.text }]}>
            {finding.title}
          </Text>
        </View>
      </View>
      <Text style={[styles.findingSummary, { color: colors.textSecondary }]}>
        {finding.summary}
      </Text>
      {finding.caveat ? (
        <Text style={[styles.caveat, { color: colors.textTertiary }]}>
          {finding.caveat}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.evidenceButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name={expanded ? 'chevron-up' : 'document-text-outline'}
          size={18}
        />
        <Text style={[styles.evidenceButtonText, { color: colors.primary }]}>
          {expanded
            ? 'Hide supporting records'
            : `Inspect evidence (${finding.evidence.reduce(
                (sum, item) => sum + item.recordIds.length,
                0,
              )})`}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.evidenceStack}>
          {finding.evidence.map((evidence) => (
            <EvidenceBlock
              key={evidence.id}
              evidence={evidence}
              onInspectRecords={() => onInspectRecords(evidence)}
            />
          ))}
        </View>
      ) : null}
    </SectionCard>
  );
}

export function InsightsScreen() {
  const { colors, radius } = useAppTheme();
  const {
    dataMode,
    refreshData,
    setDataMode,
    syncing,
  } = useDataContext();
  const insightState = useInsights();
  const scrollViewRef = useRef<ScrollView>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<InsightAnswer>();
  const [answerOffset, setAnswerOffset] = useState<number>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedEvidence, setSelectedEvidence] =
    useState<EvidenceReference>();

  const findings = useMemo(() => {
    const report = insightState.report;
    if (!report || !answer?.findingIds.length) return report?.findings ?? [];
    return [...report.findings].sort((a, b) => {
      const aRelevant = answer.findingIds.includes(a.id) ? 1 : 0;
      const bRelevant = answer.findingIds.includes(b.id) ? 1 : 0;
      return bRelevant - aRelevant;
    });
  }, [answer, insightState.report]);

  useEffect(() => {
    if (!answer || answerOffset === undefined) return;
    const timeout = setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, answerOffset - 24),
        animated: true,
      });
    }, 120);
    return () => clearTimeout(timeout);
  }, [answer, answerOffset]);

  function ask(value = question) {
    if (!insightState.report || !value.trim()) return;
    setQuestion(value);
    const nextAnswer = answerInsightQuestion(value, insightState.report);
    setAnswer(nextAnswer);
    setExpanded((current) => {
      const next = new Set(current);
      nextAnswer.findingIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleFinding(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <AppScreen
      title="Insights"
      eyebrow="Evidence, not guesses"
      trailing={<DataModeBadge mode={dataMode} />}
      refreshing={syncing}
      onRefresh={() => void refreshData()}
      scrollViewRef={scrollViewRef}
    >
      {dataMode === 'demo' ? (
        <View
          style={[
            styles.demoNotice,
            {
              backgroundColor: `${colors.primary}12`,
              borderColor: `${colors.primary}55`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="flask-outline"
            size={20}
          />
          <Text style={[styles.demoText, { color: colors.textSecondary }]}>
            This demonstrates the explanation method using synthetic glucose,
            insulin and health context.
          </Text>
        </View>
      ) : null}

      {insightState.error ? (
        <ErrorCard message={insightState.error} />
      ) : insightState.loading || !insightState.report ? (
        <LoadingCard label="Comparing evidence across two weeks…" />
      ) : (
        <>
          <SectionCard
            style={[
              styles.hero,
              { backgroundColor: colors.surfaceElevated },
            ]}
          >
            <Text style={[styles.heroEyebrow, { color: colors.accent }]}>
              LAST 7 COMPLETE DAYS VS PREVIOUS 7
            </Text>
            <Text style={[styles.heroTitle, { color: colors.text }]}>
              {insightState.report.headline}
            </Text>
            <Text style={[styles.heroSummary, { color: colors.textSecondary }]}>
              {insightState.report.summary}
            </Text>
            <View style={[styles.metricRow, { borderColor: colors.divider }]}>
              <View style={styles.metric}>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  Time in range
                </Text>
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {insightState.report.current.timeInRangePercent}%
                </Text>
                <Text style={[styles.metricDelta, { color: colors.textTertiary }]}>
                  was {insightState.report.previous.timeInRangePercent}%
                </Text>
              </View>
              <View style={styles.metric}>
                <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>
                  Coverage
                </Text>
                <Text style={[styles.metricValue, { color: colors.text }]}>
                  {insightState.report.current.coveragePercent}%
                </Text>
                <Text style={[styles.metricDelta, { color: colors.textTertiary }]}>
                  {insightState.report.current.glucoseReadings} readings
                </Text>
              </View>
            </View>
            <View style={styles.signalRow}>
              <View
                style={[
                  styles.signal,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Text
                  style={[styles.signalLabel, { color: colors.textSecondary }]}
                >
                  Average
                </Text>
                <Text style={[styles.signalValue, { color: colors.text }]}>
                  {insightState.report.current.glucoseAverage?.toFixed(1) ??
                    '—'}
                </Text>
                <Text
                  style={[styles.signalUnit, { color: colors.textTertiary }]}
                >
                  mmol/L
                </Text>
              </View>
              <View
                style={[
                  styles.signal,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Text
                  style={[styles.signalLabel, { color: colors.textSecondary }]}
                >
                  Variability
                </Text>
                <Text style={[styles.signalValue, { color: colors.text }]}>
                  {insightState.report.current.glucoseCvPercent === null
                    ? '—'
                    : `${insightState.report.current.glucoseCvPercent}%`}
                </Text>
                <Text
                  style={[styles.signalUnit, { color: colors.textTertiary }]}
                >
                  coefficient
                </Text>
              </View>
              <View
                style={[
                  styles.signal,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Text
                  style={[styles.signalLabel, { color: colors.textSecondary }]}
                >
                  Sustained runs
                </Text>
                <Text style={[styles.signalValue, { color: colors.text }]}>
                  {insightState.report.current.highGlucoseRuns +
                    insightState.report.current.lowGlucoseRuns}
                </Text>
                <Text
                  style={[styles.signalUnit, { color: colors.textTertiary }]}
                >
                  high + low
                </Text>
              </View>
            </View>
            {!insightState.report.ready && dataMode === 'live' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void setDataMode('demo')}
                style={({ pressed }) => [
                  styles.previewButton,
                  {
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.previewText, { color: colors.primary }]}>
                  Preview the method in Demo lab
                </Text>
              </Pressable>
            ) : null}
          </SectionCard>

          <SectionHeading
            title="Ask the evidence"
            detail="Questions are answered from deterministic comparisons in this build."
          />
          <SectionCard>
            <View
              style={[
                styles.askRow,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                },
              ]}
            >
              <TextInput
                accessibilityLabel="Question for Daymark"
                onChangeText={setQuestion}
                onSubmitEditing={() => ask()}
                placeholder="Why was my glucose different?"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="send"
                style={[styles.askInput, { color: colors.text }]}
                value={question}
              />
              <Pressable
                accessibilityLabel="Ask Daymark"
                accessibilityRole="button"
                disabled={!question.trim()}
                onPress={() => ask()}
                style={({ pressed }) => [
                  styles.askButton,
                  {
                    backgroundColor: question.trim()
                      ? colors.primary
                      : colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={
                    question.trim() ? colors.onPrimary : colors.textTertiary
                  }
                  name="arrow-up"
                  size={20}
                />
              </Pressable>
            </View>
            <View style={styles.suggestions}>
              {SUGGESTED_QUESTIONS.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  accessibilityRole="button"
                  onPress={() => ask(suggestion)}
                  style={({ pressed }) => [
                    styles.suggestion,
                    {
                      borderColor: colors.border,
                      borderRadius: radius.pill,
                      backgroundColor: pressed
                        ? colors.surfaceMuted
                        : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[styles.suggestionText, { color: colors.textSecondary }]}
                  >
                    {suggestion}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SectionCard>

          {answer ? (
            <View
              accessibilityLiveRegion="polite"
              onLayout={(event) => setAnswerOffset(event.nativeEvent.layout.y)}
            >
              <SectionCard
                style={[
                  styles.answerCard,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: `${colors.accent}55`,
                  },
                ]}
              >
                <View style={styles.answerHeader}>
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="sparkles-outline"
                    size={22}
                  />
                  <Text style={[styles.answerTitle, { color: colors.text }]}>
                    {answer.title}
                  </Text>
                </View>
                <Text
                  style={[styles.answerText, { color: colors.textSecondary }]}
                >
                  {answer.answer}
                </Text>
                <Text
                  style={[styles.answerMeta, { color: colors.textTertiary }]}
                >
                  Supported by {answer.findingIds.length} finding
                  {answer.findingIds.length === 1 ? '' : 's'} below
                </Text>
              </SectionCard>
            </View>
          ) : null}

          <SectionHeading
            title="Findings and evidence"
            detail="Inspect each calculation window and its representative normalised records."
          />
          <View style={styles.findingStack}>
            {findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                expanded={expanded.has(finding.id)}
                highlighted={Boolean(answer?.findingIds.includes(finding.id))}
                onToggle={() => toggleFinding(finding.id)}
                onInspectRecords={setSelectedEvidence}
              />
            ))}
          </View>
          <View style={styles.safety}>
            <SafetyNote />
          </View>
        </>
      )}
      </AppScreen>
      <EvidenceRecordInspector
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(undefined)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  demoNotice: {
    minHeight: 62,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  demoText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  hero: {
    padding: 20,
  },
  heroEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  heroTitle: {
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.45,
    marginTop: 8,
  },
  heroSummary: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
  },
  metricRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 24,
    marginTop: 20,
    paddingTop: 18,
  },
  metric: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricDelta: {
    fontSize: 10,
    lineHeight: 15,
  },
  signalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  signal: {
    flex: 1,
    minWidth: 86,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  signalLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  signalValue: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  signalUnit: {
    fontSize: 9,
    lineHeight: 13,
  },
  previewButton: {
    minHeight: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  askRow: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 5,
  },
  askInput: {
    minHeight: 52,
    flex: 1,
    fontSize: 15,
  },
  askButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  suggestion: {
    minHeight: 38,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  suggestionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  answerCard: {
    marginTop: 12,
  },
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  answerTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  answerText: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  answerMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 9,
  },
  findingStack: {
    gap: 12,
  },
  findingCard: {
    padding: 18,
  },
  findingTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  findingIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findingCopy: {
    flex: 1,
  },
  findingKind: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  findingTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
    marginTop: 2,
  },
  findingSummary: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  caveat: {
    fontSize: 11,
    lineHeight: 17,
    fontStyle: 'italic',
    marginTop: 7,
  },
  evidenceButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  evidenceButtonText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  evidenceStack: {
    gap: 12,
    marginTop: 12,
  },
  evidenceBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  evidenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  evidenceLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  evidenceCount: {
    fontSize: 10,
    lineHeight: 15,
  },
  evidenceDescription: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  exampleRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 9,
  },
  exampleTime: {
    width: 38,
    fontSize: 10,
    lineHeight: 15,
    fontVariant: ['tabular-nums'],
  },
  exampleCopy: {
    flex: 1,
  },
  examplePrimary: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  exampleSecondary: {
    fontSize: 9,
    lineHeight: 14,
  },
  exampleId: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 2,
  },
  openRecordsButton: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 10,
  },
  openRecordsText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  safety: {
    marginTop: 18,
  },
});
