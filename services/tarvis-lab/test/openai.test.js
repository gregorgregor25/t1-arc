import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAiAnswerer } from "../src/openai.js";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test("runs a Responses API tool loop and returns structured SQL evidence", async () => {
  const requestBodies = [];
  const responses = [
    {
      output: [
        {
          type: "function_call",
          name: "query_dataset",
          call_id: "call-query",
          arguments: JSON.stringify({
            purpose: "Calculate the maximum glucose in the requested range.",
            sql: "SELECT MAX(mmol_l) AS maximum_mmol_l FROM glucose_readings",
          }),
        },
      ],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    },
    {
      output_text: JSON.stringify({
        headline: "Your highest glucose was 17.5 mmol/L",
        answer: "The highest recorded glucose in that period was 17.5 mmol/L.",
        confidence: "high",
        evidenceIds: ["q1"],
        limitations: [],
      }),
      output: [],
      usage: { input_tokens: 150, output_tokens: 40, total_tokens: 190 },
    },
  ];
  const fetchImpl = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return jsonResponse(responses.shift());
  };
  const answerQuestion = createOpenAiAnswerer({ fetchImpl, endpoint: "https://example.invalid" });
  const result = await answerQuestion({
    apiKey: "test-key",
    model: "test-model",
    question: "What was my highest glucose?",
    history: [
      { role: "user", content: "What patterns did you find?" },
      { role: "assistant", content: "The strongest pattern was in the afternoon." },
    ],
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
  assert.equal(requestBodies[0].store, false);
  assert.deepEqual(requestBodies[0].include, ["reasoning.encrypted_content"]);
  assert.equal(requestBodies[0].tool_choice, "required");
  assert.deepEqual(requestBodies[0].tools.map((tool) => tool.name), ["query_dataset"]);
  assert.deepEqual(requestBodies[0].input[0], {
    role: "user",
    content: "What patterns did you find?",
  });
  assert.deepEqual(requestBodies[0].input[1], {
    role: "assistant",
    content: "The strongest pattern was in the afternoon.",
  });
  assert.match(requestBodies[0].input[2].content[0].text, /as_of_ms=1787680800000/u);
  assert.match(
    requestBodies[0].input[2].content[0].text,
    /2026-08-25 19:00:00 Europe\/London \(Tuesday, GMT\+01:00\)/u,
  );
  assert.equal(requestBodies[1].tool_choice, "auto");
  assert.deepEqual(requestBodies[1].tools.map((tool) => tool.name), [
    "describe_dataset",
    "query_dataset",
  ]);
  assert.equal(requestBodies[1].input.at(-1).type, "function_call_output");
  assert.deepEqual(result.answer.evidenceIds, ["q1"]);
  assert.deepEqual(result.evidence[0].preview, [{ maximum_mmol_l: 17.5 }]);
  assert.equal(result.metrics.modelRounds, 2);
  assert.equal(result.metrics.sqlCalls, 1);
  assert.equal(result.metrics.inputTokens, 250);
  assert.equal(result.metrics.outputTokens, 60);
  assert.equal(result.metrics.totalTokens, 310);
});
