import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const COMPARISON_LIMIT_USD = 1;
export const MAX_NATIVE_REQUEST_BYTES = 70_000;
// Standard Gemini API paid rates verified 24 September 2026. Google publishes
// higher rates from 1 January 2027; fail closed before that price change.
// https://ai.google.dev/gemini-api/docs/pricing
const GEMINI_CURRENT_RATES_END_UTC = Date.UTC(2027, 0, 1);
export const MODEL_RATES = {
  "gemini-3.8-flash": { provider: "gemini", input: 0.75, output: 3.75, outputFloor: 4096 },
  "gemini-3.7-flash": { provider: "gemini", input: 0.75, output: 3.75, outputFloor: 4096 },
  "claude-haiku-4-5-20251001": { provider: "claude", input: 1, output: 5, outputFloor: 2048 },
  "claude-sonnet-5": { provider: "claude", input: 2, output: 10, outputFloor: 2048 },
  "claude-opus-5-5": { provider: "claude", input: 4, output: 20, outputFloor: 2048 },
} as const;

export type ComparisonModel = keyof typeof MODEL_RATES;
export type ComparisonProvider = "gemini" | "claude";

/** Only authoritative native usage can release a successful reservation. */
export function validatedNativeUsage(provider: ComparisonProvider, raw: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const value = provider === "gemini" ? source.usageMetadata : source.usage;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const count = (name: string, required: boolean) => {
    const item = usage[name];
    if (item === undefined && !required) return 0;
    return typeof item === "number" && Number.isSafeInteger(item) && item >= 0 ? item : undefined;
  };
  if (provider === "gemini") {
    const input = count("promptTokenCount", true);
    const candidate = count("candidatesTokenCount", true);
    const thoughts = count("thoughtsTokenCount", false);
    return input !== undefined && input > 0 && candidate !== undefined && thoughts !== undefined
      ? { inputTokens: input, outputTokens: candidate + thoughts } : undefined;
  }
  const input = count("input_tokens", true);
  const output = count("output_tokens", true);
  const cacheRead = count("cache_read_input_tokens", false);
  const cacheCreate = count("cache_creation_input_tokens", false);
  // No caching is requested. If a provider unexpectedly creates cached input,
  // retain the full reservation rather than guess the cache duration/rate.
  return input !== undefined && input > 0 && output !== undefined && cacheRead !== undefined && cacheCreate === 0
    ? { inputTokens: input + cacheRead, outputTokens: output } : undefined;
}

export interface ComparisonReservation {
  id: string;
  caseId: string;
  model: ComparisonModel;
  provider: ComparisonProvider;
  requestBytes: number;
  inputReserveTokens: number;
  outputReserveTokens: number;
  reservedUsd: number;
  actualUsd?: number;
  settledUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  status: "reserved" | "accepted" | "local-fallback" | "failed";
  createdAt: string;
}

export interface ComparisonLedger {
  version: 1;
  limitUsd: 1;
  reservations: ComparisonReservation[];
}

export class ComparisonBudgetStop extends Error {
  constructor(readonly code: "budget" | "locked" | "duplicate" | "unapproved" | "invalid-request") {
    super(`Comparison stopped: ${code}`);
  }
}

function roundUpUsd(value: number) {
  return Math.ceil(value * 1_000_000_000) / 1_000_000_000;
}

function ledgerCost(record: ComparisonReservation) {
  return record.settledUsd ?? record.reservedUsd;
}

function withLock<T>(ledgerPath: string, action: () => T): T {
  mkdirSync(dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const lockPath = `${ledgerPath}.lock`;
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, "wx", 0o600);
  } catch {
    throw new ComparisonBudgetStop("locked");
  }
  try {
    return action();
  } finally {
    closeSync(descriptor);
    unlinkSync(lockPath);
  }
}

