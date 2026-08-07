import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { HealthContextCoverageItem } from '@/domain/healthContextCoverage';
import { useAppTheme } from '@/theme/theme';

const ICONS: Record<
  HealthContextCoverageItem['id'],
  keyof typeof Ionicons.glyphMap
> = {
  movement: 'footsteps-outline',
  workouts: 'barbell-outline',
  sleep: 'moon-outline',
  heart: 'heart-outline',
  body: 'body-outline',
  vitals: 'pulse-outline',
  hormones: 'calendar-outline',
  hydration: 'water-outline',
};

export function HealthContextCoverage({
  items,
}: {
  items: HealthContextCoverageItem[];
}) {
  const { colors, radius } = useAppTheme();
  const recorded = items.filter((item) => item.status === 'recorded').length;
  const sourceNeeded = items.filter(
    (item) => item.status === 'source-needed',
  ).length;

  return (
    <View
      accessibilityLabel={`${recorded} of ${items.length} health context types have records. ${
        sourceNeeded
          ? `${sourceNeeded} need a source choice.`
          : 'A blank type means no record was received, not zero.'
      }`}
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>
            Context coverage
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            What T1 Arc can see for this day
          </Text>
        </View>
        <Text style={[styles.count, { color: colors.accent }]}>
          {recorded}/{items.length}
        </Text>
      </View>

      <View style={styles.items}>
        {items.map((item) => {
          const tone =
            item.status === 'recorded'
              ? colors.accent
              : item.status === 'source-needed'
                ? colors.warning
                : colors.textTertiary;
          return (
            <View
              key={item.id}
              style={[
                styles.item,
                {
                  backgroundColor: colors.surface,
                  borderColor:
                    item.status === 'source-needed'
                      ? `${colors.warning}66`
                      : colors.border,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={tone}
                name={ICONS[item.id]}
                size={14}
              />
              <Text style={[styles.itemLabel, { color: colors.textSecondary }]}>
                {item.label}
              </Text>
              <Ionicons
                accessibilityElementsHidden
                color={tone}
                name={
                  item.status === 'recorded'
                    ? 'checkmark-circle'
                    : item.status === 'source-needed'
                      ? 'alert-circle'
                      : 'remove-circle-outline'
                }
                size={14}
              />
            </View>
          );
        })}
      </View>

      <Text style={[styles.note, { color: colors.textTertiary }]}>
        {sourceNeeded
          ? 'Amber items need one source selected before totals can be trusted.'
          : 'A blank item means no record was received. It does not mean zero.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  count: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  items: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 12,
  },
  item: {
    minHeight: 32,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  itemLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
  },
  note: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 10,
  },
});
