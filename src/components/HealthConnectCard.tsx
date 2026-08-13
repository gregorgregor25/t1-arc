import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  HealthConnectCategoryId,
  HealthConnectStatus,
} from '../../modules/daymark-health-connect';
import { updateHealthConnectBackgroundSyncRegistration } from '@/data/background/healthConnectSyncTask';
import {
  getHealthConnectOverview,
  getHealthConnectStatus,
  HealthConnectOverview,
  HealthConnectSyncResult,
  openHealthConnectInstall,
  openHealthConnectSettings,
  openHealthConnectSourceDiscovery,
  requestHealthConnectPermissions,
  saveHealthConnectPreferences,
  savePreferredHealthConnectSource,
  syncHealthConnect,
  useAutomaticHealthConnectSource,
} from '@/data/healthConnect/healthConnectRepository';
import {
  DEFAULT_HEALTH_CONNECT_CATEGORIES,
  HEALTH_CONNECT_CATEGORIES,
} from '@/data/healthConnect/healthConnectRecords';
import { relativeAge } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type Operation =
  | 'loading'
  | 'connecting'
  | 'syncing'
  | 'discovering'
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

function syncResultMessage(
  result: HealthConnectSyncResult,
  emptyMessage: string,
) {
  const checked = result.recordsProcessed
    ? `${result.recordsProcessed.toLocaleString('en-GB')} health items checked.`
    : emptyMessage;
  const removed = result.recordsRemoved
    ? ` ${result.recordsRemoved.toLocaleString('en-GB')} deleted ${
        result.recordsRemoved === 1 ? 'item was' : 'items were'
      } cleared.`
    : '';
  if (!result.failures.length) return `${checked}${removed}`;
  const failedLabels = result.failures
    .map((failure) => healthCategoryLabel(failure.category))
    .join(', ');
  return `${checked}${removed} ${failedLabels} could not be updated and will be retried separately.`;
}

