import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SectionCard } from "@/components/SectionCard";
import { ListGroup, ListRow } from "@/components/ui";
import type { SettingsSearchEntry } from "@/navigation/settingsSearch";
import { useAppTheme } from "@/theme/theme";

export function SettingsSearchBox({
  onChange,
  value,
}: {
  onChange(value: string): void;
  value: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.searchBox,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <Ionicons
        accessibilityElementsHidden
        color={colors.textTertiary}
        name="search-outline"
        size={19}
      />
      <TextInput
        accessibilityHint="Shows matching settings as you type"
        accessibilityLabel="Search settings"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChange}
        placeholder="Search, for example alarms or backup"
        placeholderTextColor={colors.textTertiary}
        returnKeyType="search"
        style={[styles.searchInput, { color: colors.text }]}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onChange("")}
          style={({ pressed }) => [
            styles.searchClear,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textSecondary}
            name="close-circle"
            size={20}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export function SettingsSearchResults({
  onSelect,
  results,
}: {
  onSelect(entry: SettingsSearchEntry): void;
  results: readonly SettingsSearchEntry[];
}) {
  const { colors } = useAppTheme();
  if (!results.length) {
    return (
      <SectionCard accessibilityLabel="No matching settings. Try a shorter word, such as alarms, backup, units or Libre.">
        <Text style={[styles.emptyTitle, { color: colors.text }]}>
          No matching settings
        </Text>
        <Text style={[styles.emptyDetail, { color: colors.textSecondary }]}>
          Try a shorter word, such as alarms, backup, units or Libre.
        </Text>
      </SectionCard>
    );
  }
  return (
    <View accessibilityLiveRegion="polite">
      <ListGroup>
        {results.map((entry) => (
          <ListRow
            accessibilityHint={`Opens ${entry.label} in ${entry.location}`}
            accessibilityLabel={`${entry.label}. ${entry.detail}`}
            detail={`${entry.location} · ${entry.detail}`}
            key={entry.id}
            onPress={() => onSelect(entry)}
            title={entry.label}
          />
        ))}
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 12,
    paddingRight: 6,
    marginTop: 4,
    marginBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    fontSize: 15,
  },
  searchClear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  emptyDetail: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});
