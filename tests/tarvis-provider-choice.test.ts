import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  isTarvisProviderReady,
  tarvisProviderSwitchCopy,
  tarvisProviderSwitchOffer,
  tarvisSettingsViewProvider,
  type TarvisProviderChoiceInput,
} from "@/data/tarvis/providerChoice";

const none = { openai: false, gemini: false, claude: false, chatgpt: false };
const chatGptReady = {
  available: true,
  connected: true,
  models: [{ slug: "model-a", displayName: "Model A" }],
  selectedModel: "model-a",
};

function input(changes: Partial<TarvisProviderChoiceInput>): TarvisProviderChoiceInput {
  return { provider: "openai", hasApiKey: false, configuredProviders: none, ...changes };
}

describe("which AI connection settings show", () => {
  it("keeps the saved provider when it works", () => {
    const value = input({ hasApiKey: true, configuredProviders: { ...none, openai: true, chatgpt: true }, chatGpt: chatGptReady });
    expect(tarvisSettingsViewProvider(value)).toBe("openai");
    expect(tarvisProviderSwitchOffer(value)).toBeUndefined();
  });

  it("after the OpenAI key is removed, shows ChatGPT and offers a one-tap switch", () => {
    const value = input({ configuredProviders: { ...none, chatgpt: true }, chatGpt: chatGptReady });
    expect(tarvisSettingsViewProvider(value)).toBe("chatgpt");
    expect(tarvisProviderSwitchOffer(value)).toBe("chatgpt");
    expect(tarvisProviderSwitchCopy(value, "chatgpt")).toEqual({
      title: "OpenAI is not set up",
      detail: "ChatGPT is ready on this phone. Use it for AI answers? Local answers keep working either way.",
      action: "Use ChatGPT",
    });
  });

  it("offers another saved key when ChatGPT is not connected", () => {
    const value = input({ configuredProviders: { ...none, claude: true } });
    expect(tarvisProviderSwitchOffer(value)).toBe("claude");
    expect(tarvisSettingsViewProvider(value)).toBe("claude");
  });

  it("does not offer ChatGPT while it has no usable model", () => {
    const noModel = { ...chatGptReady, selectedModel: undefined };
    const value = input({ configuredProviders: { ...none, chatgpt: true }, chatGpt: noModel });
    expect(isTarvisProviderReady("chatgpt", value)).toBe(false);
    expect(tarvisProviderSwitchOffer(value)).toBeUndefined();
    // Signed in, so ChatGPT is shown for its model choice rather than the key-less saved provider.
    expect(tarvisSettingsViewProvider(value)).toBe("chatgpt");
  });

  it("does not offer a model that is no longer listed", () => {
    const gone = { ...chatGptReady, selectedModel: "gone" };
    expect(isTarvisProviderReady("chatgpt", input({ configuredProviders: { ...none, chatgpt: true }, chatGpt: gone }))).toBe(false);
  });

  it("keeps the saved provider when nothing is set up, so its setup form shows", () => {
    expect(tarvisSettingsViewProvider(input({ provider: "gemini" }))).toBe("gemini");
    expect(tarvisProviderSwitchOffer(input({ provider: "gemini" }))).toBeUndefined();
  });

  it("never offers the provider that is already saved", () => {
    const value = input({ provider: "chatgpt", configuredProviders: { ...none, chatgpt: true }, chatGpt: chatGptReady });
    expect(tarvisProviderSwitchOffer(value)).toBeUndefined();
  });
});

describe("Tarv1s settings screen wiring", () => {
  const screen = readFileSync("src/screens/TarvisScreen.tsx", "utf8");

  it("chooses the shown connection with the shared rule on load, refresh and close", () => {
    expect(screen.match(/setSelectedProvider\(tarvisSettingsViewProvider\(settings\)\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(screen).toContain("setSelectedProvider(tarvisSettingsViewProvider({ provider, hasApiKey, configuredProviders, chatGpt: chatGptState }))");
    expect(screen).not.toContain("setSelectedProvider(settings.provider);\n      setConfiguredProviders(settings.configuredProviders);\n      setSelectedModels");
  });

  it("shows the switch offer before the provider list and uses the saved selection path", () => {
    const offer = screen.indexOf("<TarvisProviderSwitchOffer");
    expect(offer).toBeGreaterThan(-1);
    expect(offer).toBeLessThan(screen.indexOf("CHOOSE A CONNECTION"));
    expect(screen).toContain("onUse={() => void switchToReadyProvider(providerSwitchOffer)}");
    expect(screen).toContain("await selectTarvisProvider(next, writeLease, savedModels[next]);");
  });
});

describe("switch offer control", () => {
  const source = readFileSync("src/components/tarvis/TarvisProviderSwitchOffer.tsx", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;

  function render(disabled: boolean) {
    const onUse = vi.fn();
    const scope = {
      exports: {},
      React: { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props, children }) },
      require: (name: string) => {
        if (name === "@expo/vector-icons/Ionicons") return { default: "Icon" };
        if (name === "react-native") return { Pressable: "Pressable", Text: "Text", View: "View" };
        if (name === "@/theme/theme") return { useAppTheme: () => ({ colors: {}, radius: {} }) };
        throw new Error(`Unexpected import: ${name}`);
      },
    };
    runInNewContext(compiled, scope);
    const tree = (scope.exports as { TarvisProviderSwitchOffer(props: object): unknown }).TarvisProviderSwitchOffer({
      title: "OpenAI is not set up", detail: "ChatGPT is ready.", action: "Use ChatGPT", disabled, onUse,
    });
    const nodes: { props?: Record<string, unknown>; children?: unknown[] }[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      nodes.push(node as never);
      (node as { children?: unknown[] }).children?.forEach(walk);
    };
    walk(tree);
    return { nodes, onUse, text: JSON.stringify(tree) };
  }

  it("names both connections and switches in one tap", () => {
    const view = render(false);
    expect(view.text).toContain("OpenAI is not set up");
    expect(view.text).toContain("Use ChatGPT");
    const button = view.nodes.find((node) => node.props?.accessibilityRole === "button");
    (button?.props?.onPress as () => void)();
    expect(view.onUse).toHaveBeenCalledOnce();
  });

  it("is disabled while settings are busy", () => {
    const button = render(true).nodes.find((node) => node.props?.accessibilityRole === "button");
    expect(button?.props?.disabled).toBe(true);
  });
});
