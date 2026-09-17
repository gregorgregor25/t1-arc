import type { TarvisDirectResponseRequest } from "../../../modules/t1arc-tarvis-direct/src/T1ArcTarvisDirect.types";
import {
  TARVIS_DIRECT_LOCAL_TOOLS,
  TarvisDirectLocalToolExecutor,
} from "./directLocalTools";
import {
  parseTarvisDirectAnswerPresentation,
  TARVIS_DIRECT_ANSWER_FORMAT,
} from "@/data/tarvis/directAnswerPresentation";
import { classifyTarvisQuestion } from "@/data/tarvis/scope";
import { isTarvisReviewedKnowledgeQuestion } from "@/data/tarvis/reviewedKnowledge";
import type {
  TarvisDirectAnswerPresentation,
  TarvisGuidanceReference,
} from "@/data/tarvis/types";
import type { EvidenceReference } from "@/domain/insights";

type JsonObject = Record<string, unknown>;

interface DirectTransport {
  createResponseAsync(request: TarvisDirectResponseRequest): Promise<string>;
}

export interface TarvisDirectConversationOptions {
  context?: string;
  history?: { role: "user" | "assistant"; text: string }[];
  model: string;
  question: string;
  transport: DirectTransport;
  tools: TarvisDirectLocalToolExecutor;
  reasoningEffort?: TarvisDirectResponseRequest["reasoningEffort"];
  maxOutputTokens?: number;
  maximumModelTurns?: number;
}

