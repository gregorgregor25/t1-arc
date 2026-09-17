import { readFile } from "node:fs/promises";
import { HttpError } from "./errors.js";

export const MODEL_CATALOGUE = Object.freeze({
  "gpt-5.6-luna": Object.freeze({
    id: "gpt-5.6-luna",
    label: "Luna",
    description: "Fastest for quick test runs",
    provider: "openai",
  }),
  "gpt-5.6-terra": Object.freeze({
    id: "gpt-5.6-terra",
    label: "Terra",
    description: "Balanced analysis",
    provider: "openai",
  }),
  "gpt-5.6-sol": Object.freeze({
    id: "gpt-5.6-sol",
    label: "Sol",
    description: "Deepest analysis",
    provider: "openai",
  }),
  "lfm2.5-1.2b-thinking-phone": Object.freeze({
    id: "lfm2.5-1.2b-thinking-phone",
    label: "LFM 1.2B · phone",
    description: "Runs locally on the connected Android phone",
    provider: "phone",
  }),
});

function boundedInteger(value, fallback, { minimum, maximum }) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Configuration value must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function cleanSecret(value) {
  const secret = value?.trim();
  return secret ? secret : null;
}

function optionalHttpEndpoint(value, name) {
  const endpoint = value?.trim();
  if (!endpoint) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch (error) {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`, { cause: error });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL without embedded credentials.`);
  }
  return parsed.toString();
}

function allowedModels(value) {
  const configured = (value?.trim() || "gpt-5.6-luna,gpt-5.6-terra")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const unique = [...new Set(configured)];
  if (unique.length === 0 || unique.some((model) => !MODEL_CATALOGUE[model])) {
    throw new Error(
      `OPENAI_ALLOWED_MODELS must contain only: ${Object.keys(MODEL_CATALOGUE).join(", ")}.`,
    );
  }
  return unique;
}

export function readConfig(environment = process.env) {
  const host = environment.HOST?.trim() || "127.0.0.1";
  const port = boundedInteger(environment.PORT, 7313, {
    minimum: 1,
    maximum: 65_535,
  });
  const model = environment.OPENAI_MODEL?.trim() || "gpt-5.6-luna";
  const models = allowedModels(environment.OPENAI_ALLOWED_MODELS);
  if (!models.includes(model)) {
    throw new Error("OPENAI_MODEL must also appear in OPENAI_ALLOWED_MODELS.");
  }

  return {
    host,
    port,
    model,
    models,
    openAiApiKey: cleanSecret(environment.OPENAI_API_KEY),
    openAiApiKeyFile: environment.OPENAI_API_KEY_FILE?.trim() || null,
    rememberedOpenAiKeyFile:
      environment.REMEMBERED_OPENAI_API_KEY_FILE?.trim() || null,
    allowClientOpenAiKey: environment.ALLOW_CLIENT_OPENAI_KEY === "1",
    lfmPhoneEndpoint: optionalHttpEndpoint(
      environment.LFM_PHONE_CHAT_COMPLETIONS_URL,
      "LFM_PHONE_CHAT_COMPLETIONS_URL",
    ),
    lfmPhoneApiKeyFile: environment.LFM_PHONE_API_KEY_FILE?.trim() || null,
    lfmPhoneTimeoutMs: boundedInteger(environment.LFM_PHONE_TIMEOUT_MS, 360_000, {
      minimum: 5_000,
      maximum: 600_000,
    }),
    serviceBearerToken: cleanSecret(environment.TARVIS_LAB_BEARER_TOKEN),
    rawSqlitePath: environment.RAW_SQLITE_PATH?.trim() || null,
    resultJournalPath: environment.RESULT_JOURNAL_PATH?.trim() || null,
    sessionTtlMs: boundedInteger(environment.SESSION_TTL_MS, 30 * 60 * 1_000, {
      minimum: 60_000,
      maximum: 24 * 60 * 60 * 1_000,
    }),
    maxSnapshotBytes: boundedInteger(environment.MAX_SNAPSHOT_BYTES, 32 * 1024 * 1024, {
      minimum: 1024,
      maximum: 128 * 1024 * 1024,
    }),
    maxQuestionBytes: boundedInteger(environment.MAX_QUESTION_BYTES, 32 * 1024, {
      minimum: 1024,
      maximum: 256 * 1024,
    }),
    openAiTimeoutMs: boundedInteger(environment.OPENAI_TIMEOUT_MS, 60_000, {
      minimum: 5_000,
      maximum: 180_000,
    }),
    maxToolRounds: boundedInteger(environment.MAX_TOOL_ROUNDS, 6, {
      minimum: 1,
      maximum: 12,
    }),
  };
}

export async function resolveServerOpenAiKey(config) {
  if (config.openAiApiKey) {
    return config.openAiApiKey;
  }
  if (!config.openAiApiKeyFile) {
    return null;
  }

  let contents;
  try {
    contents = await readFile(config.openAiApiKeyFile, {
      encoding: "utf8",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error("OPENAI_API_KEY_FILE could not be read.", { cause: error });
  }
  if (contents.length > 4_096) {
    throw new Error("OPENAI_API_KEY_FILE is unexpectedly large.");
  }
  return cleanSecret(contents);
}

export async function resolveServerLfmPhoneKey(config) {
  if (!config.lfmPhoneApiKeyFile) {
    return null;
  }
  let contents;
  try {
    contents = await readFile(config.lfmPhoneApiKeyFile, {
      encoding: "utf8",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error("LFM_PHONE_API_KEY_FILE could not be read.", { cause: error });
  }
  if (contents.length > 4_096) {
    throw new Error("LFM_PHONE_API_KEY_FILE is unexpectedly large.");
  }
  return cleanSecret(contents);
}

export function modelProvider(model) {
  return MODEL_CATALOGUE[model]?.provider ?? "openai";
}

export function resolveRequestOpenAiKey(request, config, serverKey) {
  const supplied = request.headers["x-openai-api-key"];
  if (supplied !== undefined) {
    if (!config.allowClientOpenAiKey) {
      throw new HttpError(
        400,
        "client_key_disabled",
        "This TARV1S lab service does not accept an OpenAI key from the client.",
      );
    }
    if (Array.isArray(supplied) || supplied.length > 512 || !cleanSecret(supplied)) {
      throw new HttpError(400, "invalid_client_key", "The supplied OpenAI key is invalid.");
    }
    return supplied.trim();
  }

  if (!serverKey) {
    throw new HttpError(
      503,
      "model_not_configured",
      "The TARV1S lab model connection is not configured.",
    );
  }
  return serverKey;
}
