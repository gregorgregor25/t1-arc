import { checkTarvisRateLimit } from "./guardrails";
import { selectTarvisEvidencePacket } from "./evidencePacket";
import { applyTarvisCoverageGuardrailResult } from "./evidencePresentation";
import {
  getTarvisSafetyIdentifier,
  loadTarvisApiKey,
  loadTarvisUsage,
  saveTarvisUsage,
} from "./secureStore";
import { classifyTarvisQuestion } from "./scope";
import { estimateTarvisCostUsd } from "./cost";
import { classifyTarvisSafety } from "./safety";
import { safetyQuestionWithImmediateContext } from "./safetyContext";
import { TARVIS_SYSTEM_PROMPT } from "./prompt";
import {
  TarvisConversationTurn,
  isTarvisRetrospectiveEvidencePacket,
  TarvisModelEvidencePacket,
  TarvisResponse,
  TarvisUsage,
} from "./types";
import {
  parseTarvisRetrospectiveAnswerResult,
  TARVIS_RETROSPECTIVE_CLAIM_IDS,
  TARVIS_RETROSPECTIVE_CLOSING_STYLES,
  TARVIS_RETROSPECTIVE_LEAD_STYLES,
  tarvisRetrospectiveClaimOptions,
} from "./retrospectiveAnswerGuardrail";
import { selectTarvisReviewedKnowledge } from "./reviewedKnowledge";
import { parseTarvisReviewedKnowledgeAnswer } from "./reviewedKnowledgeAnswerGuardrail";
import { modelSafeTarvisHistory } from "./modelConversationPrivacy";
import {
  MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS,
  parseTarvisEvidenceSelectionResult,
  tarvisEvidenceFindingOptions,
} from "./evidenceAnswerGuardrail";
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseCurrent,
  type LocalDataWriteLease,
} from "@/data/privacy/localDataWriteEpoch";
import { formatTarvisNumber } from "./regionalNumberPresentation";
import {
  beginTarvisConnectionRequest,
  TarvisConnectionRequestAbortedError,
  type TarvisConnectionRequestLease,
} from "./connectionCoordinator";
import {
  parseTarvisEvidencePlan,
  TARVIS_EVIDENCE_PLANNER_PROMPT,
  tarvisEvidencePlannerTextConfig,
  type TarvisEvidencePlan,
  type TarvisEvidencePlanningOptions,
} from "./evidencePlanner";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODEL = "gpt-5.6-luna";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_QUESTION_LENGTH = 1_500;
const MAX_CONTEXT_CHARACTERS = 70_000;
const MAX_OUTPUT_TOKENS = 800;

let requestInFlight = false;

export interface TarvisRequestFailureDetails {
  modelRequestSent: boolean;
  requestMetrics?: TarvisResponse["requestMetrics"];
  usage?: TarvisUsage;
}

class TarvisRequestFailureError extends Error {
  readonly details: TarvisRequestFailureDetails;

  constructor(message: string, details: TarvisRequestFailureDetails) {
    super(message);
    this.name = "TarvisRequestFailureError";
    this.details = details;
  }
}

export function getTarvisRequestFailureDetails(
  error: unknown,
): TarvisRequestFailureDetails | undefined {
  return error instanceof TarvisRequestFailureError ? error.details : undefined;
}

interface OpenAiResponseBody {
  status?: string;
  incomplete_details?: { reason?: string };
  output?: {
    type?: string;
    content?: {
      type?: string;
      text?: string;
      refusal?: string;
    }[];
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string };
}

