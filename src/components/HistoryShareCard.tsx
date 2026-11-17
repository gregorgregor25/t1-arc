import { useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";

import { personalGlucoseRange } from "@/domain/glucoseRanges";
import type { TimelineData } from "@/domain/models";
import { summarizePeriod } from "@/domain/periodSummary";
import { buildPeriodSummaryText } from "@/domain/periodSummaryText";
import { useGlucoseAppearance } from "@/providers/GlucoseAppearanceProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { ExportButton, ExportConfirmation, RecordExportPanel } from "./RecordExportPanel";
import { SectionCard } from "./SectionCard";

type Step = "idle" | "confirm-summary" | "export";

/**
 * History entry point for sharing. The summary describes the period on
 * screen; Android's share sheet offers Copy as well as apps. Inside a sheet
 * that already shows the "Share or export" heading, pass `showHeading={false}`
 * so the heading is not repeated.
 */
export function HistoryShareCard({
  data,
  showHeading = true,
}: {
  data: TimelineData;
  showHeading?: boolean;
}) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { settings: appearance } = useGlucoseAppearance();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState<string>();

  async function shareSummary() {
    setStep("idle");
    try {
      const now = Date.now();
      const text = buildPeriodSummaryText(summarizePeriod(data, personalGlucoseRange(appearance)), regional, now);
      await Share.share({ message: text, title: "T1 Arc glucose summary" });
      setMessage(undefined);
    } catch {
      setMessage("The summary could not be shared. Please try again.");
    }
  }

  return (
    <SectionCard accessibilityLabel="Share or export">
      {showHeading ? (
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Share or export</Text>
      ) : null}
      <Text style={[styles.body, !showHeading && styles.firstBody, { color: colors.textSecondary }]}>
        Copy a text summary of this period, or save your records as files.
      </Text>
      <View style={styles.stack}>
        {step === "confirm-summary" ? (
          <ExportConfirmation
            title="Before you share this summary"
            detail="Choose Copy in the share menu to paste it elsewhere."
            confirmLabel="Continue"
            onConfirm={() => void shareSummary()}
            onCancel={() => setStep("idle")}
          />
        ) : (
          <ExportButton label="Copy summary as text" onPress={() => { setMessage(undefined); setStep("confirm-summary"); }} />
        )}
        <ExportButton
          label={step === "export" ? "Hide export options" : "Share or export files"}
          onPress={() => setStep((current) => (current === "export" ? "idle" : "export"))}
        />
        {step === "export" ? <RecordExportPanel /> : null}
        {message ? <Text style={[styles.body, { color: colors.warning }]}>{message}</Text> : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  firstBody: { marginTop: 0 },
  stack: { gap: 10, marginTop: 12 },
});
