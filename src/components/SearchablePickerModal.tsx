import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { filterPickerOptions, type PickerOption } from "@/domain/regionalPickerOptions";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useAppTheme } from "@/theme/theme";

/** A full-screen list with a search box, for choosing one of many options. */
export function SearchablePickerModal({
  onClose,
  onSelect,
  options,
  searchLabel,
  selected,
  title,
  visible,
}: {
  onClose(): void;
  onSelect(value: string): void;
  options: readonly PickerOption[];
  searchLabel: string;
  selected?: string;
  title: string;
  visible: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterPickerOptions(options, query), [options, query]);

  function close() {
    setQuery("");
    onClose();
  }

  return (
    <Modal
      animationType={reducedMotion ? "none" : "slide"}
      onRequestClose={close}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView style={[styles.page, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          <Pressable
            accessibilityLabel="Close without changing"
            accessibilityRole="button"
            onPress={close}
            style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons color={colors.text} name="close" size={24} />
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel={searchLabel}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setQuery}
          placeholder={searchLabel}
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.search,
            { borderColor: colors.border, borderRadius: radius.md, color: colors.text },
          ]}
          value={query}
        />
        <FlatList
          contentContainerStyle={styles.list}
          data={filtered}
          initialNumToRender={30}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.value}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              Nothing matches “{query.trim()}”. Try a city or a shorter name.
            </Text>
          }
          renderItem={({ item }) => {
            const active = item.value === selected;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => {
                  setQuery("");
                  onSelect(item.value);
                }}
                style={({ pressed }) => [
                  styles.row,
                  { borderBottomColor: colors.divider, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.label, { color: active ? colors.primary : colors.text }]}>
                  {item.label}
                </Text>
                {active ? (
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="checkmark"
                    size={20}
                  />
                ) : null}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  title: { flex: 1, fontSize: 20, lineHeight: 26, fontWeight: "800" },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  search: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  list: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 8 },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  label: { flex: 1, fontSize: 15, lineHeight: 21 },
  empty: { fontSize: 14, lineHeight: 20, marginTop: 16 },
});