function responseTextConfig(
  mode: "evidence" | "retrospective" | "reviewed-education",
) {
  if (mode === "retrospective") {
    return {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "tarvis_retrospective_companion_v1",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            leadStyle: {
              type: "string",
              enum: [...TARVIS_RETROSPECTIVE_LEAD_STYLES],
            },
            leadText: {
              type: "string",
              minLength: 20,
              maxLength: 180,
            },
            claims: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  claimId: {
                    type: "string",
                    enum: [...TARVIS_RETROSPECTIVE_CLAIM_IDS],
                  },
                  evidenceIds: {
                    type: "array",
                    maxItems: 5,
                    items: { type: "string" },
                  },
                  knowledgeIds: {
                    type: "array",
                    maxItems: 1,
                    items: { type: "string" },
                  },
                  bridgeText: {
                    type: "string",
                    minLength: 10,
                    maxLength: 100,
                  },
                },
                required: [
                  "claimId",
                  "evidenceIds",
                  "knowledgeIds",
                  "bridgeText",
                ],
              },
            },
            closingStyle: {
              type: "string",
              enum: [...TARVIS_RETROSPECTIVE_CLOSING_STYLES],
            },
            closingText: {
              type: "string",
              maxLength: 140,
            },
          },
          required: [
            "leadStyle",
            "leadText",
            "claims",
            "closingStyle",
            "closingText",
          ],
        },
      },
    };
  }
  if (mode === "evidence") {
    return {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "tarvis_evidence_selection",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            findingIds: {
              type: "array",
              maxItems: MAX_TARVIS_EVIDENCE_FINDING_SELECTIONS,
              items: { type: "string" },
            },
          },
          required: ["findingIds"],
        },
      },
    };
  }
  if (mode === "reviewed-education") {
    return {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "tarvis_reviewed_knowledge_answer",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            knowledgeIds: {
              type: "array",
              minItems: 1,
              maxItems: 2,
              items: { type: "string" },
            },
          },
          required: ["knowledgeIds"],
        },
      },
    };
  }
  throw new Error(`Unsupported Tarv1s response mode: ${mode satisfies never}`);
}

function unreviewedEducationFallback() {
  return {
    headline: "I need a reviewed source for that",
    answer:
      "I don’t yet have a source-locked NICE guidance item for that general question, so I won’t improvise medical guidance. I can still analyse your recorded data, and this build can answer the reviewed NICE sick-day and physical-activity topics.",
    confidence: "limited" as const,
    evidenceIds: [],
    limitations: [
      "No personal records were loaded and no OpenAI request was made.",
    ],
  };
}

function trimHistory(history: TarvisConversationTurn[]) {
  return modelSafeTarvisHistory(history)
    .slice(-4)
    .map((turn) => ({
      role: turn.role,
      text: turn.text.slice(0, 1_200),
    }));
}

function extractOutputText(body: OpenAiResponseBody) {
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" && content.refusal) {
        throw new Error(content.refusal);
      }
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }
  throw new Error("OpenAI returned no answer.");
}

function openAiError(status: number, body: OpenAiResponseBody) {
  if (status === 401) {
    return "OpenAI rejected this key. Open TARV1S settings and replace it.";
  }
  if (status === 403) {
    return "This key cannot use the Responses API. Allow model responses in the OpenAI project key permissions.";
  }
  if (status === 429) {
    return "OpenAI is rate-limiting this project or its budget has been reached. No automatic retry was made.";
  }
  return (
    body.error?.message ||
    `OpenAI could not complete the request (HTTP ${status}).`
  );
}

