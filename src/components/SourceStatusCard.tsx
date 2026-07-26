import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { DataSourceStatus } from '@/domain/models';
import { formatTime, relativeAge } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import { StatusPill } from './StatusPill';

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
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]}>{source.label}</Text>
          {!source.isLive ? (
            <Text style={[styles.notLive, { color: colors.warning }]}>NOT LIVE</Text>
          ) : null}
        </View>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          {source.detail}
        </Text>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>
          {source.dataThrough
            ? `Data through ${formatTime(source.dataThrough)}`
            : 'No data timestamp'}
          {'  ·  '}
          {relativeAge(source.lastUpdatedAt, now)}
          {source.recordCount !== undefined
            ? `  ·  ${source.recordCount} records`
            : ''}
        </Text>
      </View>
      <StatusPill freshness={source.freshness} compact />
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
  const synthetic = sources.length > 0 && sources.every(
    (source) => source.origin === 'synthetic',
  );
  return (
    <SectionCard>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Data sources</Text>
        <Text style={[styles.fixture, { color: synthetic ? colors.primary : colors.accent }]}>
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  notLive: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
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
});
