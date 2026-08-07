import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { DataSourceStatus } from '@/domain/models';
import { formatTime, relativeAge } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import { StatusPill } from './StatusPill';

function SourceAvailabilityPill({
  label,
  available,
}: {
  label: string;
  available: boolean;
}) {
  const { colors } = useAppTheme();
  const tone = available ? colors.accent : colors.textTertiary;
  return (
    <View
      accessibilityLabel={`Source status: ${label}`}
      style={[
        styles.availabilityPill,
        {
          backgroundColor: `${tone}18`,
          borderColor: `${tone}55`,
        },
      ]}
    >
      <View style={[styles.statusDot, { backgroundColor: tone }]} />
      <Text style={[styles.availabilityLabel, { color: tone }]}>{label}</Text>
    </View>
  );
}

function SourceRow({
  source,
  now,
  last,
}: {
  source: DataSourceStatus;
  now: number;
  last: boolean;
}) {
  const { colors } = useAppTheme();
  const isGlucose = source.label === 'Glucose';
  const isContext = source.label === 'Health context';
  const tone = isGlucose
    ? colors.glucose
    : isContext
      ? colors.accent
      : colors.insulin;
  const icon = isGlucose
    ? 'pulse-outline'
    : isContext
      ? 'layers-outline'
      : 'water-outline';
  const primaryTiming = isGlucose
    ? source.dataThrough
      ? `Through ${formatTime(source.dataThrough)}`
      : 'No reading time'
    : source.lastUpdatedAt
      ? `Last synced ${relativeAge(source.lastUpdatedAt, now)}`
      : source.dataThrough
        ? `Through ${formatTime(source.dataThrough)}`
        : 'No records yet';

  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomColor: colors.divider, borderBottomWidth: 1 },
      ]}
    >
      <View
        style={[
          styles.sourceIcon,
          {
            backgroundColor: isContext
              ? `${colors.accent}17`
              : isGlucose
                ? `${colors.glucose}17`
                : colors.insulinSoft,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          name={icon}
          color={tone}
          size={21}
        />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.name, { color: colors.text }]}>{source.label}</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          {source.detail}
        </Text>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>
          {primaryTiming}
          {!isGlucose && source.lastUpdatedAt && source.dataThrough
            ? `  ·  Through ${formatTime(source.dataThrough)}`
            : ''}
          {isGlucose && source.lastUpdatedAt
            ? `  ·  ${relativeAge(source.lastUpdatedAt, now)}`
            : ''}
          {source.recordCount !== undefined
            ? `  ·  ${source.recordCount} records`
            : ''}
        </Text>
      </View>
      {isGlucose ? (
        <StatusPill freshness={source.freshness} compact />
      ) : (
        <SourceAvailabilityPill
          available={source.freshness !== 'missing'}
          label={
            source.freshness === 'missing'
              ? 'No data'
              : isContext
                ? 'Available'
                : 'Synced'
          }
        />
      )}
    </View>
  );
}

export function SourceStatusCard({
  sources,
  now,
}: {
  sources: DataSourceStatus[];
  now: number;
}) {
  const { colors } = useAppTheme();
  const synthetic =
    sources.length > 0 &&
    sources.every((source) => source.origin === 'synthetic');
  return (
    <SectionCard>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Data sources</Text>
        <Text
          style={[
            styles.fixture,
            { color: synthetic ? colors.primary : colors.accent },
          ]}
        >
          {synthetic ? 'DEMO FIXTURES' : 'PERSONAL DATA'}
        </Text>
      </View>
      {sources.map((source, index) => (
        <SourceRow
          key={source.id}
          source={source}
          now={now}
          last={index === sources.length - 1}
        />
      ))}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  fixture: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  row: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  sourceIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  detail: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  meta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  availabilityPill: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  availabilityLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});
