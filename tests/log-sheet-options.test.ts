import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "SafeAreaView" }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("@/theme/theme", () => ({ useAppTheme: () => ({ colors: {}, radius: {} }) }));

const {
  LOG_SHEET_HYPO_OPTION,
  LOG_SHEET_PRIMARY_OPTIONS,
  logEntryAccessibilityLabel,
  logSheetOptions,
} = await import("@/components/LogEntryLauncher");

describe("Log sheet", () => {
  it("puts Food, Insulin dose and Ketones first, with the hypo button above them", () => {
    expect(LOG_SHEET_HYPO_OPTION.kind).toBe("hypo-treatment");
    expect(LOG_SHEET_PRIMARY_OPTIONS.map((option) => option.label)).toEqual([
      "Food",
      "Insulin dose",
      "Ketones",
    ]);
  });

  it("keeps all twelve earlier entry types reachable and adds the meter reading", () => {
    const kinds = logSheetOptions().map((option) => option.kind);
    for (const kind of [
      "hypo-treatment", "food", "activity", "sleep", "weight", "medication", "insulin",
      "ketone", "note", "sensor-start", "site-change", "lab-result",
    ] as const) {
      expect(kinds).toContain(kind);
    }
    expect(kinds).toContain("meter-glucose");
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toHaveLength(13);
  });

  it("gives every button a plain spoken label", () => {
    expect(logEntryAccessibilityLabel(LOG_SHEET_PRIMARY_OPTIONS[1]!)).toBe("Log insulin dose");
    for (const option of logSheetOptions()) {
      expect(option.label.trim()).not.toBe("");
      expect(option.detail.trim()).not.toBe("");
    }
  });

  it("renames the context entry point to Log something", () => {
    const card = readFileSync(path.join(process.cwd(), "src/components/ManualContextCard.tsx"), "utf8");
    expect(card).toContain("Log something");
    expect(card).not.toContain('"Log context"');
    expect(card).not.toContain("Log health context");
  });
});
