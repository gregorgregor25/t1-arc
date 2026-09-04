import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { RootTabParamList } from "@/navigation/AppNavigator";
import {
  DIABETES_PROFILE_MENU_ITEM,
  SETTINGS_OVERVIEW_MENU_ITEM,
  SOURCE_MENU_SECTIONS,
  SourceJump,
  sourceSettingsRouteParams,
} from "@/navigation/sourceNavigation";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";

export function AppMenuButton() {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { colors, radius } = useAppTheme();
  const [visible, setVisible] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  function openSettings(source?: SourceJump) {
    navigation.navigate("Sources", sourceSettingsRouteParams(source));
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setVisible(false), 140);
  }

  function menuRow(
    item: {
      source?: SourceJump;
      label: string;
      detail: string;
      icon: keyof typeof Ionicons.glyphMap;
    },
    index = 0,
  ) {
    return (
      <Pressable
        accessibilityHint={
          item.source
            ? `Opens ${item.label} settings`
            : SETTINGS_OVERVIEW_MENU_ITEM.accessibilityHint
        }
        accessibilityLabel={`${item.label}. ${item.detail}`}
        accessibilityRole="button"
        key={item.source ?? "overview"}
        onPress={() => openSettings(item.source)}
        style={({ pressed }) => [
          styles.row,
          index > 0 && {
            borderTopColor: colors.divider,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
          pressed && { opacity: 0.62 },
        ]}
      >
        <View
          accessibilityElementsHidden
          style={[
            styles.rowIcon,
            {
              backgroundColor: `${colors.primary}16`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons color={colors.primary} name={item.icon} size={20} />
        </View>
        <View style={styles.rowCopy}>
          <Text style={[styles.rowLabel, { color: colors.text }]}>
            {item.label}
          </Text>
          <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>
            {item.detail}
          </Text>
        </View>
        <Ionicons
          accessibilityElementsHidden
          color={colors.textTertiary}
          name="chevron-forward"
          size={20}
        />
      </Pressable>
    );
  }

  return (
    <>
      <Pressable
        accessibilityHint="Shows shortcuts and an option to open all settings"
        accessibilityLabel="Open settings shortcuts"
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.menuButton,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.surfaceBorder,
            borderRadius: radius.pill,
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.textSecondary}
          name="menu"
          size={22}
        />
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setVisible(false)}
        presentationStyle="fullScreen"
        statusBarTranslucent
        visible={visible}
      >
        <SafeAreaView
          accessibilityViewIsModal
          edges={["top", "bottom"]}
          style={[styles.safeArea, { backgroundColor: colors.background }]}
        >
          <LinearGradient
            colors={[
              colors.backgroundGlow,
              colors.background,
              colors.background,
            ]}
            end={{ x: 0.82, y: 0.72 }}
            locations={[0, 0.42, 1]}
            pointerEvents="none"
            start={{ x: 0.02, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.header}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
            >
              Settings shortcuts
            </Text>
            <Pressable
              accessibilityLabel="Close settings shortcuts"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setVisible(false)}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.surfaceBorder,
                  borderRadius: radius.pill,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.textSecondary}
                name="close"
                size={24}
              />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.section}>
              <Text
                style={[styles.sectionTitle, { color: colors.textSecondary }]}
              >
                Your diabetes
              </Text>
              <SectionCard style={styles.group}>
                {menuRow(DIABETES_PROFILE_MENU_ITEM)}
              </SectionCard>
            </View>
            {SOURCE_MENU_SECTIONS.map((section) => (
              <View key={section.id} style={styles.section}>
                <Text
                  style={[styles.sectionTitle, { color: colors.textSecondary }]}
                >
                  {section.title}
                </Text>
                <SectionCard style={styles.group}>
                  {section.items.map((item, index) => menuRow(item, index))}
                </SectionCard>
              </View>
            ))}
            <View style={styles.section}>
              <SectionCard style={styles.group}>
                {menuRow(SETTINGS_OVERVIEW_MENU_ITEM)}
              </SectionCard>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  safeArea: {
    flex: 1,
  },
  header: {
    width: "100%",
    maxWidth: 760,
    minHeight: 88,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  title: {
    flex: 1,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "600",
    letterSpacing: -0.55,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    marginBottom: 8,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 0.35,
  },
  group: {
    padding: 0,
    overflow: "hidden",
  },
  row: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  rowIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
  rowDetail: {
    marginTop: 1,
    fontSize: 10,
    lineHeight: 15,
  },
});