export function HealthConnectCard({
  onDataChanged,
}: {
  onDataChanged?: () => Promise<void> | void;
}) {
  const { colors, radius } = useAppTheme();
  const [status, setStatus] = useState<HealthConnectStatus>();
  const [overview, setOverview] = useState<HealthConnectOverview>();
  const [selected, setSelected] = useState<HealthConnectCategoryId[]>(
    DEFAULT_HEALTH_CONNECT_CATEGORIES,
  );
  const [operation, setOperation] = useState<Operation>('loading');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    const [nextStatus, nextOverview] = await Promise.all([
      getHealthConnectStatus(),
      getHealthConnectOverview(),
    ]);
    setStatus(nextStatus);
    setOverview(nextOverview);
    setSelected(
      nextOverview.preferences
        .filter((preference) => preference.enabled)
        .map((preference) => preference.category),
    );
  }, []);

  useEffect(() => {
    let active = true;
    void load()
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
  }, [load]);

  const categoryStatus = useMemo(
    () =>
      new Map(
        status?.categories.map((category) => [category.id, category]) ?? [],
      ),
    [status],
  );
  const needsPermission = selected.some(
    (category) => !categoryStatus.get(category)?.granted,
  );
  const busy = operation !== undefined;
  const connected = Boolean(
    status?.categories.some((category) => category.granted),
  );
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
    await updateHealthConnectBackgroundSyncRegistration().catch(
      () => false,
    );
    await load();
    await onDataChanged?.();
  }

  async function enableBackgroundUpdates() {
    if (!status || busy || !selected.length) return;
    setOperation('connecting');
    setError(undefined);
    setMessage(undefined);
    try {
      const nextStatus = await requestHealthConnectPermissions(selected);
      setStatus(nextStatus);
      const enabled =
        await updateHealthConnectBackgroundSyncRegistration();
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
        ? await requestHealthConnectPermissions(selected)
        : status;
      setStatus(nextStatus);
      const granted = selected.filter((category) =>
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

  async function discoverSources() {
    if (!status || busy || !selected.length) return;
    setError(undefined);
    setMessage(undefined);
    setOperation('discovering');
    try {
      let nextStatus = status;
      if (needsPermission) {
        nextStatus = await requestHealthConnectPermissions(selected);
        setStatus(nextStatus);
      }
      const granted = selected.filter((category) =>
        nextStatus.categories.find((item) => item.id === category)?.granted,
      );
      if (!granted.length) {
        setMessage('Allow a category before choosing an app or device.');
        return;
      }
      await openHealthConnectSourceDiscovery(granted);
      setOperation('syncing');
      const result = await syncHealthConnect({ categories: granted });
      await finishRefresh();
      setMessage(
        syncResultMessage(
          result,
          'Source apps checked. No new records were available.',
        ),
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'Source discovery could not be opened.',
      );
    } finally {
      setOperation(undefined);
    }
  }

  async function recheckFullHistory() {
    if (!status || busy) return;
    const granted = selected.filter((category) =>
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
        await savePreferredHealthConnectSource(
          category,
          packageName,
          'manual',
        );
      } else {
        await useAutomaticHealthConnectSource(category);
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

  const statusLabel =
    status?.availability === 'update_required'
      ? 'Update needed'
      : status?.availability === 'unavailable'
        ? 'Unavailable'
        : connected
          ? 'Connected'
          : 'Not connected';
  const statusTone =
    status?.availability !== 'available'
      ? colors.warning
      : connected
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

      <View
        style={[
          styles.privacyNote,
          {
            backgroundColor: colors.surfaceMuted,
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.accent}
          name="phone-portrait-outline"
          size={19}
        />
        <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
          Choose what you want to include. Your phone asks once for permission,
          and the approved information stays encrypted on this phone.
        </Text>
      </View>

      <Text style={[styles.groupLabel, { color: colors.text }]}>
        What should be included?
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
                  borderColor: active ? `${colors.primary}66` : colors.border,
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

      {overview?.sources.length ? (
        <View style={styles.sourcesBlock}>
          <View style={styles.sourcesHeadingRow}>
            <Text style={[styles.groupLabel, { color: colors.text }]}>
              Detected sources
            </Text>
            <Text style={[styles.sourceCount, { color: colors.textTertiary }]}>
              {overview.totalRecords.toLocaleString('en-GB')} records
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
              <Text style={[styles.sourceMeta, { color: colors.textTertiary }]}>
                {source.recordCount.toLocaleString('en-GB')}
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
                <Text style={[styles.sourceChoiceLabel, { color: colors.text }]}>
                  {category.label} source
                </Text>
                {!preference?.preferredSourcePackage ? (
                  <Text style={[styles.sourceWarning, { color: colors.warning }]}>
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
                        accessibilityRole="button"
                        disabled={busy}
                        onPress={() => void chooseSource(category.id)}
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
                      preference?.preferredSourcePackage === source.packageName;
                    const stats = source.categoryStats.find(
                      (item) => item.category === category.id,
                    );
                    return (
                      <Pressable
                        key={source.packageName}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
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
                            ? ` · ${stats.recordCount.toLocaleString('en-GB')}`
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
            color={status.historyGranted ? colors.accent : colors.warning}
            name={status.historyGranted ? 'archive-outline' : 'time-outline'}
            size={18}
          />
          <Text
            style={[styles.permissionText, { color: colors.textSecondary }]}
          >
            {status.historyGranted
              ? 'Full available history is allowed.'
              : 'Full-history access has not been allowed yet.'}
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
      {connected ? (
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
              <Text style={[styles.syncFactLabel, { color: colors.textTertiary }]}>
                Last successful check
              </Text>
              <Text style={[styles.syncFactValue, { color: colors.text }]}>
                {latestSuccessfulSync
                  ? relativeAge(latestSuccessfulSync)
                  : 'Not completed yet'}
              </Text>
            </View>
            <View style={styles.syncFact}>
              <Text style={[styles.syncFactLabel, { color: colors.textTertiary }]}>
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
                      ? ` · ${overview.background.recordsProcessed.toLocaleString(
                          'en-GB',
                        )} changes checked`
                      : ''
                  }${
                    overview.background.recordsRemoved
                      ? ` · ${overview.background.recordsRemoved.toLocaleString(
                          'en-GB',
                        )} removed items cleared`
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
                        color: failed
                          ? colors.warning
                          : colors.textSecondary,
                      },
                    ]}
                  >
                    {failed
                      ? state?.lastErrorMessage
                      : state?.lastSuccessAt
                        ? `${state.recordCount.toLocaleString('en-GB')} records`
                        : 'Waiting for first import'}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={[styles.syncNote, { color: colors.textTertiary }]}>
            {changeTrackingReady
              ? 'Changes and deletions stay up to date for every selected area. If one area has a problem, the others can still refresh.'
              : 'The next full refresh will bring earlier changes and deletions up to date. Each area refreshes separately.'}
          </Text>
        </View>
      ) : null}
      {status?.availability === 'available' &&
      status.backgroundAvailable &&
      connected &&
      !status.backgroundGranted ? (
        <Pressable
          accessibilityRole="button"
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
              Keep this information up to date even when you are not using the app.
            </Text>
          </View>
        </Pressable>
      ) : null}
      {status?.availability === 'available' &&
      status.historyGranted &&
      Boolean(overview?.totalRecords) ? (
        <Pressable
          accessibilityHint="Checks all available selected health history again without creating duplicates."
          accessibilityRole="button"
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

      <Pressable
        accessibilityRole="button"
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
            color={
              selected.length ? colors.onPrimary : colors.textTertiary
            }
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
            : operation === 'syncing'
              ? 'Importing health history…'
              : operation === 'discovering'
                ? 'Checking source apps…'
                : operation === 'choosing_source'
                  ? 'Saving source…'
                  : status?.availability === 'update_required'
                    ? 'Install or update Health Connect'
                    : needsPermission
                      ? 'Connect and import'
                      : 'Import new records'}
        </Text>
      </Pressable>

      {status?.availability === 'available' ? (
        <View style={styles.secondaryRow}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void discoverSources()}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: colors.border, borderRadius: radius.md },
              pressed && { backgroundColor: colors.surfaceMuted },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              Find source apps
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
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
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 13,
    marginTop: 16,
  },
  privacyText: {
    flex: 1,
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
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 0.55,
    fontWeight: '900',
    marginTop: 1,
  },
  sourcesBlock: {
    marginTop: 3,
  },
  sourcesHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sourceCount: {
    fontSize: 11,
    lineHeight: 16,
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
    fontSize: 11,
    lineHeight: 16,
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
    fontSize: 11,
    lineHeight: 16,
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
    fontSize: 10,
    lineHeight: 15,
  },
  automaticLink: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 8,
  },
  chip: {
    minHeight: 38,
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
    fontSize: 11,
    lineHeight: 17,
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
    fontSize: 9,
    lineHeight: 13,
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
    fontSize: 10,
    lineHeight: 14,
  },
  syncFactValue: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    marginTop: 1,
  },
  backgroundAuditText: {
    fontSize: 10,
    lineHeight: 15,
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
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  syncCategoryMeta: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
  },
  syncNote: {
    fontSize: 10,
    lineHeight: 15,
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
    fontSize: 11,
    lineHeight: 16,
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
