import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "@/theme/theme";

export interface SourceSetupGuideContent {
  title: string;
  intro: string;
  steps: readonly string[];
  note?: string;
}

export function SourceSetupGuide({
  intro,
  note,
  steps,
  title,
}: SourceSetupGuideContent) {
  const { colors, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  return (
    <>
      <Pressable
        accessibilityHint={`Shows the steps for connecting ${title}.`}
        accessibilityLabel={`How to connect ${title}`}
        accessibilityRole="button"
        hitSlop={4}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.infoButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.pill,
            opacity: pressed ? 0.66 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="information-circle-outline"
          size={23}
        />
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setVisible(false)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={visible}
      >
        <View
          style={[
            styles.modalFrame,
            {
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <Pressable
            accessibilityLabel="Close setup guide"
            accessibilityRole="button"
            onPress={() => setVisible(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.surfaceBorder,
                borderRadius: radius.lg,
              },
            ]}
          >
            <View
              style={[
                styles.sheetHeader,
                { borderBottomColor: colors.divider },
              ]}
            >
              <View style={styles.sheetTitleCopy}>
                <Text style={[styles.eyebrow, { color: colors.primary }]}>
                  SETUP
                </Text>
                <Text style={[styles.title, { color: colors.text }]}>
                  {title}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close setup guide"
                accessibilityRole="button"
                hitSlop={4}
                onPress={() => setVisible(false)}
                style={({ pressed }) => [
                  styles.closeButton,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.pill,
                    opacity: pressed ? 0.62 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textSecondary}
                  name="close"
                  size={23}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.intro, { color: colors.textSecondary }]}>
                {intro}
              </Text>

              <View style={styles.steps}>
                {steps.map((step, index) => (
                  <View key={`${index}-${step}`} style={styles.step}>
                    <View
                      style={[
                        styles.stepNumber,
                        {
                          backgroundColor: `${colors.primary}18`,
                          borderRadius: radius.pill,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.stepNumberText,
                          { color: colors.primary },
                        ]}
                      >
                        {index + 1}
                      </Text>
                    </View>
                    <Text
                      style={[styles.stepText, { color: colors.textSecondary }]}
                    >
                      {step}
                    </Text>
                  </View>
                ))}
              </View>

              {note ? (
                <View
                  style={[
                    styles.note,
                    {
                      backgroundColor: `${colors.accent}0D`,
                      borderColor: `${colors.accent}32`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="shield-checkmark-outline"
                    size={18}
                  />
                  <Text
                    style={[styles.noteText, { color: colors.textSecondary }]}
                  >
                    {note}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  infoButton: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  modalFrame: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: "flex-end",
    backgroundColor: "rgba(5, 10, 18, 0.62)",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheet: {
    maxHeight: "88%",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  sheetHeader: {
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sheetTitleCopy: {
    flex: 1,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  title: {
    marginTop: 2,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
  },
  intro: {
    fontSize: 14,
    lineHeight: 21,
  },
  steps: {
    marginTop: 20,
    gap: 16,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  stepNumber: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  stepText: {
    flex: 1,
    paddingTop: 3,
    fontSize: 13,
    lineHeight: 20,
  },
  note: {
    marginTop: 20,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
  },
});
