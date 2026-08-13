import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';

import DaymarkGlookoExport, {
  GlookoCredentialStatus,
} from '../../modules/daymark-glooko-export';
import { planNextGlookoBackfill } from '@/data/glooko/glookoBackfill';
import {
  needsGlookoLegacyContinuityConfirmation,
  runSavedGlookoConnectionCheck,
} from '@/data/glooko/glookoCredentialVerification';
import { hasImportedGlookoData } from '@/data/glooko/glookoSyncState';
import { glookoFailureDisposition } from '@/data/glooko/glookoSyncPolicy';
import {
  presentGlookoFailure,
  presentGlookoSyncState,
} from '@/data/glooko/glookoSyncPresentation';
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from '@/data/import/glookoImport';
import {
  GlookoImportSourceCommitGuard,
  releasePreparedGlookoImportSource,
} from '@/data/import/glookoImportLifecycle';
import {
  ImportWriteResult,
  StoredImportSourceSummary,
} from '@/data/persistence/HealthRecordStore';
import {
  addDays,
  formatDate,
  formatTime,
  relativeAge,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';
import { GlookoPumpReportPanel } from './GlookoPumpReportPanel';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'preview'; prepared: PreparedGlookoImport }
  | { kind: 'importing'; prepared: PreparedGlookoImport }
  | {
      kind: 'success';
      prepared: PreparedGlookoImport;
      result: ImportWriteResult;
      mode?: 'quiet';
    }
  | { kind: 'error'; message: string; diagnostic?: string };

function totalRecords(prepared: PreparedGlookoImport) {
  return (
    prepared.preview.glucose.length +
    prepared.preview.basal.length +
    prepared.preview.boluses.length +
    prepared.preview.context.length +
    prepared.preview.dailyInsulinTotals.length
  );
}

function insertedRecords(result: ImportWriteResult) {
  return (
    result.insertedGlucose +
    result.insertedBasal +
    result.insertedBoluses +
    result.insertedContext +
    result.insertedDailyTotals
  );
}

function canImport(prepared: PreparedGlookoImport) {
  return (
    totalRecords(prepared) > 0 || Boolean(prepared.sourcePayload?.bytes.length)
  );
}

