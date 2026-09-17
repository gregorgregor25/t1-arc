import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { readConfig } from "../src/config.js";
import { createTarvisLabServer } from "../src/server.js";
import { emptySnapshot } from "./fixtures.js";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

test("supports the health, session, question and deletion lifecycle", async () => {
  const config = readConfig({
    ALLOW_CLIENT_OPENAI_KEY: "1",
    SESSION_TTL_MS: "60000",
  });
  const answerQuestion = async ({ apiKey, question, asOfMs, dataset }) => {
    assert.equal(apiKey, "developer-key");
    assert.equal(question, "What data do you have?");
    assert.equal(asOfMs, 1_787_680_800_000);
    assert.equal(dataset.description.schemaVersion, 1);
    return {
      answer: {
        headline: "I can see the temporary snapshot",
        answer: "It contains no rows.",
        confidence: "high",
        evidenceIds: [],
        limitations: [],
      },
      evidence: [],
      metrics: {
        model: "fake",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        modelRounds: 0,
        sqlCalls: 0,
        sqlMs: 0,
        modelMs: 0,
        totalMs: 0,
      },
    };
  };
  const { server } = createTarvisLabServer({ config, answerQuestion });
  const baseUrl = await listen(server);
  try {
    const healthResponse = await fetch(`${baseUrl}/dev/v1/health`);
    assert.equal(healthResponse.status, 200);
    assert.equal((await healthResponse.json()).storage, "ephemeral-memory");

    const createResponse = await fetch(`${baseUrl}/dev/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(emptySnapshot()),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.match(created.sessionId, /^[0-9a-f-]{36}$/u);
    assert.equal(created.rowCount, 0);

    const questionResponse = await fetch(
      `${baseUrl}/dev/v1/sessions/${created.sessionId}/questions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openai-api-key": "developer-key",
        },
        body: JSON.stringify({
          question: "What data do you have?",
          asOfMs: 1_787_680_800_000,
        }),
      },
    );
    assert.equal(questionResponse.status, 200);
    assert.equal((await questionResponse.json()).answer.confidence, "high");

    const deleteResponse = await fetch(`${baseUrl}/dev/v1/sessions/${created.sessionId}`, {
      method: "DELETE",
    });
    assert.equal(deleteResponse.status, 204);

    const missingResponse = await fetch(
      `${baseUrl}/dev/v1/sessions/${created.sessionId}/questions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openai-api-key": "developer-key",
        },
        body: JSON.stringify({ question: "Still there?" }),
      },
    );
    assert.equal(missingResponse.status, 404);
  } finally {
    await close(server);
  }
});

test("can require a service bearer token without exposing it in errors", async () => {
  const config = readConfig({
    TARVIS_LAB_BEARER_TOKEN: "service-secret",
    SESSION_TTL_MS: "60000",
  });
  const { server } = createTarvisLabServer({
    config,
    apiKeyStore: { key: "model-key", remember: async () => {} },
    answerQuestion: async () => assert.fail("answerer should not be reached"),
  });
  const baseUrl = await listen(server);
  try {
    const response = await fetch(`${baseUrl}/dev/v1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(emptySnapshot()),
    });
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.doesNotMatch(body, /service-secret/u);
  } finally {
    await close(server);
  }
});

