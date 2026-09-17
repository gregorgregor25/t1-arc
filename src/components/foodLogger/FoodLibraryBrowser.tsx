import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getFoodLibraryPage, getFoodRecipePage, getMealPresetPage } from '@/data/food/foodLogRepository';
import type { FoodCandidate, FoodMealPreset, FoodRecipe } from '@/data/food/types';
import { useAppTheme } from '@/theme/theme';
import { FoodLibraryTabs } from './FoodLibraryTabs';
import { foodLibraryEmptyMessage, type FoodLibraryTab } from './libraryPresentation';

type LibraryItem =
  | { kind: 'food'; value: FoodCandidate; isFavourite: boolean }
  | { kind: 'recipe'; value: FoodRecipe }
  | { kind: 'meal'; value: FoodMealPreset };
const PAGE_SIZE = 20;

/** Full-library queries are separate from the intentionally small quick-pick preview. */
export function FoodLibraryBrowser({ initialTab, foodsOnly, onFood, onRecipe, onMeal, onFoodOptions, onRecipeOptions, onMealOptions, onClose }: {
  initialTab: FoodLibraryTab;
  foodsOnly: boolean;
  onFood(food: FoodCandidate): void;
  onRecipe(recipe: FoodRecipe): void;
  onMeal(meal: FoodMealPreset): void;
  onFoodOptions(food: FoodCandidate, isFavourite: boolean): void;
  onRecipeOptions(recipe: FoodRecipe): void;
  onMealOptions(meal: FoodMealPreset): void;
  onClose(): void;
}) {
  const { colors, radius } = useAppTheme();
  const [tab, setTab] = useState<FoodLibraryTab>(foodsOnly && (initialTab === 'recipes' || initialTab === 'meals') ? 'recent' : initialTab);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(undefined);
      const options = { query: query.trim(), offset, limit: PAGE_SIZE };
      void Promise.all([
        tab === 'recent' || tab === 'favourites' || tab === 'my-foods'
          ? getFoodLibraryPage({ ...options, kind: tab }) : Promise.resolve(undefined),
        !foodsOnly && (tab === 'recipes' || tab === 'favourites')
          ? getFoodRecipePage({ ...options, favouritesOnly: tab === 'favourites' }) : Promise.resolve(undefined),
        !foodsOnly && (tab === 'meals' || tab === 'favourites')
          ? getMealPresetPage({ ...options, favouritesOnly: tab === 'favourites' }) : Promise.resolve(undefined),
      ]).then(([foods, recipes, meals]) => {
        if (!active || request !== generation.current) return;
        const page: LibraryItem[] = [
          ...(foods?.items ?? []).map(entry => ({ kind: 'food' as const, value: entry.food, isFavourite: entry.isFavourite })),
          ...(recipes?.items ?? []).map(value => ({ kind: 'recipe' as const, value })),
          ...(meals?.items ?? []).map(value => ({ kind: 'meal' as const, value })),
        ];
        setItems(previous => offset === 0 ? page : [...previous, ...page].filter((item, index, all) =>
          all.findIndex(other => other.kind === item.kind && other.value.id === item.value.id) === index));
        setHasMore(Boolean(foods?.hasMore || recipes?.hasMore || meals?.hasMore));
      }).catch(() => {
        if (active && request === generation.current) setError('Your saved library could not be loaded. Please try again.');
      }).finally(() => {
        if (active && request === generation.current) setLoading(false);
      });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [foodsOnly, offset, query, retry, tab]);

  function resetResults() {
    generation.current += 1;
    setItems([]);
    setOffset(0);
    setHasMore(false);
    setLoading(true);
    setError(undefined);
  }
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Saved foods</Text>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={[styles.label, { color: colors.primary }]}>Done</Text></Pressable>
        </View>
        <View style={styles.controls}>
          <TextInput accessibilityLabel="Search your saved food library" placeholder="Search saved foods" placeholderTextColor={colors.textTertiary} value={query}
            onChangeText={value => { resetResults(); setQuery(value); }} clearButtonMode="while-editing" returnKeyType="search"
            style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md }]} />
          <FoodLibraryTabs value={tab} foodsOnly={foodsOnly} showHeading={false} onChange={value => { if (value !== tab) { resetResults(); setTab(value); } }} />
        </View>
        <FlatList data={items} keyExtractor={item => `${item.kind}:${item.value.id}`} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => {
              if (item.kind === 'food') onFood(item.value);
              else if (item.kind === 'recipe') onRecipe(item.value);
              else onMeal(item.value);
            }} style={({ pressed }) => [styles.item, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, opacity: pressed ? 0.65 : 1 }]}>
              <View style={styles.itemHeading}>
              <Text style={[styles.name, { color: colors.text, flex: 1 }]}>{item.kind === 'meal' ? item.value.title : item.value.name}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${item.kind === 'meal' ? item.value.title : item.value.name}`} onPress={event => {
                event.stopPropagation();
                if (item.kind === 'food') onFoodOptions(item.value, item.isFavourite);
                else if (item.kind === 'recipe') onRecipeOptions(item.value);
                else onMealOptions(item.value);
              }} style={styles.button}><Text style={[styles.name, { color: colors.textSecondary }]}>⋯</Text></Pressable>
              </View>
              <Text style={[styles.detail, { color: colors.textSecondary }]}>{item.kind === 'food' ? [item.value.brand, item.value.personalServingLabel ?? item.value.servingLabel].filter(Boolean).join(' · ') || 'Saved food' : item.kind === 'recipe' ? 'Recipe · choose servings' : 'Saved meal'}</Text>
            </Pressable>
          )}
          ListEmptyComponent={!loading && !error ? <Text style={[styles.empty, { color: colors.textSecondary }]}>{query.trim() ? 'No saved items match that search.' : foodLibraryEmptyMessage(tab)}</Text> : null}
          ListFooterComponent={<View style={styles.footer}>
            {loading ? <ActivityIndicator accessibilityLabel="Loading saved foods" color={colors.primary} /> : null}
            {error ? <><Text accessibilityLiveRegion="polite" style={[styles.detail, { color: colors.textSecondary }]}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={styles.button}><Text style={[styles.label, { color: colors.primary }]}>Retry</Text></Pressable></> : null}
            {!loading && !error && hasMore ? <Pressable accessibilityRole="button" onPress={() => { setLoading(true); setOffset(value => value + PAGE_SIZE); }} style={styles.button}><Text style={[styles.label, { color: colors.primary }]}>Show more saved items</Text></Pressable> : null}
          </View>} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 24, fontWeight: '800', flex: 1 },
  label: { fontSize: 16, fontWeight: '700' },
  button: { minHeight: 48, padding: 12, justifyContent: 'center', alignItems: 'center' },
  controls: { paddingHorizontal: 20, paddingBottom: 12, gap: 16 },
  input: { borderWidth: 1, minHeight: 52, paddingHorizontal: 14, fontSize: 16 },
  list: { paddingHorizontal: 20, paddingBottom: 30, gap: 10 },
  item: { padding: 16, gap: 6, minHeight: 72, borderWidth: StyleSheet.hairlineWidth },
  itemHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 17, lineHeight: 24, fontWeight: '700' },
  detail: { fontSize: 14, lineHeight: 21 },
  empty: { paddingVertical: 28, fontSize: 16, lineHeight: 24 },
  footer: { padding: 16, gap: 12 },
});
