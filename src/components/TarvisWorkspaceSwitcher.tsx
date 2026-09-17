import { StyleSheet, View } from "react-native";

import { SegmentedControl } from "@/components/SegmentedControl";

export type TarvisWorkspace = "tarvis" | "insights";
export const DEFAULT_TARVIS_WORKSPACE: TarvisWorkspace = "tarvis";

export function TarvisWorkspaceSwitcher({
  value,
  onChange,
}: {
  value: TarvisWorkspace;
  onChange(value: TarvisWorkspace): void;
}) {
  return (
    <View style={styles.frame}>
      <SegmentedControl
        accessibilityLabel="Tarv1s workspace"
        options={[
          { value: "tarvis", label: "Tarv1s" },
          { value: "insights", label: "Insights" },
        ]}
        value={value}
        onChange={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginBottom: 20,
  },
});
