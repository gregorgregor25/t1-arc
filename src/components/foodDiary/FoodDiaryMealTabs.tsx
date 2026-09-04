import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatFoodNumber } from '@/data/food/foodNumberFormat';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';
import type {
  FoodDiaryMealFilter,
  FoodDiaryMealSummary,
} from './presentation';

const tabs: { value: FoodDiaryMealFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snacks' },
];

export function FoodDiaryMealTabs({
  mealCount,
  onChange,
  summary,
  value,
}: {
  mealCount: number;
  onChange(value: FoodDiaryMealFilter): void;
  summary: FoodDiaryMealSummary;
  value: FoodDiaryMealFilter;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  return (
    <View style={styles.wrapper}>
      <ScrollView
        contentContainerStyle={styles.tabs}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {tabs.map((tab) => {
          const selected = tab.value === value;
          const slot = tab.value === 'all' ? undefined : summary[tab.value];
          const count = slot?.count ?? mealCount;
          const countLabel = formatRegionalNumber(count, regional.locale, {
            maximumFractionDigits: 0,
          });
          const carbs = slot?.carbohydrateGrams;
          const detail =
            tab.value === 'all'
              ? `${countLabel} ${count === 1 ? 'meal' : 'meals'}`
              : count === 0
                ? 'No entries'
                : carbs === undefined
                  ? `${countLabel} ${count === 1 ? 'meal' : 'meals'}`
                  : `${formatFoodNumber(carbs)} g carbs${slot?.hasUnknownCarbohydrate ? ' known' : ''}`;
          return (
            <Pressable
              accessibilityLabel={`${tab.label}, ${detail}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={tab.value}
              onPress={() => onChange(tab.value)}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: selected ? `${colors.accent}18` : colors.surface,
                  borderColor: selected ? colors.accent : colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.66 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { color: selected ? colors.accent : colors.text },
                ]}
              >
                {tab.label}
              </Text>
              <Text style={[styles.detail, { color: colors.textTertiary }]}>
                {detail}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 16,
  },
  tabs: {
    gap: 9,
    paddingRight: 10,
  },
  tab: {
    borderWidth: StyleSheet.hairlineWidth,
    gap: 3,
    minHeight: 64,
    minWidth: 112,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
  },
  detail: {
    fontSize: 11,
    fontWeight: '600',
  },
});
