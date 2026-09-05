import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import {
  formatImportElapsed,
  IMPORT_PROGRESS_COPY,
  type ImportProgressStage,
} from "./importProgress";

export function ImportProgressNotice({
  stage,
}: {
  stage: ImportProgressStage;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const focused = useIsFocused();
  const [openedAt] = useState(Date.now);
  const [clock, setClock] = useState(openedAt);
  const copy = IMPORT_PROGRESS_COPY[stage];

  useEffect(() => {
    if (!focused) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    function updateTimer() {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (AppState.currentState === "active") {
        setClock(Date.now());
        timer = setInterval(() => setClock(Date.now()), 1_000);
      }
    }
    updateTimer();
    const listener = AppState.addEventListener("change", updateTimer);
    return () => {
      if (timer) clearInterval(timer);
      listener.remove();
    };
  }, [focused]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
      ]}
    >
      <View style={styles.heading}>
        <ActivityIndicator color={colors.primary} />
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.title, { color: colors.text }]}
        >
          {copy.title}
        </Text>
      </View>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        {copy.detail}
      </Text>
      <Text style={[styles.elapsed, { color: colors.textSecondary }]}>
        Time on this screen:{" "}
        {formatImportElapsed(clock - openedAt, regional.locale)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, marginTop: 14 },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  detail: { fontSize: 13, lineHeight: 19, marginTop: 10 },
  elapsed: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    fontVariant: ["tabular-nums"],
  },
});