export interface TarvisDirectConversationResult {
  answer: string;
  presentation: TarvisDirectAnswerPresentation;
  model: string;
  modelTurns: number;
  localToolCalls: {
    name: string;
    argumentsJson: string;
    resultJson: string;
    durationMs: number;
    evidenceIds: string[];
  }[];
  evidenceReferences: EvidenceReference[];
  guidanceReferences: TarvisGuidanceReference[];
  modelRequestSent: boolean;
  modelTimings: { turn: number; durationMs: number }[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

const DIRECT_INSTRUCTIONS = `You are TARV1S, the user's familiar, professional and friendly Type 1 diabetes data companion inside T1 Arc.

Answer the user's actual question directly. Your first response must call the single best local tool. Use the fast purpose-built capability when one matches; use the generic local query tools for questions that need custom correlation. You may call several tools and correlate records across tables. Never invent a record, number, event or source. Treat missing data as unknown, not zero and not proof that something did not happen. Use answer_out_of_scope for unrelated requests and answer_t1arc_help for app, privacy, security, connection or credential questions. Never answer general trivia.

Keep workout types and sources distinct. Gym describes a location, not an activity type. If the user says gym without naming a source or activity type, request workoutKind any and sourcePreference any, then present the dated/source-labelled candidates and ask which they mean; never guess Hevy or strength. If the user names Hevy, Samsung Health/Health Connect, Strava, walking, running, cycling or strength, request that exact source or type. Name the returned source and activity type so the answer is not ambiguous. Tool arguments and fields ending LocalDate or local_date are canonical ISO date keys. Do not quote those keys to the user when the tool also returns the corresponding locale-aware LocalDateLabel or local_date_label; copy the label and the exact localized LocalTime string instead. Never derive a calendar date or wall-clock time from startMs or endMs yourself.

Use get_context_records for exact meal, sleep, weight, medication, note or ketone detail instead of reducing those records to a generic trend. Preserve recorded item names, amounts, units, source labels, local dates and local times. For a question about glucose or other context around a particular activity, first identify the exact activity with get_latest_workout, then call get_activity_glucose_context with its returned ID. Compare the returned before/during/after windows and mention nearby recorded carbohydrate or bolus only as timing context, never as proven cause. Use get_daily_health_summary for daily Health Connect totals, extrema and trends across its full metric list. Use generic schema discovery and queries only when no purpose-built tool answers the question.

For basal, bolus, total-insulin or insulin-split questions, use get_insulin_summary. Treat its latest source daily snapshot as authoritative for that day; never add cumulative same-day snapshots together. Check dataCompleteness before answering. When sourceDailyTotalsCompleteForRequestedRange is false, explicitly describe the values as incomplete or recorded so far, name the affected dates, give the returned source as-of time when available, and never present absent basal detail as zero or a partial day as final.

For every personal-data answer, include the exact requested period, the human-readable source when known, and the most useful specific records—not just an aggregate—unless the user explicitly asks for only a single number. Whenever you mention a particular reading, measurement, dose, meal, workout, sleep session, medication, ketone result or other timestamped record, include its exact returned locale-aware date label and local time. For an interval, include its returned localized start and end. For an aggregate, name its exact localized date or date range rather than pretending that the total occurred at one instant. If multiple records plausibly match, show concise dated candidates or ask a focused clarification instead of silently choosing one. Never substitute a different data type or source.

For a highest, lowest, maximum or minimum timestamped result, always state the exact local date and time returned by the tool, even if the user only asked for the value. If the same extreme occurred more than once, say when it first and most recently occurred rather than implying there was only one occurrence.

Lead with a concise answer in natural language matching the user's locale. Then give the few strongest supporting facts with dates/times and units where useful. Sound like a knowledgeable person who knows the user, not a database report. Avoid long boilerplate, internal implementation language and repeated caveats. Distinguish evidence, plausible interpretation and uncertainty. For 'why' questions, explain which recorded factors support or weaken possible explanations without claiming causation.

Never show more than two digits after a decimal point in any user-visible number. Use the normal domain precision when it is stricter: glucose usually one decimal place, while insulin and hydration may use up to two. Keep counts as whole numbers. Do not expose raw calculation precision.

Return the requested structured answer. Set source to records for personal evidence, guidance for reviewed guidance, or t1arc for app help. The headline and summary must answer the actual question, not merely describe a general glucose trend. Use primaryMetric for the single most useful numeric result, or null when there is no honest single metric. Put only genuinely useful facts in keyFindings. Every evidence item must use the exact evidenceId returned by a local tool; never invent or alter an evidence ID. Keep limitations short and specific. Offer up to three natural follow-up questions. Set safetyNotice only when the particular question or evidence warrants it; otherwise return null. Do not use Markdown in any field.

This is retrospective information, not diagnosis or treatment direction. Do not calculate, recommend or imply insulin doses, corrections, ratios, pump settings or medication changes. If the user asks for urgent or treatment advice, advise them to follow their care plan or contact their diabetes team or local emergency services as appropriate. Use the locale, timezone, glucose unit, measurement system, energy unit and clinical-guidance jurisdiction supplied in the regional context. Tool fields ending MmolL, Kilograms, Metres, Celsius or Kcal are canonical storage values; convert them only for presentation and never change their meaning.`;

export async function runTarvisDirectConversation({
  model,
  question,
  context,
  history = [],
  transport,
  tools,
  reasoningEffort = "low",
  maxOutputTokens = 2_400,
  maximumModelTurns = 8,
}: TarvisDirectConversationOptions): Promise<TarvisDirectConversationResult> {
  const cleanedQuestion = question.trim();
  if (!cleanedQuestion || cleanedQuestion.length > 4_000) {
    throw new Error("Ask TARV1S a question between 1 and 4,000 characters.");
  }
  if (
    !Number.isInteger(maximumModelTurns) ||
    maximumModelTurns < 1 ||
    maximumModelTurns > 12
  ) {
    throw new Error("The TARV1S tool-turn limit is invalid.");
  }
  const localScope = classifyTarvisQuestion(cleanedQuestion, history);
  if (localScope === "sensitive_credentials") {
    return controlledResult(model, controlledPresentation("t1arc_help"));
  }
  if (localScope === "off_topic" && !isT1ArcHelpQuestion(cleanedQuestion)) {
    return controlledResult(model, controlledPresentation("out_of_scope"));
  }
  if (localScope === "off_topic") {
    return controlledResult(model, controlledPresentation("t1arc_help"));
  }
  const input: JsonObject[] = [
    { role: "developer", content: DIRECT_INSTRUCTIONS },
    ...(context
      ? [{ role: "developer", content: context.slice(0, 2_000) }]
      : []),
    ...history.slice(-12).map((turn) => ({
      role: turn.role,
      content: turn.text.slice(0, 8_000),
    })),
    { role: "user", content: cleanedQuestion },
  ];
  const localToolCalls: TarvisDirectConversationResult["localToolCalls"] = [];
  const modelTimings: TarvisDirectConversationResult["modelTimings"] = [];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const availableTools = isTarvisReviewedKnowledgeQuestion(cleanedQuestion)
    ? TARVIS_DIRECT_LOCAL_TOOLS.filter(
        ({ name }) => name === "lookup_reviewed_guidance",
      )
    : TARVIS_DIRECT_LOCAL_TOOLS;

  for (let modelTurn = 1; modelTurn <= maximumModelTurns; modelTurn += 1) {
    const modelStartedAt = Date.now();
    const raw = await transport.createResponseAsync({
      model,
      inputJson: JSON.stringify(input),
      toolsJson: JSON.stringify(availableTools),
      textFormatJson: JSON.stringify(TARVIS_DIRECT_ANSWER_FORMAT),
      maxOutputTokens,
      reasoningEffort,
      toolChoice: tools.hasVerifiedEvidence() ? "auto" : "required",
    });
    modelTimings.push({
      turn: modelTurn,
      durationMs: Date.now() - modelStartedAt,
    });
    const response = parseResponse(raw);
    addUsage(usage, response.usage);
    const output = requireOutput(response);
    const calls = output.filter(isFunctionCall);
    if (!calls.length) {
      if (!tools.hasVerifiedEvidence()) {
        throw new Error(
          "TARV1S tried to answer without verified local evidence.",
        );
      }
      const answer = extractAnswer(response, output);
      if (!answer) {
        throw new Error("TARV1S completed without returning an answer.");
      }
      const presentation = verifiedPresentation(
        parseTarvisDirectAnswerPresentation(answer),
        tools.evidenceReferences(),
        tools.guidanceReferences(),
      );
      if (containsUnsafeTreatmentInstruction(presentation)) {
        throw new Error(
          "TARV1S withheld an answer that could be read as treatment direction.",
        );
      }
      return {
        answer: presentation.summary,
        presentation,
        model,
        modelTurns: modelTurn,
        localToolCalls,
        evidenceReferences: tools.evidenceReferences(),
        guidanceReferences: tools.guidanceReferences(),
        modelRequestSent: true,
        modelTimings,
        usage,
      };
    }

    input.push(...output);
    for (const call of calls) {
      const name = requireString(call.name, "local tool name");
      const argumentsJson = requireString(
        call.arguments,
        "local tool arguments",
      );
      const callId = requireString(call.call_id, "local tool call ID");
      const execution = await tools.executeDetailed(name, argumentsJson);
      const { resultJson } = execution;
      localToolCalls.push({
        name,
        argumentsJson,
        resultJson,
        durationMs: execution.durationMs,
        evidenceIds: execution.evidenceIds,
      });
      if (execution.controlAction) {
        return controlledResult(
          model,
          controlledPresentation(execution.controlAction),
          {
            localToolCalls,
            modelRequestSent: true,
            modelTimings,
            usage,
          },
        );
      }
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: resultJson,
      });
    }
    if (input.length > 256) {
      throw new Error("TARV1S requested too many local evidence operations.");
    }
  }
  throw new Error(
    "TARV1S reached the local evidence-call limit before answering.",
  );
}

