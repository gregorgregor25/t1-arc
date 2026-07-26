import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  BarcodeScanningResult,
  CameraView,
  useCameraPermissions,
} from 'expo-camera';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  COFID_CATALOG_INFO,
  searchCofidFoods,
} from '@/data/food/cofidCatalog';
import {
  getFavoriteFoods,
  getRecentFoods,
} from '@/data/food/foodLogRepository';
import {
  FoodLookupError,
  lookupOpenFoodFactsBarcode,
} from '@/data/food/openFoodFacts';
import { totalNutrition } from '@/data/food/nutrition';
import {
  FoodCandidate,
  FoodLogItemDraft,
} from '@/data/food/types';
import {
  formatDate,
  formatTime,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

interface SelectedFood {
  food: FoodCandidate;
  amount: string;
}

const mealTypes: Array<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

function suggestedMealType(timestamp: number): MealType {
  const hour = Number(formatTime(timestamp).slice(0, 2));
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

function amountNumber(value: string) {
  const amount = Number(value.trim().replace(',', '.'));
  return Number.isFinite(amount) ? amount : undefined;
}

function displayNumber(value: number | undefined, suffix: string) {
  if (value === undefined) return 'Not reported';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('en-GB', {
    maximumFractionDigits: 1,
  })}${suffix}`;
}

function uniqueFoods(foods: FoodCandidate[]) {
  const seen = new Set<string>();
  return foods.filter((food) => {
    if (seen.has(food.id)) return false;
    seen.add(food.id);
    return true;
  });
}

export function FoodLoggerCard({
  initialTimestamp,
}: {
  initialTimestamp: number;
}) {
  const { colors, radius } = useAppTheme();
  const { logFood } = useDataContext();
  const [cameraPermission, requestCameraPermission] =
    useCameraPermissions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [timestamp, setTimestamp] = useState(initialTimestamp);
  const [mealType, setMealType] = useState<MealType>(
    suggestedMealType(initialTimestamp),
  );
  const [selected, setSelected] = useState<SelectedFood[]>([]);
  const [suggestions, setSuggestions] = useState<FoodCandidate[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [torch, setTorch] = useState(false);
  const [barcodeEntryOpen, setBarcodeEntryOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [barcodeLookingUp, setBarcodeLookingUp] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState<string>();

  const searchResults = useMemo(
    () => (query.trim().length >= 2 ? searchCofidFoods(query, 24) : []),
    [query],
  );
  const visibleResults = query.trim().length >= 2
    ? searchResults
    : suggestions;

  const draftItems = useMemo(
    () =>
      selected.flatMap((item): FoodLogItemDraft[] => {
        const amount = amountNumber(item.amount);
        return amount && amount > 0
          ? [{ food: item.food, amount, unit: item.food.basisUnit }]
          : [];
      }),
    [selected],
  );
  const nutrition = useMemo(() => {
    try {
      return totalNutrition(draftItems);
    } catch {
      return {};
    }
  }, [draftItems]);

  async function begin() {
    setTimestamp(initialTimestamp);
    setMealType(suggestedMealType(initialTimestamp));
    setError(undefined);
    setOpen(true);
    setLoadingSuggestions(true);
    try {
      const [favorites, recent] = await Promise.all([
        getFavoriteFoods(8),
        getRecentFoods(12),
      ]);
      setSuggestions(uniqueFoods([...favorites, ...recent]));
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  function addFood(food: FoodCandidate) {
    if (food.nutritionPerBasis.carbohydrateGrams === undefined) {
      setError(
        `${food.name} has no carbohydrate value in CoFID. Use the carb-only form instead.`,
      );
      return;
    }
    setError(undefined);
    setSelected((items) => {
      if (items.some((item) => item.food.id === food.id)) return items;
      return [
        ...items,
        {
          food,
          amount: String(food.defaultServingAmount ?? food.basisAmount),
        },
      ];
    });
    setQuery('');
  }

  function updateAmount(foodId: string, amount: string) {
    setSelected((items) =>
      items.map((item) =>
        item.food.id === foodId ? { ...item, amount } : item,
      ),
    );
  }

  function removeFood(foodId: string) {
    setSelected((items) =>
      items.filter((item) => item.food.id !== foodId),
    );
  }

  async function beginScan() {
    setError(undefined);
    setBarcodeMessage(undefined);
    let granted = cameraPermission?.granted ?? false;
    if (!granted) {
      const result = await requestCameraPermission();
      granted = result.granted;
    }
    if (!granted) {
      setError(
        'Camera access is needed only to read the barcode. You can enter the number instead.',
      );
      setBarcodeEntryOpen(true);
      return;
    }
    setTorch(false);
    setScannerOpen(true);
  }

  async function resolveBarcode(value: string) {
    if (barcodeLookingUp) return;
    setScannerOpen(false);
    setBarcodeLookingUp(true);
    setBarcodeMessage(undefined);
    setError(undefined);
    try {
      const food = await lookupOpenFoodFactsBarcode(value);
      addFood(food);
      setBarcode('');
      setBarcodeEntryOpen(false);
      setBarcodeMessage(
        `${food.name}${food.brand ? ` · ${food.brand}` : ''} found.`,
      );
    } catch (lookupError) {
      setError(
        lookupError instanceof FoodLookupError
          ? lookupError.message
          : 'The barcode could not be looked up.',
      );
      setBarcodeEntryOpen(true);
      setBarcode(value.replace(/\D/g, ''));
    } finally {
      setBarcodeLookingUp(false);
    }
  }

  function barcodeScanned(result: BarcodeScanningResult) {
    if (barcodeLookingUp) return;
    void resolveBarcode(result.data);
  }

  function chooseDate() {
    DateTimePickerAndroid.open({
      value: new Date(timestamp),
      mode: 'date',
      maximumDate: new Date(),
      onChange: (event, value) => {
        if (event.type !== 'set' || !value) return;
        const date = [
          value.getFullYear(),
          String(value.getMonth() + 1).padStart(2, '0'),
          String(value.getDate()).padStart(2, '0'),
        ].join('-') as `${number}-${number}-${number}`;
        const [hour = 0, minute = 0] = formatTime(timestamp)
          .split(':')
          .map(Number);
        setTimestamp(zonedDateTimeToTimestamp(date, hour, minute));
      },
    });
  }

  function chooseTime() {
    DateTimePickerAndroid.open({
      value: new Date(timestamp),
      mode: 'time',
      is24Hour: true,
      onChange: (event, value) => {
        if (event.type !== 'set' || !value) return;
        setTimestamp(
          zonedDateTimeToTimestamp(
            toDateKey(timestamp),
            value.getHours(),
            value.getMinutes(),
          ),
        );
      },
    });
  }

  async function save() {
    setError(undefined);
    if (!selected.length) {
      setError('Add at least one food.');
      return;
    }
    if (draftItems.length !== selected.length) {
      setError('Check each food amount.');
      return;
    }
    setSaving(true);
    try {
      const log = await logFood({
        timestamp,
        mealType,
        items: draftItems,
      });
      setSavedMessage(
        `${log.title} · ${displayNumber(
          log.nutrition.carbohydrateGrams,
          ' g carbs',
        )}`,
      );
      setSelected([]);
      setQuery('');
      setOpen(false);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'The food log could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionCard style={styles.card}>
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.cardIcon,
              {
                backgroundColor: `${colors.accent}18`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name="restaurant-outline"
              size={25}
            />
          </View>
          <View style={styles.cardCopy}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Log food
            </Text>
            <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
              Search {COFID_CATALOG_INFO.foodCount.toLocaleString('en-GB')}{' '}
              official UK foods offline. Reuse recent foods without searching
              again.
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void begin()}
          style={({ pressed }) => [
            styles.openButton,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.md,
              opacity: pressed ? 0.76 : 1,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.onPrimary}
            name="add"
            size={21}
          />
          <Text style={[styles.openButtonText, { color: colors.onPrimary }]}>
            Add food
          </Text>
        </Pressable>
        {savedMessage ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.saved,
              {
                backgroundColor: `${colors.accent}12`,
                borderColor: `${colors.accent}55`,
                borderRadius: radius.sm,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name="checkmark-circle-outline"
              size={18}
            />
            <Text style={[styles.savedText, { color: colors.textSecondary }]}>
              {savedMessage}
            </Text>
          </View>
        ) : null}
      </SectionCard>

      <Modal
        animationType="slide"
        onRequestClose={() => !saving && setOpen(false)}
        presentationStyle="pageSheet"
        statusBarTranslucent
        visible={open}
      >
        <SafeAreaView
          edges={['top', 'bottom']}
          style={[styles.modal, { backgroundColor: colors.background }]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modal}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: colors.divider },
              ]}
            >
              <View>
                <Text style={[styles.eyebrow, { color: colors.primary }]}>
                  PRIVATE · OFFLINE SEARCH
                </Text>
                <Text
                  accessibilityRole="header"
                  style={[styles.modalTitle, { color: colors.text }]}
                >
                  Log food
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close food logger"
                accessibilityRole="button"
                disabled={saving}
                onPress={() => setOpen(false)}
                style={({ pressed }) => [
                  styles.close,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.pill,
                    opacity: pressed ? 0.65 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.text}
                  name="close"
                  size={23}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View
                style={[
                  styles.search,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="search"
                  size={21}
                />
                <TextInput
                  accessibilityLabel="Search UK food database"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setQuery(value);
                    setError(undefined);
                  }}
                  placeholder="Search food, e.g. porridge or banana"
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="search"
                  selectionColor={colors.primary}
                  style={[styles.searchInput, { color: colors.text }]}
                  value={query}
                />
                {query ? (
                  <Pressable
                    accessibilityLabel="Clear food search"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setQuery('')}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.textSecondary}
                      name="close-circle"
                      size={21}
                    />
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.barcodeActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={barcodeLookingUp}
                  onPress={() => void beginScan()}
                  style={({ pressed }) => [
                    styles.barcodeButton,
                    {
                      backgroundColor: `${colors.primary}14`,
                      borderColor: `${colors.primary}66`,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {barcodeLookingUp ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name="barcode-outline"
                      size={20}
                    />
                  )}
                  <Text
                    style={[
                      styles.barcodeButtonText,
                      { color: colors.primaryStrong },
                    ]}
                  >
                    {barcodeLookingUp ? 'Looking up…' : 'Scan barcode'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setBarcodeEntryOpen((value) => !value)}
                  style={({ pressed }) => [
                    styles.barcodeButton,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.textSecondary}
                    name="keypad-outline"
                    size={19}
                  />
                  <Text
                    style={[
                      styles.barcodeButtonText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Enter number
                  </Text>
                </Pressable>
              </View>

              {barcodeEntryOpen ? (
                <View
                  style={[
                    styles.barcodeEntry,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <TextInput
                    accessibilityLabel="Food barcode number"
                    keyboardType="number-pad"
                    maxLength={14}
                    onChangeText={(value) =>
                      setBarcode(value.replace(/\D/g, ''))
                    }
                    placeholder="EAN or UPC number"
                    placeholderTextColor={colors.textTertiary}
                    returnKeyType="done"
                    selectionColor={colors.primary}
                    style={[styles.barcodeInput, { color: colors.text }]}
                    value={barcode}
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={barcodeLookingUp || !barcode}
                    onPress={() => void resolveBarcode(barcode)}
                    style={({ pressed }) => [
                      styles.lookupButton,
                      {
                        backgroundColor:
                          barcodeLookingUp || !barcode
                            ? colors.surface
                            : colors.primary,
                        borderRadius: radius.sm,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.lookupText,
                        {
                          color:
                            barcodeLookingUp || !barcode
                              ? colors.textTertiary
                              : colors.onPrimary,
                        },
                      ]}
                    >
                      Look up
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {barcodeMessage ? (
                <View
                  style={[
                    styles.barcodeNotice,
                    {
                      backgroundColor: `${colors.accent}12`,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="checkmark-circle-outline"
                    size={18}
                  />
                  <Text
                    style={[
                      styles.barcodeNoticeText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {barcodeMessage}
                  </Text>
                </View>
              ) : null}

              <View style={styles.mealRow}>
                {mealTypes.map((option) => {
                  const active = option.value === mealType;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      key={option.value}
                      onPress={() => setMealType(option.value)}
                      style={({ pressed }) => [
                        styles.mealChip,
                        {
                          backgroundColor: active
                            ? `${colors.primary}18`
                            : colors.surfaceMuted,
                          borderColor: active
                            ? colors.primary
                            : colors.border,
                          borderRadius: radius.pill,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.mealChipText,
                          {
                            color: active
                              ? colors.primaryStrong
                              : colors.textSecondary,
                          },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.dateRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={chooseDate}
                  style={({ pressed }) => [
                    styles.dateButton,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="calendar-outline"
                    size={18}
                  />
                  <Text style={[styles.dateText, { color: colors.text }]}>
                    {formatDate(toDateKey(timestamp), {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={chooseTime}
                  style={({ pressed }) => [
                    styles.dateButton,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="time-outline"
                    size={18}
                  />
                  <Text style={[styles.dateText, { color: colors.text }]}>
                    {formatTime(timestamp)}
                  </Text>
                </Pressable>
                <Text style={[styles.zone, { color: colors.textTertiary }]}>
                  London
                </Text>
              </View>

              {selected.length ? (
                <View style={styles.selectedBlock}>
                  <View style={styles.sectionHeading}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      This meal
                    </Text>
                    <Text
                      style={[styles.totalCarbs, { color: colors.primaryStrong }]}
                    >
                      {displayNumber(
                        nutrition.carbohydrateGrams,
                        ' g carbs',
                      )}
                    </Text>
                  </View>
                  {selected.map((item) => {
                    const amount = amountNumber(item.amount);
                    const itemNutrition =
                      amount && amount > 0
                        ? totalNutrition([
                            {
                              food: item.food,
                              amount,
                              unit: item.food.basisUnit,
                            },
                          ])
                        : {};
                    return (
                      <View
                        key={item.food.id}
                        style={[
                          styles.selectedFood,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                            borderRadius: radius.md,
                          },
                        ]}
                      >
                        <View style={styles.selectedCopy}>
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.selectedName,
                              { color: colors.text },
                            ]}
                          >
                            {item.food.name}
                          </Text>
                          <Text
                            style={[
                              styles.selectedMeta,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {displayNumber(
                              itemNutrition.carbohydrateGrams,
                              ' g carbs',
                            )}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.amountShell,
                            {
                              backgroundColor: colors.surfaceMuted,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                            },
                          ]}
                        >
                          <TextInput
                            accessibilityLabel={`Amount of ${item.food.name}`}
                            keyboardType="decimal-pad"
                            onChangeText={(value) =>
                              updateAmount(item.food.id, value)
                            }
                            selectTextOnFocus
                            selectionColor={colors.primary}
                            style={[styles.amountInput, { color: colors.text }]}
                            value={item.amount}
                          />
                          <Text
                            style={[
                              styles.amountUnit,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {item.food.basisUnit}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityLabel={`Remove ${item.food.name}`}
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => removeFood(item.food.id)}
                          style={styles.remove}
                        >
                          <Ionicons
                            accessibilityElementsHidden
                            color={colors.textTertiary}
                            name="trash-outline"
                            size={20}
                          />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.resultsBlock}>
                <View style={styles.sectionHeading}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {query.trim().length >= 2
                      ? 'Search results'
                      : suggestions.length
                        ? 'Recent and favourite'
                        : 'Find a food'}
                  </Text>
                  {loadingSuggestions ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : null}
                </View>
                {query.trim().length === 1 ? (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    Type one more character to search.
                  </Text>
                ) : null}
                {!loadingSuggestions &&
                query.trim().length >= 2 &&
                !visibleResults.length ? (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    No official UK food matched. You can still use the existing
                    carb-only entry form.
                  </Text>
                ) : null}
                {visibleResults.map((food) => {
                  const alreadyAdded = selected.some(
                    (item) => item.food.id === food.id,
                  );
                  const carbs =
                    food.nutritionPerBasis.carbohydrateGrams;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: alreadyAdded }}
                      disabled={alreadyAdded}
                      key={food.id}
                      onPress={() => addFood(food)}
                      style={({ pressed }) => [
                        styles.result,
                        {
                          borderBottomColor: colors.divider,
                          opacity: alreadyAdded ? 0.5 : pressed ? 0.68 : 1,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.resultIcon,
                          {
                            backgroundColor: `${colors.primary}12`,
                            borderRadius: radius.sm,
                          },
                        ]}
                      >
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.primary}
                          name="nutrition-outline"
                          size={19}
                        />
                      </View>
                      <View style={styles.resultCopy}>
                        <Text
                          numberOfLines={2}
                          style={[styles.resultName, { color: colors.text }]}
                        >
                          {food.name}
                        </Text>
                        <Text
                          style={[
                            styles.resultMeta,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {displayNumber(carbs, ' g carbs')} per 100
                          {food.basisUnit}
                        </Text>
                      </View>
                      <Ionicons
                        accessibilityElementsHidden
                        color={
                          alreadyAdded ? colors.accent : colors.textTertiary
                        }
                        name={
                          alreadyAdded
                            ? 'checkmark-circle'
                            : 'add-circle-outline'
                        }
                        size={23}
                      />
                    </Pressable>
                  );
                })}
              </View>

              {error ? (
                <View
                  accessibilityLiveRegion="assertive"
                  style={[
                    styles.error,
                    {
                      backgroundColor: `${colors.danger}12`,
                      borderColor: `${colors.danger}55`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.danger}
                    name="alert-circle-outline"
                    size={19}
                  />
                  <Text style={[styles.errorText, { color: colors.danger }]}>
                    {error}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.attribution, { color: colors.textTertiary }]}>
                Nutrients are per 100 g or 100 ml from{' '}
                {COFID_CATALOG_INFO.dataset}. Values are reference estimates,
                not dosing advice. Barcode searches send only the scanned
                product number to Open Food Facts; no glucose, insulin or
                identity data is sent.
              </Text>
            </ScrollView>

            <View
              style={[
                styles.footer,
                {
                  backgroundColor: colors.background,
                  borderTopColor: colors.divider,
                },
              ]}
            >
              <View style={styles.footerSummary}>
                <Text style={[styles.footerLabel, { color: colors.textSecondary }]}>
                  {selected.length
                    ? `${selected.length} ${selected.length === 1 ? 'food' : 'foods'}`
                    : 'No foods yet'}
                </Text>
                <Text style={[styles.footerCarbs, { color: colors.text }]}>
                  {displayNumber(nutrition.carbohydrateGrams, ' g carbs')}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={saving || !selected.length}
                onPress={() => void save()}
                style={({ pressed }) => [
                  styles.save,
                  {
                    backgroundColor:
                      saving || !selected.length
                        ? colors.surfaceMuted
                        : colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.74 : 1,
                  },
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Ionicons
                    accessibilityElementsHidden
                    color={
                      selected.length
                        ? colors.onPrimary
                        : colors.textTertiary
                    }
                    name="checkmark"
                    size={20}
                  />
                )}
                <Text
                  style={[
                    styles.saveText,
                    {
                      color: selected.length
                        ? colors.onPrimary
                        : colors.textTertiary,
                    },
                  ]}
                >
                  {saving ? 'Saving locally…' : 'Save meal'}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setScannerOpen(false)}
        statusBarTranslucent
        visible={scannerOpen}
      >
        <View style={styles.scanner}>
          <CameraView
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'],
            }}
            enableTorch={torch}
            facing="back"
            onBarcodeScanned={
              scannerOpen && !barcodeLookingUp ? barcodeScanned : undefined
            }
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView
            edges={['top', 'bottom']}
            style={styles.scannerOverlay}
          >
            <View style={styles.scannerTop}>
              <Pressable
                accessibilityLabel="Close barcode scanner"
                accessibilityRole="button"
                onPress={() => setScannerOpen(false)}
                style={({ pressed }) => [
                  styles.scannerControl,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color="#FFFFFF"
                  name="close"
                  size={25}
                />
              </Pressable>
              <Pressable
                accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'}
                accessibilityRole="button"
                onPress={() => setTorch((value) => !value)}
                style={({ pressed }) => [
                  styles.scannerControl,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color="#FFFFFF"
                  name={torch ? 'flash' : 'flash-outline'}
                  size={23}
                />
              </Pressable>
            </View>

            <View style={styles.scannerCentre}>
              <View style={styles.scanFrame}>
                <View style={[styles.scanCorner, styles.scanTopLeft]} />
                <View style={[styles.scanCorner, styles.scanTopRight]} />
                <View style={[styles.scanCorner, styles.scanBottomLeft]} />
                <View style={[styles.scanCorner, styles.scanBottomRight]} />
              </View>
            </View>

            <View style={styles.scannerCopy}>
              <Text style={styles.scannerTitle}>Point at the food barcode</Text>
              <Text style={styles.scannerBody}>
                The camera image stays on this phone. Only the barcode number
                is looked up.
              </Text>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
  },
  cardIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCopy: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  openButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  openButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  saved: {
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savedText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  modal: {
    flex: 1,
  },
  modalHeader: {
    minHeight: 74,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.05,
  },
  modalTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 32,
    gap: 16,
  },
  search: {
    minHeight: 54,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    minHeight: 52,
    flex: 1,
    fontSize: 15,
  },
  barcodeActions: {
    flexDirection: 'row',
    gap: 8,
  },
  barcodeButton: {
    minHeight: 48,
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  barcodeButtonText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  barcodeEntry: {
    minHeight: 54,
    borderWidth: 1,
    padding: 5,
    paddingLeft: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barcodeInput: {
    minHeight: 46,
    flex: 1,
    fontSize: 15,
    letterSpacing: 0.5,
  },
  lookupButton: {
    minWidth: 86,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookupText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  barcodeNotice: {
    minHeight: 40,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  barcodeNoticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  mealRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  mealChip: {
    minHeight: 42,
    flexGrow: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealChipText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateButton: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  dateText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  zone: {
    fontSize: 10,
    lineHeight: 15,
  },
  selectedBlock: {
    gap: 8,
  },
  sectionHeading: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  totalCarbs: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  selectedFood: {
    minHeight: 72,
    borderWidth: 1,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  selectedCopy: {
    flex: 1,
    minWidth: 0,
  },
  selectedName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  selectedMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  amountShell: {
    width: 82,
    minHeight: 44,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  amountInput: {
    minHeight: 42,
    flex: 1,
    paddingLeft: 9,
    fontSize: 14,
    textAlign: 'right',
  },
  amountUnit: {
    paddingHorizontal: 7,
    fontSize: 11,
    fontWeight: '700',
  },
  remove: {
    width: 42,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsBlock: {
    gap: 2,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 12,
  },
  result: {
    minHeight: 66,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  resultIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  resultMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  error: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  attribution: {
    fontSize: 10,
    lineHeight: 16,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footerSummary: {
    flex: 1,
    minWidth: 0,
  },
  footerLabel: {
    fontSize: 11,
    lineHeight: 16,
  },
  footerCarbs: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  save: {
    minWidth: 150,
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  saveText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  scanner: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  scannerTop: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scannerControl: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerCentre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  scanFrame: {
    width: '100%',
    maxWidth: 390,
    aspectRatio: 1.55,
    position: 'relative',
  },
  scanCorner: {
    width: 42,
    height: 42,
    position: 'absolute',
    borderColor: '#67D5E8',
  },
  scanTopLeft: {
    left: 0,
    top: 0,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderTopLeftRadius: 14,
  },
  scanTopRight: {
    right: 0,
    top: 0,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderTopRightRadius: 14,
  },
  scanBottomLeft: {
    left: 0,
    bottom: 0,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    borderBottomLeftRadius: 14,
  },
  scanBottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderBottomRightRadius: 14,
  },
  scannerCopy: {
    paddingHorizontal: 28,
    paddingBottom: 30,
    alignItems: 'center',
  },
  scannerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  scannerBody: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
});
