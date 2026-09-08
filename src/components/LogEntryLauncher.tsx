import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/theme/theme";

import { SurfaceSheen } from "./SurfaceSheen";

export type LogEntryKind =
  | "food"
  | "activity"
  | "sleep"
  | "weight"
  | "medication"
  | "insulin"
  | "ketone"
  | "sensor-start"
  | "note";

const OPTIONS: {
  kind: LogEntryKind;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    kind: "food",
    label: "Food",
    detail: "Meal, snack, barcode or quick carbs",
    icon: "restaurant-outline",
  },
  {
    kind: "activity",
    label: "Activity",
    detail: "Walk, run, cycle or strength",
    icon: "walk-outline",
  },
  {
    kind: "sleep",
    label: "Sleep",
    detail: "Duration and optional quality",
    icon: "moon-outline",
  },
  {
    kind: "weight",
    label: "Weight",
    detail: "Record a measurement",
    icon: "scale-outline",
  },
  {
    kind: "medication",
    label: "Medication",
    detail: "Name and optional amount",
    icon: "medical-outline",
  },
  {
    kind: "insulin",
    label: "Insulin dose",
    detail: "Record a point dose already delivered",
    icon: "water-outline",
  },
  {
    kind: "ketone",
    label: "Ketones",
    detail: "Blood meter or urine strip reading",
    icon: "flask-outline",
  },
  {
    kind: "note",
    label: "Note",
    detail: "Illness, stress, travel or anything else",
    icon: "document-text-outline",
  },
  {
    kind: "sensor-start",
    label: "New sensor",
    detail: "Record when you started a new sensor",
    icon: "radio-outline",
  },
];

export function FloatingLogButton({
  onPress,
  style,
}: {
  onPress(): void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, dark, radius } = useAppTheme();

  return (
    <Pressable
      accessibilityHint="Opens the list of things you can log"
      accessibilityLabel="Add a log entry"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.floatingButton,
        {
          backgroundColor: dark ? colors.surfaceElevated : colors.surface,
          borderColor: `${colors.primary}70`,
          borderRadius: radius.lg,
          opacity: pressed ? 0.76 : 1,
          shadowColor: colors.surfaceShadow,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        style,
      ]}
    >
      <LinearGradient
        colors={
          dark
            ? [`${colors.primary}20`, "rgba(255,255,255,0)"]
            : [`${colors.primary}14`, "rgba(255,255,255,0.36)"]
        }
        end={{ x: 1, y: 1 }}
        pointerEvents="none"
        start={{ x: 0, y: 0 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius.lg }]}
      />
      <SurfaceSheen radius={radius.lg} />
      <Ionicons
        accessibilityElementsHidden
        color={colors.primaryStrong}
        name="add"
        size={29}
      />
    </Pressable>
  );
}

export function LogEntryLauncher({
  onChoose,
  onClose,
  visible,
}: {
  onChoose(kind: LogEntryKind): void;
  onClose(): void;
  visible: boolean;
}) {
  const { colors, radius } = useAppTheme();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
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
          colors={[colors.backgroundGlow, colors.background, colors.background]}
          end={{ x: 0.82, y: 0.72 }}
          locations={[0, 0.42, 1]}
          pointerEvents="none"
          start={{ x: 0.02, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
            >
              Log something
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Close logging options"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onClose}
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
          <View style={styles.options}>
            {OPTIONS.map((option) => (
              <Pressable
                accessibilityHint={option.detail}
                accessibilityLabel={`Log ${option.label.toLowerCase()}`}
                accessibilityRole="button"
                key={option.kind}
                onPress={() => onChoose(option.kind)}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: colors.surfaceBorder,
                    borderRadius: radius.lg,
                    opacity: pressed ? 0.72 : 1,
                    shadowColor: colors.surfaceShadow,
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                  },
                ]}
              >
                <LinearGradient
                  colors={[
                    colors.surfaceGradientStart,
                    colors.surfaceGradientMiddle,
                    colors.surfaceGradientEnd,
                  ]}
                  end={{ x: 0.94, y: 1 }}
                  locations={[0, 0.5, 1]}
                  pointerEvents="none"
                  start={{ x: 0.02, y: 0 }}
                  style={[StyleSheet.absoluteFill, { borderRadius: radius.lg }]}
                />
                <SurfaceSheen radius={radius.lg} />
                <View
                  accessibilityElementsHidden
                  style={[
                    styles.optionIcon,
                    {
                      backgroundColor: `${colors.primary}16`,
                      borderColor: `${colors.primary}28`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    color={colors.primary}
                    name={option.icon}
                    size={22}
                  />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={[styles.optionLabel, { color: colors.text }]}>
                    {option.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.optionDetail,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {option.detail}
                  </Text>
                </View>
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textTertiary}
                  name="chevron-forward"
                  size={21}
                />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: "absolute",
    width: 58,
    height: 58,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 9,
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
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    maxWidth: 530,
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
    paddingTop: 8,
    paddingBottom: 28,
  },
  options: {
    gap: 9,
  },
  option: {
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 4,
  },
  optionIcon: {
    width: 42,
    height: 42,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  optionDetail: {
    marginTop: 1,
    fontSize: 11,
    lineHeight: 16,
  },
});
