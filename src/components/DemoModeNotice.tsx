import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useDataContext } from "@/providers/DataProvider";
import { useAppTheme } from "@/theme/theme";

/** Always outside the data screen's scroll area, never persisted as a record. */
export function DemoModeNotice() {
  const { demoMode, setDataMode } = useDataContext();
  return demoMode ? <DemoNotice onExit={() => setDataMode("live")} /> : null;
}

function DemoNotice({ onExit }: { onExit(): Promise<void> }) {
  const { colors, radius } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);

  async function exitDemo() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onExit();
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.notice,
          { backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          name="flask-outline"
          color={colors.primary}
          size={20}
        />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Demo · example data
          </Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Not your personal records
          </Text>
        </View>
        <Pressable
          accessibilityHint="Returns to your own connected sources and saved records"
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={() => void exitDemo()}
          style={({ pressed }) => [
            styles.exit,
            {
              borderColor: colors.border,
              borderRadius: radius.sm,
              opacity: busy || pressed ? 0.65 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : null}
          <Text style={[styles.exitLabel, { color: colors.primary }]}>
            Exit demo
          </Text>
        </Pressable>
      </View>
      {failed ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: colors.danger }]}
        >
          Could not leave the demo. Try again.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 8,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    padding: 10,
  },
  copy: { flex: 1, minWidth: 120 },
  title: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  exit: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  exitLabel: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  error: { fontSize: 13, lineHeight: 18, marginTop: 6 },
});
