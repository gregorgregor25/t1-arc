import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ChatGptConnectionCard } from "@/components/ChatGptConnectionCard";

type Props = ComponentProps<typeof ChatGptConnectionCard>;
type Node = { props?: Record<string, unknown>; children?: unknown[] };
const source = readFileSync(new URL("../src/components/ChatGptConnectionCard.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;

function render(changes: Partial<Props> = {}) {
  const props: Props = {
    state: { available: true, hasPendingRegistration: false, accounts: [], connected: false, models: [] },
    active: false, working: false, signingIn: false,
    onSignIn: vi.fn(), onStartFreshSignIn: vi.fn(), onCancelSignIn: vi.fn(), onSelectAccount: vi.fn(),
    onSelectModel: vi.fn(), onRefreshModels: vi.fn(), onUse: vi.fn(), onSignOut: vi.fn(), onLinkError: vi.fn(),
    ...changes,
  };
  const scope = {
    exports: {},
    React: { createElement: (type: unknown, attributes: object, ...children: unknown[]) => ({ type, props: attributes, children }) },
    require: (name: string) => {
      if (name === "@expo/vector-icons/Ionicons") return { default: "Icon" };
      if (name === "react-native") return { ActivityIndicator: "Spinner", Pressable: "Pressable", Text: "Text", View: "View", Linking: { openURL: vi.fn() } };
      if (name === "@/theme/theme") return { useAppTheme: () => ({ colors: {}, radius: {} }) };
      throw new Error(`Unexpected UI import: ${name}`);
    },
  };
  runInNewContext(compiled, scope);
  const tree = (scope.exports as { ChatGptConnectionCard(props: Props): Node }).ChatGptConnectionCard(props);
  const nodes: Node[] = [];
  function walk(node: unknown) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    nodes.push(node as Node);
    (node as Node).children?.forEach(walk);
  }
  walk(tree);
  function label(node: unknown): string {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(label).join("");
    return node && typeof node === "object" ? label((node as Node).children) : "";
  }
  const button = (text: string) => {
    const node = nodes.find(item => item.props?.accessibilityRole === "button" && label(item) === text);
    if (!node) throw new Error(`Missing button: ${text}`);
    return node;
  };
  return { props, nodes, label, button };
}

const disabledAccount = { id: "disabled-account", label: "Account A", hasSession: true, connected: false, models: [] };

describe("ChatGPT connection controls", () => {
  it("selects an inactive disabled account locally so it can be disconnected without reauthorizing", () => {
    const view = render({ state: { available: true, hasPendingRegistration: false, connected: false, models: [], accounts: [disabledAccount] } });
    const account = view.nodes.find(node => node.props?.accessibilityRole === "radio");
    (account?.props?.onPress as () => void)();
    expect(view.props.onSelectAccount).toHaveBeenCalledWith("disabled-account");
    expect(view.props.onSignIn).not.toHaveBeenCalled();
  });

  it("allows sign-out when the active account lacks plan permission", () => {
    const view = render({ state: { available: true, hasPendingRegistration: false, connected: false, models: [], accounts: [disabledAccount], activeAccountId: disabledAccount.id } });
    (view.button("Sign out of this ChatGPT connection").props?.onPress as () => void)();
    expect(view.props.onSignOut).toHaveBeenCalledOnce();
    (view.button("Continue with ChatGPT").props?.onPress as () => void)();
    expect(view.props.onSignIn).toHaveBeenCalledWith("disabled-account");
  });

  it("keeps a pending registration retry distinct from explicitly starting fresh", () => {
    const view = render({ state: { available: true, hasPendingRegistration: true, connected: false, models: [], accounts: [disabledAccount], activeAccountId: disabledAccount.id } });
    (view.button("Continue with ChatGPT").props?.onPress as () => void)();
    expect(view.props.onSignIn).toHaveBeenCalledWith(undefined);
    expect(view.props.onStartFreshSignIn).not.toHaveBeenCalled();
    (view.button("Start a new sign-in").props?.onPress as () => void)();
    expect(view.props.onStartFreshSignIn).toHaveBeenCalledOnce();
  });

  it("leaves cancellation available while sign-in is working", () => {
    const view = render({ working: true, signingIn: true });
    const cancel = view.button("Cancel sign-in");
    expect(cancel.props?.disabled).not.toBe(true);
    (cancel.props?.onPress as () => void)();
    expect(view.props.onCancelSignIn).toHaveBeenCalledOnce();
    expect(view.button("Continue with ChatGPT").props?.disabled).toBe(true);
  });
});
