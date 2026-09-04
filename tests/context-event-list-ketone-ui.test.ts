import type { ReactNode } from "react";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextEventList } from "@/components/ContextEventList";
import { createManualContextEvent } from "@/data/manualContext";
import type { HealthContextEvent } from "@/domain/models";

vi.mock("@/providers/RegionalProfileProvider", () => ({
  useRegionalProfile: () => ({
    defaults: {
      locale: "en-GB",
      timeZone: "Europe/London",
      glucoseUnit: "mmolL",
      measurementSystem: "metric",
      energyUnit: "kcal",
    },
  }),
}));

interface AlertButton {
  text?: string;
  style?: string;
  onPress?: () => void;
}

const nativeMocks = vi.hoisted(() => ({
  alert: vi.fn<
    (title: string, message?: string, buttons?: AlertButton[]) => void
  >(),
}));

const hookRuntime = vi.hoisted(() => {
  interface EffectSlot {
    cleanup?: () => void;
    dependencies?: readonly unknown[];
  }

  const state: unknown[] = [];
  const initializedState = new Set<number>();
  const effects = new Map<number, EffectSlot>();
  let cursor = 0;
  let dirty = false;
  let pendingEffects: {
    callback: () => void | (() => void);
    dependencies?: readonly unknown[];
    index: number;
  }[] = [];

  function dependenciesMatch(
    left: readonly unknown[] | undefined,
    right: readonly unknown[] | undefined,
  ) {
    return (
      left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index]))
    );
  }

  return {
    beginRender() {
      cursor = 0;
      dirty = false;
      pendingEffects = [];
    },
    flushEffects() {
      for (const pending of pendingEffects) {
        const previous = effects.get(pending.index);
        previous?.cleanup?.();
        const cleanup = pending.callback();
        effects.set(pending.index, {
          cleanup: typeof cleanup === "function" ? cleanup : undefined,
          dependencies: pending.dependencies,
        });
      }
      pendingEffects = [];
    },
    needsRender() {
      return dirty;
    },
    reset() {
      for (const effect of effects.values()) effect.cleanup?.();
      state.length = 0;
      initializedState.clear();
      effects.clear();
      cursor = 0;
      dirty = false;
      pendingEffects = [];
    },
    useEffect(
      callback: () => void | (() => void),
      dependencies?: readonly unknown[],
    ) {
      const index = cursor++;
      const previous = effects.get(index);
      if (!dependenciesMatch(previous?.dependencies, dependencies)) {
        pendingEffects.push({ callback, dependencies, index });
      }
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!initializedState.has(index)) {
        state[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
        initializedState.add(index);
      }
      const setState = (next: T | ((current: T) => T)) => {
        const current = state[index] as T;
        const resolved =
          typeof next === "function"
            ? (next as (current: T) => T)(current)
            : next;
        if (!Object.is(current, resolved)) {
          state[index] = resolved;
          dirty = true;
        }
      };
      return [state[index] as T, setState] as const;
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: hookRuntime.useEffect,
    useState: hookRuntime.useState,
  };
});

vi.mock("react-native", () => ({
  Alert: { alert: nativeMocks.alert },
  Pressable: "Pressable",
  StyleSheet: {
    create: (styles: unknown) => styles,
    hairlineWidth: 1,
  },
  Text: "Text",
  View: "View",
}));

vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));

vi.mock("@/components/SectionCard", () => ({
  SectionCard: "SectionCard",
}));

vi.mock("@/domain/insights", () => ({
  buildContextEventEvidence: vi.fn(() => ({ id: "context-evidence" })),
}));

vi.mock("@/theme/theme", () => ({
  useAppTheme: () => ({
    colors: {
      accent: "accent",
      danger: "danger",
      divider: "divider",
      primary: "primary",
      text: "text",
      textSecondary: "text-secondary",
      textTertiary: "text-tertiary",
    },
  }),
}));

type ContextEventListProps = Parameters<typeof ContextEventList>[0];

interface TestElement {
  props: Record<string, unknown>;
  type: unknown;
}

function isTestElement(value: unknown): value is TestElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "props" in value &&
    "type" in value
  );
}

