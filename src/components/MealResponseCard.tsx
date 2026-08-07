import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  buildMealResponseEvidence,
  EvidenceReference,
  observedMealWindows,
} from '@/domain/insights';
import { MealEvent, TimelineData } from '@/domain/models';
import { formatTime } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function signed(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

export function MealResponseCard({
  data,
  onInspect,
}: {
  data: TimelineData;
  onInspect(evidence: EvidenceReference): void;
}) {
  const { colors, radius } = useAppTheme();
  const meals = data.context.filter(
    (event): event is MealEvent => event.kind === 'meal',
  );
  if (!meals.length) return null;

  const responses = observedMealWindows(data).sort(
    (a, b) => b.meal.start - a.meal.start,
  );
  const completeMealIds = new Set(
    responses.map((response) => response.meal.id),
  );
  const visibleResponses = responses.slice(0, 4);

  return (
    <SectionCard
      accessibilityLabel={`${responses.length} of ${meals.length} logged meals have enough glucose data for an observed response.`}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            FOOD + GLUCOSE
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Meal responses
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            What glucose did after each logged meal.
          </Text>
        </View>
        <View
          style={[
            styles.coveragePill,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Text style={[styles.coverageValue, { color: colors.text }]}>
            {completeMealIds.size}/{meals.length}
          </Text>
          <Text style={[styles.coverageLabel, { color: colors.textTertiary }]}>
            COMPLETE
          </Text>
        </View>
      </View>

      {visibleResponses.length ? (
        <View style={styles.rows}>
          {visibleResponses.map((response) => {
            const evidence = buildMealResponseEvidence(response, data);
            const minutesToPeak = Math.max(
              0,
              Math.round(
                (response.peak.timestamp - response.meal.start) / 60_000,
              ),
            );
            return (
              <Pressable
                accessibilityLabel={`Inspect ${response.meal.title} response. Observed glucose change ${signed(response.riseMmolL)} millimoles per litre, reaching ${response.peak.mmolL.toFixed(1)}.`}
                accessibilityRole="button"
                key={response.meal.id}
                onPress={() => onInspect(evidence)}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: `${colors.accent}18`,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="restaurant-outline"
                    size={19}
                  />
                </View>
                <View style={styles.copy}>
                  <View style={styles.mealLine}>
                    <Text
                      numberOfLines={1}
                      style={[styles.mealTitle, { color: colors.text }]}
                    >
                      {response.meal.title}
                    </Text>
                    <Text
                      style={[
                        styles.rise,
                        {
                          color:
                            response.riseMmolL > 3
                              ? colors.high
                              : colors.primary,
                        },
                      ]}
                    >
                      {signed(response.riseMmolL)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.mealMeta, { color: colors.textSecondary }]}
                  >
                    {formatTime(response.meal.start)} ·{' '}
                    {Math.round(response.meal.carbsGrams)} g carbs
                  </Text>
                  <View style={styles.responseLine}>
                    <Text
                      style={[styles.responseValue, { color: colors.text }]}
                    >
                      {response.baseline.mmolL.toFixed(1)}
                      <Text style={{ color: colors.textTertiary }}> → </Text>
                      {response.peak.mmolL.toFixed(1)} mmol/L
                    </Text>
                    <Text
                      style={[
                        styles.peakTime,
                        { color: colors.textTertiary },
                      ]}
                    >
                      peak +{minutesToPeak} min
                    </Text>
                  </View>
                </View>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View
          style={[
            styles.empty,
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
            name="hourglass-outline"
            size={21}
          />
          <View style={styles.emptyCopy}>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              Waiting for enough glucose coverage
            </Text>
            <Text
              style={[styles.emptyText, { color: colors.textSecondary }]}
            >
              A meal needs a nearby start reading and at least two continuous
              hours without a long sensor gap.
            </Text>
          </View>
        </View>
      )}

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        This shows timing alongside logged food and insulin. It does not prove
        what caused a change and is never used to calculate a dose.
      </Text>
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
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  coveragePill: {
    minWidth: 62,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  coverageValue: {
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  coverageLabel: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '800',
    letterSpacing: 0.65,
  },
  rows: {
    gap: 8,
    marginTop: 14,
  },
  row: {
    minHeight: 94,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
  },
  mealLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  mealTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  rise: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  mealMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  responseLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 5,
  },
  responseValue: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  peakTime: {
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    marginTop: 14,
  },
  emptyCopy: {
    flex: 1,
  },
  emptyTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  footnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 12,
  },
});
