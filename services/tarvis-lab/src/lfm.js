import { performance } from "node:perf_hooks";
import { HttpError, UpstreamError } from "./errors.js";
import {
  INSTRUCTIONS,
  TARVIS_ANSWER_FORMAT,
  TOOLS,
  trustedLocalInstant,
  validateAnswerShape,
} from "./openai.js";

const MAX_TOOL_CALLS = 18;
const GATHER_REASONING_BUDGET = 256;
const SYNTHESIS_REASONING_BUDGET = 256;
const LFM_INSTRUCTIONS = `${INSTRUCTIONS}

Phone-model execution rules:
- Plan the evidence as one exact read-only SQL SELECT whenever possible. Use CTEs, joins and aggregate columns inside that query when the question needs several calculations.
- On the evidence-gathering turn, call query_dataset immediately. Do not narrate the plan or answer before the tool call.
- After a successful query, TARV1S will ask you to write the final evidence-grounded answer.`;

function safeJsonParse(value, code, message) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new UpstreamError(code, message, { cause: error });
  }
}

function statusError(status) {
  if (status === 401 || status === 403) {
    return new UpstreamError(
      "local_model_authentication_failed",
      "The phone-hosted TARV1S model credentials were rejected.",
    );
  }
  if (status === 429 || status === 503) {
    return new HttpError(
      503,
      "local_model_busy",
      "The phone-hosted TARV1S model is still loading or busy.",
    );
  }
  return new UpstreamError(
    "local_model_request_failed",
    "The phone-hosted TARV1S model request failed.",
  );
}

async function createChatCompletion({ apiKey, body, endpoint, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw statusError(response.status);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new UpstreamError(
        "local_model_response_invalid",
        "The phone-hosted TARV1S model returned an invalid response.",
        { cause: error },
      );
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new HttpError(
        504,
        "local_model_timeout",
        "The phone-hosted TARV1S model took too long to respond.",
      );
    }
    if (error instanceof HttpError) {
      throw error;
    }
    throw new UpstreamError(
      "local_model_unreachable",
      "The phone-hosted TARV1S model could not be reached.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function chatTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: tool.strict,
    },
  }));
}

function parseToolArguments(call) {
  if (
    !call ||
    typeof call.id !== "string" ||
    !call.function ||
    typeof call.function.name !== "string" ||
    typeof call.function.arguments !== "string"
  ) {
    throw new UpstreamError(
      "local_model_tool_call_invalid",
      "The phone-hosted model returned an invalid analysis request.",
    );
  }
  const args = safeJsonParse(
    call.function.arguments,
    "local_model_tool_call_invalid",
    "The phone-hosted model returned invalid analysis arguments.",
  );
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new UpstreamError(
      "local_model_tool_call_invalid",
      "The phone-hosted model returned invalid analysis arguments.",
    );
  }
  return args;
}

function normalizedUsage(usage) {
  return {
    inputTokens: Number(usage?.prompt_tokens) || 0,
    outputTokens: Number(usage?.completion_tokens) || 0,
    totalTokens: Number(usage?.total_tokens) || 0,
  };
}

function accumulateInference(metrics, response) {
  const timings = response?.timings ?? {};
  metrics.promptTokens += Number(timings.prompt_n) || 0;
  metrics.cachedPromptTokens += Number(timings.cache_n) || 0;
  metrics.generatedTokens += Number(timings.predicted_n) || 0;
  metrics.promptMs += Number(timings.prompt_ms) || 0;
  metrics.generatedMs += Number(timings.predicted_ms) || 0;
}

function completionMessage(response) {
  const choice = response?.choices?.[0];
  const message = choice?.message;
  if (!message || typeof message !== "object") {
    throw new UpstreamError(
      "local_model_response_invalid",
      "The phone-hosted TARV1S model returned an invalid response.",
    );
  }
  return { choice, message };
}

