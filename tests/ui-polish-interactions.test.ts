import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DateNavigator } from "@/components/DateNavigator";
import { DemoModeNotice } from "@/components/DemoModeNotice";
import { EmptyState } from "@/components/EmptyState";
import { FullscreenChartModal } from "@/components/FullscreenChart";

const data = vi.hoisted(() => ({
  demoMode: false,
  reduceMotion: false,
  setDataMode: vi.fn<() => Promise<void>>(),
}));
vi.mock("@/providers/DataProvider", () => ({ useDataContext: () => data }));
vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => data.reduceMotion,
}));
vi.mock("expo-screen-orientation", () => ({
  lockAsync: vi.fn().mockResolvedValue(undefined),
  OrientationLock: { PORTRAIT_UP: 1, LANDSCAPE: 2 },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
}));
vi.mock("@/theme/theme", () => ({
  useAppTheme: () => ({
    colors: {
      text: "#111111",
      textSecondary: "#555555",
      primary: "#3156B8",
      onPrimary: "#FFFFFF",
      surfaceMuted: "#EEEEEE",
      border: "#DDDDDD",
    },
    radius: { sm: 8, md: 13 },
  }),
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof import("react")>()),
  useState: (initial: unknown) => [
    typeof initial === "function" ? initial() : initial,
    vi.fn(),
  ],
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
}));
vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  Modal: "Modal",
  ScrollView: "ScrollView",
  Platform: { OS: "android" },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
}));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: "DateTimePicker",
}));

type ElementProps = {
  children?: ReactNode;
  accessibilityLabel?: string;
  onPress?: () => void;
  name?: string;
  [key: string]: unknown;
};
function nodes(root: ReactNode): { type: unknown; props: ElementProps }[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<ElementProps>(root)) return [];
  return [
    { type: root.type, props: root.props },
    ...nodes(root.props.children),
  ];
}
function text(root: ReactNode): string {
  if (typeof root === "string" || typeof root === "number") return String(root);
  if (Array.isArray(root)) return root.map(text).join(" ");
  return isValidElement<ElementProps>(root) ? text(root.props.children) : "";
}

beforeEach(() => {
  data.demoMode = false;
  data.reduceMotion = false;
  data.setDataMode.mockReset();
});

describe("empty-state actions", () => {
  it("shows an actionable next step without implying an offline failure", () => {
    const onPress = vi.fn();
    const view = EmptyState({
      title: "No records",
      detail: "Choose a source.",
      action: { label: "Connect a source", onPress },
    });
    const button = nodes(view).find((node) => node.type === "Pressable");
    expect(text(button?.props.children)).toContain("Connect a source");
    expect(
      nodes(view).find((node) => node.type === "Ionicons")?.props.name,
    ).toBe("file-tray-outline");
    button?.props.onPress?.();
    expect(onPress).toHaveBeenCalledOnce();
  });
  it("does not invent a button when no action is supplied", () => {
    expect(
      nodes(
        EmptyState({ title: "No records", detail: "Try another date." }),
      ).some((node) => node.type === "Pressable"),
    ).toBe(false);
  });
});

describe("return to today", () => {
  const base: Parameters<typeof DateNavigator>[0] = {
    date: "2026-09-02",
    latestDate: "2026-09-05",
    todayDate: "2026-09-05",
    earliestDate: "2026-08-01",
    canGoBack: true,
    canGoForward: true,
    isToday: false,
    onBack: vi.fn(),
    onForward: vi.fn(),
  };
  it("passes the analysis-calendar date through without reinterpreting time zones", () => {
    const onDateChange = vi.fn();
    const button = nodes(DateNavigator({ ...base, onDateChange })).find(
      (node) => node.props.accessibilityLabel === "Back to today",
    );
    expect(button).toBeDefined();
    button?.props.onPress?.();
    expect(onDateChange).toHaveBeenCalledExactlyOnceWith("2026-09-05");
  });
  it("omits the extra action when already on today or date changes are unavailable", () => {
    expect(
      nodes(
        DateNavigator({ ...base, isToday: true, onDateChange: vi.fn() }),
      ).some((node) => node.props.accessibilityLabel === "Back to today"),
    ).toBe(false);
    expect(
      nodes(DateNavigator(base)).some(
        (node) => node.props.accessibilityLabel === "Back to today",
      ),
    ).toBe(false);
  });
  it("never labels a capped review period as today", () => {
    expect(
      nodes(
        DateNavigator({ ...base, onDateChange: vi.fn(), todayDate: undefined }),
      ).some((node) => node.props.accessibilityLabel === "Back to today"),
    ).toBe(false);
    expect(
      nodes(
        DateNavigator({
          ...base,
          onDateChange: vi.fn(),
          latestDate: "2026-09-04",
        }),
      ).some((node) => node.props.accessibilityLabel === "Back to today"),
    ).toBe(false);
  });
});

describe("demo identity", () => {
  it.each([false, true])(
    "keeps expanded charts identified and respects reduced motion: %s",
    (demoMode) => {
      data.demoMode = demoMode;
      data.reduceMotion = demoMode;
      const view = FullscreenChartModal({
        title: "Glucose",
        children: null,
        visible: true,
        onClose: vi.fn(),
      });
      expect(text(view)).toContain(
        demoMode ? "DEMO · EXAMPLE DATA" : "LANDSCAPE GRAPH",
      );
      expect(
        nodes(view).find((node) => node.type === "Modal")?.props.animationType,
      ).toBe(demoMode ? "none" : "slide");
    },
  );
  it("is absent for personal data", () => {
    expect(DemoModeNotice()).toBeNull();
  });
  it("labels examples and prevents duplicate exit requests", async () => {
    data.demoMode = true;
    let finish!: () => void;
    data.setDataMode.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = DemoModeNotice()!;
    const view = (wrapper.type as (props: typeof wrapper.props) => ReactNode)(
      wrapper.props,
    );
    expect(text(view)).toContain("Not your personal records");
    const exit = nodes(view).find((node) => node.type === "Pressable");
    exit?.props.onPress?.();
    exit?.props.onPress?.();
    expect(data.setDataMode).toHaveBeenCalledExactlyOnceWith("live");
    finish();
    await Promise.resolve();
  });
});
