import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  allFoodCopyItemIdentities,
  foodCopyItemIdentity,
  foodCopyMealGroups,
  foodCopyMealSelectionState,
  foodCopyPlannerSelections,
  foodCopySelectionSummary,
  toggleAllFoodCopyItems,
  toggleFoodCopyItem,
  toggleFoodCopyMeal,
} from './copyPresentation';
import { presentFoodNutrition } from './presentation';
import type {
  FoodCopyMode,
  FoodCopySelection,
} from '@/data/food/foodCopyPlanner';
import type { FoodLog } from '@/data/food/types';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { addDays, formatDate, formatTime, type DateKey } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

export interface FoodCopyFromDaySheetProps {
  visible: boolean;
  sourceDate: DateKey;
  sourceLogs: readonly FoodLog[];
  selectedItemIdentities: readonly string[];
  mode: FoodCopyMode;
  loading?: boolean;
  error?: string;
  /** Non-fatal validation/planning error; source meals remain editable. */
  actionError?: string;
  canNavigateBack?: boolean;
  canNavigateForward?: boolean;
  onSourceDateChange(date: DateKey): void;
  onSelectedItemIdentitiesChange(identities: string[]): void;
  onModeChange(mode: FoodCopyMode): void;
  onCancel(): void;
  onConfirm(selections: FoodCopySelection[], mode: FoodCopyMode): void;
}

function Checkmark({ checked }: { checked: boolean | 'mixed' }) {
  const { colors } = useAppTheme();
  return (
    <Ionicons
      accessibilityElementsHidden
      color={checked ? colors.primary : colors.textTertiary}
      name={
        checked === 'mixed'
          ? 'remove-circle'
          : checked
            ? 'checkmark-circle'
            : 'ellipse-outline'
      }
      size={25}
    />
  );
}

