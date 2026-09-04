import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  HealthConnectCategoryId,
  HealthConnectStatus,
} from '../../modules/t1arc-health-connect';
import { updateHealthConnectBackgroundSyncRegistration } from '@/data/background/healthConnectSyncTask';
import {
  getHealthConnectOverview,
  getHealthConnectStatus,
  HealthConnectOverview,
  HealthConnectSyncResult,
  openHealthConnectInstall,
  openHealthConnectSettings,
  requestHealthConnectBackgroundPermission,
  requestHealthConnectHistoryPermission,
  requestHealthConnectPermissions,
  saveHealthConnectPreferences,
  savePreferredHealthConnectSource,
  syncHealthConnect,
  useAutomaticHealthConnectSource as selectAutomaticHealthConnectSource,
} from '@/data/healthConnect/healthConnectRepository';
import {
  HEALTH_CONNECT_CATEGORIES,
  STARTER_HEALTH_CONNECT_CATEGORIES,
} from '@/data/healthConnect/healthConnectRecords';
import { relativeAge } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { getRuntimeRegionalDefaults } from '@/domain/regionalProfileRuntime';
import { useDataContext } from '@/providers/DataProvider';

import { SectionCard } from './SectionCard';
import { presentHealthConnectState } from './healthConnect/presentation';

type Operation =
  | 'loading'
  | 'connecting'
  | 'enabling_history'
  | 'syncing'
  | 'saving_preferences'
  | 'choosing_source'
  | undefined;

const categoryIcons: Record<
  HealthConnectCategoryId,
  keyof typeof Ionicons.glyphMap
> = {
  steps: 'footsteps-outline',
  workouts: 'barbell-outline',
  heart_rate: 'heart-outline',
  sleep: 'moon-outline',
  weight: 'scale-outline',
  body_composition: 'body-outline',
  blood_glucose: 'water-outline',
  vitals: 'pulse-outline',
  cycle: 'calendar-outline',
  hydration: 'water-outline',
  nutrition: 'nutrition-outline',
  distance: 'navigate-outline',
  active_calories: 'flame-outline',
};

function healthCategoryLabel(category: HealthConnectCategoryId) {
  return (
    HEALTH_CONNECT_CATEGORIES.find((item) => item.id === category)?.label ??
    category
  );
}

function regionalCount(value: number) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale, {
    maximumFractionDigits: 0,
  });
}

function syncResultMessage(
  result: HealthConnectSyncResult,
  emptyMessage: string,
) {
  const checked = result.recordsProcessed
    ? `${regionalCount(result.recordsProcessed)} health items checked.`
    : emptyMessage;
  const removed = result.recordsRemoved
    ? ` ${regionalCount(result.recordsRemoved)} deleted ${
        result.recordsRemoved === 1 ? 'item was' : 'items were'
      } cleared.`
    : '';
  if (!result.failures.length) return `${checked}${removed}`;
  const failedLabels = result.failures
    .map((failure) => healthCategoryLabel(failure.category))
    .join(', ');
  return `${checked}${removed} ${failedLabels} could not be updated and will be retried separately.`;
}

async function readHealthConnectState() {
  const [status, overview] = await Promise.all([
    getHealthConnectStatus(),
    getHealthConnectOverview(),
  ]);
  return { status, overview };
}

