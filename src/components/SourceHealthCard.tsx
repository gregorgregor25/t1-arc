import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { buildSourceHealthReport, type SourceAttemptOutcome, type SourceHealthReport } from "@/domain/sourceHealth";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; report: SourceHealthReport }
  | { kind: "unavailable" };

const OUTCOME_ICON: Record<SourceAttemptOutcome, keyof typeof Ionicons.glyphMap> = {
  worked: "checkmark-circle-outline",
  failed: "alert-circle-outline",
  unfinished: "time-outline",
  none: "ellipse-outline",
};

/**
 * Read-only view of each configured source: when it last updated, what the
 * last check found, how recent its records are and where readings are
 * missing in the last 24 hours. Built from records already on this phone.
 */
export function SourceHealthCard() {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { repository, revision } = useDataContext();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [checkRequest, setCheckRequest] = useState(0);

  useEffect(() => {
    let active = true;
    if (!repository?.getSourceHealthSnapshot) {
      return () => {
        active = false;
      };
    }
    repository
      .getSourceHealthSnapshot(Date.now())
      .then((snapshot) => {
        if (!active) return;
        setState({
          kind: "ready",
          report: buildSourceHealthReport(snapshot, { locale: regional.locale, timeZone: regional.timeZone }),
        });
      })
      .catch(() => {
        if (active) setState({ kind: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [checkRequest, regional.locale, regional.timeZone, repository, revision]);

  const supported = Boolean(repository?.getSourceHealthSnapshot);
  const shown: LoadState = supported ? state : { kind: "unavailable" };

  const outcomeColour = (outcome: SourceAttemptOutcome) =>
    outcome === "failed" ? colors.warning : outcome === "worked" ? colors.accent : colors.textTertiary;

  return (
    <SectionCard accessibilityLabel="Source health">
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        Source health
      </Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        What each connection has delivered to this phone. Nothing here changes your records.
      </Text>
      {shown.kind === "loading" ? (
        <Text style={[styles.detail, { color: colors.textSecondary }]}>Checking saved records…</Text>
      ) : shown.kind === "unavailable" ? (
        <Text style={[styles.detail, { color: colors.warning }]}>
          Source health is not available right now. Pull down to refresh and try again.
        </Text>
      ) : shown.report.rows.length === 0 ? (
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          No connections are set up yet. Records appear here once a source sends them.
        </Text>
      ) : (
        <View style={styles.rows}>
          {shown.report.rows.map((row) => (
            <View key={row.id} style={[styles.row, { borderColor: colors.border }]}>
              <View style={styles.rowHeader}>
                <Ionicons
                  accessibilityElementsHidden
                  color={outcomeColour(row.attemptOutcome)}
                  name={OUTCOME_ICON[row.attemptOutcome]}
                  size={20}
                />
                <Text style={[styles.rowTitle, { color: colors.text }]}>{row.label}</Text>
              </View>
              {row.lines.map((line, index) => (
                <Text key={index} selectable style={[styles.line, { color: colors.textSecondary }]}>
                  {line}
                </Text>
              ))}
            </View>
          ))}
          {shown.report.duplicateLines.map((line, index) => (
            <Text key={`duplicate-${index}`} style={[styles.line, { color: colors.textSecondary }]}>
              {line}
            </Text>
          ))}
          <Text style={[styles.line, { color: colors.textTertiary }]}>{shown.report.timeZoneLine}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check source health again"
        onPress={() => {
          setState((previous) => (previous.kind === "ready" ? previous : { kind: "loading" }));
          setCheckRequest((value) => value + 1);
        }}
        style={({ pressed }) => [styles.refresh, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Ionicons accessibilityElementsHidden color={colors.primary} name="refresh-outline" size={18} />
        <Text style={[styles.refreshLabel, { color: colors.primary }]}>Check again</Text>
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "700" },
  detail: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  rows: { gap: 12, marginTop: 12 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 3 },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { fontSize: 15, fontWeight: "600", flex: 1 },
  line: { fontSize: 13, lineHeight: 20 },
  refresh: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, marginTop: 4 },
  refreshLabel: { fontSize: 14, fontWeight: "600" },
});