export function createLfmAnswerer({ fetchImpl = globalThis.fetch, endpoint } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    throw new Error("A phone model Chat Completions endpoint is required.");
  }

  return async function answerQuestion({
    apiKey,
    model,
    question,
    asOfMs = null,
    history = [],
    dataset,
    timeoutMs,
    maxToolRounds,
  }) {
    const startedAt = performance.now();
    const datasetTimeZone = dataset.description.timezone || "Europe/London";
    const trustedRequestTime = asOfMs === null
      ? "No separate request clock was supplied."
      : `Trusted request time: ${trustedLocalInstant(asOfMs, datasetTimeZone)}; as_of_ms=${asOfMs}. Use this already-converted local date for words such as today, yesterday and named weekdays; do not recalculate it from the epoch.`;
    const trustedDatasetCatalogue = JSON.stringify(dataset.description);
    const messages = [
      { role: "system", content: LFM_INSTRUCTIONS },
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      {
        role: "user",
        content: `${trustedRequestTime}\n\nTrusted dataset catalogue (schema, relationships, row counts and coverage; no user-authored record text):\n${trustedDatasetCatalogue}\n\nUser question: ${question}`,
      },
    ];
    const evidence = [];
    const availableEvidenceIds = new Set();
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const phoneInference = {
      promptTokens: 0,
      cachedPromptTokens: 0,
      generatedTokens: 0,
      promptMs: 0,
      generatedMs: 0,
    };
    let modelRequests = 0;
    let toolCalls = 0;
    let modelMs = 0;
    let sqlMs = 0;
    let gatheringComplete = false;

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const remainingMs = timeoutMs - (performance.now() - startedAt);
      if (remainingMs <= 0) {
        throw new HttpError(
          504,
          "local_model_timeout",
          "The phone-hosted TARV1S analysis took too long to complete.",
        );
      }
      const availableTools = evidence.length === 0 ? [TOOLS[1]] : TOOLS;
      const modelStartedAt = performance.now();
      const response = await createChatCompletion({
        apiKey,
        endpoint,
        fetchImpl,
        timeoutMs: remainingMs,
        body: {
          model,
          messages,
          tools: chatTools(availableTools),
          tool_choice: evidence.length === 0 ? "required" : "auto",
          parallel_tool_calls: false,
          temperature: 0.05,
          top_k: 50,
          repeat_penalty: 1.05,
          thinking_budget_tokens: GATHER_REASONING_BUDGET,
          reasoning_budget_message: "Stop reasoning and call the required analysis tool now.",
          max_tokens: 480,
        },
      });
      modelMs += performance.now() - modelStartedAt;
      modelRequests += 1;
      accumulateInference(phoneInference, response);
      const requestUsage = normalizedUsage(response.usage);
      usage.inputTokens += requestUsage.inputTokens;
      usage.outputTokens += requestUsage.outputTokens;
      usage.totalTokens += requestUsage.totalTokens;

      const { choice, message } = completionMessage(response);
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (calls.length === 0) {
        if (evidence.length === 0 && round < maxToolRounds) {
          messages.push({ role: "assistant", content: "" });
          messages.push({
            role: "user",
            content: "No dataset query was made. Call query_dataset now and output only the tool call.",
          });
          continue;
        }
        if (choice.finish_reason === "length" || evidence.length === 0) {
          throw new UpstreamError(
            "local_model_output_missing",
            "The phone-hosted model did not finish gathering evidence.",
          );
        }
        if (typeof message.content === "string" && message.content.trim()) {
          messages.push({ role: "assistant", content: message.content });
        }
        gatheringComplete = true;
        break;
      }

      if (round === maxToolRounds || toolCalls + calls.length > MAX_TOOL_CALLS) {
        throw new UpstreamError(
          "analysis_limit_reached",
          "The phone-hosted model could not finish within the TARV1S lab analysis limit.",
        );
      }

      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        tool_calls: calls,
      });
      for (const call of calls) {
        toolCalls += 1;
        const args = parseToolArguments(call);
        let toolResult;
        if (call.function.name === "describe_dataset") {
          toolResult = { ok: true, dataset: dataset.description };
        } else if (call.function.name === "query_dataset") {
          if (
            typeof args.sql !== "string" ||
            typeof args.purpose !== "string" ||
            args.purpose.length > 300
          ) {
            throw new UpstreamError(
              "local_model_tool_call_invalid",
              "The phone-hosted model returned invalid query arguments.",
            );
          }
          try {
            const sqlStartedAt = performance.now();
            const result = dataset.query(args.sql);
            sqlMs += performance.now() - sqlStartedAt;
            const evidenceId = `q${evidence.length + 1}`;
            const evidenceItem = {
              id: evidenceId,
              purpose: args.purpose,
              sql: args.sql,
              columns: result.columns,
              rowCount: result.rowCount,
              preview: result.rows,
              truncated: result.truncated,
            };
            evidence.push(evidenceItem);
            availableEvidenceIds.add(evidenceId);
            toolResult = { ok: true, evidenceId, ...result };
          } catch (error) {
            if (!(error instanceof HttpError)) {
              throw error;
            }
            toolResult = {
              ok: false,
              error: { code: error.code, message: error.message },
            };
          }
        } else {
          throw new UpstreamError(
            "local_model_tool_unknown",
            "The phone-hosted model requested an unknown TARV1S analysis tool.",
          );
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(toolResult),
        });
      }
      if (evidence.length > 0) {
        gatheringComplete = true;
        break;
      }
    }

    if (!gatheringComplete) {
      throw new UpstreamError(
        "analysis_limit_reached",
        "The phone-hosted model could not finish within the TARV1S lab analysis limit.",
      );
    }

    messages.push({
      role: "user",
      content: `Now produce the final TARV1S answer using only the successful evidence above. Return only one JSON object with exactly the schema below. Do not include markdown or commentary outside it.\n${JSON.stringify(TARVIS_ANSWER_FORMAT.schema)}`,
    });
    const remainingMs = timeoutMs - (performance.now() - startedAt);
    if (remainingMs <= 0) {
      throw new HttpError(
        504,
        "local_model_timeout",
        "The phone-hosted TARV1S analysis took too long to complete.",
      );
    }
    const synthesisStartedAt = performance.now();
    const finalResponse = await createChatCompletion({
      apiKey,
      endpoint,
      fetchImpl,
      timeoutMs: remainingMs,
      body: {
        model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: TARVIS_ANSWER_FORMAT.name,
            strict: TARVIS_ANSWER_FORMAT.strict,
            schema: TARVIS_ANSWER_FORMAT.schema,
          },
        },
        temperature: 0.05,
        top_k: 50,
        repeat_penalty: 1.05,
        thinking_budget_tokens: SYNTHESIS_REASONING_BUDGET,
        reasoning_budget_message: "Stop reasoning and return the requested JSON object now.",
        max_tokens: 800,
      },
    });
    modelMs += performance.now() - synthesisStartedAt;
    modelRequests += 1;
    accumulateInference(phoneInference, finalResponse);
    const finalUsage = normalizedUsage(finalResponse.usage);
    usage.inputTokens += finalUsage.inputTokens;
    usage.outputTokens += finalUsage.outputTokens;
    usage.totalTokens += finalUsage.totalTokens;
    const { choice: finalChoice, message: finalMessage } = completionMessage(finalResponse);
    if (
      finalChoice.finish_reason === "length" ||
      typeof finalMessage.content !== "string" ||
      !finalMessage.content.trim()
    ) {
      throw new UpstreamError(
        "local_model_output_missing",
        "The phone-hosted model did not return a TARV1S answer.",
      );
    }
    const answer = validateAnswerShape(
      safeJsonParse(
        finalMessage.content,
        "local_model_output_invalid",
        "The phone-hosted model returned an invalid TARV1S answer.",
      ),
      availableEvidenceIds,
    );
    if (answer.evidenceIds.length === 0) {
      throw new UpstreamError(
        "local_model_evidence_missing",
        "The phone-hosted model did not cite the evidence used for its TARV1S answer.",
      );
    }

    const weightedDecodeRate = phoneInference.generatedMs > 0
      ? (phoneInference.generatedTokens * 1_000) / phoneInference.generatedMs
      : 0;
    return {
      answer,
      evidence,
      metrics: {
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        modelRounds: modelRequests,
        sqlCalls: evidence.length,
        sqlMs: Math.round(sqlMs),
        modelMs: Math.round(modelMs),
        totalMs: Math.round(performance.now() - startedAt),
        phoneInference: {
          promptTokens: phoneInference.promptTokens,
          cachedPromptTokens: phoneInference.cachedPromptTokens,
          generatedTokens: phoneInference.generatedTokens,
          promptMs: Math.round(phoneInference.promptMs),
          generatedMs: Math.round(phoneInference.generatedMs),
          decodeTokensPerSecond: Number(weightedDecodeRate.toFixed(2)),
        },
      },
    };
  };
}
