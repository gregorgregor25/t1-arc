import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";

import { useAppTheme } from "@/theme/theme";

interface Props {
  title: string;
  detail: string;
  action: string;
  disabled: boolean;
  onUse(): void;
}

/**
 * Shown at the top of Tarv1s connection settings when the saved AI
 * connection cannot be used but another one is ready, for example after
 * its key was removed. One tap switches.
 */
export function TarvisProviderSwitchOffer({ title, detail, action, disabled, onUse }: Props) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: 9,
        padding: 13,
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: radius.md,
        backgroundColor: colors.surfaceMuted,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9 }}>
        <Ionicons accessibilityElementsHidden name="swap-horizontal-outline" size={19} color={colors.primary} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: "800" }}>{title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 19 }}>{detail}</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onUse}
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          backgroundColor: colors.primary,
          opacity: disabled ? 0.55 : pressed ? 0.72 : 1,
        })}
      >
        <Text style={{ color: colors.onPrimary, fontSize: 14, fontWeight: "800" }}>{action}</Text>
      </Pressable>
    </View>
  );
}
