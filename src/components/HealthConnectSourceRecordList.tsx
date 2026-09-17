import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  HealthConnectRecordGroup,
  presentHealthConnectSourceRecord,
} from '@/data/healthConnect/sourceRecordPresentation';
import type {
  StoredHealthConnectRecord,
} from '@/data/healthConnect/sourceRecords';
import { formatTime, relativeAge } from '@/domain/time';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

const groupIcons: Record<
  HealthConnectRecordGroup,
  keyof typeof Ionicons.glyphMap
> = {
  movement: 'footsteps-outline',
  workout: 'barbell-outline',
  recovery: 'moon-outline',
  body: 'body-outline',
  glucose: 'water-outline',
  vitals: 'pulse-outline',
  cycle: 'calendar-outline',
  nutrition: 'nutrition-outline',
};

function readableJson(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function technicalDetails(record: StoredHealthConnectRecord) {
  return [
    `External ID: ${record.externalId}`,
    record.parentExternalId
      ? `Parent ID: ${record.parentExternalId}`
      : undefined,
    `Package: ${record.sourcePackage}`,
    `Recording method: ${record.recordingMethod}`,
    record.deviceManufacturer || record.deviceModel
      ? `Device: ${[record.deviceManufacturer, record.deviceModel]
          .filter(Boolean)
          .join(' ')}`
      : undefined,
    `Last modified: ${relativeAge(record.lastModifiedTimeMs)}`,
    `Stored locally: ${relativeAge(record.importedAt)}`,
  ].filter((value): value is string => Boolean(value));
}

interface HealthConnectSourceRecordListProps {
  initiallyExpanded?: boolean;
  loadingMore?: boolean;
  onShowMore?: () => Promise<void> | void;
  records: StoredHealthConnectRecord[];
  totalRecords: number;
}

export function HealthConnectSourceRecordList(
  props: HealthConnectSourceRecordListProps,
) {
  return (
    <HealthConnectSourceRecordListContent
      key={props.initiallyExpanded === true ? "expanded" : "collapsed"}
      {...props}
    />
  );
}

function HealthConnectSourceRecordListContent({
  initiallyExpanded = false,
  loadingMore = false,
  onShowMore,
  records,
  totalRecords,
}: HealthConnectSourceRecordListProps) {
  const { colors, radius } = useAppTheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [visibleCount, setVisibleCount] = useState(40);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const sorted = useMemo(
    () =>
      [...records].sort(
        (left, right) =>
          right.startTimeMs - left.startTimeMs ||
          left.id.localeCompare(right.id),
      ),
    [records],
  );
  const visible = sorted.slice(0, visibleCount);

  if (!totalRecords) return null;

  function toggleRecord(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function showMore() {
    if (visibleCount < records.length) {
      setVisibleCount((count) => count + 40);
      return;
    }
    await onShowMore?.();
    setVisibleCount((count) => count + 40);
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            HEALTH CONNECT
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Imported details
          </Text>
        </View>
        <View style={styles.countCopy}>
          <Text style={[styles.count, { color: colors.text }]}>
            {formatRegionalNumber(totalRecords, getRuntimeRegionalDefaults().locale)}
          </Text>
          <Text style={[styles.countLabel, { color: colors.textTertiary }]}>
            {totalRecords === 1 ? 'record' : 'records'}
          </Text>
        </View>
      </View>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        Every item imported for this day is available here, including
        workouts, sleep, nutrition, cycle information and measurements. Open
        an item to see the original details saved by its provider.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [
          styles.toggle,
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
          name={expanded ? 'chevron-up' : 'list-outline'}
          size={18}
        />
        <Text style={[styles.toggleText, { color: colors.primary }]}>
          {expanded ? 'Hide imported details' : 'Show imported details'}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={styles.rows}>
          {visible.map((record, index) => {
            const item = presentHealthConnectSourceRecord(record);
            const rowExpanded = openIds.has(record.id);
            return (
              <View
                key={record.id}
                style={[
                  styles.row,
                  index < visible.length - 1 && {
                    borderBottomColor: colors.divider,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: rowExpanded }}
                  accessibilityLabel={`${item.title}, ${record.sourceLabel}. ${
                    rowExpanded ? 'Hide' : 'Show'
                  } imported details.`}
                  onPress={() => toggleRecord(record.id)}
                  style={({ pressed }) => [
                    styles.rowButton,
                    { opacity: pressed ? 0.72 : 1 },
                  ]}
                >
                  <View
                    style={[
                      styles.icon,
                      {
                        backgroundColor: `${colors.accent}16`,
                        borderRadius: radius.sm,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.accent}
                      name={groupIcons[item.group]}
                      size={18}
                    />
                  </View>
                  <View style={styles.copy}>
                    <Text style={[styles.value, { color: colors.text }]}>
                      {item.title}
                    </Text>
                    {item.detail ? (
                      <Text
                        style={[
                          styles.detail,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {item.detail}
                      </Text>
                    ) : null}
                    <Text
                      style={[
                        styles.meta,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {formatTime(record.startTimeMs)}
                      {record.endTimeMs > record.startTimeMs
                        ? `–${formatTime(record.endTimeMs)}`
                        : ''}{' '}
                      · {record.sourceLabel}
                    </Text>
                  </View>
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.textTertiary}
                    name={rowExpanded ? 'chevron-up' : 'chevron-down'}
                    size={17}
                  />
                </Pressable>
                {rowExpanded ? (
                  <View
                    style={[
                      styles.sourceDetails,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sourceHeading,
                        { color: colors.textSecondary },
                      ]}
                    >
                      SOURCE DETAILS
                    </Text>
                    {technicalDetails(record).map((detail) => (
                      <Text
                        key={detail}
                        selectable
                        style={[
                          styles.technical,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {detail}
                      </Text>
                    ))}
                    <Text
                      style={[
                        styles.payloadHeading,
                        { color: colors.textSecondary },
                      ]}
                    >
                      ORIGINAL DETAILS
                    </Text>
                    <Text
                      selectable
                      style={[
                        styles.payload,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          borderRadius: radius.sm,
                          color: colors.textTertiary,
                        },
                      ]}
                    >
                      {readableJson(record.rawPayloadJson)}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
          {visible.length < totalRecords ? (
            <Pressable
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={() => void showMore()}
              style={({ pressed }) => [
                styles.more,
                { opacity: loadingMore ? 0.55 : pressed ? 0.65 : 1 },
              ]}
            >
              {loadingMore ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={[styles.moreText, { color: colors.primary }]}>
                  Show more
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  heading: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    marginTop: 2,
  },
  countCopy: {
    alignItems: 'flex-end',
  },
  count: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  countLabel: {
    fontSize: 9,
    lineHeight: 13,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 9,
  },
  toggle: {
    minHeight: 48,
    marginTop: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  toggleText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  rows: {
    marginTop: 8,
  },
  row: {
    paddingVertical: 4,
  },
  rowButton: {
    minHeight: 78,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  detail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  meta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  sourceDetails: {
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 11,
    marginLeft: 49,
    padding: 12,
  },
  sourceHeading: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 5,
  },
  technical: {
    fontSize: 10,
    lineHeight: 15,
  },
  payloadHeading: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
    marginBottom: 6,
    marginTop: 11,
  },
  payload: {
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: 'monospace',
    fontSize: 9,
    lineHeight: 14,
    padding: 9,
  },
  more: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
});
