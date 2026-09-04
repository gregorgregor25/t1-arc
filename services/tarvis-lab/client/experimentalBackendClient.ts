import type { EvidenceRecordPreview, EvidenceReference } from "@/domain/insights";
import type { TimeRange } from "@/domain/models";

import type {
  TarvisAnswer,
  TarvisConversationTurn,
  TarvisRequestMetrics,
} from "@/data/tarvis/types";
import type { TarvisLabSnapshot, TarvisLabScalar } from "./experimentalDataset";
import { modelSafeTarvisHistory } from "@/data/tarvis/modelConversationPrivacy";

const SESSION_REFRESH_MS = 5 * 60_000;
const QUESTION_TIMEOUT_MS = 100_000;
const MAX_HISTORY_TURNS = 8;

interface LabSession {
  baseUrl: string;
  createdAtMs: number;
  expiresAtMs: number;
  rangeStartMs: number;
  sessionId: string;
}

interface LabSqlEvidence {
  id: string;
  purpose: string;
  sql: string;
  columns: string[];
  rowCount: number;
  preview: Record<string, TarvisLabScalar>[];
  truncated: boolean;
}

interface LabQuestionResponse {
  answer: TarvisAnswer;
  evidence: LabSqlEvidence[];
  metrics?: {
    model?: string;
    estimatedCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    modelRounds?: number;
    sqlCalls?: number;
    sqlMs?: number;
    modelMs?: number;
    totalMs?: number;
  };
}

interface AskLabOptions {
  apiKey: string;
  asOfMs: number;
  history: TarvisConversationTurn[];
  loadSnapshot(): Promise<TarvisLabSnapshot>;
  question: string;
  range: TimeRange;
  signal?: AbortSignal;
}

export interface TarvisLabResult {
  answer: TarvisAnswer;
  evidenceReferences: Map<string, EvidenceReference>;
  requestMetrics?: TarvisRequestMetrics;
}

let activeSession: LabSession | undefined;

function configuredBaseUrl() {
  if (process.env.EXPO_PUBLIC_TARVIS_LAB_ENABLED !== "1") {
    return undefined;
  }
  const value = process.env.EXPO_PUBLIC_TARVIS_LAB_URL?.trim();
  if (!value) return undefined;
  if (!/^https:\/\/[^/]+(?::\d+)?(?:\/.*)?$/i.test(value)) {
    return undefined;
  }
  return value.replace(/\/+$/, "");
}

export function isTarvisAnalystLabEnabled() {
  return configuredBaseUrl() !== undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(value: unknown, fallback: string) {
  if (!isObject(value)) return fallback;
  const error = value.error;
  if (typeof error === "string" && error.trim()) return error;
  if (isObject(error) && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("The Tarv1s Analyst Lab returned an unreadable response.");
  }
}

function combinedAbortSignal(external?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  external?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, QUESTION_TIMEOUT_MS);
  return {
    signal: controller.signal,
    release() {
      clearTimeout(timeout);
      external?.removeEventListener("abort", abort);
    },
  };
}

function currentSession(baseUrl: string, range: TimeRange, now = Date.now()) {
  if (
    !activeSession ||
    activeSession.baseUrl !== baseUrl ||
    activeSession.rangeStartMs !== range.start ||
    activeSession.expiresAtMs <= now + 30_000 ||
    activeSession.createdAtMs + SESSION_REFRESH_MS <= now
  ) {
    activeSession = undefined;
  }
  return activeSession;
}

