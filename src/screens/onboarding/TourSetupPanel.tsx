import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SectionCard } from "@/components/SectionCard";
import { UsageReportingCard } from "@/components/UsageReportingCard";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { TOUR_GLUCOSE_UNIT_OPTIONS, tourGlucoseUnitChoice } from "./tourModel";

/**
 * The tour's one setup step. Nothing here is switched on automatically: the
 * glucose unit is saved only when the person taps a choice, alerts stay off,
 * and the usage-count switch shows the choice already stored on this phone.
 */
export function TourSetupPanel({
  onOpenAlerts,
  openAlertsBusy = false,
}: {
  onOpenAlerts(): void;
  openAlertsBusy?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { defaults, profile, save } = useRegionalProfile();
  const [unitError, setUnitError] = useState<string>();
  const [savingUnit, setSavingUnit] = useState(false);
  const selectedUnit = tourGlucoseUnitChoice(profile, defaults);

  async function chooseUnit(glucoseUnit: (typeof TOUR_GLUCOSE_UNIT_OPTIONS)[number]["value"]) {
    if (savingUnit) return;
    setSavingUnit(true);
    setUnitError(undefined);
    try {
      await save({ ...profile, glucoseUnit });
    } catch {
      setUnitError(
        "T1 Arc could not save the glucose unit. You can choose it later in Settings, under Units and region.",
      );
    } finally {
      setSavingUnit(false);
    }
  }

  return (
    <View style={styles.stack}>
      <SectionCard>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
          Glucose unit
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Choose how glucose is shown. Your saved readings are not changed.
        </Text>
        <View accessibilityRole="radiogroup" style={styles.options}>
          {TOUR_GLUCOSE_UNIT_OPTIONS.map((option) => {
            const active = selectedUnit === option.value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: savingUnit }}
                disabled={savingUnit}
                key={option.value}
                onPress={() => void chooseUnit(option.value)}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: active ? `${colors.primary}1C` : colors.surfaceMuted,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: radius.pill,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                <Text style={[styles.optionText, { color: active ? colors.primary : colors.textSecondary }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {unitError ? (
          <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.danger }]}>
            {unitError}
          </Text>
        ) : null}
      </SectionCard>

      <SectionCard>
        <View style={styles.row}>
          <Ionicons
            accessibilityElementsHidden
            color={colors.textSecondary}
            name="notifications-off-outline"
            size={22}
          />
          <View style={styles.fill}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
              Alerts start switched off
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              T1 Arc will not sound or show glucose alerts until you turn them on and choose your levels.
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityHint="Finishes the tour and opens glucose alert settings. Nothing is turned on for you."
          accessibilityRole="button"
          accessibilityState={{ busy: openAlertsBusy, disabled: openAlertsBusy }}
          disabled={openAlertsBusy}
          onPress={onOpenAlerts}
          style={({ pressed }) => [
            styles.alertButton,
            {
              borderColor: colors.primary,
              borderRadius: radius.md,
              opacity: openAlertsBusy ? 0.5 : pressed ? 0.68 : 1,
            },
          ]}
        >
          <Text style={[styles.alertButtonText, { color: colors.primary }]}>
            Open alert settings
          </Text>
        </Pressable>
      </SectionCard>

      <SectionCard>
        <UsageReportingCard />
      </SectionCard>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  fill: { flex: 1 },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  body: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  option: {
    minHeight: 44,
    minWidth: 96,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
  error: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  alertButton: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  alertButtonText: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
});
