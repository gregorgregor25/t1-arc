import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearTarvisProviderCooldownsForTests, fetchTarvisProviderResponse } from "@/data/tarvis/providerTransport";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

const screenSource = readFileSync(new URL("../src/screens/TarvisScreen.tsx", import.meta.url), "utf8");
const screen = ts.createSourceFile("TarvisScreen.tsx", screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function screenExpression(name: "sendGuard" | "canSendQuestion") {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (name === "sendGuard" && ts.isFunctionDeclaration(node) && node.name?.text === "sendQuestion") {
      const guard = node.body?.statements.find((statement): statement is ts.IfStatement =>
        ts.isIfStatement(statement) && statement.expression.getText(screen).includes("!prompt"),
      );
      if (!guard || !ts.isReturnStatement(guard.thenStatement)) {
        throw new Error("Tarv1s send guard was not found");
      }
      expression = guard.expression;
      return;
    }
    if (name === "canSendQuestion" && ts.isVariableDeclaration(node) && node.name.getText(screen) === name) {
      expression = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(screen);
  if (!expression) throw new Error(`Tarv1s ${name} expression was not found`);
  return expression.getText(screen);
}

const sendGuard = screenExpression("sendGuard");
const canSendQuestion = screenExpression("canSendQuestion");

function screenState(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "How many low glucose events have I had in the last 7 days?",
    question: "How many low glucose events have I had in the last 7 days?",
    workingRef: { current: false }, working: false, settingsWorking: false,
    loadingSettings: false, conversationLoaded: true,
    retryAt: Date.now() + 90_000,
    Date,
    Boolean,
    ...overrides,
  };
}

function evaluate(expression: string, state: Record<string, unknown>) {
  return runInNewContext(`(${expression})`, state) as boolean;
}

const asOf = Date.parse("2026-09-24T12:00:00+01:00");

describe("Tarv1s provider cooldown and local questions", () => {
  beforeEach(() => { clearTarvisProviderCooldownsForTests(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("keeps the actual screen send action available for an exact local low count during a cooldown", () => {
    const state = screenState();
    expect(coordinateTarvisRequest({ question: String(state.question), asOf }).kind).toBe("scoped-glucose");
    expect(evaluate(sendGuard, state)).toBe(false);
    expect(evaluate(canSendQuestion, state)).toBe(true);
  });

  it("retains the screen's empty, loading and in-flight guards", () => {
    for (const change of [
      { prompt: "", question: "" },
      { loadingSettings: true },
      { conversationLoaded: false },
      { workingRef: { current: true }, working: true },
      { settingsWorking: true },
    ]) {
      const state = screenState(change);
      expect(evaluate(sendGuard, state)).toBe(true);
      expect(evaluate(canSendQuestion, state)).toBe(false);
    }
  });

  it("keeps a real provider 429 cooldown at the transport while local routing remains available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", {
      status: 429, headers: { "Retry-After": "90" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      method: "POST",
      body: JSON.stringify({ model: "gemini-3.8-flash", instructions: "Synthetic education", input: [
        { role: "user", content: [{ type: "input_text", text: "What does HbA1c mean?" }] },
      ], max_output_tokens: 200, text: { format: { name: "answer", schema: { type: "object" } } } }),
      signal: new AbortController().signal,
    };
    const hosted = "What does HbA1c mean?";
    expect(coordinateTarvisRequest({ question: hosted, asOf }).kind).toBe("model-education");
    await expect(fetchTarvisProviderResponse("gemini", "synthetic-key", "https://example.invalid", request))
      .rejects.toMatchObject({ retryAt: expect.any(Number) });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const local = "How many low glucose events have I had in the last 7 days?";
    expect(coordinateTarvisRequest({ question: local, asOf }).kind).toBe("scoped-glucose");
    expect(evaluate(sendGuard, screenState({ question: local, prompt: local }))).toBe(false);
    await expect(fetchTarvisProviderResponse("gemini", "synthetic-key", "https://example.invalid", request))
      .rejects.toMatchObject({ retryAt: expect.any(Number) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
