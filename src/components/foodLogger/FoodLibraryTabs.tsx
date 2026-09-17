import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatRegionalNumber } from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';
import type { FoodLibraryCounts, FoodLibraryTab } from './libraryPresentation';

const tabs: { value: FoodLibraryTab; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'favourites', label: 'Favourites' },
  { value: 'my-foods', label: 'My Foods' },
  { value: 'meals', label: 'Meals' },
  { value: 'recipes', label: 'Recipes' },
];

export function FoodLibraryTabs({
  counts,
  onChange,
  value,
  foodsOnly = false,
  showHeading = true,
}: {
  counts?: FoodLibraryCounts;
  onChange(value: FoodLibraryTab): void;
  value: FoodLibraryTab;
  foodsOnly?: boolean;
  showHeading?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Partial<Record<FoodLibraryTab, number>>>({});
  useEffect(() => {
    const x = positions.current[value];
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - 16), animated: false });
  }, [value]);
  return (
    <View accessibilityLabel="Saved food sections" style={styles.wrapper}>
      {showHeading ? <Text style={[styles.heading, { color: colors.text }]}>Your food library</Text> : null}
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.tabs}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {tabs.filter(tab => !foodsOnly || (tab.value !== 'meals' && tab.value !== 'recipes')).map((tab) => {
          const selected = value === tab.value;
          const count = counts?.[tab.value];
          const countLabel = formatRegionalNumber(count ?? 0, regional.locale, {
            maximumFractionDigits: 0,
          });
          return (
            <Pressable
              accessibilityLabel={count === undefined ? tab.label : `${tab.label}, ${countLabel} ${count === 1 ? 'item' : 'items'}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={tab.value}
              onLayout={event => {
                positions.current[tab.value] = event.nativeEvent.layout.x;
                if (selected) scroll.current?.scrollTo({ x: Math.max(0, event.nativeEvent.layout.x - 16), animated: false });
              }}
              onPress={() => onChange(tab.value)}
              style={({ pressed }) => [
                styles.tab,
                {
                  backgroundColor: selected ? colors.primary : colors.surfaceMuted,
                  borderColor: selected ? colors.primary : colors.border,
                  borderRadius: radius.pill,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  { color: selected ? colors.onPrimary : colors.textSecondary },
                ]}
              >
                {tab.label}
              </Text>
              {count !== undefined && count > 0 ? (
                <View
                  style={[
                    styles.count,
                    {
                      backgroundColor: selected
                        ? `${colors.onPrimary}24`
                        : colors.surface,
                      borderRadius: radius.pill,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.countLabel,
                      { color: selected ? colors.onPrimary : colors.textTertiary },
                    ]}
                  >
                    {count > 99
                      ? `${formatRegionalNumber(99, regional.locale, { maximumFractionDigits: 0 })}+`
                      : countLabel}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 10,
  },
  heading: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  tabs: {
    gap: 8,
    paddingRight: 16,
  },
  tab: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  count: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  countLabel: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    textAlign: 'center',
  },
});
