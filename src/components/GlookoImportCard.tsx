import Ionicons from "@expo/vector-icons/Ionicons";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from "react-native";

import T1ArcGlookoExport, {
  GlookoCredentialStatus,
} from "../../modules/t1arc-glooko-export";
import { planNextGlookoBackfill } from "@/data/glooko/glookoBackfill";
import {
  needsGlookoExistingDataBindingConfirmation,
  runSavedGlookoConnectionCheck,
} from "@/data/glooko/glookoCredentialVerification";
import { hasImportedGlookoData } from "@/data/glooko/glookoSyncState";
import { glookoFailureDisposition } from "@/data/glooko/glookoSyncPolicy";
import {
  glookoCredentialConnectionState,
  presentGlookoFailure,
  presentGlookoSyncState,
} from "@/data/glooko/glookoSyncPresentation";
import {
  PreparedGlookoImport,
  prepareGlookoImport,
} from "@/data/import/glookoImport";
import {
  type GlookoImportRegionalSettings,
  previewDateRange,
} from "@/data/import/glookoCsv";
import {
  defaultGlookoManualFileSettings,
  glookoDateOrderLabel,
  snapshotGlookoImportRegionalSettings,
} from "@/data/import/glookoManualFileSettings";
import {
  GlookoImportSourceCommitGuard,
  releasePreparedGlookoImportSource,
} from "@/data/import/glookoImportLifecycle";
import {
  ImportWriteResult,
  StoredImportSourceSummary,
} from "@/data/persistence/HealthRecordStore";
import {
  addDays,
  formatDate,
  toDateKey,
} from "@/domain/time";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { isIanaTimeZone } from "@/domain/regionalProfile";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";
import {
  acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

import { SectionCard } from "./SectionCard";
import { GlookoPumpReportPanel } from "./GlookoPumpReportPanel";
import {
  dateKeyFromPickerDate,
  pickerDateForDateKey,
} from "./zonedDateTimePicker";

type ImportState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | {
      kind: "preview";
      prepared: PreparedGlookoImport;
      writeLease: LocalDataWriteLease;
    }
  | {
      kind: "importing";
      prepared: PreparedGlookoImport;
      writeLease: LocalDataWriteLease;
    }
  | {
      kind: "success";
      prepared: PreparedGlookoImport;
      result: ImportWriteResult;
      mode?: "quiet" | "direct" | "manual-file";
    }
  | { kind: "error"; message: string; diagnostic?: string };

type CredentialLoadState = "loading" | "ready" | "unavailable";

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
  const range = previewDateRange(prepared.preview);
  if (!range) return "No data range";
  const timeZone = prepared.preview.regionalSettings.timeZone;
  return `${formatDate(range.start, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }, timeZone)} – ${formatDate(range.end, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }, timeZone)}`;
}

function showSyncNotice(message: string) {
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.LONG);
  }
}

