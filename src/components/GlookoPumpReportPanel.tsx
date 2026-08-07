import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import DaymarkGlookoExport from '../../modules/daymark-glooko-export';
import {
  GlookoPumpSettingsSnapshot,
  PumpSettingScheduleSegment,
} from '@/data/glooko/glookoReport';
import { StoredGlookoReport } from '@/data/glooko/glookoReportRepository';
import { formatDate, relativeAge, toDateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

function formatPercent(value: number | undefined) {
  return value === undefined ? '—' : `${value.toLocaleString('en-GB')}%`;
}

function formatBoolean(value: boolean | undefined) {
  return value === undefined ? 'Not stated' : value ? 'On' : 'Off';
}

function scheduleText(segments: PumpSettingScheduleSegment[]) {
  return segments
    .map(
      (segment) =>
        `${segment.startTime}  ${segment.value.toLocaleString('en-GB')} ${segment.unit}`,
    )
    .join('\n');
}

function reportRange(report: StoredGlookoReport) {
  const { reportStart, reportEnd } = report.preview;
  if (reportStart === undefined || reportEnd === undefined) {
    return 'Report period not stated';
  }
  return `${formatDate(toDateKey(reportStart), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} – ${formatDate(toDateKey(reportEnd), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;
}

function SettingsDetails({
  settings,
}: {
  settings: GlookoPumpSettingsSnapshot;
}) {
  const { colors } = useAppTheme();
  const facts = [
    ['Active CGM', settings.activeCgm],
    [
      'Active insulin time',
      settings.activeInsulinHours === undefined
        ? undefined
        : `${settings.activeInsulinHours} hours`,
    ],
    ['Basal programme', settings.activeBasalProgram],
    [
      'Maximum basal',
      settings.maxBasalRateUnitsPerHour === undefined
        ? undefined
        : `${settings.maxBasalRateUnitsPerHour} U/h`,
    ],
    [
      'Maximum bolus',
      settings.maxBolusUnits === undefined
        ? undefined
        : `${settings.maxBolusUnits} U`,
    ],
    ['Temporary basal', formatBoolean(settings.temporaryBasalEnabled)],
    ['Extended bolus', formatBoolean(settings.extendedBolusEnabled)],
    ['Reverse correction', formatBoolean(settings.reverseCorrectionEnabled)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));
  const allSchedules: Array<[string, PumpSettingScheduleSegment[]]> = [
    ['Scheduled basal', settings.basalSchedule],
    ['Insulin-to-carb ratio', settings.carbRatioSchedule],
    ['Correction sensitivity', settings.sensitivitySchedule],
    ['Target glucose', settings.targetSchedule],
    ['Correction threshold', settings.correctionThresholdSchedule],
  ];
  const schedules = allSchedules.filter((item) => item[1].length > 0);

  return (
    <View style={[styles.details, { borderTopColor: colors.divider }]}>
      <Text style={[styles.detailsHeading, { color: colors.text }]}>
        Settings recorded in this report
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
            {scheduleText(segments)}
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
  const {
    getLatestGlookoReport,
    glookoReportSyncState,
    glookoReportSyncing,
    glookoSyncing,
    importGlookoReport,
    now,
    revision,
    syncGlookoReport,
  } = useDataContext();
  const [report, setReport] = useState<StoredGlookoReport>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    void getLatestGlookoReport()
      .then((next) => {
        if (active) setReport(next);
      })
      .catch(() => {
        // A missing report must not block normal CSV synchronisation.
      });
    return () => {
      active = false;
    };
  }, [getLatestGlookoReport, revision]);

  const settingCount = useMemo(() => {
    const settings = report?.preview.settings;
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
  }, [report]);

  async function chooseReport() {
    setBusy(true);
    setMessage(undefined);
    let cachedFile: File | undefined;
    let bytes: Uint8Array | undefined;
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selected.canceled) return;
      const asset = selected.assets[0];
      if (!asset) throw new Error('No Glooko report was selected.');
      cachedFile = new File(asset.uri);
      const extraction = await DaymarkGlookoExport.extractReportDataAsync(
        asset.uri,
      );
      bytes = await cachedFile.bytes();
      const next = await importGlookoReport(
        asset.name,
        bytes,
        extraction.text,
        extraction.pumpTrackIntervals,
      );
      setReport(next);
      setExpanded(true);
      setMessage(
        `Pump modes, settings and ${next.preview.pumpStateIntervals.length} timed Activity or pause windows were indexed. The complete PDF is encrypted on this phone.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The Glooko pump report could not be read.',
      );
    } finally {
      bytes?.fill(0);
      try {
        if (cachedFile?.exists) cachedFile.delete();
      } catch {
        // Android may already have released the private picker copy.
      }
      setBusy(false);
    }
  }

  async function refreshReport() {
    setMessage(undefined);
    const outcome = await syncGlookoReport();
    if (outcome.status === 'success') {
      setReport(outcome.report);
      setExpanded(true);
      setMessage(
        outcome.inserted
          ? `Latest rolling seven-day report added with ${outcome.report.preview.pumpStateIntervals.length} timed Activity or pause windows.`
          : `The current report was rechecked with ${outcome.report.preview.pumpStateIntervals.length} timed Activity or pause windows; nothing was duplicated.`,
      );
      return;
    }
    if (outcome.status === 'skipped') {
      setMessage(
        outcome.reason === 'busy'
          ? 'A Glooko export is already being handled.'
          : 'The daily Glooko report is already current.',
      );
      return;
    }
    setMessage(outcome.message);
  }

  const modes = report?.preview.modeSummary;
  const settings = report?.preview.settings;
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
            Pump activity & settings
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Activity Mode, Automated Mode and pump settings are organised here
            when Glooko makes them available.
          </Text>
        </View>
      </View>

      {report ? (
        <>
          <View
            style={[styles.reportSummary, { borderTopColor: colors.divider }]}
          >
            <View style={styles.reportSummaryCopy}>
              <Text style={[styles.reportRange, { color: colors.text }]}>
                {reportRange(report)}
              </Text>
              <Text style={[styles.reportMeta, { color: colors.textTertiary }]}>
                Added {relativeAge(report.importedAt, now)} · {settingCount}{' '}
                settings and schedule entries indexed
              </Text>
            </View>
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name="shield-checkmark-outline"
              size={19}
            />
          </View>
          {modes ? (
            <View style={styles.modeGrid}>
              <ModeFact
                label="Automated"
                value={formatPercent(modes.automatedPercent)}
              />
              <ModeFact
                label="Activity"
                value={formatPercent(modes.activityPercent)}
              />
              <ModeFact
                label="Limited"
                value={formatPercent(modes.limitedPercent)}
              />
              <ModeFact
                label="Manual"
                value={formatPercent(modes.manualPercent)}
              />
            </View>
          ) : null}
          {settings ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded((value) => !value)}
                style={({ pressed }) => [
                  styles.detailsToggle,
                  {
                    borderTopColor: colors.divider,
                    opacity: pressed ? 0.65 : 1,
                  },
                ]}
              >
                <Text
                  style={[styles.detailsToggleText, { color: colors.primary }]}
                >
                  {expanded ? 'Hide pump settings' : 'View pump settings'}
                </Text>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.primary}
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={17}
                />
              </Pressable>
              {expanded ? <SettingsDetails settings={settings} /> : null}
            </>
          ) : null}
        </>
      ) : (
        <Text style={[styles.empty, { color: colors.textTertiary }]}>
          Pump activity and settings will appear here automatically.
        </Text>
      )}

      {showControls ? (
        <View
          style={[
            styles.automaticStatus,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={
              glookoReportSyncState.lastErrorMessage
                ? colors.warning
                : colors.accent
            }
            name={
              glookoReportSyncState.lastErrorMessage
                ? 'alert-circle-outline'
                : 'sync-outline'
            }
            size={17}
          />
          <View style={styles.automaticStatusCopy}>
            <Text style={[styles.automaticTitle, { color: colors.text }]}>
              Automatic daily report
            </Text>
            <Text
              style={[styles.automaticBody, { color: colors.textTertiary }]}
            >
              {glookoReportSyncState.lastErrorMessage
                ? `Will retry automatically: ${glookoReportSyncState.lastErrorMessage}`
                : glookoReportSyncState.lastSuccessAt
                  ? `Last refreshed ${relativeAge(glookoReportSyncState.lastSuccessAt, now)} · rolling 7 days · ${glookoReportSyncState.lastDailyModeCount ?? 0} daily mode summaries`
                  : 'Runs securely after Glooko automatic sync is enabled.'}
            </Text>
          </View>
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

      {showControls ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy || glookoReportSyncing || glookoSyncing}
          onPress={() => void refreshReport()}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.insulin,
              borderRadius: radius.md,
              opacity:
                pressed || busy || glookoReportSyncing || glookoSyncing
                  ? 0.6
                  : 1,
            },
          ]}
        >
          {glookoReportSyncing ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={colors.onPrimary}
              name="sync-outline"
              size={17}
            />
          )}
          <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>
            {glookoReportSyncing
              ? 'Refreshing seven-day report…'
              : 'Refresh seven-day report now'}
          </Text>
        </Pressable>
      ) : null}

      {showControls ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy || glookoReportSyncing || glookoSyncing}
          onPress={() => void chooseReport()}
          style={({ pressed }) => [
            styles.button,
            {
              borderColor: `${colors.insulin}55`,
              borderRadius: radius.md,
              opacity:
                pressed || busy || glookoReportSyncing || glookoSyncing
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
            {busy
              ? 'Reading report locally…'
              : 'Import an existing PDF instead'}
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  body: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  reportSummary: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    paddingTop: 11,
  },
  reportSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  reportRange: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  reportMeta: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  modeGrid: {
    flexDirection: 'row',
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
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  modeLabel: {
    fontSize: 8,
    lineHeight: 12,
    marginTop: 1,
  },
  detailsToggle: {
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
  },
  detailsToggleText: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
    paddingTop: 11,
  },
  detailsHeading: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  factGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 9,
    marginTop: 10,
  },
  fact: {
    width: '47%',
  },
  factLabel: {
    fontSize: 8,
    lineHeight: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  factValue: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 1,
  },
  schedule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
    paddingTop: 9,
  },
  scheduleLabel: {
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '800',
  },
  scheduleValue: {
    fontSize: 10,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
    marginTop: 3,
  },
  caveat: {
    fontSize: 8,
    lineHeight: 13,
    marginTop: 11,
  },
  empty: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 11,
  },
  message: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 10,
  },
  automaticStatus: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 11,
    padding: 10,
  },
  automaticStatusCopy: {
    flex: 1,
    minWidth: 0,
  },
  automaticTitle: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
  automaticBody: {
    fontSize: 8,
    lineHeight: 13,
    marginTop: 1,
  },
  primaryButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  primaryButtonText: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
  button: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  buttonText: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
  },
});
