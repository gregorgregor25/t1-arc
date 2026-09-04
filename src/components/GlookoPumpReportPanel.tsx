import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import T1ArcGlookoExport from "../../modules/t1arc-glooko-export";
import {
  GlookoPumpSettingsSnapshot,
  PumpSettingScheduleSegment,
} from "@/data/glooko/glookoReport";
import {
  chooseGlookoReportInbox,
  getGlookoReportInboxStatus,
  GlookoReportInboxStatus,
} from "@/data/glooko/glookoReportInbox";
import { StoredGlookoReport } from "@/data/glooko/glookoReportRepository";
import { updateGlookoReportSyncState } from "@/data/glooko/glookoReportSyncState";
import { formatGlookoPumpScheduleSegment } from "@/data/glooko/glookoReportPresentation";
import { formatDate, relativeAge, toDateKey } from "@/domain/time";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

type ReportLoadState = "loading" | "ready" | "unavailable";
type InboxLoadState = "loading" | "ready" | "unavailable";

function formatPercent(value: number | undefined, locale: string) {
  return value === undefined
    ? "—"
    : `${formatRegionalNumber(value, locale)}%`;
}

function formatBoolean(value: boolean | undefined) {
  return value === undefined ? "Not stated" : value ? "On" : "Off";
}

function scheduleText(
  segments: PumpSettingScheduleSegment[],
  regional: Parameters<typeof formatGlookoPumpScheduleSegment>[1],
) {
  return segments
    .map((segment) => formatGlookoPumpScheduleSegment(segment, regional))
    .join("\n");
}