async function createSession(
  baseUrl: string,
  snapshot: TarvisLabSnapshot,
  signal: AbortSignal,
) {
  const response = await fetch(`${baseUrl}/dev/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
    signal,
  });
  const body = await readJson(response);
  if (!response.ok || !isObject(body)) {
    throw new Error(
      errorMessage(body, `The Analyst Lab could not prepare the data (HTTP ${response.status}).`),
    );
  }
  const sessionId = body.sessionId;
  const expiresAtMs = body.expiresAtMs;
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof expiresAtMs !== "number" ||
    !Number.isFinite(expiresAtMs)
  ) {
    throw new Error("The Analyst Lab did not create a valid analysis session.");
  }
  activeSession = {
    baseUrl,
    createdAtMs: Date.now(),
    expiresAtMs,
    rangeStartMs: snapshot.range.startMs,
    sessionId,
  };
  return activeSession;
}

function parseAnswer(value: unknown): TarvisAnswer {
  if (!isObject(value)) throw new Error("The Analyst Lab returned no answer.");
  const confidence = value.confidence;
  if (
    typeof value.headline !== "string" ||
    typeof value.answer !== "string" ||
    (confidence !== "high" &&
      confidence !== "moderate" &&
      confidence !== "limited") ||
    !Array.isArray(value.evidenceIds) ||
    !value.evidenceIds.every((id) => typeof id === "string") ||
    !Array.isArray(value.limitations) ||
    !value.limitations.every((limitation) => typeof limitation === "string")
  ) {
    throw new Error("The Analyst Lab returned an invalid answer.");
  }
  return {
    headline: value.headline.trim(),
    answer: value.answer.trim(),
    confidence,
    evidenceIds: [...new Set(value.evidenceIds)],
    limitations: value.limitations.map((item) => item.trim()).filter(Boolean),
  };
}

function parseEvidence(value: unknown): LabSqlEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): LabSqlEvidence[] => {
    if (
      !isObject(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.purpose !== "string" ||
      typeof candidate.sql !== "string" ||
      !Array.isArray(candidate.columns) ||
      !candidate.columns.every((column) => typeof column === "string") ||
      typeof candidate.rowCount !== "number" ||
      !Number.isFinite(candidate.rowCount) ||
      !Array.isArray(candidate.preview)
    ) {
      return [];
    }
    const preview = candidate.preview.flatMap((row) =>
      isObject(row)
        ? [
            Object.fromEntries(
              Object.entries(row).flatMap(([key, item]) =>
                item === null || typeof item === "string" || typeof item === "number"
                  ? [[key, item as TarvisLabScalar]]
                  : [],
              ),
            ),
          ]
        : [],
    );
    return [
      {
        id: candidate.id,
        purpose: candidate.purpose,
        sql: candidate.sql,
        columns: candidate.columns,
        rowCount: Math.max(0, Math.floor(candidate.rowCount)),
        preview,
        truncated: candidate.truncated === true,
      },
    ];
  });
}

function parseQuestionResponse(value: unknown): LabQuestionResponse {
  if (!isObject(value)) {
    throw new Error("The Analyst Lab returned an unreadable answer.");
  }
  return {
    answer: parseAnswer(value.answer),
    evidence: parseEvidence(value.evidence),
    metrics: isObject(value.metrics)
      ? (value.metrics as LabQuestionResponse["metrics"])
      : undefined,
  };
}

function firstTimestamp(row: Record<string, TarvisLabScalar>, fallback: number) {
  for (const key of ["timestamp_ms", "start_ms", "end_ms"]) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return fallback;
}

function rowIdentity(
  evidenceId: string,
  row: Record<string, TarvisLabScalar>,
  index: number,
) {
  for (const [key, value] of Object.entries(row)) {
    if (
      typeof value === "string" &&
      value &&
      (key === "id" || key.endsWith("_id"))
    ) {
      return value;
    }
  }
  return `${evidenceId}:result:${index + 1}`;
}

function compactPreview(row: Record<string, TarvisLabScalar>) {
  const text = Object.entries(row)
    .map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`)
    .join(" · ");
  return text.length <= 220 ? text : `${text.slice(0, 217)}...`;
}

