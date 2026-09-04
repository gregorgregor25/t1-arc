import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { adjustedFoodLogPortions } from "@/data/food/portionAdjustments";
import {
  formatFoodGrams,
  formatFoodNumber,
} from "@/data/food/foodNumberFormat";
import { repeatFoodLogDraft } from "@/data/food/repeatFoodLog";
import { FoodLog } from "@/data/food/types";
import { MANUAL_CONTEXT_SOURCE_ID } from "@/data/manualContext";
import { createDemoFoodLogs } from "@/data/synthetic/demoFoodLogs";
import {
  buildMealResponseEvidence,
  EvidenceReference,
  observedMealWindows,
} from "@/domain/insights";
import { HealthContextEvent, MealEvent, TimelineData } from "@/domain/models";
import { formatTime, toDateKey } from "@/domain/time";
import {
  formatTimelineEntryTimestamp,
  rangeSpansMultipleDates,
} from "@/domain/timelinePresentation";
import { mealNutritionSummary } from "@/domain/mealNutrition";
import {
  nutritionCoverageNeedsReview,
  summarizeHealthTrendContext,
} from "@/domain/healthTrendContext";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import {
  formatEnergy,
  formatGlucose,
  formatRegionalNumber,
} from "@/domain/regionalFormat";
import {
  formatRegionalNumberInput,
  normalizeRegionalNumberInput,
} from "@/domain/regionalNumberInput";
import { useAppTheme } from "@/theme/theme";

import { FoodDiaryMealTabs } from "./foodDiary/FoodDiaryMealTabs";
import {
  filterFoodDiaryMeals,
  summarizeFoodDiaryMeals,
  type FoodDiaryMealFilter,
} from "./foodDiary/presentation";
import { SectionCard } from "./SectionCard";

function grams(value: number | undefined) {
  return formatFoodGrams(value);
}

function mealTypeLabel(mealType: MealEvent["mealType"]) {
  return mealType[0]!.toUpperCase() + mealType.slice(1);
}

function portionNumber(value: string, locale: string) {
  return normalizeRegionalNumberInput(value, locale)?.value ?? Number.NaN;
}

function previewPortions(
  log: FoodLog,
  drafts: Record<string, string>,
  locale: string,
) {
  try {
    return adjustedFoodLogPortions(
      log,
      Object.fromEntries(
        log.items.map((item) => [
          item.id,
          portionNumber(drafts[item.id] ?? "", locale),
        ]),
      ),
    );
  } catch {
    return log;
  }
}

