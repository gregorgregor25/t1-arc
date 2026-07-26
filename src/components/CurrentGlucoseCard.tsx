import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { DataSourceStatus, GlucoseReading } from '@/domain/models';
import { freshnessCopy } from '@/domain/freshness';
import { relativeAge } from '@/domain/time';
import { presentTrend } from '@/domain/trend';
import { useAppTheme } from '@/theme/theme';

import { StatusPill } from './StatusPill';

export function CurrentGlucoseCard({
  reading,
  source,
  now,
}: {
  reading?: GlucoseReading;
  source?: DataSourceStatus;
  now: number;
}) {
  const { colors, dark, radius } = useAppTheme();
  const freshness = source?.freshness ?? 'missing';
  const trend = presentTrend(reading?.trend ?? 'unknown');
  const age = relativeAge(reading?.timestamp, now);
  const trendIcon: keyof typeof Ionicons.glyphMap =
    reading?.trend === 'doubleDown' ||
    reading?.trend === 'down' ||
    reading?.trend === 'slightDown'
      ? 'trending-down-outline'
      : reading?.trend === 'flat'
        ? 'remove-outline'
        : reading?.trend === 'unknown' || !reading
          ? 'help-outline'
          : 'trending-up-outline';

  return (
    <LinearGradient
      accessibilityLabel={
        reading
          ? `Current glucose ${reading.mmolL.toFixed(1)} millimoles per litre, ${trend.label}. ${freshnessCopy[freshness].label}, updated ${age}.`
          : 'Current glucose is unavailable.'
      }
      colors={
        dark
          ? ['#16424C', '#10272D', '#102328']
          : ['#D8F4F6', '#F3FBFC', '#FFFFFF']
      }
      end={{ x: 0.9, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[
        styles.card,
        {
          borderColor: colors.border,
          borderRadius: radius.xl,
          shadowColor: colors.shadow,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            CURRENT GLUCOSE
          </Text>
          <Text style={[styles.source, { color: colors.textTertiary }]}>
            {source?.origin === 'live'
              ? 'Direct LibreLinkUp'
              : source?.origin === 'synthetic'
                ? 'Synthetic Daymark feed'
                : 'Connecting glucose source'}
          </Text>
        </View>
        <StatusPill freshness={freshness} />
      </View>

      {reading ? (
        <>
          <View style={styles.readingRow}>
            <Text
              maxFontSizeMultiplier={1.3}
              style={[styles.value, { color: colors.text }]}
            >
              {reading.mmolL.toFixed(1)}
            </Text>
            <View style={styles.unitBlock}>
              <Text style={[styles.arrow, { color: colors.glucose }]}>
                {trend.arrow}
              </Text>
              <Text style={[styles.unit, { color: colors.textSecondary }]}>
                mmol/L
              </Text>
            </View>
          </View>
          <View style={styles.footer}>
            <View style={styles.detailRow}>
              <Ionicons
                accessibilityElementsHidden
                name={trendIcon}
                color={colors.glucose}
                size={18}
              />
              <Text style={[styles.detailStrong, { color: colors.text }]}>
                {trend.label}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Ionicons
                accessibilityElementsHidden
                name="time-outline"
                color={colors.textSecondary}
                size={18}
              />
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {age}
              </Text>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.missing}>
          <Text style={[styles.missingTitle, { color: colors.text }]}>No reading</Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            The glucose source has not supplied a usable value.
          </Text>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 256,
    padding: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 22,
    elevation: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  source: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
  },
  value: {
    fontSize: 78,
    lineHeight: 82,
    fontWeight: '700',
    letterSpacing: -4,
    fontVariant: ['tabular-nums'],
  },
  unitBlock: {
    marginLeft: 13,
    paddingTop: 7,
  },
  arrow: {
    fontSize: 32,
    lineHeight: 34,
    fontWeight: '700',
  },
  unit: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 18,
    marginTop: 15,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  detailStrong: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  detail: {
    fontSize: 14,
    lineHeight: 20,
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 30,
  },
  missingTitle: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    marginBottom: 8,
  },
});
