import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MANUAL_CONTEXT_SOURCE_ID } from '@/data/manualContext';
import {
  BasalDelivery,
  BolusDelivery,
  GlucoseReading,
  HealthContextEvent,
  InsulinDailyTotal,
  TimelineData,
} from '@/domain/models';
import { contextNoteCategoryLabel } from '@/domain/contextNotes';
import { formatTime } from '@/domain/time';
import { presentTrend } from '@/domain/trend';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export type RecordFilter = 'all' | 'glucose' | 'insulin' | 'context';

type DisplayRecord =
  | { kind: 'glucose'; timestamp: number; value: GlucoseReading }
  | { kind: 'basal'; timestamp: number; value: BasalDelivery }
  | { kind: 'bolus'; timestamp: number; value: BolusDelivery }
  | { kind: 'insulin-total'; timestamp: number; value: InsulinDailyTotal }
  | { kind: 'context'; timestamp: number; value: HealthContextEvent };

function toDisplayRecords(
  data: TimelineData,
  filter: RecordFilter,
  recordIds?: readonly string[],
): DisplayRecord[] {
  const allowed = recordIds ? new Set(recordIds) : undefined;
  const glucose: DisplayRecord[] =
    filter === 'insulin' || filter === 'context'
      ? []
      : data.glucose.map((value) => ({
          kind: 'glucose' as const,
          timestamp: value.timestamp,
          value,
        }));
  const basal: DisplayRecord[] =
    filter === 'glucose' || filter === 'context'
      ? []
      : data.basal.map((value) => ({
          kind: 'basal' as const,
          timestamp: value.start,
          value,
        }));
  const bolus: DisplayRecord[] =
    filter === 'glucose' || filter === 'context'
      ? []
      : data.boluses.map((value) => ({
          kind: 'bolus' as const,
          timestamp: value.timestamp,
          value,
        }));
  const context: DisplayRecord[] =
    filter === 'glucose' || filter === 'insulin'
      ? []
      : data.context.map((value) => ({
          kind: 'context' as const,
          timestamp: value.start,
          value,
        }));
  const dailyTotals: DisplayRecord[] =
    filter === 'glucose' || filter === 'context'
      ? []
      : (data.dailyInsulinTotals ?? []).map((value) => ({
          kind: 'insulin-total' as const,
          timestamp: value.timestamp,
          value,
        }));
  return [...glucose, ...basal, ...bolus, ...dailyTotals, ...context]
    .filter((record) => !allowed || allowed.has(record.value.id))
    .sort((a, b) => b.timestamp - a.timestamp);
}

