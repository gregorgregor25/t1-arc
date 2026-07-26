import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EvidenceReference } from '@/domain/insights';
import { TimelineData } from '@/domain/models';
import { formatDate, toDateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { RecordList } from './RecordList';

interface Props {
  evidence?: EvidenceReference;
  onClose(): void;
}

function timelineIds(data: TimelineData) {
  return new Set([
    ...data.glucose.map((record) => record.id),
    ...data.basal.map((record) => record.id),
    ...data.boluses.map((record) => record.id),
    ...data.context.map((record) => record.id),
  ]);
}

export function EvidenceRecordInspector({ evidence, onClose }: Props) {
  const { colors, radius } = useAppTheme();
  const { repository, revision } = useDataContext();
  const [data, setData] = useState<TimelineData>();
  const [error, setError] = useState<string>();
  const [visibleCount, setVisibleCount] = useState(100);

  useEffect(() => {
    let active = true;
    setData(undefined);
    setError(undefined);
    setVisibleCount(100);
    if (!evidence || !repository) {
      return () => {
        active = false;
      };
    }
    void repository
      .getTimeline(evidence.range)
      .then((timeline) => {
        if (active) setData(timeline);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'The supporting records could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, [evidence, repository, revision]);

  const resolution = useMemo(() => {
    if (!data || !evidence) return undefined;
    const available = timelineIds(data);
    const requested = new Set(evidence.recordIds);
    const resolved = [...requested].filter((id) => available.has(id)).length;
    return { requested: requested.size, resolved };
  }, [data, evidence]);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={Boolean(evidence)}
    >
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.accent }]}>
              EXACT CALCULATION INPUTS
            </Text>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.text }]}>
              {evidence?.label ?? 'Supporting records'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close supporting records"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              {
                backgroundColor: pressed
                  ? colors.surfaceMuted
                  : 'transparent',
                borderRadius: radius.pill,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.textSecondary}
              name="close"
              size={25}
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {evidence ? (
            <View
              style={[
                styles.explainer,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <View style={styles.explainerTop}>
                <View
                  style={[
                    styles.shield,
                    {
                      backgroundColor: `${colors.accent}18`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="document-text-outline"
                    size={22}
                  />
                </View>
                <View style={styles.explainerCopy}>
                  <Text style={[styles.explainerTitle, { color: colors.text }]}>
                    No hidden evidence
                  </Text>
                  <Text style={[styles.explainerBody, { color: colors.textSecondary }]}>
                    {evidence.description}. Every record ID used for this claim
                    is resolved against the same normalised local data.
                  </Text>
                </View>
              </View>
              <View style={[styles.summaryRow, { borderColor: colors.divider }]}>
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {resolution?.resolved ?? evidence.recordIds.length}
                  </Text>
                  <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                    RESOLVED
                  </Text>
                </View>
                <View style={styles.summaryMetric}>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    {resolution
                      ? resolution.requested - resolution.resolved
                      : 0}
                  </Text>
                  <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                    MISSING
                  </Text>
                </View>
                <View style={styles.summaryDates}>
                  <Text style={[styles.summaryDate, { color: colors.textSecondary }]}>
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
                  <Text style={[styles.summaryLabel, { color: colors.textTertiary }]}>
                    EUROPE/LONDON
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {error ? (
            <View
              style={[
                styles.stateCard,
                {
                  backgroundColor: `${colors.danger}10`,
                  borderColor: `${colors.danger}55`,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.danger}
                name="alert-circle-outline"
                size={22}
              />
              <Text style={[styles.stateText, { color: colors.textSecondary }]}>
                {error}
              </Text>
            </View>
          ) : !data || !evidence ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Resolving exact record IDs…
              </Text>
            </View>
          ) : (
            <>
              {resolution && resolution.resolved < resolution.requested ? (
                <View
                  style={[
                    styles.stateCard,
                    {
                      backgroundColor: `${colors.warning}10`,
                      borderColor: `${colors.warning}55`,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.warning}
                    name="warning-outline"
                    size={22}
                  />
                  <Text style={[styles.stateText, { color: colors.textSecondary }]}>
                    {resolution.requested - resolution.resolved} referenced
                    record ID
                    {resolution.requested - resolution.resolved === 1 ? '' : 's'}{' '}
                    could not be resolved. This claim should be treated as
                    incomplete until the source history is restored.
                  </Text>
                </View>
              ) : null}
              <RecordList
                data={data}
                emptyMessage="None of the referenced records could be resolved locally."
                filter="all"
                headerTitle="All supporting records"
                recordIds={evidence.recordIds}
                visibleCount={visibleCount}
                onShowMore={() => setVisibleCount((count) => count + 100)}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    minHeight: 74,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTitle: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '800',
    marginTop: 2,
  },
  close: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 42,
    gap: 14,
  },
  explainer: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  explainerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  shield: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerCopy: {
    flex: 1,
  },
  explainerTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  explainerBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  summaryRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    paddingTop: 13,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 18,
  },
  summaryMetric: {
    minWidth: 54,
  },
  summaryValue: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.65,
    marginTop: 1,
  },
  summaryDates: {
    flex: 1,
    alignItems: 'flex-end',
  },
  summaryDate: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  loading: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 18,
  },
  stateCard: {
    minHeight: 62,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stateText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});
