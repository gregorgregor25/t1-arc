import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { asPublicError, HttpError } from "./errors.js";
import { MODEL_CATALOGUE, modelProvider, resolveRequestOpenAiKey } from "./config.js";
import { SessionStore } from "./sessionStore.js";

const QUESTION_PATH = /^\/dev\/v1\/sessions\/([0-9a-f-]{36})\/questions$/u;
const SESSION_PATH = /^\/dev\/v1\/sessions\/([0-9a-f-]{36})$/u;
const BROWSER_BOOTSTRAP_PATH = "/dev/v1/browser/bootstrap";
const BROWSER_QUESTION_PATH = "/dev/v1/browser/questions";
const MAX_QUESTION_CHARACTERS = 2_000;
const MAX_HISTORY_MESSAGES = 12;
const ACCESS_COOKIE_NAME = "t1arc_lab_access";
const ACCESS_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const BROWSER_API_PATH = "/dev/v1/browser";
const STATIC_ASSETS = new Map([
  ["/", { file: new URL("./public/index.html", import.meta.url), type: "text/html; charset=utf-8" }],
  ["/app.css", { file: new URL("./public/app.css", import.meta.url), type: "text/css; charset=utf-8" }],
  ["/app.js", { file: new URL("./public/app.js", import.meta.url), type: "text/javascript; charset=utf-8" }],
]);

const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

function writeJson(response, status, body, additionalHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...additionalHeaders,
  });
  response.end(payload);
}

function writeEmpty(response, status) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-length": "0",
  });
  response.end();
}

async function writeStatic(response, asset) {
  const payload = await readFile(asset.file);
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": asset.type,
    "content-length": payload.length,
  });
  response.end(payload);
}

function secretMatches(actual, expected) {
  if (typeof actual !== "string") {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function cookieValues(request, name) {
  const header = request.headers.cookie;
  if (typeof header !== "string" || header.length > 4_096) return [];
  const values = [];
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1 || item.slice(0, separator).trim() !== name) continue;
    try {
      values.push(decodeURIComponent(item.slice(separator + 1).trim()));
    } catch {
      return [];
    }
  }
  return values;
}

function browserAccessToken(serviceToken) {
  return createHash("sha256")
    .update("t1arc-tarvis-lab-browser-access\0")
    .update(serviceToken)
    .digest("base64url");
}

