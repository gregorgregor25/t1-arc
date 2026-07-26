import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useState } from 'react';
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

import DaymarkGlookoExport from '../../modules/daymark-glooko-export';
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from '@/data/import/glookoImport';
import { ImportWriteResult } from '@/data/persistence/HealthRecordStore';
import { formatDate, toDateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'preview'; prepared: PreparedGlookoImport }
  | { kind: 'importing'; prepared: PreparedGlookoImport }
  | {
      kind: 'success';
      prepared: PreparedGlookoImport;
      result: ImportWriteResult;
    }
  | { kind: 'error'; message: string; diagnostic?: string };

function totalRecords(prepared: PreparedGlookoImport) {
  return (
    prepared.preview.basal.length +
    prepared.preview.boluses.length +
    prepared.preview.context.length
  );
}

function insertedRecords(result: ImportWriteResult) {
  return (
    result.insertedBasal + result.insertedBoluses + result.insertedContext
  );
}

function canImport(prepared: PreparedGlookoImport) {
  return totalRecords(prepared) > 0 || Boolean(prepared.sourcePayload?.bytes.length);
}

function releaseSourcePayload(
  prepared: PreparedGlookoImport,
): PreparedGlookoImport {
  prepared.sourcePayload?.bytes.fill(0);
  return {
    preview: prepared.preview,
    batch: prepared.batch,
  };
}