function readLedger(ledgerPath: string): ComparisonLedger {
  if (!existsSync(ledgerPath)) return { version: 1, limitUsd: 1, reservations: [] };
  const parsed: unknown = JSON.parse(readFileSync(ledgerPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ComparisonBudgetStop("invalid-request");
  const value = parsed as Partial<ComparisonLedger>;
  if (value.version !== 1 || value.limitUsd !== 1 || !Array.isArray(value.reservations)) {
    throw new ComparisonBudgetStop("invalid-request");
  }
  for (const row of value.reservations) {
    if (!row || typeof row.id !== "string" || typeof row.caseId !== "string" ||
        !Object.hasOwn(MODEL_RATES, row.model) ||
        typeof row.reservedUsd !== "number" || !Number.isFinite(row.reservedUsd) || row.reservedUsd < 0 ||
        (row.settledUsd !== undefined && (!Number.isFinite(row.settledUsd) || row.settledUsd < 0))) {
      throw new ComparisonBudgetStop("invalid-request");
    }
  }
  return value as ComparisonLedger;
}

function saveLedger(ledgerPath: string, ledger: ComparisonLedger) {
  const temporary = `${ledgerPath}.${process.pid}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify(ledger, null, 2));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, ledgerPath);
}

export function inspectComparisonLedger(ledgerPath: string) {
  return withLock(ledgerPath, () => {
    const ledger = readLedger(ledgerPath);
    return {
      spentOrReservedUsd: roundUpUsd(ledger.reservations.reduce((sum, row) => sum + ledgerCost(row), 0)),
      reservations: ledger.reservations.map(row => ({ ...row })),
    };
  });
}

export function reserveComparisonRequest(ledgerPath: string, input: {
  caseId: string;
  model: ComparisonModel;
  provider: ComparisonProvider;
  requestBytes: number;
  maxOutputTokens: number;
  approvedModels: ReadonlySet<string>;
}): ComparisonReservation {
  const rate = MODEL_RATES[input.model];
  if (!rate || rate.provider !== input.provider || !input.approvedModels.has(input.model)) {
    throw new ComparisonBudgetStop("unapproved");
  }
  if (input.provider === "gemini" && Date.now() >= GEMINI_CURRENT_RATES_END_UTC) {
    throw new ComparisonBudgetStop("unapproved");
  }
  if (!/^[a-z0-9-]{3,80}$/.test(input.caseId) ||
      !Number.isSafeInteger(input.requestBytes) || input.requestBytes <= 0 || input.requestBytes > MAX_NATIVE_REQUEST_BYTES ||
      !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens !== rate.outputFloor) {
    throw new ComparisonBudgetStop("invalid-request");
  }
  // UTF-8 bytes cover every request character and the schema. The extra 20%
  // and 2,048 tokens cover provider framing and tokenizer uncertainty.
  const inputReserveTokens = Math.ceil(input.requestBytes * 1.2) + 2048;
  const outputReserveTokens = Math.max(input.maxOutputTokens, rate.outputFloor);
  // Anthropic cache creation can cost more than ordinary input. The harness
  // does not request caching, but price all potential Claude input at 1.25x.
  const inputRate = rate.input * (input.provider === "claude" ? 1.25 : 1);
  const reservedUsd = roundUpUsd((inputReserveTokens * inputRate + outputReserveTokens * rate.output) / 1_000_000);
  return withLock(ledgerPath, () => {
    const ledger = readLedger(ledgerPath);
    if (ledger.reservations.some(row => row.id === `${input.model}:${input.caseId}`)) {
      throw new ComparisonBudgetStop("duplicate");
    }
    const committed = ledger.reservations.reduce((sum, row) => sum + ledgerCost(row), 0);
    if (committed + reservedUsd > COMPARISON_LIMIT_USD) throw new ComparisonBudgetStop("budget");
    const reservation: ComparisonReservation = {
      id: `${input.model}:${input.caseId}`,
      caseId: input.caseId,
      model: input.model,
      provider: input.provider,
      requestBytes: input.requestBytes,
      inputReserveTokens,
      outputReserveTokens,
      reservedUsd,
      status: "reserved",
      createdAt: new Date().toISOString(),
    };
    ledger.reservations.push(reservation);
    saveLedger(ledgerPath, ledger);
    return reservation;
  });
}

export function settleComparisonRequest(ledgerPath: string, id: string, result: {
  status: "accepted" | "local-fallback" | "failed";
  inputTokens?: number;
  outputTokens?: number;
}) {
  return withLock(ledgerPath, () => {
    const ledger = readLedger(ledgerPath);
    const row = ledger.reservations.find(item => item.id === id);
    if (!row || row.status !== "reserved") throw new ComparisonBudgetStop("invalid-request");
    row.status = result.status;
    if (result.inputTokens !== undefined && result.outputTokens !== undefined &&
        Number.isSafeInteger(result.inputTokens) && result.inputTokens >= 0 &&
        Number.isSafeInteger(result.outputTokens) && result.outputTokens >= 0) {
      row.inputTokens = result.inputTokens;
      row.outputTokens = result.outputTokens;
      const rate = MODEL_RATES[row.model];
      // Native usage has been validated and cache creation is absent. Use the
      // published ordinary rate for the comparison's actual cost estimate.
      row.actualUsd = roundUpUsd((row.inputTokens * rate.input + row.outputTokens * rate.output) / 1_000_000);
      // Any failed, timed-out or malformed request keeps its full reservation.
      if (result.status !== "failed") row.settledUsd = row.actualUsd;
    }
    saveLedger(ledgerPath, ledger);
    return { ...row };
  });
}