function reportRangeFromBounds(
  reportStart: number | undefined,
  reportEnd: number | undefined,
) {
  if (reportStart === undefined || reportEnd === undefined) {
    return "Report period not stated";
  }
  return `${formatDate(toDateKey(reportStart), {
    day: "numeric",
    month: "short",
    year: "numeric",
  })} – ${formatDate(toDateKey(reportEnd - 1), {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

function reportRange(report: StoredGlookoReport) {
  return reportRangeFromBounds(
    report.preview.reportStart,
    report.preview.reportEnd,
  );
}

function SettingsDetails({
  regional,
  settings,
  sourceRange,
}: {
  regional: Parameters<typeof formatGlookoPumpScheduleSegment>[1];
  settings: GlookoPumpSettingsSnapshot;
  sourceRange?: string;
}) {
  const { colors } = useAppTheme();
  const facts = [
    ["Active CGM", settings.activeCgm],
    [
      "Active insulin time",
      settings.activeInsulinHours === undefined
        ? undefined
        : `${formatRegionalNumber(settings.activeInsulinHours, regional.locale)} hours`,
    ],
    ["Basal programme", settings.activeBasalProgram],
    [
      "Maximum basal",
      settings.maxBasalRateUnitsPerHour === undefined
        ? undefined
        : `${formatRegionalNumber(settings.maxBasalRateUnitsPerHour, regional.locale)} U/h`,
    ],
    [
      "Maximum bolus",
      settings.maxBolusUnits === undefined
        ? undefined
        : `${formatRegionalNumber(settings.maxBolusUnits, regional.locale)} U`,
    ],
    ["Temporary basal", formatBoolean(settings.temporaryBasalEnabled)],
    ["Extended bolus", formatBoolean(settings.extendedBolusEnabled)],
    ["Reverse correction", formatBoolean(settings.reverseCorrectionEnabled)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));
  const allSchedules: [string, PumpSettingScheduleSegment[]][] = [
    ["Scheduled basal", settings.basalSchedule],
    ["Insulin-to-carb ratio", settings.carbRatioSchedule],
    ["Correction sensitivity", settings.sensitivitySchedule],
    ["Target glucose", settings.targetSchedule],
    ["Correction threshold", settings.correctionThresholdSchedule],
  ];
  const schedules = allSchedules.filter((item) => item[1].length > 0);

  return (
    <View style={[styles.details, { borderTopColor: colors.divider }]}>
      <Text style={[styles.detailsHeading, { color: colors.text }]}>
        {sourceRange
          ? `Last known settings · ${sourceRange}`
          : "Settings recorded in this report"}
      </Text>
      <View style={styles.factGrid}>
        {facts.map(([label, value]) => (
          <View key={label} style={styles.fact}>
            <Text style={[styles.factLabel, { color: colors.textTertiary }]}>
              {label}
            </Text>
            <Text style={[styles.factValue, { color: colors.text }]}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      {schedules.map(([label, segments]) => (
        <View
          key={label}
          style={[styles.schedule, { borderTopColor: colors.divider }]}
        >
          <Text style={[styles.scheduleLabel, { color: colors.textSecondary }]}>
            {label}
          </Text>
          <Text style={[styles.scheduleValue, { color: colors.text }]}>
            {scheduleText(segments, regional)}
          </Text>
        </View>
      ))}
      <Text style={[styles.caveat, { color: colors.textTertiary }]}>
        These are historical settings from the report, not current pump state.
        T1 Arc never changes them.
      </Text>
    </View>
  );
}

export function GlookoPumpReportPanel({
  showControls = false,
}: {
  showControls?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const {
    getLatestGlookoReport,
    glookoReportSyncing,
    glookoReportSyncState,
    glookoSyncing,
    importGlookoReport,
    now,
    revision,
    syncGlookoReport,
  } = useDataContext();
  const [report, setReport] = useState<StoredGlookoReport>();
  const [reportLoadState, setReportLoadState] =
    useState<ReportLoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [importOptionsExpanded, setImportOptionsExpanded] = useState(false);
  const [inboxStatus, setInboxStatus] = useState<GlookoReportInboxStatus>();
  const [inboxLoadState, setInboxLoadState] =
    useState<InboxLoadState>("loading");

  useEffect(() => {
    let active = true;
    void getLatestGlookoReport()
      .then((next) => {
        if (!active) return;
        setReport(next);
        setReportLoadState("ready");
      })
      .catch(() => {
        if (active) setReportLoadState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [getLatestGlookoReport, revision]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        setInboxLoadState((current) =>
          current === "ready" ? current : "loading",
        );
      }
    });
    void getGlookoReportInboxStatus()
      .then((status) => {
        if (!active) return;
        setInboxStatus(status);
        setInboxLoadState("ready");
      })
      .catch(() => {
        if (active) setInboxLoadState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [glookoReportSyncState.inboxConfigured]);

  async function retryInboxStatus() {
    setInboxLoadState("loading");
    try {
      const status = await getGlookoReportInboxStatus();
      setInboxStatus(status);
      setInboxLoadState("ready");
    } catch {
      setInboxLoadState("unavailable");
    }
  }

  const currentReportSettings = report?.preview.settings;
  const retainedSettings = currentReportSettings
    ? undefined
    : report?.retainedSettings;
  const settings = currentReportSettings ?? retainedSettings?.settings;
  const retainedSettingsRange = retainedSettings
    ? reportRangeFromBounds(
        retainedSettings.reportStart,
        retainedSettings.reportEnd,
      )
    : undefined;

  const settingCount = useMemo(() => {
    if (!settings) return 0;
    return (
      [
        settings.activeCgm,
        settings.activeInsulinHours,
        settings.activeBasalProgram,
        settings.maxBasalRateUnitsPerHour,
        settings.temporaryBasalEnabled,
        settings.extendedBolusEnabled,
        settings.maxBolusUnits,
        settings.minimumBgForBolusCalculationMmolL,
        settings.reverseCorrectionEnabled,
        settings.glucoseHighAlertEnabled,
        settings.glucoseHighAlertLimitMmolL,
        settings.glucoseLowAlertEnabled,
        settings.glucoseLowAlertLimitMmolL,
        settings.signalLossAlertEnabled,
      ].filter((value) => value !== undefined).length +
      settings.basalSchedule.length +
      settings.carbRatioSchedule.length +
      settings.sensitivitySchedule.length +
      settings.targetSchedule.length +
      settings.correctionThresholdSchedule.length
    );
  }, [settings]);

  const timedStateCounts = useMemo(() => {
    const intervals = report?.preview.pumpStateIntervals ?? [];
    return {
      activity: intervals.filter((state) => state.kind === "activity-mode")
        .length,
      pauses: intervals.filter((state) => state.kind === "automated-pause")
        .length,
    };
  }, [report]);

  const reportNeedsRefresh = Boolean(
    report?.preview.reportEnd !== undefined &&
    report.preview.reportEnd < now - 2 * 24 * 60 * 60 * 1_000,
  );

  async function chooseReport() {
    setBusy(true);
    setMessage(undefined);
    let cachedFile: File | undefined;
    let bytes: Uint8Array | undefined;
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selected.canceled) return;
      const asset = selected.assets[0];
      if (!asset) throw new Error("No Glooko report was selected.");
      cachedFile = new File(asset.uri);
      // Android's picker cache may release its temporary copy while the
      // native PDF renderer is working. Read it before extraction so the
      // importer can finish even if Android releases the cache entry.
      bytes = await cachedFile.bytes();
      const extraction = await T1ArcGlookoExport.extractReportDataAsync(
        asset.uri,
      );
      const next = await importGlookoReport(
        asset.name,
        bytes,
        extraction.text,
        extraction.pumpTrackIntervals,
        extraction.subjectFingerprint,
      );
      setReport(next);
      setReportLoadState("ready");
      setDetailsExpanded(true);
      const activityCount = next.preview.pumpStateIntervals.filter(
        (state) => state.kind === "activity-mode",
      ).length;
      const pauseCount = next.preview.pumpStateIntervals.filter(
        (state) => state.kind === "automated-pause",
      ).length;
      setMessage(
        `Imported ${formatRegionalNumber(activityCount, regional.locale, { maximumFractionDigits: 0 })} timed Activity ${
          activityCount === 1 ? "period" : "periods"
        } and ${formatRegionalNumber(pauseCount, regional.locale, { maximumFractionDigits: 0 })} automated ${
          pauseCount === 1 ? "pause" : "pauses"
        }. Your imported pump history is now available in T1 Arc.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The Glooko pump report could not be read.",
      );
    } finally {
      bytes?.fill(0);
      try {
        if (cachedFile?.exists) cachedFile.delete();
      } catch {
        // Android may already have released the private picker copy.
      }
      if (cachedFile) {
        await T1ArcGlookoExport.releaseReportArtifactAsync(
          cachedFile.uri,
        ).catch(() => false);
      }
      setBusy(false);
    }
  }

  async function chooseReportFolder() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await chooseGlookoReportInbox();
      if ("cancelled" in result) return;
      setInboxStatus(result);
      setInboxLoadState("ready");
      await updateGlookoReportSyncState((current) => ({
        ...current,
        inboxConfigured: true,
        lastInboxSnapshot: undefined,
        nextEligibleAt: undefined,
      }));
      const outcome = await syncGlookoReport();
      if (outcome.status === "success") {
        setReport(outcome.report);
        setReportLoadState("ready");
        setMessage(
          `Imported the newest valid one-week Glooko report from ${result.folderLabel ?? "the selected folder"}.`,
        );
      } else if (outcome.status === "skipped") {
        setMessage(
          `Folder connected. Save future one-week Daily Overview PDFs in ${result.folderLabel ?? "this folder"}; T1 Arc will validate and import them automatically.`,
        );
      } else {
        setMessage(outcome.message);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The report folder could not be connected.",
      );
    } finally {
      setBusy(false);
    }
  }

  const modes = report?.preview.modeSummary;
  if (!report && !showControls) return null;

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
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
            name="options-outline"
            size={19}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Pump history
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Activity mode, automated pauses and pump settings from your Daily
            Overview.
          </Text>
        </View>
      </View>

      {reportLoadState === "loading" ? (
        <View
          accessible
          accessibilityLabel="Checking saved Glooko pump history"
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: true }}
          style={[styles.loadStatus, { borderTopColor: colors.divider }]}
        >
          <ActivityIndicator
            accessibilityElementsHidden
            color={colors.textTertiary}
            size="small"
          />
          <Text style={[styles.loadText, { color: colors.textTertiary }]}>
            Checking saved pump history…
          </Text>
        </View>
      ) : report ? (
        <>
          <View
            style={[styles.reportSummary, { borderTopColor: colors.divider }]}
          >
            <View style={styles.reportSummaryCopy}>
              <Text style={[styles.reportRange, { color: colors.text }]}>
                {reportRange(report)}
              </Text>
              <Text style={[styles.reportMeta, { color: colors.textTertiary }]}>
                {formatRegionalNumber(timedStateCounts.activity, regional.locale, { maximumFractionDigits: 0 })} activity{" "}
                {timedStateCounts.activity === 1 ? "period" : "periods"} ·{" "}
                {formatRegionalNumber(timedStateCounts.pauses, regional.locale, { maximumFractionDigits: 0 })} automated{" "}
                {timedStateCounts.pauses === 1 ? "pause" : "pauses"}
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name="shield-checkmark-outline"
              size={19}
            />
          </View>
          <Pressable
            accessibilityLabel={
              detailsExpanded
                ? "Hide Glooko pump report details"
                : "View Glooko pump report details"
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsExpanded }}
            onPress={() => setDetailsExpanded((value) => !value)}
            style={({ pressed }) => [
              styles.detailsToggle,
              {
                borderTopColor: colors.divider,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Text style={[styles.detailsToggleText, { color: colors.primary }]}>
              {detailsExpanded ? "Hide report details" : "View report details"}
            </Text>
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name={detailsExpanded ? "chevron-up" : "chevron-down"}
              size={17}
            />
          </Pressable>
          {detailsExpanded ? (
            <View style={styles.reportDetails}>
              <Text style={[styles.reportMeta, { color: colors.textTertiary }]}>
                Added {relativeAge(report.importedAt, now)}
                {currentReportSettings
                  ? ` · ${formatRegionalNumber(settingCount, regional.locale, { maximumFractionDigits: 0 })} settings and schedule entries`
                  : retainedSettings
                    ? ` · Last-known settings from ${retainedSettingsRange}`
                    : " · No settings page in this report"}
              </Text>
              {modes ? (
                <View style={styles.modeGrid}>
                  <ModeFact
                    label="Automated"
                    value={formatPercent(modes.automatedPercent, regional.locale)}
                  />
                  <ModeFact
                    label="Activity"
                    value={formatPercent(modes.activityPercent, regional.locale)}
                  />
                  <ModeFact
                    label="Limited"
                    value={formatPercent(modes.limitedPercent, regional.locale)}
                  />
                  <ModeFact
                    label="Manual"
                    value={formatPercent(modes.manualPercent, regional.locale)}
                  />
                </View>
              ) : null}
              {settings ? (
                <SettingsDetails
                  regional={regional}
                  settings={settings}
                  sourceRange={retainedSettingsRange}
                />
              ) : null}
              {report.preview.warnings.length > 0 ? (
                <View
                  style={[
                    styles.reportNotice,
                    {
                      backgroundColor: `${colors.warning}12`,
                      borderColor: `${colors.warning}45`,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.warning}
                    name="alert-circle-outline"
                    size={15}
                  />
                  <Text
                    style={[
                      styles.reportNoticeText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {report.preview.warnings.join(" ")}
                  </Text>
                </View>
              ) : null}
              {reportNeedsRefresh ? (
                <View
                  style={[
                    styles.reportNotice,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.textTertiary}
                    name="time-outline"
                    size={15}
                  />
                  <Text
                    style={[
                      styles.reportNoticeText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Pump activity is current through{" "}
                    {formatDate(
                      toDateKey((report.preview.reportEnd ?? 1) - 1),
                      {
                        day: "numeric",
                        month: "short",
                      },
                    )}
                    . Check Glooko to look for a newer report.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      ) : reportLoadState === "unavailable" ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.empty, { color: colors.textTertiary }]}
        >
          Pump-history status is temporarily unavailable.
        </Text>
      ) : (
        <Text style={[styles.empty, { color: colors.textTertiary }]}>
          Pump activity will appear after the first Daily Overview update.
        </Text>
      )}

      {showControls ? (
        <Pressable
          accessibilityLabel={
            importOptionsExpanded
              ? "Hide other Glooko report import options"
              : "Import a Glooko report another way"
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: importOptionsExpanded }}
          onPress={() => setImportOptionsExpanded((value) => !value)}
          style={({ pressed }) => [
            styles.detailsToggle,
            {
              borderTopColor: colors.divider,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
        >
          <Text style={[styles.detailsToggleText, { color: colors.primary }]}>
            {importOptionsExpanded
              ? "Hide other import options"
              : "Import another way"}
          </Text>
          <Ionicons
            accessibilityElementsHidden
            color={colors.primary}
            name={importOptionsExpanded ? "chevron-up" : "chevron-down"}
            size={17}
          />
        </Pressable>
      ) : null}

      {showControls && importOptionsExpanded ? (
        <View
          accessible
          accessibilityLabel={
            inboxLoadState === "loading"
              ? "Checking Glooko report folder access"
              : inboxLoadState === "unavailable"
                ? "Glooko report folder access is unavailable"
                : inboxStatus?.configured
                  ? "A backup Glooko report folder is set"
                  : "No backup Glooko report folder is set"
          }
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: inboxLoadState === "loading" }}
          style={[
            styles.automaticStatus,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          {inboxLoadState === "loading" ? (
            <ActivityIndicator
              accessibilityElementsHidden
              color={colors.textTertiary}
              size="small"
            />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={
                inboxLoadState === "unavailable"
                  ? colors.warning
                  : colors.accent
              }
              name={
                inboxLoadState === "unavailable"
                  ? "alert-circle-outline"
                  : "document-text-outline"
              }
              size={17}
            />
          )}
          <View style={styles.automaticStatusCopy}>
            <Text style={[styles.automaticTitle, { color: colors.text }]}>
              {inboxLoadState === "loading"
                ? "Checking folder access"
                : inboxLoadState === "unavailable"
                  ? "Folder status unavailable"
                  : inboxStatus?.configured
                    ? "Backup report folder"
                    : "Other ways to add a report"}
            </Text>
            <Text
              style={[styles.automaticBody, { color: colors.textTertiary }]}
            >
              {inboxLoadState === "loading"
                ? "Reading the saved folder permission on this phone…"
                : inboxLoadState === "unavailable"
                  ? "T1 Arc could not safely check the saved folder."
                  : inboxStatus?.configured
                    ? inboxStatus.accessible
                      ? `${inboxStatus.folderLabel ?? "Selected folder"} · checked automatically.`
                      : "Android can no longer read this folder. Choose it again below."
                    : "Share a report with T1 Arc, choose a folder, or select a one-week Daily Overview PDF."}
            </Text>
          </View>
        </View>
      ) : null}

      {showControls && importOptionsExpanded ? (
        <View
          style={[
            styles.reportNotice,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textTertiary}
            name="information-circle-outline"
            size={15}
          />
          <Text
            style={[styles.reportNoticeText, { color: colors.textSecondary }]}
          >
            Automatic Glooko updates are the normal route. Use these options
            only when you need to add a Daily Overview yourself.
          </Text>
        </View>
      ) : null}

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: colors.textSecondary }]}
        >
          {message}
        </Text>
      ) : null}

      {showControls && importOptionsExpanded ? (
        <Pressable
          accessibilityLabel={
            inboxLoadState === "loading"
              ? "Checking backup Glooko report folder"
              : inboxLoadState === "unavailable"
                ? "Check backup Glooko report folder again"
                : inboxStatus?.configured
                  ? "Change backup Glooko report folder"
                  : "Choose backup Glooko report folder"
          }
          accessibilityRole="button"
          accessibilityState={{
            busy: inboxLoadState === "loading" || busy,
            disabled:
              inboxLoadState === "loading" ||
              busy ||
              glookoSyncing ||
              glookoReportSyncing,
          }}
          disabled={
            inboxLoadState === "loading" ||
            busy ||
            glookoSyncing ||
            glookoReportSyncing
          }
          onPress={() =>
            void (inboxLoadState === "unavailable"
              ? retryInboxStatus()
              : chooseReportFolder())
          }
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: `${colors.accent}12`,
              borderColor: `${colors.accent}55`,
              borderRadius: radius.md,
              opacity:
                pressed ||
                inboxLoadState === "loading" ||
                busy ||
                glookoSyncing ||
                glookoReportSyncing
                  ? 0.6
                  : 1,
            },
          ]}
        >
          {inboxLoadState === "loading" ? (
            <ActivityIndicator
              accessibilityElementsHidden
              color={colors.textTertiary}
              size="small"
            />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name={
                inboxLoadState === "unavailable"
                  ? "refresh-outline"
                  : "folder-open-outline"
              }
              size={17}
            />
          )}
          <Text style={[styles.buttonText, { color: colors.accent }]}>
            {inboxLoadState === "loading"
              ? "Checking folder access…"
              : inboxLoadState === "unavailable"
                ? "Try again"
                : inboxStatus?.configured
                  ? "Change backup report folder"
                  : "Choose backup report folder"}
          </Text>
        </Pressable>
      ) : null}

      {showControls && importOptionsExpanded ? (
        <Pressable
          accessibilityLabel="Import a Glooko PDF"
          accessibilityRole="button"
          accessibilityState={{
            busy,
            disabled: busy || glookoSyncing || glookoReportSyncing,
          }}
          disabled={busy || glookoSyncing || glookoReportSyncing}
          onPress={() => void chooseReport()}
          style={({ pressed }) => [
            styles.button,
            {
              borderColor: `${colors.insulin}55`,
              borderRadius: radius.md,
              opacity:
                pressed || busy || glookoSyncing || glookoReportSyncing
                  ? 0.6
                  : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.insulin} size="small" />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={colors.insulin}
              name="document-text-outline"
              size={17}
            />
          )}
          <Text style={[styles.buttonText, { color: colors.insulin }]}>
            {busy ? "Reading report locally…" : "Import a Glooko PDF"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ModeFact({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.modeFact}>
      <Text style={[styles.modeValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.modeLabel, { color: colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    marginTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  reportSummary: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 11,
  },
  loadStatus: {
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 12,
  },
  loadText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  reportSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  reportRange: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  reportMeta: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  reportNotice: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    marginTop: 10,
    padding: 9,
  },
  reportNoticeText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 18,
  },
  modeGrid: {
    flexDirection: "row",
    gap: 7,
    marginTop: 11,
  },
  modeFact: {
    flex: 1,
    minWidth: 0,
  },
  modeValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  modeLabel: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
  },
  detailsToggle: {
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    paddingTop: 8,
  },
  detailsToggleText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 11,
  },
  reportDetails: {
    marginTop: 4,
  },
  detailsHeading: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  factGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 9,
    marginTop: 10,
  },
  fact: {
    width: "47%",
  },
  factLabel: {
    fontSize: 12,
    lineHeight: 17,
    textTransform: "uppercase",
    letterSpacing: 0.25,
  },
  factValue: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 1,
  },
  schedule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingTop: 9,
  },
  scheduleLabel: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  scheduleValue: {
    fontSize: 12,
    lineHeight: 19,
    fontVariant: ["tabular-nums"],
    marginTop: 3,
  },
  caveat: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 11,
  },
  empty: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 11,
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  automaticStatus: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 11,
    padding: 10,
  },
  automaticStatusCopy: {
    flex: 1,
    minWidth: 0,
  },
  automaticTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  automaticBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 1,
  },
  button: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  buttonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
});