function RecordRow({
  record,
  last,
  onDeleteManualContext,
  onEditManualContext,
}: {
  record: DisplayRecord;
  last: boolean;
  onDeleteManualContext?: (id: string, title: string) => void;
  onEditManualContext?: (event: HealthContextEvent) => void;
}) {
  const { colors } = useAppTheme();
  const isGlucose = record.kind === 'glucose';
  const tone =
    record.kind === 'context'
      ? colors.accent
      : isGlucose
        ? colors.glucose
        : colors.insulin;
  let title: string;
  let detail: string;
  let source: string;
  let provenance: string | undefined;
  let icon:
    | 'pulse-outline'
    | 'water-outline'
    | 'analytics-outline'
    | 'calculator-outline'
    | 'layers-outline';

  if (record.kind === 'glucose') {
    const trend = presentTrend(record.value.trend);
    title = `${record.value.mmolL.toFixed(1)} mmol/L  ${trend.arrow}`;
    detail = `${trend.label} · ${record.value.quality}`;
    source = record.value.sourceId;
    const provenanceParts = [
      record.value.sourceFile,
      record.value.sourceRow
        ? `row ${record.value.sourceRow}`
        : undefined,
      record.value.sourceDeviceId
        ? `device ${record.value.sourceDeviceId}`
        : undefined,
      record.value.sourceFactoryTimestamp
        ? `source time ${record.value.sourceFactoryTimestamp}`
        : undefined,
    ].filter((value): value is string => Boolean(value));
    provenance = provenanceParts.length
      ? provenanceParts.join(' · ')
      : undefined;
    icon = 'pulse-outline';
  } else if (record.kind === 'bolus') {
    title = `${record.value.units.toFixed(1)} U bolus`;
    detail = [
      record.value.deliveryType || 'Delivered insulin event',
      record.value.carbsInputGrams === undefined
        ? undefined
        : `${record.value.carbsInputGrams.toFixed(0)} g carbohydrate input`,
      record.value.bloodGlucoseInputMmolL === undefined
        ? undefined
        : `${record.value.bloodGlucoseInputMmolL.toFixed(1)} mmol/L input`,
      record.value.carbRatioGramsPerUnit === undefined
        ? undefined
        : `1:${record.value.carbRatioGramsPerUnit.toFixed(1)} carb ratio`,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · ');
    source = record.value.sourceId;
    provenance = record.value.sourceFile
      ? `${record.value.sourceFile}${record.value.sourceRow ? ` · row ${record.value.sourceRow}` : ''}`
      : undefined;
    icon = 'water-outline';
  } else if (record.kind === 'basal') {
    title = `${record.value.rateUnitsPerHour.toFixed(2)} U/h basal`;
    detail = [
      record.value.deliveryType,
      `${record.value.units.toFixed(2)} U ${
        record.value.unitsEstimated
          ? 'calculated from rate and duration'
          : 'reported delivered'
      }`,
      `until ${formatTime(record.value.end)}`,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' · ');
    source = record.value.sourceId;
    provenance = record.value.sourceFile
      ? `${record.value.sourceFile}${record.value.sourceRow ? ` · row ${record.value.sourceRow}` : ''}`
      : undefined;
    icon = 'analytics-outline';
  } else if (record.kind === 'insulin-total') {
    title = `${record.value.totalUnits.toFixed(1)} U source daily total`;
    const parts = [
      record.value.basalUnits === undefined
        ? undefined
        : `${record.value.basalUnits.toFixed(1)} U basal`,
      record.value.bolusUnits === undefined
        ? undefined
        : `${record.value.bolusUnits.toFixed(1)} U bolus`,
    ].filter((part): part is string => Boolean(part));
    detail = parts.length
      ? parts.join(' · ')
      : 'Reported aggregate insulin total';
    source = record.value.sourceId;
    provenance = record.value.sourceFile
      ? `${record.value.sourceFile}${record.value.sourceRow ? ` · row ${record.value.sourceRow}` : ''}`
      : undefined;
    icon = 'calculator-outline';
  } else {
    title = record.value.title;
    switch (record.value.kind) {
      case 'meal':
        detail = `${record.value.carbsGrams} g carbohydrate · ${record.value.mealType}`;
        break;
      case 'activity':
        detail = `${record.value.durationMinutes} min · ${record.value.intensity}`;
        break;
      case 'sleep':
        detail = `${Math.floor(record.value.durationMinutes / 60)}h ${record.value.durationMinutes % 60}m sleep`;
        break;
      case 'weight':
        detail = `${record.value.kilograms.toFixed(1)} kg`;
        break;
      case 'medication':
        detail =
          record.value.amount !== undefined
            ? `${record.value.amount}${record.value.unit ? ` ${record.value.unit}` : ''}`
            : 'Recorded medication event';
        break;
      case 'note':
        detail = record.value.detail
          ? `${contextNoteCategoryLabel(record.value.category)} · ${record.value.detail}`
          : contextNoteCategoryLabel(record.value.category);
        break;
    }
    source = record.value.sourceId;
    provenance =
      record.value.origin === 'manual'
        ? 'entered manually'
        : record.value.sourceFile
          ? `${record.value.sourceFile}${record.value.sourceRow ? ` · row ${record.value.sourceRow}` : ''}`
          : record.value.origin;
    icon = 'layers-outline';
  }

  return (
    <View
      accessibilityLabel={`${formatTime(record.timestamp)}, ${title}, ${detail}, source ${source}`}
      style={[
        styles.row,
        !last && {
          borderBottomColor: colors.divider,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: `${tone}17` }]}>
        <Ionicons
          accessibilityElementsHidden
          name={icon}
          color={tone}
          size={19}
        />
      </View>
      <View style={styles.timeBlock}>
        <Text style={[styles.time, { color: colors.text }]}>{formatTime(record.timestamp)}</Text>
        <Text style={[styles.kind, { color: tone }]}>
          {record.kind === 'insulin-total'
            ? 'TOTAL'
            : record.kind.toUpperCase()}
        </Text>
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>{detail}</Text>
        <Text style={[styles.source, { color: colors.textTertiary }]}>
          source: {source}
          {provenance ? ` · ${provenance}` : ''}
        </Text>
      </View>
      {record.kind === 'context' && record.value.origin === 'manual' ? (
        <View style={styles.actions}>
          {onEditManualContext &&
          record.value.sourceId === MANUAL_CONTEXT_SOURCE_ID &&
          record.value.kind !== 'meal' ? (
            <Pressable
              accessibilityLabel={`Edit manual entry ${record.value.title}`}
              accessibilityRole="button"
              hitSlop={4}
              onPress={() => onEditManualContext(record.value)}
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: pressed
                    ? `${colors.primary}16`
                    : 'transparent',
                  borderRadius: 999,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                name="create-outline"
                size={18}
              />
            </Pressable>
          ) : null}
          {onDeleteManualContext ? (
            <Pressable
              accessibilityLabel={`Delete manual entry ${record.value.title}`}
              accessibilityRole="button"
              hitSlop={4}
              onPress={() =>
                onDeleteManualContext(record.value.id, record.value.title)
              }
              style={({ pressed }) => [
                styles.actionButton,
                {
                  backgroundColor: pressed
                    ? `${colors.danger}16`
                    : 'transparent',
                  borderRadius: 999,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.danger}
                name="trash-outline"
                size={18}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function RecordList({
  data,
  filter,
  visibleCount,
  recordIds,
  headerTitle = 'Normalised records',
  emptyMessage = 'No records match this date and filter.',
  onDeleteManualContext,
  onEditManualContext,
  onShowMore,
}: {
  data: TimelineData;
  filter: RecordFilter;
  visibleCount: number;
  recordIds?: readonly string[];
  headerTitle?: string;
  emptyMessage?: string;
  onDeleteManualContext?: (id: string, title: string) => void;
  onEditManualContext?: (event: HealthContextEvent) => void;
  onShowMore: () => void;
}) {
  const { colors, radius } = useAppTheme();
  const records = toDisplayRecords(data, filter, recordIds);
  const visible = records.slice(0, visibleCount);

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {headerTitle}
        </Text>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {Math.min(visibleCount, records.length)} of {records.length}
        </Text>
      </View>
      {visible.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          {emptyMessage}
        </Text>
      ) : (
        visible.map((record, index) => (
          <RecordRow
            key={`${record.kind}:${record.value.id}`}
            record={record}
            last={index === visible.length - 1}
            onDeleteManualContext={onDeleteManualContext}
            onEditManualContext={onEditManualContext}
          />
        ))
      )}
      {visible.length < records.length ? (
        <Pressable
          accessibilityLabel={`Show more records. ${records.length - visible.length} remaining.`}
          accessibilityRole="button"
          onPress={onShowMore}
          style={({ pressed }) => [
            styles.moreButton,
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.moreText, { color: colors.primary }]}>
            Show more records
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 2,
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  count: {
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  row: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBlock: {
    width: 48,
  },
  time: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  kind: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.45,
    marginTop: 1,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  detail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  source: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  actions: {
    width: 40,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 30,
    textAlign: 'center',
  },
  moreButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  moreText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});