test("serves the self-contained dark browser UI with private cache headers", async () => {
  const config = readConfig({
    TARVIS_LAB_BEARER_TOKEN: "service-secret",
    SESSION_TTL_MS: "60000",
  });
  const { server } = createTarvisLabServer({
    config,
    answerQuestion: async () => assert.fail("answerer should not be reached"),
  });
  const baseUrl = await listen(server);
  try {
    const pageResponse = await fetch(`${baseUrl}/`);
    assert.equal(pageResponse.status, 200);
    assert.equal(pageResponse.headers.get("cache-control"), "no-store");
    assert.match(pageResponse.headers.get("content-security-policy"), /default-src 'none'/u);
    const page = await pageResponse.text();
    assert.match(page, /TARV1S Lab/u);
    assert.match(page, /id="model-select"/u);
    assert.doesNotMatch(page, /type="file"/u);
    assert.doesNotMatch(page, /https?:\/\//u);

    const cssResponse = await fetch(`${baseUrl}/app.css`);
    assert.equal(cssResponse.status, 200);
    assert.equal(cssResponse.headers.get("cache-control"), "no-store");
    assert.match(await cssResponse.text(), /color-scheme:\s*dark/u);

    const scriptResponse = await fetch(`${baseUrl}/app.js`);
    assert.equal(scriptResponse.status, 200);
    assert.equal(scriptResponse.headers.get("cache-control"), "no-store");
    assert.match(await scriptResponse.text(), /\/dev\/v1\/browser\/questions/u);
  } finally {
    await close(server);
  }
});

test("uses a schema-agnostic server dataset for the private browser flow", async () => {
  const config = readConfig({ SESSION_TTL_MS: "60000" });
  let closed = false;
  const browserDataset = {
    description: {
      schemaVersion: 2,
      timezone: "Europe/London",
      generatedAtMs: 1_787_680_800_000,
      range: { startMs: 1_785_088_800_000, endMs: 1_787_680_800_000 },
      totalRows: 42,
      tables: {
        original_events: { rowCount: 42, columns: [{ name: "raw_value" }] },
      },
    },
    query: () => assert.fail("the fake answerer does not query directly"),
    close: () => {
      closed = true;
    },
  };
  let answered = 0;
  let journaled = null;
  const resultJournal = {
    async recordCompleted(value) {
      journaled = value;
    },
    async recordFailed() {
      assert.fail("successful browser question must not be journaled as failed");
    },
  };
  const answerQuestion = async ({ apiKey, model, question, history, dataset }) => {
    answered += 1;
    assert.equal(apiKey, "server-key");
    assert.equal(model, "gpt-5.6-terra");
    assert.equal(question, "What is in the raw snapshot?");
    assert.deepEqual(history, []);
    assert.equal(dataset, browserDataset);
    return {
      answer: {
        headline: "The raw snapshot is available",
        answer: "I can inspect the original records.",
        confidence: "high",
        evidenceIds: ["q1"],
        limitations: [],
      },
      evidence: [
        {
          id: "q1",
          purpose: "Count the original rows.",
          sql: "SELECT COUNT(*) AS count FROM original_events",
          columns: ["count"],
          rowCount: 1,
          preview: [{ count: 42 }],
          truncated: false,
        },
      ],
      metrics: {
        model,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        modelRounds: 2,
        sqlCalls: 1,
        sqlMs: 1,
        modelMs: 20,
        totalMs: 21,
      },
    };
  };
  const { server } = createTarvisLabServer({
    config,
    apiKeyStore: { key: "server-key", remember: async () => {} },
    answerQuestion,
    browserDataset,
    resultJournal,
  });
  const baseUrl = await listen(server);
  try {
    const bootstrapResponse = await fetch(`${baseUrl}/dev/v1/browser/bootstrap`);
    assert.equal(bootstrapResponse.status, 200);
    assert.equal(bootstrapResponse.headers.get("cache-control"), "no-store");
    const bootstrap = await bootstrapResponse.json();
    assert.equal(bootstrap.snapshot.schemaVersion, 2);
    assert.equal(bootstrap.snapshot.rowCount, 42);
    assert.equal(bootstrap.snapshot.tableCount, 1);
    assert.deepEqual(
      bootstrap.models.map((model) => model.id),
      ["gpt-5.6-luna", "gpt-5.6-terra"],
    );
    assert.equal(bootstrap.defaultModel, "gpt-5.6-luna");

    const questionResponse = await fetch(`${baseUrl}/dev/v1/browser/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "What is in the raw snapshot?",
        history: [],
        model: "gpt-5.6-terra",
      }),
    });
    assert.equal(questionResponse.status, 200);
    const questionBody = await questionResponse.json();
    assert.equal(questionBody.metrics.model, "gpt-5.6-terra");
    assert.equal(questionBody.journal.recorded, true);
    assert.equal(journaled.request.question, "What is in the raw snapshot?");
    assert.equal(journaled.result.answer.confidence, "high");
    assert.equal(journaled.dataset, browserDataset);

    const disallowedResponse = await fetch(`${baseUrl}/dev/v1/browser/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "Use Sol without permission",
        model: "gpt-5.6-sol",
      }),
    });
    assert.equal(disallowedResponse.status, 400);
    assert.equal((await disallowedResponse.json()).error.code, "model_not_allowed");
    assert.equal(answered, 1);
  } finally {
    await close(server);
  }
  assert.equal(closed, true);
});