export function labEvidenceReferences(
  evidence: LabSqlEvidence[],
  range: TimeRange,
) {
  return new Map<string, EvidenceReference>(
    evidence.map((item) => {
      const examples: EvidenceRecordPreview[] = item.preview.slice(0, 8).map(
        (row, index) => ({
          id: rowIdentity(item.id, row, index),
          kind: "source-record",
          timestamp: firstTimestamp(row, range.start),
          primary: compactPreview(row),
          secondary: "Read-only Analyst Lab result",
          sourceId: "tarvis-analyst-lab",
        }),
      );
      return [
        item.id,
        {
          id: item.id,
          label: item.purpose,
          description: item.truncated
            ? "Tarv1s used a read-only calculation. The displayed preview is shortened."
            : "Tarv1s used this read-only calculation against the temporary analysis snapshot.",
          range,
          recordIds: examples.map((example) => example.id),
          examples,
        },
      ];
    }),
  );
}

async function submitQuestion(
  baseUrl: string,
  session: LabSession,
  options: AskLabOptions,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${baseUrl}/dev/v1/sessions/${encodeURIComponent(session.sessionId)}/questions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenAI-API-Key": options.apiKey,
      },
      body: JSON.stringify({
        question: options.question,
        asOfMs: options.asOfMs,
        history: modelSafeTarvisHistory(options.history)
          .slice(-MAX_HISTORY_TURNS)
          .map((turn) => ({ role: turn.role, content: turn.text })),
      }),
      signal,
    },
  );
  const body = await readJson(response);
  if (response.status === 404 || response.status === 410) {
    activeSession = undefined;
    return { expired: true as const };
  }
  if (!response.ok) {
    throw new Error(
      errorMessage(body, `The Analyst Lab could not answer (HTTP ${response.status}).`),
    );
  }
  return { expired: false as const, response: parseQuestionResponse(body) };
}

export async function askTarvisAnalystLab(
  options: AskLabOptions,
): Promise<TarvisLabResult> {
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) throw new Error("The Tarv1s Analyst Lab is not enabled.");
  const abort = combinedAbortSignal(options.signal);
  try {
    let session = currentSession(baseUrl, options.range);
    if (!session) {
      session = await createSession(baseUrl, await options.loadSnapshot(), abort.signal);
    }
    let result = await submitQuestion(baseUrl, session, options, abort.signal);
    if (result.expired) {
      session = await createSession(baseUrl, await options.loadSnapshot(), abort.signal);
      result = await submitQuestion(baseUrl, session, options, abort.signal);
    }
    if (result.expired) {
      throw new Error("The Analyst Lab session expired before it could answer.");
    }
    const evidenceReferences = labEvidenceReferences(
      result.response.evidence,
      options.range,
    );
    if (
      result.response.answer.evidenceIds.some(
        (id) => !evidenceReferences.has(id),
      )
    ) {
      throw new Error(
        "The Analyst Lab answer referred to evidence that was not returned.",
      );
    }
    const metrics = result.response.metrics;
    return {
      answer: {
        ...result.response.answer,
        evidenceIds: result.response.answer.evidenceIds,
      },
      evidenceReferences,
      requestMetrics:
        metrics?.model &&
        typeof metrics.inputTokens === "number" &&
        typeof metrics.outputTokens === "number" &&
        typeof metrics.totalTokens === "number" &&
        typeof metrics.estimatedCostUsd === "number"
          ? {
              model: metrics.model,
              inputTokens: metrics.inputTokens,
              outputTokens: metrics.outputTokens,
              totalTokens: metrics.totalTokens,
              estimatedCostUsd: metrics.estimatedCostUsd,
              evidenceCharacters: 0,
            }
          : undefined,
    };
  } catch (error) {
    if (abort.signal.aborted) {
      throw new Error(
        options.signal?.aborted
          ? "The Analyst Lab request was cancelled."
          : "The Analyst Lab did not answer within 100 seconds.",
      );
    }
    throw error;
  } finally {
    abort.release();
  }
}

export function clearTarvisAnalystLabSessionForTests() {
  activeSession = undefined;
}