function rememberedAccessCookies(serviceToken) {
  const accessToken = browserAccessToken(serviceToken);
  return [
    `${ACCESS_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    `${ACCESS_COOKIE_NAME}=${accessToken}; Path=${BROWSER_API_PATH}; HttpOnly; SameSite=Strict; Max-Age=${ACCESS_COOKIE_MAX_AGE_SECONDS}`,
  ];
}

function requireServiceAuthorization(
  request,
  config,
  { allowRememberedBrowserAccess = false } = {},
) {
  if (!config.serviceBearerToken) {
    return { shouldRemember: false };
  }
  const authorization = request.headers.authorization;
  const expected = `Bearer ${config.serviceBearerToken}`;
  if (secretMatches(authorization, expected)) return { shouldRemember: true };
  if (allowRememberedBrowserAccess) {
    const values = cookieValues(request, ACCESS_COOKIE_NAME);
    if (values.some((value) => secretMatches(value, browserAccessToken(config.serviceBearerToken)))) {
      return { shouldRemember: false };
    }
    // Migrate the first lab build, which briefly stored the raw bearer token at Path=/.
    if (values.some((value) => secretMatches(value, config.serviceBearerToken))) {
      return { shouldRemember: true };
    }
  }
  throw new HttpError(401, "unauthorized", "A valid TARV1S lab service token is required.");
}

async function readJson(request, maximumBytes) {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "content_type_invalid", "Content-Type must be application/json.");
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new HttpError(413, "request_too_large", "The request body is too large.");
  }

  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBytes) {
      throw new HttpError(413, "request_too_large", "The request body is too large.");
    }
    chunks.push(chunk);
  }
  if (received === 0) {
    throw new HttpError(400, "request_body_missing", "A JSON request body is required.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new HttpError(400, "json_invalid", "The request body is not valid JSON.", { cause: error });
  }
}

function validateQuestionBody(body, allowedModels) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "question_invalid", "A question is required.");
  }
  const keys = Object.keys(body);
  if (
    keys.some((key) => !["question", "history", "asOfMs", "turnId", "model"].includes(key)) ||
    !keys.includes("question")
  ) {
    throw new HttpError(400, "question_invalid", "The question request has unsupported fields.");
  }
  if (
    typeof body.question !== "string" ||
    body.question.trim().length === 0 ||
    body.question.length > MAX_QUESTION_CHARACTERS
  ) {
    throw new HttpError(400, "question_invalid", "The question must contain 1 to 2,000 characters.");
  }

  const asOfMs = body.asOfMs ?? null;
  if (asOfMs !== null && (typeof asOfMs !== "number" || !Number.isFinite(asOfMs))) {
    throw new HttpError(400, "question_invalid", "asOfMs must be a finite timestamp.");
  }
  const turnId = body.turnId ?? null;
  if (
    turnId !== null &&
    (typeof turnId !== "string" || turnId.trim().length === 0 || turnId.length > 200)
  ) {
    throw new HttpError(400, "question_invalid", "turnId is invalid.");
  }
  const model = body.model ?? null;
  if (model !== null && (typeof model !== "string" || !allowedModels.includes(model))) {
    throw new HttpError(400, "model_not_allowed", "That model is not enabled for this TARV1S lab.");
  }

  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > MAX_HISTORY_MESSAGES) {
    throw new HttpError(400, "history_invalid", "Conversation history is invalid.");
  }
  history.forEach((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      Array.isArray(message) ||
      Object.keys(message).sort().join(",") !== "content,role" ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.trim().length === 0 ||
      message.content.length > MAX_QUESTION_CHARACTERS
    ) {
      throw new HttpError(400, "history_invalid", "Conversation history is invalid.");
    }
  });
  return { question: body.question.trim(), history, asOfMs, turnId, model };
}

function browserDatasetSummary(browserDataset) {
  if (!browserDataset) {
    return null;
  }
  const description = browserDataset.description ?? {};
  const tables = description.tables && typeof description.tables === "object"
    ? description.tables
    : {};
  const knownTableRows = Object.values(tables)
    .map((table) => table?.rowCount)
    .filter((rowCount) => Number.isFinite(rowCount));
  return {
    schemaVersion: description.schemaVersion ?? null,
    timezone: description.timezone ?? null,
    generatedAtMs: description.generatedAtMs ?? null,
    range: description.requestedRange ?? description.range ?? null,
    rowCount: Number.isFinite(description.totalRows)
      ? description.totalRows
      : knownTableRows.length > 0
        ? knownTableRows.reduce((total, rowCount) => total + rowCount, 0)
        : null,
    tableCount: Object.keys(tables).length,
    tableCounts: Object.fromEntries(
      Object.entries(tables)
        .filter(([, table]) => Number.isFinite(table?.rowCount))
        .map(([name, table]) => [name, table.rowCount]),
    ),
  };
}

export function createTarvisLabServer({
  config,
  apiKeyStore = null,
  answerQuestion,
  browserDataset = null,
  localModelConfigured = false,
  resultJournal = null,
  sessionStore = new SessionStore({ ttlMs: config.sessionTtlMs }),
}) {
  if (typeof answerQuestion !== "function") {
    throw new Error("answerQuestion is required.");
  }

  const modelStatus = (model) => {
    const provider = modelProvider(model);
    const configured = provider === "phone"
      ? localModelConfigured
      : Boolean(apiKeyStore?.key);
    const acceptsClientKey = provider === "openai" && config.allowClientOpenAiKey;
    return {
      provider,
      configured,
      acceptsClientKey,
      available: configured || acceptsClientKey,
    };
  };

  const handler = async (request, response) => {
    try {
      const url = new URL(request.url, "http://tarvis.invalid");
      if (url.search) {
        throw new HttpError(400, "query_parameters_unsupported", "URL query parameters are not supported.");
      }

      const staticAsset = STATIC_ASSETS.get(url.pathname);
      if (request.method === "GET" && staticAsset) {
        await writeStatic(response, staticAsset);
        return;
      }

      if (request.method === "GET" && url.pathname === "/dev/v1/health") {
        const configuredModels = config.models ?? [config.model];
        writeJson(response, 200, {
          ok: true,
          service: "tarvis-lab",
          apiVersion: "dev/v1",
          storage: browserDataset
            ? "read-only-ram-snapshot-and-ephemeral-sessions"
            : "ephemeral-memory",
          browserSnapshotConfigured: Boolean(browserDataset),
          modelConfigured: configuredModels.some((model) => modelStatus(model).available),
        });
        return;
      }

      const browserRoute = url.pathname === BROWSER_BOOTSTRAP_PATH ||
        url.pathname === BROWSER_QUESTION_PATH;
      const serviceAuthorization = requireServiceAuthorization(request, config, {
        allowRememberedBrowserAccess: browserRoute,
      });

      if (request.method === "GET" && url.pathname === BROWSER_BOOTSTRAP_PATH) {
        if (request.headers["x-openai-api-key"] !== undefined) {
          const suppliedKey = resolveRequestOpenAiKey(
            request,
            config,
            apiKeyStore?.key ?? null,
          );
          await apiKeyStore?.remember(suppliedKey);
        }
        const models = config.models ?? [config.model];
        const modelDetails = models.map((model) => ({
          ...(MODEL_CATALOGUE[model] ?? {
            id: model,
            label: model,
            description: "Configured test model",
          }),
          ...modelStatus(model),
        }));
        writeJson(response, 200, {
          service: "tarvis-lab",
          snapshot: browserDatasetSummary(browserDataset),
          models: modelDetails,
          defaultModel: config.model,
          modelConfigured: modelDetails.some((model) => model.available),
          serverModelConfigured: Boolean(apiKeyStore?.key),
          acceptsClientOpenAiKey: config.allowClientOpenAiKey,
        }, serviceAuthorization.shouldRemember && config.serviceBearerToken
          ? { "set-cookie": rememberedAccessCookies(config.serviceBearerToken) }
          : {});
        return;
      }

      if (request.method === "POST" && url.pathname === BROWSER_QUESTION_PATH) {
        if (!browserDataset) {
          throw new HttpError(
            503,
            "snapshot_not_configured",
            "No server-loaded TARV1S snapshot is configured.",
          );
        }
        const models = config.models ?? [config.model];
        const body = validateQuestionBody(await readJson(request, config.maxQuestionBytes), models);
        const selectedModel = body.model ?? config.model;
        const apiKey = modelProvider(selectedModel) === "openai"
          ? resolveRequestOpenAiKey(request, config, apiKeyStore?.key ?? null)
          : null;
        if (
          modelProvider(selectedModel) === "openai" &&
          request.headers["x-openai-api-key"] !== undefined
        ) {
          await apiKeyStore?.remember(apiKey);
        }
        const journalRequest = {
          turnId: body.turnId,
          question: body.question,
          history: body.history,
          asOfMs: body.asOfMs,
          model: selectedModel,
        };
        let result;
        try {
          result = await answerQuestion({
            apiKey,
            model: journalRequest.model,
            question: body.question,
            asOfMs: body.asOfMs,
            history: body.history,
            dataset: browserDataset,
            timeoutMs: config.openAiTimeoutMs,
            maxToolRounds: config.maxToolRounds,
          });
        } catch (error) {
          await resultJournal?.recordFailed({
            request: journalRequest,
            error,
            dataset: browserDataset,
          });
          throw error;
        }
        if (resultJournal) {
          await resultJournal.recordCompleted({
            request: journalRequest,
            result,
            dataset: browserDataset,
          });
        }
        writeJson(response, 200, {
          ...result,
          journal: { recorded: Boolean(resultJournal) },
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/dev/v1/sessions") {
        const snapshot = await readJson(request, config.maxSnapshotBytes);
        const session = sessionStore.create(snapshot);
        writeJson(response, 201, {
          sessionId: session.id,
          createdAtMs: session.createdAtMs,
          expiresAtMs: session.expiresAtMs,
          schemaVersion: session.description.schemaVersion,
          rowCount: session.description.totalRows,
          tableCounts: Object.fromEntries(
            Object.entries(session.description.tables).map(([name, table]) => [name, table.rowCount]),
          ),
        });
        return;
      }

        const questionMatch = QUESTION_PATH.exec(url.pathname);
      if (request.method === "POST" && questionMatch) {
        const models = config.models ?? [config.model];
        const body = validateQuestionBody(await readJson(request, config.maxQuestionBytes), models);
        const selectedModel = body.model ?? config.model;
        const apiKey = modelProvider(selectedModel) === "openai"
          ? resolveRequestOpenAiKey(request, config, apiKeyStore?.key ?? null)
          : null;
        if (
          modelProvider(selectedModel) === "openai" &&
          request.headers["x-openai-api-key"] !== undefined
        ) {
          await apiKeyStore?.remember(apiKey);
        }
        const result = await sessionStore.withSession(questionMatch[1], (dataset) =>
          answerQuestion({
            apiKey,
            model: selectedModel,
            question: body.question,
            asOfMs: body.asOfMs,
            history: body.history,
            dataset,
            timeoutMs: config.openAiTimeoutMs,
            maxToolRounds: config.maxToolRounds,
          }),
        );
        writeJson(response, 200, result);
        return;
      }

      const sessionMatch = SESSION_PATH.exec(url.pathname);
      if (request.method === "DELETE" && sessionMatch) {
        if (!sessionStore.delete(sessionMatch[1])) {
          throw new HttpError(404, "session_not_found", "That TARV1S lab session has expired or does not exist.");
        }
        writeEmpty(response, 204);
        return;
      }

      throw new HttpError(404, "route_not_found", "That TARV1S lab route does not exist.");
    } catch (error) {
      const publicError = asPublicError(error);
      if (!response.headersSent) {
        writeJson(response, publicError.status, publicError.body);
      } else {
        response.destroy();
      }
    }
  };

  const server = createServer((request, response) => {
    void handler(request, response);
  });
  server.on("close", () => {
    sessionStore.close();
    browserDataset?.close?.();
  });
  return { server, sessionStore };
}