function dateRange(prepared: PreparedGlookoImport) {
  const { dataStart, dataThrough } = prepared.preview;
  if (dataStart === undefined || dataThrough === undefined) return 'No data range';
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
    hasSavedGlookoExport,
    importGlookoData,
    reprocessLatestGlookoData,
  } = useDataContext();
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const [clearing, setClearing] = useState(false);
  const [forgettingSession, setForgettingSession] = useState(false);
  const [clearMessage, setClearMessage] = useState<string>();
  const [lastTrace, setLastTrace] = useState<string>();
  const [showTrace, setShowTrace] = useState(false);
  const [savedExportAvailable, setSavedExportAvailable] = useState(false);
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

  useEffect(() => {
    let active = true;
    void DaymarkGlookoExport.getLastTraceAsync()
      .then((trace) => {
        if (active && trace) setLastTrace(trace);
      })
      .catch(() => {
        // Diagnostics must never block the import experience.
      });
    return () => {
      active = false;
    };
  }, []);

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

  async function refreshLastTrace(fallback?: string) {
    let trace = fallback;
    if (!trace) {
      try {
        trace = (await DaymarkGlookoExport.getLastTraceAsync()) ?? undefined;
      } catch {
        // The connector result remains usable without its diagnostic trace.
      }
    }
    if (trace) setLastTrace(trace);
    return trace;
  }

  async function readPreparedExport(fileName: string, uri: string) {
    const cachedFile = new File(uri);
    try {
      const bytes = await cachedFile.bytes();
      return await prepareGlookoImport(fileName, bytes);
    } finally {
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
      const exported = await DaymarkGlookoExport.startExportAsync(30);
      connectorDiagnostic = await refreshLastTrace(exported.diagnostic);
      if (exported.status === 'cancelled') {
        setState({
          kind: 'error',
          message:
            exported.message ??
            'No Glooko ZIP or CSV download was detected before you returned.',
          diagnostic: connectorDiagnostic,
        });
        showSyncNotice(
          'Glooko export was not imported. Open connector details in Sources.',
        );
        return;
      }
      const next = await readPreparedExport(exported.fileName, exported.uri);
      setState({ kind: 'importing', prepared: next });
      const result = await importGlookoData(next);
      setState({
        kind: 'success',
        prepared: releaseSourcePayload(next),
        result,
      });
      if (result.sourcePayloadStored) setSavedExportAvailable(true);
      const inserted = insertedRecords(result);
      showSyncNotice(
        inserted
          ? `Glooko sync complete: ${inserted} records added.`
          : result.alreadyImported
            ? 'This Glooko export was already imported.'
            : result.sourcePayloadStored
              ? 'Glooko export saved, but insulin was not recognised yet.'
              : 'Glooko sync completed without new records.',
      );
    } catch (error) {
      connectorDiagnostic = await refreshLastTrace(connectorDiagnostic);
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Glooko could not be synced on this device.',
        diagnostic: connectorDiagnostic,
      });
      showSyncNotice(
        'Glooko export was not imported. Open connector details in Sources.',
      );
    }
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
        message:
          error instanceof Error
            ? error.message
            : 'The selected export could not be read.',
      });
    }
  }

  async function commitImport() {
    if (!prepared || !canImport(prepared)) return;
    setState({ kind: 'importing', prepared });
    try {
      const result = await importGlookoData(prepared);
      setState({
        kind: 'success',
        prepared: releaseSourcePayload(prepared),
        result,
      });
      if (result.sourcePayloadStored) setSavedExportAvailable(true);
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The encrypted import did not complete.',
      });
    }
  }

  async function reprocessSavedExport() {
    setState({ kind: 'preparing' });
    try {
      const { prepared: next, result } =
        await reprocessLatestGlookoData();
      setState({ kind: 'success', prepared: next, result });
      const inserted = insertedRecords(result);
      showSyncNotice(
        inserted
          ? `Saved Glooko export reprocessed: ${inserted} records added.`
          : 'Saved Glooko export reprocessed; no insulin records were recognised.',
      );
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The saved Glooko export could not be reprocessed.',
      });
    }
  }

  function confirmClear() {
    Alert.alert(
      'Remove imported Glooko data?',
      'This deletes all imported basal, bolus, pump carbohydrate/context records and import history from Daymark. Personal glucose and manual entries are kept.',
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
                  removed.basal + removed.boluses + removed.context;
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
                  error instanceof Error
                    ? error.message
                    : 'Imported data could not be removed.',
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
      'Forget the Glooko sign-in?',
      'This clears Glooko web cookies held inside this app. Imported insulin stays on this device, but the next sync will ask you to sign in again.',
      [
        { text: 'Keep sign-in', style: 'cancel' },
        {
          text: 'Forget sign-in',
          style: 'destructive',
          onPress: () => {
            setForgettingSession(true);
            setClearMessage(undefined);
            void DaymarkGlookoExport.clearSessionAsync()
              .then(() =>
                setClearMessage(
                  'Glooko sign-in cleared. Imported records were kept.',
                ),
              )
              .catch((error) =>
                setClearMessage(
                  error instanceof Error
                    ? error.message
                    : 'The Glooko sign-in could not be cleared.',
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
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]}>
              Glooko insulin sync
            </Text>
            <View
              style={[
                styles.tag,
                {
                  backgroundColor: `${colors.warning}16`,
                  borderColor: `${colors.warning}55`,
                },
              ]}
            >
              <Text style={[styles.tagText, { color: colors.warning }]}>
                DELAYED
              </Text>
            </View>
          </View>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Sign into Glooko once on its own secure page. A 30-day export is
            retained in encrypted storage and supported records are normalised
            on this phone. The retained web session makes later syncs quicker.
          </Text>
        </View>
      </View>

      {state.kind === 'preparing' ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.loading, { backgroundColor: colors.surfaceMuted }]}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Reading and normalising the delayed export locally…
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
            <Metric
              label="Basal"
              value={prepared.preview.basal.length}
            />
            <Metric
              label="Bolus"
              value={prepared.preview.boluses.length}
            />
            <Metric
              label="Context"
              value={prepared.preview.context.length}
            />
            <Metric
              label="Skipped"
              value={
                prepared.preview.skippedRows +
                prepared.preview.duplicateRows
              }
            />
          </View>
          <Text style={[styles.fileMeta, { color: colors.textTertiary }]}>
            {prepared.preview.recognisedFiles.length} recognised CSV
            {prepared.preview.recognisedFiles.length === 1 ? '' : 's'} ·{' '}
            {prepared.preview.retainedFiles.length} source file
            {prepared.preview.retainedFiles.length === 1 ? '' : 's'} retained
            {' · '}
            {prepared.preview.ignoredFiles.length} unrecognised file
            {prepared.preview.ignoredFiles.length === 1 ? '' : 's'} not parsed
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
                    style={[styles.warningText, { color: colors.textSecondary }]}
                  >
                    {warning}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={[styles.caveat, { color: colors.textSecondary }]}>
            Pump records remain labelled delayed. Importing them does not mean
            the pump is currently connected.
          </Text>
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
              {totalRecords(state.prepared) === 0 &&
              state.result.sourcePayloadStored
                ? 'Export saved — insulin not recognised yet'
                : insertedRecords(state.result)
                  ? state.result.alreadyImported
                    ? 'Saved export reprocessed'
                    : 'Encrypted import complete'
                  : state.result.alreadyImported
                    ? 'This exact export was already imported'
                    : 'Encrypted import complete'}
            </Text>
            <Text style={[styles.resultBody, { color: colors.textSecondary }]}>
              {totalRecords(state.prepared) === 0
                ? 'The download worked, but no basal, bolus or context rows matched a supported Glooko table.'
                : `${state.result.insertedBasal} basal, ${state.result.insertedBoluses} bolus and ${state.result.insertedContext} context records added${
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
                  Not recognised: {file.name}
                  {file.headers.length
                    ? ` (${file.headers.slice(0, 5).join(' · ')})`
                    : ''}
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
                      Read {file.name}: {file.records} records,{' '}
                      {file.skippedRows} rows skipped
                    </Text>
                  ))
              : null}
            {totalRecords(state.prepared) === 0 &&
            state.prepared.preview.retainedFiles.length ? (
              <Text style={[styles.resultHint, { color: colors.textTertiary }]}>
                Retained without normalising:{' '}
                {state.prepared.preview.retainedFiles
                  .slice(0, 3)
                  .map((file) => file.name)
                  .join(', ')}
              </Text>
            ) : null}
            {state.result.sourcePayloadStored ? (
              <Text style={[styles.resultHint, { color: colors.textTertiary }]}>
                The complete original export is retained in encrypted storage
                on this device, including files not yet normalised.
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
              Export not ready to import
            </Text>
            <Text style={[styles.resultBody, { color: colors.textSecondary }]}>
              {state.message}
            </Text>
            {state.diagnostic ? (
              <Text style={[styles.resultHint, { color: colors.textTertiary }]}>
                Connector details from this attempt are saved below.
              </Text>
            ) : null}
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
              backgroundColor:
                canImport(prepared) ? colors.primary : colors.surfaceMuted,
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
              ? 'Importing securely…'
              : count
                ? `Import ${count} records`
                : prepared.sourcePayload
                  ? 'Retain complete source export'
                  : 'No supported records'}
          </Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={state.kind === 'preparing'}
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
              {state.kind === 'success'
                ? 'Sync Glooko again'
                : 'Sync last 30 days from Glooko'}
            </Text>
          </Pressable>
          <Text style={[styles.syncFootnote, { color: colors.textTertiary }]}>
            Every new sync now uses the corrected measured-size archive parser
            automatically. Re-reading is kept only as a recovery tool for an
            export saved by an older build.
          </Text>
          {savedExportAvailable ? (
            <Pressable
              accessibilityRole="button"
              disabled={state.kind === 'preparing'}
              onPress={() => void reprocessSavedExport()}
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
                Re-read saved export on this phone
              </Text>
            </Pressable>
          ) : null}
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
              Or choose an existing ZIP or CSV
            </Text>
          </Pressable>
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

      {lastTrace ? (
        <View
          style={[
            styles.traceArea,
            {
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showTrace }}
            onPress={() => setShowTrace((visible) => !visible)}
            style={({ pressed }) => [
              styles.traceButton,
              { opacity: pressed ? 0.65 : 1 },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.textSecondary}
              name="pulse-outline"
              size={17}
            />
            <View style={styles.traceButtonCopy}>
              <Text style={[styles.traceTitle, { color: colors.textSecondary }]}>
                Last connector details
              </Text>
              <Text style={[styles.traceHint, { color: colors.textTertiary }]}>
                Timings and stages only — no credentials or health values
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={colors.textTertiary}
              name={showTrace ? 'chevron-up' : 'chevron-down'}
              size={17}
            />
          </Pressable>
          {showTrace ? (
            <Text
              selectable
              style={[
                styles.diagnosticText,
                {
                  backgroundColor: colors.surfaceMuted,
                  color: colors.textSecondary,
                },
              ]}
            >
              {lastTrace}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.removeArea, { borderTopColor: colors.divider }]}>
        <Pressable
          accessibilityRole="button"
          disabled={
            forgettingSession ||
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
          <Text
            style={[styles.sessionText, { color: colors.textSecondary }]}
          >
            {forgettingSession
              ? 'Forgetting sign-in…'
              : 'Forget saved Glooko sign-in'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={
            clearing ||
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  tag: {
    minHeight: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  tagText: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
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
  caveat: {
    fontSize: 10,
    lineHeight: 16,
    fontStyle: 'italic',
    marginTop: 11,
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
  diagnosticText: {
    fontSize: 9,
    lineHeight: 14,
    marginHorizontal: 10,
    marginBottom: 10,
    padding: 9,
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
