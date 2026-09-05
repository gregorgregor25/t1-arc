import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/theme/theme";

export function EmptyState({
  title,
  detail,
  icon = "file-tray-outline",
  action,
}: {
  title: string;
  detail: string;
  icon?: keyof typeof Ionicons.glyphMap;
  action?: { label: string; onPress(): void };
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.container}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons
          accessibilityElementsHidden
          name={icon}
          color={colors.textSecondary}
          size={24}
        />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.title, { color: colors.text }]}
      >
        {title}
      </Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        {detail}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.actionLabel, { color: colors.onPrimary }]}>
            {action.label}
          </Text>
          <Ionicons
            accessibilityElementsHidden
            name="arrow-forward"
            color={colors.onPrimary}
            size={18}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 180,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  detail: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 4,
  },
  action: {
    minHeight: 48,
    maxWidth: "100%",
    borderRadius: 13,
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  actionLabel: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
});
