import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  loadDismissedOvernightDate,
  saveDismissedOvernightDate,
} from "@/data/todayCardPreferences";
import {
  buildOvernightSummary,
  overnightSummaryText,
  type OvernightSummary,
} from "@/domain/overnightSummary";
import { isMorningSummaryTime, lastNightWindow } from "@/domain/overnightWindow";
import type { DateKey } from "@/domain/time";
import { useNightSchedule } from "@/hooks/useNightSchedule";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";

/**
 * Morning card (05:00–12:00 local time) describing last night's records.
 * Template wording only; dismissing hides it until the next night.
 */
export function OvernightSummaryCard() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { now, ownerIdentity, repository, revision } = useDataContext();
  const nightSchedule = useNightSchedule();
  const [dismissed, setDismissed] = useState<DateKey | null>();
  const [result, setResult] = useState<{ key: string; summary: OvernightSummary }>();
  const morning = isMorningSummaryTime(now, regional.timeZone);
  // Recalculate every five minutes while the night is still in progress.
  const asOf = Math.floor(now / 300_000) * 300_000;
  const window = lastNightWindow(asOf, regional.timeZone, nightSchedule);
  const key = `${ownerIdentity}:${window.endDate}:${window.range.start}:${window.range.end}`;
  const { endDate } = window;

  useEffect(() => {
    let active = true;
    void loadDismissedOvernightDate()
      .then((date) => { if (active) setDismissed(date ?? null); })
      .catch(() => { if (active) setDismissed(null); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (!morning || !repository || dismissed === undefined || dismissed === endDate) return;
    const current = lastNightWindow(asOf, regional.timeZone, nightSchedule);
    repository.getTimeline(current.range).then((data) => {
      if (active) setResult({ key, summary: buildOvernightSummary(current, data.glucose, data.context) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [asOf, dismissed, endDate, key, morning, nightSchedule, regional.timeZone, repository, revision]);

  if (!morning || dismissed === undefined || dismissed === endDate || result?.key !== key) return null;
  const text = overnightSummaryText(result.summary, regional);

  function dismiss() {
    setDismissed(endDate);
    void saveDismissedOvernightDate(endDate).catch(() => undefined);
  }

  return (
    <SectionCard accessibilityLabel={`${text.title} summary`} style={styles.card}>
      <View style={styles.heading}>
        <Ionicons accessibilityElementsHidden color={colors.accent} name="moon-outline" size={19} />
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{text.title}</Text>
          <Text style={[styles.period, { color: colors.textTertiary }]}>{text.period}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss overnight summary until tomorrow"
          hitSlop={8}
          onPress={dismiss}
          style={({ pressed }) => [styles.dismiss, { borderRadius: radius.pill, opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons accessibilityElementsHidden color={colors.textSecondary} name="close" size={18} />
        </Pressable>
      </View>
      {text.lines.map((line) => (
        <Text key={line} style={[styles.line, { color: result.summary.status === "withheld" ? colors.textSecondary : colors.text }]}>{line}</Text>
      ))}
      <Text style={[styles.footer, { color: colors.textTertiary }]}>From your saved records on this phone. A description, not advice.</Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, marginTop: 16 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 4 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "800" },
  period: { fontSize: 13, lineHeight: 18 },
  dismiss: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  line: { fontSize: 13, lineHeight: 19 },
  footer: { fontSize: 12, lineHeight: 17, marginTop: 4 },
});
