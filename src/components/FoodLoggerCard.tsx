import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import {
  BarcodeScanningResult,
  Camera,
  CameraView,
  useCameraPermissions,
} from 'expo-camera';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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
  deleteFoodRecipe,
  getCachedFoodByBarcode,
  getFoodRecipes,
  getFavoriteFoods,
  getRecentMealPresets,
  getRecentFoods,
  saveFoodRecipe,
  setFoodRecipeFavorite,
  setMealPresetFavorite,
  setFoodFavorite,
} from '@/data/food/foodLogRepository';
import {
  recipeNutritionPerServing,
  servingFromRecipe,
} from '@/data/food/recipes';
import { foodLogDraftFromLog } from '@/data/food/foodLogEditing';
import {
  FoodLookupError,
  lookupOpenFoodFactsBarcode,
  normaliseFoodBarcode,
  searchOpenFoodFactsProducts,
} from '@/data/food/openFoodFacts';
import { totalNutrition } from '@/data/food/nutrition';
import { createQuickCarbCandidate } from '@/data/food/quickCarb';
import {
  defaultFoodServingAmount,
  initialFoodPortionAmount,
} from '@/data/food/servings';
import {
  FoodCandidate,
  FoodLog,
  FoodLogItemDraft,
  FoodMealPreset,
  FoodRecipe,
} from '@/data/food/types';
import { createUserFoodCandidate } from '@/data/food/userFood';
import {
  formatDate,
  formatTime,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import {
  MealType,
  suggestedMealType,
} from '@/domain/mealTiming';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

interface SelectedFood {
  food: FoodCandidate;
  amount: string;
  count: string;
  portionAmount: string;
}

interface CustomFoodForm {
  name: string;
  brand: string;
  serving: string;
  unit: 'g' | 'ml';
  carbs: string;
  energy: string;
  protein: string;
  fat: string;
  fibre: string;
}

const emptyCustomFood: CustomFoodForm = {
  name: '',
  brand: '',
  serving: '100',
  unit: 'g',
  carbs: '',
  energy: '',
  protein: '',
  fat: '',
  fibre: '',
};

const mealTypes: Array<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

const COFID_FOOD_COUNT = 2_887;
const COFID_DATASET = "McCance and Widdowson's CoFID 2021";
type CofidSearch = typeof import('@/data/food/cofidCatalog').searchCofidFoods;

function amountNumber(value: string) {
  const amount = Number(value.trim().replace(',', '.'));
  return Number.isFinite(amount) ? amount : undefined;
}

function optionalNumber(value: string) {
  return value.trim() ? amountNumber(value) : undefined;
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

function inputNumber(value: number) {
  return String(Math.round(value * 100) / 100);
}

function selectedFoodState(food: FoodCandidate, amountValue?: number): SelectedFood {
  const amount = amountValue ?? initialFoodPortionAmount(food);
  const sourcePortion = food.servingLabel
    ? defaultFoodServingAmount(food)
    : undefined;
  return {
    food,
    amount: inputNumber(amount),
    count: sourcePortion ? inputNumber(amount / sourcePortion) : '',
    portionAmount: sourcePortion ? inputNumber(sourcePortion) : '',
  };
}

export function FoodLoggerCard({
  editingLog,
  initialTimestamp,
  launchRequest,
  onEditEnd,
  compact = false,
  showLauncher = true,
}: {
  editingLog?: FoodLog;
  initialTimestamp: number;
  launchRequest?: number;
  onEditEnd?(): void;
  compact?: boolean;
  showLauncher?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { logFood, updateFoodLog } = useDataContext();
  const [, requestCameraPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [timestamp, setTimestamp] = useState(initialTimestamp);
  const [mealType, setMealType] = useState<MealType>(
    suggestedMealType(initialTimestamp),
  );
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<SelectedFood[]>([]);
  const [suggestions, setSuggestions] = useState<FoodCandidate[]>([]);
  const [mealPresets, setMealPresets] = useState<FoodMealPreset[]>([]);
  const [recipes, setRecipes] = useState<FoodRecipe[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoriteBusy, setFavoriteBusy] = useState<string>();
  const [favoriteMealBusy, setFavoriteMealBusy] = useState<string>();
  const [cofidSearch, setCofidSearch] = useState<CofidSearch>();
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
  const [barcodeError, setBarcodeError] = useState<string>();
  const [cameraSettingsRequired, setCameraSettingsRequired] =
    useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFood, setCustomFood] =
    useState<CustomFoodForm>(emptyCustomFood);
  const [quickCarbOpen, setQuickCarbOpen] = useState(false);
  const [quickCarbs, setQuickCarbs] = useState('');
  const [quickCarbLabel, setQuickCarbLabel] = useState('');
  const [recipeSaveOpen, setRecipeSaveOpen] = useState(false);
  const [recipeName, setRecipeName] = useState('');
  const [recipeServings, setRecipeServings] = useState('4');
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeActionBusy, setRecipeActionBusy] = useState<string>();
  const [onlineResults, setOnlineResults] = useState<FoodCandidate[]>([]);
  const [onlineSearchQuery, setOnlineSearchQuery] = useState('');
  const [onlineSearching, setOnlineSearching] = useState(false);
  const [onlineMessage, setOnlineMessage] = useState<string>();
  const onlineCache = useRef(new Map<string, FoodCandidate[]>());
  const handledLaunchRequest = useRef(0);
  const barcodeLookupLock = useRef(false);

  const allCofidSearchResults = useMemo(
    () =>
      query.trim().length >= 2 && cofidSearch
        ? cofidSearch(query, COFID_FOOD_COUNT)
        : [],
    [cofidSearch, query],
  );
  const searchResults = allCofidSearchResults.slice(0, 24);
  const normalisedQuery = query.replace(/\s+/g, ' ').trim();
  const matchingOnlineResults =
    normalisedQuery.toLocaleLowerCase('en-GB') === onlineSearchQuery
      ? onlineResults
      : [];
  const visibleResults = query.trim().length >= 2
    ? uniqueFoods([...searchResults, ...matchingOnlineResults])
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

  function resetLookupState() {
    setError(undefined);
    setOnlineResults([]);
    setOnlineSearchQuery('');
    setOnlineMessage(undefined);
    setQuickCarbOpen(false);
    setQuickCarbs('');
    setQuickCarbLabel('');
    setBarcodeEntryOpen(false);
    setBarcode('');
    setBarcodeMessage(undefined);
    setBarcodeError(undefined);
    setCameraSettingsRequired(false);
    setCustomOpen(false);
    setCustomFood(emptyCustomFood);
    setRecipeSaveOpen(false);
    setRecipeName('');
    setRecipeServings('4');
  }

  async function loadSuggestions() {
    setLoadingSuggestions(true);
    try {
      const [favorites, recent, recentMeals, savedRecipes, catalog] =
        await Promise.all([
        getFavoriteFoods(8),
        getRecentFoods(12),
        getRecentMealPresets(12),
        getFoodRecipes(20),
        import('@/data/food/cofidCatalog'),
      ]);
      setSuggestions(uniqueFoods([...favorites, ...recent]));
      setFavoriteIds(new Set(favorites.map((food) => food.id)));
      setMealPresets(recentMeals);
      setRecipes(savedRecipes);
      setCofidSearch(() => catalog.searchCofidFoods);
    } catch {
      setSuggestions([]);
      setMealPresets([]);
      setRecipes([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function begin() {
    setTimestamp(initialTimestamp);
    setMealType(suggestedMealType(initialTimestamp));
    resetLookupState();
    setOpen(true);
    await loadSuggestions();
  }

  async function beginEdit(log: FoodLog) {
    const draft = foodLogDraftFromLog(log);
    setTimestamp(draft.timestamp);
    setMealType(draft.mealType);
    setTitle(draft.title ?? '');
    setSelected(
      draft.items.map((item) => selectedFoodState(item.food, item.amount)),
    );
    setQuery('');
    resetLookupState();
    setOpen(true);
    await loadSuggestions();
  }

  function clearEditedDraft() {
    setSelected([]);
    setTitle('');
    setQuery('');
    resetLookupState();
  }

  function close() {
    if (saving) return;
    const customFoodChanged =
      customFood.name.trim() ||
      customFood.brand.trim() ||
      customFood.serving !== emptyCustomFood.serving ||
      customFood.unit !== emptyCustomFood.unit ||
      customFood.carbs.trim() ||
      customFood.energy.trim() ||
      customFood.protein.trim() ||
      customFood.fat.trim() ||
      customFood.fibre.trim();
    const hasUnsavedDraft = Boolean(
      editingLog ||
        selected.length ||
        title.trim() ||
        query.trim() ||
        barcode ||
        quickCarbs.trim() ||
        quickCarbLabel.trim() ||
        customFoodChanged,
    );
    const discard = () => {
      setOpen(false);
      clearEditedDraft();
      if (editingLog) onEditEnd?.();
    };
    if (!hasUnsavedDraft) {
      discard();
      return;
    }
    Alert.alert(
      editingLog ? 'Discard these changes?' : 'Discard this meal?',
      'Nothing from this draft will be saved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discard },
      ],
    );
  }

  useEffect(() => {
    if (
      launchRequest === undefined ||
      launchRequest <= handledLaunchRequest.current
    ) {
      return;
    }
    handledLaunchRequest.current = launchRequest;
    void begin();
  }, [launchRequest]);

  useEffect(() => {
    if (!editingLog) return;
    void beginEdit(editingLog);
  }, [editingLog]);

  useEffect(() => {
    const searchKey = normalisedQuery.toLocaleLowerCase('en-GB');
    if (
      searchKey.length < 3 ||
      allCofidSearchResults.length >= 12 ||
      onlineSearchQuery === searchKey ||
      onlineSearching
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void searchBrandedFoods();
    }, 650);
    return () => clearTimeout(timer);
  }, [
    allCofidSearchResults.length,
    normalisedQuery,
    onlineSearchQuery,
    onlineSearching,
  ]);

  async function searchBrandedFoods() {
    const searchKey = normalisedQuery.toLocaleLowerCase('en-GB');
    if (searchKey.length < 2 || onlineSearching) return;
    setOnlineSearching(true);
    setOnlineMessage(undefined);
    setError(undefined);
    try {
      const cached = onlineCache.current.get(searchKey);
      const results =
        cached ??
        (await searchOpenFoodFactsProducts(normalisedQuery));
      if (!cached) onlineCache.current.set(searchKey, results);
      setOnlineSearchQuery(searchKey);
      setOnlineResults(results);
      setOnlineMessage(
        results.length
          ? `${results.length} UK branded product${results.length === 1 ? '' : 's'} added to these results.`
          : 'No UK branded product with reported carbohydrate was found.',
      );
    } catch (searchError) {
      setOnlineMessage(
        searchError instanceof FoodLookupError
          ? searchError.message
          : 'The branded-food search could not be completed.',
      );
    } finally {
      setOnlineSearching(false);
    }
  }

  function addFood(food: FoodCandidate) {
    if (food.nutritionPerBasis.carbohydrateGrams === undefined) {
      setError(
        `${food.name} has no carbohydrate value in its source. Use the carb-only form instead.`,
      );
      return;
    }
    setError(undefined);
    setSelected((items) => {
      if (items.some((item) => item.food.id === food.id)) return items;
      return [...items, selectedFoodState(food)];
    });
    setQuery('');
    setOnlineMessage(undefined);
  }

  async function toggleFavorite(food: FoodCandidate) {
    if (favoriteBusy) return;
    const favorite = !favoriteIds.has(food.id);
    setFavoriteBusy(food.id);
    setError(undefined);
    try {
      await setFoodFavorite(food, favorite);
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (favorite) next.add(food.id);
        else next.delete(food.id);
        return next;
      });
      setBarcodeMessage(
        favorite
          ? `${food.name} added to favourites.`
          : `${food.name} removed from favourites.`,
      );
    } catch (favoriteError) {
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : 'The favourite could not be updated.',
      );
    } finally {
      setFavoriteBusy(undefined);
    }
  }

  function updateAmount(foodId: string, amount: string) {
    setSelected((items) =>
      items.map((item) =>
        item.food.id === foodId
          ? {
              ...item,
              amount,
              count:
                amountNumber(amount) && amountNumber(item.portionAmount)
                  ? inputNumber(
                      amountNumber(amount)! / amountNumber(item.portionAmount)!,
                    )
                  : '',
            }
          : item,
      ),
    );
  }

  function updatePortionAmount(foodId: string, portionAmount: string) {
    setSelected((items) =>
      items.map((item) => {
        if (item.food.id !== foodId) return item;
        const portion = amountNumber(portionAmount);
        const count = amountNumber(item.count);
        return {
          ...item,
          portionAmount,
          amount:
            portion && portion > 0 && count && count > 0
              ? inputNumber(portion * count)
              : item.amount,
        };
      }),
    );
  }

  function updateCount(foodId: string, countValue: string) {
    setSelected((items) =>
      items.map((item) => {
        if (item.food.id !== foodId) return item;
        const count = amountNumber(countValue);
        const portion = amountNumber(item.portionAmount);
        return {
          ...item,
          count: countValue,
          amount:
            count && count > 0 && portion && portion > 0
              ? inputNumber(count * portion)
              : item.amount,
        };
      }),
    );
  }

  function adjustCount(item: SelectedFood, change: number) {
    const current = amountNumber(item.count) ?? (change > 0 ? 0 : 1);
    updateCount(item.food.id, inputNumber(Math.max(0.5, current + change)));
  }

  function removeFood(foodId: string) {
    setSelected((items) =>
      items.filter((item) => item.food.id !== foodId),
    );
  }

  function useMealPreset(preset: FoodMealPreset) {
    setMealType(preset.mealType);
    setSelected(
      preset.items.map((item) => selectedFoodState(item.food, item.amount)),
    );
    setQuery('');
    setError(undefined);
  }

  function useRecipe(recipe: FoodRecipe) {
    setMealType(recipe.mealType);
    setTitle(recipe.name);
    setSelected(
      servingFromRecipe(recipe).map((ingredient) =>
        selectedFoodState(
          ingredient.food,
          Math.round(ingredient.amount * 100) / 100,
        ),
      ),
    );
    setQuery('');
    setError(undefined);
    setBarcodeMessage(`One serving of ${recipe.name} added.`);
  }

  async function saveRecipe() {
    if (recipeSaving) return;
    if (draftItems.length !== selected.length) {
      setError('Check each ingredient amount before saving the recipe.');
      return;
    }
    const servings = amountNumber(recipeServings);
    setRecipeSaving(true);
    setError(undefined);
    try {
      const recipe = await saveFoodRecipe({
        name: recipeName,
        mealType,
        servings: servings ?? Number.NaN,
        ingredients: draftItems,
      });
      setRecipes((current) => [recipe, ...current]);
      setRecipeSaveOpen(false);
      setRecipeName('');
      setRecipeServings('4');
      setBarcodeMessage(
        `${recipe.name} saved · ${displayNumber(
          recipeNutritionPerServing(recipe).carbohydrateGrams ?? 0,
          ' g carbs per serving',
        )}.`,
      );
    } catch (recipeError) {
      setError(
        recipeError instanceof Error
          ? recipeError.message
          : 'The recipe could not be saved.',
      );
    } finally {
      setRecipeSaving(false);
    }
  }

  async function toggleRecipeFavorite(recipe: FoodRecipe) {
    if (recipeActionBusy) return;
    const favorite = !recipe.isFavorite;
    setRecipeActionBusy(recipe.id);
    setError(undefined);
    try {
      await setFoodRecipeFavorite(recipe.id, favorite);
      setRecipes((current) =>
        current
          .map((item) =>
            item.id === recipe.id
              ? { ...item, isFavorite: favorite, updatedAt: Date.now() }
              : item,
          )
          .sort(
            (left, right) =>
              Number(right.isFavorite) - Number(left.isFavorite) ||
              right.updatedAt - left.updatedAt,
          ),
      );
      setBarcodeMessage(
        favorite
          ? `${recipe.name} added to favourite recipes.`
          : `${recipe.name} removed from favourites.`,
      );
    } catch (favoriteError) {
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : 'The recipe could not be updated.',
      );
    } finally {
      setRecipeActionBusy(undefined);
    }
  }

  function confirmDeleteRecipe(recipe: FoodRecipe) {
    Alert.alert(
      `Delete ${recipe.name}?`,
      'This removes the saved recipe. Meals you already logged stay in your history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete recipe',
          style: 'destructive',
          onPress: () => {
            void removeRecipe(recipe);
          },
        },
      ],
    );
  }

  async function removeRecipe(recipe: FoodRecipe) {
    if (recipeActionBusy) return;
    setRecipeActionBusy(recipe.id);
    setError(undefined);
    try {
      await deleteFoodRecipe(recipe.id);
      setRecipes((current) =>
        current.filter((item) => item.id !== recipe.id),
      );
      setBarcodeMessage(`${recipe.name} deleted.`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'The recipe could not be deleted.',
      );
    } finally {
      setRecipeActionBusy(undefined);
    }
  }

  async function toggleMealFavorite(preset: FoodMealPreset) {
    if (favoriteMealBusy) return;
    const favorite = !preset.isFavorite;
    setFavoriteMealBusy(preset.id);
    setError(undefined);
    try {
      await setMealPresetFavorite(preset.id, favorite);
      setMealPresets((current) =>
        current
          .map((meal) =>
            meal.id === preset.id
              ? { ...meal, isFavorite: favorite }
              : meal,
          )
          .sort(
            (left, right) =>
              Number(right.isFavorite) - Number(left.isFavorite),
          ),
      );
      setBarcodeMessage(
        favorite
          ? `${preset.title} saved for quick repeat.`
          : `${preset.title} removed from saved meals.`,
      );
    } catch (favoriteError) {
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : 'The saved meal could not be updated.',
      );
    } finally {
      setFavoriteMealBusy(undefined);
    }
  }

  function updateCustomFood<Key extends keyof CustomFoodForm>(
    key: Key,
    value: CustomFoodForm[Key],
  ) {
    setCustomFood((current) => ({ ...current, [key]: value }));
  }

  function addCustomFood() {
    setError(undefined);
    try {
      const food = createUserFoodCandidate({
        name: customFood.name,
        brand: customFood.brand,
        barcode: barcode || undefined,
        servingAmount: amountNumber(customFood.serving) ?? Number.NaN,
        servingUnit: customFood.unit,
        nutritionPerServing: {
          carbohydrateGrams: optionalNumber(customFood.carbs),
          energyKcal: optionalNumber(customFood.energy),
          proteinGrams: optionalNumber(customFood.protein),
          fatGrams: optionalNumber(customFood.fat),
          fibreGrams: optionalNumber(customFood.fibre),
        },
      });
      addFood(food);
      setCustomFood(emptyCustomFood);
      setCustomOpen(false);
      setBarcode('');
      setBarcodeEntryOpen(false);
      setBarcodeMessage(
        `${food.name} added to this meal${
          food.barcode ? ' and linked to its barcode' : ''
        }.`,
      );
    } catch (customError) {
      setError(
        customError instanceof Error
          ? customError.message
          : 'The custom food could not be added.',
      );
    }
  }

  function addQuickCarbs() {
    setError(undefined);
    try {
      const food = createQuickCarbCandidate(
        amountNumber(quickCarbs) ?? Number.NaN,
        quickCarbLabel,
      );
      addFood(food);
      setQuickCarbs('');
      setQuickCarbLabel('');
      setQuickCarbOpen(false);
      setBarcodeMessage(`${food.name} added as a carb-only entry.`);
    } catch (quickError) {
      setError(
        quickError instanceof Error
          ? quickError.message
          : 'The carbohydrate entry could not be added.',
      );
    }
  }

  async function beginScan() {
    setError(undefined);
    setBarcodeMessage(undefined);
    setBarcodeError(undefined);
    setCameraSettingsRequired(false);
    const currentPermission = await Camera.getCameraPermissionsAsync();
    let granted = currentPermission.granted;
    let settingsRequired = currentPermission.canAskAgain === false;
    if (!granted && currentPermission.canAskAgain !== false) {
      const result = await requestCameraPermission();
      granted = result.granted;
      settingsRequired = !granted && !result.canAskAgain;
    }
    if (!granted) {
      setCameraSettingsRequired(settingsRequired);
      setBarcodeError(
        settingsRequired
          ? 'Camera access is blocked for T1 Arc. Allow Camera in app settings, or enter the barcode number instead.'
          : 'Camera access is needed only to read the barcode. You can enter the number instead.',
      );
      setBarcodeEntryOpen(true);
      return;
    }
    setTorch(false);
    setScannerOpen(true);
  }

  async function resolveBarcode(value: string) {
    if (barcodeLookupLock.current) return;
    barcodeLookupLock.current = true;
    setScannerOpen(false);
    setBarcodeLookingUp(true);
    setBarcodeMessage(undefined);
    setBarcodeError(undefined);
    setCameraSettingsRequired(false);
    setError(undefined);
    let normalisedBarcode = value.replace(/\D/g, '');
    try {
      normalisedBarcode = normaliseFoodBarcode(value);
      setBarcode(normalisedBarcode);
      const cachedFood = await getCachedFoodByBarcode(normalisedBarcode);
      if (cachedFood) {
        addFood(cachedFood);
        setBarcode('');
        setBarcodeEntryOpen(false);
        setBarcodeMessage(`${cachedFood.name} found on this phone.`);
        return;
      }

      const food = await lookupOpenFoodFactsBarcode(normalisedBarcode);
      addFood(food);
      setBarcode('');
      setBarcodeEntryOpen(false);
      setBarcodeMessage(
        `${food.name}${food.brand ? ` · ${food.brand}` : ''} found.`,
      );
    } catch (lookupError) {
      const canCreateFromLabel =
        lookupError instanceof FoodLookupError &&
        (lookupError.code === 'not_found' ||
          lookupError.code === 'incomplete');
      setBarcodeError(
        canCreateFromLabel
          ? `${lookupError.message} Enter it once from the label below; T1 Arc will remember this barcode on your phone.`
          : lookupError instanceof FoodLookupError
            ? lookupError.message
          : 'The barcode could not be looked up.',
      );
      setBarcodeEntryOpen(!canCreateFromLabel);
      setCustomOpen(canCreateFromLabel);
      setBarcode(normalisedBarcode);
    } finally {
      barcodeLookupLock.current = false;
      setBarcodeLookingUp(false);
    }
  }

  function barcodeScanned(result: BarcodeScanningResult) {
    if (barcodeLookupLock.current) return;
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
      const draft = {
        timestamp,
        mealType,
        title: title.trim() || undefined,
        items: draftItems,
      };
      const log = editingLog
        ? await updateFoodLog(editingLog, draft)
        : await logFood(draft);
      setSavedMessage(
        `${log.title} · ${displayNumber(
          log.nutrition.carbohydrateGrams,
          ' g carbs',
        )}`,
      );
      setSelected([]);
      setTitle('');
      setQuery('');
      setOpen(false);
      if (editingLog) onEditEnd?.();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : `The meal could not be ${editingLog ? 'updated' : 'saved'}.`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {showLauncher ? (
        compact ? (
          <Pressable
            accessibilityLabel="Log food"
            accessibilityRole="button"
            onPress={() => void begin()}
            style={({ pressed }) => [
              styles.compactCard,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderRadius: radius.lg,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.compactIcon,
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
                size={22}
              />
            </View>
            <View style={styles.compactCopy}>
              <Text style={[styles.compactTitle, { color: colors.text }]}>
                Log food
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.compactDetail,
                  { color: colors.textSecondary },
                ]}
              >
                Search, scan a barcode or reuse a meal
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={colors.textTertiary}
              name="chevron-forward"
              size={21}
            />
          </Pressable>
        ) : (
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
              Search {COFID_FOOD_COUNT.toLocaleString('en-GB')} UK reference
              entries offline, scan a barcode, or find UK branded products
              online. Retailer ranges are searched separately.
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
        )
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (Keyboard.isVisible()) {
            Keyboard.dismiss();
            return;
          }
          close();
        }}
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
                  PRIVATE FOOD LOG
                </Text>
                <Text
                  accessibilityRole="header"
                  style={[styles.modalTitle, { color: colors.text }]}
                >
                  {editingLog ? 'Edit meal' : 'Log food'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close food logger"
                accessibilityRole="button"
                disabled={saving}
                onPress={close}
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
              {editingLog ? (
                <View
                  style={[
                    styles.editNotice,
                    {
                      backgroundColor: `${colors.primary}10`,
                      borderColor: `${colors.primary}3D`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="create-outline"
                    size={20}
                  />
                  <View style={styles.editNoticeCopy}>
                    <Text
                      style={[styles.editNoticeTitle, { color: colors.text }]}
                    >
                      Correct the saved meal
                    </Text>
                    <Text
                      style={[
                        styles.editNoticeDetail,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Add or remove foods, change portions and timing, or update
                      its label. The meal keeps the same timeline identity.
                    </Text>
                  </View>
                </View>
              ) : null}
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
                    setOnlineMessage(undefined);
                  }}
                  onSubmitEditing={() => void searchBrandedFoods()}
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

              {barcodeError ? (
                <View
                  accessibilityLiveRegion="assertive"
                  style={[
                    styles.barcodeError,
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
                  <View style={styles.barcodeErrorCopy}>
                    <Text
                      style={[
                        styles.barcodeErrorText,
                        { color: colors.danger },
                      ]}
                    >
                      {barcodeError}
                    </Text>
                    {cameraSettingsRequired ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void Linking.openSettings()}
                        style={({ pressed }) => [
                          styles.barcodeSettingsButton,
                          {
                            borderColor: `${colors.danger}66`,
                            borderRadius: radius.sm,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.barcodeSettingsButtonText,
                            { color: colors.danger },
                          ]}
                        >
                          Open app settings
                        </Text>
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.danger}
                          name="open-outline"
                          size={16}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: quickCarbOpen }}
                onPress={() => {
                  setQuickCarbOpen((value) => !value);
                  setError(undefined);
                }}
                style={({ pressed }) => [
                  styles.customToggle,
                  {
                    backgroundColor: quickCarbOpen
                      ? `${colors.primary}12`
                      : colors.surface,
                    borderColor: quickCarbOpen
                      ? `${colors.primary}66`
                      : colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={
                    quickCarbOpen ? colors.primary : colors.textSecondary
                  }
                  name="flash-outline"
                  size={19}
                />
                <View style={styles.customToggleCopy}>
                  <Text style={[styles.customToggleTitle, { color: colors.text }]}>
                    Just enter carbs
                  </Text>
                  <Text
                    style={[
                      styles.customToggleDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Fast carb-only entry when the full label is not available
                  </Text>
                </View>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name={quickCarbOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                />
              </Pressable>

              {quickCarbOpen ? (
                <View
                  style={[
                    styles.quickCarbForm,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <TextInput
                    accessibilityLabel="Quick carbohydrate label, optional"
                    autoCapitalize="sentences"
                    maxLength={120}
                    onChangeText={setQuickCarbLabel}
                    placeholder="What was it? (optional)"
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    style={[
                      styles.customWideInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        color: colors.text,
                      },
                    ]}
                    value={quickCarbLabel}
                  />
                  <View style={styles.quickCarbRow}>
                    <TextInput
                      accessibilityLabel="Quick carbohydrate grams"
                      keyboardType="decimal-pad"
                      maxLength={7}
                      onChangeText={setQuickCarbs}
                      onSubmitEditing={addQuickCarbs}
                      placeholder="Carbs"
                      placeholderTextColor={colors.textTertiary}
                      returnKeyType="done"
                      selectionColor={colors.primary}
                      style={[
                        styles.quickCarbInput,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          borderRadius: radius.sm,
                          color: colors.text,
                        },
                      ]}
                      value={quickCarbs}
                    />
                    <Text
                      style={[
                        styles.quickCarbUnit,
                        { color: colors.textSecondary },
                      ]}
                    >
                      g
                    </Text>
                    <Pressable
                      accessibilityLabel="Add quick carbohydrate entry"
                      accessibilityRole="button"
                      disabled={!quickCarbs.trim()}
                      onPress={addQuickCarbs}
                      style={({ pressed }) => [
                        styles.quickCarbAdd,
                        {
                          backgroundColor: quickCarbs.trim()
                            ? colors.primary
                            : colors.surface,
                          borderRadius: radius.sm,
                          opacity: pressed ? 0.72 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={
                          quickCarbs.trim()
                            ? colors.onPrimary
                            : colors.textTertiary
                        }
                        name="add"
                        size={19}
                      />
                      <Text
                        style={[
                          styles.quickCarbAddText,
                          {
                            color: quickCarbs.trim()
                              ? colors.onPrimary
                              : colors.textTertiary,
                          },
                        ]}
                      >
                        Add
                      </Text>
                    </Pressable>
                  </View>
                  <Text
                    style={[
                      styles.customHint,
                      { color: colors.textTertiary },
                    ]}
                  >
                    Stored explicitly as carb-only; no calories, protein or fat
                    are inferred.
                  </Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: customOpen }}
                onPress={() => {
                  setCustomOpen((value) => !value);
                  setError(undefined);
                }}
                style={({ pressed }) => [
                  styles.customToggle,
                  {
                    backgroundColor: customOpen
                      ? `${colors.accent}12`
                      : colors.surface,
                    borderColor: customOpen
                      ? `${colors.accent}66`
                      : colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={customOpen ? colors.accent : colors.textSecondary}
                  name="create-outline"
                  size={19}
                />
                <View style={styles.customToggleCopy}>
                  <Text style={[styles.customToggleTitle, { color: colors.text }]}>
                    Create a food
                  </Text>
                  <Text
                    style={[
                      styles.customToggleDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Add a missing product from its label
                  </Text>
                </View>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name={customOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                />
              </Pressable>

              {customOpen ? (
                <View
                  style={[
                    styles.customForm,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <TextInput
                    accessibilityLabel="Custom food name"
                    autoCapitalize="sentences"
                    onChangeText={(value) => updateCustomFood('name', value)}
                    placeholder="Food name"
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    style={[
                      styles.customWideInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        color: colors.text,
                      },
                    ]}
                    value={customFood.name}
                  />
                  <TextInput
                    accessibilityLabel="Custom food brand, optional"
                    autoCapitalize="words"
                    onChangeText={(value) => updateCustomFood('brand', value)}
                    placeholder="Brand (optional)"
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    style={[
                      styles.customWideInput,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        color: colors.text,
                      },
                    ]}
                    value={customFood.brand}
                  />
                  <View style={styles.customServingRow}>
                    <View style={styles.customField}>
                      <Text
                        style={[
                          styles.customLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Serving
                      </Text>
                      <TextInput
                        accessibilityLabel="Custom food serving amount"
                        keyboardType="decimal-pad"
                        onChangeText={(value) =>
                          updateCustomFood('serving', value)
                        }
                        selectionColor={colors.primary}
                        style={[
                          styles.customNumberInput,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                            borderRadius: radius.sm,
                            color: colors.text,
                          },
                        ]}
                        value={customFood.serving}
                      />
                    </View>
                    <View style={styles.unitSelector}>
                      {(['g', 'ml'] as const).map((unit) => {
                        const active = customFood.unit === unit;
                        return (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active }}
                            key={unit}
                            onPress={() => updateCustomFood('unit', unit)}
                            style={[
                              styles.unitOption,
                              {
                                backgroundColor: active
                                  ? colors.primary
                                  : colors.surface,
                                borderColor: active
                                  ? colors.primary
                                  : colors.border,
                                borderRadius: radius.sm,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.unitOptionText,
                                {
                                  color: active
                                    ? colors.onPrimary
                                    : colors.textSecondary,
                                },
                              ]}
                            >
                              {unit}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <Text
                    style={[styles.customHint, { color: colors.textSecondary }]}
                  >
                    Nutrition for that serving
                  </Text>
                  {barcode ? (
                    <View
                      style={[
                        styles.customBarcodeLink,
                        {
                          backgroundColor: `${colors.primary}0D`,
                          borderColor: `${colors.primary}38`,
                          borderRadius: radius.sm,
                        },
                      ]}
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.primary}
                        name="barcode-outline"
                        size={18}
                      />
                      <Text
                        style={[
                          styles.customBarcodeText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Barcode {barcode} will work offline after this meal is
                        saved.
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.customNutrientGrid}>
                    {[
                      ['carbs', 'Carbs (g)', true],
                      ['energy', 'Energy (kcal)', false],
                      ['protein', 'Protein (g)', false],
                      ['fat', 'Fat (g)', false],
                      ['fibre', 'Fibre (g)', false],
                    ].map(([key, label, required]) => (
                      <View
                        key={key as string}
                        style={styles.customNutrientField}
                      >
                        <Text
                          style={[
                            styles.customLabel,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {label as string}
                          {required ? ' *' : ''}
                        </Text>
                        <TextInput
                          accessibilityLabel={`Custom food ${label}`}
                          keyboardType="decimal-pad"
                          onChangeText={(value) =>
                            updateCustomFood(
                              key as keyof CustomFoodForm,
                              value,
                            )
                          }
                          placeholder="0"
                          placeholderTextColor={colors.textTertiary}
                          selectionColor={colors.primary}
                          style={[
                            styles.customNumberInput,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                              color: colors.text,
                            },
                          ]}
                          value={
                            customFood[key as keyof CustomFoodForm] as string
                          }
                        />
                      </View>
                    ))}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={addCustomFood}
                    style={({ pressed }) => [
                      styles.customAddButton,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: radius.sm,
                        opacity: pressed ? 0.74 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.onPrimary}
                      name="add"
                      size={19}
                    />
                    <Text
                      style={[
                        styles.customAddText,
                        { color: colors.onPrimary },
                      ]}
                    >
                      Add to this meal
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

              <View>
                <View style={styles.fieldHeader}>
                  <Text style={[styles.fieldLabel, { color: colors.text }]}>
                    Meal label
                  </Text>
                  <Text
                    style={[
                      styles.fieldOptional,
                      { color: colors.textTertiary },
                    ]}
                  >
                    Optional
                  </Text>
                </View>
                <TextInput
                  accessibilityLabel="Meal label"
                  maxLength={120}
                  onChangeText={setTitle}
                  placeholder="Use the food name automatically"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  style={[
                    styles.mealTitleInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      color: colors.text,
                    },
                  ]}
                  value={title}
                />
                <Text
                  style={[styles.fieldHint, { color: colors.textTertiary }]}
                >
                  Leave blank and T1 Arc will name it from the saved foods.
                </Text>
              </View>

              {!selected.length && !query.trim() && recipes.length ? (
                <View style={styles.recentMeals}>
                  <View style={styles.sectionHeading}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      Your recipes
                    </Text>
                    <Text
                      style={[
                        styles.recentMealHint,
                        { color: colors.textTertiary },
                      ]}
                    >
                      Per serving
                    </Text>
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.recentMealRail}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {recipes.map((recipe) => (
                      <View
                        key={recipe.id}
                        style={[
                          styles.recipeCard,
                          {
                            backgroundColor: colors.surface,
                            borderColor: `${colors.primary}55`,
                            borderRadius: radius.md,
                          },
                        ]}
                      >
                        <Pressable
                          accessibilityHint="Adds one serving with every ingredient"
                          accessibilityLabel={`Add one serving of ${recipe.name}`}
                          accessibilityRole="button"
                          onPress={() => useRecipe(recipe)}
                          style={({ pressed }) => [
                            styles.recipeUseAction,
                            { opacity: pressed ? 0.66 : 1 },
                          ]}
                        >
                          <View
                            style={[
                              styles.recipeIcon,
                              {
                                backgroundColor: `${colors.primary}16`,
                                borderRadius: radius.sm,
                              },
                            ]}
                          >
                            <Ionicons
                              accessibilityElementsHidden
                              color={colors.primary}
                              name="book-outline"
                              size={19}
                            />
                          </View>
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.recentMealTitle,
                              { color: colors.text },
                            ]}
                          >
                            {recipe.name}
                          </Text>
                          <Text
                            style={[
                              styles.recentMealMeta,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {displayNumber(
                              recipeNutritionPerServing(recipe)
                                .carbohydrateGrams ?? 0,
                              ' g carbs',
                            )}
                          </Text>
                          <Text
                            style={[
                              styles.recipeServing,
                              { color: colors.textTertiary },
                            ]}
                          >
                            1 of {recipe.servings.toLocaleString('en-GB', {
                              maximumFractionDigits: 1,
                            })}
                          </Text>
                        </Pressable>
                        <View
                          style={[
                            styles.recipeActions,
                            { borderTopColor: colors.border },
                          ]}
                        >
                          <Pressable
                            accessibilityLabel={
                              recipe.isFavorite
                                ? `Remove ${recipe.name} from favourite recipes`
                                : `Add ${recipe.name} to favourite recipes`
                            }
                            accessibilityRole="button"
                            disabled={Boolean(recipeActionBusy)}
                            hitSlop={6}
                            onPress={() => {
                              void toggleRecipeFavorite(recipe);
                            }}
                            style={styles.recipeIconAction}
                          >
                            {recipeActionBusy === recipe.id ? (
                              <ActivityIndicator
                                color={colors.primary}
                                size="small"
                              />
                            ) : (
                              <Ionicons
                                color={
                                  recipe.isFavorite
                                    ? colors.warning
                                    : colors.textTertiary
                                }
                                name={
                                  recipe.isFavorite ? 'star' : 'star-outline'
                                }
                                size={20}
                              />
                            )}
                          </Pressable>
                          <Pressable
                            accessibilityLabel={`Delete ${recipe.name}`}
                            accessibilityRole="button"
                            disabled={Boolean(recipeActionBusy)}
                            hitSlop={6}
                            onPress={() => confirmDeleteRecipe(recipe)}
                            style={styles.recipeIconAction}
                          >
                            <Ionicons
                              color={colors.textTertiary}
                              name="trash-outline"
                              size={19}
                            />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {!selected.length && !query.trim() && mealPresets.length ? (
                <View style={styles.recentMeals}>
                  <View style={styles.sectionHeading}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      Saved and recent meals
                    </Text>
                    <Text
                      style={[
                        styles.recentMealHint,
                        { color: colors.textTertiary },
                      ]}
                    >
                      One tap
                    </Text>
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.recentMealRail}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {mealPresets.map((preset) => (
                      <View
                        key={preset.id}
                        style={[
                          styles.recentMeal,
                          {
                            backgroundColor: colors.surface,
                            borderColor: preset.isFavorite
                              ? `${colors.accent}70`
                              : colors.border,
                            borderRadius: radius.md,
                          },
                        ]}
                      >
                        <Pressable
                          accessibilityHint="Adds every saved food and amount"
                          accessibilityLabel={`Repeat ${preset.title}`}
                          accessibilityRole="button"
                          onPress={() => useMealPreset(preset)}
                          style={({ pressed }) => [
                            styles.recentMealAction,
                            { opacity: pressed ? 0.65 : 1 },
                          ]}
                        >
                          <Ionicons
                            accessibilityElementsHidden
                            color={colors.accent}
                            name="repeat-outline"
                            size={18}
                          />
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.recentMealTitle,
                              { color: colors.text },
                            ]}
                          >
                            {preset.title}
                          </Text>
                          <Text
                            style={[
                              styles.recentMealMeta,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {displayNumber(
                              preset.nutrition.carbohydrateGrams,
                              ' g carbs',
                            )}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`${
                            preset.isFavorite ? 'Remove' : 'Save'
                          } ${preset.title} ${
                            preset.isFavorite ? 'from' : 'to'
                          } quick meals`}
                          accessibilityRole="button"
                          disabled={Boolean(favoriteMealBusy)}
                          hitSlop={5}
                          onPress={() => void toggleMealFavorite(preset)}
                          style={({ pressed }) => [
                            styles.recentMealFavorite,
                            {
                              backgroundColor: preset.isFavorite
                                ? `${colors.accent}18`
                                : colors.surfaceMuted,
                              borderRadius: radius.pill,
                              opacity:
                                pressed ||
                                favoriteMealBusy === preset.id
                                  ? 0.6
                                  : 1,
                            },
                          ]}
                        >
                          {favoriteMealBusy === preset.id ? (
                            <ActivityIndicator
                              color={colors.accent}
                              size="small"
                            />
                          ) : (
                            <Ionicons
                              accessibilityElementsHidden
                              color={
                                preset.isFavorite
                                  ? colors.accent
                                  : colors.textTertiary
                              }
                              name={
                                preset.isFavorite
                                  ? 'star'
                                  : 'star-outline'
                              }
                              size={17}
                            />
                          )}
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

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
                    const portionAmount = amountNumber(item.portionAmount);
                    const canCount = Boolean(portionAmount && portionAmount > 0);
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
                            {` · ${item.food.sourceLabel}`}
                          </Text>
                          <View style={styles.servingRow}>
                            <Text
                              style={[
                                styles.servingLabel,
                                { color: colors.textTertiary },
                              ]}
                            >
                              {item.food.servingLabel
                                ? `Source portion: ${item.food.servingLabel}`
                                : 'Set one item’s weight to log a count'}
                            </Text>
                            <View
                              style={[
                                styles.eachAmountShell,
                                {
                                  backgroundColor: colors.surfaceMuted,
                                  borderColor: colors.border,
                                  borderRadius: radius.sm,
                                },
                              ]}
                            >
                              <TextInput
                                accessibilityLabel={`Weight of one ${item.food.name} item`}
                                keyboardType="decimal-pad"
                                onChangeText={(value) =>
                                  updatePortionAmount(item.food.id, value)
                                }
                                placeholder="Weight"
                                placeholderTextColor={colors.textTertiary}
                                selectTextOnFocus
                                selectionColor={colors.primary}
                                style={[styles.eachAmountInput, { color: colors.text }]}
                                value={item.portionAmount}
                              />
                              <Text style={[styles.eachAmountUnit, { color: colors.textSecondary }]}>
                                {item.food.basisUnit} each
                              </Text>
                            </View>
                            <View style={styles.countEditor}>
                              <Pressable
                                accessibilityLabel={`Remove one ${item.food.name}`}
                                accessibilityRole="button"
                                disabled={!canCount || (amountNumber(item.count) ?? 0) <= 0.5}
                                onPress={() => adjustCount(item, -1)}
                                style={({ pressed }) => [
                                  styles.countStep,
                                  {
                                    backgroundColor: colors.surfaceMuted,
                                    borderColor: colors.border,
                                    borderRadius: radius.sm,
                                    opacity: !canCount ? 0.4 : pressed ? 0.65 : 1,
                                  },
                                ]}
                              >
                                <Ionicons color={colors.textSecondary} name="remove" size={18} />
                              </Pressable>
                              <TextInput
                                accessibilityLabel={`Number of ${item.food.name} items or servings`}
                                editable={canCount}
                                keyboardType="decimal-pad"
                                onChangeText={(value) => updateCount(item.food.id, value)}
                                placeholder="Count"
                                placeholderTextColor={colors.textTertiary}
                                selectTextOnFocus
                                selectionColor={colors.primary}
                                style={[
                                  styles.countInput,
                                  {
                                    backgroundColor: colors.surface,
                                    borderColor: colors.border,
                                    borderRadius: radius.sm,
                                    color: colors.text,
                                  },
                                ]}
                                value={item.count}
                              />
                              <Pressable
                                accessibilityLabel={`Add one ${item.food.name}`}
                                accessibilityRole="button"
                                disabled={!canCount}
                                onPress={() => adjustCount(item, 1)}
                                style={({ pressed }) => [
                                  styles.countStep,
                                  {
                                    backgroundColor: colors.surfaceMuted,
                                    borderColor: colors.border,
                                    borderRadius: radius.sm,
                                    opacity: !canCount ? 0.4 : pressed ? 0.65 : 1,
                                  },
                                ]}
                              >
                                <Ionicons color={colors.textSecondary} name="add" size={18} />
                              </Pressable>
                            </View>
                          </View>
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
                            accessibilityLabel={`Total amount of ${item.food.name}`}
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
                  {!editingLog ? (
                    <View
                      style={[
                        styles.recipeSave,
                        {
                          backgroundColor: `${colors.primary}09`,
                          borderColor: `${colors.primary}38`,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setRecipeSaveOpen((current) => !current);
                          setRecipeName((current) =>
                            current || title.trim(),
                          );
                        }}
                        style={({ pressed }) => [
                          styles.recipeSaveToggle,
                          { opacity: pressed ? 0.65 : 1 },
                        ]}
                      >
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.primary}
                          name="book-outline"
                          size={20}
                        />
                        <View style={styles.recipeSaveCopy}>
                          <Text
                            style={[
                              styles.recipeSaveTitle,
                              { color: colors.text },
                            ]}
                          >
                            Save as a recipe
                          </Text>
                          <Text
                            style={[
                              styles.recipeSaveDetail,
                              { color: colors.textSecondary },
                            ]}
                          >
                            Keep this full batch, then log one serving in a tap.
                          </Text>
                        </View>
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.textTertiary}
                          name={
                            recipeSaveOpen
                              ? 'chevron-up'
                              : 'chevron-down'
                          }
                          size={19}
                        />
                      </Pressable>
                      {recipeSaveOpen ? (
                        <View
                          style={[
                            styles.recipeFields,
                            { borderTopColor: colors.divider },
                          ]}
                        >
                          <TextInput
                            accessibilityLabel="Recipe name"
                            maxLength={120}
                            onChangeText={setRecipeName}
                            placeholder="Recipe name"
                            placeholderTextColor={colors.textTertiary}
                            selectionColor={colors.primary}
                            style={[
                              styles.recipeNameInput,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                color: colors.text,
                              },
                            ]}
                            value={recipeName}
                          />
                          <View style={styles.recipeServingsRow}>
                            <View style={styles.recipeServingsCopy}>
                              <Text
                                style={[
                                  styles.recipeServingsLabel,
                                  { color: colors.text },
                                ]}
                              >
                                Batch makes
                              </Text>
                              <Text
                                style={[
                                  styles.recipeSaveDetail,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                Each future tap logs one serving.
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.recipeServingsInputShell,
                                {
                                  backgroundColor: colors.surface,
                                  borderColor: colors.border,
                                  borderRadius: radius.sm,
                                },
                              ]}
                            >
                              <TextInput
                                accessibilityLabel="Number of recipe servings"
                                keyboardType="decimal-pad"
                                onChangeText={setRecipeServings}
                                selectTextOnFocus
                                selectionColor={colors.primary}
                                style={[
                                  styles.recipeServingsInput,
                                  { color: colors.text },
                                ]}
                                value={recipeServings}
                              />
                              <Text
                                style={[
                                  styles.recipeServingsUnit,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                servings
                              </Text>
                            </View>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            disabled={recipeSaving}
                            onPress={() => void saveRecipe()}
                            style={({ pressed }) => [
                              styles.recipeSaveButton,
                              {
                                backgroundColor: colors.primary,
                                borderRadius: radius.sm,
                                opacity:
                                  recipeSaving || pressed ? 0.7 : 1,
                              },
                            ]}
                          >
                            {recipeSaving ? (
                              <ActivityIndicator
                                color={colors.onPrimary}
                                size="small"
                              />
                            ) : (
                              <Ionicons
                                accessibilityElementsHidden
                                color={colors.onPrimary}
                                name="bookmark-outline"
                                size={18}
                              />
                            )}
                            <Text
                              style={[
                                styles.recipeSaveButtonText,
                                { color: colors.onPrimary },
                              ]}
                            >
                              Save recipe
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
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
                  ) : query.trim().length >= 2 ? (
                    <Text style={[styles.resultCount, { color: colors.textTertiary }]}>
                      {allCofidSearchResults.length.toLocaleString('en-GB')} UK
                      reference {allCofidSearchResults.length === 1 ? 'match' : 'matches'}
                      {matchingOnlineResults.length
                        ? ` · ${matchingOnlineResults.length} UK branded`
                        : ''}
                    </Text>
                  ) : null}
                </View>
                {query.trim().length === 1 ? (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    Type one more character to search.
                  </Text>
                ) : null}
                {normalisedQuery.length >= 2 &&
                onlineSearchQuery !==
                  normalisedQuery.toLocaleLowerCase('en-GB') ? (
                  <Pressable
                    accessibilityHint="Sends only the food words you typed to Open Food Facts."
                    accessibilityRole="button"
                    disabled={onlineSearching}
                    onPress={() => void searchBrandedFoods()}
                    style={({ pressed }) => [
                      styles.onlineSearchButton,
                      {
                        backgroundColor: `${colors.primary}12`,
                        borderColor: `${colors.primary}55`,
                        borderRadius: radius.md,
                        opacity: onlineSearching ? 0.7 : pressed ? 0.65 : 1,
                      },
                    ]}
                  >
                    {onlineSearching ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.primary}
                        name="cloud-outline"
                        size={19}
                      />
                    )}
                    <View style={styles.onlineSearchCopy}>
                      <Text
                        style={[
                          styles.onlineSearchTitle,
                          { color: colors.primaryStrong },
                        ]}
                      >
                        {onlineSearching
                          ? 'Searching UK branded foods…'
                          : 'Search UK branded products now'}
                      </Text>
                      <Text
                        style={[
                          styles.onlineSearchDetail,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Automatic when UK reference matches are sparse
                      </Text>
                    </View>
                    {!onlineSearching ? (
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.textTertiary}
                        name="chevron-forward"
                        size={18}
                      />
                    ) : null}
                  </Pressable>
                ) : null}
                {onlineMessage ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.onlineMessage, { color: colors.textSecondary }]}
                  >
                    {onlineMessage}
                  </Text>
                ) : null}
                {!loadingSuggestions &&
                query.trim().length >= 2 &&
                !visibleResults.length ? (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    No matching food with reported carbohydrate is available.
                    You can still add a product from its label below.
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
                          numberOfLines={2}
                          style={[
                            styles.resultMeta,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {displayNumber(carbs, ' g carbs')} per{' '}
                          {displayNumber(
                            food.basisAmount,
                            ` ${food.basisUnit}`,
                          )}
                          {food.brand ? ` · ${food.brand}` : ''}
                          {` · ${food.sourceLabel}`}
                          {food.lastPortionAmount !== undefined &&
                          food.lastPortionUnit === food.basisUnit
                            ? ` · last ${displayNumber(
                                food.lastPortionAmount,
                                ` ${food.lastPortionUnit}`,
                              )}`
                            : ''}
                        </Text>
                      </View>
                      <View style={styles.resultActions}>
                        <Pressable
                          accessibilityLabel={
                            favoriteIds.has(food.id)
                              ? `Remove ${food.name} from favourites`
                              : `Add ${food.name} to favourites`
                          }
                          accessibilityRole="button"
                          disabled={favoriteBusy === food.id}
                          hitSlop={4}
                          onPress={(event) => {
                            event.stopPropagation();
                            void toggleFavorite(food);
                          }}
                          style={({ pressed }) => [
                            styles.favoriteButton,
                            { opacity: pressed ? 0.55 : 1 },
                          ]}
                        >
                          {favoriteBusy === food.id ? (
                            <ActivityIndicator
                              color={colors.primary}
                              size="small"
                            />
                          ) : (
                            <Ionicons
                              accessibilityElementsHidden
                              color={
                                favoriteIds.has(food.id)
                                  ? colors.accent
                                  : colors.textTertiary
                              }
                              name={
                                favoriteIds.has(food.id)
                                  ? 'heart'
                                  : 'heart-outline'
                              }
                              size={21}
                            />
                          )}
                        </Pressable>
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
                      </View>
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
                Nutrients are per 100 g or 100 ml from {COFID_DATASET}. These{' '}
                {COFID_FOOD_COUNT.toLocaleString('en-GB')} entries are a
                reference dataset, not a complete retailer catalogue. Values
                are estimates, not dosing advice. When reference matches are
                sparse, the typed food words are sent to Open Food Facts for a
                UK-filtered branded search. Barcode lookups send only the
                product number. No glucose, insulin, identity or diary data is
                sent.
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
                  {saving
                    ? 'Saving locally…'
                    : editingLog
                      ? 'Update meal'
                      : 'Save meal'}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          setTorch(false);
          setScannerOpen(false);
        }}
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
                onPress={() => {
                  setTorch(false);
                  setScannerOpen(false);
                }}
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
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setTorch(false);
                  setScannerOpen(false);
                  setBarcodeEntryOpen(true);
                }}
                style={({ pressed }) => [
                  styles.scannerManualButton,
                  { opacity: pressed ? 0.72 : 1 },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color="#FFFFFF"
                  name="keypad-outline"
                  size={18}
                />
                <Text style={styles.scannerManualButtonText}>
                  Enter barcode instead
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  compactCard: {
    minHeight: 74,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compactIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactCopy: {
    flex: 1,
  },
  compactTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  compactDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
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
  editNotice: {
    minHeight: 70,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  editNoticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  editNoticeTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  editNoticeDetail: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
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
  barcodeError: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  barcodeErrorCopy: {
    flex: 1,
    minWidth: 0,
    gap: 9,
  },
  barcodeErrorText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  barcodeSettingsButton: {
    minHeight: 40,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  barcodeSettingsButtonText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
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
  customToggle: {
    minHeight: 56,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customToggleCopy: {
    flex: 1,
  },
  customToggleTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  customToggleDetail: {
    fontSize: 11,
    lineHeight: 16,
  },
  quickCarbForm: {
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  quickCarbRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickCarbInput: {
    minWidth: 110,
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
  quickCarbUnit: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  quickCarbAdd: {
    minWidth: 98,
    minHeight: 48,
    marginLeft: 'auto',
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  quickCarbAddText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  customForm: {
    borderWidth: 1,
    padding: 12,
    gap: 11,
  },
  customWideInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  customServingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  customField: {
    flex: 1,
    gap: 5,
  },
  customLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  customNumberInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 11,
    fontSize: 14,
  },
  unitSelector: {
    flexDirection: 'row',
    gap: 6,
  },
  unitOption: {
    minWidth: 52,
    minHeight: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitOptionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  customHint: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  customBarcodeLink: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  customBarcodeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  customNutrientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  customNutrientField: {
    minWidth: 104,
    flexBasis: '30%',
    flexGrow: 1,
    gap: 5,
  },
  customAddButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  customAddText: {
    fontSize: 13,
    lineHeight: 18,
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
  fieldHeader: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 7,
  },
  fieldLabel: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  fieldOptional: {
    fontSize: 11,
    lineHeight: 16,
  },
  mealTitleInput: {
    minHeight: 52,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
    lineHeight: 20,
  },
  fieldHint: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  recentMeals: {
    gap: 8,
  },
  recentMealHint: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  recentMealRail: {
    gap: 9,
    paddingRight: 4,
  },
  recentMeal: {
    width: 154,
    minHeight: 104,
    borderWidth: 1,
    overflow: 'hidden',
  },
  recipeCard: {
    width: 152,
    minHeight: 166,
    borderWidth: 1,
    overflow: 'hidden',
  },
  recipeUseAction: {
    flex: 1,
    padding: 12,
    gap: 5,
  },
  recipeActions: {
    minHeight: 43,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recipeIconAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeIcon: {
    width: 34,
    height: 34,
    marginBottom: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recipeServing: {
    marginTop: 'auto',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  recentMealAction: {
    flex: 1,
    padding: 12,
    paddingRight: 44,
    justifyContent: 'space-between',
    gap: 6,
  },
  recentMealFavorite: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentMealTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  recentMealMeta: {
    fontSize: 11,
    lineHeight: 16,
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
  resultCount: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
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
  servingRow: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  servingLabel: {
    width: '100%',
    marginRight: 2,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '700',
  },
  eachAmountShell: {
    minHeight: 44,
    width: 120,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eachAmountInput: {
    minHeight: 42,
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
    fontSize: 12,
    textAlign: 'right',
  },
  eachAmountUnit: {
    paddingHorizontal: 6,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '700',
  },
  countEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  countStep: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countInput: {
    width: 62,
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 5,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  servingChip: {
    minWidth: 34,
    minHeight: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  servingChipText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
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
  recipeSave: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  recipeSaveToggle: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recipeSaveCopy: {
    flex: 1,
    minWidth: 0,
  },
  recipeSaveTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  recipeSaveDetail: {
    fontSize: 10,
    lineHeight: 15,
  },
  recipeFields: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 11,
  },
  recipeNameInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  recipeServingsRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recipeServingsCopy: {
    flex: 1,
    minWidth: 0,
  },
  recipeServingsLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  recipeServingsInputShell: {
    minHeight: 48,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recipeServingsInput: {
    width: 48,
    minHeight: 46,
    paddingHorizontal: 8,
    fontSize: 14,
    textAlign: 'right',
  },
  recipeServingsUnit: {
    paddingRight: 10,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
  },
  recipeSaveButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  recipeSaveButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
  },
  resultsBlock: {
    gap: 2,
  },
  onlineSearchButton: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 6,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  onlineSearchCopy: {
    flex: 1,
    minWidth: 0,
  },
  onlineSearchTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  onlineSearchDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  onlineMessage: {
    fontSize: 11,
    lineHeight: 17,
    paddingVertical: 8,
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
  resultActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  favoriteButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  scannerManualButton: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.58)',
    borderRadius: 22,
    paddingHorizontal: 16,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  scannerManualButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
});