export async function askTarvis(
  question: string,
  packet?: TarvisModelEvidencePacket,
  history: TarvisConversationTurn[] = [],
  lease?: LocalDataWriteLease,
  options: {
    signal?: AbortSignal;
    packetIsPreselected?: boolean;
    safetyHistory?: TarvisConversationTurn[];
  } = {},
): Promise<TarvisResponse> {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const prompt = question.trim();
  if (!prompt) throw new Error("Ask TARV1S a question first.");
  if (prompt.length > MAX_QUESTION_LENGTH) {
    throw new Error(
      `Keep the question under ${formatTarvisNumber(MAX_QUESTION_LENGTH, { maximumFractionDigits: 0 })} characters.`,
    );
  }
  const safety = classifyTarvisSafety(
    safetyQuestionWithImmediateContext(
      prompt,
      options.safetyHistory ?? history,
    ),
  );
  if (safety.kind !== "allow") {
    return {
      answer: safety.answer,
      usage: await loadTarvisUsage(writeLease),
      modelRequestSent: false,
      answerSource: "local",
    };
  }
  const scope = classifyTarvisQuestion(prompt, history);
  if (scope !== "in_scope") {
    const usage = await loadTarvisUsage(writeLease);
    return {
      answer: {
        headline:
          scope === "sensitive_credentials"
            ? "I can’t reveal private credentials"
            : "That is outside TARV1S’s scope",
        answer:
          scope === "sensitive_credentials"
            ? "TARV1S cannot retrieve or display passwords, API keys, tokens or other secrets. No OpenAI request was made."
            : "TARV1S only answers questions about Type 1 diabetes and the health evidence available in T1 Arc. No OpenAI request was made.",
        confidence: "high",
        evidenceIds: [],
        limitations: [],
      },
      usage,
      modelRequestSent: false,
      answerSource: "local",
    };
  }
  if (requestInFlight) {
    throw new Error("TARV1S is already answering a question.");
  }
  const selectedPacket = packet
    ? isTarvisRetrospectiveEvidencePacket(packet)
      ? packet
      : options.packetIsPreselected
        ? packet
        : selectTarvisEvidencePacket(prompt, packet)
    : undefined;
  const reviewedKnowledge = selectedPacket
    ? []
    : selectTarvisReviewedKnowledge(prompt);
  if (!selectedPacket && reviewedKnowledge.length === 0) {
    return {
      answer: unreviewedEducationFallback(),
      usage: await loadTarvisUsage(writeLease),
      modelRequestSent: false,
      answerSource: "local",
    };
  }
  const encodedContext = JSON.stringify(
    selectedPacket ?? { reviewedKnowledge },
  );
  const retrospective = Boolean(
    selectedPacket && isTarvisRetrospectiveEvidencePacket(selectedPacket),
  );
  const responseMode = retrospective
    ? "retrospective"
    : selectedPacket
      ? "evidence"
      : "reviewed-education";
  if (encodedContext.length > MAX_CONTEXT_CHARACTERS) {
    throw new Error(
      "This evidence window is too large to send safely. Choose a shorter comparison period.",
    );
  }

  requestInFlight = true;
  let connectionLease: TarvisConnectionRequestLease | undefined;
  let modelRequestSent = false;
  let knownRequestMetrics: TarvisResponse["requestMetrics"];
  let knownUsage: TarvisUsage | undefined;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeExternalAbortListener: (() => void) | undefined;
  try {
    if (options.signal?.aborted) {
      throw new TarvisConnectionRequestAbortedError();
    }
    connectionLease = await beginTarvisConnectionRequest();
    if (options.signal) {
      const abortForScreenLifecycle = () => connectionLease?.abort();
      options.signal.addEventListener("abort", abortForScreenLifecycle, {
        once: true,
      });
      removeExternalAbortListener = () =>
        options.signal?.removeEventListener("abort", abortForScreenLifecycle);
      if (options.signal.aborted) connectionLease.abort();
    }
    connectionLease.assertCurrent();
    const key = await loadTarvisApiKey(writeLease);
    connectionLease.assertCurrent();
    if (!key) throw new Error("Add your OpenAI API key first.");

    const now = Date.now();
    const existingUsage = await loadTarvisUsage(writeLease);
    knownUsage = existingUsage;
    connectionLease.assertCurrent();
    const recent = checkTarvisRateLimit(existingUsage, now);
    const reservedUsage: TarvisUsage = {
      ...existingUsage,
      requestTimestamps: [...recent, now],
      lastRequestAt: now,
    };
    const safetyIdentifier = await getTarvisSafetyIdentifier(writeLease);
    connectionLease.assertCurrent();
    // Persist the local model-request reservation only after all pre-dispatch
    // work succeeds. A SecureStore/safety-ID failure must not consume quota.
    await saveTarvisUsage(reservedUsage, writeLease);
    knownUsage = reservedUsage;
    connectionLease.assertCurrent();
    timeout = setTimeout(() => {
      timedOut = true;
      connectionLease?.abort();
    }, REQUEST_TIMEOUT_MS);
    modelRequestSent = true;
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: connectionLease.signal,
      body: JSON.stringify({
        model: MODEL,
        store: false,
        safety_identifier: safetyIdentifier,
        instructions: TARVIS_SYSTEM_PROMPT,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  selectedPacket
                    ? {
                        requestMode: isTarvisRetrospectiveEvidencePacket(
                          selectedPacket,
                        )
                          ? "retrospective"
                          : "evidence",
                        ...(isTarvisRetrospectiveEvidencePacket(selectedPacket)
                          ? {
                              untrustedEvidencePacket: selectedPacket,
                              approvedInterpretationClaims:
                                tarvisRetrospectiveClaimOptions(selectedPacket),
                              untrustedQuestion: prompt,
                            }
                          : {
                              evidencePacket: selectedPacket,
                              approvedFindingOptions:
                                tarvisEvidenceFindingOptions(selectedPacket),
                              question: prompt,
                            }),
                        recentConversation: trimHistory(history),
                      }
                    : {
                        requestMode: "education",
                        reviewedKnowledge,
                        recentConversation: trimHistory(history),
                        question: prompt,
                      },
                ),
              },
            ],
          },
        ],
        reasoning: { effort: retrospective ? "medium" : "low" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
        text: responseTextConfig(responseMode),
      }),
    });
    connectionLease.assertCurrent();
    const body = (await response.json()) as OpenAiResponseBody;
    connectionLease.assertCurrent();
    if (!response.ok) throw new Error(openAiError(response.status, body));

    const tokens = body.usage ?? {};
    const usage: TarvisUsage = {
      ...reservedUsage,
      inputTokens: reservedUsage.inputTokens + (tokens.input_tokens ?? 0),
      outputTokens: reservedUsage.outputTokens + (tokens.output_tokens ?? 0),
      totalTokens: reservedUsage.totalTokens + (tokens.total_tokens ?? 0),
    };
    knownRequestMetrics = {
      model: MODEL,
      inputTokens: tokens.input_tokens ?? 0,
      outputTokens: tokens.output_tokens ?? 0,
      totalTokens: tokens.total_tokens ?? 0,
      estimatedCostUsd: estimateTarvisCostUsd(
        tokens.input_tokens ?? 0,
        tokens.output_tokens ?? 0,
      ),
      evidenceCharacters: encodedContext.length,
    };
    await saveTarvisUsage(usage, writeLease);
    knownUsage = usage;
    connectionLease.assertCurrent();
    if (body.status === "incomplete") {
      throw new Error(
        body.incomplete_details?.reason
          ? `OpenAI returned an incomplete answer (${body.incomplete_details.reason}).`
          : "OpenAI returned an incomplete answer.",
      );
    }
    const outputText = extractOutputText(body);
    const retrospectiveResult =
      selectedPacket && isTarvisRetrospectiveEvidencePacket(selectedPacket)
        ? parseTarvisRetrospectiveAnswerResult(
            outputText,
            selectedPacket,
            prompt,
          )
        : undefined;
    const parsedAnswer = selectedPacket
      ? isTarvisRetrospectiveEvidencePacket(selectedPacket)
        ? retrospectiveResult!.answer
        : parseTarvisEvidenceSelectionResult(outputText, selectedPacket).answer
      : parseTarvisReviewedKnowledgeAnswer(outputText, reviewedKnowledge);
    const coverageResult =
      selectedPacket && !isTarvisRetrospectiveEvidencePacket(selectedPacket)
        ? applyTarvisCoverageGuardrailResult(
            prompt,
            selectedPacket,
            parsedAnswer,
            history,
            "local",
          )
        : { answer: parsedAnswer, replacedHostedProse: false };
    return {
      answer: selectedPacket
        ? coverageResult.answer
        : { ...parsedAnswer, evidenceIds: [] },
      usage,
      modelRequestSent: true,
      answerSource: retrospectiveResult?.acceptedHostedAnswer
        ? "hosted"
        : "local",
      requestMetrics: knownRequestMetrics,
    };
  } catch (error) {
    // A failed HTTP/parse/timeout request still crosses a long external-work
    // boundary. Revalidate before allowing its error to reach user-visible UI.
    await assertLocalDataWriteLeaseCurrent(writeLease);
    connectionLease?.assertGenerationCurrent();
    if (!timedOut) {
      connectionLease?.assertCurrent();
    }
    const message = timedOut
      ? "TARV1S stopped after 45 seconds. No automatic retry was made."
      : error instanceof Error
        ? error.message
        : "TARV1S could not complete this request.";
    throw new TarvisRequestFailureError(message, {
      modelRequestSent,
      requestMetrics: knownRequestMetrics,
      usage: knownUsage,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    removeExternalAbortListener?.();
    connectionLease?.release();
    requestInFlight = false;
  }
}

export interface TarvisEvidencePlanningResponse {
  plan: TarvisEvidencePlan;
  usage: TarvisUsage;
  modelRequestSent: true;
  requestMetrics: NonNullable<TarvisResponse["requestMetrics"]>;
}

/**
 * Lets the model choose only from locally offered opaque evidence handles.
 * No health record, timestamp, SQL fragment or arbitrary range is exposed to
 * or accepted from this planning request.
 */
export async function planTarvisEvidenceRequest(
  question: string,
  planningOptions: TarvisEvidencePlanningOptions,
  lease?: LocalDataWriteLease,
  options: {
    signal?: AbortSignal;
    safetyHistory?: TarvisConversationTurn[];
  } = {},
): Promise<TarvisEvidencePlanningResponse> {
  const writeLease = lease ?? (await acquireLocalDataWriteLease());
  const prompt = question.trim();
  if (!prompt) throw new Error("Ask Tarv1s a question first.");
  if (prompt.length > MAX_QUESTION_LENGTH) {
    throw new Error(
      `Keep the question under ${formatTarvisNumber(MAX_QUESTION_LENGTH, { maximumFractionDigits: 0 })} characters.`,
    );
  }
  if (
    classifyTarvisSafety(
      safetyQuestionWithImmediateContext(
        prompt,
        options.safetyHistory ?? [],
      ),
    ).kind !== "allow"
  ) {
    throw new Error("A safety-critical question cannot enter evidence planning.");
  }
  if (classifyTarvisQuestion(prompt) !== "in_scope") {
    throw new Error("An out-of-scope question cannot enter evidence planning.");
  }
  if (requestInFlight) {
    throw new Error("Tarv1s is already answering a question.");
  }

  const modelOptions = {
    schemaVersion: planningOptions.schemaVersion,
    timezone: planningOptions.timezone,
    currentLocalDate: planningOptions.currentLocalDate,
    explicitCategoryIds: [...planningOptions.explicitCategoryIds],
    excludedCategoryIds: [...planningOptions.excludedCategoryIds],
    explicitContextChecks: [...planningOptions.explicitContextChecks],
    excludedContextChecks: [...planningOptions.excludedContextChecks],
    explicitDataQualityChecks: [
      ...planningOptions.explicitDataQualityChecks,
    ],
    excludedDataQualityChecks: [
      ...planningOptions.excludedDataQualityChecks,
    ],
    rangeOptions: planningOptions.rangeOptions.map(({ id, label }) => ({
      id,
      label,
    })),
    eventOptions: planningOptions.eventOptions.map(({ id, kind, label }) => ({
      id,
      kind,
      label,
    })),
    categoryOptions: planningOptions.categoryOptions.map(({ id, label }) => ({
      id,
      label,
    })),
  };
  const modelInput = {
    requestMode: "evidence-planning",
    untrustedQuestion: prompt,
    offeredOptions: modelOptions,
  };
  const encodedContext = JSON.stringify(modelInput);
  if (encodedContext.length > MAX_CONTEXT_CHARACTERS) {
    throw new Error("This evidence-planning request is too large to send safely.");
  }

  requestInFlight = true;
  let connectionLease: TarvisConnectionRequestLease | undefined;
  let modelRequestSent = false;
  let knownRequestMetrics: TarvisResponse["requestMetrics"];
  let knownUsage: TarvisUsage | undefined;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeExternalAbortListener: (() => void) | undefined;
  try {
    if (options.signal?.aborted) {
      throw new TarvisConnectionRequestAbortedError();
    }
    connectionLease = await beginTarvisConnectionRequest();
    if (options.signal) {
      const abortForScreenLifecycle = () => connectionLease?.abort();
      options.signal.addEventListener("abort", abortForScreenLifecycle, {
        once: true,
      });
      removeExternalAbortListener = () =>
        options.signal?.removeEventListener("abort", abortForScreenLifecycle);
      if (options.signal.aborted) connectionLease.abort();
    }
    connectionLease.assertCurrent();
    const key = await loadTarvisApiKey(writeLease);
    connectionLease.assertCurrent();
    if (!key) throw new Error("Add your OpenAI API key first.");

    const now = Date.now();
    const existingUsage = await loadTarvisUsage(writeLease);
    knownUsage = existingUsage;
    connectionLease.assertCurrent();
    // One user question needs this planner request and one guarded synthesis
    // request. Refuse before sending either if both cannot fit the local cap.
    const recent = checkTarvisRateLimit(existingUsage, now, 2);
    const reservedUsage: TarvisUsage = {
      ...existingUsage,
      requestTimestamps: [...recent, now],
      lastRequestAt: now,
    };
    const safetyIdentifier = await getTarvisSafetyIdentifier(writeLease);
    connectionLease.assertCurrent();
    // Do not charge the local model-request allowance for failures that
    // happen before fetch is about to be dispatched.
    await saveTarvisUsage(reservedUsage, writeLease);
    knownUsage = reservedUsage;
    connectionLease.assertCurrent();
    timeout = setTimeout(() => {
      timedOut = true;
      connectionLease?.abort();
    }, REQUEST_TIMEOUT_MS);
    modelRequestSent = true;
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: connectionLease.signal,
      body: JSON.stringify({
        model: MODEL,
        store: false,
        safety_identifier: safetyIdentifier,
        instructions: TARVIS_EVIDENCE_PLANNER_PROMPT,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: encodedContext }],
          },
        ],
        reasoning: { effort: "low" },
        max_output_tokens: 300,
        text: tarvisEvidencePlannerTextConfig(planningOptions),
      }),
    });
    connectionLease.assertCurrent();
    const body = (await response.json()) as OpenAiResponseBody;
    connectionLease.assertCurrent();
    if (!response.ok) throw new Error(openAiError(response.status, body));

    const tokens = body.usage ?? {};
    const usage: TarvisUsage = {
      ...reservedUsage,
      inputTokens: reservedUsage.inputTokens + (tokens.input_tokens ?? 0),
      outputTokens: reservedUsage.outputTokens + (tokens.output_tokens ?? 0),
      totalTokens: reservedUsage.totalTokens + (tokens.total_tokens ?? 0),
    };
    knownRequestMetrics = {
      model: MODEL,
      inputTokens: tokens.input_tokens ?? 0,
      outputTokens: tokens.output_tokens ?? 0,
      totalTokens: tokens.total_tokens ?? 0,
      estimatedCostUsd: estimateTarvisCostUsd(
        tokens.input_tokens ?? 0,
        tokens.output_tokens ?? 0,
      ),
      evidenceCharacters: encodedContext.length,
    };
    await saveTarvisUsage(usage, writeLease);
    knownUsage = usage;
    connectionLease.assertCurrent();
    if (body.status === "incomplete") {
      throw new Error(
        body.incomplete_details?.reason
          ? `OpenAI returned an incomplete evidence plan (${body.incomplete_details.reason}).`
          : "OpenAI returned an incomplete evidence plan.",
      );
    }
    return {
      plan: parseTarvisEvidencePlan(
        extractOutputText(body),
        planningOptions,
      ),
      usage,
      modelRequestSent: true,
      requestMetrics: knownRequestMetrics,
    };
  } catch (error) {
    await assertLocalDataWriteLeaseCurrent(writeLease);
    connectionLease?.assertGenerationCurrent();
    if (!timedOut) connectionLease?.assertCurrent();
    const message = timedOut
      ? "Tarv1s stopped evidence planning after 45 seconds. No automatic retry was made."
      : error instanceof Error
        ? error.message
        : "Tarv1s could not plan this evidence request.";
    throw new TarvisRequestFailureError(message, {
      modelRequestSent,
      requestMetrics: knownRequestMetrics,
      usage: knownUsage,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    removeExternalAbortListener?.();
    connectionLease?.release();
    requestInFlight = false;
  }
}