function collectElements(value: unknown, output: TestElement[] = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectElements(child, output);
    return output;
  }
  if (!isTestElement(value)) return output;
  output.push(value);
  collectElements(value.props.children, output);
  return output;
}

function queryByAccessibilityLabel(tree: ReactNode, label: string) {
  return collectElements(tree).find(
    (element) => element.props.accessibilityLabel === label,
  );
}

function getByAccessibilityLabel(tree: ReactNode, label: string) {
  const element = queryByAccessibilityLabel(tree, label);
  if (!element) throw new Error(`No rendered element labelled "${label}".`);
  return element;
}

function press(element: TestElement) {
  const onPress = element.props.onPress;
  if (typeof onPress !== "function") {
    throw new Error("Rendered element does not have an onPress handler.");
  }
  onPress();
}

function latestAlertButtons() {
  const latest = nativeMocks.alert.mock.calls.at(-1);
  if (!latest) throw new Error("Expected an alert.");
  return latest[2] ?? [];
}

function pressAlertButton(text: string) {
  const button = latestAlertButtons().find((candidate) => candidate.text === text);
  if (!button?.onPress) throw new Error(`No alert action labelled "${text}".`);
  button.onPress();
}

function mountContextEventList(initialProps: ContextEventListProps) {
  let props = initialProps;
  let tree: ReactNode;

  function render(nextProps = props) {
    props = nextProps;
    for (let pass = 0; pass < 10; pass += 1) {
      hookRuntime.beginRender();
      tree = ContextEventList(props);
      hookRuntime.flushEffects();
      if (!hookRuntime.needsRender()) return;
    }
    throw new Error("ContextEventList did not settle after rendering.");
  }

  render();
  return {
    get tree() {
      return tree;
    },
    rerender: render,
  };
}