export function FoodDiaryCard({
  events,
  logs,
  onEditManualContext,
  onEditFoodLog,
  readOnly = false,
  timeline,
  onInspect,
}: {
  events: HealthContextEvent[];
  logs: FoodLog[];
  onEditManualContext?: (event: MealEvent) => void;
  onEditFoodLog?: (log: FoodLog) => void;
  readOnly?: boolean;
  timeline?: TimelineData;
  onInspect?: (evidence: EvidenceReference) => void;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { dataMode, deleteManualContext, logFood, now, updateFoodPortions } =
    useDataContext();
  const [expandedId, setExpandedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [portionDrafts, setPortionDrafts] = useState<Record<string, string>>(
    {},
  );
  const [portionBusy, setPortionBusy] = useState(false);
  const [portionError, setPortionError] = useState<string>();
  const [repeatBusyId, setRepeatBusyId] = useState<string>();
  const [repeatMessage, setRepeatMessage] = useState<string>();
  const [visibleCount, setVisibleCount] = useState(12);
  const [mealFilter, setMealFilter] = useState<FoodDiaryMealFilter>("all");
  const meals = useMemo(
    () =>
      events
        .filter((event): event is MealEvent => event.kind === "meal")
        .sort((a, b) => b.start - a.start),
    [events],
  );
  const effectiveLogs = useMemo(
    () =>
      dataMode === "demo" && logs.length === 0
        ? createDemoFoodLogs(events)
        : logs,
    [dataMode, events, logs],
  );
  const logsByContext = useMemo(
    () => new Map(effectiveLogs.map((log) => [log.contextEventId, log])),
    [effectiveLogs],
  );
  const responseByMeal = useMemo(
    () =>
      new Map(
        (timeline ? observedMealWindows(timeline) : []).map((response) => [
          response.meal.id,
          response,
        ]),
      ),
    [timeline],
  );
  const nutritionSummary = useMemo(
    () =>
      summarizeHealthTrendContext(meals, {
        start: Number.MIN_SAFE_INTEGER,
        end: Number.MAX_SAFE_INTEGER,
      }),
    [meals],
  );
  const mealSlotSummary = useMemo(() => summarizeFoodDiaryMeals(meals), [meals]);
  if (!meals.length) return null;

  const totalCarbs = nutritionSummary.mealCarbsGrams;
  const totalEnergy = nutritionSummary.mealEnergyKcal;
  const carbCoverage = nutritionSummary.mealNutrientCoverage.carbsGrams;
  const energyCoverage = nutritionSummary.mealNutrientCoverage.energyKcal;
  const carbohydrateNeedsReview =
    nutritionCoverageNeedsReview(carbCoverage) ||
    nutritionSummary.nutritionPossibleDuplicatePairs > 0;
  const filteredMeals = filterFoodDiaryMeals(meals, mealFilter);
  const visibleMeals = filteredMeals.slice(0, visibleCount);
  const showMealDates = timeline
    ? rangeSpansMultipleDates(timeline.range)
    : new Set(meals.map((meal) => toDateKey(meal.start))).size > 1;

  function confirmDelete(meal: MealEvent) {
    Alert.alert(
      "Remove this meal?",
      `"${meal.title}" and its saved item snapshots will be removed from T1 Arc.`,
      [
        { text: "Keep meal", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void deleteManualContext(meal.id);
          },
        },
      ],
    );
  }

  function beginPortionEdit(log: FoodLog) {
    setEditingId(log.id);
    setPortionDrafts(
      Object.fromEntries(
        log.items.map((item) => [
          item.id,
          formatRegionalNumberInput(item.amount, regional.locale),
        ]),
      ),
    );
    setPortionError(undefined);
  }

  function cancelPortionEdit() {
    setEditingId(undefined);
    setPortionDrafts({});
    setPortionError(undefined);
  }

  async function savePortions(log: FoodLog) {
    if (portionBusy) return;
    const amounts = Object.fromEntries(
      log.items.map((item) => [
        item.id,
        portionNumber(portionDrafts[item.id] ?? "", regional.locale),
      ]),
    );
    setPortionBusy(true);
    setPortionError(undefined);
    try {
      await updateFoodPortions(log, amounts);
      cancelPortionEdit();
    } catch (error) {
      setPortionError(
        error instanceof Error
          ? error.message
          : "The meal portions could not be updated.",
      );
    } finally {
      setPortionBusy(false);
    }
  }

  function confirmRepeat(log: FoodLog) {
    Alert.alert(
      "Log this meal again?",
      `"${log.title}" will be added at ${formatTime(now)} with the same foods and portions. You can adjust the new entry afterwards.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log again",
          onPress: () => {
            setRepeatBusyId(log.id);
            setRepeatMessage(undefined);
            void logFood(repeatFoodLogDraft(log, now))
              .then((saved) => {
                setRepeatMessage(
                  `${saved.title} was logged at ${formatTime(saved.timestamp)}.`,
                );
              })
              .catch((error: unknown) => {
                setRepeatMessage(
                  error instanceof Error
                    ? error.message
                    : "The meal could not be logged again.",
                );
              })
              .finally(() => setRepeatBusyId(undefined));
          },
        },
      ],
    );
  }

  return (
    <SectionCard
      accessibilityLabel={`${formatRegionalNumber(meals.length, regional.locale, { maximumFractionDigits: 0 })} meals. ${
        totalCarbs === undefined
          ? "No carbohydrate total was supplied."
          : `${formatFoodNumber(totalCarbs)} grams ${
              carbohydrateNeedsReview ? "known " : ""
            }carbohydrate logged in this range.`
      }`}
    >
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            FOOD DIARY
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Logged meals
          </Text>
        </View>
        <View style={styles.totalCopy}>
          <Text style={[styles.total, { color: colors.text }]}>
            {formatFoodGrams(totalCarbs)}
          </Text>
          <Text style={[styles.totalLabel, { color: colors.textTertiary }]}>
            {carbohydrateNeedsReview ? "KNOWN CARBS" : "CARBS"}
          </Text>
        </View>
      </View>
      {totalEnergy !== undefined ? (
        <Text style={[styles.energy, { color: colors.textSecondary }]}>
          {formatEnergy(totalEnergy, regional)}
          {(energyCoverage.partialCount ?? 0) > 0
            ? ` known subtotal; ${formatRegionalNumber(energyCoverage.partialCount ?? 0, regional.locale, { maximumFractionDigits: 0 })} ${energyCoverage.partialCount === 1 ? "meal includes" : "meals include"} items without energy`
            : nutritionCoverageNeedsReview(energyCoverage)
              ? ` known from ${formatRegionalNumber(energyCoverage.knownCount, regional.locale, { maximumFractionDigits: 0 })} of ${formatRegionalNumber(energyCoverage.recordCount, regional.locale, { maximumFractionDigits: 0 })} meals`
              : " recorded"}
        </Text>
      ) : null}
      {carbCoverage.knownCount < carbCoverage.recordCount ? (
        <Text style={[styles.energy, { color: colors.textSecondary }]}>
          Carbohydrate is known for{" "}
          {formatRegionalNumber(carbCoverage.knownCount, regional.locale, {
            maximumFractionDigits: 0,
          })}{" "}
          of{" "}
          {formatRegionalNumber(carbCoverage.recordCount, regional.locale, {
            maximumFractionDigits: 0,
          })}{" "}
          meals. Missing values are not counted as
          zero.
        </Text>
      ) : null}
      {(carbCoverage.partialCount ?? 0) > 0 ? (
        <Text style={[styles.energy, { color: colors.textSecondary }]}>
          Carbohydrate includes a known subtotal from{" "}
          {formatRegionalNumber(carbCoverage.partialCount ?? 0, regional.locale, {
            maximumFractionDigits: 0,
          })}{" "}
          {carbCoverage.partialCount === 1 ? "meal" : "meals"} because some food
          items did not supply it.
        </Text>
      ) : null}
      {nutritionSummary.nutritionSourceLabels.length > 1 ? (
        <Text style={[styles.energy, { color: colors.textSecondary }]}>
          Sources · {nutritionSummary.nutritionSourceLabels.join(", ")}
        </Text>
      ) : null}
      {nutritionSummary.nutritionPossibleDuplicatePairs > 0 ? (
        <Text style={[styles.energy, { color: colors.warning }]}>
          {nutritionSummary.nutritionPossibleDuplicatePairs} cross-source meal{" "}
          {nutritionSummary.nutritionPossibleDuplicatePairs === 1
            ? "pair is"
            : "pairs are"}{" "}
          close in time. Both records are kept, so totals may overlap.
        </Text>
      ) : null}
      <FoodDiaryMealTabs
        mealCount={meals.length}
        onChange={(next) => {
          setMealFilter(next);
          setVisibleCount(12);
        }}
        summary={mealSlotSummary}
        value={mealFilter}
      />
      {repeatMessage ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.repeatMessage, { color: colors.textSecondary }]}
        >
          {repeatMessage}
        </Text>
      ) : null}

      <View style={styles.rows}>
        {!filteredMeals.length ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.filteredEmpty, { color: colors.textSecondary }]}
          >
            No {mealFilter === "snack" ? "snacks" : mealFilter} entries in this
            range.
          </Text>
        ) : null}
        {visibleMeals.map((meal) => {
          const log = logsByContext.get(meal.id);
          const canEditSourceMeal =
            !readOnly &&
            dataMode === "live" &&
            meal.origin === "manual" &&
            meal.sourceId === MANUAL_CONTEXT_SOURCE_ID &&
            !log &&
            onEditManualContext !== undefined;
          const expanded = expandedId === meal.id;
          const editing = log?.id === editingId;
          const displayLog =
            log && editing
              ? previewPortions(log, portionDrafts, regional.locale)
              : log;
          const response = responseByMeal.get(meal.id);
          const responseEvidence =
            response && timeline
              ? buildMealResponseEvidence(response, timeline)
              : undefined;
          const minutesToPeak = response
            ? Math.max(
                0,
                Math.round((response.peak.timestamp - meal.start) / 60_000),
              )
            : undefined;
          const displayedCarbs =
            displayLog?.nutrition.carbohydrateGrams ?? meal.carbsGrams;
          const displayedEnergy =
            displayLog?.nutrition.energyKcal ?? meal.energyKcal;
          return (
            <View
              key={meal.id}
              style={[
                styles.meal,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Pressable
                accessibilityLabel={`${meal.title}, ${mealNutritionSummary(
                  meal,
                )} at ${formatTimelineEntryTimestamp(meal.start, showMealDates)}${log ? ". Tap for item details" : canEditSourceMeal ? ". Tap to edit" : ""}`}
                accessibilityRole={
                  log || canEditSourceMeal ? "button" : undefined
                }
                disabled={!log && !canEditSourceMeal}
                onPress={() => {
                  if (log) {
                    setExpandedId((current) =>
                      current === meal.id ? undefined : meal.id,
                    );
                  } else if (canEditSourceMeal) {
                    onEditManualContext?.(meal);
                  }
                }}
                style={({ pressed }) => [
                  styles.mealTop,
                  { opacity: pressed ? 0.68 : 1 },
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
                <View style={styles.mealCopy}>
                  <Text
                    numberOfLines={1}
                    style={[styles.mealTitle, { color: colors.text }]}
                  >
                    {meal.title}
                  </Text>
                  <Text
                    style={[styles.mealMeta, { color: colors.textSecondary }]}
                  >
                    {mealTypeLabel(meal.mealType)} ·{" "}
                    {formatTimelineEntryTimestamp(meal.start, showMealDates)}
                    {log
                      ? ` · ${formatRegionalNumber(log.items.length, regional.locale, { maximumFractionDigits: 0 })} item${log.items.length === 1 ? "" : "s"}`
                      : ""}
                  </Text>
                </View>
                <View style={styles.carbsCopy}>
                  <Text style={[styles.carbs, { color: colors.text }]}>
                    {displayedCarbs !== undefined
                      ? `${formatRegionalNumber(Math.round(displayedCarbs), regional.locale, { maximumFractionDigits: 0 })} g`
                      : displayedEnergy !== undefined
                        ? formatEnergy(displayedEnergy, regional)
                        : "—"}
                  </Text>
                  {log ? (
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.textTertiary}
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={17}
                    />
                  ) : (
                    <View style={styles.sourceOnlyAction}>
                      <Text
                        style={[
                          styles.sourceOnly,
                          { color: colors.textTertiary },
                        ]}
                      >
                        {canEditSourceMeal ? "TAP TO EDIT" : "SOURCE TOTAL"}
                      </Text>
                      {canEditSourceMeal ? (
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.primary}
                          name="create-outline"
                          size={15}
                        />
                      ) : null}
                    </View>
                  )}
                </View>
              </Pressable>

              {expanded && log ? (
                <View
                  style={[styles.details, { borderTopColor: colors.divider }]}
                >
                  {displayLog!.items.map((item, index) => (
                    <View
                      key={item.id}
                      style={[
                        styles.item,
                        index < displayLog!.items.length - 1 && {
                          borderBottomColor: colors.divider,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <View style={styles.itemCopy}>
                        <Text style={[styles.itemName, { color: colors.text }]}>
                          {item.name}
                        </Text>
                        <Text
                          style={[
                            styles.itemMeta,
                            { color: colors.textTertiary },
                          ]}
                        >
                          {item.brand ? `${item.brand} · ` : ""}
                          {editing
                            ? item.sourceLabel
                            : `${formatRegionalNumber(item.amount, regional.locale, { maximumFractionDigits: 2 })} ${item.unit} · ${item.sourceLabel}`}
                        </Text>
                      </View>
                      {editing ? (
                        <View style={styles.portionEditor}>
                          <View
                            style={[
                              styles.portionInputWrap,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                              },
                            ]}
                          >
                            <TextInput
                              accessibilityLabel={`${item.name} amount in ${item.unit}`}
                              keyboardType="decimal-pad"
                              onChangeText={(value) =>
                                setPortionDrafts((current) => ({
                                  ...current,
                                  [item.id]: value,
                                }))
                              }
                              selectTextOnFocus
                              style={[
                                styles.portionInput,
                                { color: colors.text },
                              ]}
                              value={portionDrafts[item.id] ?? ""}
                            />
                            <Text
                              style={[
                                styles.portionUnit,
                                { color: colors.textTertiary },
                              ]}
                            >
                              {item.unit}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.portionCarbs,
                              { color: colors.primary },
                            ]}
                          >
                            {grams(item.nutrition.carbohydrateGrams)}
                          </Text>
                        </View>
                      ) : (
                        <Text
                          style={[styles.itemCarbs, { color: colors.primary }]}
                        >
                          {grams(item.nutrition.carbohydrateGrams)}
                        </Text>
                      )}
                    </View>
                  ))}
                  {response && responseEvidence ? (
                    <Pressable
                      accessibilityHint={
                        onInspect
                          ? "Opens the exact readings and insulin records in this observed window."
                          : undefined
                      }
                      accessibilityLabel={`Observed glucose response. ${formatGlucose(response.baseline.mmolL, regional)} near the meal, peak ${formatGlucose(response.peak.mmolL, regional)}, change ${formatGlucose(response.riseMmolL, regional, { signed: true })}. ${formatRegionalNumber(response.readings.length, regional.locale, { maximumFractionDigits: 0 })} supporting readings.`}
                      accessibilityRole={onInspect ? "button" : undefined}
                      disabled={!onInspect}
                      onPress={() => onInspect?.(responseEvidence)}
                      style={({ pressed }) => [
                        styles.responseCard,
                        {
                          backgroundColor: `${colors.primary}0D`,
                          borderColor: `${colors.primary}44`,
                          borderRadius: radius.sm,
                          opacity: pressed && onInspect ? 0.7 : 1,
                        },
                      ]}
                    >
                      <View style={styles.responseHeader}>
                        <View>
                          <Text
                            style={[
                              styles.responseEyebrow,
                              { color: colors.primary },
                            ]}
                          >
                            OBSERVED GLUCOSE WINDOW
                          </Text>
                          <Text
                            style={[
                              styles.responseTitle,
                              { color: colors.text },
                            ]}
                          >
                            {formatGlucose(response.baseline.mmolL, regional, { withUnit: false })} →{" "}
                            {formatGlucose(response.peak.mmolL, regional)}
                          </Text>
                        </View>
                        <View style={styles.responseDelta}>
                          <Text
                            style={[
                              styles.responseDeltaValue,
                              { color: colors.primary },
                            ]}
                          >
                            {formatGlucose(response.riseMmolL, regional, {
                              withUnit: false,
                              signed: true,
                            })}
                          </Text>
                          <Text
                            style={[
                              styles.responseDeltaLabel,
                              { color: colors.textTertiary },
                            ]}
                          >
                            RISE
                          </Text>
                        </View>
                      </View>
                      <Text
                        style={[
                          styles.responseMeta,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Peak at {formatTime(response.peak.timestamp)}
                        {minutesToPeak !== undefined
                          ? ` · ${formatRegionalNumber(minutesToPeak, regional.locale, { maximumFractionDigits: 0 })} min after`
                          : ""}{" "}
                        ·{" "}
                        {formatRegionalNumber(
                          response.readings.length,
                          regional.locale,
                          { maximumFractionDigits: 0 },
                        )}{" "}
                        supporting readings
                      </Text>
                      <View style={styles.responseFoot}>
                        <Text
                          style={[
                            styles.responseCaveat,
                            { color: colors.textTertiary },
                          ]}
                        >
                          Timing association only—not proof of a food effect.
                        </Text>
                        {onInspect ? (
                          <Ionicons
                            accessibilityElementsHidden
                            color={colors.primary}
                            name="chevron-forward"
                            size={17}
                          />
                        ) : null}
                      </View>
                    </Pressable>
                  ) : null}
                  <View style={styles.macros}>
                    <View style={styles.macro}>
                      <Text style={[styles.macroValue, { color: colors.text }]}>
                        {displayLog!.nutrition.energyKcal === undefined
                          ? "—"
                          : formatEnergy(displayLog!.nutrition.energyKcal, regional)}
                      </Text>
                      <Text
                        style={[
                          styles.macroLabel,
                          { color: colors.textTertiary },
                        ]}
                      >
                        ENERGY
                      </Text>
                    </View>
                    <View style={styles.macro}>
                      <Text style={[styles.macroValue, { color: colors.text }]}>
                        {grams(displayLog!.nutrition.proteinGrams)}
                      </Text>
                      <Text
                        style={[
                          styles.macroLabel,
                          { color: colors.textTertiary },
                        ]}
                      >
                        PROTEIN
                      </Text>
                    </View>
                    <View style={styles.macro}>
                      <Text style={[styles.macroValue, { color: colors.text }]}>
                        {grams(displayLog!.nutrition.fatGrams)}
                      </Text>
                      <Text
                        style={[
                          styles.macroLabel,
                          { color: colors.textTertiary },
                        ]}
                      >
                        FAT
                      </Text>
                    </View>
                    <View style={styles.macro}>
                      <Text style={[styles.macroValue, { color: colors.text }]}>
                        {grams(displayLog!.nutrition.fibreGrams)}
                      </Text>
                      <Text
                        style={[
                          styles.macroLabel,
                          { color: colors.textTertiary },
                        ]}
                      >
                        FIBRE
                      </Text>
                    </View>
                  </View>
                  {!readOnly &&
                  dataMode === "live" &&
                  meal.origin === "manual" ? (
                    editing ? (
                      <View>
                        {portionError ? (
                          <Text
                            accessibilityLiveRegion="polite"
                            style={[
                              styles.portionError,
                              { color: colors.danger },
                            ]}
                          >
                            {portionError}
                          </Text>
                        ) : (
                          <Text
                            style={[
                              styles.portionHint,
                              { color: colors.textTertiary },
                            ]}
                          >
                            Nutrients scale from the source snapshot saved with
                            this meal.
                          </Text>
                        )}
                        <View style={styles.editActions}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={portionBusy}
                            onPress={cancelPortionEdit}
                            style={({ pressed }) => [
                              styles.editButton,
                              {
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                opacity: pressed ? 0.65 : 1,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.editButtonText,
                                { color: colors.textSecondary },
                              ]}
                            >
                              Cancel
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={portionBusy}
                            onPress={() => void savePortions(log)}
                            style={({ pressed }) => [
                              styles.editButton,
                              {
                                backgroundColor: colors.primary,
                                borderColor: colors.primary,
                                borderRadius: radius.sm,
                                opacity: pressed ? 0.68 : 1,
                              },
                            ]}
                          >
                            {portionBusy ? (
                              <ActivityIndicator
                                color={colors.onPrimary}
                                size="small"
                              />
                            ) : (
                              <>
                                <Ionicons
                                  accessibilityElementsHidden
                                  color={colors.onPrimary}
                                  name="checkmark"
                                  size={16}
                                />
                                <Text
                                  style={[
                                    styles.editButtonText,
                                    { color: colors.onPrimary },
                                  ]}
                                >
                                  Save portions
                                </Text>
                              </>
                            )}
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View>
                        <Pressable
                          accessibilityLabel={`Log ${meal.title} again now`}
                          accessibilityRole="button"
                          disabled={repeatBusyId !== undefined}
                          onPress={() => confirmRepeat(log)}
                          style={({ pressed }) => [
                            styles.repeatButton,
                            {
                              backgroundColor: colors.primary,
                              borderRadius: radius.sm,
                              opacity:
                                repeatBusyId !== undefined
                                  ? 0.6
                                  : pressed
                                    ? 0.68
                                    : 1,
                            },
                          ]}
                        >
                          {repeatBusyId === log.id ? (
                            <ActivityIndicator
                              color={colors.onPrimary}
                              size="small"
                            />
                          ) : (
                            <Ionicons
                              accessibilityElementsHidden
                              color={colors.onPrimary}
                              name="repeat-outline"
                              size={17}
                            />
                          )}
                          <Text
                            style={[
                              styles.repeatButtonText,
                              { color: colors.onPrimary },
                            ]}
                          >
                            Log this meal again now
                          </Text>
                        </Pressable>
                        <View style={styles.mealActions}>
                          {onEditFoodLog ? (
                            <Pressable
                              accessibilityLabel={`Edit ${meal.title}`}
                              accessibilityRole="button"
                              onPress={() => onEditFoodLog(log)}
                              style={({ pressed }) => [
                                styles.mealAction,
                                {
                                  borderColor: colors.border,
                                  borderRadius: radius.sm,
                                  opacity: pressed ? 0.65 : 1,
                                },
                              ]}
                            >
                              <Ionicons
                                accessibilityElementsHidden
                                color={colors.primary}
                                name="options-outline"
                                size={16}
                              />
                              <Text
                                style={[
                                  styles.mealActionText,
                                  { color: colors.primary },
                                ]}
                              >
                                Edit meal
                              </Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            accessibilityLabel={`Adjust portions for ${meal.title}`}
                            accessibilityRole="button"
                            onPress={() => beginPortionEdit(log)}
                            style={({ pressed }) => [
                              styles.mealAction,
                              {
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                opacity: pressed ? 0.65 : 1,
                              },
                            ]}
                          >
                            <Ionicons
                              accessibilityElementsHidden
                              color={colors.primary}
                              name="create-outline"
                              size={16}
                            />
                            <Text
                              style={[
                                styles.mealActionText,
                                { color: colors.primary },
                              ]}
                            >
                              Portions
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityLabel={`Remove ${meal.title}`}
                            accessibilityRole="button"
                            onPress={() => confirmDelete(meal)}
                            style={({ pressed }) => [
                              styles.mealAction,
                              {
                                borderColor: `${colors.danger}55`,
                                borderRadius: radius.sm,
                                opacity: pressed ? 0.65 : 1,
                              },
                            ]}
                          >
                            <Ionicons
                              accessibilityElementsHidden
                              color={colors.danger}
                              name="trash-outline"
                              size={16}
                            />
                            <Text
                              style={[
                                styles.mealActionText,
                                { color: colors.danger },
                              ]}
                            >
                              Remove
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {visibleMeals.length < filteredMeals.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setVisibleCount((count) => count + 12)}
          style={({ pressed }) => [
            styles.showMore,
            {
              borderColor: colors.border,
              borderRadius: radius.sm,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
        >
          <Text style={[styles.showMoreText, { color: colors.primary }]}>
            Show more meals ({formatRegionalNumber(
              filteredMeals.length - visibleMeals.length,
              regional.locale,
              { maximumFractionDigits: 0 },
            )} remaining)
          </Text>
        </Pressable>
      ) : null}

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Nutrients are saved as a snapshot, so old meals do not change when a
        food database entry changes later.
      </Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    marginTop: 2,
  },
  totalCopy: {
    alignItems: "flex-end",
  },
  total: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  totalLabel: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  energy: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
  },
  repeatMessage: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
  rows: {
    gap: 8,
    marginTop: 14,
  },
  meal: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  mealTop: {
    minHeight: 78,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  mealCopy: {
    flex: 1,
  },
  mealTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  mealMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  carbsCopy: {
    alignItems: "flex-end",
    gap: 2,
  },
  carbs: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  sourceOnly: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  sourceOnlyAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  item: {
    minHeight: 56,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  itemCopy: {
    flex: 1,
  },
  itemName: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  itemMeta: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 1,
  },
  itemCarbs: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  responseCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    marginTop: 10,
  },
  responseHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  responseEyebrow: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  responseTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  responseDelta: {
    alignItems: "flex-end",
  },
  responseDeltaValue: {
    fontSize: 18,
    lineHeight: 21,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  responseDeltaLabel: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  responseMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 7,
  },
  responseFoot: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 5,
  },
  responseCaveat: {
    flex: 1,
    fontSize: 9,
    lineHeight: 14,
  },
  portionEditor: {
    width: 92,
    alignItems: "flex-end",
    gap: 3,
  },
  portionInputWrap: {
    width: 92,
    height: 40,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
  },
  portionInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  portionUnit: {
    fontSize: 10,
    lineHeight: 14,
    marginLeft: 4,
  },
  portionCarbs: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  macros: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 6,
    paddingTop: 10,
  },
  macro: {
    flex: 1,
  },
  macroValue: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  macroLabel: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "800",
    letterSpacing: 0.45,
  },
  mealActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  repeatButton: {
    minHeight: 44,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
  },
  repeatButtonText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  mealAction: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 8,
  },
  mealActionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  portionHint: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 10,
  },
  portionError: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
  editActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  editButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  editButtonText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  showMore: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  showMoreText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  footnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 12,
  },
  filteredEmpty: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 4,
    paddingVertical: 16,
  },
});
