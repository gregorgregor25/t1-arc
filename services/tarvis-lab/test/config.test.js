import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../src/config.js";

test("defaults the browser model allowlist to Luna and Terra", () => {
  const config = readConfig({});
  assert.equal(config.model, "gpt-5.6-luna");
  assert.deepEqual(config.models, ["gpt-5.6-luna", "gpt-5.6-terra"]);
});

test("allows Sol only when it is explicitly allowlisted", () => {
  const config = readConfig({
    OPENAI_MODEL: "gpt-5.6-sol",
    OPENAI_ALLOWED_MODELS: "gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol",
  });
  assert.equal(config.model, "gpt-5.6-sol");
  assert.deepEqual(config.models, [
    "gpt-5.6-luna",
    "gpt-5.6-terra",
    "gpt-5.6-sol",
  ]);
});

test("allows the phone-hosted LFM model with a server-controlled endpoint", () => {
  const config = readConfig({
    OPENAI_ALLOWED_MODELS: "gpt-5.6-luna,lfm2.5-1.2b-thinking-phone",
    LFM_PHONE_CHAT_COMPLETIONS_URL: "http://phone-model.example.invalid:8088/v1/chat/completions",
    LFM_PHONE_API_KEY_FILE: "/run/tarvis-secrets/lfm-phone-api-key",
  });
  assert.deepEqual(config.models, [
    "gpt-5.6-luna",
    "lfm2.5-1.2b-thinking-phone",
  ]);
  assert.equal(
    config.lfmPhoneEndpoint,
    "http://phone-model.example.invalid:8088/v1/chat/completions",
  );
  assert.equal(config.lfmPhoneTimeoutMs, 360_000);
});

test("rejects invalid or credential-bearing phone model endpoints", () => {
  assert.throws(
    () => readConfig({ LFM_PHONE_CHAT_COMPLETIONS_URL: "not-a-url" }),
    /valid HTTP or HTTPS URL/u,
  );
  assert.throws(
    () => readConfig({ LFM_PHONE_CHAT_COMPLETIONS_URL: "http://user:secret@phone.invalid/v1" }),
    /without embedded credentials/u,
  );
});

test("rejects unknown or non-allowlisted default models", () => {
  assert.throws(
    () => readConfig({ OPENAI_ALLOWED_MODELS: "gpt-5.6-luna,untrusted-model" }),
    /must contain only/u,
  );
  assert.throws(
    () =>
      readConfig({
        OPENAI_MODEL: "gpt-5.6-terra",
        OPENAI_ALLOWED_MODELS: "gpt-5.6-luna",
      }),
    /must also appear/u,
  );
});
