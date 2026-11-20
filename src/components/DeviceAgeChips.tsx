import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Alert } from "@/components/appAlert";
import { SqliteHealthRecordStore } from "@/data/persistence/SqliteHealthRecordStore";
import {
  loadExpectedSensorLifeDays,
  saveExpectedSensorLifeDays,
} from "@/data/todayCardPreferences";
import {
  deviceAgeChips,
  EXPECTED_SENSOR_LIFE_OPTIONS,
  sensorChangeDue,
  type DeviceAgeChip,
  type ExpectedSensorLifeDays,
} from "@/domain/deviceAge";
import type { ContextNoteEvent } from "@/domain/models";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

/**
 * Read-only ages from recorded sensor and site changes. No reminders or
 * notifications are created; nothing is shown without a record. On the last
 * expected sensor day the existing "Record sensor change" action is offered
 * here too (it is always available in the Log sheet).
 */
export function DeviceAgeChips({ onRecordSensorChange }: { onRecordSensorChange?(): void } = {}) {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const { demoMode, now, ownerIdentity, repository, revision } = useDataContext();
  const store = useMemo(() => new SqliteHealthRecordStore(), []);
  const [snapshot, setSnapshot] = useState<{ owner: string; notes: ContextNoteEvent[] }>();
  const [sensorLife, setSensorLife] = useState<ExpectedSensorLifeDays | null>(null);
  // Ages are shown in whole hours or days, so a 5-minute query clock is enough.
  const asOf = Math.floor(now / 300_000) * 300_000;

  useEffect(() => {
    let active = true;
    void loadExpectedSensorLifeDays().then((days) => {
      if (active) setSensorLife(days);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    if (demoMode || !repository) return;
    store.getRecentDeviceChangeNotes(asOf).then((notes) => {
      if (active) setSnapshot({ owner: ownerIdentity, notes });
    }).catch(() => {
      if (active) setSnapshot({ owner: ownerIdentity, notes: [] });
    });
    return () => { active = false; };
  }, [asOf, demoMode, ownerIdentity, repository, revision, store]);

  const notes = !demoMode && snapshot?.owner === ownerIdentity ? snapshot.notes : [];
  const chips = deviceAgeChips(notes, now, regional, sensorLife);
  if (!chips.length) return null;
  const showSensorChange = Boolean(onRecordSensorChange) && sensorChangeDue(chips, now, sensorLife);

  function chooseSensorLife(days: ExpectedSensorLifeDays | null) {
    setSensorLife(days);
    void saveExpectedSensorLifeDays(days).catch(() => {
      Alert.alert("Setting not saved", "The expected sensor life could not be saved. Please try again.");
    });
  }

  function showSource(chip: DeviceAgeChip) {
    const title = chip.kind === "sensor" ? "Sensor age" : "Site age";
    const message = `${chip.label}.\n\nCalculated from: ${chip.source}\n\nThis is the time since that record. It is not a reminder and does not change alerts.`;
    if (chip.kind !== "sensor") {
      Alert.alert(title, message);
      return;
    }
    Alert.alert(title, `${message}\n\nOptional: choose the expected life of your sensor to show “day N of N”.`, [
      ...EXPECTED_SENSOR_LIFE_OPTIONS.map((days) => ({
        text: `${days} days${sensorLife === days ? " (current)" : ""}`,
        onPress: () => chooseSensorLife(days),
      })),
      ...(sensorLife !== null ? [{ text: "Don’t show expected life", onPress: () => chooseSensorLife(null) }] : []),
      { text: "Close", style: "cancel" as const },
    ]);
  }

  return (
    <View accessibilityLabel="Sensor and site age" style={styles.row}>
      {chips.map((chip) => (
        <Pressable
          key={chip.kind}
          accessibilityRole="button"
          accessibilityLabel={chip.accessibilityLabel}
          accessibilityHint="Shows the record this age was calculated from"
          onPress={() => showSource(chip)}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.pill, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons accessibilityElementsHidden color={colors.textSecondary} name={chip.kind === "sensor" ? "radio-outline" : "bandage-outline"} size={15} />
          <Text style={[styles.label, { color: colors.text }]}>{chip.label}</Text>
        </Pressable>
      ))}
      {showSensorChange && onRecordSensorChange ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Record sensor change"
          accessibilityHint="Opens a form to record when you changed your sensor. Nothing is saved until you confirm. This does not start a sensor or change alerts."
          onPress={onRecordSensorChange}
          style={({ pressed }) => [
            styles.chip,
            { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.primary, borderRadius: radius.pill },
          ]}
        >
          <Ionicons accessibilityElementsHidden color={colors.primary} name="add-outline" size={17} />
          <Text style={[styles.label, { color: colors.primary }]}>Record sensor change</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  label: { flexShrink: 1, fontSize: 14, fontWeight: "700" },
});
