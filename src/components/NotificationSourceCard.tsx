import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import T1ArcNotificationSource, {
  type NotificationCaptureRule,
  type NotificationGlucoseUnit,
  type NotificationSourceStatus,
} from '../../modules/t1arc-notification-source';
import { SectionCard } from '@/components/SectionCard';
import {
  fixedNotificationUnit,
  normalizeKnownNotificationRule,
  NotificationAppOption,
  SUPPORTED_NOTIFICATION_APPS,
} from '@/data/notification/supportedApps';
import { setNotificationSourceConfiguration } from '@/data/notification/notificationSourceConfiguration';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import {
  beginSourceLoad,
  canCommitSourceLoad,
  mountSourceLoadGuard,
  SourceLoadGuard,
  unmountSourceLoadGuard,
} from './sourceLoadGuard';

const NOTIFICATION_UNITS: {
  label: string;
  value: NotificationGlucoseUnit;
}[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'mmol/L', value: 'mmolL' },
  { label: 'mg/dL', value: 'mgDl' },
];

export function NotificationSourceCard({
  onConnected,
}: {
  onConnected?: () => Promise<void> | void;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [availableApps, setAvailableApps] = useState<NotificationAppOption[]>(
    [],
  );
  const [selection, setSelection] = useState<{
    packageName?: string;
    unit: NotificationGlucoseUnit;
  }>({ unit: 'auto' });
  const [status, setStatus] = useState<NotificationSourceStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [loadState, setLoadState] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading');
  const [loadError, setLoadError] = useState<string>();
  const [diagnosticError, setDiagnosticError] = useState<string>();
  const loadGuard = useRef<SourceLoadGuard>({
    mounted: false,
    generation: 0,
  });

  const refreshStatus = useCallback(async () => {
    const generation = beginSourceLoad(loadGuard.current);
    if (!canCommitSourceLoad(loadGuard.current, generation)) return undefined;
    setLoadState('loading');
    setLoadError(undefined);
    setDiagnosticError(undefined);
    const [statusResult, installedResults] = await Promise.all([
      T1ArcNotificationSource.getStatusAsync().then(
        (value) => ({ ok: true as const, value }),
        (reason: unknown) => ({ ok: false as const, reason }),
      ),
      Promise.allSettled(
        SUPPORTED_NOTIFICATION_APPS.map(async (app) => ({
          app,
          installed: await T1ArcNotificationSource.isPackageInstalledAsync(
            app.packageName,
          ),
        })),
      ),
    ]);
    if (!canCommitSourceLoad(loadGuard.current, generation)) return undefined;
    if (!statusResult.ok) {
      setLoadState('unavailable');
      setLoadError(
        statusResult.reason instanceof Error
          ? statusResult.reason.message
          : 'The saved notification source could not be read.',
      );
      return undefined;
    }
    const nextStatus = statusResult.value;
    const installedApps = installedResults.flatMap((result) =>
      result.status === 'fulfilled' && result.value.installed
        ? [result.value.app]
        : [],
    );
    const failedDiscoveryCount = installedResults.filter(
      (result) => result.status === 'rejected',
    ).length;
    setDiagnosticError(
      failedDiscoveryCount > 0
        ? 'Some installed-app checks were unavailable. The saved notification source is still shown.'
        : undefined,
    );
    const configuredRule = nextStatus.rules[0]
      ? normalizeKnownNotificationRule(nextStatus.rules[0])
      : undefined;
    const configuredApp = configuredRule
      ? (SUPPORTED_NOTIFICATION_APPS.find(
          (app) => app.packageName === configuredRule.packageName,
        ) ?? {
          ...configuredRule,
          detail: 'Previously selected health app',
        })
      : undefined;
    const nextApps =
      configuredApp &&
      !installedApps.some(
        (app) => app.packageName === configuredApp.packageName,
      )
        ? [configuredApp, ...installedApps]
        : installedApps;
    setAvailableApps(nextApps);
    setSelection((current) => {
      if (configuredRule) {
        return {
          packageName: configuredRule.packageName,
          unit: configuredRule.glucoseUnit,
        };
      }
      if (
        current.packageName &&
        nextApps.some((app) => app.packageName === current.packageName)
      ) {
        return current;
      }
      const nextPackage = nextApps[0]?.packageName;
      const nextRule = nextApps.find((app) => app.packageName === nextPackage);
      return {
        packageName: nextPackage,
        unit: nextRule?.glucoseUnit ?? 'auto',
      };
    });
    setStatus(nextStatus);
    setLoadState('ready');
    return nextStatus;
  }, []);

  const schedulePostCommitRefresh = useCallback(() => {
    setTimeout(() => {
      if (!loadGuard.current.mounted) return;
      void Promise.resolve(onConnected?.()).catch((refreshError) => {
        if (!loadGuard.current.mounted) return;
        setDiagnosticError(
          refreshError instanceof Error
            ? `The source was saved, but the background refresh could not finish: ${refreshError.message}`
            : 'The source was saved, but the background refresh could not finish.',
        );
      });
    }, 0);
  }, [onConnected]);

  useEffect(() => {
    const guard = loadGuard.current;
    mountSourceLoadGuard(guard);
    void Promise.resolve().then(refreshStatus);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshStatus().then((nextStatus) => {
          if (!loadGuard.current.mounted) return;
          if (nextStatus?.enabled && nextStatus.accessGranted) {
            schedulePostCommitRefresh();
          }
        });
      }
    });
    return () => {
      unmountSourceLoadGuard(guard);
      subscription.remove();
    };
  }, [refreshStatus, schedulePostCommitRefresh]);

  const active = status?.enabled === true && status.accessGranted === true;
  const selectedApp = availableApps.find(
    (app) => app.packageName === selection.packageName,
  );
  const selectedUnitIsFixed =
    selectedApp !== undefined &&
    fixedNotificationUnit(selectedApp.packageName) !== undefined;

  if (!status && loadState !== 'ready') {
    return (
      <SectionCard>
        <View style={styles.header}>
          <View
            style={[
              styles.icon,
              {
                backgroundColor: `${colors.glucose}18`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.glucose}
              name={
                loadState === 'loading'
                  ? 'hourglass-outline'
                  : 'warning-outline'
              }
              size={23}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              {loadState === 'loading'
                ? 'Loading health-app notifications'
                : 'Health-app notifications unavailable'}
            </Text>
            <Text style={[styles.status, { color: colors.textSecondary }]}>
              {loadState === 'loading'
                ? 'Checking the source saved on this phone.'
                : 'T1 Arc could not safely read the saved source. No setup state has been assumed.'}
            </Text>
          </View>
        </View>
        {loadState === 'loading' ? (
          <ActivityIndicator
            color={colors.primary}
            style={styles.loadIndicator}
          />
        ) : (
          <>
            {loadError ? (
              <Text style={[styles.error, { color: colors.danger }]}>
                {loadError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void refreshStatus()}
              style={({ pressed }) => [
                styles.retryButton,
                {
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.primary }]}>
                Retry
              </Text>
            </Pressable>
          </>
        )}
      </SectionCard>
    );
  }

  async function enable() {
    setBusy(true);
    setError(undefined);
    try {
      if (!selectedApp) {
        setError('Install a supported health app before enabling this source.');
        return;
      }
      const captureRule = normalizeKnownNotificationRule({
        packageName: selectedApp.packageName,
        displayName: selectedApp.displayName,
        captureGlucose: selectedApp.captureGlucose,
        captureInsulin: selectedApp.captureInsulin,
        glucoseUnit: selection.unit,
      } satisfies NotificationCaptureRule);
      const next = await setNotificationSourceConfiguration({
        enabled: true,
        rules: [captureRule],
      });
      setStatus(next);
      if (!next.accessGranted) {
        await T1ArcNotificationSource.openNotificationAccessSettingsAsync();
      } else {
        schedulePostCommitRefresh();
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Notification access could not be prepared.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(undefined);
    try {
      const next = await setNotificationSourceConfiguration({
        enabled: false,
        rules: status?.rules ?? [],
      });
      setStatus(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The notification source could not be disabled.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${active ? colors.accent : colors.glucose}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={active ? colors.accent : colors.glucose}
            name="notifications-outline"
            size={23}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Health-app notifications
          </Text>
          <Text
            style={[
              styles.status,
              { color: active ? colors.accent : colors.textSecondary },
            ]}
          >
            {active
              ? 'Connected on this phone'
              : status?.enabled
                ? 'Finish Android notification access'
                : availableApps.length
                  ? `${formatRegionalNumber(availableApps.length, regional.locale, { maximumFractionDigits: 0 })} compatible app${availableApps.length === 1 ? '' : 's'} detected`
                  : 'No compatible app detected'}
          </Text>
        </View>
      </View>

      {loadState === 'unavailable' ? (
        <View style={styles.loadWarning}>
          <Text style={[styles.error, { color: colors.danger }]}>
            {loadError ??
              'The saved notification source could not be re-read. The last verified state remains shown.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void refreshStatus()}
          >
            <Text style={[styles.appName, { color: colors.primary }]}>
              Retry saved source
            </Text>
          </Pressable>
        </View>
      ) : null}
      {diagnosticError ? (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {diagnosticError}
        </Text>
      ) : null}

      {availableApps.length ? (
        <View style={styles.appList}>
          {availableApps.map((app) => {
            const selected = app.packageName === selection.packageName;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: active }}
                disabled={active || busy}
                key={app.packageName}
                onPress={() => {
                  setSelection({
                    packageName: app.packageName,
                    unit: app.glucoseUnit,
                  });
                }}
                style={({ pressed }) => [
                  styles.appOption,
                  {
                    backgroundColor: selected
                      ? `${colors.primary}14`
                      : colors.surfaceMuted,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: radius.md,
                  },
                  pressed && !active && { opacity: 0.7 },
                ]}
              >
                <View style={styles.appCopy}>
                  <Text style={[styles.appName, { color: colors.text }]}>
                    {app.displayName}
                  </Text>
                  <Text
                    style={[styles.appDetail, { color: colors.textSecondary }]}
                  >
                    {app.detail}
                  </Text>
                </View>
                <Ionicons
                  accessibilityElementsHidden
                  color={selected ? colors.primary : colors.textTertiary}
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={21}
                />
              </Pressable>
            );
          })}
          {active && availableApps.length > 1 ? (
            <Text style={[styles.appHint, { color: colors.textTertiary }]}>
              Pause this source to choose a different app.
            </Text>
          ) : null}
          {selectedApp ? (
            <View style={styles.unitSection}>
              <View style={styles.unitHeading}>
                <Text style={[styles.unitTitle, { color: colors.text }]}>
                  Notification units
                </Text>
                <Text
                  style={[styles.unitDetail, { color: colors.textSecondary }]}
                >
                  {selectedUnitIsFixed
                    ? `This app package is fixed to ${selection.unit === 'mgDl' ? 'mg/dL' : 'mmol/L'}.`
                    : 'Used only when the notification shows a number without its unit.'}
                </Text>
              </View>
              <View style={styles.unitRow}>
                {NOTIFICATION_UNITS.map((unit) => {
                  const selected = unit.value === selection.unit;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selected,
                        disabled: active || busy || selectedUnitIsFixed,
                      }}
                      disabled={active || busy || selectedUnitIsFixed}
                      key={unit.value}
                      onPress={() =>
                        setSelection((current) => ({
                          ...current,
                          unit: unit.value,
                        }))
                      }
                      style={({ pressed }) => [
                        styles.unitOption,
                        {
                          backgroundColor: selected
                            ? `${colors.primary}14`
                            : colors.surfaceElevated,
                          borderColor: selected
                            ? colors.primary
                            : colors.border,
                          borderRadius: radius.sm,
                        },
                        pressed && !active && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.unitLabel,
                          {
                            color: selected
                              ? colors.primary
                              : colors.textSecondary,
                          },
                        ]}
                      >
                        {unit.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View
          style={[
            styles.emptyState,
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
            name="phone-portrait-outline"
            size={20}
          />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Install a compatible CGM or loop app on this phone, then return
            here. T1 Arc will show detected options without scanning unrelated
            apps.
          </Text>
        </View>
      )}

      {status?.pendingCount ? (
        <Text style={[styles.meta, { color: colors.textTertiary }]}>
          {formatRegionalNumber(status.pendingCount, regional.locale, {
            maximumFractionDigits: 0,
          })}{' '}
          captured notification
          {status.pendingCount === 1 ? '' : 's'} waiting to be processed
        </Text>
      ) : null}

      {error || status?.lastError ? (
        <Text style={[styles.error, { color: colors.danger }]}>
          {error ?? status?.lastError}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={busy || (!active && !selectedApp)}
        onPress={() => void (active ? disable() : enable())}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: active ? colors.surfaceMuted : colors.primary,
            borderColor: active ? colors.border : colors.primary,
            borderRadius: radius.md,
          },
          pressed && !busy && { opacity: 0.78 },
          !active && !selectedApp && { opacity: 0.48 },
        ]}
      >
        {busy ? (
          <ActivityIndicator
            color={active ? colors.textSecondary : colors.onPrimary}
          />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={active ? colors.textSecondary : colors.onPrimary}
            name={active ? 'pause-outline' : 'shield-checkmark-outline'}
            size={20}
          />
        )}
        <Text
          style={[
            styles.buttonText,
            { color: active ? colors.textSecondary : colors.onPrimary },
          ]}
        >
          {busy
            ? 'Updating…'
            : active
              ? 'Pause notification source'
              : status?.enabled
                ? 'Open notification access'
                : 'Allow notification source'}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  status: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  meta: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 16,
  },
  appList: {
    gap: 8,
    marginTop: 16,
  },
  appOption: {
    minHeight: 64,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  appCopy: {
    flex: 1,
  },
  appName: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  appDetail: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  appHint: {
    fontSize: 10,
    lineHeight: 15,
  },
  unitSection: {
    marginTop: 4,
  },
  unitHeading: {
    gap: 1,
  },
  unitTitle: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '800',
  },
  unitDetail: {
    fontSize: 10,
    lineHeight: 15,
  },
  unitRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 8,
  },
  unitOption: {
    minHeight: 42,
    flex: 1,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unitLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  emptyState: {
    borderWidth: 1,
    padding: 12,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  emptyText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  error: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  button: {
    minHeight: 52,
    marginTop: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  buttonText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  loadIndicator: {
    marginTop: 16,
  },
  loadWarning: {
    gap: 8,
    marginTop: 12,
  },
  retryButton: {
    minHeight: 46,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
});
