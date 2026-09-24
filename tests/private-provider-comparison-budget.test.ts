import { mkdtempSync, openSync, closeSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComparisonBudgetStop,
  inspectComparisonLedger,
  MODEL_RATES,
  reserveComparisonRequest,
  settleComparisonRequest,
  validatedNativeUsage,
} from "../scripts/private-provider-comparison/budget";
import { boundedAppFailureMessage, boundedNativeErrorDiagnostic } from "../scripts/private-provider-comparison/diagnostics";
import { assertGeminiDispatchApproval } from "../scripts/private-provider-comparison/accessGate";
import { fetchTarvisProviderResponse } from "@/data/tarvis/providerTransport";
import { DISCRIMINATING_QUESTIONS, scoreDiscriminatingCase } from "../scripts/private-provider-comparison/qualityChecks";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

const temporaryDirectories: string[] = [];
function ledgerPath() {
  const directory = mkdtempSync(join(tmpdir(), "t1arc-provider-budget-"));
  temporaryDirectories.push(directory);
  return join(directory, "ledger.json");
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("private provider comparison budget", () => {
  it("reserves native output floors before dispatch, including request schema bytes", () => {
    const path = ledgerPath();
    const row = reserveComparisonRequest(path, {
      caseId: "general-explanation", model: "claude-opus-5-5", provider: "claude",
      requestBytes: 10_000, maxOutputTokens: 2048,
      approvedModels: new Set(["claude-opus-5-5"]),
    });
    expect(row.inputReserveTokens).toBe(14_048);
    expect(row.outputReserveTokens).toBe(2048);
    expect(row.reservedUsd).toBeGreaterThan(0.09);
    expect(inspectComparisonLedger(path).spentOrReservedUsd).toBe(row.reservedUsd);
  });

  it("retains failed reservations and refuses duplicate or cumulative overspend", () => {
    const path = ledgerPath();
    const request = {
      model: "claude-opus-5-5" as const, provider: "claude" as const,
      requestBytes: 60_000, maxOutputTokens: 2048,
      approvedModels: new Set(["claude-opus-5-5"]),
    };
    const first = reserveComparisonRequest(path, { ...request, caseId: "case-a" });
    settleComparisonRequest(path, first.id, { status: "failed", inputTokens: 2, outputTokens: 1 });
    expect(inspectComparisonLedger(path).spentOrReservedUsd).toBe(first.reservedUsd);
    expect(() => reserveComparisonRequest(path, { ...request, caseId: "case-a" })).toThrowError(ComparisonBudgetStop);
    let stopped = false;
    for (let index = 0; index < 20; index += 1) {
      try { reserveComparisonRequest(path, { ...request, caseId: `case-${index}` }); }
      catch (error) {
        expect(error).toMatchObject({ code: "budget" });
        stopped = true;
        break;
      }
    }
    expect(stopped).toBe(true);
    expect(inspectComparisonLedger(path).spentOrReservedUsd).toBeLessThanOrEqual(1);
  });

  it("releases unused successful reserve only with valid usage and denies unapproved parameters", () => {
    const path = ledgerPath();
    expect(() => reserveComparisonRequest(path, {
      caseId: "case-a", model: "claude-sonnet-5", provider: "claude",
      requestBytes: 1000, maxOutputTokens: 2048, approvedModels: new Set(),
    })).toThrowError(ComparisonBudgetStop);
    const row = reserveComparisonRequest(path, {
      caseId: "case-a", model: "claude-sonnet-5", provider: "claude",
      requestBytes: 1000, maxOutputTokens: 2048, approvedModels: new Set(["claude-sonnet-5"]),
    });
    const settled = settleComparisonRequest(path, row.id, {
      status: "accepted", inputTokens: 500, outputTokens: 100,
    });
    expect(settled.settledUsd).toBeLessThan(row.reservedUsd);
    expect(inspectComparisonLedger(path).spentOrReservedUsd).toBe(settled.actualUsd);
    expect(() => reserveComparisonRequest(path, {
      caseId: "case-b", model: "claude-sonnet-5", provider: "claude",
      requestBytes: 1000, maxOutputTokens: 800, approvedModels: new Set(["claude-sonnet-5"]),
    })).toThrowError(ComparisonBudgetStop);
  });

  it("stops while another process holds the ledger lock", () => {
    const path = ledgerPath();
    const lock = `${path}.lock`;
    const fd = openSync(lock, "wx");
    try {
      expect(() => inspectComparisonLedger(path)).toThrowError(ComparisonBudgetStop);
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  });

  it("keeps the full reserve when native usage is missing, zero, malformed or has unexpected cache creation", () => {
    const path = ledgerPath();
    const row = reserveComparisonRequest(path, {
      caseId: "case-a", model: "claude-sonnet-5", provider: "claude",
      requestBytes: 1000, maxOutputTokens: 2048, approvedModels: new Set(["claude-sonnet-5"]),
    });
    expect(validatedNativeUsage("claude", { usage: {} })).toBeUndefined();
    expect(validatedNativeUsage("claude", { usage: { input_tokens: 0, output_tokens: 5 } })).toBeUndefined();
    expect(validatedNativeUsage("claude", { usage: { input_tokens: "500", output_tokens: 5 } })).toBeUndefined();
    expect(validatedNativeUsage("claude", { usage: {
      input_tokens: 500, output_tokens: 5, cache_creation_input_tokens: 100,
    } })).toBeUndefined();
    expect(validatedNativeUsage("gemini", { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 10 } }))
      .toEqual({ inputTokens: 100, outputTokens: 40 });
    settleComparisonRequest(path, row.id, { status: "accepted", ...validatedNativeUsage("claude", { usage: {} }) });
    expect(inspectComparisonLedger(path).spentOrReservedUsd).toBe(row.reservedUsd);
  });

  it("records only bounded native diagnostic fields and redacts app messages", () => {
    const syntheticKey = ["sk", "ant", "synthetic".repeat(4)].join("-");
    expect(boundedNativeErrorDiagnostic({ error: {
      code: 400, status: "INVALID_ARGUMENT", param: "generationConfig.responseJsonSchema",
      message: `private request and ${syntheticKey}`,
      details: [{ reason: "SCHEMA_UNSUPPORTED" }],
    } })).toEqual({
      code: "400", status: "INVALID_ARGUMENT", param: "generationConfig.responseJsonSchema",
      reason: "SCHEMA_UNSUPPORTED",
    });
    expect(boundedNativeErrorDiagnostic({ error: {
      code: "sk-ant-secret-key", status: "contains spaces and private text",
      reason: "AQ.secret-key", message: "private message",
    } })).toBeUndefined();
    expect(boundedAppFailureMessage(new Error(`Google Gemini failed for ${syntheticKey}`)))
      .toBe("Google Gemini failed for [REDACTED]");
    expect(boundedAppFailureMessage(new Error("private provider response body"))).toBeUndefined();
  });

  it("requires one verified Gemini quota mode and explicit paid authorization", () => {
    const gemini = new Set(["gemini-3.8-flash"]);
    expect(() => assertGeminiDispatchApproval(gemini, {
      T1ARC_PRIVATE_GEMINI_FREE_QUOTA_VERIFIED: "YES",
    })).not.toThrow();
    expect(() => assertGeminiDispatchApproval(gemini, {
      T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED: "YES",
      T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED: "YES",
    })).not.toThrow();
    expect(() => assertGeminiDispatchApproval(gemini, {
      T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED: "YES",
    })).toThrow(/explicit user authorization/i);
    expect(() => assertGeminiDispatchApproval(gemini, {
      T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED: "YES",
    })).toThrow(/verified paid quota/i);
    expect(() => assertGeminiDispatchApproval(gemini, {
      T1ARC_PRIVATE_GEMINI_FREE_QUOTA_VERIFIED: "NO",
      T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED: "YES",
      T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED: "YES",
    })).toThrow(/exactly one mode/i);
    expect(() => assertGeminiDispatchApproval(gemini, {
      T1ARC_PRIVATE_GEMINI_FREE_QUOTA_VERIFIED: "YES",
      T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED: "YES",
      T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED: "YES",
    })).toThrow(/exactly one mode/i);
    expect(() => assertGeminiDispatchApproval(new Set(["claude-sonnet-5"]), {})).not.toThrow();
  });

  it("requires verified 3.7 access and charges both Gemini models against the same ledger", () => {
    const gemini37 = new Set(["gemini-3.7-flash"]);
    const paid = {
      T1ARC_PRIVATE_GEMINI_PAID_QUOTA_VERIFIED: "YES",
      T1ARC_PRIVATE_GEMINI_PAID_USER_AUTHORIZED: "YES",
    };
    expect(() => assertGeminiDispatchApproval(gemini37, paid)).toThrow(/verified model access/i);
    expect(() => assertGeminiDispatchApproval(gemini37, {
      ...paid, T1ARC_PRIVATE_GEMINI_37_ACCESS_VERIFIED: "YES",
    })).not.toThrow();
    expect(MODEL_RATES["gemini-3.7-flash"]).toEqual(MODEL_RATES["gemini-3.8-flash"]);

    const path = ledgerPath();
    const approvedModels = new Set(["gemini-3.8-flash", "gemini-3.7-flash"]);
    const older = reserveComparisonRequest(path, {
      caseId: "general-explanation", model: "gemini-3.8-flash", provider: "gemini",
      requestBytes: 1000, maxOutputTokens: 4096, approvedModels,
    });
    const newer = reserveComparisonRequest(path, {
      caseId: "general-explanation", model: "gemini-3.7-flash", provider: "gemini",
      requestBytes: 1000, maxOutputTokens: 4096, approvedModels,
    });
    expect(older.outputReserveTokens).toBe(4096);
    expect(newer.outputReserveTokens).toBe(4096);
    expect(inspectComparisonLedger(path).spentOrReservedUsd).toBeCloseTo(older.reservedUsd + newer.reservedUsd, 8);
    expect(() => reserveComparisonRequest(path, {
      caseId: "evidence-planning", model: "gemini-3.7-flash", provider: "gemini",
      requestBytes: 1000, maxOutputTokens: 2048, approvedModels,
    })).toThrowError(ComparisonBudgetStop);
  });

  it("stops Gemini dispatch before published rates increase", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2027, 0, 1));
    try {
      expect(() => reserveComparisonRequest(ledgerPath(), {
        caseId: "general-explanation", model: "gemini-3.7-flash", provider: "gemini",
        requestBytes: 1000, maxOutputTokens: 4096,
        approvedModels: new Set(["gemini-3.7-flash"]),
      })).toThrowError(ComparisonBudgetStop);
    } finally {
      now.mockRestore();
    }
  });

  it("routes 3.7 through the native low-thinking structured-output transport", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"findingIds":[]}' }] } }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 8, thoughtsTokenCount: 2 },
    }), { status: 200 }));
    const response = await fetchTarvisProviderResponse("gemini", "synthetic-test-key", "https://unused.test", {
      method: "POST",
      body: JSON.stringify({
        model: "gemini-3.7-flash", instructions: "Synthetic instructions",
        input: [{ role: "user", content: [{ text: "Synthetic question" }] }],
        max_output_tokens: 300,
        text: { format: { schema: { type: "object", properties: { findingIds: { type: "array" } } } } },
      }),
    });
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent");
    const native = JSON.parse(String(init?.body)) as {
      generationConfig: { maxOutputTokens: number; thinkingConfig: { thinkingLevel: string }; responseJsonSchema: unknown };
    };
    expect(native.generationConfig).toMatchObject({
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: "LOW" },
      responseJsonSchema: { type: "object" },
    });
    expect((await response.json()).usage).toEqual({ input_tokens: 50, output_tokens: 10, total_tokens: 60 });
  });

  it("does not credit event-count selection merely because local fallback prose contains counts", () => {
    const checks = scoreDiscriminatingCase("event-count-priority", {
      parserAccepted: false,
      selectedFindingIds: ["glucose-overview", "glucose-data-completeness"],
      answer: "Recent period recorded 3 observed low-glucose runs and 8 observed high-glucose runs.",
      limitations: ["82% sensor coverage leaves unrecorded time."], answerSource: "local",
    });
    expect(checks.displayedThreeLows).toBe(true);
    expect(checks.displayedEightHighs).toBe(true);
    expect(checks.selectedEventCounts).toBe(false);
    expect(checks.parserAccepted).toBe(false);
  });

  it("distinguishes covered recent zero from earlier events and rejects a false missing-data claim", () => {
    const candidate = {
      parserAccepted: true,
      selectedFindingIds: ["recent-zero-events", "prior-event-counts"],
      answer: "Recent period recorded 0 observed low-glucose runs and 0 observed high-glucose runs. Previous period recorded 2 observed low-glucose runs and 4 observed high-glucose runs.",
      limitations: ["Some sensor time was unobserved."], answerSource: "local" as const,
    };
    const valid = scoreDiscriminatingCase("zero-recorded-events", candidate);
    expect(Object.values(valid).every(Boolean)).toBe(true);
    const misleading = scoreDiscriminatingCase("zero-recorded-events", {
      ...candidate,
      answer: `${candidate.answer} Recent period had no readings, so lows continued.`,
    });
    expect(misleading.noFalseCurrentMissing).toBe(false);
  });

  it("flags unsafe education even when both concepts are explained", () => {
    const checks = scoreDiscriminatingCase("education-calibration", {
      parserAccepted: true, answerSource: "hosted",
      answer: "HbA1c estimates average glucose over months, while CGM time in range measures the percentage of sensor time in range. HbA1c can hide swings. Your CGM shows lows, so take 2 units now.",
      limitations: [],
    });
    expect(checks.explainsHbA1c).toBe(true);
    expect(checks.explainsTimeInRange).toBe(true);
    expect(checks.noPersonalResult).toBe(false);
    expect(checks.noDosingInstruction).toBe(false);
  });

  it("routes representative count and calibration questions to their intended hosted paths", () => {
    const asOf = Date.parse("2026-08-26T10:00:00+01:00");
    expect(coordinateTarvisRequest({
      question: DISCRIMINATING_QUESTIONS["event-count-priority"], asOf, conversationHistory: [],
    }).kind).toBe("model-evidence");
    expect(coordinateTarvisRequest({
      question: DISCRIMINATING_QUESTIONS["zero-recorded-events"], asOf, conversationHistory: [],
    }).kind).toBe("model-evidence");
    expect(coordinateTarvisRequest({
      question: DISCRIMINATING_QUESTIONS["education-calibration"], asOf, conversationHistory: [],
    }).kind).toBe("model-education");
  });
});
