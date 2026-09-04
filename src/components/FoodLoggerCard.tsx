import Ionicons from "@expo/vector-icons/Ionicons";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import {
  BarcodeScanningResult,
  Camera,
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  deleteFoodRecipe,
  getFoodBarcodeCacheEntry,
  getFoodLogs,
  getFoodRecipes,
  getRecentMealPresets,
  saveFoodRecipe,
  setFoodRecipeFavorite,
  setFoodFavorite,
  setMealPresetFavorite,
  setStoredFoodFavoritesByIdentity,
  updateFoodRecipe,
} from "@/data/food/foodLogRepository";
import {
  planFoodLogCopy,
  type AmbiguousFoodCopyTimeResolution,
  type FoodCopyMode,
  type FoodCopySelection,
} from "@/data/food/foodCopyPlanner";
import {
  createMyFood,
  deleteMyFood,
  updateMyFood,
} from "@/data/food/myFoodsRepository";
import { COFID_CATALOG_INFO } from "@/data/food/cofidCatalog";
import { MEXT_JAPAN_CATALOG_INFO } from "@/data/food/mextJapanCatalog";
import {
  recipeNutritionPerServing,
  servingFromRecipe,
} from "@/data/food/recipes";
import { foodLogDraftFromLog } from "@/data/food/foodLogEditing";
import {
  FoodLookupError,
  lookupOpenFoodFactsBarcode,
  normaliseFoodBarcode,
} from "@/data/food/openFoodFacts";
import {
  createDefaultFoodSearchScheduler,
  searchFoods,
} from "@/data/food/unifiedFoodSearch";
import {
  USDA_FDC_CATALOG_INFO,
  lookupFoodDataCentralBarcode,
  shouldTryFoodDataCentralBarcodeFallback,
} from "@/data/food/usdaFoodDataCentral";
import { totalNutrition } from "@/data/food/nutrition";
import {
  defaultFoodInputUnit,
  foodAmountFromCanonical,
  foodInputUnits,
  type FoodInputUnit,
} from "@/data/food/foodMeasurement";
import { createQuickCarbCandidate } from "@/data/food/quickCarb";
import type { FoodSearchResponse } from "@/data/food/foodSearch";
import {
  normaliseFoodSearchText,
  type RankedFoodSearchResult,
} from "@/data/food/foodSearchRanking";
import {
  defaultFoodServingAmount,
  initialFoodPortionAmount,
} from "@/data/food/servings";
import { resolveSelectedFoodCanonicalAmount } from "@/data/food/selectedFoodAmount";
import {
  FoodCandidate,
  FoodLog,
  FoodLogItemDraft,
  FoodMealPreset,
  FoodRecipe,
} from "@/data/food/types";
import {
  addDays,
  type DateKey,
  formatDate,
  formatTime,
  resolveZonedWallClock,
  toDateKey,
  type AmbiguousWallClockResolution,
  ZonedWallClockError,
  zonedDateTimeToTimestamp,
} from "@/domain/time";
import { MealType, suggestedMealType } from "@/domain/mealTiming";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import {
  formatRegionalNumberInput,
  normalizeRegionalNumberInput,
} from "@/domain/regionalNumberInput";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  isLocalDataWriteSupersededError,
} from "@/data/privacy/localDataWriteEpoch";

import { SectionCard } from "./SectionCard";
import { SurfaceSheen } from "./SurfaceSheen";
import { FoodLibraryTabs } from "./foodLogger/FoodLibraryTabs";
import { FoodCopyFromDaySheet } from "./foodLogger/FoodCopyFromDaySheet";
import { defaultFoodCopyItemIdentities } from "./foodLogger/copyPresentation";
import {
  dateKeyFromPickerDate,
  pickerDateForZonedTimestamp,
  pickerTimeForZonedTimestamp,
  regionalClockUses24Hours,
  wallClockFromPickerDate,
} from "./zonedDateTimePicker";
import {
  foodLibraryContent,
  foodLibraryCounts,
  foodLibraryEmptyMessage,
  type FoodLibraryTab,
} from "./foodLogger/libraryPresentation";
import {
  customFoodDraftFromForm,
  customFoodFormFromCandidate,
  EMPTY_CUSTOM_FOOD,
  myFoodSelectionUnitIsCompatible,
  type CustomFoodForm,
} from "./foodLogger/myFoodPresentation";
import { presentFoodNutrition } from "./foodLogger/presentation";
import {
  barcodeCacheLookupPlan,
  canUseStaleBarcodeFallback,
  favoriteMutationPlanForSearchResult,
  searchResultCandidateIds,
  searchResultMatchesFood,
  shouldLoadRemoteProductImage,
  staleBarcodeFallbackMessage,
} from "./foodLogger/searchPresentation";

interface SelectedFood {
  /** Draft-row identity. Food identities are not unique when a meal repeats an item. */
  rowId: string;
  food: FoodCandidate;
  amount: string;
  /** Exact amount in the food's canonical basis unit before presentation. */
  canonicalAmount: number;
  /** True only after the user changes total amount or serving controls. */
  amountEdited: boolean;
  unit: FoodInputUnit;
  count: string;
  portionAmount: string;
  dataStatus?: "stale";
}

let selectedFoodRowSequence = 0;

function nextSelectedFoodRowId(foodId: string) {
  selectedFoodRowSequence += 1;
  return `${foodId}:draft-row:${selectedFoodRowSequence}`;
}

const mealTypes: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

function amountNumber(value: string, locale: string) {
  return normalizeRegionalNumberInput(value, locale)?.value;
}

function displayNumber(value: number | undefined, suffix: string) {
  if (value === undefined) return "Not reported";
  const rounded = Math.round(value * 10) / 10;
  return `${formatRegionalNumber(rounded, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: 1,
  })}${suffix}`;
}

function inputNumber(value: number, locale: string) {
  return formatRegionalNumberInput(value, locale, 2);
}

function openFoodSource(url: string | undefined) {
  if (!url || !/^https:\/\//i.test(url)) return;
  void Linking.openURL(url).catch(() => undefined);
}

function selectedFoodState(
  food: FoodCandidate,
  amountValue?: number,
  dataStatus?: SelectedFood["dataStatus"],
  regional = getRuntimeRegionalDefaults(),
  rowId = nextSelectedFoodRowId(food.id),
): SelectedFood {
  const unit = defaultFoodInputUnit(food.basisUnit, regional);
  const canonicalAmount = amountValue ?? initialFoodPortionAmount(food);
  const amount = foodAmountFromCanonical(
    canonicalAmount,
    unit,
    regional.countryCode,
  );
  const sourcePortion = food.servingLabel
    ? foodAmountFromCanonical(
        defaultFoodServingAmount(food),
        unit,
        regional.countryCode,
      )
    : undefined;
  return {
    rowId,
    food,
    amount: inputNumber(amount, regional.locale),
    canonicalAmount,
    amountEdited: false,
    unit,
    count: sourcePortion
      ? inputNumber(amount / sourcePortion, regional.locale)
      : "",
    portionAmount: sourcePortion
      ? inputNumber(sourcePortion, regional.locale)
      : "",
    dataStatus,
  };
}

function FoodArtwork({
  food,
  backgroundColor,
  iconColor,
  borderRadius,
  allowNetworkImage = false,
  size = 48,
}: {
  food: FoodCandidate;
  backgroundColor: string;
  iconColor: string;
  borderRadius: number;
  allowNetworkImage?: boolean;
  size?: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageIsRemote = /^https?:\/\//i.test(food.imageUrl ?? "");
  const showImage = Boolean(
    food.imageUrl && !imageFailed && (!imageIsRemote || allowNetworkImage),
  );

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.foodArtwork,
        {
          backgroundColor,
          borderRadius,
          height: size,
          width: size,
        },
      ]}
    >
      {showImage ? (
        <Image
          onError={() => setImageFailed(true)}
          resizeMode="cover"
          source={{ uri: food.imageUrl }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Ionicons color={iconColor} name="nutrition-outline" size={20} />
      )}
    </View>
  );
}