export function GlookoImportCard() {
  const { colors, radius } = useAppTheme();
  const { defaults: regionalDefaults } = useRegionalProfile();
  const [manualTimeZone, setManualTimeZone] = useState(
    () => defaultGlookoManualFileSettings(regionalDefaults).timeZone,
  );
  const [manualDateOrder, setManualDateOrder] = useState<
    GlookoImportRegionalSettings["dateOrder"]
  >(() => defaultGlookoManualFileSettings(regionalDefaults).dateOrder);
  const {
    clearImportedGlookoData,
    dataMode,
    glookoSyncing,
    glookoSyncState,
    getGlookoArchiveSummary,
    importGlookoData,
    beginGlookoCredentialSetup,
    markGlookoCredentialsReady,
    markGlookoSessionForgotten,
    now,
    revision,
    setGlookoHistoryBackfillTarget,
    syncGlooko,
    syncGlookoQuietly,
    syncGlookoReport,
  } = useDataContext();
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const [clearing, setClearing] = useState(false);
  const [forgettingSession, setForgettingSession] = useState(false);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialStatus, setCredentialStatus] =
    useState<GlookoCredentialStatus>({
      configured: false,
      credentialGeneration: 0,
    });
  const [credentialLoadState, setCredentialLoadState] =
    useState<CredentialLoadState>("loading");
  const [clearMessage, setClearMessage] = useState<string>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [archiveSummary, setArchiveSummary] =
    useState<StoredImportSourceSummary>();
  const [sourceCommitGuard] = useState(
    () => new GlookoImportSourceCommitGuard(),
  );
  const credentialStatusRequest = useRef(0);
  const prepared =
    state.kind === "preview" ||
    state.kind === "importing" ||
    state.kind === "success"
      ? state.prepared
      : undefined;
  const manualFilePrepared =
    state.kind === "preview" || state.kind === "importing"
      ? state.prepared
      : state.kind === "success" && state.mode === "manual-file"
        ? state.prepared
        : undefined;
  const manualSettingsLocked =
    state.kind === "preparing" || manualFilePrepared !== undefined;
  const manualTimeZoneValue = manualTimeZone.trim();
  const manualTimeZoneValid = isIanaTimeZone(manualTimeZoneValue);
  const displayedManualTimeZone =
    manualFilePrepared?.preview.regionalSettings.timeZone ?? manualTimeZone;
  const displayedManualDateOrder =
    manualFilePrepared?.preview.regionalSettings.dateOrder ?? manualDateOrder;
  const preparedWriteLease =
    state.kind === 'preview' || state.kind === 'importing'
      ? state.writeLease
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
  const automaticNeedsAttention = syncPresentation.tone === "attention";
  const credentialStatusReady = credentialLoadState === "ready";
  const credentialConfigured =
    credentialStatusReady && credentialStatus.configured;
  const credentialConnection = glookoCredentialConnectionState(
    credentialLoadState,
    credentialStatus.configured,
    glookoSyncState,
  );
  const credentialConnected = credentialConnection === "connected";
  const automaticActionRequired =
    glookoFailureDisposition(glookoSyncState.lastErrorCode) ===
    "action-required";
  const savedConnectionActionLabel =
    glookoSyncState.verifiedAccountFingerprint === undefined &&
    !automaticActionRequired
      ? "Verify saved connection"
      : glookoSyncState.sessionStatus === "pending-verification"
        ? automaticActionRequired
          ? "Retry saved connection"
          : "Verify saved connection"
        : automaticActionRequired
          ? "Retry saved connection"
          : "Check saved connection";
  const earliestKnownGlookoDate =
    archiveSummary?.dataStart !== undefined
      ? toDateKey(
          archiveSummary.dataStart,
          credentialConfigured && credentialStatus.timeZone
            ? credentialStatus.timeZone
            : regionalDefaults.timeZone,
        )
      : archiveSummary?.archiveCount
        ? addDays(
            toDateKey(
              now,
              credentialConfigured && credentialStatus.timeZone
                ? credentialStatus.timeZone
                : regionalDefaults.timeZone,
            ),
            -29,
          )
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
    const request = ++credentialStatusRequest.current;
    void T1ArcGlookoExport.getCredentialStatusAsync()
      .then((status) => {
        if (!active || request !== credentialStatusRequest.current) return;
        setCredentialStatus(status);
        setCredentialLoadState("ready");
      })
      .catch(() => {
        if (!active || request !== credentialStatusRequest.current) return;
        setCredentialLoadState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [revision]);

  async function retryCredentialStatus() {
    const request = ++credentialStatusRequest.current;
    setCredentialLoadState("loading");
    setClearMessage(undefined);
    try {
      const status = await T1ArcGlookoExport.getCredentialStatusAsync();
      if (request !== credentialStatusRequest.current) return;
      setCredentialStatus(status);
      setCredentialLoadState("ready");
    } catch {
      if (request !== credentialStatusRequest.current) return;
      setCredentialLoadState("unavailable");
    }
  }

  async function setUpAutomaticSignIn() {
    setCredentialBusy(true);
    setClearMessage(undefined);
    let releaseCredentialBarrier: (() => void) | undefined;
    try {
      releaseCredentialBarrier = await beginGlookoCredentialSetup();
      const existingDataBindingRequired =
        needsGlookoExistingDataBindingConfirmation(
          glookoSyncState,
          await hasImportedGlookoData(),
        );
      const result = await T1ArcGlookoExport.openCredentialSetupAsync(
        existingDataBindingRequired,
      );
      const status = await T1ArcGlookoExport.getCredentialStatusAsync();
      setCredentialStatus(status);
      setCredentialLoadState("ready");
      if (result.status === "saved") {
        const verificationPromise = markGlookoCredentialsReady(
          result.credentialGeneration,
          result.existingDataBindingApproved,
        );
        // The saved generation's fresh run is now reserved behind the setup
        // barrier, so releasing cannot let an older account re-enter first.
        releaseCredentialBarrier();
        releaseCredentialBarrier = undefined;
        const verification = await verificationPromise;
        if (verification.status === "success") {
          showSyncNotice("Glooko is connected. Automatic updates are on.");
        } else {
          const message =
            verification.status === "skipped"
              ? "The sign-in was saved, but another Glooko check is already running."
              : presentGlookoFailure(verification.reason);
          setClearMessage(message);
          showSyncNotice(
            "Your sign-in was saved, but T1 Arc could not confirm the connection. Open Glooko from the menu to try again.",
          );
        }
      }
    } catch {
      setCredentialLoadState("unavailable");
      setClearMessage(
        "T1 Arc could not save the Glooko connection. Check the details and try again.",
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
        trace = (await T1ArcGlookoExport.getLastTraceAsync()) ?? undefined;
      } catch {
        // The connector result remains usable without its diagnostic trace.
      }
    }
    return trace;
  }

  async function readPreparedExport(
    fileName: string,
    uri: string,
    settings: GlookoImportRegionalSettings,
  ) {
    const cachedFile = new File(uri);
    let bytes: Uint8Array | undefined;
    let transferred = false;
    try {
      bytes = await cachedFile.bytes();
      const next = await prepareGlookoImport(
        fileName,
        bytes,
        Date.now(),
        settings,
      );
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
    setState({ kind: "preparing" });
    let connectorDiagnostic: string | undefined;
    try {
      const outcome = await syncGlooko();
      connectorDiagnostic = await refreshLastTrace(
        "diagnostic" in outcome ? outcome.diagnostic : undefined,
      );
      if (outcome.status !== "success") {
        setState({
          kind: "error",
          message:
            outcome.status === "skipped"
              ? "Glooko refresh is already being handled."
              : presentGlookoFailure(outcome.reason),
          diagnostic: connectorDiagnostic,
        });
        showSyncNotice(
          "Glooko did not update. Open Glooko from the menu to try again.",
        );
        return;
      }
      // One user action checks both supported Glooko histories. A report
      // failure must not discard a successful glucose/insulin update; the
      // pump-history card will continue to show its last valid report.
      await syncGlookoReport().catch(() => undefined);
      setState({
        kind: "success",
        prepared: outcome.prepared,
        result: outcome.result,
        mode: "direct",
      });
      const inserted = insertedRecords(outcome.result);
      showSyncNotice(
        inserted
          ? `Glooko updated: ${formatRegionalNumber(inserted, regionalDefaults.locale, { maximumFractionDigits: 0 })} new items added.`
          : outcome.result.alreadyImported
            ? "This Glooko file was already added."
            : outcome.result.sourcePayloadStored
              ? "The Glooko file was saved, but T1 Arc did not find any data it understands."
              : "Glooko is up to date.",
      );
    } catch {
      connectorDiagnostic = await refreshLastTrace(connectorDiagnostic);
      setState({
        kind: "error",
        message: "Glooko did not finish updating. Try again in a moment.",
        diagnostic: connectorDiagnostic,
      });
      showSyncNotice(
        "Glooko did not update. Open Glooko from the menu to try again.",
      );
    }
  }

  async function testAutomaticGlookoRefresh() {
    if (!credentialStatusReady) return;
    setState({ kind: "preparing" });
    let connectorDiagnostic: string | undefined;
    try {
      const outcome = await runSavedGlookoConnectionCheck(
        credentialStatus,
        glookoSyncState,
        markGlookoCredentialsReady,
        syncGlookoQuietly,
      );
      connectorDiagnostic = await refreshLastTrace(
        "diagnostic" in outcome ? outcome.diagnostic : undefined,
      );
      if (outcome.status !== "success") {
        setState({
          kind: "error",
          message:
            outcome.status === "skipped"
              ? "Glooko refresh is already being handled."
              : presentGlookoFailure(outcome.reason),
          diagnostic: connectorDiagnostic,
        });
        showSyncNotice(
          outcome.status === "skipped"
            ? "Another Glooko refresh is already running."
            : presentGlookoFailure(outcome.reason),
        );
        return;
      }
      setState({
        kind: "success",
        prepared: outcome.prepared,
        result: outcome.result,
        mode: "quiet",
      });
      const inserted = insertedRecords(outcome.result);
      showSyncNotice(
        inserted
          ? `Glooko updated: ${formatRegionalNumber(inserted, regionalDefaults.locale, { maximumFractionDigits: 0 })} new items added.`
          : "Glooko is connected and ready for automatic updates.",
      );
    } catch {
      connectorDiagnostic = await refreshLastTrace(connectorDiagnostic);
      setState({
        kind: "error",
        message:
          "The saved Glooko connection could not be checked. Try again in a moment.",
        diagnostic: connectorDiagnostic,
      });
      showSyncNotice(
        "Glooko did not update. Open Glooko from the menu to try again.",
      );
    }
  }

  function chooseAutomaticBackfillTarget() {
    if (!backfillRange || !earliestKnownGlookoDate) return;
    const currentTarget =
      glookoSyncState.historyBackfillTargetDate ??
      addDays(backfillRange.startDate, -365);
    DateTimePickerAndroid.open({
      value: pickerDateForDateKey(currentTarget),
      mode: "date",
      minimumDate: pickerDateForDateKey("2000-01-01"),
      maximumDate: pickerDateForDateKey(backfillRange.endDate),
      onChange: (event, selected) => {
        if (event.type !== "set" || !selected) return;
        const targetDate = dateKeyFromPickerDate(selected);
        const label = formatDate(targetDate, {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        Alert.alert(
          "Build history back to this date?",
          `T1 Arc will work backwards to ${label}, adding one older period each day. Recent updates stay the priority, and the process pauses if Glooko asks you to sign in again.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Start automatic history",
              onPress: () => {
                void setGlookoHistoryBackfillTarget(
                  targetDate,
                  earliestKnownGlookoDate,
                ).then(() => {
                  showSyncNotice(
                    "Automatic Glooko history is now working in the background.",
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
      "Stop automatic history?",
      "History already added stays securely on this phone. You can continue from the same point later.",
      [
        { text: "Keep running", style: "cancel" },
        {
          text: "Stop",
          style: "destructive",
          onPress: () => {
            void setGlookoHistoryBackfillTarget(undefined);
          },
        },
      ],
    );
  }

  async function chooseExport() {
    if (!manualTimeZoneValid || manualSettingsLocked) return;
    const settings = snapshotGlookoImportRegionalSettings({
      timeZone: manualTimeZoneValue,
      dateOrder: manualDateOrder,
    });
    setState({ kind: "preparing" });
    try {
      const writeLease = await acquireLocalDataWriteLease();
      const selected = await DocumentPicker.getDocumentAsync({
        type: [
          "application/zip",
          "application/x-zip-compressed",
          "text/csv",
          "text/comma-separated-values",
          "application/octet-stream",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selected.canceled) {
        setState({ kind: "idle" });
        return;
      }
      const asset = selected.assets[0];
      if (!asset) throw new Error("No export file was selected.");
      const next = await readPreparedExport(asset.name, asset.uri, settings);
      setState({ kind: "preview", prepared: next, writeLease });
    } catch {
      setState({
        kind: "error",
        message:
          "T1 Arc could not safely read this Glooko file. Choose a fresh download from Glooko and try again.",
      });
    }
  }

  function resetManualFileImport() {
    if (state.kind === "importing") return;
    setState({ kind: "idle" });
  }

  function useCurrentRegionalFileDefaults() {
    if (manualSettingsLocked) return;
    const defaults = defaultGlookoManualFileSettings(regionalDefaults);
    setManualTimeZone(defaults.timeZone);
    setManualDateOrder(defaults.dateOrder);
  }

  function commitImport() {
    if (!prepared || !canImport(prepared)) return;
    const settings = prepared.preview.regionalSettings;
    const dateOrder = glookoDateOrderLabel(settings.dateOrder);
    Alert.alert(
      "Confirm this Glooko data",
      `This file must belong to the same person as any Glooko data already in T1 Arc, or be the first Glooko data added. Its times will stay interpreted in ${settings.timeZone} and its numeric dates as ${dateOrder}, exactly as shown in this preview.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm and import",
          onPress: () => void commitConfirmedImport(),
        },
      ],
    );
  }

  async function commitConfirmedImport() {
    if (!prepared || !preparedWriteLease || !canImport(prepared)) return;
    sourceCommitGuard.begin(prepared);
    setState({
      kind: "importing",
      prepared,
      writeLease: preparedWriteLease,
    });
    try {
      const result = await importGlookoData(prepared, {
        samePersonOrFirstGlookoDataConfirmed: true,
        regionalTimestampFormatConfirmed: true,
      }, preparedWriteLease);
      setState({
        kind: "success",
        prepared: releasePreparedGlookoImportSource(prepared),
        result,
        mode: "manual-file",
      });
    } catch (error) {
      if (isLocalDataWriteSupersededError(error)) {
        setState({ kind: 'idle' });
        return;
      }
      setState({
        kind: "error",
        message:
          "T1 Arc could not add this Glooko data. Nothing was changed. Try a fresh download from Glooko.",
      });
    } finally {
      sourceCommitGuard.finish(prepared);
    }
  }

  function confirmClear() {
    Alert.alert(
      "Remove imported Glooko data?",
      "This removes Glooko glucose, basal insulin, bolus insulin, pump carbs and notes from T1 Arc. Libre history and anything entered by hand are kept.",
      [
        { text: "Keep data", style: "cancel" },
        {
          text: "Remove imported data",
          style: "destructive",
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
                setState({ kind: "idle" });
                setClearMessage(
                  records
                    ? `${formatRegionalNumber(records, regionalDefaults.locale, { maximumFractionDigits: 0 })} imported records and ${formatRegionalNumber(removed.batches, regionalDefaults.locale, { maximumFractionDigits: 0 })} import ${removed.batches === 1 ? "batch" : "batches"} removed.`
                    : "There were no imported Glooko records to remove.",
                );
              })
              .catch((error) => {
                setClearMessage(
                  "Imported Glooko data could not be removed. Try again.",
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
      "Remove the Glooko sign-in?",
      "This removes the saved Glooko connection from this phone. Glucose and insulin already added to T1 Arc are kept.",
      [
        { text: "Keep sign-in", style: "cancel" },
        {
          text: "Remove sign-in",
          style: "destructive",
          onPress: () => {
            setForgettingSession(true);
            setClearMessage(undefined);
            void Promise.all([
              T1ArcGlookoExport.clearSessionAsync(),
              T1ArcGlookoExport.clearReportArtifactsAsync(),
            ])
              .then(async ([sessionCleared, artifactsCleared]) => {
                if (!sessionCleared || !artifactsCleared) {
                  throw new Error(
                    "The private Glooko data was not fully cleared.",
                  );
                }
                await markGlookoSessionForgotten();
                const status =
                  await T1ArcGlookoExport.getCredentialStatusAsync();
                setCredentialStatus(status);
                setCredentialLoadState("ready");
                setClearMessage(
                  "Encrypted Glooko sign-in removed. Imported records were kept.",
                );
              })
              .catch(() => {
                setCredentialLoadState("unavailable");
                setClearMessage(
                  "The saved Glooko connection could not be removed. Try again.",
                );
              })
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
          <Text style={[styles.title, { color: colors.text }]}>
            Automatic history
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Connect once. T1 Arc then keeps glucose, insulin and pump history up
            to date in the background.
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
          accessible
          accessibilityLabel={
            credentialConnection === "loading"
              ? "Checking saved Glooko connection"
              : credentialConnection === "unavailable"
                ? "Saved Glooko connection status unavailable"
                : credentialConnection === "connected"
                  ? "Glooko is connected"
                  : credentialConnection === "saved"
                    ? "Glooko sign-in is saved but not verified"
                    : credentialConnection === "needs-attention"
                      ? "Glooko sign-in needs attention"
                      : "Glooko is not connected"
          }
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: credentialLoadState === "loading" }}
          style={[
            styles.credentialPanel,
            {
              borderBottomColor: credentialConfigured
                ? colors.divider
                : "transparent",
            },
          ]}
        >
          <View
            style={[
              styles.credentialIcon,
              {
                backgroundColor:
                  credentialConnection === "loading"
                    ? colors.surface
                    : credentialConnection === "unavailable"
                      ? `${colors.warning}18`
                      : credentialConnected
                        ? `${colors.accent}18`
                        : `${colors.warning}18`,
              },
            ]}
          >
            {credentialLoadState === "loading" ? (
              <ActivityIndicator
                accessibilityElementsHidden
                color={colors.textTertiary}
                size="small"
              />
            ) : (
              <Ionicons
                accessibilityElementsHidden
                color={credentialConnected ? colors.accent : colors.warning}
                name={
                  credentialConnection === "unavailable" ||
                  credentialConnection === "needs-attention"
                    ? "alert-circle-outline"
                    : credentialConnected
                      ? "shield-checkmark-outline"
                      : "lock-closed-outline"
                }
                size={17}
              />
            )}
          </View>
          <View style={styles.credentialCopy}>
            <Text style={[styles.credentialTitle, { color: colors.text }]}>
              {credentialBusy
                ? "Importing Glooko history"
                : credentialConnection === "loading"
                  ? "Checking connection"
                  : credentialConnection === "unavailable"
                    ? "Connection status unavailable"
                    : credentialConnection === "connected"
                      ? "Connected"
                      : credentialConnection === "saved"
                        ? "Sign-in saved"
                        : credentialConnection === "needs-attention"
                          ? "Sign-in needs attention"
                          : "Connect Glooko"}
            </Text>
            <Text
              style={[styles.credentialDetail, { color: colors.textSecondary }]}
            >
              {credentialBusy
                ? "Securely importing up to 90 days, or all the history available if there is less."
                : credentialConnection === "loading"
                  ? "Reading the saved sign-in on this phone…"
                  : credentialConnection === "unavailable"
                    ? "T1 Arc could not safely check the saved sign-in."
                    : credentialConnection === "connected"
                      ? `${credentialStatus.maskedEmail ?? "Glooko account"} · ${credentialStatus.timeZone ? `Export timezone ${credentialStatus.timeZone}` : "Export timezone unavailable"}`
                      : credentialConnection === "saved"
                        ? "Verify this saved sign-in once to start automatic updates."
                        : credentialConnection === "needs-attention"
                          ? "Check the saved sign-in before automatic updates can continue."
                          : "Sign in once and T1 Arc will keep your history current."}
            </Text>
          </View>
          {credentialLoadState === "unavailable" ? (
            <Pressable
              accessibilityLabel="Check saved Glooko connection again"
              accessibilityRole="button"
              onPress={() => void retryCredentialStatus()}
              style={({ pressed }) => [
                styles.credentialAction,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.55 : 1,
                },
              ]}
            >
              <Text
                style={[styles.credentialActionText, { color: colors.primary }]}
              >
                Try again
              </Text>
            </Pressable>
          ) : credentialStatusReady && !credentialConfigured ? (
            <Pressable
              accessibilityLabel={
                credentialBusy
                  ? "Connecting Glooko and importing up to 90 days of history"
                  : "Connect Glooko"
              }
              accessibilityRole="button"
              accessibilityState={{
                busy: credentialBusy,
                disabled: credentialBusy || glookoSyncing,
              }}
              disabled={credentialBusy || glookoSyncing}
              onPress={() => void setUpAutomaticSignIn()}
              style={({ pressed }) => [
                styles.credentialAction,
                {
                  borderColor: colors.border,
                  opacity:
                    pressed || credentialBusy || glookoSyncing ? 0.55 : 1,
                },
              ]}
            >
              {credentialBusy ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text
                  style={[
                    styles.credentialActionText,
                    { color: colors.primary },
                  ]}
                >
                  Connect
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>

        {credentialConfigured ? (
          <View style={styles.automaticTop}>
            <View style={styles.automaticCopy}>
              <Text style={[styles.automaticTitle, { color: colors.text }]}>
                {glookoSyncing
                  ? "Checking Glooko…"
                  : credentialConnection === "saved"
                    ? "Verify to start updates"
                    : automaticNeedsAttention
                      ? "Connection needs attention"
                      : glookoSyncState.dataThrough === undefined
                        ? "Ready to update"
                        : `History current through ${formatDate(
                            toDateKey(glookoSyncState.dataThrough),
                            { day: "numeric", month: "short" },
                          )}`}
              </Text>
              <Text
                style={[
                  styles.automaticDetail,
                  { color: colors.textSecondary },
                ]}
              >
                {!credentialConnected || automaticNeedsAttention
                  ? syncPresentation.message
                  : "Updates run automatically. Existing records are never added twice."}
              </Text>
            </View>
            <Ionicons
              accessibilityLabel={
                credentialConnected && !automaticNeedsAttention
                  ? "Automatic Glooko updates are on"
                  : credentialConnection === "saved"
                    ? "Automatic Glooko updates need verification"
                    : "Glooko needs attention"
              }
              color={
                credentialConnected && !automaticNeedsAttention
                  ? colors.accent
                  : colors.warning
              }
              name={
                credentialConnected && !automaticNeedsAttention
                  ? "checkmark-circle"
                  : "alert-circle-outline"
              }
              size={22}
            />
          </View>
        ) : null}
        {credentialConfigured &&
        (automaticNeedsAttention || credentialConnection === "saved") ? (
          <>
            <Pressable
              accessibilityLabel={savedConnectionActionLabel}
              accessibilityHint="Checks that T1 Arc can update from Glooko"
              accessibilityRole="button"
              accessibilityState={{
                disabled: glookoSyncing || state.kind === "preparing",
              }}
              disabled={glookoSyncing || state.kind === "preparing"}
              onPress={() => void testAutomaticGlookoRefresh()}
              style={({ pressed }) => [
                styles.quietRefreshButton,
                {
                  borderColor: colors.border,
                  opacity:
                    pressed || glookoSyncing || state.kind === "preparing"
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
                  Checks the connection and retries the update.
                </Text>
              </View>
            </Pressable>
          </>
        ) : null}
      </View>

      {state.kind === "preparing" ? (
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

      {prepared && state.kind !== "success" ? (
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
              <Text
                style={[
                  styles.importInterpretation,
                  { color: colors.textTertiary },
                ]}
              >
                {glookoDateOrderLabel(
                  prepared.preview.regionalSettings.dateOrder,
                )}{" "}
                · {prepared.preview.regionalSettings.timeZone} · fixed for this
                preview
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={canImport(prepared) ? colors.accent : colors.warning}
              name={
                canImport(prepared)
                  ? "checkmark-circle-outline"
                  : "alert-circle-outline"
              }
              size={24}
            />
          </View>
          <View style={styles.metrics}>
            <Metric label="Glucose" value={prepared.preview.glucose.length} />
            <Metric label="Basal" value={prepared.preview.basal.length} />
            <Metric label="Bolus" value={prepared.preview.boluses.length} />
            <Metric
              label="Pump notes"
              value={prepared.preview.context.length}
            />
          </View>
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

      {state.kind === "success" ? (
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
                ? "checkmark-circle"
                : "information-circle"
            }
            size={24}
          />
          <View style={styles.resultCopy}>
            <Text style={[styles.resultTitle, { color: colors.text }]}>
              {state.mode === "quiet"
                ? "Automatic update complete"
                : totalRecords(state.prepared) === 0 &&
                    state.result.sourcePayloadStored
                  ? "Glooko file saved — no data added"
                  : insertedRecords(state.result)
                    ? state.result.alreadyImported
                      ? "Saved Glooko file checked again"
                      : "Glooko data added"
                    : state.result.alreadyImported
                      ? "This Glooko file was already added"
                      : "Glooko data added"}
            </Text>
            <Text style={[styles.resultBody, { color: colors.textSecondary }]}>
              {state.mode === "quiet"
                ? insertedRecords(state.result)
                  ? `T1 Arc added ${formatRegionalNumber(insertedRecords(state.result), regionalDefaults.locale, { maximumFractionDigits: 0 })} new items and left your existing history unchanged.`
                  : "Glooko is up to date. Your existing history was left unchanged."
                : totalRecords(state.prepared) === 0
                  ? "The download worked, but T1 Arc could not find glucose or insulin data it understands."
                  : `${formatRegionalNumber(state.result.insertedGlucose, regionalDefaults.locale, { maximumFractionDigits: 0 })} glucose, ${formatRegionalNumber(state.result.insertedBasal, regionalDefaults.locale, { maximumFractionDigits: 0 })} basal, ${formatRegionalNumber(state.result.insertedBoluses, regionalDefaults.locale, { maximumFractionDigits: 0 })} bolus, ${formatRegionalNumber(state.result.insertedDailyTotals, regionalDefaults.locale, { maximumFractionDigits: 0 })} daily insulin total and ${formatRegionalNumber(state.result.insertedContext, regionalDefaults.locale, { maximumFractionDigits: 0 })} pump notes added${
                      state.result.duplicateCount
                        ? ` · ${formatRegionalNumber(state.result.duplicateCount, regionalDefaults.locale, { maximumFractionDigits: 0 })} duplicates skipped`
                        : ""
                    }.`}
            </Text>
            {dataMode === "demo" ? (
              <Text style={[styles.resultHint, { color: colors.textTertiary }]}>
                Switch to Personal glucose above to view these records beside
                your LibreLinkUp history.
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {state.kind === "error" ? (
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

      {prepared && state.kind !== "success" ? (
        <Pressable
          accessibilityLabel={
            count
              ? `Add ${formatRegionalNumber(count, regionalDefaults.locale, { maximumFractionDigits: 0 })} Glooko items`
              : prepared.sourcePayload
                ? "Save Glooko file"
                : "No Glooko data to add"
          }
          accessibilityRole="button"
          accessibilityState={{
            disabled: !canImport(prepared) || state.kind === "importing",
          }}
          disabled={!canImport(prepared) || state.kind === "importing"}
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
          {state.kind === "importing" ? (
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
            {state.kind === "importing"
              ? "Adding Glooko data…"
              : count
                ? `Add ${formatRegionalNumber(count, regionalDefaults.locale, { maximumFractionDigits: 0 })} items`
                : prepared.sourcePayload
                  ? "Save Glooko file"
                  : "No data to add"}
          </Text>
        </Pressable>
      ) : (
        <>
          {credentialConnected && !automaticNeedsAttention ? (
            <Pressable
              accessibilityLabel="Check Glooko now"
              accessibilityRole="button"
              accessibilityState={{
                busy: state.kind === "preparing" || glookoSyncing,
                disabled: state.kind === "preparing" || glookoSyncing,
              }}
              disabled={state.kind === "preparing" || glookoSyncing}
              onPress={() => void syncFromGlooko()}
              style={({ pressed }) => [
                styles.checkButton,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              {glookoSyncing ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.primary}
                  name="sync-outline"
                  size={18}
                />
              )}
              <Text style={[styles.checkButtonText, { color: colors.primary }]}>
                {glookoSyncing ? "Checking…" : "Check now"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="More Glooko options"
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
              {showAdvanced ? "Hide more options" : "More options"}
            </Text>
            <Ionicons
              accessibilityElementsHidden
              color={colors.textTertiary}
              name={showAdvanced ? "chevron-up" : "chevron-down"}
              size={17}
            />
          </Pressable>
          <GlookoPumpReportPanel showControls={showAdvanced} />
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
                    Older history
                  </Text>
                  <Text
                    style={[
                      styles.backfillBody,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Choose the earliest date once. T1 Arc will work backwards
                    automatically while keeping recent data current.
                  </Text>
                </View>
              </View>
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
                        ? "Automatic history is working"
                        : "History target reached"
                      : "Choose an earliest date"}
                  </Text>
                  <Text
                    style={[
                      styles.automaticHistoryBody,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {glookoSyncState.historyBackfillTargetDate
                      ? automaticBackfillRange
                        ? `Working back automatically to ${formatDate(
                            glookoSyncState.historyBackfillTargetDate,
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            },
                          )}.`
                        : `Complete to ${formatDate(
                            glookoSyncState.historyBackfillTargetDate,
                            {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            },
                          )}.`
                      : "T1 Arc will add older periods automatically in the background."}
                  </Text>
                </View>
                <View style={styles.automaticHistoryActions}>
                  <Pressable
                    accessibilityLabel={
                      glookoSyncState.historyBackfillTargetDate
                        ? "Change earliest Glooko history date"
                        : "Choose earliest Glooko history date"
                    }
                    accessibilityRole="button"
                    accessibilityState={{ disabled: glookoSyncing }}
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
                        ? "Change date"
                        : "Choose date"}
                    </Text>
                  </Pressable>
                  {glookoSyncState.historyBackfillTargetDate ? (
                    <Pressable
                      accessibilityLabel="Stop importing older Glooko history"
                      accessibilityRole="button"
                      accessibilityState={{ disabled: glookoSyncing }}
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
          {showAdvanced ? (
            <>
              <View
                style={[
                  styles.manualImportPanel,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Text
                  style={[styles.manualImportTitle, { color: colors.text }]}
                >
                  Import a downloaded file
                </Text>
                <Text
                  style={[
                    styles.manualImportBody,
                    { color: colors.textSecondary },
                  ]}
                >
                  Choose the clock and numeric date order used inside this
                  Glooko export. They are fixed when the preview is created, so
                  travel or later regional-setting changes cannot move records.
                </Text>
                <Text
                  style={[
                    styles.manualImportLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  Export timezone (IANA)
                </Text>
                <TextInput
                  accessibilityHint="For example Europe/London, America/New_York or Asia/Tokyo"
                  accessibilityLabel="Glooko file export timezone"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!manualSettingsLocked}
                  onChangeText={setManualTimeZone}
                  placeholder="Europe/London"
                  placeholderTextColor={colors.textTertiary}
                  spellCheck={false}
                  style={[
                    styles.manualTimeZoneInput,
                    {
                      backgroundColor: colors.surface,
                      borderColor:
                        manualTimeZoneValid || manualSettingsLocked
                          ? colors.border
                          : colors.danger,
                      color: colors.text,
                      opacity: manualSettingsLocked ? 0.72 : 1,
                    },
                  ]}
                  value={displayedManualTimeZone}
                />
                {!manualTimeZoneValid && !manualSettingsLocked ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.manualImportError, { color: colors.danger }]}
                  >
                    Enter a valid IANA timezone before choosing a file.
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.manualImportLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  Numeric dates in the file
                </Text>
                <View style={styles.manualDateOrderRow}>
                  {(["day-first", "month-first"] as const).map(
                    (dateOrder) => {
                      const selected =
                        displayedManualDateOrder === dateOrder;
                      return (
                        <Pressable
                          accessibilityLabel={glookoDateOrderLabel(dateOrder)}
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked: selected,
                            disabled: manualSettingsLocked,
                          }}
                          disabled={manualSettingsLocked}
                          key={dateOrder}
                          onPress={() => setManualDateOrder(dateOrder)}
                          style={({ pressed }) => [
                            styles.manualDateOrderOption,
                            {
                              backgroundColor: selected
                                ? `${colors.primary}16`
                                : colors.surface,
                              borderColor: selected
                                ? colors.primary
                                : colors.border,
                              borderRadius: radius.sm,
                              opacity:
                                manualSettingsLocked || pressed ? 0.72 : 1,
                            },
                          ]}
                        >
                          <Ionicons
                            accessibilityElementsHidden
                            color={
                              selected ? colors.primary : colors.textTertiary
                            }
                            name={
                              selected
                                ? "radio-button-on"
                                : "radio-button-off"
                            }
                            size={17}
                          />
                          <Text
                            style={[
                              styles.manualDateOrderText,
                              {
                                color: selected
                                  ? colors.primary
                                  : colors.textSecondary,
                              },
                            ]}
                          >
                            {glookoDateOrderLabel(dateOrder)}
                          </Text>
                        </Pressable>
                      );
                    },
                  )}
                </View>
                <Pressable
                  accessibilityLabel="Use current T1 Arc regional defaults for this Glooko file"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: manualSettingsLocked }}
                  disabled={manualSettingsLocked}
                  onPress={useCurrentRegionalFileDefaults}
                  style={({ pressed }) => [
                    styles.manualDefaultsButton,
                    { opacity: manualSettingsLocked || pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text
                    style={[
                      styles.manualDefaultsText,
                      { color: colors.textTertiary },
                    ]}
                  >
                    Use current regional defaults
                  </Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityLabel="Import a Glooko ZIP or CSV"
                accessibilityRole="button"
                accessibilityState={{
                  disabled: manualSettingsLocked || !manualTimeZoneValid,
                }}
                disabled={manualSettingsLocked || !manualTimeZoneValid}
                onPress={() => void chooseExport()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  {
                    opacity:
                      pressed || manualSettingsLocked || !manualTimeZoneValid
                        ? 0.6
                        : 1,
                  },
                ]}
              >
                <Text style={[styles.secondaryText, { color: colors.primary }]}>
                  Import a Glooko ZIP or CSV
                </Text>
              </Pressable>
              {credentialConfigured ? (
                <Pressable
                  accessibilityLabel="Change Glooko connection"
                  accessibilityRole="button"
                  accessibilityState={{
                    busy: credentialBusy,
                    disabled: credentialBusy || glookoSyncing,
                  }}
                  disabled={credentialBusy || glookoSyncing}
                  onPress={() => void setUpAutomaticSignIn()}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      opacity:
                        pressed || credentialBusy || glookoSyncing ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[styles.secondaryText, { color: colors.primary }]}
                  >
                    Change Glooko connection
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </>
      )}

      {manualFilePrepared ? (
        <Pressable
          accessibilityLabel="Change Glooko file or its interpretation settings"
          accessibilityRole="button"
          accessibilityState={{ disabled: state.kind === "importing" }}
          disabled={state.kind === "importing"}
          onPress={resetManualFileImport}
          style={({ pressed }) => [
            styles.secondaryButton,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.secondaryText, { color: colors.primary }]}>
            Change file or interpretation
          </Text>
        </Pressable>
      ) : null}

      {showAdvanced ? (
        <View style={[styles.removeArea, { borderTopColor: colors.divider }]}>
          <Pressable
            accessibilityLabel="Remove saved Glooko sign-in"
            accessibilityRole="button"
            accessibilityState={{
              busy: forgettingSession,
              disabled:
                !credentialStatusReady ||
                forgettingSession ||
                glookoSyncing ||
                state.kind === "preparing" ||
                state.kind === "importing",
            }}
            disabled={
              !credentialStatusReady ||
              forgettingSession ||
              glookoSyncing ||
              state.kind === "preparing" ||
              state.kind === "importing"
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
                ? "Removing sign-in…"
                : "Remove saved Glooko sign-in"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Remove imported Glooko history"
            accessibilityRole="button"
            accessibilityState={{
              disabled:
                clearing ||
                glookoSyncing ||
                state.kind === "preparing" ||
                state.kind === "importing",
            }}
            disabled={
              clearing ||
              glookoSyncing ||
              state.kind === "preparing" ||
              state.kind === "importing"
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
              {clearing ? "Removing…" : "Remove imported Glooko data"}
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
  const { defaults: regional } = useRegionalProfile();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: colors.text }]}>
        {formatRegionalNumber(value, regional.locale, {
          maximumFractionDigits: 0,
        })}
      </Text>
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
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  icon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 5,
  },
  automaticPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 16,
  },
  credentialPanel: {
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingBottom: 12,
    marginBottom: 6,
  },
  credentialIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  credentialCopy: {
    flex: 1,
    minWidth: 0,
  },
  credentialTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  credentialDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  credentialAction: {
    minWidth: 58,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  credentialActionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  automaticTop: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  automaticCopy: {
    flex: 1,
    minWidth: 0,
  },
  automaticTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  automaticDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  quietRefreshButton: {
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 47,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 9,
    paddingTop: 9,
  },
  quietRefreshCopy: {
    flex: 1,
    minWidth: 0,
  },
  quietRefreshTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  quietRefreshDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 1,
  },
  loading: {
    minHeight: 62,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginTop: 16,
  },
  previewTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  previewCopy: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  range: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  importInterpretation: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 10,
    marginTop: 14,
  },
  metric: {
    width: "47%",
    minWidth: 0,
  },
  metricValue: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  metricLabel: {
    fontSize: 12,
    lineHeight: 17,
  },
  warningStack: {
    gap: 6,
    marginTop: 10,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  result: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
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
    fontWeight: "700",
  },
  resultBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  resultHint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  primaryButton: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 14,
  },
  primaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  checkButton: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  checkButtonText: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  advancedToggle: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingHorizontal: 13,
  },
  advancedToggleText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  manualImportPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    marginTop: 12,
    padding: 13,
  },
  manualImportTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  manualImportBody: {
    fontSize: 12,
    lineHeight: 18,
  },
  manualImportLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 3,
  },
  manualTimeZoneInput: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  manualImportError: {
    fontSize: 12,
    lineHeight: 17,
  },
  manualDateOrderRow: {
    flexDirection: "row",
    gap: 8,
  },
  manualDateOrderOption: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 8,
  },
  manualDateOrderText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  manualDefaultsButton: {
    minHeight: 44,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  manualDefaultsText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  backfillPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
    marginTop: 12,
    padding: 13,
  },
  backfillHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  backfillIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  backfillCopy: {
    flex: 1,
    minWidth: 0,
  },
  backfillTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  backfillBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
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
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  automaticHistoryBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  automaticHistoryActions: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  automaticHistoryAction: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
  },
  automaticHistoryActionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  automaticHistoryStop: {
    minWidth: 58,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  automaticHistoryStopText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  secondaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  traceArea: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    overflow: "hidden",
  },
  traceButton: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
  },
  traceButtonCopy: {
    flex: 1,
    minWidth: 0,
  },
  traceTitle: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  traceHint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 1,
  },
  removeArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 16,
  },
  sessionButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  sessionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  removeButton: {
    minHeight: 48,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  removeText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  clearMessage: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});