function dateRange(prepared: PreparedGlookoImport) {
  const { dataStart, dataThrough } = prepared.preview;
  if (dataStart === undefined || dataThrough === undefined)
    return 'No data range';
  return `${formatDate(toDateKey(dataStart), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} – ${formatDate(toDateKey(dataThrough), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function showSyncNotice(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.LONG);
  }
}

export function GlookoImportCard() {
  const { colors, radius } = useAppTheme();
  const {
    clearImportedGlookoData,
    dataMode,
    glookoBackgroundSyncAvailable,
    glookoSyncing,
    glookoSyncState,
    getGlookoArchiveSummary,
    hasSavedGlookoExport,
    importGlookoData,
    beginGlookoCredentialSetup,
    markGlookoCredentialsReady,
    markGlookoSessionForgotten,
    now,
    reprocessAllGlookoData,
    revision,
    setGlookoHistoryBackfillTarget,
    syncGlooko,
    syncGlookoQuietly,
    syncGlookoRange,
  } = useDataContext();
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const [clearing, setClearing] = useState(false);
  const [forgettingSession, setForgettingSession] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialStatus, setCredentialStatus] =
    useState<GlookoCredentialStatus>({
      configured: false,
      credentialGeneration: 0,
    });
  const [clearMessage, setClearMessage] = useState<string>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savedExportAvailable, setSavedExportAvailable] = useState(false);
  const [archiveSummary, setArchiveSummary] =
    useState<StoredImportSourceSummary>();
  const [reprocessMessage, setReprocessMessage] = useState<string>();
  const sourceCommitGuard = useRef(new GlookoImportSourceCommitGuard()).current;
  const prepared =
    state.kind === 'preview' ||
    state.kind === 'importing' ||
    state.kind === 'success'
      ? state.prepared
      : undefined;
  const count = prepared ? totalRecords(prepared) : 0;
  const warnings = useMemo(
    () => prepared?.preview.warnings.slice(0, 3) ?? [],
    [prepared],
  );
  const syncPresentation = useMemo(
    () => presentGlookoSyncState(glookoSyncState, now),
    [glookoSyncState, now],
  );
  const automaticNeedsAttention = syncPresentation.tone === 'attention';
  const automaticActionRequired =
    glookoFailureDisposition(glookoSyncState.lastErrorCode) ===
    'action-required';
  const savedConnectionActionLabel =
    glookoSyncState.verifiedAccountFingerprint === undefined &&
    !automaticActionRequired
      ? 'Verify saved connection'
      : glookoSyncState.sessionStatus === 'pending-verification'
        ? automaticActionRequired
          ? 'Retry saved connection'
          : 'Verify saved connection'
        : automaticActionRequired
          ? 'Retry saved connection'
          : 'Check saved connection';
  const earliestKnownGlookoDate =
    archiveSummary?.dataStart !== undefined
      ? toDateKey(archiveSummary.dataStart)
      : archiveSummary?.archiveCount
        ? addDays(toDateKey(now), -29)
        : undefined;
  const backfillRange = useMemo(() => {
    return planNextGlookoBackfill({
      earliestKnownDate: earliestKnownGlookoDate,
      backfilledBeforeDate: glookoSyncState.historyBackfillBeforeDate,
    });
  }, [earliestKnownGlookoDate, glookoSyncState.historyBackfillBeforeDate]);
  const automaticBackfillRange = useMemo(
    () =>
      glookoSyncState.historyBackfillTargetDate === undefined
        ? undefined
        : planNextGlookoBackfill({
            earliestKnownDate: earliestKnownGlookoDate,
            backfilledBeforeDate: glookoSyncState.historyBackfillBeforeDate,
            targetDate: glookoSyncState.historyBackfillTargetDate,
          }),
    [
      earliestKnownGlookoDate,
      glookoSyncState.historyBackfillBeforeDate,
      glookoSyncState.historyBackfillTargetDate,
    ],
  );

  useEffect(() => {
    return () => {
      // Replacement, failure, cancellation/navigation and unmount all release
      // an uncommitted manual source archive deterministically.
      if (prepared) sourceCommitGuard.disposePreview(prepared);
    };
  }, [prepared, sourceCommitGuard]);

  useEffect(() => {
    let active = true;
    void hasSavedGlookoExport()
      .then((available) => {
        if (active) setSavedExportAvailable(available);
      })
      .catch(() => {
        // A missing availability hint must not block a new sync.
      });
    return () => {
      active = false;
    };
  }, [hasSavedGlookoExport]);

  useEffect(() => {
    let active = true;
    void getGlookoArchiveSummary()
      .then((summary) => {
        if (active) setArchiveSummary(summary);
      })
      .catch(() => {
        // Archive diagnostics must never block importing or source refresh.
      });
    return () => {
      active = false;
    };
  }, [getGlookoArchiveSummary, revision]);

  useEffect(() => {
    let active = true;
    void DaymarkGlookoExport.getCredentialStatusAsync()
      .then((status) => {
        if (active) setCredentialStatus(status);
      })
      .catch(() => {
        // Manual Glooko sync remains available if native status fails.
      });
    return () => {
      active = false;
    };
  }, [revision]);

  async function setUpAutomaticSignIn() {
    setCredentialBusy(true);
    setClearMessage(undefined);
    let releaseCredentialBarrier: (() => void) | undefined;
    try {
      releaseCredentialBarrier = await beginGlookoCredentialSetup();
      const legacyContinuityRequired =
        needsGlookoLegacyContinuityConfirmation(
          glookoSyncState,
          await hasImportedGlookoData(),
        );
      const result = await DaymarkGlookoExport.openCredentialSetupAsync(
        legacyContinuityRequired,
      );
      const status = await DaymarkGlookoExport.getCredentialStatusAsync();
      setCredentialStatus(status);
      if (result.status === 'saved') {
        const verificationPromise = markGlookoCredentialsReady(
          result.credentialGeneration,
          result.legacyCredentialContinuity,
        );
        // The saved generation's fresh run is now reserved behind the setup
        // barrier, so releasing cannot let an older account re-enter first.
        releaseCredentialBarrier();
        releaseCredentialBarrier = undefined;
        const verification = await verificationPromise;
        if (verification.status === 'success') {
          showSyncNotice(
            'Glooko is connected. Automatic updates are on.',
          );
        } else {
          const message =
            verification.status === 'skipped'
              ? 'The sign-in was saved, but another Glooko check is already running.'
              : presentGlookoFailure(verification.reason);
          setClearMessage(message);
          showSyncNotice(
            'Your sign-in was saved, but T1 Arc could not confirm the connection. Open Glooko in Sources to try again.',
          );
        }
      }
    } catch (error) {
      setClearMessage(
        'T1 Arc could not save the Glooko connection. Check the details and try again.',
      );
    } finally {
      releaseCredentialBarrier?.();
      setCredentialBusy(false);
    }
  }

  async function refreshLastTrace(fallback?: string) {
    let trace = fallback;
    if (!trace) {
      try {
        trace = (await DaymarkGlookoExport.getLastTraceAsync()) ?? undefined;
      } catch {
        // The connector result remains usable without its diagnostic trace.
      }
    }
    return trace;
  }

  async function readPreparedExport(fileName: string, uri: string) {
    const cachedFile = new File(uri);
    let bytes: Uint8Array | undefined;
    let transferred = false;
    try {
      bytes = await cachedFile.bytes();
      const next = await prepareGlookoImport(fileName, bytes);
      transferred = true;
      return next;
    } finally {
      if (!transferred) bytes?.fill(0);
      // Both the native connector and DocumentPicker create a private cache
      // copy. The exact bytes are carried into encrypted SQLCipher storage by
      // the prepared import, so this transient filesystem copy can be removed.
      try {
        if (cachedFile.exists) cachedFile.delete();
      } catch {
        // Android may already have released the transient cache copy.
      }
    }
  }

  async function syncFromGlooko() {
    setState({ kind: 'preparing' });
    let connectorDiagnostic: string | undefined;
    try {
      const outcome = await syncGlooko();
      connectorDiagnostic = await refreshLastTrace(
        'diagnostic' in outcome ? outcome.diagnostic : undefined,
      );
      if (outcome.status !== 'success') {
        setState({
          kind: 'error',
          message:
            outcome.status === 'skipped'
              ? 'Glooko refresh is already being handled.'
              : presentGlookoFailure(outcome.reason),
          diagnostic: connectorDiagnostic,
        });
        showSyncNotice(
          'Glooko did not update. Open Glooko in Sources to try again.',
        );
        return;
      }
      setState({
        kind: 'success',
        prepared: outcome.prepared,
        result: outcome.result,
      });
      if (outcome.result.sourcePayloadStored) setSavedExportAvailable(true);
      const inserted = insertedRecords(outcome.result);
      showSyncNotice(
        inserted
          ? `Glooko updated: ${inserted} new items added.`
          : outcome.result.alreadyImported
            ? 'This Glooko file was already added.'
            : outcome.result.sourcePayloadStored
              ? 'The Glooko file was saved, but T1 Arc did not find any data it understands.'
              : 'Glooko is up to date.',
      );
    } catch (error) {
      connectorDiagnostic = await refreshLastTrace(connectorDiagnostic);
      setState({
        kind: 'error',
        message: 'Glooko did not finish updating. Try again in a moment.',
        diagnostic: connectorDiagnostic,
      });
      showSyncNotice(
        'Glooko did not update. Open Glooko in Sources to try again.',
      );
    }
  }

  async function testAutomaticGlookoRefresh() {
    setState({ kind: 'preparing' });
    let connectorDiagnostic: string | undefined;
    try {
      const outcome = await runSavedGlookoConnectionCheck(
        credentialStatus,
        glookoSyncState,
        markGlookoCredentialsReady,
        syncGlookoQuietly,
      );
      connectorDiagnostic = await refreshLastTrace(
        'diagnostic' in outcome ? outcome.diagnostic : undefined,
      );
      if (outcome.status !== 'success') {
        setState({
          kind: 'error',
          message:
            outcome.status === 'skipped'
              ? 'Glooko refresh is already being handled.'
              : presentGlookoFailure(outcome.reason),
          diagnostic: connectorDiagnostic,
        });
        showSyncNotice(
          outcome.status === 'skipped'
            ? 'Another Glooko refresh is already running.'
            : presentGlookoFailure(outcome.reason),
        );
        return;
      }
      setState({
        kind: 'success',
        prepared: outcome.prepared,
        result: outcome.result,
        mode: 'quiet',
      });
      const inserted = insertedRecords(outcome.result);
      showSyncNotice(
        inserted
          ? `Glooko updated: ${inserted} new items added.`
          : 'Glooko is connected and ready for automatic updates.',
      );
    } catch (error) {
      connectorDiagnostic = await refreshLastTrace(connectorDiagnostic);
      setState({
        kind: 'error',
        message: 'The saved Glooko connection could not be checked. Try again in a moment.',
        diagnostic: connectorDiagnostic,
      });
      showSyncNotice(
        'Glooko did not update. Open Glooko in Sources to try again.',
      );
    }
  }

  async function backfillOlderGlookoHistory() {
    if (!backfillRange) return;
    setState({ kind: 'preparing' });
    let connectorDiagnostic: string | undefined;
    try {
      const outcome = await syncGlookoRange(
        backfillRange.startDate,
        backfillRange.endDate,
      );
      connectorDiagnostic = await refreshLastTrace(
        'diagnostic' in outcome ? outcome.diagnostic : undefined,
      );
      if (outcome.status !== 'success') {
        setState({
          kind: 'error',
          message:
            outcome.status === 'skipped'
              ? 'Glooko refresh is already being handled.'
              : presentGlookoFailure(outcome.reason),
          diagnostic: connectorDiagnostic,
        });
        showSyncNotice(
          'Older Glooko history was not added. Open Glooko in Sources to try again.',
        );
        return;
      }
      setState({
        kind: 'success',
        prepared: outcome.prepared,
        result: outcome.result,
      });
      if (outcome.result.sourcePayloadStored) setSavedExportAvailable(true);
      const inserted = insertedRecords(outcome.result);
      showSyncNotice(
        inserted
          ? `Older Glooko history added: ${inserted} records.`
          : 'Historical range checked. No new supported records were found.',
      );
    } catch (error) {
      connectorDiagnostic = await refreshLastTrace(connectorDiagnostic);
      setState({
        kind: 'error',
        message: 'Older Glooko history could not be added. Try again in a moment.',
        diagnostic: connectorDiagnostic,
      });
    }
  }

  function confirmBackfill() {
    if (!backfillRange) return;
    const start = formatDate(backfillRange.startDate, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const end = formatDate(backfillRange.endDate, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    Alert.alert(
      'Add the next older 90 days?',
      `T1 Arc will ask Glooko for ${start} to ${end} and add anything new. Your original download stays secure on this phone. This can take a couple of minutes.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add older history',
          onPress: () => void backfillOlderGlookoHistory(),
        },
      ],
    );
  }

  function chooseAutomaticBackfillTarget() {
    if (!backfillRange || !earliestKnownGlookoDate) return;
    const currentTarget =
      glookoSyncState.historyBackfillTargetDate ??
      addDays(backfillRange.startDate, -365);
    DateTimePickerAndroid.open({
      value: new Date(zonedDateTimeToTimestamp(currentTarget, 12)),
      mode: 'date',
      minimumDate: new Date(zonedDateTimeToTimestamp('2000-01-01', 12)),
      maximumDate: new Date(
        zonedDateTimeToTimestamp(backfillRange.endDate, 12),
      ),
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        const targetDate = toDateKey(selected.getTime() + 12 * 60 * 60_000);
        const label = formatDate(targetDate, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        Alert.alert(
          'Build history back to this date?',
          `T1 Arc will work backwards to ${label}, adding one older period each day. Recent updates stay the priority, and the process pauses if Glooko asks you to sign in again.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Start automatic history',
              onPress: () => {
                void setGlookoHistoryBackfillTarget(
                  targetDate,
                  earliestKnownGlookoDate,
                ).then(() => {
                  showSyncNotice(
                    'Automatic Glooko history is now working in the background.',
                  );
                });
              },
            },
          ],
        );
      },
    });
  }

  function stopAutomaticBackfill() {
    Alert.alert(
      'Stop automatic history?',
      'History already added stays securely on this phone. You can continue from the same point later.',
      [
        { text: 'Keep running', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: () => {
            void setGlookoHistoryBackfillTarget(undefined);
          },
        },
      ],
    );
  }

  async function chooseExport() {
    setState({ kind: 'preparing' });
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: [
          'application/zip',
          'application/x-zip-compressed',
          'text/csv',
          'text/comma-separated-values',
          'application/octet-stream',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selected.canceled) {
        setState({ kind: 'idle' });
        return;
      }
      const asset = selected.assets[0];
      if (!asset) throw new Error('No export file was selected.');
      const next = await readPreparedExport(asset.name, asset.uri);
      setState({ kind: 'preview', prepared: next });
    } catch (error) {
      setState({
        kind: 'error',
        message: 'T1 Arc could not safely read this Glooko file. Choose a fresh download from Glooko and try again.',
      });
    }
  }

  function commitImport() {
    if (!prepared || !canImport(prepared)) return;
    Alert.alert(
      'Confirm this Glooko data',
      'This file must belong to the same person as any Glooko data already in T1 Arc, or be the first Glooko data added. Its times must be UK local time and its dates must be written day/month/year.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm and import',
          onPress: () => void commitConfirmedImport(),
        },
      ],
    );
  }

  async function commitConfirmedImport() {
    if (!prepared || !canImport(prepared)) return;
    sourceCommitGuard.begin(prepared);
    setState({ kind: 'importing', prepared });
    try {
      const result = await importGlookoData(prepared, {
        samePersonOrFirstGlookoDataConfirmed: true,
        ukTimestampFormatConfirmed: true,
      });
      setState({
        kind: 'success',
        prepared: releasePreparedGlookoImportSource(prepared),
        result,
      });
      if (result.sourcePayloadStored) setSavedExportAvailable(true);
    } catch (error) {
      setState({
        kind: 'error',
        message: 'T1 Arc could not add this Glooko data. Nothing was changed. Try a fresh download from Glooko.',
      });
    } finally {
      sourceCommitGuard.finish(prepared);
    }
  }

  async function reprocessSavedExports() {
    setState({ kind: 'preparing' });
    setReprocessMessage(undefined);
    try {
      const result = await reprocessAllGlookoData();
      const inserted =
        result.insertedGlucose +
        result.insertedBasal +
        result.insertedBoluses +
        result.insertedContext +
        result.insertedDailyTotals;
      const message = `${result.archivesProcessed} saved Glooko ${
        result.archivesProcessed === 1 ? 'update was' : 'updates were'
      } checked again · ${inserted} new ${
        inserted === 1 ? 'item' : 'items'
      } added${result.archivesFailed ? ` · ${result.archivesFailed} could not be read and were left unchanged` : ''}.`;
      setState({ kind: 'idle' });
      setReprocessMessage(message);
      showSyncNotice(message);
    } catch (error) {
      setState({
        kind: 'error',
        message: 'T1 Arc could not check the saved Glooko history again. Nothing was changed.',
      });
    }
  }

  function confirmClear() {
    Alert.alert(
      'Remove imported Glooko data?',
      'This removes Glooko glucose, basal insulin, bolus insulin, pump carbs and notes from T1 Arc. Libre history and anything entered by hand are kept.',
      [
        { text: 'Keep data', style: 'cancel' },
        {
          text: 'Remove imported data',
          style: 'destructive',
          onPress: () => {
            setClearing(true);
            setClearMessage(undefined);
            void clearImportedGlookoData()
              .then((removed) => {
                const records =
                  removed.glucose +
                  removed.basal +
                  removed.boluses +
                  removed.context +
                  removed.dailyTotals;
                setState({ kind: 'idle' });
                setSavedExportAvailable(false);
                setClearMessage(
                  records
                    ? `${records} imported records and ${removed.batches} import ${removed.batches === 1 ? 'batch' : 'batches'} removed.`
                    : 'There were no imported Glooko records to remove.',
                );
              })
              .catch((error) => {
                setClearMessage(
                  'Imported Glooko data could not be removed. Try again.',
                );
              })
              .finally(() => setClearing(false));
          },
        },
      ],
    );
  }

  function confirmForgetSession() {
    Alert.alert(
      'Remove the Glooko sign-in?',
      'This removes the saved Glooko connection from this phone. Glucose and insulin already added to T1 Arc are kept.',
      [
        { text: 'Keep sign-in', style: 'cancel' },
        {
          text: 'Remove sign-in',
          style: 'destructive',
          onPress: () => {
            setForgettingSession(true);
            setClearMessage(undefined);
            void DaymarkGlookoExport.clearSessionAsync()
              .then(async () => {
                await markGlookoSessionForgotten();
                const status =
                  await DaymarkGlookoExport.getCredentialStatusAsync();
                setCredentialStatus(status);
                setClearMessage(
                  'Encrypted Glooko sign-in removed. Imported records were kept.',
                );
              })
              .catch((error) =>
                setClearMessage(
                  'The saved Glooko connection could not be removed. Try again.',
                ),
              )
              .finally(() => setForgettingSession(false));
          },
        },
      ],
    );
  }

  return (
    <SectionCard style={styles.card}>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.insulin}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.insulin}
            name="archive-outline"
            size={23}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Glooko</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            If you have one Glooko patient and use UK dates and times, sign in
            once to keep your glucose and insulin history up to date. Pump
            reports can still be added by hand.
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.automaticPanel,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <View
          style={[
            styles.credentialPanel,
            { borderBottomColor: colors.divider },
          ]}
        >
          <View
            style={[
              styles.credentialIcon,
              {
                backgroundColor: credentialStatus.configured
                  ? `${colors.accent}18`
                  : `${colors.warning}18`,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={
                credentialStatus.configured ? colors.accent : colors.warning
              }
              name={
                credentialStatus.configured
                  ? 'shield-checkmark-outline'
                  : 'lock-closed-outline'
              }
              size={17}
            />
          </View>
          <View style={styles.credentialCopy}>
            <Text style={[styles.credentialTitle, { color: colors.text }]}>
              {credentialStatus.configured
                ? 'Saved securely on this phone'
                : 'Set up automatic sign-in'}
            </Text>
            <Text
              style={[styles.credentialDetail, { color: colors.textSecondary }]}
            >
              {credentialStatus.configured
                ? `${credentialStatus.maskedEmail ?? 'Saved Glooko account'} · UK dates and times confirmed`
                : 'Confirm that this account uses UK local time and dates written day/month/year. Being on Glooko EU does not guarantee this.'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={
              credentialStatus.configured
                ? 'Update encrypted Glooko sign-in'
                : 'Set up encrypted Glooko sign-in'
            }
            accessibilityRole="button"
            disabled={credentialBusy || glookoSyncing}
            onPress={() => void setUpAutomaticSignIn()}
            style={({ pressed }) => [
              styles.credentialAction,
              {
                borderColor: colors.border,
                opacity: pressed || credentialBusy || glookoSyncing ? 0.55 : 1,
              },
            ]}
          >
            {credentialBusy ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text
                style={[styles.credentialActionText, { color: colors.primary }]}
              >
                {credentialStatus.configured ? 'Update' : 'Set up'}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.automaticTop}>
          <View style={styles.automaticCopy}>
            <Text style={[styles.automaticTitle, { color: colors.text }]}>
              Automatic updates
            </Text>
            <Text
              style={[styles.automaticDetail, { color: colors.textSecondary }]}
            >
              {glookoSyncState.automaticEnabled
                ? 'On — T1 Arc checks Glooko and adds anything new.'
                : glookoSyncState.sessionStatus === 'pending-verification'
                  ? automaticActionRequired
                    ? 'Paused — this account needs attention before automatic updates can start.'
                    : 'Your saved sign-in needs one successful check before automatic updates can start.'
                  : automaticActionRequired
                    ? 'Paused — this account needs attention before automatic updates can resume.'
                    : 'Sign in to keep your Glooko history up to date automatically.'}
            </Text>
          </View>
          <Ionicons
            accessibilityLabel={
              glookoSyncState.automaticEnabled
                ? 'Automatic Glooko updates are on'
                : 'Automatic Glooko updates are off'
            }
            color={
              glookoSyncState.automaticEnabled
                ? colors.accent
                : colors.textTertiary
            }
            name={
              glookoSyncState.automaticEnabled
                ? 'checkmark-circle'
                : 'ellipse-outline'
            }
            size={22}
          />
        </View>

        <View style={[styles.syncFacts, { borderTopColor: colors.divider }]}>
          <SyncFact
            label="Last attempt"
            value={
              glookoSyncState.lastAttemptAt === undefined
                ? 'Not yet'
                : relativeAge(glookoSyncState.lastAttemptAt, now)
            }
          />
          <SyncFact
            label="Last success"
            value={
              (glookoSyncState.lastCheckedAt ??
                glookoSyncState.lastSuccessAt) === undefined
                ? 'Not yet'
                : relativeAge(
                    glookoSyncState.lastCheckedAt ??
                      glookoSyncState.lastSuccessAt,
                    now,
                  )
            }
          />
          <SyncFact
            label="Last download"
            value={
              glookoSyncState.lastDownloadedAt === undefined
                ? 'Not yet'
                : relativeAge(glookoSyncState.lastDownloadedAt, now)
            }
          />
          <SyncFact
            label="Data through"
            value={
              glookoSyncState.dataThrough === undefined
                ? 'Unknown'
                : `${formatDate(toDateKey(glookoSyncState.dataThrough), {
                    day: 'numeric',
                    month: 'short',
                  })}, ${formatTime(glookoSyncState.dataThrough)}`
            }
          />
        </View>

        <View style={styles.automaticStatus}>
          {glookoSyncing ? (
            <ActivityIndicator color={colors.insulin} size="small" />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={automaticNeedsAttention ? colors.warning : colors.accent}
              name={
                glookoSyncState.sessionStatus === 'needs-sign-in'
                  ? 'key-outline'
                  : automaticNeedsAttention
                    ? 'alert-circle-outline'
                    : 'shield-checkmark-outline'
              }
              size={16}
            />
          )}
          <Text
            style={[
              styles.automaticStatusText,
              {
                color: automaticNeedsAttention
                  ? colors.warning
                  : colors.textSecondary,
              },
            ]}
          >
            {glookoSyncing
              ? 'Checking Glooko on this phone…'
              : glookoSyncState.sessionStatus === 'needs-sign-in'
                ? credentialStatus.configured
                  ? 'The encrypted sign-in needs updating before automatic refresh can continue.'
                  : 'Set up encrypted automatic sign-in to resume refresh.'
                : syncPresentation.message}
          </Text>
        </View>
        {showAdvanced && credentialStatus.configured ? (
          <>
            <View
              style={[
                styles.backgroundAudit,
                { borderTopColor: colors.divider },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={
                  glookoSyncState.lastBackgroundOutcome === 'failed' ||
                  glookoSyncState.lastBackgroundOutcome === 'session-required'
                    ? colors.warning
                    : colors.textTertiary
                }
                name="phone-portrait-outline"
                size={14}
              />
              <Text
                style={[
                  styles.backgroundAuditText,
                  {
                    color:
                      glookoSyncState.lastBackgroundOutcome === 'failed' ||
                      glookoSyncState.lastBackgroundOutcome ===
                        'session-required'
                        ? colors.warning
                        : colors.textTertiary,
                  },
                ]}
              >
                {glookoSyncState.lastBackgroundRunAt
                  ? `Last automatic check ${relativeAge(
                      glookoSyncState.lastBackgroundRunAt,
                      now,
                    )}${glookoSyncState.lastBackgroundDetail ? ` · ${glookoSyncState.lastBackgroundDetail}` : ''}.`
                  : glookoBackgroundSyncAvailable
                    ? 'Waiting for the first automatic check.'
                    : 'Opening T1 Arc will still check whether Glooko needs updating.'}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={savedConnectionActionLabel}
              accessibilityHint="Checks that T1 Arc can update from Glooko"
              accessibilityRole="button"
              disabled={glookoSyncing || state.kind === 'preparing'}
              onPress={() => void testAutomaticGlookoRefresh()}
              style={({ pressed }) => [
                styles.quietRefreshButton,
                {
                  borderColor: colors.border,
                  opacity:
                    pressed || glookoSyncing || state.kind === 'preparing'
                      ? 0.6
                      : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.primary}
                name="flash-outline"
                size={16}
              />
              <View style={styles.quietRefreshCopy}>
                <Text
                  style={[styles.quietRefreshTitle, { color: colors.primary }]}
                >
                  {savedConnectionActionLabel}
                </Text>
                <Text
                  style={[
                    styles.quietRefreshDetail,
                    { color: colors.textTertiary },
                  ]}
                >
                  {glookoSyncState.verifiedAccountFingerprint === undefined &&
                  !automaticActionRequired
                    ? 'Runs the verified download required before automatic updates can start'
                    : glookoSyncState.sessionStatus === 'pending-verification'
                      ? automaticActionRequired
                        ? 'Try again after resolving the issue shown above'
                        : 'Retries the verified download required before automatic updates can start'
                      : automaticActionRequired
                        ? 'Try again after resolving the issue shown above'
                        : 'Confirms that automatic updates can run'}
                </Text>
              </View>
            </Pressable>
          </>
        ) : null}
      </View>

      {showAdvanced && archiveSummary?.archiveCount ? (
        <View
          style={[
            styles.archivePanel,
            {
              backgroundColor: `${colors.insulin}0C`,
              borderColor: `${colors.insulin}35`,
              borderRadius: radius.md,
            },
          ]}
        >
          <View style={styles.archiveHeader}>
            <Ionicons
              accessibilityElementsHidden
              color={colors.insulin}
              name="lock-closed-outline"
              size={17}
            />
            <View style={styles.archiveCopy}>
              <Text style={[styles.archiveTitle, { color: colors.text }]}>
                Saved Glooko history
              </Text>
              <Text
                style={[styles.archiveDetail, { color: colors.textSecondary }]}
              >
                Your saved Glooko history stays secure on this phone so T1 Arc
                can check it again after an app update.
              </Text>
            </View>
          </View>
          <View style={[styles.syncFacts, { borderTopColor: colors.divider }]}>
            <SyncFact
              label="Saved updates"
              value={archiveSummary.archiveCount.toLocaleString('en-GB')}
            />
            <SyncFact
              label="Last saved"
              value={
                archiveSummary.latestStoredAt === undefined
                  ? 'Unknown'
                  : relativeAge(archiveSummary.latestStoredAt, now)
              }
            />
          </View>
          <Text style={[styles.archiveMeta, { color: colors.textTertiary }]}>
            {archiveSummary.dataStart !== undefined &&
            archiveSummary.dataThrough !== undefined
              ? `History from ${formatDate(
                  toDateKey(archiveSummary.dataStart),
                  { day: 'numeric', month: 'short', year: 'numeric' },
                )} to ${formatDate(toDateKey(archiveSummary.dataThrough), {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}`
              : ''}
          </Text>
        </View>
      ) : null}

      <GlookoPumpReportPanel showControls={showAdvanced} />

      {state.kind === 'preparing' ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.loading, { backgroundColor: colors.surfaceMuted }]}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Reading and organising your export locally…
          </Text>
        </View>
      ) : null}

      {prepared && state.kind !== 'success' ? (
        <View
          style={[
            styles.preview,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <View style={styles.previewTop}>
            <View style={styles.previewCopy}>
              <Text
                numberOfLines={1}
                style={[styles.fileName, { color: colors.text }]}
              >
                {prepared.batch.fileName}
              </Text>
              <Text style={[styles.range, { color: colors.textSecondary }]}>
                {dateRange(prepared)}
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={canImport(prepared) ? colors.accent : colors.warning}
              name={
                canImport(prepared)
                  ? 'checkmark-circle-outline'
                  : 'alert-circle-outline'
              }
              size={24}
            />
          </View>
          <View style={styles.metrics}>
            <Metric label="Glucose" value={prepared.preview.glucose.length} />
            <Metric label="Basal" value={prepared.preview.basal.length} />
            <Metric label="Bolus" value={prepared.preview.boluses.length} />
            <Metric label="Context" value={prepared.preview.context.length} />
            <Metric
              label="Daily totals"
              value={prepared.preview.dailyInsulinTotals.length}
            />
            <Metric
              label="Details"
              value={prepared.preview.rawRecords.length}
            />
            <Metric
              label="Skipped"
              value={
                prepared.preview.skippedRows + prepared.preview.duplicateRows
              }
            />
          </View>
          <Text style={[styles.fileMeta, { color: colors.textTertiary }]}>
            {prepared.preview.recognisedFiles.length} file
            {prepared.preview.recognisedFiles.length === 1 ? '' : 's'} read ·{' '}
            {prepared.preview.retainedFiles.length} saved securely ·{' '}
            {prepared.preview.ignoredFiles.length} not used yet
          </Text>
          {warnings.length ? (
            <View style={styles.warningStack}>
              {warnings.map((warning) => (
                <View key={warning} style={styles.warningRow}>
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.warning}
                    name="information-circle-outline"
                    size={16}
                  />
                  <Text
                    style={[
                      styles.warningText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {warning}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {state.kind === 'success' ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.result,
            {
              backgroundColor: `${
                totalRecords(state.prepared) ? colors.accent : colors.warning
              }12`,
              borderColor: `${
                totalRecords(state.prepared) ? colors.accent : colors.warning
              }55`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={
              totalRecords(state.prepared) ? colors.accent : colors.warning
            }
            name={
              totalRecords(state.prepared)
                ? 'checkmark-circle'
                : 'information-circle'
            }
            size={24}
          />
          <View style={styles.resultCopy}>
            <Text style={[styles.resultTitle, { color: colors.text }]}>
              {state.mode === 'quiet'
                  ? 'Automatic update complete'
                : totalRecords(state.prepared) === 0 &&
                    state.result.sourcePayloadStored
                  ? 'Glooko file saved — no data added'
                  : insertedRecords(state.result)
                    ? state.result.alreadyImported
                      ? 'Saved Glooko file checked again'
                      : 'Glooko data added'
                    : state.result.alreadyImported
                      ? 'This Glooko file was already added'
                      : 'Glooko data added'}
            </Text>
            <Text style={[styles.resultBody, { color: colors.textSecondary }]}>
              {state.mode === 'quiet'
                ? insertedRecords(state.result)
                  ? `T1 Arc added ${insertedRecords(state.result)} new items and left your existing history unchanged.`
                  : 'Glooko is up to date. Your existing history was left unchanged.'
                : totalRecords(state.prepared) === 0
                ? 'The download worked, but T1 Arc could not find glucose or insulin data it understands.'
                : `${state.result.insertedGlucose} glucose, ${state.result.insertedBasal} basal, ${state.result.insertedBoluses} bolus, ${state.result.insertedDailyTotals} daily insulin total and ${state.result.insertedContext} pump notes added${
                    state.result.duplicateCount
                      ? ` · ${state.result.duplicateCount} duplicates skipped`
                      : ''
                  }.`}
            </Text>
            {state.prepared.preview.unrecognisedFiles
              .slice(0, 3)
              .map((file) => (
                <Text
                  key={file.name}
                  style={[styles.resultHint, { color: colors.textTertiary }]}
                >
                  Kept securely, but no data was added from {file.name}.
                </Text>
              ))}
            {totalRecords(state.prepared) === 0
              ? state.prepared.preview.recognisedFiles
                  .slice(0, 3)
                  .map((file) => (
                    <Text
                      key={file.name}
                      style={[
                        styles.resultHint,
                        { color: colors.textTertiary },
                      ]}
                    >
                      Checked {file.name}: no new items were added.
                    </Text>
                  ))
              : null}
            {totalRecords(state.prepared) === 0 &&
            state.prepared.preview.retainedFiles.length ? (
              <Text style={[styles.resultHint, { color: colors.textTertiary }]}>
                Saved for a future T1 Arc update:{' '}
                {state.prepared.preview.retainedFiles
                  .slice(0, 3)
                  .map((file) => file.name)
                  .join(', ')}
              </Text>
            ) : null}
            {state.result.sourcePayloadStored ? (
              <Text style={[styles.resultHint, { color: colors.textTertiary }]}>
                The original Glooko file is saved securely on this phone.
              </Text>
            ) : null}
            {dataMode === 'demo' ? (
              <Text style={[styles.resultHint, { color: colors.textTertiary }]}>
                Switch to Personal glucose above to view these records beside
                your LibreLinkUp history.
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {state.kind === 'error' ? (
        <View
          accessibilityLiveRegion="assertive"
          style={[
            styles.result,
            {
              backgroundColor: `${colors.danger}10`,
              borderColor: `${colors.danger}55`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.danger}
            name="alert-circle-outline"
            size={24}
          />
          <View style={styles.resultCopy}>
            <Text style={[styles.resultTitle, { color: colors.text }]}>
              Glooko update needs attention
            </Text>
            <Text style={[styles.resultBody, { color: colors.textSecondary }]}>
              {state.message}
            </Text>
          </View>
        </View>
      ) : null}

      {prepared && state.kind !== 'success' ? (
        <Pressable
          accessibilityRole="button"
          disabled={!canImport(prepared) || state.kind === 'importing'}
          onPress={() => void commitImport()}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: canImport(prepared)
                ? colors.primary
                : colors.surfaceMuted,
              borderRadius: radius.md,
              opacity: pressed ? 0.76 : 1,
            },
          ]}
        >
          {state.kind === 'importing' ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={
                canImport(prepared) ? colors.onPrimary : colors.textTertiary
              }
              name="lock-closed-outline"
              size={19}
            />
          )}
          <Text
            style={[
              styles.primaryText,
              {
                color: canImport(prepared)
                  ? colors.onPrimary
                  : colors.textTertiary,
              },
            ]}
          >
            {state.kind === 'importing'
              ? 'Adding Glooko data…'
              : count
                ? `Add ${count} items`
                : prepared.sourcePayload
                  ? 'Save Glooko file'
                  : 'No data to add'}
          </Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            accessibilityLabel="Update Glooko now"
            accessibilityRole="button"
            disabled={state.kind === 'preparing' || glookoSyncing}
            onPress={() => void syncFromGlooko()}
            style={({ pressed }) => [
              styles.primaryButton,
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
              name="sync-outline"
              size={19}
            />
            <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
              {glookoSyncing ? 'Updating Glooko…' : 'Update Glooko now'}
            </Text>
          </Pressable>
          <Text style={[styles.syncFootnote, { color: colors.textTertiary }]}>
            New readings are added once. Your saved Glooko history stays secure
            on this phone.
          </Text>
          <Pressable
            accessibilityLabel="Connection options"
            accessibilityRole="button"
            accessibilityState={{ expanded: showAdvanced }}
            onPress={() => setShowAdvanced((visible) => !visible)}
            style={({ pressed }) => [
              styles.advancedToggle,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.advancedToggleText,
                { color: colors.textSecondary },
              ]}
            >
              {showAdvanced ? 'Hide connection options' : 'Connection options'}
            </Text>
            <Ionicons
              accessibilityElementsHidden
              color={colors.textTertiary}
              name={showAdvanced ? 'chevron-up' : 'chevron-down'}
              size={17}
            />
          </Pressable>
          {showAdvanced && backfillRange ? (
            <View
              style={[
                styles.backfillPanel,
                {
                  backgroundColor: `${colors.insulin}0D`,
                  borderColor: `${colors.insulin}35`,
                  borderRadius: radius.md,
                },
              ]}
            >
              <View style={styles.backfillHeader}>
                <View
                  style={[
                    styles.backfillIcon,
                    {
                      backgroundColor: `${colors.insulin}18`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.insulin}
                    name="play-back-outline"
                    size={20}
                  />
                </View>
                <View style={styles.backfillCopy}>
                  <Text style={[styles.backfillTitle, { color: colors.text }]}>
                    Build your complete history
                  </Text>
                  <Text
                    style={[
                      styles.backfillBody,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Glooko provides up to 90 days at a time. T1 Arc works
                    backwards one period at a time and remembers where it got
                    to.
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel={`Add older Glooko history from ${formatDate(
                  backfillRange.startDate,
                  { day: 'numeric', month: 'long', year: 'numeric' },
                )} to ${formatDate(backfillRange.endDate, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}`}
                accessibilityRole="button"
                disabled={state.kind === 'preparing' || glookoSyncing}
                onPress={confirmBackfill}
                style={({ pressed }) => [
                  styles.backfillButton,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: `${colors.insulin}55`,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.insulin}
                  name="archive-outline"
                  size={18}
                />
                <View style={styles.backfillButtonCopy}>
                  <Text
                    style={[
                      styles.backfillButtonTitle,
                      { color: colors.insulin },
                    ]}
                  >
                    Add the next older 90 days
                  </Text>
                  <Text
                    style={[
                      styles.backfillButtonRange,
                      { color: colors.textTertiary },
                    ]}
                  >
                    {formatDate(backfillRange.startDate, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {' – '}
                    {formatDate(backfillRange.endDate, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="chevron-forward"
                  size={18}
                />
              </Pressable>
              <View
                style={[
                  styles.automaticHistory,
                  { borderTopColor: `${colors.insulin}30` },
                ]}
              >
                <View style={styles.automaticHistoryCopy}>
                  <Text
                    style={[
                      styles.automaticHistoryTitle,
                      { color: colors.text },
                    ]}
                  >
                    {glookoSyncState.historyBackfillTargetDate
                      ? automaticBackfillRange
                        ? 'Automatic history is working'
                        : 'History target reached'
                      : 'Do this without the repeated taps'}
                  </Text>
                  <Text
                    style={[
                      styles.automaticHistoryBody,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {glookoSyncState.historyBackfillTargetDate
                      ? automaticBackfillRange
                        ? `Working back to ${formatDate(
                            glookoSyncState.historyBackfillTargetDate,
                            {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            },
                          )}. Next: ${formatDate(
                            automaticBackfillRange.startDate,
                            { day: 'numeric', month: 'short' },
                          )} – ${formatDate(automaticBackfillRange.endDate, {
                            day: 'numeric',
                            month: 'short',
                          })}.`
                        : `Complete to ${formatDate(
                            glookoSyncState.historyBackfillTargetDate,
                            {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            },
                          )}.`
                      : "Choose the earliest date once. T1 Arc adds one older period each day while keeping today's data up to date first."}
                  </Text>
                  {glookoSyncState.historyBackfillTargetDate &&
                  glookoSyncState.lastHistoryBackfillAt !== undefined ? (
                    <Text
                      style={[
                        styles.automaticHistoryMeta,
                        { color: colors.textTertiary },
                      ]}
                    >
                      Last older block{' '}
                      {relativeAge(glookoSyncState.lastHistoryBackfillAt, now)}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.automaticHistoryActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={glookoSyncing}
                    onPress={chooseAutomaticBackfillTarget}
                    style={({ pressed }) => [
                      styles.automaticHistoryAction,
                      {
                        borderColor: `${colors.insulin}55`,
                        borderRadius: radius.md,
                        opacity: pressed ? 0.65 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.insulin}
                      name="calendar-outline"
                      size={16}
                    />
                    <Text
                      style={[
                        styles.automaticHistoryActionText,
                        { color: colors.insulin },
                      ]}
                    >
                      {glookoSyncState.historyBackfillTargetDate
                        ? 'Change date'
                        : 'Automate history'}
                    </Text>
                  </Pressable>
                  {glookoSyncState.historyBackfillTargetDate ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={glookoSyncing}
                      onPress={stopAutomaticBackfill}
                      style={({ pressed }) => [
                        styles.automaticHistoryStop,
                        { opacity: pressed ? 0.58 : 1 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.automaticHistoryStopText,
                          { color: colors.textTertiary },
                        ]}
                      >
                        Stop
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}
          {showAdvanced && savedExportAvailable ? (
            <Pressable
              accessibilityRole="button"
              disabled={state.kind === 'preparing'}
              onPress={() => void reprocessSavedExports()}
              style={({ pressed }) => [
                styles.savedButton,
                {
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.textSecondary}
                name="refresh-outline"
                size={17}
              />
              <Text
                style={[
                  styles.savedButtonText,
                  { color: colors.textSecondary },
                ]}
              >
                Check saved Glooko history again
              </Text>
            </Pressable>
          ) : null}
          {reprocessMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.reprocessMessage, { color: colors.textSecondary }]}
            >
              {reprocessMessage}
            </Text>
          ) : null}
          {showAdvanced ? (
            <Pressable
              accessibilityRole="button"
              disabled={state.kind === 'preparing'}
              onPress={() => void chooseExport()}
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                Choose a Glooko file from this phone
              </Text>
            </Pressable>
          ) : null}
        </>
      )}

      {prepared && state.kind !== 'success' ? (
        <Pressable
          accessibilityRole="button"
          disabled={state.kind === 'importing'}
          onPress={() => void chooseExport()}
          style={({ pressed }) => [
            styles.secondaryButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.secondaryText, { color: colors.primary }]}>
            Choose a different file
          </Text>
        </Pressable>
      ) : null}

      {showAdvanced ? (
        <View style={[styles.removeArea, { borderTopColor: colors.divider }]}>
          <Pressable
            accessibilityRole="button"
            disabled={
              forgettingSession ||
              glookoSyncing ||
              state.kind === 'preparing' ||
              state.kind === 'importing'
            }
            onPress={confirmForgetSession}
            style={({ pressed }) => [
              styles.sessionButton,
              { opacity: pressed || forgettingSession ? 0.65 : 1 },
            ]}
          >
            {forgettingSession ? (
              <ActivityIndicator color={colors.textSecondary} size="small" />
            ) : (
              <Ionicons
                accessibilityElementsHidden
                color={colors.textSecondary}
                name="log-out-outline"
                size={17}
              />
            )}
            <Text style={[styles.sessionText, { color: colors.textSecondary }]}>
              {forgettingSession
                ? 'Removing sign-in…'
                : 'Remove saved Glooko sign-in'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={
              clearing ||
              glookoSyncing ||
              state.kind === 'preparing' ||
              state.kind === 'importing'
            }
            onPress={confirmClear}
            style={({ pressed }) => [
              styles.removeButton,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed || clearing ? 0.65 : 1,
              },
            ]}
          >
            {clearing ? (
              <ActivityIndicator color={colors.danger} size="small" />
            ) : (
              <Ionicons
                accessibilityElementsHidden
                color={colors.danger}
                name="trash-outline"
                size={18}
              />
            )}
            <Text style={[styles.removeText, { color: colors.danger }]}>
              {clearing ? 'Removing…' : 'Remove imported Glooko data'}
            </Text>
          </Pressable>
          {clearMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.clearMessage, { color: colors.textSecondary }]}
            >
              {clearMessage}
            </Text>
          ) : null}
        </View>
      ) : null}
    </SectionCard>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

function SyncFact({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.syncFact}>
      <Text style={[styles.syncFactLabel, { color: colors.textTertiary }]}>
        {label}
      </Text>
      <Text
        numberOfLines={2}
        style={[styles.syncFactValue, { color: colors.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  automaticPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 16,
  },
  archivePanel: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 12,
  },
  archiveHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  archiveCopy: {
    flex: 1,
    minWidth: 0,
  },
  archiveTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  archiveDetail: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  archiveMeta: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 8,
  },
  credentialPanel: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingBottom: 12,
    marginBottom: 6,
  },
  credentialIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  credentialCopy: {
    flex: 1,
    minWidth: 0,
  },
  credentialTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  credentialDetail: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  credentialAction: {
    minWidth: 58,
    minHeight: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  credentialActionText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  automaticTop: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  automaticCopy: {
    flex: 1,
    minWidth: 0,
  },
  automaticTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  automaticDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  syncFacts: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 11,
  },
  syncFact: {
    flex: 1,
    minWidth: 0,
  },
  syncFactLabel: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  syncFactValue: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  automaticStatus: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 8,
  },
  automaticStatusText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 14,
  },
  backgroundAudit: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingTop: 9,
  },
  backgroundAuditText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 14,
  },
  quietRefreshButton: {
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 9,
    paddingTop: 9,
  },
  quietRefreshCopy: {
    flex: 1,
    minWidth: 0,
  },
  quietRefreshTitle: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
  quietRefreshDetail: {
    fontSize: 9,
    lineHeight: 13,
    marginTop: 1,
  },
  loading: {
    minHeight: 62,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 16,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginTop: 16,
  },
  previewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  previewCopy: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  range: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  metrics: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  metric: {
    flex: 1,
    minWidth: 0,
  },
  metricValue: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 9,
    lineHeight: 13,
  },
  fileMeta: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 10,
  },
  warningStack: {
    gap: 6,
    marginTop: 10,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  warningText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
  },
  result: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    marginTop: 16,
  },
  resultCopy: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  resultBody: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  resultHint: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  primaryButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 14,
  },
  primaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  syncFootnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  advancedToggle: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingHorizontal: 13,
  },
  advancedToggleText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  backfillPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    marginTop: 12,
    padding: 13,
  },
  backfillHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  backfillIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backfillCopy: {
    flex: 1,
    minWidth: 0,
  },
  backfillTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  backfillBody: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  backfillButton: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
  },
  backfillButtonCopy: {
    flex: 1,
    minWidth: 0,
  },
  backfillButtonTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  backfillButtonRange: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  automaticHistory: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingTop: 12,
  },
  automaticHistoryCopy: {
    minWidth: 0,
  },
  automaticHistoryTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  automaticHistoryBody: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  automaticHistoryMeta: {
    fontSize: 8,
    lineHeight: 12,
    marginTop: 4,
  },
  automaticHistoryActions: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  automaticHistoryAction: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  automaticHistoryActionText: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
  automaticHistoryStop: {
    minWidth: 58,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  automaticHistoryStopText: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  savedButton: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 8,
    paddingHorizontal: 12,
  },
  savedButtonText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  reprocessMessage: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 7,
    textAlign: 'center',
  },
  traceArea: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    overflow: 'hidden',
  },
  traceButton: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
  },
  traceButtonCopy: {
    flex: 1,
    minWidth: 0,
  },
  traceTitle: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  traceHint: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 1,
  },
  removeArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 16,
  },
  sessionButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  sessionText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  removeButton: {
    minHeight: 48,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  removeText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  clearMessage: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 8,
  },
});