export function FoodCopyFromDaySheet({
  visible,
  sourceDate,
  sourceLogs,
  selectedItemIdentities,
  mode,
  loading = false,
  error,
  actionError,
  canNavigateBack = true,
  canNavigateForward = true,
  onSourceDateChange,
  onSelectedItemIdentitiesChange,
  onModeChange,
  onCancel,
  onConfirm,
}: FoodCopyFromDaySheetProps) {
  const { colors, radius } = useAppTheme();
  const regional = getRuntimeRegionalDefaults();
  const groups = foodCopyMealGroups(sourceLogs);
  const sections = groups.map((group) => ({
    title: group.title,
    mealType: group.mealType,
    data: group.logs,
  }));
  const visibleIdentities = allFoodCopyItemIdentities(sourceLogs);
  const visibleSelectedCount = visibleIdentities.filter((identity) =>
    selectedItemIdentities.includes(identity),
  ).length;
  const allSelected = visibleIdentities.length > 0 &&
    visibleSelectedCount === visibleIdentities.length;
  const someSelected = visibleSelectedCount > 0;
  const summary = foodCopySelectionSummary(sourceLogs, selectedItemIdentities);
  const summaryCarbs = presentFoodNutrition({
    carbohydrateGrams: summary.carbohydrateGrams,
  }).carbs;

  function confirm() {
    const selections = foodCopyPlannerSelections(
      sourceLogs,
      selectedItemIdentities,
    );
    if (selections.length) onConfirm(selections, mode);
  }

  function renderMeal({ item: log }: { item: FoodLog }) {
    const mealState = foodCopyMealSelectionState(log, selectedItemIdentities);
    const mealCarbs = presentFoodNutrition(log.nutrition).carbs;
    return (
      <View
        style={[
          styles.mealCard,
          {
            backgroundColor: colors.surface,
            borderColor: mealState ? `${colors.primary}66` : colors.border,
            borderRadius: radius.lg,
          },
        ]}
      >
        <Pressable
          accessibilityHint="Selects or clears every food in this meal"
          accessibilityLabel={`${log.title}, ${formatTime(log.timestamp)}, ${formatRegionalNumber(log.items.length, regional.locale, { maximumFractionDigits: 0 })} ${
            log.items.length === 1 ? 'food' : 'foods'
          }, ${mealCarbs}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: mealState }}
          disabled={!log.items.length}
          onPress={() => onSelectedItemIdentitiesChange(
            toggleFoodCopyMeal(selectedItemIdentities, log),
          )}
          style={({ pressed }) => [
            styles.mealHeader,
            { opacity: pressed ? 0.66 : log.items.length ? 1 : 0.45 },
          ]}
        >
          <Checkmark checked={mealState} />
          <View style={styles.mealCopy}>
            <Text numberOfLines={2} style={[styles.mealTitle, { color: colors.text }]}>
              {log.title}
            </Text>
            <Text style={[styles.mealMeta, { color: colors.textSecondary }]}>
              {formatTime(log.timestamp)} · {mealCarbs}
            </Text>
          </View>
          <Text style={[styles.itemCount, { color: colors.textTertiary }]}>
            {formatRegionalNumber(log.items.length, regional.locale, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Pressable>

        {log.items.map((item) => {
          const identity = foodCopyItemIdentity(log.id, item.id);
          const checked = selectedItemIdentities.includes(identity);
          const carbs = presentFoodNutrition(item.nutrition).carbs;
          return (
            <Pressable
              accessibilityHint="Adds or removes this food from the copy selection"
              accessibilityLabel={`${item.name}, ${formatRegionalNumber(item.amount, regional.locale, { maximumFractionDigits: 2 })} ${item.unit}, ${carbs}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              key={identity}
              onPress={() => onSelectedItemIdentitiesChange(
                toggleFoodCopyItem(selectedItemIdentities, identity),
              )}
              style={({ pressed }) => [
                styles.itemRow,
                {
                  borderTopColor: colors.divider,
                  opacity: pressed ? 0.64 : 1,
                },
              ]}
            >
              <Checkmark checked={checked} />
              <View style={styles.itemCopy}>
                <Text numberOfLines={2} style={[styles.itemName, { color: colors.text }]}>
                  {item.name}
                </Text>
                <Text style={[styles.itemMeta, { color: colors.textSecondary }]}>
                  {formatRegionalNumber(item.amount, regional.locale, {
                    maximumFractionDigits: 2,
                  })} {item.unit}
                  {item.brand ? ` · ${item.brand}` : ''}
                </Text>
              </View>
              <Text style={[styles.itemCarbs, { color: colors.primaryStrong }]}>
                {carbs}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  const dateNavigator = (
    <View style={styles.dateNavigator}>
        <Pressable
          accessibilityLabel="Previous day"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canNavigateBack || loading }}
          disabled={!canNavigateBack || loading}
          onPress={() => onSourceDateChange(addDays(sourceDate, -1))}
          style={({ pressed }) => [
            styles.dateArrow,
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
              opacity: !canNavigateBack || loading ? 0.36 : pressed ? 0.62 : 1,
            },
          ]}
        >
          <Ionicons accessibilityElementsHidden color={colors.text} name="chevron-back" size={22} />
        </Pressable>
        <View style={styles.dateCopy}>
          <Text accessibilityRole="header" style={[styles.dateTitle, { color: colors.text }]}>
            {formatDate(sourceDate, { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
          <Text style={[styles.dateKey, { color: colors.primary }]}>{sourceDate}</Text>
        </View>
        <Pressable
          accessibilityLabel="Next day"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canNavigateForward || loading }}
          disabled={!canNavigateForward || loading}
          onPress={() => onSourceDateChange(addDays(sourceDate, 1))}
          style={({ pressed }) => [
            styles.dateArrow,
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
              opacity: !canNavigateForward || loading ? 0.36 : pressed ? 0.62 : 1,
            },
          ]}
        >
          <Ionicons accessibilityElementsHidden color={colors.text} name="chevron-forward" size={22} />
        </Pressable>
    </View>
  );

  const listHeader = (
    <View style={styles.listHeader}>
      {dateNavigator}

      <View style={styles.modeBlock}>
        <Text style={[styles.modeHeading, { color: colors.text }]}>Add to this unsaved meal</Text>
        <Text style={[styles.modeHelper, { color: colors.textSecondary }]}>
          Choose whether these foods join or replace the foods currently in your draft.
        </Text>
        <View accessibilityRole="radiogroup" style={styles.modeOptions}>
          {([
            ['append', 'Add alongside', 'Keep current draft foods'],
            ['replace', 'Replace draft', 'Clear current draft foods first'],
          ] as const).map(([value, label, detail]) => {
            const selected = mode === value;
            return (
              <Pressable
                accessibilityLabel={`${label}. ${detail}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={value}
                onPress={() => onModeChange(value)}
                style={({ pressed }) => [
                  styles.modeOption,
                  {
                    backgroundColor: selected ? `${colors.primary}14` : colors.surface,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.66 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={selected ? colors.primary : colors.textTertiary}
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                />
                <View style={styles.modeCopy}>
                  <Text style={[styles.modeLabel, { color: colors.text }]}>{label}</Text>
                  <Text style={[styles.modeDetail, { color: colors.textSecondary }]}>{detail}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {actionError ? (
        <View
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={[
            styles.actionError,
            {
              backgroundColor: `${colors.danger}0F`,
              borderColor: `${colors.danger}52`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.danger}
            name="alert-circle-outline"
            size={21}
          />
          <Text style={[styles.actionErrorText, { color: colors.text }]}>
            {actionError}
          </Text>
        </View>
      ) : null}

      {!loading && !error && visibleIdentities.length ? (
        <Pressable
          accessibilityHint="Selects or clears every food shown for this date"
          accessibilityLabel={`${allSelected ? 'Clear' : 'Select'} all ${formatRegionalNumber(visibleIdentities.length, regional.locale, { maximumFractionDigits: 0 })} foods`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: allSelected ? true : someSelected ? 'mixed' : false }}
          onPress={() => onSelectedItemIdentitiesChange(
            toggleAllFoodCopyItems(selectedItemIdentities, sourceLogs),
          )}
          style={({ pressed }) => [styles.selectAll, { opacity: pressed ? 0.62 : 1 }]}
        >
          <Checkmark checked={allSelected ? true : someSelected ? 'mixed' : false} />
          <Text style={[styles.selectAllText, { color: colors.primaryStrong }]}>
            {allSelected ? 'Clear all' : 'Select all'}
          </Text>
          <Text style={[styles.selectAllCount, { color: colors.textTertiary }]}>
            {formatRegionalNumber(visibleSelectedCount, regional.locale, {
              maximumFractionDigits: 0,
            })}
            /
            {formatRegionalNumber(visibleIdentities.length, regional.locale, {
              maximumFractionDigits: 0,
            })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      presentationStyle="pageSheet"
      statusBarTranslucent
      visible={visible}
    >
      <SafeAreaView
        accessibilityLabel="Copy foods from another day"
        accessibilityViewIsModal
        edges={['top', 'bottom']}
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View style={[styles.header, { borderBottomColor: colors.divider }]}>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>COPY FROM DAY</Text>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Choose foods</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Nothing is saved until you save the meal.</Text>
          </View>
          <Pressable
            accessibilityLabel="Cancel copying foods"
            accessibilityRole="button"
            onPress={onCancel}
            style={({ pressed }) => [
              styles.close,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radius.pill,
                opacity: pressed ? 0.62 : 1,
              },
            ]}
          >
            <Ionicons accessibilityElementsHidden color={colors.text} name="close" size={23} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.statePage}>
            <View style={styles.stateDate}>{dateNavigator}</View>
            <View accessibilityLabel="Loading meals" accessibilityRole="progressbar" style={styles.state}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[styles.stateTitle, { color: colors.text }]}>Loading meals…</Text>
              <Text style={[styles.stateDetail, { color: colors.textSecondary }]}>Looking on this phone for saved food snapshots.</Text>
            </View>
          </View>
        ) : error ? (
          <View style={styles.statePage}>
            <View style={styles.stateDate}>{dateNavigator}</View>
            <View accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.state}>
              <Ionicons accessibilityElementsHidden color={colors.danger} name="alert-circle-outline" size={34} />
              <Text style={[styles.stateTitle, { color: colors.text }]}>Meals could not be loaded</Text>
              <Text style={[styles.stateDetail, { color: colors.textSecondary }]}>{error}</Text>
              <Pressable
                accessibilityHint="Tries loading saved meals for this date again"
                accessibilityLabel="Try loading meals again"
                accessibilityRole="button"
                onPress={() => onSourceDateChange(sourceDate)}
                style={({ pressed }) => [
                  styles.retry,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.66 : 1,
                  },
                ]}
              >
                <Ionicons accessibilityElementsHidden color={colors.primary} name="refresh" size={19} />
                <Text style={[styles.retryText, { color: colors.primaryStrong }]}>Try again</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <SectionList
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(log) => log.id}
            ListEmptyComponent={(
              <View style={styles.empty}>
                <Ionicons accessibilityElementsHidden color={colors.textTertiary} name="restaurant-outline" size={34} />
                <Text style={[styles.stateTitle, { color: colors.text }]}>No saved meals on this day</Text>
                <Text style={[styles.stateDetail, { color: colors.textSecondary }]}>Choose an earlier date or add foods manually.</Text>
              </View>
            )}
            ListHeaderComponent={listHeader}
            renderItem={renderMeal}
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
                <Text style={[styles.sectionCount, { color: colors.textTertiary }]}>
                  {formatRegionalNumber(section.data.length, regional.locale, {
                    maximumFractionDigits: 0,
                  })}{' '}
                  {section.data.length === 1 ? 'meal' : 'meals'}
                </Text>
              </View>
            )}
            sections={sections}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled
          />
        )}

        <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.divider }]}>
          <View accessibilityLiveRegion="polite" style={styles.summary}>
            <Text style={[styles.summaryCount, { color: colors.text }]}>
              {formatRegionalNumber(summary.itemCount, regional.locale, {
                maximumFractionDigits: 0,
              })}{' '}
              {summary.itemCount === 1 ? 'food' : 'foods'} from{' '}
              {formatRegionalNumber(summary.mealCount, regional.locale, {
                maximumFractionDigits: 0,
              })}{' '}
              {summary.mealCount === 1 ? 'meal' : 'meals'}
            </Text>
            <Text style={[styles.summaryCarbs, { color: colors.primaryStrong }]}>
              {summary.itemCount ? summaryCarbs : 'Select foods to continue'}
            </Text>
          </View>
          <Pressable
            accessibilityHint={
              mode === 'append'
                ? 'Adds the selected foods to the current unsaved meal draft'
                : 'Replaces the foods in the current unsaved meal draft with this selection'
            }
            accessibilityLabel={
              mode === 'append'
                ? `Add ${formatRegionalNumber(summary.itemCount, regional.locale, { maximumFractionDigits: 0 })} selected foods to draft`
                : `Replace draft with ${formatRegionalNumber(summary.itemCount, regional.locale, { maximumFractionDigits: 0 })} selected foods`
            }
            accessibilityRole="button"
            accessibilityState={{ disabled: summary.itemCount === 0 || loading || Boolean(error) }}
            disabled={summary.itemCount === 0 || loading || Boolean(error)}
            onPress={confirm}
            style={({ pressed }) => [
              styles.confirm,
              {
                backgroundColor: summary.itemCount && !loading && !error ? colors.primary : colors.surfaceMuted,
                borderRadius: radius.md,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={summary.itemCount && !loading && !error ? colors.onPrimary : colors.textTertiary}
              name={mode === 'append' ? 'add-circle-outline' : 'swap-horizontal-outline'}
              size={21}
            />
            <Text style={[
              styles.confirmText,
              { color: summary.itemCount && !loading && !error ? colors.onPrimary : colors.textTertiary },
            ]}>
              {mode === 'append' ? 'Add selected' : 'Replace draft'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 78,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerCopy: { flex: 1, paddingRight: 16 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.55, lineHeight: 29 },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  close: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  content: { paddingBottom: 24, paddingHorizontal: 16 },
  listHeader: { gap: 16, paddingBottom: 8, paddingTop: 16 },
  dateNavigator: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  dateArrow: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  dateCopy: { alignItems: 'center', flex: 1, paddingHorizontal: 8 },
  dateTitle: { fontSize: 16, fontWeight: '800', lineHeight: 21, textAlign: 'center' },
  dateKey: { fontSize: 10, fontWeight: '900', letterSpacing: 0.9, marginTop: 2 },
  modeBlock: { gap: 6 },
  modeHeading: { fontSize: 16, fontWeight: '800' },
  modeHelper: { fontSize: 13, lineHeight: 18 },
  modeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  modeOption: {
    alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, flex: 1,
    flexDirection: 'row', gap: 8, minHeight: 58, minWidth: 145,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  modeCopy: { flex: 1 },
  modeLabel: { fontSize: 13, fontWeight: '800' },
  modeDetail: { fontSize: 10, lineHeight: 14, marginTop: 1 },
  actionError: {
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionErrorText: { flex: 1, fontSize: 12, lineHeight: 18, minWidth: 0 },
  selectAll: { alignItems: 'center', flexDirection: 'row', minHeight: 48 },
  selectAllText: { flex: 1, fontSize: 14, fontWeight: '800', marginLeft: 10 },
  selectAllCount: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '700' },
  sectionHeader: {
    alignItems: 'baseline', flexDirection: 'row', justifyContent: 'space-between',
    paddingBottom: 8, paddingTop: 14,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.25 },
  sectionCount: { fontSize: 12, fontWeight: '700' },
  mealCard: { borderWidth: StyleSheet.hairlineWidth, marginBottom: 12, overflow: 'hidden' },
  mealHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 64, paddingHorizontal: 14, paddingVertical: 8 },
  mealCopy: { flex: 1, marginLeft: 10 },
  mealTitle: { fontSize: 15, fontWeight: '800', lineHeight: 20 },
  mealMeta: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  itemCount: { fontSize: 12, fontVariant: ['tabular-nums'], fontWeight: '800', marginLeft: 8 },
  itemRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  itemCopy: { flex: 1, marginLeft: 10 },
  itemName: { fontSize: 14, fontWeight: '700', lineHeight: 19 },
  itemMeta: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  itemCarbs: { fontSize: 12, fontWeight: '800', marginLeft: 8, maxWidth: 90, textAlign: 'right' },
  statePage: { flex: 1 },
  stateDate: { paddingHorizontal: 16, paddingTop: 16 },
  state: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 54 },
  stateTitle: { fontSize: 17, fontWeight: '800', marginTop: 12, textAlign: 'center' },
  stateDetail: { fontSize: 13, lineHeight: 19, marginTop: 5, textAlign: 'center' },
  retry: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  retryText: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  footer: {
    alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row',
    gap: 12, minHeight: 82, paddingHorizontal: 16, paddingVertical: 10,
  },
  summary: { flex: 1 },
  summaryCount: { fontSize: 12, fontWeight: '700', lineHeight: 17 },
  summaryCarbs: { fontSize: 14, fontWeight: '800', lineHeight: 19, marginTop: 1 },
  confirm: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 52, minWidth: 142, paddingHorizontal: 16 },
  confirmText: { fontSize: 14, fontWeight: '800' },
});
