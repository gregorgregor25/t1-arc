import assert from "node:assert/strict";
import test from "node:test";
import { createLfmAnswerer } from "../src/lfm.js";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function completion(message, {
  finishReason = "stop",
  promptTokens = 100,
  completionTokens = 20,
} = {}) {
  return {
    choices: [{ finish_reason: finishReason, message }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    timings: {
      cache_n: 10,
      prompt_n: promptTokens - 10,
      predicted_n: completionTokens,
      prompt_ms: 25,
      predicted_ms: 100,
    },
  };
}

test("runs the phone LFM tool loop and a separate structured synthesis round", async () => {
  const requestBodies = [];
  const responses = [
    completion({
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call-query",
        type: "function",
        function: {
          name: "query_dataset",
          arguments: JSON.stringify({
            purpose: "Calculate the maximum glucose in the requested range.",
            sql: "SELECT MAX(mmol_l) AS maximum_mmol_l FROM glucose_readings",
          }),
        },
      }],
    }),
    completion({
      role: "assistant",
      content: JSON.stringify({
        headline: "Your highest glucose was 17.5 mmol/L",
        answer: "The highest recorded glucose in that period was 17.5 mmol/L.",
        confidence: "high",
        evidenceIds: ["q1"],
        limitations: [],
      }),
    }),
  ];
  const fetchImpl = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return jsonResponse(responses.shift());
  };
  const answerQuestion = createLfmAnswerer({
    fetchImpl,
    endpoint: "http://phone.invalid/v1/chat/completions",
  });
  const result = await answerQuestion({
    apiKey: "phone-key",
    model: "lfm2.5-1.2b-thinking-phone",
    question: "What was my highest glucose?",
    asOfMs: 1_787_680_800_000,
    dataset: {
      description: { timezone: "Europe/London", totalRows: 1, tables: {} },
      query: () => ({
        columns: ["maximum_mmol_l"],
        rows: [{ maximum_mmol_l: 17.5 }],
        rowCount: 1,
        truncated: false,
      }),
    },
    timeoutMs: 5_000,
    maxToolRounds: 4,
  });

  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].tool_choice, "required");
  assert.equal(requestBodies[0].thinking_budget_tokens, 256);
  assert.match(requestBodies[0].reasoning_budget_message, /analysis tool/u);
  assert.deepEqual(
    requestBodies[0].tools.map((tool) => tool.function.name),
    ["query_dataset"],
  );
  assert.equal(requestBodies[0].response_format, undefined);
  assert.equal(requestBodies[0].max_tokens, 480);
  assert.equal(requestBodies[1].max_tokens, 800);
  assert.equal(requestBodies[1].messages.at(-2).role, "tool");
  assert.equal(requestBodies[1].tools, undefined);
  assert.equal(requestBodies[1].response_format.type, "json_schema");
  assert.equal(requestBodies[1].thinking_budget_tokens, 256);
  assert.match(requestBodies[1].reasoning_budget_message, /JSON object/u);
  assert.equal(requestBodies[1].response_format.json_schema.name, "tarvis_answer");
  assert.deepEqual(result.answer.evidenceIds, ["q1"]);
  assert.deepEqual(result.evidence[0].preview, [{ maximum_mmol_l: 17.5 }]);
  assert.equal(result.metrics.modelRounds, 2);
  assert.equal(result.metrics.sqlCalls, 1);
  assert.equal(result.metrics.phoneInference.generatedTokens, 40);
  assert.equal(result.metrics.phoneInference.decodeTokensPerSecond, 200);
});
