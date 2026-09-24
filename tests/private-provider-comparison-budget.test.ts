import { mkdtempSync, openSync, closeSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ComparisonBudgetStop,
  inspectComparisonLedger,
  reserveComparisonRequest,
  settleComparisonRequest,
  validatedNativeUsage,
} from "../scripts/private-provider-comparison/budget";
import { boundedAppFailureMessage, boundedNativeErrorDiagnostic } from "../scripts/private-provider-comparison/diagnostics";
import { assertGeminiDispatchApproval } from "../scripts/private-provider-comparison/accessGate";

const temporaryDirectories: string[] = [];
function ledgerPath() {
  const directory = mkdtempSync(join(tmpdir(), "t1arc-provider-budget-"));
  temporaryDirectories.push(directory);
  return join(directory, "ledger.json");
}
afterEach(() => {
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
});
