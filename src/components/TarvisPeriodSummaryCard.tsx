import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { personalGlucoseRange } from "@/domain/glucoseRanges";
import type { TimeRange, TimelineData } from "@/domain/models";
import {
  buildPeriodNarrative,
  PERIOD_SUMMARY_CHOICES,
  type PeriodNarrative,
  type PeriodSummaryChoice,
  periodSummaryRequest,
} from "@/domain/periodSummaryNarrative";
import { useNightSchedule } from "@/hooks/useNightSchedule";
import { useGlucoseAppearance } from "@/providers/GlucoseAppearanceProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";
import { SegmentedControl } from "./SegmentedControl";

/**
 * Key-free period summary for Tarv1s. Everything is calculated on this phone
 * from templates; no question or record is sent to an AI provider.
 */
export function TarvisPeriodSummaryCard({
  loadTimelineData,
  now,
  disabled,
}: {
  loadTimelineData(range: TimeRange): Promise<TimelineData>;
  now: number;
  disabled?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { settings: appearance } = useGlucoseAppearance();
  const nightSchedule = useNightSchedule();
  const [choice, setChoice] = useState<PeriodSummaryChoice>("7");
  const [narrative, setNarrative] = useState<PeriodNarrative>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);

  async function summarise(next: PeriodSummaryChoice) {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setError(undefined);
    try {
      const at = Math.max(now, Date.now());
      const request = periodSummaryRequest(next, at, regional.timeZone, nightSchedule);
      const data = await loadTimelineData(request.range);
      if (requestId.current !== id) return;
      setNarrative(buildPeriodNarrative(request, data, personalGlucoseRange(appearance), regional, at));
    } catch {
      if (requestId.current !== id) return;
      setNarrative(undefined);
      setError("The summary could not be prepared from your saved records. Please try again.");
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }

  return (
    <SectionCard accessibilityLabel="Summarise a period" style={styles.card}>
      <View style={styles.heading}>
        <Ionicons accessibilityElementsHidden color={colors.accent} name="document-text-outline" size={20} />
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Summarise a period</Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Made on this phone from your records. No AI account is needed and nothing is sent.
          </Text>
        </View>
      </View>
      <SegmentedControl
        accessibilityLabel="Period to summarise"
        options={PERIOD_SUMMARY_CHOICES.map(({ value, label }) => ({ value, label }))}
        value={choice}
        onChange={(next) => {
          setChoice(next);
          setNarrative(undefined);
          setError(undefined);
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Summarise ${PERIOD_SUMMARY_CHOICES.find((item) => item.value === choice)?.accessibilityLabel.toLowerCase() ?? "this period"}`}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        disabled={disabled || loading}
        onPress={() => void summarise(choice)}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.primary, borderRadius: radius.md, opacity: disabled || loading ? 0.55 : pressed ? 0.72 : 1 },
        ]}
      >
        {loading ? <ActivityIndicator color={colors.onPrimary} /> : (
          <Ionicons accessibilityElementsHidden color={colors.onPrimary} name="list-outline" size={18} />
        )}
        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Summarise</Text>
      </Pressable>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[styles.detail, { color: colors.danger }]}>{error}</Text>
      ) : null}
      {narrative ? (
        <View accessibilityLiveRegion="polite" style={styles.result}>
          <Text style={[styles.resultTitle, { color: colors.text }]}>{narrative.title}</Text>
          <Text style={[styles.detail, { color: colors.textTertiary }]}>{narrative.period}</Text>
          {narrative.sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
              {section.lines.map((line, index) => (
                <Text key={`${section.title}:${index}`} style={[styles.line, { color: colors.textSecondary }]}>{line}</Text>
              ))}
            </View>
          ))}
          <Text style={[styles.footer, { color: colors.textTertiary }]}>{narrative.footer}</Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, marginBottom: 16 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headingCopy: { flex: 1, gap: 3 },
  title: { fontSize: 16, fontWeight: "800" },
  detail: { fontSize: 13, lineHeight: 19 },
  button: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 },
  buttonText: { fontSize: 14, fontWeight: "700" },
  result: { gap: 6 },
  resultTitle: { fontSize: 15, fontWeight: "800" },
  section: { gap: 3, marginTop: 6 },
  sectionTitle: { fontSize: 13, fontWeight: "800" },
  line: { fontSize: 13, lineHeight: 19 },
  footer: { fontSize: 12, lineHeight: 17, marginTop: 8 },
});