function bloodKetone(
  id: string,
  value: number,
  timestamp: number,
): HealthContextEvent {
  return createManualContextEvent(
    { kind: "ketone", ketoneType: "blood", timestamp, value },
    { id, recordedAt: timestamp + 1_000 },
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

const BASE_TIME = Date.parse("2026-08-20T12:00:00+01:00");

describe("rendered manual ketone interactions", () => {
  beforeEach(() => {
    hookRuntime.reset();
    nativeMocks.alert.mockReset();
  });

  it("exposes an accessible destructive action and requires confirmation", () => {
    const event = bloodKetone("ketone-confirm", 1.7, BASE_TIME);
    const remove = vi.fn(async () => true);
    const view = mountContextEventList({
      events: [event],
      onDeleteManualKetone: remove,
    });

    const deleteButton = getByAccessibilityLabel(
      view.tree,
      "Delete Blood ketones · 1.7 mmol/L",
    );
    expect(deleteButton.type).toBe("Pressable");
    expect(deleteButton.props.accessibilityRole).toBe("button");
    expect(deleteButton.props.accessibilityHint).toMatch(/after confirmation/i);
    expect(deleteButton.props.accessibilityState).toEqual({ disabled: false });

    press(deleteButton);

    expect(remove).not.toHaveBeenCalled();
    expect(nativeMocks.alert).toHaveBeenCalledWith(
      "Remove this ketone reading?",
      '"Blood ketones · 1.7 mmol/L" will be permanently removed from T1 Arc.',
      expect.any(Array),
    );
    expect(latestAlertButtons()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Keep reading", style: "cancel" }),
        expect.objectContaining({ text: "Remove", style: "destructive" }),
      ]),
    );
  });

  it("locks conflicting actions while pending and tombstones a committed deletion", async () => {
    const first = bloodKetone("ketone-pending", 2.1, BASE_TIME + 60_000);
    const second = bloodKetone("ketone-other", 0.8, BASE_TIME);
    const pending = deferred<boolean>();
    const remove = vi.fn(() => pending.promise);
    const edit = vi.fn();
    const props: ContextEventListProps = {
      events: [first, second],
      onDeleteManualKetone: remove,
      onEditManualContext: edit,
    };
    const view = mountContextEventList(props);

    press(
      getByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 2.1 mmol/L",
      ),
    );
    pressAlertButton("Remove");
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("ketone-pending");

    view.rerender();
    const activeDelete = getByAccessibilityLabel(
      view.tree,
      "Delete Blood ketones · 2.1 mmol/L",
    );
    const otherDelete = getByAccessibilityLabel(
      view.tree,
      "Delete Blood ketones · 0.8 mmol/L",
    );
    const activeEdit = getByAccessibilityLabel(
      view.tree,
      "Edit Blood ketones · 2.1 mmol/L",
    );
    expect(activeDelete.props.disabled).toBe(true);
    expect(activeDelete.props.accessibilityState).toEqual({ disabled: true });
    expect(otherDelete.props.disabled).toBe(true);
    expect(otherDelete.props.accessibilityState).toEqual({ disabled: true });
    expect(activeEdit.props.disabled).toBe(true);
    expect(activeEdit.props.accessibilityState).toEqual({ disabled: true });

    pending.resolve(true);
    await flushAsyncWork();
    view.rerender();

    expect(
      queryByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 2.1 mmol/L",
      ),
    ).toBeUndefined();
    expect(
      getByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 0.8 mmol/L",
      ).props.disabled,
    ).toBe(false);

    view.rerender({ ...props, events: [...props.events] });
    expect(
      queryByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 2.1 mmol/L",
      ),
    ).toBeUndefined();
  });

  it("expands a limited list through an accessible Show all action", () => {
    const events = [
      bloodKetone("ketone-old", 0.4, BASE_TIME),
      bloodKetone("ketone-middle", 0.9, BASE_TIME + 60_000),
      bloodKetone("ketone-new", 1.4, BASE_TIME + 120_000),
    ];
    const view = mountContextEventList({
      events,
      limit: 1,
      onDeleteManualKetone: vi.fn(async () => true),
    });

    const showAll = getByAccessibilityLabel(
      view.tree,
      "Show all 3 context events",
    );
    expect(showAll.type).toBe("Pressable");
    expect(showAll.props.accessibilityRole).toBe("button");
    expect(
      collectElements(view.tree).filter((element) =>
        String(element.props.accessibilityLabel ?? "").startsWith("Delete "),
      ),
    ).toHaveLength(1);

    press(showAll);
    view.rerender();

    expect(
      collectElements(view.tree).filter((element) =>
        String(element.props.accessibilityLabel ?? "").startsWith("Delete "),
      ),
    ).toHaveLength(3);
    expect(
      queryByAccessibilityLabel(view.tree, "Show all 3 context events"),
    ).toBeUndefined();
  });

  it("keeps the row and unlocks deletion when the callback returns false", async () => {
    const event = bloodKetone("ketone-missing", 1.2, BASE_TIME);
    const remove = vi.fn(async () => false);
    const view = mountContextEventList({
      events: [event],
      onDeleteManualKetone: remove,
    });

    press(
      getByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 1.2 mmol/L",
      ),
    );
    pressAlertButton("Remove");
    await flushAsyncWork();
    view.rerender();

    expect(
      getByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 1.2 mmol/L",
      ).props.disabled,
    ).toBe(false);
    expect(nativeMocks.alert).toHaveBeenLastCalledWith(
      "Ketone reading not removed",
      expect.stringMatching(/refresh, then try again/i),
    );
  });

  it("keeps the row and unlocks deletion when the callback throws", async () => {
    const event = bloodKetone("ketone-failed", 2.6, BASE_TIME);
    const remove = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const view = mountContextEventList({
      events: [event],
      onDeleteManualKetone: remove,
    });

    press(
      getByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 2.6 mmol/L",
      ),
    );
    pressAlertButton("Remove");
    await flushAsyncWork();
    view.rerender();

    expect(
      getByAccessibilityLabel(
        view.tree,
        "Delete Blood ketones · 2.6 mmol/L",
      ).props.disabled,
    ).toBe(false);
    expect(nativeMocks.alert).toHaveBeenLastCalledWith(
      "Couldn't remove ketone reading",
      expect.stringMatching(/refresh, then try again/i),
    );
  });
});
