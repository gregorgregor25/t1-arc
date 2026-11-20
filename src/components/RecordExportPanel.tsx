import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { saveExportFile } from "@/data/export/saveExportFile";
import { buildClinicReport, CLINIC_REPORT_DEFAULT_DAYS } from "@/domain/clinicReport";
import {
  EXPORT_PERIOD_CHOICES,
  exportFileStem,
  exportPeriodLabel,
  exportPeriodRange,
  type ExportPeriodChoice,
} from "@/domain/exportPeriod";
import { personalGlucoseRange } from "@/domain/glucoseRanges";
import type { TimeRange } from "@/domain/models";
import { summarizePeriod } from "@/domain/periodSummary";
import { glucoseReadingsCsv, treatmentRecordsCsv } from "@/domain/recordCsv";
import { zonedDateTimeToTimestamp } from "@/domain/time";
import { useDataContext } from "@/providers/DataProvider";
import { useGlucoseAppearance } from "@/providers/GlucoseAppearanceProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { SegmentedControl } from "./SegmentedControl";

export const EXPORT_NOTICE =
  "This is not encrypted. It contains your health records. Once you save or share it, it leaves T1 Arc and anyone with a copy can read it.";

type ExportAction = "glucose-csv" | "treatment-csv" | "report";

const ACTION_LABELS: Record<ExportAction, string> = {
  "glucose-csv": "Glucose readings (CSV)",
  "treatment-csv": "Insulin, carbohydrate and treatment records (CSV)",
  report: "Clinic report (HTML)",
};

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; message: string; warning?: boolean };

export function ExportButton({
  label,
  onPress,
  disabled = false,
  primary = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          borderRadius: radius.md,
          backgroundColor: primary ? colors.primary : colors.surfaceMuted,
          opacity: disabled || pressed ? 0.55 : 1,
        },
      ]}
    >
      <Text style={[styles.actionText, { color: primary ? colors.onPrimary : colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

/** Inline confirmation shown before anything leaves T1 Arc. */
export function ExportConfirmation({
  title,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  detail?: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md }]}
    >
      <Text accessibilityRole="header" style={[styles.noticeTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.text }]}>{EXPORT_NOTICE}</Text>
      {detail ? <Text style={[styles.body, { color: colors.textSecondary }]}>{detail}</Text> : null}
      <View style={styles.noticeActions}>
        <ExportButton label={confirmLabel} onPress={onConfirm} primary />
        <ExportButton label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

/**
 * User-initiated exports of stored records. Files are built on this phone and
 * handed to Android's save dialog; T1 Arc uploads nothing.
 */
export function RecordExportPanel() {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { settings: appearance } = useGlucoseAppearance();
  const { repository, earliestDate } = useDataContext();
  const personalRange = useMemo(() => personalGlucoseRange(appearance), [appearance]);
  const [period, setPeriod] = useState<ExportPeriodChoice>(CLINIC_REPORT_DEFAULT_DAYS);
  const [pending, setPending] = useState<ExportAction>();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const busy = status.kind === "busy";

  function periodRange(): TimeRange {
    const now = Date.now();
    let earliest: number | undefined;
    try {
      earliest = zonedDateTimeToTimestamp(earliestDate, 0, 0, 0, regional.timeZone);
    } catch {
      earliest = undefined;
    }
    return exportPeriodRange(period, now, earliest);
  }

  async function run(action: ExportAction) {
    setPending(undefined);
    if (!repository) {
      setStatus({ kind: "done", message: "Your records are still loading. Try again in a moment.", warning: true });
      return;
    }
    setStatus({ kind: "busy" });
    try {
      const range = periodRange();
      const data = await repository.getTimeline(range);
      const glucose = data.glucose.filter((reading) => reading.timestamp >= range.start && reading.timestamp < range.end);
      let result: "saved" | "cancelled";
      if (action === "glucose-csv") {
        if (glucose.length === 0) {
          setStatus({ kind: "done", message: "No glucose readings are stored for this period, so there is nothing to export." });
          return;
        }
        result = await saveExportFile(
          glucoseReadingsCsv(glucose, range, regional),
          `${exportFileStem("glucose", range, regional.timeZone)}.csv`,
          "csv",
        );
      } else if (action === "treatment-csv") {
        const csv = treatmentRecordsCsv(data, range, regional);
        // A header line alone means no records.
        if (csv.split("\r\n").filter(Boolean).length <= 1) {
          setStatus({ kind: "done", message: "No insulin, carbohydrate or treatment records are stored for this period, so there is nothing to export." });
          return;
        }
        result = await saveExportFile(csv, `${exportFileStem("insulin-carbs", range, regional.timeZone)}.csv`, "csv");
      } else {
        const summary = summarizePeriod({ ...data, range }, personalRange);
        const report = buildClinicReport({ summary, glucose, settings: regional, generatedAt: Date.now() });
        result = await saveExportFile(report.html, report.fileName, "html");
      }
      setStatus({
        kind: "done",
        message:
          result === "cancelled"
            ? "Not saved. Nothing left T1 Arc."
            : action === "report"
              ? "Saved. Open the file in a browser, choose Print, then Save as PDF."
              : "Saved. The file is now outside T1 Arc.",
      });
    } catch {
      setStatus({ kind: "done", message: "The file could not be saved. Nothing was shared. Please try again.", warning: true });
    }
  }

  return (
    <View style={styles.stack}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Make a copy of your stored records to keep, or to share with your care team. Each row shows the local time with its time zone and names the source it came from.
      </Text>
      <SegmentedControl<string>
        accessibilityLabel="Export period"
        options={EXPORT_PERIOD_CHOICES.map((choice) => ({ value: String(choice), label: exportPeriodLabel(choice) }))}
        value={String(period)}
        onChange={(value) => {
          setPending(undefined);
          setStatus({ kind: "idle" });
          setPeriod(value === "all" ? "all" : (Number(value) as ExportPeriodChoice));
        }}
      />
      <Text style={[styles.small, { color: colors.textSecondary }]}>
        {period === "all" ? "From your earliest stored record up to now." : `The last ${exportPeriodLabel(period)} up to now.`}
      </Text>
      {pending ? (
        <ExportConfirmation
          title={`Before you export: ${ACTION_LABELS[pending]}`}
          detail={pending === "report" ? "The report is a web page. To make a PDF, open it and print to PDF." : undefined}
          confirmLabel="Continue"
          onConfirm={() => void run(pending)}
          onCancel={() => setPending(undefined)}
        />
      ) : (
        <View style={styles.stack}>
          {(Object.keys(ACTION_LABELS) as ExportAction[]).map((action) => (
            <ExportButton
              key={action}
              label={ACTION_LABELS[action]}
              disabled={busy}
              onPress={() => {
                setStatus({ kind: "idle" });
                setPending(action);
              }}
            />
          ))}
          <Text style={[styles.small, { color: colors.textSecondary }]}>
            The clinic report is one page with a summary, a typical day, a daily overview and insulin and carbohydrate totals. Open and print to PDF.
          </Text>
        </View>
      )}
      {status.kind === "busy" ? (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.textSecondary }]}>Preparing the file on this phone…</Text>
      ) : status.kind === "done" ? (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: status.warning ? colors.warning : colors.text }]}>{status.message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  body: { fontSize: 14, lineHeight: 21 },
  small: { fontSize: 12, lineHeight: 18 },
  notice: { borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 8 },
  noticeTitle: { fontSize: 15, fontWeight: "700" },
  noticeActions: { gap: 8 },
  action: { minHeight: 48, padding: 12, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 14, lineHeight: 21, fontWeight: "600", textAlign: "center" },
});