function parseResponse(raw: string): JsonObject {
  if (raw.length > 2 * 1024 * 1024)
    throw new Error("The TARV1S response is too large.");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenAI returned an invalid TARV1S response.");
  }
  const response = parsed as JsonObject;
  if (response.status === "failed") {
    const error = response.error as JsonObject | undefined;
    throw new Error(
      typeof error?.message === "string"
        ? error.message
        : "The TARV1S model request failed.",
    );
  }
  return response;
}

function requireOutput(response: JsonObject): JsonObject[] {
  if (!Array.isArray(response.output)) {
    throw new Error("OpenAI returned no TARV1S output items.");
  }
  return response.output.filter(
    (item): item is JsonObject =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function isFunctionCall(item: JsonObject) {
  return item.type === "function_call";
}

function extractAnswer(response: JsonObject, output: JsonObject[]) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  return output
    .filter((item) => item.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content as unknown[])
    .filter(
      (content): content is JsonObject =>
        Boolean(content) &&
        typeof content === "object" &&
        !Array.isArray(content),
    )
    .filter(
      (content) =>
        content.type === "output_text" && typeof content.text === "string",
    )
    .map((content) => String(content.text))
    .join("\n")
    .trim();
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value)
    throw new Error(`OpenAI returned an invalid ${label}.`);
  return value;
}

function addUsage(
  total: TarvisDirectConversationResult["usage"],
  value: unknown,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const usage = value as JsonObject;
  total.inputTokens += finiteInteger(usage.input_tokens);
  total.outputTokens += finiteInteger(usage.output_tokens);
  total.totalTokens += finiteInteger(usage.total_tokens);
}

function finiteInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function isT1ArcHelpQuestion(question: string) {
  return (
    /\b(?:t1\s*arc|tarv1s|tarvis|this app|the app)\b/i.test(question) &&
    /\b(?:how|help|work|works|working|connect|connection|privacy|private|secure|security|feature|features|can|cannot|can't|settings?)\b/i.test(
      question,
    )
  );
}

