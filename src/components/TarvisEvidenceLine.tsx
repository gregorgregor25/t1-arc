import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import {
  formatTarvisEvidenceLine,
  type TarvisEvidenceLineData,
} from "@/data/tarvis/evidenceLine";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

/**
 * Fixed line under a personal-data answer. Built on this phone from the
 * records used, never from model-written text.
 */
export function TarvisEvidenceLine({ data }: { data?: TarvisEvidenceLineData }) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  if (!data) return null;
  const text = formatTarvisEvidenceLine(data, regional);
  return (
    <View accessible accessibilityLabel={text} style={styles.row}>
      <Ionicons accessibilityElementsHidden color={colors.textTertiary} name="analytics-outline" size={14} />
      <Text style={[styles.text, { color: colors.textTertiary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  text: { flex: 1, fontSize: 12, lineHeight: 17 },
});
