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
  type DeviceAgeChip,
  type ExpectedSensorLifeDays,
} from "@/domain/deviceAge";
import type { ContextNoteEvent } from "@/domain/models";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

/**
 * Read-only ages from recorded sensor and site changes. No reminders or
 * notifications are created; nothing is shown without a record.
 */
export function DeviceAgeChips() {
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
          hitSlop={{ top: 4, bottom: 4 }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, fontWeight: "700" },
});