test("routes a browser question to the configured phone model without an OpenAI key", async () => {
  const config = readConfig({
    OPENAI_MODEL: "lfm2.5-1.2b-thinking-phone",
    OPENAI_ALLOWED_MODELS: "gpt-5.6-luna,lfm2.5-1.2b-thinking-phone",
    SESSION_TTL_MS: "60000",
  });
  const browserDataset = {
    description: { schemaVersion: 2, tables: {}, totalRows: 0 },
    query: () => ({ columns: [], rows: [], rowCount: 0, truncated: false }),
  };
  let received = null;
  const { server } = createTarvisLabServer({
    config,
    apiKeyStore: { key: null, remember: async () => {} },
    browserDataset,
    localModelConfigured: true,
    answerQuestion: async (request) => {
      received = request;
      return {
        answer: {
          headline: "The phone model answered",
          answer: "No OpenAI key was required.",
          confidence: "high",
          evidenceIds: [],
          limitations: [],
        },
        evidence: [],
        metrics: {
          model: request.model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          modelRounds: 1,
          sqlCalls: 0,
          sqlMs: 0,
          modelMs: 1,
          totalMs: 1,
        },
      };
    },
  });
  const baseUrl = await listen(server);
  try {
    const bootstrapResponse = await fetch(`${baseUrl}/dev/v1/browser/bootstrap`);
    assert.equal(bootstrapResponse.status, 200);
    const bootstrap = await bootstrapResponse.json();
    const phoneModel = bootstrap.models.find(
      (model) => model.id === "lfm2.5-1.2b-thinking-phone",
    );
    assert.deepEqual(
      {
        provider: phoneModel.provider,
        configured: phoneModel.configured,
        acceptsClientKey: phoneModel.acceptsClientKey,
        available: phoneModel.available,
      },
      {
        provider: "phone",
        configured: true,
        acceptsClientKey: false,
        available: true,
      },
    );

    const questionResponse = await fetch(`${baseUrl}/dev/v1/browser/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "Can the phone model answer this?",
        model: "lfm2.5-1.2b-thinking-phone",
      }),
    });
    assert.equal(questionResponse.status, 200);
    assert.equal(received.apiKey, null);
    assert.equal(received.model, "lfm2.5-1.2b-thinking-phone");
  } finally {
    await close(server);
  }
});

test("keeps browser snapshot status and questions behind service authorization", async () => {
  const config = readConfig({
    TARVIS_LAB_BEARER_TOKEN: "service-secret",
    SESSION_TTL_MS: "60000",
  });
  const browserDataset = {
    description: { schemaVersion: 2, tables: {}, totalRows: 0 },
    query: () => ({ columns: [], rows: [], rowCount: 0, truncated: false }),
  };
  const { server } = createTarvisLabServer({
    config,
    apiKeyStore: { key: "server-key", remember: async () => {} },
    browserDataset,
    answerQuestion: async () => assert.fail("answerer should not be reached"),
  });
  const baseUrl = await listen(server);
  try {
    const locked = await fetch(`${baseUrl}/dev/v1/browser/bootstrap`);
    assert.equal(locked.status, 401);
    const unlocked = await fetch(`${baseUrl}/dev/v1/browser/bootstrap`, {
      headers: { authorization: "Bearer service-secret" },
    });
    assert.equal(unlocked.status, 200);
  } finally {
    await close(server);
  }
});

test("remembers browser access and the model key without browser storage", async () => {
  const config = readConfig({
    TARVIS_LAB_BEARER_TOKEN: "service-secret",
    ALLOW_CLIENT_OPENAI_KEY: "1",
    SESSION_TTL_MS: "60000",
  });
  const apiKeyStore = {
    key: null,
    async remember(key) {
      this.key = key;
    },
  };
  const browserDataset = {
    description: { schemaVersion: 2, tables: {}, totalRows: 0 },
    query: () => ({ columns: [], rows: [], rowCount: 0, truncated: false }),
  };
  let receivedApiKey = null;
  const { server } = createTarvisLabServer({
    config,
    apiKeyStore,
    browserDataset,
    answerQuestion: async ({ apiKey }) => {
      receivedApiKey = apiKey;
      return {
        answer: {
          headline: "Remembered connection works",
          answer: "The model key came from the private server store.",
          confidence: "high",
          evidenceIds: [],
          limitations: [],
        },
        evidence: [],
        metrics: {
          model: "fake",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          modelRounds: 0,
          sqlCalls: 0,
          sqlMs: 0,
          modelMs: 0,
          totalMs: 0,
        },
      };
    },
  });
  const baseUrl = await listen(server);
  try {
    const connectResponse = await fetch(`${baseUrl}/dev/v1/browser/bootstrap`, {
      headers: {
        authorization: "Bearer service-secret",
        "x-openai-api-key": "test-model-key",
      },
    });
    assert.equal(connectResponse.status, 200);
    const connectBody = await connectResponse.text();
    const setCookies = connectResponse.headers.getSetCookie();
    const expiredCookie = setCookies.find((value) => /Path=\/;/u.test(value));
    const accessCookie = setCookies.find((value) => /Path=\/dev\/v1\/browser;/u.test(value));
    assert.match(expiredCookie, /Max-Age=0/u);
    assert.match(accessCookie, /^t1arc_lab_access=/u);
    assert.match(accessCookie, /HttpOnly/u);
    assert.match(accessCookie, /SameSite=Strict/u);
    assert.match(accessCookie, /Max-Age=2592000/u);
    assert.doesNotMatch(accessCookie, /test-model-key|service-secret/u);
    assert.doesNotMatch(connectBody, /test-model-key|service-secret/u);
    assert.equal(apiKeyStore.key, "test-model-key");

    const cookie = accessCookie.split(";", 1)[0];
    const reloadResponse = await fetch(`${baseUrl}/dev/v1/browser/bootstrap`, {
      headers: { cookie },
    });
    assert.equal(reloadResponse.status, 200);
    assert.equal((await reloadResponse.json()).serverModelConfigured, true);

    const questionResponse = await fetch(`${baseUrl}/dev/v1/browser/questions`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ question: "Does the remembered connection work?" }),
    });
    assert.equal(questionResponse.status, 200);
    assert.equal(receivedApiKey, "test-model-key");

    const apiResponse = await fetch(`${baseUrl}/dev/v1/sessions`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(emptySnapshot()),
    });
    assert.equal(apiResponse.status, 401);

    const legacyResponse = await fetch(`${baseUrl}/dev/v1/browser/bootstrap`, {
      headers: { cookie: "t1arc_lab_access=service-secret" },
    });
    assert.equal(legacyResponse.status, 200);
    assert.equal(legacyResponse.headers.getSetCookie().length, 2);
  } finally {
    await close(server);
  }
});
