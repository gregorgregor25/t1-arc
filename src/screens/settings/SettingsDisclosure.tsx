import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SectionCard } from "@/components/SectionCard";
import { useAppTheme } from "@/theme/theme";

/** A titled row that shows or hides a group of settings in place. */
export function SettingsDisclosure({
  children,
  detail,
  expanded,
  icon,
  onToggle,
  title,
}: {
  children: ReactNode;
  detail: string;
  expanded: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onToggle(): void;
  title: string;
}) {
  const { colors, radius } = useAppTheme();

  return (
    <View>
      <SectionCard style={styles.disclosureShell}>
        <Pressable
          accessibilityHint={
            expanded ? `Collapses ${title}` : `Expands ${title} settings`
          }
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={({ pressed }) => [
            styles.disclosureTrigger,
            pressed && { opacity: 0.66 },
          ]}
        >
          <View
            accessibilityElementsHidden
            style={[
              styles.disclosureIcon,
              {
                backgroundColor: `${colors.primary}16`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons color={colors.primary} name={icon} size={21} />
          </View>
          <View style={styles.disclosureCopy}>
            <Text style={[styles.disclosureTitle, { color: colors.text }]}>
              {title}
            </Text>
            <Text
              numberOfLines={expanded ? undefined : 1}
              style={[styles.disclosureDetail, { color: colors.textSecondary }]}
            >
              {detail}
            </Text>
          </View>
          <Ionicons
            accessibilityElementsHidden
            color={expanded ? colors.primary : colors.textTertiary}
            name={expanded ? "chevron-up" : "chevron-down"}
            size={21}
          />
        </Pressable>
      </SectionCard>
      {expanded ? (
        <View style={styles.disclosureContent}>{children}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  disclosureShell: {
    padding: 0,
    overflow: "hidden",
  },
  disclosureTrigger: {
    minHeight: 76,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  disclosureIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  disclosureCopy: {
    flex: 1,
    minWidth: 0,
  },
  disclosureTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  disclosureDetail: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  disclosureContent: {
    marginTop: 10,
    gap: 12,
  },
});
