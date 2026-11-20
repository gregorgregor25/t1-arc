import Ionicons from "@expo/vector-icons/Ionicons";
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
import {
  FLOATING_BUTTON_SIZE,
  MIN_TOUCH_TARGET,
  PREFERRED_TOUCH_TARGET,
  typeScale,
} from "@/theme/tokens";

export type LogEntryKind =
  | "food"
  | 'hypo-treatment'
  | 'lab-result'
  | 'site-change'
  | "activity"
  | "sleep"
  | "weight"
  | "medication"
  | "insulin"
  | "ketone"
  | "meter-glucose"
  | "sensor-start"
  | "note";

export interface LogEntryOption {
  kind: LogEntryKind;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/** The prominent first choice: a hypo treatment, logged in two taps. */
export const LOG_SHEET_HYPO_OPTION: LogEntryOption = {
  kind: 'hypo-treatment',
  label: 'Treating a hypo',
  detail: 'What you took, amount and time',
  icon: 'heart-outline',
};

/** The three most used entry types, shown as large buttons. */
export const LOG_SHEET_PRIMARY_OPTIONS: readonly LogEntryOption[] = [
  {
    kind: "food",
    label: "Food",
    detail: "Meal, snack, barcode or quick carbs",
    icon: "restaurant-outline",
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
];

/** Everything else, under "More". */
export const LOG_SHEET_MORE_OPTIONS: readonly LogEntryOption[] = [
  {
    kind: "meter-glucose",
    label: "Meter reading",
    detail: "A finger-prick reading from your glucose meter",
    icon: "eyedrop-outline",
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
  { kind: 'site-change', label: 'Pump / sensor site', detail: 'Record a location and view recent sites', icon: 'body-outline' },
  {
    kind: "medication",
    label: "Medication",
    detail: "Name and optional amount",
    icon: "medical-outline",
  },
  {
    kind: "weight",
    label: "Weight",
    detail: "Record a measurement",
    icon: "scale-outline",
  },
  { kind: 'lab-result', label: 'Lab result', detail: 'HbA1c or another result from your check-up', icon: 'flask-outline' },
];

/** Every entry type the sheet offers, in display order. */
export function logSheetOptions(): readonly LogEntryOption[] {
  return [LOG_SHEET_HYPO_OPTION, ...LOG_SHEET_PRIMARY_OPTIONS, ...LOG_SHEET_MORE_OPTIONS];
}

/** Spoken label for an entry button, for example "Log insulin dose". */
export function logEntryAccessibilityLabel(option: LogEntryOption) {
  return `Log ${option.label.toLowerCase()}`;
}

/**
 * The Today "Log" button: a labelled pill so its purpose does not depend on
 * recognising the plus icon.
 */
export function FloatingLogButton({
  onPress,
  style,
}: {
  onPress(): void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityHint="Opens the list of things you can log"
      accessibilityLabel="Add a log entry"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.floatingButton,
        {
          backgroundColor: colors.primary,
          opacity: pressed ? 0.82 : 1,
          shadowColor: colors.shadow,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.onPrimary}
        importantForAccessibility="no-hide-descendants"
        name="add"
        size={24}
      />
      <Text
        maxFontSizeMultiplier={1.4}
        style={[styles.floatingLabel, { color: colors.onPrimary }]}
      >
        Log
      </Text>
    </Pressable>
  );
}

/**
 * Log sheet: "Treating a hypo" first, then Food, Insulin dose and Ketones,
 * then every other entry type under "More". All existing types stay one tap
 * away; nothing here calculates or suggests a dose.
 */
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
  const hypo = LOG_SHEET_HYPO_OPTION;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdropContainer}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />
        <SafeAreaView
          accessibilityViewIsModal
          edges={["bottom"]}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.grabber, { backgroundColor: colors.border }]}
          />
          <View style={styles.header}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.text }]}
            >
              Log
            </Text>
            <Pressable
              accessibilityLabel="Close logging options"
              accessibilityRole="button"
              hitSlop={4}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: pressed ? colors.surfaceMuted : colors.surfaceElevated,
                  borderColor: colors.border,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.textSecondary}
                importantForAccessibility="no-hide-descendants"
                name="close"
                size={24}
              />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              accessibilityHint={hypo.detail}
              accessibilityLabel={logEntryAccessibilityLabel(hypo)}
              accessibilityRole="button"
              onPress={() => onChoose(hypo.kind)}
              style={({ pressed }) => [
                styles.hypoButton,
                {
                  backgroundColor: `${colors.low}1F`,
                  borderColor: colors.low,
                  borderRadius: radius.lg,
                  opacity: pressed ? 0.78 : 1,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.low}
                importantForAccessibility="no-hide-descendants"
                name={hypo.icon}
                size={28}
              />
              <View style={styles.optionCopy}>
                <Text style={[styles.hypoLabel, { color: colors.text }]}>
                  {hypo.label}
                </Text>
                <Text style={[styles.optionDetail, { color: colors.textSecondary }]}>
                  {hypo.detail}
                </Text>
              </View>
              <Ionicons
                accessibilityElementsHidden
                color={colors.textSecondary}
                importantForAccessibility="no-hide-descendants"
                name="chevron-forward"
                size={21}
              />
            </Pressable>

            <View style={styles.primaryRow}>
              {LOG_SHEET_PRIMARY_OPTIONS.map((option) => (
                <Pressable
                  accessibilityHint={option.detail}
                  accessibilityLabel={logEntryAccessibilityLabel(option)}
                  accessibilityRole="button"
                  key={option.kind}
                  onPress={() => onChoose(option.kind)}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: pressed ? colors.surfaceMuted : colors.surfaceElevated,
                      borderColor: colors.border,
                      borderRadius: radius.lg,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    importantForAccessibility="no-hide-descendants"
                    name={option.icon}
                    size={26}
                  />
                  <Text style={[styles.primaryLabel, { color: colors.text }]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text
              accessibilityRole="header"
              style={[styles.moreHeading, { color: colors.textSecondary }]}
            >
              More
            </Text>
            <View style={styles.moreGrid}>
              {LOG_SHEET_MORE_OPTIONS.map((option) => (
                <Pressable
                  accessibilityHint={option.detail}
                  accessibilityLabel={logEntryAccessibilityLabel(option)}
                  accessibilityRole="button"
                  key={option.kind}
                  onPress={() => onChoose(option.kind)}
                  style={({ pressed }) => [
                    styles.moreButton,
                    {
                      backgroundColor: pressed ? colors.surfaceMuted : colors.background,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.textSecondary}
                    importantForAccessibility="no-hide-descendants"
                    name={option.icon}
                    size={20}
                  />
                  <Text style={[styles.moreLabel, { color: colors.text }]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  floatingButton: {
    position: "absolute",
    minHeight: FLOATING_BUTTON_SIZE,
    paddingLeft: 18,
    paddingRight: 22,
    borderRadius: FLOATING_BUTTON_SIZE / 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 9,
  },
  floatingLabel: {
    fontSize: typeScale.title,
    lineHeight: 24,
    fontWeight: "700",
  },
  backdropContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    maxWidth: 760,
    maxHeight: "92%",
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  title: {
    flex: 1,
    fontSize: typeScale.headline,
    lineHeight: 30,
    fontWeight: "700",
  },
  closeButton: {
    width: PREFERRED_TOUCH_TARGET,
    height: PREFERRED_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 12,
  },
  hypoButton: {
    minHeight: 72,
    borderWidth: 2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  hypoLabel: {
    fontSize: typeScale.title,
    lineHeight: 23,
    fontWeight: "700",
  },
  optionCopy: {
    flex: 1,
    minWidth: 0,
  },
  optionDetail: {
    marginTop: 2,
    fontSize: typeScale.footnote,
    lineHeight: 18,
  },
  primaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryButton: {
    flexGrow: 1,
    flexBasis: 96,
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryLabel: {
    fontSize: typeScale.body,
    lineHeight: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  moreHeading: {
    marginTop: 6,
    fontSize: typeScale.callout,
    lineHeight: 20,
    fontWeight: "700",
  },
  moreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  moreButton: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: Math.max(MIN_TOUCH_TARGET, 52),
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  moreLabel: {
    flexShrink: 1,
    fontSize: typeScale.body,
    lineHeight: 20,
    fontWeight: "600",
  },
});
