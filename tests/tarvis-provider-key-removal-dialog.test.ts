import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { TARVIS_PROVIDERS, type TarvisProvider } from "@/data/tarvis/providers";

const source = readFileSync(new URL("../src/screens/TarvisScreen.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("TarvisScreen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dialog: ts.FunctionDeclaration | undefined;
let providerWiring: string | undefined;
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "TarvisConfirmationDialog") dialog = node;
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "TarvisConfirmationDialog") {
    const attribute = node.attributes.properties.find(property =>
      ts.isJsxAttribute(property) && property.name.getText(parsed) === "provider",
    );
    if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      providerWiring = attribute.initializer.expression?.getText(parsed);
    }
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
if (!dialog) throw new Error("Tarv1s confirmation dialog was not found");
const compiled = ts.transpileModule(`${dialog.getText(parsed)}\nexport { TarvisConfirmationDialog };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;

function renderDialog(confirmation: string, provider: TarvisProvider) {
  const scope = {
    exports: {},
    React: { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props, children }) },
    useAppTheme: () => ({ colors: { accent: "#123", text: "#123", textSecondary: "#456", onPrimary: "#fff" }, radius: {} }),
    TARVIS_PROVIDERS,
    styles: {},
    Modal: "Modal", View: "View", Pressable: "Pressable", Text: "Text",
    Ionicons: "Ionicons", ActivityIndicator: "ActivityIndicator",
  };
  runInNewContext(compiled, scope);
  const call = scope.exports as {
    TarvisConfirmationDialog(props: { confirmation: string; provider: TarvisProvider; onCancel(): void; onConfirm(): void; working: boolean }): unknown;
  };
  return JSON.stringify(call.TarvisConfirmationDialog({
    confirmation, provider, onCancel: vi.fn(), onConfirm: vi.fn(), working: false,
  }));
}

describe("Tarv1s selected-provider key removal confirmation", () => {
  it("passes the currently selected settings provider to the actual dialog", () => {
    expect(providerWiring).toBe("selectedProvider");
  });

  it.each(["openai", "gemini", "claude"] as const)("names only the %s key and preserves other providers", provider => {
    const rendered = renderDialog("remove-key", provider);
    expect(rendered).toContain(`Remove ${TARVIS_PROVIDERS[provider].label} key?`);
    expect(rendered).toContain(`Only the saved ${TARVIS_PROVIDERS[provider].label} API key will be removed`);
    expect(rendered).toContain("Any other saved provider keys remain unchanged");
    expect(rendered).toContain("supported local answers still work");
    expect(rendered).toContain("Remove key");
    expect(rendered).toContain("Keep key");
    expect(rendered).not.toContain("Disconnect broader answers?");
  });

  it("keeps conversation confirmation actions distinct from key removal", () => {
    expect(renderDialog("new-conversation", "gemini")).toContain("Start a new conversation?");
    expect(renderDialog("delete-conversation", "gemini")).toContain("Delete this conversation?");
  });
});
