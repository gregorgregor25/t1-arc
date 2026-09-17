import Ionicons from "@expo/vector-icons/Ionicons";
import * as ScreenOrientation from "expo-screen-orientation";
import { ReactNode, useCallback, useEffect } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/theme/theme";
import { useDataContext } from "@/providers/DataProvider";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export function ChartExpandButton({
  label,
  onPress,
}: {
  label: string;
  onPress(): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <Pressable
      accessibilityHint="Opens the graph in a larger landscape view."
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.expandButton,
        {
          backgroundColor: pressed
            ? colors.surfaceElevated
            : colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.pill,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.primary}
        name="expand-outline"
        size={19}
      />
    </Pressable>
  );
}

export function FullscreenChartModal({
  children,
  detail,
  onClose,
  title,
  visible,
}: {
  children: ReactNode;
  detail?: string;
  onClose(): void;
  title: string;
  visible: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { demoMode } = useDataContext();
  const reduceMotion = useReducedMotion();
  const restorePortrait = useCallback(
    () =>
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => undefined),
    [],
  );
  const close = useCallback(() => {
    void restorePortrait().finally(onClose);
  }, [onClose, restorePortrait]);

  useEffect(() => {
    if (!visible) return undefined;
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch(() => undefined);
    return () => {
      void restorePortrait();
    };
  }, [restorePortrait, visible]);

  return (
    <Modal
      animationType={reduceMotion ? "none" : "slide"}
      onRequestClose={close}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView
        edges={["top", "right", "bottom", "left"]}
        style={[styles.safeArea, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.surface,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              {demoMode ? "DEMO · EXAMPLE DATA" : "LANDSCAPE GRAPH"}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.title, { color: colors.text }]}
            >
              {title}
            </Text>
            {detail ? (
              <Text
                numberOfLines={1}
                style={[styles.detail, { color: colors.textSecondary }]}
              >
                {detail}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel={`Close full-screen ${title}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={close}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: pressed ? colors.surfaceMuted : "transparent",
                borderRadius: radius.pill,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.textSecondary}
              name="close"
              size={26}
            />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    minHeight: 62,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
    marginTop: 1,
  },
  detail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  closeButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexGrow: 1,
    padding: 8,
    paddingBottom: 10,
  },
  expandButton: {
    width: 48,
    height: 48,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
