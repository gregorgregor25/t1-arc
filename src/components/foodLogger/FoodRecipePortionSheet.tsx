import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { recipeNutritionPerServing } from '@/data/food/recipes';
import { scaleNutrition, nutritionCompleteness } from '@/data/food/nutrition';
import type { FoodRecipe } from '@/data/food/types';
import { formatRegionalNumberInput, normalizeRegionalNumberInput } from '@/domain/regionalNumberInput';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';
import { presentFoodNutrition } from './presentation';

/** A recipe is a batch in the library, but a chosen number of servings in a meal. */
export function FoodRecipePortionSheet({ recipe, onAdd, onClose }: {
  recipe: FoodRecipe;
  onAdd(servings: number): void;
  onClose(): void;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults } = useRegionalProfile();
  const [amount, setAmount] = useState('1');
  const count = normalizeRegionalNumberInput(amount, defaults.locale)?.value;
  const valid = count !== undefined && count > 0 && count <= 100;
  const nutrition = valid ? presentFoodNutrition(scaleNutrition(recipeNutritionPerServing(recipe), count)) : undefined;
  const partial = Object.values(nutritionCompleteness(recipe.ingredients)).some(value => value === 'partial');
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <SafeAreaView style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
          <View style={[styles.sheet, { backgroundColor: colors.surface, borderRadius: radius.lg }]}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{recipe.name}</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>How much are you having?</Text>
              <Text style={[styles.label, { color: colors.text }]}>Servings</Text>
              <TextInput accessibilityLabel="Recipe servings to add" keyboardType="decimal-pad" value={amount} onChangeText={setAmount}
                style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md }]} />
              <View style={styles.choices}>
                {[0.5, 1, 2].map(value => (
                  <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} recipe servings`} accessibilityState={{ selected: count === value }}
                    onPress={() => setAmount(formatRegionalNumberInput(value, defaults.locale, 2))}
                    style={[styles.choice, { backgroundColor: count === value ? colors.primary : colors.surfaceMuted, borderRadius: radius.pill }]}>
                    <Text style={[styles.label, { color: count === value ? colors.onPrimary : colors.text }]}>{formatRegionalNumberInput(value, defaults.locale, 2)}</Text>
                  </Pressable>
                ))}
              </View>
              {nutrition ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>{nutrition.carbs}{nutrition.calories ? ` · ${nutrition.calories}` : ''}</Text> :
                <Text style={[styles.body, { color: colors.textSecondary }]}>Enter an amount greater than 0 and up to 100.</Text>}
              <Text style={[styles.body, { color: colors.textSecondary }]}>The saved recipe stays unchanged.</Text>
              {partial ? <Text style={[styles.body, { color: colors.textSecondary }]}>Some nutrition totals are partial because an ingredient has not reported every nutrient.</Text> : null}
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !valid }} disabled={!valid} onPress={() => { if (valid) onAdd(count); }}
                style={[styles.action, { backgroundColor: colors.primary, borderRadius: radius.md, opacity: valid ? 1 : 0.45 }]}>
                <Text style={[styles.label, { color: colors.onPrimary }]}>Add to meal</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.action}><Text style={[styles.label, { color: colors.textSecondary }]}>Cancel</Text></Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  keyboard: { width: '100%', maxHeight: '95%' },
  sheet: { margin: 12, overflow: 'hidden' },
  content: { padding: 22, gap: 14 },
  title: { fontSize: 23, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 22 },
  label: { fontSize: 16, fontWeight: '700' },
  input: { borderWidth: 1, minHeight: 52, paddingHorizontal: 16, fontSize: 21 },
  choices: { flexDirection: 'row', gap: 10 },
  choice: { minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center', padding: 12 },
  action: { minHeight: 50, padding: 14, alignItems: 'center', justifyContent: 'center' },
});