function controlledPresentation(
  action: "out_of_scope" | "t1arc_help",
): TarvisDirectAnswerPresentation {
  if (action === "out_of_scope") {
    return {
      version: 1,
      kind: "general",
      source: "t1arc",
      headline: "That is outside what I’m here for",
      summary:
        "I’m here to help with your Type 1 diabetes, the health records held in T1 Arc, and using the app. Ask me about one of those and I’ll dig into it with you.",
      confidence: "high",
      primaryMetric: null,
      keyFindings: [],
      interpretation: null,
      evidence: [],
      limitations: [],
      followUpQuestions: [],
      safetyNotice: null,
    };
  }
  return {
    version: 1,
    kind: "general",
    source: "t1arc",
    headline: "Your connection details stay protected",
    summary:
      "T1 Arc manages credentials and short-lived access securely. I can help explain the connection, but I can’t display, recover or copy passwords, tokens or API keys into this conversation.",
    confidence: "high",
    primaryMetric: null,
    keyFindings: [],
    interpretation: null,
    evidence: [],
    limitations: [],
    followUpQuestions: ["How does Tarv1s use my local records?"],
    safetyNotice: null,
  };
}

function controlledResult(
  model: string,
  presentation: TarvisDirectAnswerPresentation,
  partial?: Pick<
    TarvisDirectConversationResult,
    "localToolCalls" | "modelRequestSent" | "modelTimings" | "usage"
  >,
): TarvisDirectConversationResult {
  return {
    answer: presentation.summary,
    presentation,
    model,
    modelTurns: partial?.modelTimings.length ?? 0,
    localToolCalls: partial?.localToolCalls ?? [],
    evidenceReferences: [],
    guidanceReferences: [],
    modelRequestSent: partial?.modelRequestSent ?? false,
    modelTimings: partial?.modelTimings ?? [],
    usage: partial?.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  };
}

function verifiedPresentation(
  presentation: TarvisDirectAnswerPresentation,
  evidenceReferences: EvidenceReference[],
  guidanceReferences: TarvisGuidanceReference[],
): TarvisDirectAnswerPresentation {
  const recordIds = new Set(evidenceReferences.map(({ id }) => id));
  const guidanceIds = new Set(
    guidanceReferences.map(({ knowledgeId }) => `guidance:${knowledgeId}`),
  );
  const availableIds = [...recordIds, ...guidanceIds];
  const normalizedEvidence = presentation.evidence.flatMap((item) => {
    const requested = item.evidenceId;
    const evidenceId =
      typeof requested === "string" &&
      (recordIds.has(requested) || guidanceIds.has(requested))
        ? requested
        : availableIds.length === 1
          ? availableIds[0]!
          : undefined;
    return evidenceId ? [{ ...item, evidenceId }] : [];
  });
  if (!normalizedEvidence.length && availableIds.length) {
    const evidenceId = availableIds[0]!;
    const record = evidenceReferences.find(({ id }) => id === evidenceId);
    const guidance = guidanceReferences.find(
      ({ knowledgeId }) => `guidance:${knowledgeId}` === evidenceId,
    );
    normalizedEvidence.push({
      label: record?.label ?? guidance?.sourceTitle ?? "Verified source",
      detail:
        record?.description ??
        (guidance
          ? `Reviewed ${guidance.jurisdiction} guidance, recommendations ${guidance.recommendationRefs.join(", ")}.`
          : "Verified locally by T1 Arc."),
      evidenceId,
    });
  }
  if (!normalizedEvidence.length) {
    throw new Error("TARV1S did not link its answer to verified evidence.");
  }
  return {
    ...presentation,
    source: guidanceReferences.length ? "guidance" : "records",
    evidence: normalizedEvidence,
  };
}

function containsUnsafeTreatmentInstruction(
  presentation: TarvisDirectAnswerPresentation,
) {
  const text = [
    presentation.headline,
    presentation.summary,
    presentation.interpretation ?? "",
    presentation.safetyNotice ?? "",
    ...presentation.keyFindings.flatMap(({ title, detail }) => [title, detail]),
  ].join(" ");
  return (
    /\b(?:take|inject|give yourself|bolus|dose)\s+\d+(?:\.\d+)?\s*(?:u|units?)\b/i.test(
      text,
    ) ||
    /\b(?:increase|decrease|change|set|adjust)\b[\s\S]{0,45}\b(?:basal|bolus|insulin|ratio|correction factor|pump setting)\b/i.test(
      text,
    )
  );
}