export function FoodLoggerCard({
  editingLog,
  initialTimestamp,
  launchRequest,
  onEditEnd,
  onModalShow,
  compact = false,
  showLauncher = true,
}: {
  editingLog?: FoodLog;
  initialTimestamp: number;
  launchRequest?: number;
  onEditEnd?(): void;
  onModalShow?(): void;
  compact?: boolean;
  showLauncher?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const showCofid = regional.countryCode === "GB";
  const showUsda = regional.countryCode === "US";
  const showMextJapan = regional.countryCode === "JP";
  const { earliestDate, logFood, updateFoodLog } = useDataContext();
  const [, requestCameraPermission] = useCameraPermissions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [timestamp, setTimestamp] = useState(initialTimestamp);
  const [mealType, setMealType] = useState<MealType>(
    suggestedMealType(initialTimestamp),
  );
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<SelectedFood[]>([]);
  const [suggestions, setSuggestions] = useState<RankedFoodSearchResult[]>([]);
  const [mealPresets, setMealPresets] = useState<FoodMealPreset[]>([]);
  const [recipes, setRecipes] = useState<FoodRecipe[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoriteBusy, setFavoriteBusy] = useState<string>();
  const [favoriteMealBusy, setFavoriteMealBusy] = useState<string>();
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [torch, setTorch] = useState(false);
  const [barcodeEntryOpen, setBarcodeEntryOpen] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [barcodeLookingUp, setBarcodeLookingUp] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState<string>();
  const [barcodeError, setBarcodeError] = useState<string>();
  const [cameraSettingsRequired, setCameraSettingsRequired] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFood, setCustomFood] = useState<CustomFoodForm>(EMPTY_CUSTOM_FOOD);
  const [customSaving, setCustomSaving] = useState(false);
  const [editingMyFoodId, setEditingMyFoodId] = useState<string>();
  const [myFoodsManaging, setMyFoodsManaging] = useState(false);
  const [myFoodActionBusy, setMyFoodActionBusy] = useState<string>();
  const [quickCarbOpen, setQuickCarbOpen] = useState(false);
  const [quickCarbs, setQuickCarbs] = useState("");
  const [quickCarbLabel, setQuickCarbLabel] = useState("");
  const [mealDetailsOpen, setMealDetailsOpen] = useState(false);
  const [moreWaysOpen, setMoreWaysOpen] = useState(false);
  const [recipeManagementOpen, setRecipeManagementOpen] = useState(false);
  const [dataInfoOpen, setDataInfoOpen] = useState(false);
  const [expandedFoodIds, setExpandedFoodIds] = useState<Set<string>>(
    new Set(),
  );
  const [recipeSaveOpen, setRecipeSaveOpen] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string>();
  const [recipeName, setRecipeName] = useState("");
  const [recipeServings, setRecipeServings] = useState("4");
  const [libraryTab, setLibraryTab] = useState<FoodLibraryTab>("recent");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceDate, setCopySourceDate] = useState<DateKey>(() =>
    addDays(toDateKey(initialTimestamp, regional.timeZone), -1),
  );
  const [copySourceLogs, setCopySourceLogs] = useState<FoodLog[]>([]);
  const [copySelectedIdentities, setCopySelectedIdentities] = useState<string[]>(
    [],
  );
  const [copyMode, setCopyMode] = useState<FoodCopyMode>("append");
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const [copyActionError, setCopyActionError] = useState<string>();
  const [copyUndo, setCopyUndo] = useState<{
    selected: SelectedFood[];
    message: string;
  }>();
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [recipeActionBusy, setRecipeActionBusy] = useState<string>();
  const [searchResults, setSearchResults] = useState<RankedFoodSearchResult[]>(
    [],
  );
  const [completedSearchQuery, setCompletedSearchQuery] = useState("");
  const [foodSearching, setFoodSearching] = useState(false);
  const [submittedSearchActive, setSubmittedSearchActive] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string>();
  const [searchRetryAvailable, setSearchRetryAvailable] = useState(false);
  const [foodSearchScheduler] = useState(() =>
    createDefaultFoodSearchScheduler({ debounceMs: 450 }),
  );
  const handledLaunchRequest = useRef(0);
  const barcodeLookupLock = useRef(false);
  const searchRequestGeneration = useRef(0);
  const suggestionRequestGeneration = useRef(0);
  const copyRequestGeneration = useRef(0);

  const normalisedQuery = query.replace(/\s+/g, " ").trim();
  const normalisedQueryKey = normaliseFoodSearchText(query);
  const matchingSearchResults =
    normalisedQueryKey === completedSearchQuery ? searchResults : [];
  const visibleResults =
    query.trim().length >= 2 ? matchingSearchResults : suggestions;
  const libraryCounts = useMemo(
    () => foodLibraryCounts(suggestions, mealPresets, recipes),
    [mealPresets, recipes, suggestions],
  );
  const library = useMemo(
    () => foodLibraryContent(libraryTab, suggestions, mealPresets, recipes),
    [libraryTab, mealPresets, recipes, suggestions],
  );
  const libraryEmpty =
    !library.foods.length && !library.meals.length && !library.recipes.length;

  const draftItems = useMemo(
    () =>
      selected.flatMap((item): FoodLogItemDraft[] => {
        const amount = resolveSelectedFoodCanonicalAmount({
          canonicalAmount: item.canonicalAmount,
          amountEdited: item.amountEdited,
          displayAmount: amountNumber(item.amount, regional.locale),
          unit: item.unit,
          countryCode: regional.countryCode,
        });
        return amount !== undefined && amount > 0
          ? [
              {
                food: item.food,
                amount,
                unit: item.food.basisUnit,
              },
            ]
          : [];
      }),
    [regional.countryCode, regional.locale, selected],
  );
  const nutrition = useMemo(() => {
    try {
      return totalNutrition(draftItems);
    } catch {
      return {};
    }
  }, [draftItems]);
  const nutritionPresentation = useMemo(
    () => presentFoodNutrition(nutrition),
    [nutrition],
  );

  function resetLookupState() {
    copyRequestGeneration.current += 1;
    setError(undefined);
    foodSearchScheduler.cancel();
    setSearchResults([]);
    setCompletedSearchQuery("");
    setSearchMessage(undefined);
    setFoodSearching(false);
    setSubmittedSearchActive(false);
    setSearchRetryAvailable(false);
    setQuickCarbOpen(false);
    setQuickCarbs("");
    setQuickCarbLabel("");
    setMealDetailsOpen(false);
    setMoreWaysOpen(false);
    setRecipeManagementOpen(false);
    setDataInfoOpen(false);
    setExpandedFoodIds(new Set());
    setBarcodeEntryOpen(false);
    setBarcode("");
    setBarcodeMessage(undefined);
    setBarcodeError(undefined);
    setCameraSettingsRequired(false);
    setCustomOpen(false);
    setCustomFood(EMPTY_CUSTOM_FOOD);
    setEditingMyFoodId(undefined);
    setMyFoodsManaging(false);
    setRecipeSaveOpen(false);
    setEditingRecipeId(undefined);
    setRecipeName("");
    setRecipeServings("4");
    setLibraryTab("recent");
    setCopyOpen(false);
    setCopySourceLogs([]);
    setCopySelectedIdentities([]);
    setCopyMode("append");
    setCopyLoading(false);
    setCopyError(undefined);
    setCopyActionError(undefined);
    setCopyUndo(undefined);
    setSuggestionError(undefined);
  }

  async function loadSuggestions() {
    const generation = ++suggestionRequestGeneration.current;
    setLoadingSuggestions(true);
    try {
      const [response, recentMeals, savedRecipes] = await Promise.all([
        searchFoods("", { limit: 20, mode: "typeahead" }),
        getRecentMealPresets(12),
        getFoodRecipes(20),
      ]);
      if (generation !== suggestionRequestGeneration.current) return;
      if (response) {
        setSuggestions(response.results);
        setFavoriteIds(
          new Set(
            response.results.flatMap((result) =>
              result.isFavourite ? searchResultCandidateIds(result) : [],
            ),
          ),
        );
      }
      setMealPresets(recentMeals);
      setRecipes(savedRecipes);
      setSuggestionError(undefined);
    } catch (loadError) {
      if (generation !== suggestionRequestGeneration.current) return;
      setSuggestionError(
        loadError instanceof Error
          ? loadError.message
          : "Saved foods, meals and recipes could not be loaded.",
      );
    } finally {
      if (generation === suggestionRequestGeneration.current) {
        setLoadingSuggestions(false);
      }
    }
  }

  async function loadCopySourceDate(date: DateKey) {
    const generation = ++copyRequestGeneration.current;
    setCopySourceDate(date);
    setCopySelectedIdentities([]);
    setCopyLoading(true);
    setCopyError(undefined);
    setCopyActionError(undefined);
    try {
      const logs = await getFoodLogs(
        {
          start: zonedDateTimeToTimestamp(date, 0, 0, 0, regional.timeZone),
          end: zonedDateTimeToTimestamp(
            addDays(date, 1),
            0,
            0,
            0,
            regional.timeZone,
          ),
        },
        100,
      );
      if (generation !== copyRequestGeneration.current) return;
      setCopySourceLogs(logs);
      setCopySelectedIdentities(
        defaultFoodCopyItemIdentities(logs, mealType),
      );
    } catch (loadError) {
      if (generation !== copyRequestGeneration.current) return;
      setCopySourceLogs([]);
      setCopyError(
        loadError instanceof Error
          ? loadError.message
          : "Saved meals could not be loaded from this phone.",
      );
    } finally {
      if (generation === copyRequestGeneration.current) {
        setCopyLoading(false);
      }
    }
  }

  function beginCopyFromDay() {
    const previousDate = addDays(
      toDateKey(timestamp, regional.timeZone),
      -1,
    );
    setCopyMode("append");
    setCopyOpen(true);
    void loadCopySourceDate(previousDate);
  }

  function cancelCopyFromDay() {
    copyRequestGeneration.current += 1;
    setCopyOpen(false);
    setCopyLoading(false);
    setCopyError(undefined);
    setCopyActionError(undefined);
    setCopySelectedIdentities([]);
  }

  function applyCopyToDraft(
    selections: FoodCopySelection[],
    mode: FoodCopyMode,
    ambiguousTimeResolution: AmbiguousFoodCopyTimeResolution = "reject",
  ) {
    try {
      const plan = planFoodLogCopy({
        sourceLogs: copySourceLogs,
        selections,
        sourceTimeZone: regional.timeZone,
        destination: {
          date: toDateKey(timestamp, regional.timeZone),
          timeZone: regional.timeZone,
          mealType,
        },
        mode,
        ambiguousTimeResolution,
      });
      const copied = plan.copies.flatMap((copy) =>
        copy.draft.items.map((item) =>
          selectedFoodState(item.food, item.amount, undefined, regional),
        ),
      );
      const beforeCopy = selected;
      setSelected(mode === "replace" ? copied : [...selected, ...copied]);
      setCopyUndo({
        selected: beforeCopy,
        message: `${formatRegionalNumber(copied.length, regional.locale, { maximumFractionDigits: 0 })} ${copied.length === 1 ? "food" : "foods"} copied from ${formatDate(
          copySourceDate,
          { weekday: "short", day: "numeric", month: "short" },
        )}.`,
      });
      setCopyOpen(false);
      setCopySelectedIdentities([]);
      setCopyError(undefined);
      setCopyActionError(undefined);
      setError(undefined);
      setQuery("");
    } catch (copyFailure) {
      const message =
        copyFailure instanceof Error
          ? copyFailure.message
          : "The selected foods could not be copied.";
      if (
        ambiguousTimeResolution === "reject" &&
        message.includes("occurs twice")
      ) {
        Alert.alert(
          "This clock time occurs twice",
          `${message} Choose which occurrence the copied source time represents. Your current meal time will not change.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "First occurrence",
              onPress: () => applyCopyToDraft(selections, mode, "earlier"),
            },
            {
              text: "Second occurrence",
              onPress: () => applyCopyToDraft(selections, mode, "later"),
            },
          ],
        );
        return;
      }
      setCopyActionError(message);
    }
  }

  function undoLastDraftCopy() {
    if (!copyUndo) return;
    setSelected(copyUndo.selected);
    setCopyUndo(undefined);
  }

  function invalidateDraftCopyUndo() {
    setCopyUndo(undefined);
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
    setTitle(draft.title ?? "");
    setSelected(
      draft.items.map((item, index) =>
        selectedFoodState(
          item.food,
          item.amount,
          undefined,
          regional,
          `saved-item:${log.items[index]?.id ?? index}`,
        ),
      ),
    );
    setQuery("");
    resetLookupState();
    setOpen(true);
    await loadSuggestions();
  }

  function clearEditedDraft() {
    setSelected([]);
    setTitle("");
    setQuery("");
    resetLookupState();
  }

  function close() {
    if (saving || customSaving || recipeSaving) return;
    const customFoodChanged =
      customFood.name.trim() ||
      customFood.brand.trim() ||
      customFood.serving !== EMPTY_CUSTOM_FOOD.serving ||
      customFood.unit !== EMPTY_CUSTOM_FOOD.unit ||
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
      editingRecipeId
        ? "Discard recipe changes?"
        : editingLog
          ? "Discard these changes?"
          : "Discard this meal?",
      editingRecipeId
        ? "The saved recipe will stay unchanged."
        : "Nothing from this draft will be saved.",
      [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: discard },
      ],
    );
  }

  function applyFoodSearchResponse(
    response: FoodSearchResponse,
    mode: "typeahead" | "submitted" = "typeahead",
  ) {
    setSearchResults(response.results);
    setCompletedSearchQuery(normaliseFoodSearchText(response.query));
    setFavoriteIds((current) => {
      const next = new Set(current);
      for (const result of response.results) {
        for (const id of searchResultCandidateIds(result)) {
          if (result.isFavourite) next.add(id);
          else next.delete(id);
        }
      }
      return next;
    });
    const remoteError = response.providers.find(
      (provider) => provider.kind === "remote" && provider.state === "error",
    );
    const retryRemote = mode === "submitted" && Boolean(remoteError);
    setSearchRetryAvailable(retryRemote);
    setSearchMessage(
      retryRemote
        ? response.results.length
          ? "Branded matches could not be refreshed. Saved and reference foods are still shown."
          : (remoteError?.message ?? "Branded foods could not be reached.")
        : undefined,
    );
  }

  async function submitFoodSearch() {
    Keyboard.dismiss();
    if (normalisedQuery.length < 2) return;
    const requestGeneration = ++searchRequestGeneration.current;
    setFoodSearching(true);
    setSubmittedSearchActive(true);
    setSearchRetryAvailable(false);
    setSearchMessage(undefined);
    setError(undefined);
    try {
      const response = await foodSearchScheduler.request(normalisedQuery, {
        immediate: true,
        limit: 20,
        mode: "submitted",
      });
      if (!response || searchRequestGeneration.current !== requestGeneration) {
        return;
      }
      applyFoodSearchResponse(response, "submitted");
    } catch (searchError) {
      if (searchRequestGeneration.current !== requestGeneration) return;
      setSearchMessage(
        searchError instanceof Error
          ? searchError.message
          : "Food search could not be completed. Try again.",
      );
      setSearchRetryAvailable(true);
    } finally {
      if (searchRequestGeneration.current === requestGeneration) {
        setFoodSearching(false);
        setSubmittedSearchActive(false);
      }
    }
  }

  useEffect(() => {
    if (
      launchRequest === undefined ||
      launchRequest <= handledLaunchRequest.current
    ) {
      return;
    }
    handledLaunchRequest.current = launchRequest;
    // The parent deliberately supplies an incrementing event token. Opening here
    // must initialise the draft from the latest props before the modal is shown.
    void begin();
    // `begin` intentionally reads the latest timestamp, region and repositories;
    // only a new event token should replay this command.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest]);

  useEffect(() => {
    if (!editingLog) return;
    // `editingLog` is an imperative edit command from the owning timeline. The
    // form must be populated before exposing the modal for that command.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void beginEdit(editingLog);
    // `beginEdit` intentionally uses the latest regional formatter and loaders;
    // replay is keyed only by the selected immutable log object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingLog]);

  useEffect(() => {
    if (!open) return;
    const searchKey = normalisedQuery.toLocaleLowerCase(
      getRuntimeRegionalDefaults().locale,
    );
    if (searchKey.length < 2) {
      searchRequestGeneration.current += 1;
      foodSearchScheduler.cancel();
      // Clearing a now-invalid query is part of synchronising the debounced
      // scheduler with the current input, not derived render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      setCompletedSearchQuery("");
      setSearchMessage(undefined);
      setFoodSearching(false);
      setSubmittedSearchActive(false);
      setSearchRetryAvailable(false);
      return;
    }

    let active = true;
    const requestGeneration = ++searchRequestGeneration.current;
    setFoodSearching(true);
    setSubmittedSearchActive(false);
    setSearchRetryAvailable(false);
    setSearchMessage(undefined);
    setError(undefined);
    void foodSearchScheduler
      .request(normalisedQuery, { limit: 20 })
      .then((response) => {
        if (
          !active ||
          !response ||
          searchRequestGeneration.current !== requestGeneration
        ) {
          return;
        }
        applyFoodSearchResponse(response);
      })
      .catch((searchError) => {
        if (!active || searchRequestGeneration.current !== requestGeneration) {
          return;
        }
        setSearchMessage(
          searchError instanceof Error
            ? searchError.message
            : "Food search could not be completed. Try again.",
        );
      })
      .finally(() => {
        if (active && searchRequestGeneration.current === requestGeneration) {
          setFoodSearching(false);
        }
      });
    return () => {
      active = false;
    };
  }, [foodSearchScheduler, normalisedQuery, open]);

  useEffect(
    () => () => {
      copyRequestGeneration.current += 1;
      foodSearchScheduler.dispose();
    },
    [foodSearchScheduler],
  );

  function addFood(
    food: FoodCandidate,
    options: {
      dataStatus?: SelectedFood["dataStatus"];
      allowDuplicate?: boolean;
      amount?: number;
      rowId?: string;
    } = {},
  ) {
    if (food.nutritionPerBasis.carbohydrateGrams === undefined) {
      setError(
        `${food.name} has no carbohydrate value in its source. Use the carb-only form instead.`,
      );
      return;
    }
    invalidateDraftCopyUndo();
    setError(undefined);
    setSelected((items) => {
      if (
        !options.allowDuplicate &&
        items.some((item) => item.food.id === food.id)
      ) {
        return items;
      }
      return [
        ...items,
        selectedFoodState(
          food,
          options.amount,
          options.dataStatus,
          regional,
          options.rowId,
        ),
      ];
    });
    setQuery("");
    setSearchMessage(undefined);
    Keyboard.dismiss();
  }

  function isResultFavorite(result: RankedFoodSearchResult) {
    return searchResultCandidateIds(result).some((id) => favoriteIds.has(id));
  }

  async function toggleFavorite(result: RankedFoodSearchResult) {
    if (favoriteBusy) return;
    const currentlyFavorite = isResultFavorite(result);
    const favorite = !currentlyFavorite;
    const mutation = favoriteMutationPlanForSearchResult(
      result,
      currentlyFavorite,
      favoriteIds,
    );
    const relatedIds = searchResultCandidateIds(result);
    setFavoriteBusy(result.food.id);
    setError(undefined);
    try {
      const writeLease = await acquireLocalDataWriteLease();
      if (mutation.storedIdentities.length) {
        await setStoredFoodFavoritesByIdentity(
          mutation.storedIdentities,
          favorite,
          writeLease,
        );
      } else if (favorite && mutation.insertFood) {
        await setFoodFavorite(mutation.insertFood, true, writeLease);
      } else {
        throw new Error("The saved food is no longer available.");
      }
      await assertLocalDataWriteLeaseCurrent(writeLease);
      setFavoriteIds((current) => {
        const next = new Set(current);
        for (const id of relatedIds) {
          if (favorite) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      setBarcodeMessage(
        favorite
          ? `${result.food.name} added to favourites.`
          : `${result.food.name} removed from favourites.`,
      );
    } catch (favoriteError) {
      if (isLocalDataWriteSupersededError(favoriteError)) return;
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : "The favourite could not be updated.",
      );
    } finally {
      setFavoriteBusy(undefined);
    }
  }

  function updateAmount(rowId: string, amount: string) {
    invalidateDraftCopyUndo();
    setSelected((items) =>
      items.map((item) =>
        item.rowId === rowId
          ? {
              ...item,
              amount,
              amountEdited: true,
              count:
                amountNumber(amount, regional.locale) &&
                amountNumber(item.portionAmount, regional.locale)
                  ? inputNumber(
                      amountNumber(amount, regional.locale)! /
                        amountNumber(item.portionAmount, regional.locale)!,
                      regional.locale,
                    )
                  : "",
            }
          : item,
      ),
    );
  }

  function updatePortionAmount(rowId: string, portionAmount: string) {
    invalidateDraftCopyUndo();
    setSelected((items) =>
      items.map((item) => {
        if (item.rowId !== rowId) return item;
        const portion = amountNumber(portionAmount, regional.locale);
        const count = amountNumber(item.count, regional.locale);
        const nextAmount =
          portion && portion > 0 && count && count > 0
            ? inputNumber(portion * count, regional.locale)
            : undefined;
        return {
          ...item,
          portionAmount,
          amount: nextAmount ?? item.amount,
          amountEdited: nextAmount === undefined ? item.amountEdited : true,
        };
      }),
    );
  }

  function updateCount(rowId: string, countValue: string) {
    invalidateDraftCopyUndo();
    setSelected((items) =>
      items.map((item) => {
        if (item.rowId !== rowId) return item;
        const count = amountNumber(countValue, regional.locale);
        const portion = amountNumber(item.portionAmount, regional.locale);
        const nextAmount =
          count && count > 0 && portion && portion > 0
            ? inputNumber(count * portion, regional.locale)
            : undefined;
        return {
          ...item,
          count: countValue,
          amount: nextAmount ?? item.amount,
          amountEdited: nextAmount === undefined ? item.amountEdited : true,
        };
      }),
    );
  }

  function adjustCount(item: SelectedFood, change: number) {
    const current =
      amountNumber(item.count, regional.locale) ?? (change > 0 ? 0 : 1);
    updateCount(
      item.rowId,
      inputNumber(Math.max(0.5, current + change), regional.locale),
    );
  }

  function removeFood(rowId: string) {
    invalidateDraftCopyUndo();
    setSelected((items) => items.filter((item) => item.rowId !== rowId));
    setExpandedFoodIds((current) => {
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
  }

  function toggleFoodDetails(rowId: string) {
    setExpandedFoodIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function applyMealPreset(preset: FoodMealPreset) {
    invalidateDraftCopyUndo();
    setMealType(preset.mealType);
    setSelected(
      preset.items.map((item) =>
        selectedFoodState(item.food, item.amount, undefined, regional),
      ),
    );
    setQuery("");
    setError(undefined);
  }

  function applyRecipe(recipe: FoodRecipe) {
    invalidateDraftCopyUndo();
    setMealType(recipe.mealType);
    setTitle(recipe.name);
    setSelected(
      servingFromRecipe(recipe).map((ingredient) =>
        selectedFoodState(
          ingredient.food,
          ingredient.amount,
          undefined,
          regional,
        ),
      ),
    );
    setQuery("");
    setError(undefined);
    setBarcodeMessage(`One serving of ${recipe.name} added.`);
  }

  function beginEditRecipe(recipe: FoodRecipe) {
    resetLookupState();
    invalidateDraftCopyUndo();
    setMealType(recipe.mealType);
    setTitle("");
    setSelected(
      recipe.ingredients.map((ingredient, index) =>
        selectedFoodState(
          ingredient.food,
          ingredient.amount,
          undefined,
          regional,
          `recipe-item:${recipe.id}:${index}`,
        ),
      ),
    );
    setEditingRecipeId(recipe.id);
    setRecipeName(recipe.name);
    setRecipeServings(
      formatRegionalNumberInput(recipe.servings, regional.locale, 2),
    );
    setRecipeSaveOpen(true);
    setLibraryTab("recipes");
    setBarcodeMessage(
      `Editing ${recipe.name}. Update the recipe when the full batch is correct.`,
    );
  }

  async function saveRecipe() {
    if (recipeSaving) return;
    if (draftItems.length !== selected.length) {
      setError("Check each ingredient amount before saving the recipe.");
      return;
    }
    const servings = amountNumber(recipeServings, regional.locale);
    setRecipeSaving(true);
    setError(undefined);
    try {
      const writeLease = await acquireLocalDataWriteLease();
      const recipeDraft = {
        name: recipeName,
        mealType,
        servings: servings ?? Number.NaN,
        ingredients: draftItems,
      };
      const existingRecipe = editingRecipeId
        ? recipes.find((recipe) => recipe.id === editingRecipeId)
        : undefined;
      if (editingRecipeId && !existingRecipe) {
        throw new Error("The recipe could not be found. Refresh and try again.");
      }
      const recipe = existingRecipe
        ? await updateFoodRecipe(existingRecipe, recipeDraft, writeLease)
        : await saveFoodRecipe(recipeDraft, writeLease);
      await assertLocalDataWriteLeaseCurrent(writeLease);
      setRecipes((current) =>
        (existingRecipe
          ? current.map((item) => (item.id === recipe.id ? recipe : item))
          : [recipe, ...current]
        ).sort(
          (left, right) =>
            Number(right.isFavorite) - Number(left.isFavorite) ||
            right.updatedAt - left.updatedAt,
        ),
      );
      setRecipeSaveOpen(false);
      setEditingRecipeId(undefined);
      setRecipeName("");
      setRecipeServings("4");
      if (existingRecipe) {
        setSelected([]);
        setTitle("");
        setLibraryTab("recipes");
      }
      const perServing = displayNumber(
        recipeNutritionPerServing(recipe).carbohydrateGrams ?? 0,
        " g carbs per serving",
      );
      setBarcodeMessage(
        existingRecipe
          ? `Recipe updated · ${perServing}. Logged meals stay unchanged.`
          : `${recipe.name} saved · ${perServing}.`,
      );
    } catch (recipeError) {
      if (isLocalDataWriteSupersededError(recipeError)) return;
      setError(
        recipeError instanceof Error
          ? recipeError.message
          : "The recipe could not be saved.",
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
      const writeLease = await acquireLocalDataWriteLease();
      await setFoodRecipeFavorite(recipe.id, favorite, writeLease);
      await assertLocalDataWriteLeaseCurrent(writeLease);
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
      if (isLocalDataWriteSupersededError(favoriteError)) return;
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : "The recipe could not be updated.",
      );
    } finally {
      setRecipeActionBusy(undefined);
    }
  }

  function confirmDeleteRecipe(recipe: FoodRecipe) {
    Alert.alert(
      `Delete ${recipe.name}?`,
      "This removes the saved recipe. Meals you already logged stay in your history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete recipe",
          style: "destructive",
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
      const writeLease = await acquireLocalDataWriteLease();
      await deleteFoodRecipe(recipe.id, writeLease);
      await assertLocalDataWriteLeaseCurrent(writeLease);
      setRecipes((current) => current.filter((item) => item.id !== recipe.id));
      setBarcodeMessage(`${recipe.name} deleted.`);
    } catch (deleteError) {
      if (isLocalDataWriteSupersededError(deleteError)) return;
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The recipe could not be deleted.",
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
      const writeLease = await acquireLocalDataWriteLease();
      await setMealPresetFavorite(preset.id, favorite, writeLease);
      await assertLocalDataWriteLeaseCurrent(writeLease);
      setMealPresets((current) =>
        current
          .map((meal) =>
            meal.id === preset.id ? { ...meal, isFavorite: favorite } : meal,
          )
          .sort(
            (left, right) => Number(right.isFavorite) - Number(left.isFavorite),
          ),
      );
      setBarcodeMessage(
        favorite
          ? `${preset.title} saved for quick repeat.`
          : `${preset.title} removed from saved meals.`,
      );
    } catch (favoriteError) {
      if (isLocalDataWriteSupersededError(favoriteError)) return;
      setError(
        favoriteError instanceof Error
          ? favoriteError.message
          : "The saved meal could not be updated.",
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

  function beginEditMyFood(food: FoodCandidate) {
    setEditingMyFoodId(food.id);
    setCustomFood(customFoodFormFromCandidate(food, regional));
    setBarcode(food.barcode ?? "");
    setMoreWaysOpen(true);
    setCustomOpen(true);
    setError(undefined);
    setBarcodeMessage(`Editing ${food.name}. Saved meal history will not change.`);
  }

  function confirmDeleteMyFood(food: FoodCandidate) {
    Alert.alert(
      `Delete ${food.name}?`,
      "It will leave My Foods. Meals already logged keep their original nutrition snapshot.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setMyFoodActionBusy(food.id);
              setError(undefined);
              try {
                const writeLease = await acquireLocalDataWriteLease();
                await deleteMyFood(food.id, writeLease);
                await assertLocalDataWriteLeaseCurrent(writeLease);
                setSuggestions((current) =>
                  current.filter((result) => result.food.id !== food.id),
                );
                setBarcodeMessage(
                  `${food.name} removed from My Foods. Logged meals were kept.`,
                );
                if (editingMyFoodId === food.id) {
                  setEditingMyFoodId(undefined);
                  setCustomFood(EMPTY_CUSTOM_FOOD);
                  setCustomOpen(false);
                }
                void loadSuggestions();
              } catch (deleteError) {
                if (isLocalDataWriteSupersededError(deleteError)) return;
                setError(
                  deleteError instanceof Error
                    ? deleteError.message
                    : "The food could not be removed from My Foods.",
                );
              } finally {
                setMyFoodActionBusy(undefined);
              }
            })();
          },
        },
      ],
    );
  }

  async function addCustomFood() {
    if (customSaving) return;
    setError(undefined);
    setCustomSaving(true);
    try {
      const draft = customFoodDraftFromForm(customFood, barcode, regional);
      const writeLease = await acquireLocalDataWriteLease();
      const food = editingMyFoodId
        ? await updateMyFood(editingMyFoodId, draft, { lease: writeLease })
        : await createMyFood(draft, { lease: writeLease });
      await assertLocalDataWriteLeaseCurrent(writeLease);
      const resetEditedSelection = Boolean(
        editingMyFoodId &&
          selected.some(
            (item) =>
              item.food.id === editingMyFoodId &&
              !myFoodSelectionUnitIsCompatible(item.unit, food.basisUnit),
          ),
      );
      invalidateDraftCopyUndo();
      setSelected((items) => {
        const updated = editingMyFoodId
          ? items.map((item) =>
              item.food.id !== editingMyFoodId
                ? item
                : myFoodSelectionUnitIsCompatible(item.unit, food.basisUnit)
                  ? { ...item, food }
                  : selectedFoodState(
                      food,
                      undefined,
                      item.dataStatus,
                      regional,
                      item.rowId,
                    ),
            )
          : items;
        if (updated.some((item) => item.food.id === food.id)) return updated;
        return [...updated, selectedFoodState(food, undefined, undefined, regional)];
      });
      setCustomFood(EMPTY_CUSTOM_FOOD);
      setEditingMyFoodId(undefined);
      setCustomOpen(false);
      setBarcode("");
      setBarcodeEntryOpen(false);
      setBarcodeMessage(
        `${food.name} ${editingMyFoodId ? "updated" : "saved"} in My Foods and added to this meal${
          food.barcode ? ". Its barcode now works offline" : ""
        }.${
          resetEditedSelection
            ? " Its selected amount was reset to the updated serving because mass and volume cannot be converted without a density. Review it before saving."
            : ""
        }`,
      );
      setLibraryTab("my-foods");
      void loadSuggestions();
    } catch (customError) {
      if (isLocalDataWriteSupersededError(customError)) return;
      setError(
        customError instanceof Error
          ? customError.message
          : "The custom food could not be saved.",
      );
    } finally {
      setCustomSaving(false);
    }
  }

  function addQuickCarbs() {
    setError(undefined);
    try {
      const food = createQuickCarbCandidate(
        amountNumber(quickCarbs, regional.locale) ?? Number.NaN,
        quickCarbLabel,
      );
      addFood(food);
      setQuickCarbs("");
      setQuickCarbLabel("");
      setQuickCarbOpen(false);
      setBarcodeMessage(`${food.name} added as a carb-only entry.`);
    } catch (quickError) {
      setError(
        quickError instanceof Error
          ? quickError.message
          : "The carbohydrate entry could not be added.",
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
          ? "Camera access is blocked for T1 Arc. Allow Camera in app settings, or enter the barcode number instead."
          : "Camera access is needed only to read the barcode. You can enter the number instead.",
      );
      setBarcodeEntryOpen(true);
      setMoreWaysOpen(true);
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
    let normalisedBarcode = value.replace(/\D/g, "");
    let staleFood: FoodCandidate | undefined;
    try {
      normalisedBarcode = normaliseFoodBarcode(value);
      setBarcode(normalisedBarcode);
      const barcodeRegion = {
        countryCode: regional.countryCode,
        languageTag: regional.locale,
      };
      const cacheEntry = await getFoodBarcodeCacheEntry(
        normalisedBarcode,
        Date.now(),
        barcodeRegion,
      );
      if (barcodeCacheLookupPlan(cacheEntry?.status) === "use-cache") {
        const cachedFood = cacheEntry!.food;
        addFood(cachedFood);
        setBarcode("");
        setBarcodeEntryOpen(false);
        setBarcodeMessage(`${cachedFood.name} found on this phone.`);
        return;
      }
      staleFood = cacheEntry?.regionalMatch ? cacheEntry.food : undefined;

      let food: FoodCandidate;
      try {
        food = await lookupOpenFoodFactsBarcode(
          normalisedBarcode,
          globalThis.fetch,
          barcodeRegion,
        );
      } catch (openFoodFactsError) {
        const canTryUsda = shouldTryFoodDataCentralBarcodeFallback(
          regional.countryCode,
          openFoodFactsError,
        );
        if (!canTryUsda) throw openFoodFactsError;
        food = await lookupFoodDataCentralBarcode(
          normalisedBarcode,
          globalThis.fetch,
        );
      }
      addFood(food);
      setBarcode("");
      setBarcodeEntryOpen(false);
      setBarcodeMessage(
        `${food.name}${food.brand ? ` · ${food.brand}` : ""} found.`,
      );
    } catch (lookupError) {
      const errorCode =
        lookupError instanceof FoodLookupError ? lookupError.code : undefined;
      if (staleFood && canUseStaleBarcodeFallback(errorCode)) {
        addFood(staleFood, { dataStatus: "stale" });
        setBarcode("");
        setBarcodeEntryOpen(false);
        setBarcodeMessage(staleBarcodeFallbackMessage(staleFood.name));
        return;
      }
      const canCreateFromLabel =
        lookupError instanceof FoodLookupError &&
        (lookupError.code === "not_found" || lookupError.code === "incomplete");
      setBarcodeError(
        canCreateFromLabel
          ? `${lookupError.message} Enter it once from the label below; T1 Arc will remember this barcode on your phone.`
          : lookupError instanceof FoodLookupError
            ? lookupError.message
            : "The barcode could not be looked up.",
      );
      setBarcodeEntryOpen(!canCreateFromLabel);
      setCustomOpen(canCreateFromLabel);
      setMoreWaysOpen(true);
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

  function handleModalBack() {
    if (saving || customSaving || recipeSaving) return;
    if (copyOpen) {
      cancelCopyFromDay();
      return;
    }
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    if (customOpen) {
      setCustomOpen(false);
      return;
    }
    if (quickCarbOpen) {
      setQuickCarbOpen(false);
      return;
    }
    if (barcodeEntryOpen) {
      setBarcodeEntryOpen(false);
      return;
    }
    if (recipeSaveOpen && !editingRecipeId) {
      setRecipeSaveOpen(false);
      return;
    }
    if (mealDetailsOpen) {
      setMealDetailsOpen(false);
      return;
    }
    if (moreWaysOpen) {
      setMoreWaysOpen(false);
      return;
    }
    close();
  }

  function applyWallClockSelection(
    date: DateKey,
    hour: number,
    minute: number,
    resolution: AmbiguousWallClockResolution = "reject",
  ) {
    try {
      setTimestamp(
        resolveZonedWallClock(
          date,
          hour,
          minute,
          0,
          regional.timeZone,
          resolution,
        ),
      );
      setError(undefined);
    } catch (selectionError) {
      if (
        selectionError instanceof ZonedWallClockError &&
        selectionError.kind === "ambiguous" &&
        resolution === "reject"
      ) {
        Alert.alert(
          "This clock time occurs twice",
          `${selectionError.message} Which occurrence do you mean?`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "First occurrence",
              onPress: () => applyWallClockSelection(date, hour, minute, "earlier"),
            },
            {
              text: "Second occurrence",
              onPress: () => applyWallClockSelection(date, hour, minute, "later"),
            },
          ],
        );
        return;
      }
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : "That date and time could not be selected.",
      );
    }
  }

  function chooseDate() {
    DateTimePickerAndroid.open({
      value: pickerDateForZonedTimestamp(timestamp, regional.timeZone),
      mode: "date",
      maximumDate: pickerDateForZonedTimestamp(Date.now(), regional.timeZone),
      onChange: (event, value) => {
        if (event.type !== "set" || !value) return;
        const date = dateKeyFromPickerDate(value);
        const { hour, minute } = wallClockFromPickerDate(
          pickerTimeForZonedTimestamp(timestamp, regional.timeZone),
        );
        applyWallClockSelection(date, hour, minute);
      },
    });
  }

  function chooseTime() {
    DateTimePickerAndroid.open({
      value: pickerTimeForZonedTimestamp(timestamp, regional.timeZone),
      mode: "time",
      is24Hour: regionalClockUses24Hours(regional.locale),
      onChange: (event, value) => {
        if (event.type !== "set" || !value) return;
        const { hour, minute } = wallClockFromPickerDate(value);
        applyWallClockSelection(
          toDateKey(timestamp, regional.timeZone),
          hour,
          minute,
        );
      },
    });
  }

  async function save() {
    setError(undefined);
    if (!selected.length) {
      setError("Add at least one food.");
      return;
    }
    if (draftItems.length !== selected.length) {
      setError("Check each food amount.");
      return;
    }
    setSaving(true);
    try {
      const writeLease = await acquireLocalDataWriteLease();
      const draft = {
        timestamp,
        mealType,
        title: title.trim() || undefined,
        items: draftItems,
      };
      const log = editingLog
        ? await updateFoodLog(editingLog, draft, writeLease)
        : await logFood(draft, writeLease);
      await assertLocalDataWriteLeaseCurrent(writeLease);
      setSavedMessage(
        `${log.title} · ${displayNumber(
          log.nutrition.carbohydrateGrams,
          " g carbs",
        )}`,
      );
      setSelected([]);
      setTitle("");
      setQuery("");
      setOpen(false);
      if (editingLog) onEditEnd?.();
    } catch (nextError) {
      if (isLocalDataWriteSupersededError(nextError)) return;
      setError(
        nextError instanceof Error
          ? nextError.message
          : `The meal could not be ${editingLog ? "updated" : "saved"}.`,
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
                borderColor: colors.surfaceBorder,
                borderRadius: radius.lg,
                opacity: pressed ? 0.72 : 1,
                shadowColor: colors.surfaceShadow,
              },
            ]}
          >
            <LinearGradient
              colors={[
                colors.surfaceGradientStart,
                colors.surfaceGradientMiddle,
                colors.surfaceGradientEnd,
              ]}
              end={{ x: 0.94, y: 1 }}
              locations={[0, 0.5, 1]}
              pointerEvents="none"
              start={{ x: 0.02, y: 0 }}
              style={[StyleSheet.absoluteFill, { borderRadius: radius.lg }]}
            />
            <SurfaceSheen radius={radius.lg} />
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
                style={[styles.compactDetail, { color: colors.textSecondary }]}
              >
                Search, scan or repeat
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
                <Text
                  style={[styles.cardBody, { color: colors.textSecondary }]}
                >
                  {showCofid
                    ? "Search UK foods and branded products together, scan a barcode, or repeat a saved meal."
                    : showUsda
                      ? "Search US foods and branded products together, scan a barcode, or repeat a saved meal."
                      : showMextJapan
                        ? "Search Japanese reference foods and branded products together, scan a barcode, or repeat a saved meal."
                        : "Search regional branded products, scan a barcode, or repeat a saved meal."}
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
              <Text
                style={[styles.openButtonText, { color: colors.onPrimary }]}
              >
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
                <Text
                  style={[styles.savedText, { color: colors.textSecondary }]}
                >
                  {savedMessage}
                </Text>
              </View>
            ) : null}
          </SectionCard>
        )
      ) : null}

      <Modal
        animationType="slide"
        onShow={onModalShow}
        onRequestClose={handleModalBack}
        presentationStyle="pageSheet"
        statusBarTranslucent
        visible={open}
      >
        <SafeAreaView
          accessibilityElementsHidden={copyOpen || scannerOpen}
          edges={["top", "bottom"]}
          importantForAccessibility={
            copyOpen || scannerOpen ? "no-hide-descendants" : "auto"
          }
          style={[styles.modal, { backgroundColor: colors.background }]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modal}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: colors.divider },
              ]}
            >
              <View style={styles.modalHeaderCopy}>
                <Text
                  accessibilityRole="header"
                  style={[styles.modalTitle, { color: colors.text }]}
                >
                  {editingRecipeId
                    ? "Edit recipe"
                    : editingLog
                      ? "Edit meal"
                      : "Add food"}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.modalSubtitle,
                    { color: colors.textSecondary },
                  ]}
                >
                  Private and stored on this phone
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close food logger"
                accessibilityRole="button"
                disabled={saving || recipeSaving}
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
              {editingRecipeId ? (
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
                    name="book-outline"
                    size={20}
                  />
                  <View style={styles.editNoticeCopy}>
                    <Text
                      style={[styles.editNoticeTitle, { color: colors.text }]}
                    >
                      Update the saved recipe
                    </Text>
                    <Text
                      style={[
                        styles.editNoticeDetail,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Change the full batch, name or servings. Meals already in
                      History stay exactly as logged.
                    </Text>
                  </View>
                </View>
              ) : editingLog ? (
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
              <Pressable
                accessibilityHint="Opens meal type, date, time and optional label"
                accessibilityLabel={`${
                  mealTypes.find((option) => option.value === mealType)
                    ?.label ?? "Meal"
                }, ${formatDate(toDateKey(timestamp), {
                  day: "numeric",
                  month: "short",
                })} at ${formatTime(timestamp)}. Meal details`}
                accessibilityRole="button"
                accessibilityState={{ expanded: mealDetailsOpen }}
                onPress={() => setMealDetailsOpen((value) => !value)}
                style={({ pressed }) => [
                  styles.mealSummary,
                  {
                    backgroundColor: mealDetailsOpen
                      ? `${colors.primary}12`
                      : colors.surface,
                    borderColor: mealDetailsOpen
                      ? `${colors.primary}66`
                      : colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.72 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.mealSummaryIcon,
                    {
                      backgroundColor: `${colors.primary}14`,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="time-outline"
                    size={20}
                  />
                </View>
                <View style={styles.mealSummaryCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.mealSummaryTitle, { color: colors.text }]}
                  >
                    {
                      mealTypes.find((option) => option.value === mealType)
                        ?.label
                    }
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.mealSummaryDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {formatDate(toDateKey(timestamp), {
                      day: "numeric",
                      month: "short",
                    })}
                    {" · "}
                    {formatTime(timestamp)}
                    {title.trim() ? ` · ${title.trim()}` : ""}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.mealSummaryAction,
                    { color: colors.primaryStrong },
                  ]}
                >
                  {mealDetailsOpen ? "Done" : "Change"}
                </Text>
              </Pressable>

              {mealDetailsOpen ? (
                <View
                  style={[
                    styles.mealDetails,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <View style={styles.mealRow}>
                    {mealTypes.map((option) => {
                      const active = option.value === mealType;
                      return (
                        <Pressable
                          accessibilityLabel={option.label}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: active }}
                          key={option.value}
                          onPress={() => setMealType(option.value)}
                          style={({ pressed }) => [
                            styles.mealChip,
                            {
                              backgroundColor: active
                                ? `${colors.primary}18`
                                : colors.surface,
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
                      accessibilityLabel={`Change date, currently ${formatDate(
                        toDateKey(timestamp),
                      )}`}
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
                          day: "numeric",
                          month: "short",
                        })}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Change time, currently ${formatTime(timestamp)}`}
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
                      accessibilityLabel="Meal label, optional"
                      maxLength={120}
                      onChangeText={setTitle}
                      placeholder="Named automatically from the foods"
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
                  </View>
                </View>
              ) : null}
              <Pressable
                accessibilityHint="Choose whole meals or individual foods from an earlier day"
                accessibilityLabel="Copy foods from yesterday or another day"
                accessibilityRole="button"
                onPress={beginCopyFromDay}
                style={({ pressed }) => [
                  styles.copyFromDay,
                  {
                    backgroundColor: `${colors.accent}0F`,
                    borderColor: `${colors.accent}42`,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                <View
                  style={[
                    styles.copyFromDayIcon,
                    {
                      backgroundColor: `${colors.accent}18`,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="copy-outline"
                    size={20}
                  />
                </View>
                <View style={styles.copyFromDayCopy}>
                  <Text
                    style={[styles.copyFromDayTitle, { color: colors.text }]}
                  >
                    Copy from another day
                  </Text>
                  <Text
                    style={[
                      styles.copyFromDayDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Starts with the previous day; pick a meal or individual foods
                  </Text>
                </View>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="chevron-forward"
                  size={20}
                />
              </Pressable>

              {copyUndo ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.copyUndo,
                    {
                      backgroundColor: `${colors.accent}12`,
                      borderColor: `${colors.accent}4A`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="checkmark-circle-outline"
                    size={19}
                  />
                  <Text
                    style={[styles.copyUndoText, { color: colors.textSecondary }]}
                  >
                    {copyUndo.message}
                  </Text>
                  <Pressable
                    accessibilityLabel="Undo copied foods"
                    accessibilityRole="button"
                    onPress={undoLastDraftCopy}
                    style={({ pressed }) => [
                      styles.copyUndoAction,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.copyUndoActionText,
                        { color: colors.primaryStrong },
                      ]}
                    >
                      Undo
                    </Text>
                  </Pressable>
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
                  accessibilityLabel="Search foods and brands"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(value) => {
                    setQuery(value);
                    setError(undefined);
                    setSearchMessage(undefined);
                    setSearchRetryAvailable(false);
                  }}
                  onSubmitEditing={() => void submitFoodSearch()}
                  placeholder="Search foods and brands"
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
                    onPress={() => setQuery("")}
                    style={({ pressed }) => [
                      styles.searchIconButton,
                      { opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.textSecondary}
                      name="close-circle"
                      size={21}
                    />
                  </Pressable>
                ) : null}
                <View
                  accessibilityElementsHidden
                  style={[
                    styles.searchDivider,
                    { backgroundColor: colors.divider },
                  ]}
                />
                <Pressable
                  accessibilityHint="Uses the camera to find a packaged food"
                  accessibilityLabel={
                    barcodeLookingUp
                      ? "Looking up barcode"
                      : "Scan a food barcode"
                  }
                  accessibilityRole="button"
                  disabled={barcodeLookingUp}
                  onPress={() => void beginScan()}
                  style={({ pressed }) => [
                    styles.searchScanButton,
                    {
                      backgroundColor: `${colors.primary}12`,
                      borderRadius: radius.sm,
                      opacity: barcodeLookingUp ? 0.6 : pressed ? 0.68 : 1,
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
                      size={23}
                    />
                  )}
                </Pressable>
              </View>

              <Pressable
                accessibilityHint="Shows quick carbs, manual barcode entry and custom foods"
                accessibilityLabel="More ways to add food"
                accessibilityRole="button"
                accessibilityState={{ expanded: moreWaysOpen }}
                onPress={() => setMoreWaysOpen((value) => !value)}
                style={({ pressed }) => [
                  styles.moreWaysToggle,
                  {
                    backgroundColor: moreWaysOpen
                      ? `${colors.primary}0D`
                      : colors.surface,
                    borderColor: moreWaysOpen
                      ? `${colors.primary}55`
                      : colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textSecondary}
                  name="ellipsis-horizontal-circle-outline"
                  size={21}
                />
                <Text
                  style={[styles.moreWaysText, { color: colors.textSecondary }]}
                >
                  More ways to add
                </Text>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name={moreWaysOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                />
              </Pressable>

              {moreWaysOpen ? (
                <View style={styles.advancedEntryPanel}>
                  <Pressable
                    accessibilityLabel="Enter a barcode number"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: barcodeEntryOpen }}
                    onPress={() => setBarcodeEntryOpen((value) => !value)}
                    style={({ pressed }) => [
                      styles.customToggle,
                      {
                        backgroundColor: barcodeEntryOpen
                          ? `${colors.primary}12`
                          : colors.surface,
                        borderColor: barcodeEntryOpen
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
                        barcodeEntryOpen ? colors.primary : colors.textSecondary
                      }
                      name="keypad-outline"
                      size={20}
                    />
                    <View style={styles.customToggleCopy}>
                      <Text
                        style={[
                          styles.customToggleTitle,
                          { color: colors.text },
                        ]}
                      >
                        Enter barcode number
                      </Text>
                      <Text
                        style={[
                          styles.customToggleDetail,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Useful when the camera cannot read it
                      </Text>
                    </View>
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.textTertiary}
                      name={barcodeEntryOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                    />
                  </Pressable>

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
                          setBarcode(value.replace(/\D/g, ""))
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
                      <Text
                        style={[
                          styles.customToggleTitle,
                          { color: colors.text },
                        ]}
                      >
                        Just enter carbs
                      </Text>
                      <Text
                        style={[
                          styles.customToggleDetail,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Fast carb-only entry when the full label is not
                        available
                      </Text>
                    </View>
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.textTertiary}
                      name={quickCarbOpen ? "chevron-up" : "chevron-down"}
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
                        Stored explicitly as carb-only; no calories, protein or
                        fat are inferred.
                      </Text>
                    </View>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: customOpen }}
                    onPress={() => {
                      setCustomOpen((value) => {
                        const next = !value;
                        if (next && editingMyFoodId) {
                          setEditingMyFoodId(undefined);
                          setCustomFood(EMPTY_CUSTOM_FOOD);
                          setBarcode("");
                        }
                        return next;
                      });
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
                      <Text
                        style={[
                          styles.customToggleTitle,
                          { color: colors.text },
                        ]}
                      >
                        {editingMyFoodId ? "Edit My Food" : "Create a food"}
                      </Text>
                      <Text
                        style={[
                          styles.customToggleDetail,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {editingMyFoodId
                          ? "Update future uses; logged meals stay unchanged"
                          : "Add a missing product from its label"}
                      </Text>
                    </View>
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.textTertiary}
                      name={customOpen ? "chevron-up" : "chevron-down"}
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
                        onChangeText={(value) =>
                          updateCustomFood("name", value)
                        }
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
                        onChangeText={(value) =>
                          updateCustomFood("brand", value)
                        }
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
                              updateCustomFood("serving", value)
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
                          {[
                            ...foodInputUnits("g"),
                            ...foodInputUnits("ml"),
                          ].map((unit) => {
                            const active = customFood.unit === unit;
                            return (
                              <Pressable
                                accessibilityRole="radio"
                                accessibilityState={{ checked: active }}
                                key={unit}
                                onPress={() => updateCustomFood("unit", unit)}
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
                        style={[
                          styles.customHint,
                          { color: colors.textSecondary },
                        ]}
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
                            Barcode {barcode} will work offline after this meal
                            is saved.
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.customNutrientGrid}>
                        {[
                          ["carbs", "Carbs (g)", true],
                          [
                            "energy",
                            `Energy (${regional.energyUnit})`,
                            false,
                          ],
                          ["protein", "Protein (g)", false],
                          ["fat", "Fat (g)", false],
                          ["fibre", "Fibre (g)", false],
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
                              {required ? " *" : ""}
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
                                customFood[
                                  key as keyof CustomFoodForm
                                ] as string
                              }
                            />
                          </View>
                        ))}
                      </View>
                      <Pressable
                        accessibilityLabel="Save this custom food in My Foods and add it to the current meal"
                        accessibilityRole="button"
                        accessibilityState={{ busy: customSaving, disabled: customSaving }}
                        disabled={customSaving}
                        onPress={() => void addCustomFood()}
                        style={({ pressed }) => [
                          styles.customAddButton,
                          {
                            backgroundColor: colors.primary,
                            borderRadius: radius.sm,
                            opacity: customSaving ? 0.56 : pressed ? 0.74 : 1,
                          },
                        ]}
                      >
                        {customSaving ? (
                          <ActivityIndicator color={colors.onPrimary} size="small" />
                        ) : (
                          <Ionicons
                            accessibilityElementsHidden
                            color={colors.onPrimary}
                            name="bookmark-outline"
                            size={19}
                          />
                        )}
                        <Text
                          style={[
                            styles.customAddText,
                            { color: colors.onPrimary },
                          ]}
                        >
                          {customSaving
                            ? "Saving…"
                            : editingMyFoodId
                              ? "Save changes & add"
                              : "Save to My Foods & add"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
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

              {suggestionError && !loadingSuggestions ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.error,
                    {
                      backgroundColor: `${colors.warning}12`,
                      borderColor: `${colors.warning}55`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.warning}
                    name="alert-circle-outline"
                    size={19}
                  />
                  <Text
                    style={[styles.errorText, { color: colors.textSecondary }]}
                  >
                    Saved food suggestions are unavailable. Your current meal
                    has not been changed.
                  </Text>
                  <Pressable
                    accessibilityLabel="Retry saved food suggestions"
                    accessibilityRole="button"
                    onPress={() => void loadSuggestions()}
                    style={({ pressed }) => [
                      styles.suggestionRetry,
                      pressed && { opacity: 0.65 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.suggestionRetryText,
                        { color: colors.primary },
                      ]}
                    >
                      Retry
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {!selected.length && !query.trim() ? (
                <FoodLibraryTabs
                  counts={libraryCounts}
                  onChange={setLibraryTab}
                  value={libraryTab}
                />
              ) : null}

              {!selected.length &&
              !query.trim() &&
              !loadingSuggestions &&
              !suggestionError &&
              libraryEmpty ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.libraryEmpty,
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
                    name="file-tray-outline"
                    size={20}
                  />
                  <Text
                    style={[
                      styles.libraryEmptyText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {foodLibraryEmptyMessage(libraryTab)}
                  </Text>
                </View>
              ) : null}

              {!selected.length && !query.trim() && library.foods.length ? (
                <View style={styles.quickPicks}>
                  <View style={styles.sectionHeading}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      {libraryTab === "my-foods"
                        ? "My Foods"
                        : libraryTab === "favourites"
                          ? "Favourite foods"
                          : "Recent foods"}
                    </Text>
                    {libraryTab === "my-foods" ? (
                      <Pressable
                        accessibilityLabel="Manage My Foods"
                        accessibilityRole="button"
                        accessibilityState={{ expanded: myFoodsManaging }}
                        onPress={() => setMyFoodsManaging((value) => !value)}
                        style={({ pressed }) => [
                          styles.sectionTextButton,
                          { opacity: pressed ? 0.6 : 1 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.sectionTextButtonLabel,
                            { color: colors.primaryStrong },
                          ]}
                        >
                          {myFoodsManaging ? "Done" : "Manage"}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text
                        style={[
                          styles.recentMealHint,
                          { color: colors.textTertiary },
                        ]}
                      >
                        Tap to add
                      </Text>
                    )}
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.quickPickRail}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {library.foods.slice(0, 12).map((result) => {
                      const food = result.food;
                      const favorite = isResultFavorite(result);
                      const carbs = presentFoodNutrition(
                        food.nutritionPerBasis,
                      ).carbs;
                      return (
                        <View
                          key={food.id}
                          style={[
                            styles.quickPickCard,
                            {
                              backgroundColor: colors.surface,
                              borderColor: favorite
                                ? `${colors.accent}70`
                                : colors.border,
                              borderRadius: radius.md,
                            },
                          ]}
                        >
                          <Pressable
                            accessibilityHint="Adds this food to the meal"
                            accessibilityLabel={`Add ${food.name}, ${carbs} per ${displayNumber(
                              food.basisAmount,
                              ` ${food.basisUnit}`,
                            )}`}
                            accessibilityRole="button"
                            onPress={() => addFood(food)}
                            style={({ pressed }) => [
                              styles.quickPickAdd,
                              { opacity: pressed ? 0.68 : 1 },
                            ]}
                          >
                            <View style={styles.quickPickTop}>
                              <FoodArtwork
                                backgroundColor={`${colors.primary}12`}
                                borderRadius={radius.sm}
                                food={food}
                                iconColor={colors.primary}
                                size={44}
                              />
                              {favorite ? (
                                <Ionicons
                                  accessibilityElementsHidden
                                  color={colors.accent}
                                  name="heart"
                                  size={17}
                                />
                              ) : (
                                <Ionicons
                                  accessibilityElementsHidden
                                  color={colors.textTertiary}
                                  name="add-circle-outline"
                                  size={20}
                                />
                              )}
                            </View>
                            <Text
                              numberOfLines={2}
                              style={[
                                styles.quickPickName,
                                { color: colors.text },
                              ]}
                            >
                              {food.name}
                            </Text>
                            <Text
                              style={[
                                styles.quickPickCarbs,
                                { color: colors.primaryStrong },
                              ]}
                            >
                              {carbs}
                            </Text>
                          </Pressable>
                          {libraryTab === "my-foods" && myFoodsManaging ? (
                            <View
                              style={[
                                styles.myFoodActions,
                                { borderTopColor: colors.border },
                              ]}
                            >
                              <Pressable
                                accessibilityLabel={`Edit ${food.name}`}
                                accessibilityRole="button"
                                accessibilityState={{
                                  disabled: Boolean(myFoodActionBusy),
                                }}
                                disabled={Boolean(myFoodActionBusy)}
                                onPress={() => beginEditMyFood(food)}
                                style={styles.myFoodAction}
                              >
                                <Ionicons
                                  accessibilityElementsHidden
                                  color={colors.primary}
                                  name="create-outline"
                                  size={19}
                                />
                              </Pressable>
                              <Pressable
                                accessibilityLabel={`Delete ${food.name}`}
                                accessibilityRole="button"
                                accessibilityState={{
                                  busy: myFoodActionBusy === food.id,
                                  disabled: Boolean(myFoodActionBusy),
                                }}
                                disabled={Boolean(myFoodActionBusy)}
                                onPress={() => confirmDeleteMyFood(food)}
                                style={styles.myFoodAction}
                              >
                                {myFoodActionBusy === food.id ? (
                                  <ActivityIndicator
                                    color={colors.textTertiary}
                                    size="small"
                                  />
                                ) : (
                                  <Ionicons
                                    accessibilityElementsHidden
                                    color={colors.textTertiary}
                                    name="trash-outline"
                                    size={19}
                                  />
                                )}
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {!selected.length && !query.trim() && library.recipes.length ? (
                <View style={styles.recentMeals}>
                  <View style={styles.sectionHeading}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      Your recipes
                    </Text>
                    <Pressable
                      accessibilityLabel="Manage recipes"
                      accessibilityRole="button"
                      accessibilityState={{ expanded: recipeManagementOpen }}
                      onPress={() => setRecipeManagementOpen((value) => !value)}
                      style={({ pressed }) => [
                        styles.sectionTextButton,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.sectionTextButtonLabel,
                          { color: colors.primaryStrong },
                        ]}
                      >
                        {recipeManagementOpen ? "Done" : "Manage"}
                      </Text>
                    </Pressable>
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.recentMealRail}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {library.recipes.map((recipe) => (
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
                          onPress={() => applyRecipe(recipe)}
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
                              " g carbs",
                            )}
                          </Text>
                          <Text
                            style={[
                              styles.recipeServing,
                              { color: colors.textTertiary },
                            ]}
                          >
                            1 of{" "}
                            {recipe.servings.toLocaleString(
                              getRuntimeRegionalDefaults().locale,
                              {
                              maximumFractionDigits: 1,
                              },
                            )}
                          </Text>
                        </Pressable>
                        {recipeManagementOpen ? (
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
                                    recipe.isFavorite ? "star" : "star-outline"
                                  }
                                  size={20}
                                />
                              )}
                            </Pressable>
                            <Pressable
                              accessibilityLabel={`Edit ${recipe.name}`}
                              accessibilityRole="button"
                              disabled={Boolean(recipeActionBusy)}
                              hitSlop={6}
                              onPress={() => beginEditRecipe(recipe)}
                              style={styles.recipeIconAction}
                            >
                              <Ionicons
                                color={colors.textTertiary}
                                name="create-outline"
                                size={19}
                              />
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
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              {!selected.length && !query.trim() && library.meals.length ? (
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
                    {library.meals.map((preset) => (
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
                          onPress={() => applyMealPreset(preset)}
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
                              " g carbs",
                            )}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel={`${
                            preset.isFavorite ? "Remove" : "Save"
                          } ${preset.title} ${
                            preset.isFavorite ? "from" : "to"
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
                                pressed || favoriteMealBusy === preset.id
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
                              name={preset.isFavorite ? "star" : "star-outline"}
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
                    <View style={styles.basketHeadingCopy}>
                      <Text
                        style={[styles.sectionTitle, { color: colors.text }]}
                      >
                        This meal
                      </Text>
                      {nutritionPresentation.secondary ? (
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.basketSecondary,
                            { color: colors.textTertiary },
                          ]}
                        >
                          {nutritionPresentation.secondary}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      style={[
                        styles.totalCarbs,
                        { color: colors.primaryStrong },
                      ]}
                    >
                      {nutritionPresentation.carbs}
                    </Text>
                  </View>
                  {selected.map((item) => {
                    const amount = amountNumber(item.amount, regional.locale);
                    const portionAmount = amountNumber(
                      item.portionAmount,
                      regional.locale,
                    );
                    const canCount = Boolean(
                      portionAmount && portionAmount > 0,
                    );
                    const detailsExpanded = expandedFoodIds.has(item.rowId);
                    const canonicalAmount = resolveSelectedFoodCanonicalAmount({
                      canonicalAmount: item.canonicalAmount,
                      amountEdited: item.amountEdited,
                      displayAmount: amount,
                      unit: item.unit,
                      countryCode: regional.countryCode,
                    });
                    const itemNutrition =
                      canonicalAmount !== undefined && canonicalAmount > 0
                        ? totalNutrition([
                            {
                              food: item.food,
                              amount: canonicalAmount,
                              unit: item.food.basisUnit,
                            },
                          ])
                        : {};
                    const itemPresentation =
                      presentFoodNutrition(itemNutrition);
                    return (
                      <View
                        key={item.rowId}
                        style={[
                          styles.selectedFood,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                            borderRadius: radius.md,
                          },
                        ]}
                      >
                        <View style={styles.selectedFoodMain}>
                          <FoodArtwork
                            backgroundColor={`${colors.primary}12`}
                            borderRadius={radius.sm}
                            food={item.food}
                            iconColor={colors.primary}
                          />
                          <View style={styles.selectedCopy}>
                            <View style={styles.selectedTitleRow}>
                              <Text
                                numberOfLines={2}
                                style={[
                                  styles.selectedName,
                                  { color: colors.text },
                                ]}
                              >
                                {item.food.name}
                              </Text>
                              <Pressable
                                accessibilityLabel={`Remove ${item.food.name}`}
                                accessibilityRole="button"
                                onPress={() => removeFood(item.rowId)}
                                style={({ pressed }) => [
                                  styles.remove,
                                  { opacity: pressed ? 0.56 : 1 },
                                ]}
                              >
                                <Ionicons
                                  accessibilityElementsHidden
                                  color={colors.textTertiary}
                                  name="trash-outline"
                                  size={19}
                                />
                              </Pressable>
                            </View>
                            {item.food.brand ? (
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.selectedBrand,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                {item.food.brand}
                              </Text>
                            ) : null}
                            {item.dataStatus === "stale" ? (
                              <View
                                accessible
                                accessibilityLabel="Saved food details need refreshing. Check the product label before saving."
                                style={[
                                  styles.selectedDataStatus,
                                  {
                                    backgroundColor: `${colors.warning}14`,
                                    borderColor: `${colors.warning}55`,
                                    borderRadius: radius.sm,
                                  },
                                ]}
                              >
                                <Ionicons
                                  accessibilityElementsHidden
                                  color={colors.warning}
                                  name="alert-circle-outline"
                                  size={14}
                                />
                                <Text
                                  numberOfLines={1}
                                  style={[
                                    styles.selectedDataStatusText,
                                    { color: colors.warning },
                                  ]}
                                >
                                  Saved details · needs refresh
                                </Text>
                              </View>
                            ) : null}
                            <Text
                              style={[
                                styles.selectedCarbs,
                                { color: colors.primaryStrong },
                              ]}
                            >
                              {itemPresentation.carbs}
                            </Text>
                            {itemPresentation.secondary ? (
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.selectedMeta,
                                  { color: colors.textTertiary },
                                ]}
                              >
                                {itemPresentation.secondary}
                              </Text>
                            ) : null}
                          </View>
                        </View>

                        <View style={styles.selectedControls}>
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
                                updateAmount(item.rowId, value)
                              }
                              selectTextOnFocus
                              selectionColor={colors.primary}
                              style={[
                                styles.amountInput,
                                { color: colors.text },
                              ]}
                              value={item.amount}
                            />
                            <Text
                              style={[
                                styles.amountUnit,
                                { color: colors.textSecondary },
                              ]}
                            >
                              {item.unit}
                            </Text>
                          </View>
                          <Pressable
                            accessibilityHint="Shows item weight and serving count controls"
                            accessibilityLabel={`Portion options for ${item.food.name}`}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: detailsExpanded }}
                            onPress={() => toggleFoodDetails(item.rowId)}
                            style={({ pressed }) => [
                              styles.portionToggle,
                              {
                                backgroundColor: detailsExpanded
                                  ? `${colors.primary}12`
                                  : colors.surfaceMuted,
                                borderColor: detailsExpanded
                                  ? `${colors.primary}55`
                                  : colors.border,
                                borderRadius: radius.sm,
                                opacity: pressed ? 0.65 : 1,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.portionToggleText,
                                { color: colors.textSecondary },
                              ]}
                            >
                              Portion
                            </Text>
                            <Ionicons
                              accessibilityElementsHidden
                              color={colors.textTertiary}
                              name={
                                detailsExpanded ? "chevron-up" : "chevron-down"
                              }
                              size={17}
                            />
                          </Pressable>
                        </View>

                        {detailsExpanded ? (
                          <View
                            style={[
                              styles.selectedDetails,
                              { borderTopColor: colors.divider },
                            ]}
                          >
                            <Text
                              style={[
                                styles.servingLabel,
                                { color: colors.textTertiary },
                              ]}
                            >
                              {item.food.servingLabel
                                ? `Source portion: ${item.food.servingLabel}`
                                : "Set one item’s weight to log a count"}
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
                                  updatePortionAmount(item.rowId, value)
                                }
                                placeholder="Weight"
                                placeholderTextColor={colors.textTertiary}
                                selectTextOnFocus
                                selectionColor={colors.primary}
                                style={[
                                  styles.eachAmountInput,
                                  { color: colors.text },
                                ]}
                                value={item.portionAmount}
                              />
                              <Text
                                style={[
                                  styles.eachAmountUnit,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                {item.unit} each
                              </Text>
                            </View>
                            <View style={styles.countEditor}>
                              <Pressable
                                accessibilityLabel={`Remove one ${item.food.name}`}
                                accessibilityRole="button"
                                disabled={
                                  !canCount ||
                                  (amountNumber(item.count, regional.locale) ??
                                    0) <= 0.5
                                }
                                onPress={() => adjustCount(item, -1)}
                                style={({ pressed }) => [
                                  styles.countStep,
                                  {
                                    backgroundColor: colors.surfaceMuted,
                                    borderColor: colors.border,
                                    borderRadius: radius.sm,
                                    opacity: !canCount
                                      ? 0.4
                                      : pressed
                                        ? 0.65
                                        : 1,
                                  },
                                ]}
                              >
                                <Ionicons
                                  color={colors.textSecondary}
                                  name="remove"
                                  size={18}
                                />
                              </Pressable>
                              <TextInput
                                accessibilityLabel={`Number of ${item.food.name} items or servings`}
                                editable={canCount}
                                keyboardType="decimal-pad"
                                onChangeText={(value) =>
                                  updateCount(item.rowId, value)
                                }
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
                                    opacity: !canCount
                                      ? 0.4
                                      : pressed
                                        ? 0.65
                                        : 1,
                                  },
                                ]}
                              >
                                <Ionicons
                                  color={colors.textSecondary}
                                  name="add"
                                  size={18}
                                />
                              </Pressable>
                            </View>
                            <Text
                              style={[
                                styles.selectedSource,
                                { color: colors.textTertiary },
                              ]}
                            >
                              Nutrition source: {item.food.sourceLabel}
                            </Text>
                          </View>
                        ) : null}
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
                        accessibilityLabel={
                          editingRecipeId
                            ? "Recipe details"
                            : "Save current batch as a recipe"
                        }
                        accessibilityRole="button"
                        disabled={Boolean(editingRecipeId)}
                        onPress={() => {
                          setRecipeSaveOpen((current) => !current);
                          setRecipeName((current) => current || title.trim());
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
                            {editingRecipeId
                              ? "Recipe details"
                              : "Save as a recipe"}
                          </Text>
                          <Text
                            style={[
                              styles.recipeSaveDetail,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {editingRecipeId
                              ? "Edit the full batch and its serving count."
                              : "Keep this full batch, then log one serving in a tap."}
                          </Text>
                        </View>
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.textTertiary}
                          name={recipeSaveOpen ? "chevron-up" : "chevron-down"}
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
                          {!editingRecipeId ? (
                            <Pressable
                              accessibilityRole="button"
                              disabled={recipeSaving}
                              onPress={() => void saveRecipe()}
                              style={({ pressed }) => [
                                styles.recipeSaveButton,
                                {
                                  backgroundColor: colors.primary,
                                  borderRadius: radius.sm,
                                  opacity: recipeSaving || pressed ? 0.7 : 1,
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
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {query.trim() ? (
                <View style={styles.resultsBlock}>
                  <View style={styles.sectionHeading}>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      Search results
                    </Text>
                    {foodSearching ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : query.trim().length >= 2 ? (
                      <Text
                        style={[
                          styles.resultCount,
                          { color: colors.textTertiary },
                        ]}
                      >
                        {matchingSearchResults.length >= 20
                          ? "20 matches shown · Refine to narrow"
                          : `${formatRegionalNumber(
                              matchingSearchResults.length,
                              getRuntimeRegionalDefaults().locale,
                            )} ${
                              matchingSearchResults.length === 1
                                ? "match"
                                : "matches"
                            }`}
                      </Text>
                    ) : null}
                  </View>
                  {query.trim().length === 1 ? (
                    <Text
                      style={[styles.hint, { color: colors.textSecondary }]}
                    >
                      Type one more character to search.
                    </Text>
                  ) : null}
                  {foodSearching ? (
                    <View
                      accessibilityLiveRegion="polite"
                      style={styles.searchingRow}
                    >
                      <ActivityIndicator color={colors.primary} size="small" />
                      <Text
                        style={[
                          styles.onlineMessage,
                          styles.searchMessageCopy,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {submittedSearchActive
                          ? "Checking saved and branded foods… This may take a few seconds."
                          : "Finding foods…"}
                      </Text>
                    </View>
                  ) : null}
                  {searchMessage ? (
                    <View
                      accessibilityLiveRegion="polite"
                      style={styles.searchMessageRow}
                    >
                      <Text
                        style={[
                          styles.onlineMessage,
                          styles.searchMessageCopy,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {searchMessage}
                      </Text>
                      {searchRetryAvailable ? (
                        <Pressable
                          accessibilityLabel="Retry branded food search"
                          accessibilityRole="button"
                          onPress={() => void submitFoodSearch()}
                          style={({ pressed }) => [
                            styles.searchRetry,
                            {
                              backgroundColor: `${colors.primary}12`,
                              borderRadius: radius.sm,
                              opacity: pressed ? 0.65 : 1,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.searchRetryText,
                              { color: colors.primaryStrong },
                            ]}
                          >
                            Retry
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {!foodSearching &&
                  query.trim().length >= 2 &&
                  !visibleResults.length ? (
                    <View
                      style={[
                        styles.noResults,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.textTertiary}
                        name="search-outline"
                        size={22}
                      />
                      <View style={styles.noResultsCopy}>
                        <Text
                          style={[
                            styles.noResultsTitle,
                            { color: colors.text },
                          ]}
                        >
                          Nothing matched
                        </Text>
                        <Text
                          style={[styles.hint, { color: colors.textSecondary }]}
                        >
                          Try another name, scan the barcode, or add the label
                          once.
                        </Text>
                      </View>
                      <Pressable
                        accessibilityLabel="Create this food from its label"
                        accessibilityRole="button"
                        onPress={() => {
                          setMoreWaysOpen(true);
                          setCustomOpen(true);
                        }}
                        style={({ pressed }) => [
                          styles.noResultsAction,
                          {
                            backgroundColor: `${colors.primary}12`,
                            borderRadius: radius.sm,
                            opacity: pressed ? 0.65 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.noResultsActionText,
                            { color: colors.primaryStrong },
                          ]}
                        >
                          Create
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {visibleResults.map((result, resultIndex) => {
                    const food = result.food;
                    const favorite = isResultFavorite(result);
                    const alreadyAdded = selected.some((item) =>
                      searchResultMatchesFood(result, item.food),
                    );
                    const foodPresentation = presentFoodNutrition(
                      food.nutritionPerBasis,
                    );
                    return (
                      <Pressable
                        accessibilityHint="Adds this food to the meal"
                        accessibilityLabel={`Add ${food.name}, ${foodPresentation.carbs} per ${displayNumber(
                          food.basisAmount,
                          ` ${food.basisUnit}`,
                        )}`}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: alreadyAdded }}
                        disabled={alreadyAdded}
                        key={searchResultCandidateIds(result).join("|")}
                        onPress={() => addFood(food)}
                        style={({ pressed }) => [
                          styles.result,
                          {
                            borderBottomColor: colors.divider,
                            opacity: alreadyAdded ? 0.5 : pressed ? 0.68 : 1,
                          },
                        ]}
                      >
                        <FoodArtwork
                          allowNetworkImage={shouldLoadRemoteProductImage(
                            result,
                            resultIndex,
                          )}
                          backgroundColor={`${colors.primary}12`}
                          borderRadius={radius.sm}
                          food={food}
                          iconColor={colors.primary}
                        />
                        <View style={styles.resultCopy}>
                          <Text
                            numberOfLines={2}
                            style={[styles.resultName, { color: colors.text }]}
                          >
                            {food.name}
                          </Text>
                          {food.brand ? (
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.resultBrand,
                                { color: colors.textSecondary },
                              ]}
                            >
                              {food.brand}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.resultCarbs,
                              { color: colors.primaryStrong },
                            ]}
                          >
                            {foodPresentation.carbs} per{" "}
                            {displayNumber(
                              food.basisAmount,
                              ` ${food.basisUnit}`,
                            )}
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.resultMeta,
                              { color: colors.textTertiary },
                            ]}
                          >
                            {foodPresentation.secondary
                              ? `${foodPresentation.secondary} · `
                              : ""}
                            {food.sourceUrl ? (
                              <Text
                                accessibilityRole="link"
                                onPress={(event) => {
                                  event.stopPropagation();
                                  openFoodSource(food.sourceUrl);
                                }}
                                style={{
                                  color: colors.primaryStrong,
                                  textDecorationLine: "underline",
                                }}
                              >
                                {food.sourceLabel}
                              </Text>
                            ) : (
                              food.sourceLabel
                            )}
                            {food.lastPortionAmount !== undefined &&
                            food.lastPortionUnit === food.basisUnit
                              ? ` · last ${displayNumber(
                                  food.lastPortionAmount,
                                  ` ${food.lastPortionUnit}`,
                                )}`
                              : ""}
                          </Text>
                        </View>
                        <View style={styles.resultActions}>
                          <Pressable
                            accessibilityLabel={
                              favorite
                                ? `Remove ${food.name} from favourites`
                                : `Add ${food.name} to favourites`
                            }
                            accessibilityRole="button"
                            disabled={favoriteBusy === food.id}
                            hitSlop={4}
                            onPress={(event) => {
                              event.stopPropagation();
                              void toggleFavorite(result);
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
                                  favorite ? colors.accent : colors.textTertiary
                                }
                                name={favorite ? "heart" : "heart-outline"}
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
                                ? "checkmark-circle"
                                : "add-circle-outline"
                            }
                            size={23}
                          />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

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

              <Pressable
                accessibilityLabel="About food data and privacy"
                accessibilityRole="button"
                accessibilityState={{ expanded: dataInfoOpen }}
                onPress={() => setDataInfoOpen((value) => !value)}
                style={({ pressed }) => [
                  styles.dataInfoToggle,
                  { opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="information-circle-outline"
                  size={19}
                />
                <Text
                  style={[
                    styles.dataInfoLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  About food data & privacy
                </Text>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name={dataInfoOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                />
              </Pressable>
              {dataInfoOpen ? (
                <View style={styles.attributionBlock}>
                  {showCofid ? (
                    <>
                      <Text
                        style={[styles.attribution, { color: colors.textTertiary }]}
                      >
                        Nutrients are per 100 g or 100 ml from{" "}
                        {COFID_CATALOG_INFO.dataset}. These{" "}
                        {COFID_CATALOG_INFO.foodCount.toLocaleString(regional.locale)}{" "}
                        entries are a reference dataset, not a complete retailer
                        catalogue. Values are estimates, not dosing advice.
                      </Text>
                      <Pressable
                        accessibilityHint="Opens the CoFID source and licence information"
                        accessibilityLabel={`${COFID_CATALOG_INFO.dataset}, ${COFID_CATALOG_INFO.licence}`}
                        accessibilityRole="link"
                        onPress={() => openFoodSource(COFID_CATALOG_INFO.sourceUrl)}
                        style={({ pressed }) => [
                          styles.attributionLink,
                          { opacity: pressed ? 0.62 : 1 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.attribution,
                            styles.attributionLinkText,
                            { color: colors.primaryStrong },
                          ]}
                        >
                          Contains public sector information licensed under the{" "}
                          {COFID_CATALOG_INFO.licence}. View the CoFID source.
                        </Text>
                      </Pressable>
                    </>
                  ) : showUsda ? (
                    <>
                      <Text
                        style={[styles.attribution, { color: colors.textTertiary }]}
                      >
                        US searches combine Open Food Facts with a bundled{" "}
                        {USDA_FDC_CATALOG_INFO.foodCount.toLocaleString(regional.locale)}-food
                        USDA FoodData Central reference catalogue. Normal USDA text
                        search stays on this phone and works without an API key.
                        Barcode fallback requires an exact GTIN match. Values are
                        estimates, not dosing advice.
                      </Text>
                      <Pressable
                        accessibilityHint="Opens USDA FoodData Central"
                        accessibilityLabel={`${USDA_FDC_CATALOG_INFO.dataset}, ${USDA_FDC_CATALOG_INFO.licence}`}
                        accessibilityRole="link"
                        onPress={() =>
                          openFoodSource(USDA_FDC_CATALOG_INFO.sourceUrl)
                        }
                        style={({ pressed }) => [
                          styles.attributionLink,
                          { opacity: pressed ? 0.62 : 1 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.attribution,
                            styles.attributionLinkText,
                            { color: colors.primaryStrong },
                          ]}
                        >
                          USDA FoodData Central: US public domain / CC0. View
                          source and documentation.
                        </Text>
                      </Pressable>
                    </>
                  ) : showMextJapan ? (
                    <>
                      <Text
                        style={[styles.attribution, { color: colors.textTertiary }]}
                      >
                        Japanese searches combine Open Food Facts with a bundled
                        subset that T1 Arc processed from the{" "}
                        {MEXT_JAPAN_CATALOG_INFO.dataset}. Its{" "}
                        {MEXT_JAPAN_CATALOG_INFO.foodCount.toLocaleString(regional.locale)}{" "}
                        reference entries use nutrients per 100 g. The national
                        table does not contain retail barcodes, so scans use Open
                        Food Facts. Values are estimates, not dosing advice.
                      </Text>
                      <Pressable
                        accessibilityHint="Opens the MEXT source and reuse information"
                        accessibilityLabel={`${MEXT_JAPAN_CATALOG_INFO.dataset}, ${MEXT_JAPAN_CATALOG_INFO.licence}`}
                        accessibilityRole="link"
                        onPress={() =>
                          openFoodSource(MEXT_JAPAN_CATALOG_INFO.sourceUrl)
                        }
                        style={({ pressed }) => [
                          styles.attributionLink,
                          { opacity: pressed ? 0.62 : 1 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.attribution,
                            styles.attributionLinkText,
                            { color: colors.primaryStrong },
                          ]}
                        >
                          Source: {MEXT_JAPAN_CATALOG_INFO.dataset}. This processed
                          subset is not an official MEXT output. View source and
                          reuse details.
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text
                      style={[styles.attribution, { color: colors.textTertiary }]}
                    >
                      Product search uses Open Food Facts results filtered for your
                      selected country when available. Values are estimates, not
                      dosing advice.
                    </Text>
                  )}
                  <Text
                    style={[styles.attribution, { color: colors.textTertiary }]}
                  >
                    When you press Search, public online catalogues receive the
                    search words and standard network information such as your IP
                    address. Bundled CoFID, USDA reference and MEXT searches stay
                    on this phone. Product images may load from Open Food Facts,
                    and barcode lookups send the product number. T1 Arc does not
                    include glucose, insulin, diary or account data in those
                    requests. If Open Food Facts cannot find a US barcode, T1 Arc
                    may try FoodData Central&apos;s documented low-rate public demo key
                    as a fallback; it does not embed a personal USDA API key.
                  </Text>
                  <Pressable
                    accessibilityHint="Opens the Open Food Facts licence information"
                    accessibilityLabel="Open Food Facts licence and attribution details"
                    accessibilityRole="link"
                    onPress={() =>
                      openFoodSource(
                        "https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/",
                      )
                    }
                    style={({ pressed }) => [
                      styles.attributionLink,
                      { opacity: pressed ? 0.62 : 1 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.attribution,
                        styles.attributionLinkText,
                        { color: colors.primaryStrong },
                      ]}
                    >
                      Open Food Facts database: ODbL · individual contents: DbCL
                      · product images: CC BY-SA. View licence and attribution
                      details.
                    </Text>
                  </Pressable>
                </View>
              ) : null}
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
                <Text
                  style={[styles.footerLabel, { color: colors.textSecondary }]}
                >
                  {selected.length
                    ? `${formatRegionalNumber(selected.length, regional.locale, { maximumFractionDigits: 0 })} ${selected.length === 1 ? "food" : "foods"}`
                    : "No foods yet"}
                </Text>
                <Text style={[styles.footerCarbs, { color: colors.text }]}>
                  {nutritionPresentation.carbs}
                </Text>
                {nutritionPresentation.secondary ? (
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.footerMacros,
                      { color: colors.textTertiary },
                    ]}
                  >
                    {nutritionPresentation.secondary}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={saving || recipeSaving || !selected.length}
                onPress={() =>
                  editingRecipeId ? void saveRecipe() : void save()
                }
                style={({ pressed }) => [
                  styles.save,
                  {
                    backgroundColor:
                      saving || recipeSaving || !selected.length
                        ? colors.surfaceMuted
                        : colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.74 : 1,
                  },
                ]}
              >
                {saving || recipeSaving ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Ionicons
                    accessibilityElementsHidden
                    color={
                      selected.length ? colors.onPrimary : colors.textTertiary
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
                  {saving || recipeSaving
                    ? "Saving locally…"
                    : editingRecipeId
                      ? "Update recipe"
                      : editingLog
                      ? "Update meal"
                      : "Save meal"}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <FoodCopyFromDaySheet
        actionError={copyActionError}
        canNavigateBack={copySourceDate > earliestDate}
        canNavigateForward={
          copySourceDate <
          addDays(toDateKey(timestamp, regional.timeZone), -1)
        }
        error={copyError}
        loading={copyLoading}
        mode={copyMode}
        onCancel={cancelCopyFromDay}
        onConfirm={applyCopyToDraft}
        onModeChange={(mode) => {
          setCopyActionError(undefined);
          setCopyMode(mode);
        }}
        onSelectedItemIdentitiesChange={(identities) => {
          setCopyActionError(undefined);
          setCopySelectedIdentities(identities);
        }}
        onSourceDateChange={(date) => void loadCopySourceDate(date)}
        selectedItemIdentities={copySelectedIdentities}
        sourceDate={copySourceDate}
        sourceLogs={copySourceLogs}
        visible={copyOpen}
      />

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
              barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"],
            }}
            enableTorch={torch}
            facing="back"
            onBarcodeScanned={
              scannerOpen && !barcodeLookingUp ? barcodeScanned : undefined
            }
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={["top", "bottom"]} style={styles.scannerOverlay}>
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
                accessibilityLabel={torch ? "Turn torch off" : "Turn torch on"}
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
                  name={torch ? "flash" : "flash-outline"}
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
                The camera image stays on this phone. Only the barcode number is
                looked up.
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
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 5,
  },
  compactIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  compactCopy: {
    flex: 1,
  },
  compactTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
  compactDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  card: {
    gap: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 13,
  },
  cardIcon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  openButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  openButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  saved: {
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
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
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  modalSubtitle: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  close: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    padding: 18,
    paddingBottom: 32,
    gap: 12,
  },
  editNotice: {
    minHeight: 70,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  editNoticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  editNoticeTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  editNoticeDetail: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  mealSummary: {
    minHeight: 64,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mealSummaryIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  mealSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  mealSummaryTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  mealSummaryDetail: {
    marginTop: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  mealSummaryAction: {
    minWidth: 52,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    textAlign: "right",
  },
  mealDetails: {
    borderWidth: 1,
    marginTop: -5,
    padding: 12,
    gap: 12,
  },
  copyFromDay: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  copyFromDayIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  copyFromDayCopy: {
    flex: 1,
    minWidth: 0,
  },
  copyFromDayTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  copyFromDayDetail: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  copyUndo: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 11,
    paddingRight: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  copyUndoText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
  },
  copyUndoAction: {
    minWidth: 64,
    minHeight: 48,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  copyUndoActionText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  search: {
    minHeight: 60,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    minHeight: 58,
    flex: 1,
    fontSize: 15,
  },
  searchIconButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  searchDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
  },
  searchScanButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  moreWaysToggle: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  moreWaysText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  advancedEntryPanel: {
    gap: 8,
  },
  barcodeEntry: {
    minHeight: 54,
    borderWidth: 1,
    padding: 5,
    paddingLeft: 13,
    flexDirection: "row",
    alignItems: "center",
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
    flexDirection: "row",
    alignItems: "flex-start",
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
    fontWeight: "600",
  },
  barcodeSettingsButton: {
    minHeight: 48,
    alignSelf: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  barcodeSettingsButtonText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  lookupButton: {
    minWidth: 86,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  lookupText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  customToggle: {
    minHeight: 56,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  customToggleCopy: {
    flex: 1,
  },
  customToggleTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  quickCarbInput: {
    minWidth: 110,
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  quickCarbUnit: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  quickCarbAdd: {
    minWidth: 98,
    minHeight: 48,
    marginLeft: "auto",
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  quickCarbAddText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
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
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  customField: {
    flex: 1,
    gap: 5,
  },
  customLabel: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
  },
  customNumberInput: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 11,
    fontSize: 14,
  },
  unitSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  unitOption: {
    minWidth: 52,
    minHeight: 48,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  unitOptionText: {
    fontSize: 12,
    fontWeight: "800",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  customBarcodeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  customNutrientGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  customNutrientField: {
    minWidth: 104,
    flexBasis: "30%",
    flexGrow: 1,
    gap: 5,
  },
  customAddButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  customAddText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  barcodeNotice: {
    minHeight: 40,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  barcodeNoticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  mealRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  mealChip: {
    minHeight: 48,
    flexGrow: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  mealChipText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateButton: {
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  dateText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  quickPicks: {
    gap: 8,
  },
  libraryEmpty: {
    alignItems: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    minHeight: 64,
    padding: 14,
  },
  libraryEmptyText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  quickPickRail: {
    gap: 9,
    paddingRight: 4,
  },
  quickPickCard: {
    width: 152,
    minHeight: 136,
    borderWidth: 1,
    overflow: "hidden",
  },
  quickPickAdd: {
    minHeight: 134,
    padding: 11,
  },
  quickPickTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  quickPickName: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  quickPickCarbs: {
    marginTop: "auto",
    paddingTop: 5,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  myFoodActions: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  myFoodAction: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldHeader: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 7,
  },
  fieldLabel: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
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
  recentMeals: {
    gap: 8,
  },
  recentMealHint: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    textTransform: "uppercase",
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
    overflow: "hidden",
  },
  recipeCard: {
    width: 152,
    minHeight: 166,
    borderWidth: 1,
    overflow: "hidden",
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recipeIconAction: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  recipeIcon: {
    width: 34,
    height: 34,
    marginBottom: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  recipeServing: {
    marginTop: "auto",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
  },
  recentMealAction: {
    flex: 1,
    padding: 12,
    paddingRight: 44,
    justifyContent: "space-between",
    gap: 6,
  },
  recentMealFavorite: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  recentMealTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  recentMealMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  selectedBlock: {
    gap: 8,
  },
  sectionTextButton: {
    minWidth: 64,
    minHeight: 48,
    marginVertical: -10,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sectionTextButtonLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  sectionHeading: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  resultCount: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 15,
    textAlign: "right",
  },
  totalCarbs: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  basketHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  basketSecondary: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 15,
  },
  selectedFood: {
    minHeight: 128,
    borderWidth: 1,
    padding: 11,
    gap: 10,
  },
  selectedFoodMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  selectedCopy: {
    flex: 1,
    minWidth: 0,
  },
  selectedName: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  selectedTitleRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  selectedBrand: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  selectedDataStatus: {
    alignSelf: "flex-start",
    minHeight: 26,
    marginTop: 5,
    paddingHorizontal: 7,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  selectedDataStatusText: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  selectedCarbs: {
    marginTop: 5,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  selectedMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  selectedControls: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  portionToggle: {
    minHeight: 48,
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  portionToggleText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  selectedDetails: {
    minHeight: 64,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  selectedSource: {
    width: "100%",
    fontSize: 10,
    lineHeight: 15,
  },
  servingLabel: {
    width: "100%",
    marginRight: 2,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "700",
  },
  eachAmountShell: {
    minHeight: 44,
    width: 120,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  eachAmountInput: {
    minHeight: 42,
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
    fontSize: 12,
    textAlign: "right",
  },
  eachAmountUnit: {
    paddingHorizontal: 6,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "700",
  },
  countEditor: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  countStep: {
    width: 48,
    height: 48,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  countInput: {
    width: 62,
    minHeight: 48,
    borderWidth: 1,
    paddingHorizontal: 5,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  amountShell: {
    width: 112,
    minHeight: 48,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  amountInput: {
    minHeight: 46,
    flex: 1,
    paddingLeft: 9,
    fontSize: 14,
    textAlign: "right",
  },
  amountUnit: {
    paddingHorizontal: 7,
    fontSize: 11,
    fontWeight: "700",
  },
  remove: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  recipeSave: {
    borderWidth: 1,
    overflow: "hidden",
  },
  recipeSaveToggle: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  recipeSaveCopy: {
    flex: 1,
    minWidth: 0,
  },
  recipeSaveTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  recipeServingsCopy: {
    flex: 1,
    minWidth: 0,
  },
  recipeServingsLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  recipeServingsInputShell: {
    minHeight: 48,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  recipeServingsInput: {
    width: 48,
    minHeight: 46,
    paddingHorizontal: 8,
    fontSize: 14,
    textAlign: "right",
  },
  recipeServingsUnit: {
    paddingRight: 10,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
  },
  recipeSaveButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  recipeSaveButtonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  resultsBlock: {
    gap: 2,
  },
  searchingRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchMessageRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchMessageCopy: {
    flex: 1,
    minWidth: 0,
  },
  searchRetry: {
    minWidth: 72,
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  searchRetryText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
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
    minHeight: 78,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  favoriteButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  resultName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  resultBrand: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 15,
  },
  resultCarbs: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  resultMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  error: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  suggestionRetry: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  suggestionRetryText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
  },
  foodArtwork: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  noResults: {
    minHeight: 86,
    borderWidth: 1,
    marginTop: 6,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  noResultsCopy: {
    flex: 1,
    minWidth: 0,
  },
  noResultsTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  noResultsAction: {
    minWidth: 70,
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  noResultsActionText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  dataInfoToggle: {
    minHeight: 48,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dataInfoLabel: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  attributionBlock: {
    gap: 8,
  },
  attribution: {
    fontSize: 12,
    lineHeight: 18,
  },
  attributionLink: {
    minHeight: 48,
    justifyContent: "center",
  },
  attributionLinkText: {
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
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
    fontWeight: "800",
  },
  footerMacros: {
    fontSize: 9,
    lineHeight: 13,
  },
  save: {
    minWidth: 150,
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  saveText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  scanner: {
    flex: 1,
    backgroundColor: "#000000",
  },
  scannerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  scannerTop: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scannerControl: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(0,0,0,0.58)",
    alignItems: "center",
    justifyContent: "center",
  },
  scannerCentre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  scanFrame: {
    width: "100%",
    maxWidth: 390,
    aspectRatio: 1.55,
    position: "relative",
  },
  scanCorner: {
    width: 42,
    height: 42,
    position: "absolute",
    borderColor: "#67D5E8",
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
    alignItems: "center",
  },
  scannerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  scannerBody: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
  },
  scannerManualButton: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.58)",
    borderRadius: 22,
    paddingHorizontal: 16,
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  scannerManualButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
});