export function HealthConnectCard({
  onDataChanged,
}: {
  onDataChanged?: () => Promise<void> | void;
}) {
  const { colors, radius } = useAppTheme();
  const { now } = useDataContext();
  const [status, setStatus] = useState<HealthConnectStatus>();
  const [overview, setOverview] = useState<HealthConnectOverview>();
  const [selected, setSelected] = useState<HealthConnectCategoryId[]>(
    STARTER_HEALTH_CONNECT_CATEGORIES,
  );
  const [operation, setOperation] = useState<Operation>('loading');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [showDetails, setShowDetails] = useState(false);
  const mounted = useRef(true);
  const preferenceRefreshGeneration = useRef(0);

  useEffect(
    () => () => {
      mounted.current = false;
      preferenceRefreshGeneration.current += 1;
    },
    [],
  );

  const applyLoadedState = useCallback(
    (nextStatus: HealthConnectStatus, nextOverview: HealthConnectOverview) => {
      setStatus(nextStatus);
      setOverview(nextOverview);
      setSelected(
        nextOverview.preferences
          .filter((preference) => preference.enabled)
          .map((preference) => preference.category),
      );
      setError(undefined);
    },
    [],
  );

  const load = useCallback(async () => {
    const next = await readHealthConnectState();
    applyLoadedState(next.status, next.overview);
  }, [applyLoadedState]);

  useEffect(() => {
    let active = true;
    void readHealthConnectState()
      .then((next) => {
        if (!active) return;
        applyLoadedState(next.status, next.overview);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Health Connect could not be checked.',
        );
      })
      .finally(() => {
        if (active) {
          setOperation((value) => (value === 'loading' ? undefined : value));
        }
      });
    return () => {
      active = false;
    };
  }, [applyLoadedState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      void load().catch((loadError) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Health Connect could not be checked.',
        );
      });
    });
    return () => subscription.remove();
  }, [load]);

  const categoryStatus = useMemo(
    () =>
      new Map(
        status?.categories.map((category) => [category.id, category]) ?? [],
      ),
    [status],
  );
  const permissionCategories = selected.filter(
    (category) => !categoryStatus.get(category)?.granted,
  );
  const needsPermission = permissionCategories.length > 0;
  const busy = operation !== undefined;
  const connected = Boolean(
    status?.categories.some((category) => category.granted),
  );
  const savedCategories = useMemo(
    () =>
      overview?.preferences
        .filter((preference) => preference.enabled)
        .map((preference) => preference.category) ?? [],
    [overview?.preferences],
  );
  const selectionDirty = useMemo(() => {
    if (!overview) return false;
    const saved = new Set(savedCategories);
    return (
      saved.size !== selected.length ||
      selected.some((category) => !saved.has(category))
    );
  }, [overview, savedCategories, selected]);
  const importsPaused = Boolean(overview) && savedCategories.length === 0;
  const selectedSyncStates = useMemo(
    () =>
      selected.map((category) => ({
        category,
        state: overview?.sync.find((item) => item.category === category),
      })),
    [overview?.sync, selected],
  );
  const latestSuccessfulSync = Math.max(
    0,
    ...selectedSyncStates.map((item) => item.state?.lastSuccessAt ?? 0),
  );
  const allSelectedCategoriesSynced =
    selectedSyncStates.length > 0 &&
    selectedSyncStates.every((item) => (item.state?.lastSuccessAt ?? 0) > 0);
  const oldestSelectedSuccessfulSync = allSelectedCategoriesSynced
    ? Math.min(
        ...selectedSyncStates.map((item) => item.state?.lastSuccessAt ?? 0),
      )
    : 0;
  const latestHealthData = Math.max(
    0,
    ...selectedSyncStates.map((item) => item.state?.dataThrough ?? 0),
  );
  const syncFailures = selectedSyncStates.filter(
    (item) => item.state?.lastErrorMessage,
  );
  const changeTrackingReady =
    selectedSyncStates.length > 0 &&
    selectedSyncStates.every((item) => item.state?.changesToken);
  const detailsVisible = showDetails || selectionDirty;

  function toggleCategory(category: HealthConnectCategoryId) {
    if (busy) return;
    setMessage(undefined);
    setSelected((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  async function finishRefresh() {
    await updateHealthConnectBackgroundSyncRegistration().catch(() => false);
    await load();
    await onDataChanged?.();
  }

  async function retryLoad() {
    if (busy) return;
    setOperation('loading');
    setError(undefined);
    try {
      await load();
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Health Connect could not be checked.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  const scheduleHealthPreferencesPostCommitRefresh = useCallback(() => {
    const generation = ++preferenceRefreshGeneration.current;
    setTimeout(() => {
      void (async () => {
        await updateHealthConnectBackgroundSyncRegistration().catch(
          () => false,
        );
        const next = await readHealthConnectState();
        if (
          !mounted.current ||
          generation !== preferenceRefreshGeneration.current
        ) {
          return;
        }
        // Preserve any new, unsaved taps made after the save acknowledgement.
        setStatus(next.status);
        setOverview(next.overview);
        await onDataChanged?.();
      })().catch((refreshError) => {
        if (
          !mounted.current ||
          generation !== preferenceRefreshGeneration.current
        ) {
          return;
        }
        setError(
          refreshError instanceof Error
            ? `Your health choices are saved, but the background refresh could not finish: ${refreshError.message}`
            : 'Your health choices are saved, but the background refresh could not finish.',
        );
      });
    }, 0);
  }, [onDataChanged]);

  async function saveCategoryChoices() {
    if (!overview || busy || !selectionDirty) return;
    const nextSelection = [...selected];
    setOperation('saving_preferences');
    setError(undefined);
    setMessage(undefined);
    try {
      await saveHealthConnectPreferences(nextSelection);
      const enabled = new Set(nextSelection);
      setOverview((current) =>
        current
          ? {
              ...current,
              preferences: current.preferences.map((preference) => ({
                ...preference,
                enabled: enabled.has(preference.category),
              })),
            }
          : current,
      );
      setMessage(
        nextSelection.length
          ? 'Your health choices are saved. New areas will ask for access before they are imported.'
          : 'Health imports are paused. Information already in T1 Arc is still available.',
      );
      setOperation(undefined);
      scheduleHealthPreferencesPostCommitRefresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Your health choices could not be saved.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function enableBackgroundUpdates() {
    if (!status || busy || !selected.length) return;
    setOperation('connecting');
    setError(undefined);
    setMessage(undefined);
    try {
      const nextStatus = await requestHealthConnectBackgroundPermission();
      setStatus(nextStatus);
      if (!nextStatus.backgroundGranted) {
        setMessage(
          'Automatic updates were not allowed. T1 Arc will still refresh health data whenever you open it.',
        );
        return;
      }
      const enabled = await updateHealthConnectBackgroundSyncRegistration();
      setMessage(
        enabled
          ? 'Automatic health updates are on.'
          : 'Automatic updates are off. T1 Arc will still refresh health data whenever you open it.',
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Automatic health updates could not be enabled.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function enableOlderHistory() {
    if (!status || busy || !selected.length) return;
    setOperation('enabling_history');
    setError(undefined);
    setMessage(undefined);
    try {
      const nextStatus = await requestHealthConnectHistoryPermission();
      setStatus(nextStatus);
      if (!nextStatus.historyGranted) {
        setMessage(
          'Older history was not allowed. Recent Health Connect data will keep working.',
        );
        return;
      }
      const granted = selected.filter(
        (category) =>
          nextStatus.categories.find((item) => item.id === category)?.granted,
      );
      if (!granted.length) {
        setMessage(
          'Older-history access is allowed. Choose and allow a health area before importing it.',
        );
        return;
      }
      setOperation('syncing');
      const result = await syncHealthConnect({
        categories: granted,
        fullHistory: true,
      });
      await finishRefresh();
      setMessage(
        syncResultMessage(
          result,
          'Older health history is allowed. No additional records were available.',
        ),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Older health history could not be imported.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function connectOrSync() {
    if (!status || busy) return;
    if (!selected.length) {
      Alert.alert(
        'Choose what to connect',
        'Select at least one health category first.',
      );
      return;
    }
    if (status.availability === 'update_required') {
      await openHealthConnectInstall();
      return;
    }
    if (status.availability !== 'available') {
      Alert.alert(
        'Health Connect is unavailable',
        'This Android version or device profile cannot provide Health Connect.',
      );
      return;
    }

    setError(undefined);
    setMessage(undefined);
    setOperation(needsPermission ? 'connecting' : 'syncing');
    try {
      await saveHealthConnectPreferences(selected);
      const nextStatus = needsPermission
        ? await requestHealthConnectPermissions(permissionCategories)
        : status;
      setStatus(nextStatus);
      const granted = selected.filter(
        (category) =>
          nextStatus.categories.find((item) => item.id === category)?.granted,
      );
      if (!granted.length) {
        setMessage('No health categories were allowed. Nothing was imported.');
        return;
      }
      setOperation('syncing');
      const result = await syncHealthConnect({
        categories: granted,
        fullHistory: !overview?.totalRecords,
      });
      await finishRefresh();
      setMessage(
        syncResultMessage(
          result,
          'Connected successfully. No records were available from the selected sources yet.',
        ),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Health data could not be imported.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function recheckFullHistory() {
    if (!status || busy) return;
    const granted = selected.filter(
      (category) =>
        status.categories.find((item) => item.id === category)?.granted,
    );
    if (!granted.length) {
      setMessage('Allow a health category before rechecking its history.');
      return;
    }
    setError(undefined);
    setMessage(undefined);
    setOperation('syncing');
    try {
      const result = await syncHealthConnect({
        categories: granted,
        fullHistory: true,
      });
      await finishRefresh();
      setMessage(
        syncResultMessage(
          result,
          'Full history was rechecked; no available records were returned.',
        ),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Full health history could not be rechecked.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  function confirmFullHistoryRecheck() {
    Alert.alert(
      'Recheck all health history?',
      'T1 Arc will check all available history for the selected categories again. Heart-rate history may take a while. Your data stays on this phone and existing information is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Recheck all',
          onPress: () => void recheckFullHistory(),
        },
      ],
    );
  }

  async function chooseSource(
    category: HealthConnectCategoryId,
    packageName?: string,
  ) {
    if (busy) return;
    setOperation('choosing_source');
    setError(undefined);
    try {
      if (packageName) {
        await savePreferredHealthConnectSource(category, packageName, 'manual');
      } else {
        await selectAutomaticHealthConnectSource(category);
      }
      await finishRefresh();
      setMessage(
        packageName
          ? 'This app or device will now be used for this type of health data. Other copies are kept but hidden from the main view.'
          : 'T1 Arc will choose the best app or device for this health data.',
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'The source preference could not be saved.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  const healthConnectPresentation = presentHealthConnectState({
    allSelectedCategoriesSynced,
    availability: status?.availability,
    connected,
    importsPaused,
    initialLoading: operation === 'loading' && !status,
    loadFailed: Boolean(error),
    latestHealthData,
    latestSuccessfulSync,
    oldestSelectedSuccessfulSync,
    now,
    syncFailureCount: syncFailures.length,
  });
  const statusLabel = healthConnectPresentation.statusLabel;
  const statusTone =
    operation === 'loading' && !status
      ? colors.textTertiary
      : error || status?.availability !== 'available'
        ? colors.warning
        : connected && !importsPaused
          ? colors.accent
          : colors.textTertiary;

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.headerIcon,
            {
              backgroundColor: `${colors.primary}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="fitness-outline"
            size={25}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Android health data
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Samsung Health, Fitbit and compatible apps
          </Text>
        </View>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: `${statusTone}18`,
              borderColor: `${statusTone}55`,
              borderRadius: radius.pill,
            },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: statusTone }]} />
          <Text style={[styles.statusText, { color: statusTone }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {connected ? (
        <View
          style={[
            styles.connectionSummary,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor:
                !importsPaused && syncFailures.length
                  ? `${colors.warning}66`
                  : colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={
              importsPaused
                ? colors.textTertiary
                : syncFailures.length
                  ? colors.warning
                  : colors.accent
            }
            name={
              importsPaused
                ? 'pause-circle-outline'
                : syncFailures.length
                  ? 'alert-circle-outline'
                  : 'checkmark-circle-outline'
            }
            size={21}
          />
          <View style={styles.connectionSummaryCopy}>
            <Text
              style={[styles.connectionSummaryTitle, { color: colors.text }]}
            >
              {healthConnectPresentation.summaryTitle}
            </Text>
            <Text
              style={[
                styles.connectionSummaryDetail,
                { color: colors.textSecondary },
              ]}
            >
              {importsPaused
                ? 'Choose a health area below whenever you want to resume.'
                : syncFailures.length
                  ? 'Open the data options below to see which area needs help.'
                  : error
                    ? latestSuccessfulSync
                      ? `The last successful check was ${relativeAge(latestSuccessfulSync)}. Retry to confirm current access and data.`
                      : 'Retry to confirm Health Connect access and complete the first import.'
                    : !latestSuccessfulSync
                      ? 'Access is granted. T1 Arc has not completed a health import yet.'
                      : latestHealthData
                        ? `Newest health data ${relativeAge(latestHealthData)}.`
                        : `Last checked ${relativeAge(latestSuccessfulSync)}; no health records were returned.`}
            </Text>
          </View>
        </View>
      ) : null}

      {!connected && status?.availability === 'available' && !detailsVisible ? (
        <View
          style={[
            styles.connectionSummary,
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
            name="leaf-outline"
            size={21}
          />
          <View style={styles.connectionSummaryCopy}>
            <Text
              style={[styles.connectionSummaryTitle, { color: colors.text }]}
            >
              Starts with everyday context
            </Text>
            <Text
              style={[
                styles.connectionSummaryDetail,
                { color: colors.textSecondary },
              ]}
            >
              Steps, workouts, heart rate and sleep are selected. You can change
              these before connecting.
            </Text>
          </View>
        </View>
      ) : null}

      {status?.availability === 'available' ? (
        <View style={styles.secondaryRow}>
          <Pressable
            accessibilityLabel={
              showDetails && selectionDirty
                ? 'Save the Health Connect choices below before hiding them'
                : showDetails
                  ? 'Hide Health Connect data options'
                  : 'Choose what Health Connect adds'
            }
            accessibilityRole="button"
            accessibilityState={{
              disabled: busy || (showDetails && selectionDirty),
              expanded: showDetails,
            }}
            disabled={busy || (showDetails && selectionDirty)}
            onPress={() => setShowDetails((visible) => !visible)}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: colors.border, borderRadius: radius.md },
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              {showDetails && selectionDirty
                ? 'Save choices below'
                : showDetails
                  ? 'Hide data options'
                  : importsPaused
                    ? 'Choose health areas'
                    : 'Choose what appears'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Manage Health Connect access"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void openHealthConnectSettings()}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: colors.border, borderRadius: radius.md },
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              Manage access
            </Text>
          </Pressable>
        </View>
      ) : null}

      {detailsVisible ? (
        <>
          <Text style={[styles.groupLabel, { color: colors.text }]}>
            Choose what appears
          </Text>
          <View style={styles.categoryList}>
            {HEALTH_CONNECT_CATEGORIES.map((category) => {
              const active = selected.includes(category.id);
              const granted = categoryStatus.get(category.id)?.granted;
              return (
                <Pressable
                  key={category.id}
                  accessibilityLabel={`${category.label}. ${category.detail}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active, disabled: busy }}
                  disabled={busy}
                  onPress={() => toggleCategory(category.id)}
                  style={({ pressed }) => [
                    styles.categoryRow,
                    {
                      backgroundColor: active
                        ? `${colors.primary}0F`
                        : colors.surfaceMuted,
                      borderColor: active
                        ? `${colors.primary}66`
                        : colors.border,
                      borderRadius: radius.md,
                    },
                    pressed && { opacity: 0.72 },
                  ]}
                >
                  <View
                    style={[
                      styles.categoryIcon,
                      { backgroundColor: `${colors.primary}14` },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={active ? colors.primary : colors.textSecondary}
                      name={categoryIcons[category.id]}
                      size={20}
                    />
                  </View>
                  <View style={styles.categoryCopy}>
                    <Text
                      numberOfLines={2}
                      style={[styles.categoryTitle, { color: colors.text }]}
                    >
                      {category.label}
                    </Text>
                    {granted ? (
                      <Text style={[styles.allowed, { color: colors.accent }]}>
                        ALLOWED
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    accessibilityElementsHidden
                    color={active ? colors.primary : colors.textTertiary}
                    name={active ? 'checkbox' : 'square-outline'}
                    size={21}
                  />
                </Pressable>
              );
            })}
          </View>

          {selectionDirty ? (
            <View
              accessibilityLiveRegion="polite"
              style={styles.selectionActions}
            >
              <Text
                style={[styles.selectionHint, { color: colors.textSecondary }]}
              >
                Save these choices to update what T1 Arc imports.
              </Text>
              <Pressable
                accessibilityLabel="Save Health Connect choices"
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void saveCategoryChoices()}
                style={({ pressed }) => [
                  styles.saveChoicesButton,
                  {
                    backgroundColor: busy
                      ? colors.surfaceMuted
                      : colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed && !busy ? 0.78 : 1,
                  },
                ]}
              >
                {operation === 'saving_preferences' ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.onPrimary}
                    name="checkmark-outline"
                    size={19}
                  />
                )}
                <Text
                  style={[styles.saveChoicesText, { color: colors.onPrimary }]}
                >
                  {operation === 'saving_preferences'
                    ? 'Saving choices…'
                    : 'Save choices'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {overview?.sources.length ? (
            <View style={styles.sourcesBlock}>
              <View style={styles.sourcesHeadingRow}>
                <Text style={[styles.groupLabel, { color: colors.text }]}>
                  Detected sources
                </Text>
                <Text
                  style={[styles.sourceCount, { color: colors.textTertiary }]}
                >
                  {regionalCount(overview.totalRecords)} records
                </Text>
              </View>
              {overview.sources.map((source) => (
                <View key={source.packageName} style={styles.sourceSummary}>
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.textSecondary}
                    name="apps-outline"
                    size={18}
                  />
                  <Text style={[styles.sourceName, { color: colors.text }]}>
                    {source.displayName}
                  </Text>
                  <Text
                    style={[styles.sourceMeta, { color: colors.textTertiary }]}
                  >
                    {regionalCount(source.recordCount)}
                  </Text>
                </View>
              ))}

              {HEALTH_CONNECT_CATEGORIES.map((category) => {
                const candidates = overview.sources.filter((source) =>
                  source.categories.includes(category.id),
                );
                if (candidates.length < 2) return null;
                const preference = overview.preferences.find(
                  (item) => item.category === category.id,
                );
                return (
                  <View key={category.id} style={styles.sourceChoice}>
                    <Text
                      style={[styles.sourceChoiceLabel, { color: colors.text }]}
                    >
                      {category.label} source
                    </Text>
                    {!preference?.preferredSourcePackage ? (
                      <Text
                        style={[
                          styles.sourceWarning,
                          { color: colors.warning },
                        ]}
                      >
                        A single source will be locked on the next refresh.
                      </Text>
                    ) : (
                      <View style={styles.sourceModeRow}>
                        <Text
                          style={[
                            styles.sourceModeText,
                            { color: colors.textTertiary },
                          ]}
                        >
                          {preference.preferredSourceMode === 'manual'
                            ? 'Chosen by you'
                            : 'Automatically locked using freshness and coverage'}
                        </Text>
                        {preference.preferredSourceMode === 'manual' ? (
                          <Pressable
                            accessibilityLabel={`Use automatic source selection for ${category.label}`}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: busy }}
                            disabled={busy}
                            onPress={() => void chooseSource(category.id)}
                            style={styles.automaticLinkButton}
                          >
                            <Text
                              style={[
                                styles.automaticLink,
                                { color: colors.primary },
                              ]}
                            >
                              Use automatic
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    )}
                    <View style={styles.chips}>
                      {candidates.map((source) => {
                        const active =
                          preference?.preferredSourcePackage ===
                          source.packageName;
                        const stats = source.categoryStats.find(
                          (item) => item.category === category.id,
                        );
                        return (
                          <Pressable
                            key={source.packageName}
                            accessibilityLabel={`Use ${source.displayName} for ${category.label}`}
                            accessibilityRole="radio"
                            accessibilityState={{
                              checked: active,
                              disabled: busy,
                            }}
                            disabled={busy}
                            onPress={() =>
                              void chooseSource(category.id, source.packageName)
                            }
                            style={({ pressed }) => [
                              styles.chip,
                              {
                                backgroundColor: active
                                  ? `${colors.accent}18`
                                  : colors.surfaceMuted,
                                borderColor: active
                                  ? `${colors.accent}88`
                                  : colors.border,
                                borderRadius: radius.pill,
                              },
                              pressed && { opacity: 0.7 },
                            ]}
                          >
                            {active ? (
                              <Ionicons
                                accessibilityElementsHidden
                                color={colors.accent}
                                name="checkmark"
                                size={15}
                              />
                            ) : null}
                            <Text
                              style={[
                                styles.chipText,
                                {
                                  color: active
                                    ? colors.accent
                                    : colors.textSecondary,
                                },
                              ]}
                            >
                              {source.displayName}
                              {stats
                                ? ` · ${regionalCount(stats.recordCount)}`
                                : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {status?.availability === 'available' ? (
            <View style={styles.permissionMeta}>
              <Ionicons
                accessibilityElementsHidden
                color={
                  status.historyGranted ? colors.accent : colors.textTertiary
                }
                name={
                  status.historyGranted ? 'archive-outline' : 'time-outline'
                }
                size={18}
              />
              <Text
                style={[styles.permissionText, { color: colors.textSecondary }]}
              >
                {status.historyGranted
                  ? 'History older than 30 days is allowed.'
                  : 'Recent records work without older-history access.'}
                {overview?.sync.some((item) => item.lastSuccessAt)
                  ? ` Last checked ${relativeAge(
                      Math.max(
                        ...overview.sync.map((item) => item.lastSuccessAt ?? 0),
                      ),
                    )}.`
                  : ''}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      {connected && showDetails ? (
        <View
          style={[
            styles.syncPanel,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: syncFailures.length
                ? `${colors.warning}66`
                : colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <View style={styles.syncPanelHeader}>
            <View>
              <Text style={[styles.syncPanelTitle, { color: colors.text }]}>
                Health refresh
              </Text>
              <Text
                style={[
                  styles.syncPanelMode,
                  {
                    color:
                      status?.backgroundGranted && status.backgroundAvailable
                        ? colors.accent
                        : colors.textSecondary,
                  },
                ]}
              >
                {status?.backgroundGranted && status.backgroundAvailable
                  ? 'AUTOMATIC UPDATES ALLOWED'
                  : 'REFRESHES WHEN THE APP OPENS'}
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={syncFailures.length ? colors.warning : colors.accent}
              name={
                syncFailures.length
                  ? 'alert-circle-outline'
                  : 'checkmark-circle-outline'
              }
              size={23}
            />
          </View>
          <View style={styles.syncFacts}>
            <View style={styles.syncFact}>
              <Text
                style={[styles.syncFactLabel, { color: colors.textTertiary }]}
              >
                Last successful check
              </Text>
              <Text style={[styles.syncFactValue, { color: colors.text }]}>
                {latestSuccessfulSync
                  ? relativeAge(latestSuccessfulSync)
                  : 'Not completed yet'}
              </Text>
            </View>
            <View style={styles.syncFact}>
              <Text
                style={[styles.syncFactLabel, { color: colors.textTertiary }]}
              >
                Newest health record
              </Text>
              <Text style={[styles.syncFactValue, { color: colors.text }]}>
                {latestHealthData
                  ? relativeAge(latestHealthData)
                  : 'No records yet'}
              </Text>
            </View>
          </View>
          {status?.backgroundGranted && status.backgroundAvailable ? (
            <Text
              style={[
                styles.backgroundAuditText,
                {
                  color:
                    overview?.background?.outcome === 'failed' ||
                    overview?.background?.outcome === 'partial'
                      ? colors.warning
                      : colors.textTertiary,
                },
              ]}
            >
              {overview?.background
                ? `Automatic check ran ${relativeAge(
                    overview.background.lastRunAt,
                  )} · ${
                    overview.background.outcome === 'failed'
                      ? 'needs attention'
                      : overview.background.outcome === 'partial'
                        ? 'partly complete'
                        : 'complete'
                  }${
                    overview.background.recordsProcessed
                      ? ` · ${regionalCount(overview.background.recordsProcessed)} changes checked`
                      : ''
                  }${
                    overview.background.recordsRemoved
                      ? ` · ${regionalCount(overview.background.recordsRemoved)} removed items cleared`
                      : ''
                  }${overview.background.failures ? ` · ${overview.background.failures} ${overview.background.failures === 1 ? 'area needs' : 'areas need'} attention` : ''}.`
                : 'Automatic checks are ready and waiting for their first run.'}
            </Text>
          ) : null}
          <View style={styles.syncCategoryList}>
            {selectedSyncStates.map(({ category, state }) => {
              const failed = Boolean(state?.lastErrorMessage);
              return (
                <View key={category} style={styles.syncCategoryRow}>
                  <Ionicons
                    accessibilityElementsHidden
                    color={
                      failed
                        ? colors.warning
                        : state?.lastSuccessAt
                          ? colors.accent
                          : colors.textTertiary
                    }
                    name={
                      failed
                        ? 'alert-circle-outline'
                        : state?.lastSuccessAt
                          ? 'checkmark-circle-outline'
                          : 'time-outline'
                    }
                    size={16}
                  />
                  <Text
                    style={[styles.syncCategoryName, { color: colors.text }]}
                  >
                    {healthCategoryLabel(category)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.syncCategoryMeta,
                      {
                        color: failed ? colors.warning : colors.textSecondary,
                      },
                    ]}
                  >
                    {failed
                      ? state?.lastErrorMessage
                      : state?.lastSuccessAt
                        ? `${regionalCount(state.recordCount)} records`
                        : 'Waiting for first import'}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={[styles.syncNote, { color: colors.textTertiary }]}>
            {changeTrackingReady
              ? 'Changes and deletions stay up to date for every selected area. If one area has a problem, the others can still refresh.'
              : 'The next refresh will reconcile the available records and deletions. Each area refreshes separately.'}
          </Text>
        </View>
      ) : null}
      {showDetails &&
      status?.availability === 'available' &&
      connected &&
      !needsPermission &&
      !status.historyGranted ? (
        <Pressable
          accessibilityLabel="Import Health Connect history older than 30 days"
          accessibilityHint="Asks separately for optional older-history access. Recent health records continue to work if you decline."
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void enableOlderHistory()}
          style={({ pressed }) => [
            styles.historyButton,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
              opacity: busy ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}
        >
          {operation === 'enabling_history' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="archive-outline"
              size={18}
            />
          )}
          <View style={styles.backgroundCopy}>
            <Text style={[styles.backgroundTitle, { color: colors.text }]}>
              Import history older than 30 days
            </Text>
            <Text
              style={[styles.backgroundDetail, { color: colors.textSecondary }]}
            >
              Optional. Recent data already works; allow this only if you want
              older context in T1 Arc.
            </Text>
          </View>
        </Pressable>
      ) : null}
      {showDetails &&
      status?.availability === 'available' &&
      status.backgroundAvailable &&
      connected &&
      !needsPermission &&
      !status.backgroundGranted ? (
        <Pressable
          accessibilityLabel="Allow automatic Health Connect updates"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void enableBackgroundUpdates()}
          style={({ pressed }) => [
            styles.backgroundButton,
            {
              borderColor: colors.border,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceMuted,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="sync-outline"
            size={18}
          />
          <View style={styles.backgroundCopy}>
            <Text style={[styles.backgroundTitle, { color: colors.text }]}>
              Allow automatic health updates
            </Text>
            <Text
              style={[styles.backgroundDetail, { color: colors.textSecondary }]}
            >
              Keep this information up to date even when you are not using the
              app.
            </Text>
          </View>
        </Pressable>
      ) : null}
      {showDetails &&
      status?.availability === 'available' &&
      status.historyGranted &&
      Boolean(overview?.totalRecords) ? (
        <Pressable
          accessibilityLabel="Recheck all Health Connect history"
          accessibilityHint="Checks all available selected health history again without creating duplicates."
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={confirmFullHistoryRecheck}
          style={({ pressed }) => [
            styles.historyButton,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
              opacity: busy ? 0.5 : pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name="archive-outline"
            size={18}
          />
          <View style={styles.backgroundCopy}>
            <Text style={[styles.backgroundTitle, { color: colors.text }]}>
              Recheck all health history
            </Text>
            <Text
              style={[styles.backgroundDetail, { color: colors.textSecondary }]}
            >
              Use after changing source apps or correcting older records.
            </Text>
          </View>
        </Pressable>
      ) : null}

      {error ? (
        <View
          style={[
            styles.feedback,
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
          <Text style={[styles.feedbackText, { color: colors.danger }]}>
            {error}
          </Text>
          <Pressable
            accessibilityLabel="Retry Health Connect check"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => void retryLoad()}
            style={({ pressed }) => [
              styles.feedbackAction,
              pressed && !busy && { opacity: 0.65 },
            ]}
          >
            <Text
              style={[styles.feedbackActionText, { color: colors.primary }]}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      ) : null}
      {message ? (
        <View
          style={[
            styles.feedback,
            {
              backgroundColor: `${colors.accent}12`,
              borderColor: `${colors.accent}55`,
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
          <Text style={[styles.feedbackText, { color: colors.textSecondary }]}>
            {message}
          </Text>
        </View>
      ) : null}

      {selected.length > 0 &&
      !selectionDirty &&
      (!connected || needsPermission || syncFailures.length) ? (
        <Pressable
          accessibilityLabel={
            status?.availability === 'update_required'
              ? 'Install or update Health Connect'
              : needsPermission
                ? 'Connect Health Connect and import'
                : 'Try Health Connect update'
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !selected.length }}
          disabled={busy || !selected.length}
          onPress={() => void connectOrSync()}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor:
                busy || !selected.length ? colors.surfaceMuted : colors.primary,
              borderRadius: radius.md,
            },
            pressed && !busy && { opacity: 0.78 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={selected.length ? colors.onPrimary : colors.textTertiary}
              name={
                status?.availability === 'update_required'
                  ? 'download-outline'
                  : needsPermission
                    ? 'shield-checkmark-outline'
                    : 'sync-outline'
              }
              size={20}
            />
          )}
          <Text
            style={[
              styles.primaryButtonText,
              {
                color:
                  busy || !selected.length
                    ? colors.textTertiary
                    : colors.onPrimary,
              },
            ]}
          >
            {operation === 'connecting'
              ? 'Waiting for approval…'
              : operation === 'enabling_history'
                ? 'Waiting for older-history approval…'
                : operation === 'syncing'
                  ? 'Importing health data…'
                  : operation === 'saving_preferences'
                    ? 'Saving choices…'
                    : operation === 'choosing_source'
                      ? 'Saving source…'
                      : status?.availability === 'update_required'
                        ? 'Install or update Health Connect'
                        : needsPermission
                          ? 'Connect and import'
                          : 'Try health update'}
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  statusPill: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  statusText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  connectionSummary: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  connectionSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  connectionSummaryTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  connectionSummaryDetail: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
  },
  groupLabel: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 9,
  },
  categoryList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryRow: {
    width: '48.5%',
    minHeight: 64,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCopy: {
    flex: 1,
    minWidth: 0,
  },
  categoryTitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  allowed: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.55,
    fontWeight: '900',
    marginTop: 1,
  },
  sourcesBlock: {
    marginTop: 3,
  },
  selectionActions: {
    marginTop: 12,
    gap: 9,
  },
  selectionHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  saveChoicesButton: {
    minHeight: 48,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveChoicesText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  sourcesHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sourceCount: {
    fontSize: 12,
    lineHeight: 17,
  },
  sourceSummary: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  sourceName: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  sourceMeta: {
    fontSize: 12,
    lineHeight: 17,
  },
  sourceChoice: {
    marginTop: 13,
  },
  sourceChoiceLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  sourceWarning: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  sourceModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 2,
  },
  sourceModeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  automaticLinkButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  automaticLink: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  permissionMeta: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 16,
  },
  permissionText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  syncPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 14,
    padding: 13,
  },
  syncPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  syncPanelTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  syncPanelMode: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 0.45,
    marginTop: 2,
  },
  syncFacts: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  syncFact: {
    flex: 1,
  },
  syncFactLabel: {
    fontSize: 12,
    lineHeight: 17,
  },
  syncFactValue: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 1,
  },
  backgroundAuditText: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 9,
  },
  syncCategoryList: {
    gap: 7,
    marginTop: 13,
  },
  syncCategoryRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  syncCategoryName: {
    width: 92,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  syncCategoryMeta: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'right',
  },
  syncNote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  backgroundButton: {
    minHeight: 62,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyButton: {
    minHeight: 62,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backgroundCopy: {
    flex: 1,
  },
  backgroundTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  backgroundDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 1,
  },
  feedback: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  feedbackText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  feedbackAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  feedbackActionText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 16,
    marginTop: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 9,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  secondaryText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
});
