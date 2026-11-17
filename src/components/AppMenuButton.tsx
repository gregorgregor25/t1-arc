import Ionicons from "@expo/vector-icons/Ionicons";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { Pressable, StyleSheet, View } from "react-native";

import type { RootTabParamList } from "@/navigation/AppNavigator";
import { sourceSettingsRouteParams } from "@/navigation/sourceNavigation";
import { useAppTheme } from "@/theme/theme";

/** A shortcut that belongs to the current screen, shown beside the gear. */
export interface AppMenuScreenAction {
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress(): void;
}

/**
 * The gear opens the Settings overview directly. Settings has its own search
 * box, so there is no separate shortcuts screen in between. Screen-specific
 * shortcuts (such as Today's bedside view) appear as their own round buttons.
 */
export function AppMenuButton({
  screenActions = [],
}: { screenActions?: readonly AppMenuScreenAction[] } = {}) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { colors, radius } = useAppTheme();

  const buttonStyle = ({ pressed }: { pressed: boolean }) => [
    styles.menuButton,
    {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.pill,
      opacity: pressed ? 0.68 : 1,
    },
  ];

  return (
    <View style={styles.row}>
      {screenActions.map((action) => (
        <Pressable
          accessibilityHint={action.detail}
          accessibilityLabel={action.label}
          accessibilityRole="button"
          hitSlop={6}
          key={action.label}
          onPress={action.onPress}
          style={buttonStyle}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textSecondary}
            name={action.icon}
            size={22}
          />
        </Pressable>
      ))}
      <Pressable
        accessibilityHint="Opens all settings, with a search box at the top"
        accessibilityLabel="Open settings"
        accessibilityRole="button"
        hitSlop={6}
        onPress={() =>
          navigation.navigate("Sources", sourceSettingsRouteParams())
        }
        style={buttonStyle}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.textSecondary}
          name="settings-outline"
          size={22}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  menuButton: {
    width: 48,
    height: 48,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
