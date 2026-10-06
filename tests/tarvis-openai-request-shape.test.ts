import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetTarvisConnectionCoordinatorForTests } from "@/data/tarvis/connectionCoordinator";
import { clearTarvisProviderCooldownsForTests } from "@/data/tarvis/providerTransport";
import { TARVIS_PROVIDERS, TarvisModelUnavailableError } from "@/data/tarvis/providers";
import {
  askTarvis,
  getTarvisRequestFailureDetails,
  planTarvisEvidenceRequest,
} from "@/data/tarvis/openAiClient";
import { buildTarvisEvidencePlanningOptions } from "@/data/tarvis/evidencePlanner";
import { currentPeriodTarvisEvidence, selectTarvisEvidencePacket } from "@/data/tarvis/evidencePacket";
import { buildSelectedHealthEvidencePacket } from "@/data/tarvis/selectedHealthEvidence";
import type { InsightReport } from "@/domain/insights";
import { createTarvisHealthEntry } from "@/domain/tarvisEntry";
import {
  NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
  NICE_TYPE_1_EXERCISE_KNOWLEDGE,
} from "@/data/tarvis/reviewedKnowledge";
import type {
  TarvisEvidencePacket,
  TarvisRetrospectiveEvidencePacket,
} from "@/data/tarvis/types";

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  assertLeaseCurrent: vi.fn(),
  loadApiKey: vi.fn(),
  loadProvider: vi.fn(),
  loadModel: vi.fn(),
  loadUsage: vi.fn(),
  saveUsage: vi.fn(),
  getSafetyIdentifier: vi.fn(),
  chatGptSession: vi.fn(),
  chatGptRequest: vi.fn(),
}));

vi.mock("@/data/tarvis/chatGptConnection", () => ({
  getChatGptRequestSession: mocks.chatGptSession,
  ChatGptConnectionError: class ChatGptConnectionError extends Error {
    constructor(message: string, readonly settingsRequired = true) { super(message); }
  },
  ChatGptModelUnavailableError: class ChatGptModelUnavailableError extends Error {},
}));
vi.mock("../modules/t1arc-chatgpt", () => ({
  isAvailable: () => true,
  default: { request: mocks.chatGptRequest, cancelRequest: async () => undefined },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "request-fixture" }));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  assertLocalDataWriteLeaseCurrent: mocks.assertLeaseCurrent,
}));

vi.mock("@/data/tarvis/secureStore", () => ({
  getTarvisSafetyIdentifier: mocks.getSafetyIdentifier,
  loadTarvisApiKey: mocks.loadApiKey,
  loadTarvisProvider: mocks.loadProvider,
  loadTarvisModel: mocks.loadModel,
  loadTarvisUsage: mocks.loadUsage,
  saveTarvisUsage: mocks.saveUsage,
}));

function response(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        {
          content: [{ type: "output_text", text }],
        },
      ],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    }),
  } as Response;
}

const TIMELINE_LEAD = "Let's start with the recorded timeline.";
const DIRECT_LEAD = "I can give you my careful reading.";
const CLAIM_BRIDGE = "That gives the next point its context.";
const EVIDENCE_CLOSE =
  "If you'd like, we can look through the evidence together.";

function retrospectivePacket(): TarvisRetrospectiveEvidencePacket {
  return {
    schemaVersion: 1,
    requestMode: "retrospective",
    timezone: "Europe/London",
    units: { glucose: "mmol/L", insulin: "U", carbohydrates: "g" },
    generatedAt: Date.parse("2026-08-25T20:00:00+01:00"),
    verifiedReview: {
      headline: "Recorded low around Evening walk",
      chronology:
        "The evening walk started at 20:30 with glucose at 6.2 mmol/L.",
      confidence: "moderate",
      limitations: ["The records cannot establish cause."],
      eventKind: "low",
      eventObserved: true,
      activityContributionSupported: true,
    },
    reviewedKnowledge: [{ ...NICE_TYPE_1_EXERCISE_KNOWLEDGE }],
    evidence: [
      {
        id: "activity",
        label: "Recorded activity",
        description: "Evening walk at 20:30.",
        range: {
          start: Date.parse("2026-08-21T20:30:00+01:00"),
          end: Date.parse("2026-08-21T21:00:00+01:00"),
        },
        recordCount: 1,
        examples: [],
      },
      {
        id: "glucose",
        label: "Glucose around the activity",
        description: "Glucose was 6.2 mmol/L at 20:30.",
        range: {
          start: Date.parse("2026-08-21T20:30:00+01:00"),
          end: Date.parse("2026-08-21T21:00:00+01:00"),
        },
        recordCount: 2,
        examples: [],
      },
    ],
  };
}

function evidencePacket(): TarvisEvidencePacket {
  const currentRange = { start: 100, end: 200 };
  const previousRange = { start: 0, end: 100 };
  const summary = {
    glucoseAverage: 7.4,
    glucoseStandardDeviation: 2.1,
    glucoseCvPercent: 28.4,
    timeInRangePercent: 72.3,
    timeAbovePercent: 24.5,
    timeBelowPercent: 3.2,
    coveragePercent: 96.8,
    glucoseReadings: 100,
    highGlucoseRuns: 2,
    lowGlucoseRuns: 1,
    insulinUnits: null,
    mealCarbsPerDay: null,
    lateMeals: 0,
    sleepMinutesPerNight: null,
    activityMinutes: null,
  };
  return {
    schemaVersion: 1,
    timezone: "Europe/London",
    units: { glucose: "mmol/L", weight: "kg", distance: "km" },
    generatedAt: 200,
    comparison: {
      currentRange,
      previousRange,
      headline: "Your recorded comparison",
      summary: "The two periods were compared locally.",
      current: summary,
      previous: { ...summary, glucoseAverage: 7.8 },
    },
    findings: [
      {
        id: "glucose-change",
        kind: "change",
        category: "glucose",
        title: "Glucose was steadier",
        summary: "Recorded variability was lower in the recent period.",
        evidenceIds: ["current-glucose", "previous-glucose"],
      },
    ],
    evidence: [
      {
        id: "current-glucose",
        label: "Recent glucose",
        description: "Recent readings",
        range: currentRange,
        recordCount: 100,
        examples: [],
      },
      {
        id: "previous-glucose",
        label: "Previous glucose",
        description: "Previous readings",
        range: previousRange,
        recordCount: 100,
        examples: [],
      },
    ],
  };
}

describe("Tarv1s direct model-request shape", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request in test"));
    resetTarvisConnectionCoordinatorForTests();
    clearTarvisProviderCooldownsForTests();
    mocks.acquireLease.mockResolvedValue({ epoch: 1 });
    mocks.assertLeaseCurrent.mockResolvedValue(undefined);
    mocks.loadApiKey.mockResolvedValue("test-key");
    mocks.loadProvider.mockResolvedValue("openai");
    mocks.loadModel.mockImplementation(async (_lease, provider) => TARVIS_PROVIDERS[provider as keyof typeof TARVIS_PROVIDERS].model);
    mocks.loadUsage.mockResolvedValue({
      requestTimestamps: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    mocks.saveUsage.mockResolvedValue(undefined);
    mocks.getSafetyIdentifier.mockResolvedValue("safety-id");
    mocks.chatGptSession.mockResolvedValue({ accessToken: "synthetic-session", accountId: "test-account", model: "account-model" });
  });

  it("uses the ChatGPT session for guarded education, evidence and planning without loading an API key", async () => {
    mocks.loadProvider.mockResolvedValue("chatgpt");
    const completed = (text: string) => JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text }] }], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } });
    mocks.chatGptRequest.mockResolvedValueOnce(completed(JSON.stringify({ kind: "explanation", headline: "About HbA1c", answer: "HbA1c reflects longer-term glucose exposure.", limitations: [] })));
    const result = await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 });
    expect(result.answerSource).toBe("hosted");
    expect(result.requestMetrics).toMatchObject({ model: "account-model", totalTokens: 30 });
    expect(result.requestMetrics?.estimatedCostUsd).toBeUndefined();
    expect(result).not.toHaveProperty("hostedEvidenceSelectionAccepted");
    mocks.chatGptRequest.mockResolvedValueOnce(completed(JSON.stringify({ findingIds: ["glucose-change"] })));
    const evidenceResult = await askTarvis("Why was my glucose different last week?", evidencePacket(), [], { epoch: 1 });
    expect(evidenceResult.hostedEvidenceSelectionAccepted).toBe(true);
    expect(evidenceResult.answerSource).toBe("local");
    const question = "I had a really high reading two days ago. Do you know why?";
    const options = buildTarvisEvidencePlanningOptions(question, Date.parse("2026-08-26T10:00:00+01:00"));
    mocks.chatGptRequest.mockResolvedValueOnce(completed(JSON.stringify({ kind: "glucose-episode", rangeOptionId: "range-1", eventOptionId: "event-high", categoryIds: ["glucose", "insulin", "food", "activity", "sleep", "context", "data-quality"], clarificationCode: "none" })));
    expect((await planTarvisEvidenceRequest(question, options, { epoch: 1 })).plan.kind).toBe("glucose-episode");
    mocks.chatGptRequest.mockResolvedValueOnce(completed(JSON.stringify({ kind: "glucose-episode", rangeOptionId: "invented-range", eventOptionId: "event-high", categoryIds: ["glucose"], clarificationCode: "none" })));
    await expect(planTarvisEvidenceRequest(question, options, { epoch: 1 })).rejects.toThrow();
    expect(mocks.loadApiKey).not.toHaveBeenCalled();
    expect(mocks.getSafetyIdentifier).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    for (const [request] of mocks.chatGptRequest.mock.calls) {
      expect(request.accessToken).toBe("synthetic-session");
      const body = JSON.parse(request.body);
      expect(body).toMatchObject({ model: "account-model", stream: true, store: false });
      expect(body).not.toHaveProperty("safety_identifier");
      expect(body).not.toHaveProperty("max_output_tokens");
    }
  });

  it("preserves ChatGPT quota recovery without dispatching another provider", async () => {
    mocks.loadProvider.mockResolvedValue("chatgpt");
    mocks.chatGptRequest.mockRejectedValueOnce({ code: "ERR_CHATGPT_QUOTA", message: "private provider body" });
    let failure: unknown;
    try { await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 }); } catch (error) { failure = error; }
    expect(getTarvisRequestFailureDetails(failure)).toMatchObject({ modelRequestSent: true, manageUsage: true });
    expect(String(failure)).not.toContain("private provider body");
    expect(mocks.chatGptRequest).toHaveBeenCalledTimes(1);
    expect(mocks.loadApiKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not ask for sign-in again after a temporary token renewal outage", async () => {
    const { ChatGptConnectionError } = await import("@/data/tarvis/chatGptConnection");
    mocks.loadProvider.mockResolvedValue("chatgpt");
    mocks.chatGptSession.mockRejectedValueOnce(new ChatGptConnectionError("Your connection is saved; try again later.", false));
    let failure: unknown;
    try { await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 }); } catch (error) { failure = error; }
    expect(getTarvisRequestFailureDetails(failure)).toMatchObject({ modelRequestSent: false, settingsRequired: false });
    expect(mocks.chatGptRequest).not.toHaveBeenCalled();
    expect(mocks.loadApiKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the saved model for answer, planner and metrics without changing the provider", async () => {
    mocks.loadModel.mockResolvedValue("gpt-5.6-terra");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(JSON.stringify({
      kind: "explanation", headline: "About HbA1c", answer: "HbA1c reflects longer-term glucose exposure.", limitations: [],
    })));
    const answer = await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).model).toBe("gpt-5.6-terra");
    expect(answer.requestMetrics).toMatchObject({ model: "gpt-5.6-terra" });
    expect(answer.requestMetrics?.estimatedCostUsd).toBeUndefined();

    const question = "I had a really high reading two days ago. Do you know why?";
    fetchSpy.mockResolvedValueOnce(response(JSON.stringify({ kind: "glucose-episode", rangeOptionId: "range-1", eventOptionId: "event-high", categoryIds: ["glucose", "insulin", "food", "activity", "sleep", "context", "data-quality"], clarificationCode: "none" })));
    const planned = await planTarvisEvidenceRequest(question, buildTarvisEvidencePlanningOptions(question, Date.parse("2026-08-26T10:00:00+01:00")), { epoch: 1 });
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)).model).toBe("gpt-5.6-terra");
    expect(planned.requestMetrics?.model).toBe("gpt-5.6-terra");
  });

  it("does not send or reserve usage when the saved model is unavailable", async () => {
    mocks.loadModel.mockRejectedValue(new TarvisModelUnavailableError("openai"));
    let failure: unknown;
    try { await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(getTarvisRequestFailureDetails(failure)).toMatchObject({ modelRequestSent: false, settingsRequired: true });
    const question = "I had a really high reading two days ago. Do you know why?";
    let planFailure: unknown;
    try { await planTarvisEvidenceRequest(question, buildTarvisEvidencePlanningOptions(question, Date.now()), { epoch: 1 }); }
    catch (error) { planFailure = error; }
    expect(getTarvisRequestFailureDetails(planFailure)).toMatchObject({ modelRequestSent: false, settingsRequired: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.saveUsage).not.toHaveBeenCalled();
  });

  it("keeps a model storage failure distinct from an unavailable model", async () => {
    mocks.loadModel.mockRejectedValue(new Error("secure read failed"));
    let failure: unknown;
    try { await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ message: "secure read failed" });
    expect(getTarvisRequestFailureDetails(failure)).toMatchObject({ modelRequestSent: false, settingsRequired: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["gemini", "claude"] as const)("runs %s education and planning through the existing strict parsers", async provider => {
    mocks.loadProvider.mockResolvedValue(provider);
    function nativeResponse(text: string) {
      return new Response(JSON.stringify(provider === "gemini"
        ? { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5 } }
        : { stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 20, output_tokens: 10 } }));
    }
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(nativeResponse(JSON.stringify({ kind: "explanation", headline: "About HbA1c", answer: "HbA1c reflects average glucose exposure over roughly two to three months.", limitations: [] })));
    const education = await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 });
    expect(education.answerSource).toBe("hosted");
    expect(education.requestMetrics?.model).toBe(TARVIS_PROVIDERS[provider].model);
    expect(education.requestMetrics?.estimatedCostUsd).toBeUndefined();
    expect(mocks.getSafetyIdentifier).not.toHaveBeenCalled();
    expect(mocks.loadApiKey).toHaveBeenCalledWith({ epoch: 1 }, provider);
    const question = "I had a really high reading two days ago. Do you know why?";
    const planningOptions = buildTarvisEvidencePlanningOptions(question, Date.parse("2026-08-26T10:00:00+01:00"));
    fetchSpy.mockResolvedValueOnce(nativeResponse(JSON.stringify({ kind: "glucose-episode", rangeOptionId: "range-1", eventOptionId: "event-high", categoryIds: ["glucose", "insulin", "food", "activity", "sleep", "context", "data-quality"], clarificationCode: "none" })));
    const planned = await planTarvisEvidenceRequest(question, planningOptions, { epoch: 1 });
    expect(planned.plan.kind).toBe("glucose-episode");
    expect(planned.modelRequestSent).toBe(true);
    // Unknown handles still fail closed, regardless of provider.
    fetchSpy.mockResolvedValueOnce(nativeResponse(JSON.stringify({ kind: "glucose-episode", rangeOptionId: "invented-range", eventOptionId: "event-high", categoryIds: ["glucose"], clarificationCode: "none" })));
    await expect(planTarvisEvidenceRequest(question, planningOptions, { epoch: 1 })).rejects.toThrow();
  });

  it.each(["gemini", "claude"] as const)("keeps safety-critical questions local with %s selected", async provider => {
    mocks.loadProvider.mockResolvedValue(provider);
    const result = await askTarvis("How many units of insulin should I take now?", undefined, [], { epoch: 1 });
    expect(result.modelRequestSent).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(["gemini", "claude"] as const)("surfaces %s authentication and rate-limit recovery without extra dispatches", async provider => {
    mocks.loadProvider.mockResolvedValue(provider);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("private error", { status: 401 }));
    let failure: unknown;
    try { await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 }); } catch (error) { failure = error; }
    expect(getTarvisRequestFailureDetails(failure)).toMatchObject({ modelRequestSent: true, settingsRequired: true });
    fetchSpy.mockResolvedValueOnce(new Response("private error", { status: 429 }));
    try { await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 }); } catch (error) { failure = error; }
    expect(getTarvisRequestFailureDetails(failure)?.retryAt).toBeGreaterThan(Date.now());
    try { await askTarvis("What does HbA1c mean?", undefined, [], { epoch: 1 }); } catch (error) { failure = error; }
    expect(getTarvisRequestFailureDetails(failure)?.modelRequestSent).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("asks for opaque evidence handles before any personal records are loaded", async () => {
    const question =
      "I had a really high reading two days ago. Do you know why?";
    const planningOptions = buildTarvisEvidencePlanningOptions(
      question,
      Date.parse("2026-08-26T10:00:00+01:00"),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        JSON.stringify({
          kind: "glucose-episode",
          rangeOptionId: "range-1",
          eventOptionId: "event-high",
          categoryIds: [
            "glucose",
            "insulin",
            "food",
            "activity",
            "sleep",
            "context",
            "data-quality",
          ],
          clarificationCode: "none",
        }),
      ),
    );

    const result = await planTarvisEvidenceRequest(
      question,
      planningOptions,
      { epoch: 1 },
    );

    const request = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1]?.body),
    ) as Record<string, any>;
    const input = JSON.parse(request.input[0].content[0].text);
    expect(request.store).toBe(false);
    expect(request.reasoning.effort).toBe("low");
    expect(request.max_output_tokens).toBe(300);
    expect(request.text.format.name).toBe("tarvis_evidence_plan_v1");
    expect(input.requestMode).toBe("evidence-planning");
    expect(input.untrustedQuestion).toBe(question);
    expect(input.offeredOptions.explicitCategoryIds).toEqual([]);
    expect(input.offeredOptions.excludedCategoryIds).toEqual([]);
    expect(input.offeredOptions.explicitContextChecks).toEqual([]);
    expect(input.offeredOptions.excludedContextChecks).toEqual([]);
    expect(input.offeredOptions.explicitDataQualityChecks).toEqual([]);
    expect(input.offeredOptions.excludedDataQualityChecks).toEqual([]);
    expect(input.offeredOptions.rangeOptions).toEqual([
      { id: "range-1", label: "Mon 24 Aug" },
    ]);
    expect(input.offeredOptions.rangeOptions[0]).not.toHaveProperty("current");
    expect(input.offeredOptions.rangeOptions[0]).not.toHaveProperty("previous");
    expect(JSON.stringify(input)).not.toContain("mmolL");
    expect(result.plan).toMatchObject({
      kind: "glucose-episode",
      eventKind: "high",
      range: {
        current: {
          start: Date.parse("2026-08-24T00:00:00+01:00"),
          end: Date.parse("2026-08-25T00:00:00+01:00"),
        },
      },
    });
    expect(result.modelRequestSent).toBe(true);
  });

  it("sends only trusted subtype directives for the exact phone question", async () => {
    const question =
      "Why did I go high on Saturday 15 August? Please check food, insulin, activity and data gaps.";
    const planningOptions = buildTarvisEvidencePlanningOptions(
      question,
      Date.parse("2026-08-26T12:00:00+01:00"),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        JSON.stringify({
          kind: "glucose-episode",
          rangeOptionId: "range-1",
          eventOptionId: "event-high",
          categoryIds: ["glucose", "insulin", "data-quality"],
          clarificationCode: "none",
        }),
      ),
    );

    const result = await planTarvisEvidenceRequest(
      question,
      planningOptions,
      { epoch: 1 },
    );
    const request = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1]?.body),
    ) as Record<string, any>;
    const input = JSON.parse(request.input[0].content[0].text);
    expect(input.offeredOptions.explicitCategoryIds).toEqual([
      "insulin",
      "food",
      "activity",
      "data-quality",
    ]);
    expect(input.offeredOptions.explicitDataQualityChecks).toEqual(["gaps"]);
    expect(input.offeredOptions.excludedDataQualityChecks).toEqual([]);
    expect(input.offeredOptions).not.toHaveProperty("current");
    expect(JSON.stringify(input)).not.toMatch(/mmolL|recordIds|timestamp/);
    expect(result.plan).toMatchObject({
      kind: "glucose-episode",
      explicitDataQualityChecks: ["gaps"],
    });
  });

  it("does not let an urgent question reach the AI evidence planner", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const question = "I was high yesterday and I am vomiting with ketones now";

    await expect(
      planTarvisEvidenceRequest(
        question,
        buildTarvisEvidencePlanningOptions(question, Date.now()),
        { epoch: 1 },
      ),
    ).rejects.toThrow(/safety-critical/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.loadApiKey).not.toHaveBeenCalled();
  });

  it("rechecks immediate conversation safety before either model-request boundary", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const safetyHistory = [
      { role: "user" as const, text: "I have Type 1 diabetes." },
      { role: "assistant" as const, text: "What is happening now?" },
    ];
    const current = "I am vomiting now.";

    const answer = await askTarvis(
      current,
      evidencePacket(),
      [],
      { epoch: 1 },
      { safetyHistory },
    );
    expect(answer.modelRequestSent).toBe(false);
    expect(answer.answer.headline).toMatch(/999|A&E|urgent/i);

    await expect(
      planTarvisEvidenceRequest(
        current,
        buildTarvisEvidencePlanningOptions(current, Date.now()),
        { epoch: 1 },
        { safetyHistory },
      ),
    ).rejects.toThrow(/safety-critical/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.loadApiKey).not.toHaveBeenCalled();
  });

  it("uses closed finding selection and local copy for personal evidence", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        response(JSON.stringify({ findingIds: ["glucose-change"] })),
      );

    const result = await askTarvis(
      "Why was my glucose different last week?",
      evidencePacket(),
      [],
      { epoch: 1 },
    );

    const request = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1]?.body),
    ) as Record<string, any>;
    const input = JSON.parse(request.input[0].content[0].text);
    expect(request.text.format.name).toBe("tarvis_evidence_selection");
    expect(Object.keys(request.text.format.schema.properties)).toEqual([
      "findingIds",
    ]);
    expect(input.requestMode).toBe("evidence");
    expect(input.approvedFindingOptions).toContainEqual({
      id: "glucose-change",
      kind: undefined,
      title: "Glucose was steadier",
      summary: "Recorded variability was lower in the recent period.",
      evidenceIds: ["current-glucose", "previous-glucose"],
    });
    expect(result.answer.answer).toContain("variability was lower");
    expect(result.answerSource).toBe("local");
    expect(result.hostedEvidenceSelectionAccepted).toBe(true);
    expect(result.modelRequestSent).toBe(true);
    expect(result.requestMetrics).toBeDefined();
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["unknown finding", JSON.stringify({ findingIds: ["invented"] })],
    ["valid empty selection", JSON.stringify({ findingIds: [] })],
  ])("records evidence selection validity for %s without changing local prose", async (description, output) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(output));
    const result = await askTarvis("Why was my glucose different last week?", evidencePacket(), [], { epoch: 1 });
    expect(result.modelRequestSent).toBe(true);
    expect(result.requestMetrics).toBeDefined();
    expect(result.answerSource).toBe("local");
    expect(result.hostedEvidenceSelectionAccepted).toBe(description === "valid empty selection");
    expect(result.answer.answer).toContain("Recorded variability was lower");
  });

  it("sends only the requested current records for fresh basal/glucose questions, retaining prior records for an explicit comparison", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(JSON.stringify({ findingIds: [] })),
    );
    const source = evidencePacket();
    source.comparison.summary = "PRIOR_SECRET_9123 was compared with current records";
    source.comparison.previous!.glucoseAverage = 876.5;
    source.comparison.current.sleepMinutesPerNight = 9876;
    source.comparison.current.mealCarbsPerDay = 6543;
    source.comparison.current.bolusUnitsPerDay = 4321;
    source.findings.push({
      id: "basal-daily-totals", kind: "observation", category: "insulin",
      title: "Daily basal totals", summary: "Current 20 U; PRIOR_SECRET_9123 previous 91 U",
      evidenceIds: ["current-basal-daily-totals", "previous-basal-daily-totals"],
    });
    source.findings.push({
      id: "food-sentinel", kind: "observation", category: "food",
      title: "Food records", summary: "FOOD_SECRET_7654",
      evidenceIds: ["current-food-sentinel"],
    });
    source.evidence.push(
      { id: "current-basal-daily-totals", label: "Current basal", description: "Current basal totals", range: source.comparison.currentRange, recordCount: 7, examples: [] },
      { id: "previous-basal-daily-totals", label: "Previous basal", description: "PRIOR_SECRET_9123 previous basal", range: source.comparison.previousRange!, recordCount: 7, examples: [] },
      { id: "current-food-sentinel", label: "Food data", description: "FOOD_SECRET_7654", range: source.comparison.currentRange, recordCount: 1, examples: [] },
    );
    source.evidence[1]!.description = "PRIOR_SECRET_9123 previous glucose";
    const report = {
      currentRange: source.comparison.currentRange,
      current: source.comparison.current,
      findings: [{ id: "basal-daily-totals", currentPeriodSummary: "Requested period: seven recorded daily basal totals of 20 U each; timing unavailable." }],
    } as unknown as InsightReport;

    for (const question of [
      "What do my daily basal totals show over the last seven completed days?",
      "Compare my daily basal totals and glucose patterns over the last seven days, and explain what the lack of basal timing prevents you from concluding.",
    ]) {
      const packet = selectTarvisEvidencePacket(question,
        currentPeriodTarvisEvidence({ packet: source, references: new Map() }, report, question).packet);
      await askTarvis(question, packet, [], { epoch: 1 }, { packetIsPreselected: true });
      const body = String(fetchSpy.mock.lastCall?.[1]?.body);
      expect(body).not.toContain("PRIOR_SECRET_9123");
      expect(body).not.toContain("876.5");
      expect(body).not.toContain("9876");
      expect(body).not.toContain("6543");
      expect(body).not.toContain("4321");
      expect(body).not.toContain("FOOD_SECRET_7654");
      const input = JSON.parse((JSON.parse(body) as { input: { content: { text: string }[] }[] }).input[0]!.content[0]!.text);
      expect(input.recentConversation).toEqual([]);
      expect(input.evidencePacket.comparison.previous).toBeUndefined();
      if (question.startsWith("Compare")) expect(input.evidencePacket.comparison.summary).toContain("72.3%");
    }

    const previousQuestion = "Compare my daily basal totals and glucose patterns over the last seven days with the previous seven days.";
    const previousPacket = selectTarvisEvidencePacket(previousQuestion, source);
    await askTarvis(previousQuestion, previousPacket, [], { epoch: 1 }, { packetIsPreselected: true });
    const previousBody = String(fetchSpy.mock.lastCall?.[1]?.body);
    expect(previousBody).toContain("PRIOR_SECRET_9123");
    expect(previousBody).not.toContain("9876");
    expect(previousBody).not.toContain("6543");
    expect(previousBody).not.toContain("4321");
    expect(previousBody).not.toContain("FOOD_SECRET_7654");
  });

  it("keeps unrelated Health Connect source-choice details out of sleep and glucose model requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(JSON.stringify({ findingIds: [] })));
    const source = evidencePacket();
    const currentRange = source.comparison.currentRange;
    const previousRange = source.comparison.previousRange!;
    source.comparison.current.sleepMinutesPerNight = 420;
    source.findings.push(
      { id: "sleep-context", kind: "context-clue", category: "sleep", title: "Sleep comparison", summary: "Previous sleep differed", evidenceIds: ["current-sleep", "previous-sleep"] },
      { id: "glucose-data-completeness", kind: "limitation", category: "data-quality", title: "Glucose coverage", summary: "Previous coverage differed", evidenceIds: ["current-completeness", "previous-completeness"] },
      { id: "health-connect-source-choice", kind: "limitation", category: "data-quality", title: "Health source choice", summary: "UNRELATED_HEALTH_SECRET_4628", evidenceIds: ["current-health-source-choice", "previous-health-source-choice"] },
    );
    source.evidence.push(
      { id: "current-sleep", label: "Current sleep", description: "Current sleep sessions", range: currentRange, recordCount: 2, examples: [] },
      { id: "previous-sleep", label: "Previous sleep", description: "Previous sleep sessions", range: previousRange, recordCount: 2, examples: [] },
      { id: "current-completeness", label: "Current glucose coverage", description: "Current glucose coverage", range: currentRange, recordCount: 100, examples: [] },
      { id: "previous-completeness", label: "Previous glucose coverage", description: "Previous glucose coverage", range: previousRange, recordCount: 100, examples: [] },
      { id: "current-health-source-choice", label: "UNRELATED_HEALTH_SECRET_4628", description: "UNRELATED_HEALTH_SECRET_4628", range: currentRange, recordCount: 1,
        examples: [{ id: "unrelated-health", kind: "health-metric", timestamp: currentRange.start + 1, primary: "UNRELATED_HEALTH_SECRET_4628", secondary: "private fixture", sourceId: "fixture" }] },
      { id: "previous-health-source-choice", label: "Previous health source", description: "UNRELATED_HEALTH_SECRET_4628", range: previousRange, recordCount: 1, examples: [] },
    );
    const report = { currentRange, current: source.comparison.current, findings: [] } as unknown as InsightReport;
    const question = "What do my sleep and glucose records show together over the last seven days, without assuming one caused the other?";
    const packet = selectTarvisEvidencePacket(question,
      currentPeriodTarvisEvidence({ packet: source, references: new Map() }, report, question).packet);
    expect(packet.findings.map(({ id }) => id)).toContain("glucose-data-completeness");
    expect(packet.findings.map(({ id }) => id)).not.toContain("health-connect-source-choice");
    expect(JSON.stringify(packet)).not.toContain("UNRELATED_HEALTH_SECRET_4628");
    await askTarvis(question, packet, [], { epoch: 1 }, { packetIsPreselected: true });
    const body = String(fetchSpy.mock.lastCall?.[1]?.body);
    expect(body).not.toContain("UNRELATED_HEALTH_SECRET_4628");
    expect(body).toContain("current-sleep");
    expect(body).toContain("current-completeness");
    expect(body).not.toContain("previous-sleep");

    const sourceQuestion = "Why are my Health Connect source totals missing over the last seven days?";
    const sourcePacket = selectTarvisEvidencePacket(sourceQuestion,
      currentPeriodTarvisEvidence({ packet: source, references: new Map() }, report, sourceQuestion).packet);
    const sourceFinding = sourcePacket.findings.find(({ id }) => id === "health-connect-source-choice");
    expect(sourceFinding?.summary).toContain("Health Connect source records");
    expect(sourceFinding?.summary).not.toContain("Sensor coverage");
    expect(sourcePacket.evidence.map(({ id }) => id)).not.toContain("previous-health-source-choice");
  });

  it.each([
    ["Nutrition", "food", "mealCarbsPerDay", 55],
    ["Distance and climbing", "activity", "distanceKilometresPerDay", 2.3],
    ["Health Connect glucose", "vitals", "healthConnectBloodGlucoseMmolL", 7.1],
  ] as const)("sends the generated %s Health subject and glucose without unrelated or previous records", async (label, category, field, amount) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(JSON.stringify({ findingIds: [] })));
    const currentRange = { start: Date.parse("2026-09-07T00:00:00+01:00"), end: Date.parse("2026-09-08T00:00:00+01:00") };
    const previousRange = { start: Date.parse("2026-09-06T00:00:00+01:00"), end: currentRange.start };
    const entry = createTarvisHealthEntry(currentRange, label);
    const selectedId = entry.healthMetric === "nutrition" ? "food-context"
      : entry.healthMetric === "health-glucose" ? "health-connect-vitals" : "health-connect-activity";
    const current = { ...evidencePacket().comparison.current, [field]: amount,
      sleepMinutesPerNight: 9876, stepsPerDay: 12345, activeCaloriesPerDay: 6543 };
    const report = {
      generatedAt: currentRange.end, currentRange, previousRange, current,
      previous: { ...current, [field]: 9123 }, ready: true,
      headline: "PRIOR_HEALTH_9123", summary: "PRIOR_HEALTH_9123",
      findings: [{
        id: selectedId, kind: "observation", category,
        title: "Selected health subject", summary: "CURRENT versus PRIOR_HEALTH_9123",
        evidence: [
          { id: "current-selected-health", label: "Current health", description: "Current source-selected health records", range: currentRange,
            recordIds: ["current-record", "unrelated-same-category-record"], examples: [{ id: "current-record", kind: "health-metric", timestamp: currentRange.start + 1,
              primary: "UNRELATED_EXAMPLE_12345", secondary: "fixture", sourceId: "fixture" }] },
          { id: "previous-selected-health", label: "Previous health", description: "PRIOR_HEALTH_9123", range: previousRange,
            recordIds: ["previous-record"], examples: [] },
        ],
      }],
    } as unknown as InsightReport;
    const lookup = buildSelectedHealthEvidencePacket(report, entry.healthMetric!);
    const packet = selectTarvisEvidencePacket(entry.question,
      currentPeriodTarvisEvidence(lookup, report, entry.question).packet);
    await askTarvis(entry.question, packet, [], { epoch: 1 }, { packetIsPreselected: true });
    const body = String(fetchSpy.mock.lastCall?.[1]?.body);
    expect(body).not.toContain("PRIOR_HEALTH_9123");
    expect(body).not.toContain("UNRELATED_EXAMPLE_12345");
    expect(body).not.toContain("9876");
    expect(body).not.toContain("12345");
    expect(body).not.toContain("6543");
    const input = JSON.parse((JSON.parse(body) as { input: { content: { text: string }[] }[] }).input[0]!.content[0]!.text);
    expect(input.recentConversation).toEqual([]);
    expect(input.evidencePacket.comparison.previous).toBeUndefined();
    expect(input.evidencePacket.comparison.current[field]).toBe(amount);
    expect(input.evidencePacket.comparison.current.glucoseAverage).toBe(7.4);
    expect(input.evidencePacket.evidence.find(({ id }: { id: string }) => id === "current-selected-health")?.recordCount).toBeUndefined();
    expect(input.approvedFindingOptions.some(({ id }: { id: string }) => id === selectedId)).toBe(true);
  });

  it("fails an injected personal prose field closed to local copy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        JSON.stringify({
          findingIds: ["glucose-change"],
          answer: "Take insulin now.",
        }),
      ),
    );

    const result = await askTarvis(
      "Why was my glucose different last week?",
      evidencePacket(),
      [],
      { epoch: 1 },
    );
    expect(result.answer.answer).not.toContain("Take insulin now");
    expect(result.answer.answer).toContain("compared locally");
    expect(result.answerSource).toBe("local");
  });

  it.each([
    "What does time in range mean?",
    "What is the glycaemic index?",
    "Explain HbA1c in plain English.",
    "Tell me about depression.",
  ])("answers general health questions without a prewritten guidance item: %s", async (question) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(JSON.stringify({
      kind: "explanation",
      headline: "The general idea",
      answer: "This explains a health concept, not an individual diagnosis.",
      limitations: [],
    })));
    const result = await askTarvis(
      question,
      undefined,
      [{ role: "user", text: "My unrelated private history" }],
      { epoch: 1 },
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.modelRequestSent).toBe(true);
    expect(result.answerSource).toBe("hosted");
    expect(result.answer.evidenceIds).toEqual([]);
    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(request.store).toBe(false);
    expect(request.text.format.name).toBe("tarvis_general_education_v1");
    const input = JSON.parse(request.input[0].content[0].text);
    expect(input.requestMode).toBe("general-education");
    expect(input.recentConversation).toEqual([]);
    expect(input).not.toHaveProperty("evidencePacket");
    expect(input.reviewedKnowledge).toEqual([]);
  });

  it("sends only the immediately preceding explanation for a simplification follow-up", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(JSON.stringify({
      kind: "explanation", headline: "HbA1c, more simply", answer: "HbA1c gives a longer-term picture of glucose.", limitations: [],
    })));
    const history = [
      { role: "user" as const, text: "Older private records" },
      { role: "assistant" as const, text: "Older answer" },
      { role: "user" as const, text: "Explain HbA1c in plain English." },
      { role: "assistant" as const, text: "HbA1c reflects glycated haemoglobin." },
    ];
    await askTarvis("Can you explain that more simply?", undefined, history, { epoch: 1 });
    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    const input = JSON.parse(request.input[0].content[0].text);
    expect(input.recentConversation).toEqual(history.slice(-2));
    expect(input).not.toHaveProperty("evidencePacket");
  });

  it.each([
    ["I think this is DKA", "Get urgent diabetes advice now"],
    ["Ketones 3.1", "Call 999 now or go to A&E"],
    ["I cannot breathe", "Call 999 now"],
    ["My child may have DKA", "Call 999 now or go to A&E"],
  ])(
    "keeps safety-critical request local before key or fetch: %s",
    async (question, headline) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const result = await askTarvis(question, undefined, [], { epoch: 1 });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mocks.loadApiKey).not.toHaveBeenCalled();
      expect(result.modelRequestSent).toBe(false);
      expect(result.answerSource).toBe("local");
      expect(result.answer.headline).toBe(headline);
    },
  );

  it("uses a closed claim menu and local copy for retrospective interpretation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        JSON.stringify({
          leadStyle: "timeline-first",
          leadText: TIMELINE_LEAD,
          claims: [
            {
              claimId: "activity-timing-could-have-contributed",
              evidenceIds: ["activity", "glucose"],
              knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
              bridgeText: CLAIM_BRIDGE,
            },
          ],
          closingStyle: "offer-evidence",
          closingText: EVIDENCE_CLOSE,
        }),
      ),
    );

    const result = await askTarvis(
      "Why did my glucose go low when I walked after dinner?",
      retrospectivePacket(),
      [],
      { epoch: 1 },
    );

    const request = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1]?.body),
    ) as Record<string, any>;
    const input = JSON.parse(request.input[0].content[0].text);
    expect(request.store).toBe(false);
    expect(request.reasoning.effort).toBe("medium");
    expect(request.text.format.name).toBe("tarvis_retrospective_companion_v1");
    expect(request.text.format.schema.required).toEqual([
      "leadStyle",
      "leadText",
      "claims",
      "closingStyle",
      "closingText",
    ]);
    expect(request.text.format.schema.properties).toHaveProperty("leadStyle");
    expect(request.text.format.schema.properties).toHaveProperty("leadText");
    expect(request.text.format.schema.properties).toHaveProperty("claims");
    expect(request.text.format.schema.properties).toHaveProperty(
      "closingStyle",
    );
    expect(request.text.format.schema.properties).toHaveProperty("closingText");
    expect(request.text.format.schema.properties.claims.items.required).toEqual(
      ["claimId", "evidenceIds", "knowledgeIds", "bridgeText"],
    );
    expect(request.text.format.schema.properties).not.toHaveProperty(
      "paragraphs",
    );
    expect(input.requestMode).toBe("retrospective");
    expect(
      input.untrustedEvidencePacket.reviewedKnowledge[0].jurisdiction,
    ).toBe("UK");
    expect(input.untrustedQuestion).toBe(
      "Why did my glucose go low when I walked after dinner?",
    );
    expect(input).not.toHaveProperty("evidencePacket");
    expect(input).not.toHaveProperty("question");
    expect(input.approvedInterpretationClaims).toContainEqual({
      id: "activity-timing-could-have-contributed",
      meaning: expect.any(String),
      evidenceIds: ["activity", "glucose"],
      knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
    });
    expect(result.answer.answer).toContain("The evening walk started at 20:30");
    expect(result.answer.answer).toContain(TIMELINE_LEAD);
    expect(result.answer.answer).toContain(CLAIM_BRIDGE);
    expect(result.answer.answer).toContain(EVIDENCE_CLOSE);
    expect(result.answer.answer).toContain(
      "the activity could have contributed",
    );
    expect(result.answerSource).toBe("hosted");
    expect(result.modelRequestSent).toBe(true);
    expect(result.requestMetrics).toBeDefined();
  });

  it("keeps metrics and records local provenance when a model selection fails closed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        JSON.stringify({
          leadStyle: "direct-cautious",
          leadText: DIRECT_LEAD,
          claims: [
            {
              claimId: "activity-timing-could-have-contributed",
              evidenceIds: ["invented-evidence"],
              knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
              bridgeText: CLAIM_BRIDGE,
            },
          ],
          closingStyle: "none",
          closingText: "",
        }),
      ),
    );
    const packet = retrospectivePacket();

    const result = await askTarvis(
      "Why did my glucose go low when I walked after dinner?",
      packet,
      [],
      { epoch: 1 },
    );

    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
    expect(result.answerSource).toBe("local");
    expect(result.modelRequestSent).toBe(true);
    expect(result.requestMetrics).toBeDefined();
    expect(result.usage.totalTokens).toBe(30);
  });

  it("supplies UK NICE sources but always displays reviewed local education copy", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        JSON.stringify({
          knowledgeIds: ["nice-ng17-type-1-sick-day-rules"],
        }),
      ),
    );

    const result = await askTarvis(
      "What are the NICE sick-day rules for Type 1 diabetes?",
      undefined,
      [],
      { epoch: 1 },
    );

    const request = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1]?.body),
    ) as Record<string, any>;
    const input = JSON.parse(request.input[0].content[0].text);
    expect(request.reasoning.effort).toBe("low");
    expect(request.text.format.name).toBe("tarvis_reviewed_knowledge_answer");
    expect(Object.keys(request.text.format.schema.properties)).toEqual([
      "knowledgeIds",
    ]);
    expect(input.requestMode).toBe("education");
    expect(input.reviewedKnowledge).toHaveLength(1);
    expect(input.reviewedKnowledge[0]).toMatchObject({
      jurisdiction: "UK",
      recommendationRefs: ["1.6.20", "1.7.23", "1.10.1"],
    });
    expect(input).not.toHaveProperty("evidencePacket");
    expect(result.answer.answer).toContain(
      "capillary blood glucose monitoring",
    );
    expect(result.answerSource).toBe("local");
    expect(result).not.toHaveProperty("hostedEvidenceSelectionAccepted");
    expect(result.modelRequestSent).toBe(true);
    expect(result.requestMetrics).toBeDefined();
  });

  it("sends only NG18 and displays dedicated local copy for a child sick-day question", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        JSON.stringify({
          knowledgeIds: [NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id],
        }),
      ),
    );

    const result = await askTarvis(
      "What are the NICE sick-day rules for a young person?",
      undefined,
      [],
      { epoch: 1 },
    );

    const request = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1]?.body),
    ) as Record<string, any>;
    const input = JSON.parse(request.input[0].content[0].text);
    expect(input.requestMode).toBe("education");
    expect(input.reviewedKnowledge).toEqual([
      NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
    ]);
    expect(input.reviewedKnowledge[0]).toMatchObject({
      jurisdiction: "UK",
      recommendationRefs: ["1.2.72", "1.2.82", "1.2.83"],
    });
    expect(JSON.stringify(input.reviewedKnowledge)).not.toContain("NG17");
    expect(result.answer.answer).toContain(
      "individualised oral and written sick-day rules",
    );
    expect(result.answer.answer).toContain("T1 Arc safety note");
    expect(result.answer.answer).not.toContain("NG17");
    expect(result.answerSource).toBe("local");
    expect(result.modelRequestSent).toBe(true);
  });

  it("keeps unsupported child exercise guidance local without sending adult NG17", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await askTarvis(
      "What does NICE say about exercise for children?",
      undefined,
      [],
      { epoch: 1 },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.modelRequestSent).toBe(false);
    expect(result.answerSource).toBe("local");
    expect(result.answer.answer).toMatch(/won’t fill the gap from memory/i);
    expect(result.answer.answer).not.toContain(
      "when insulin levels are adequate",
    );
    expect(result.answer.answer).not.toContain("NG17");
  });

  it("retains sent-request metrics when a model refusal falls back locally", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          { content: [{ type: "refusal", refusal: "I cannot answer that." }] },
        ],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      }),
    } as Response);

    let failure: unknown;
    try {
      await askTarvis(
        "Why did my glucose go low when I walked after dinner?",
        retrospectivePacket(),
        [],
        { epoch: 1 },
      );
    } catch (reason) {
      failure = reason;
    }

    expect(getTarvisRequestFailureDetails(failure)).toMatchObject({
      modelRequestSent: true,
      requestMetrics: { totalTokens: 30 },
      usage: { totalTokens: 30 },
    });
  });

  it("records usage and fails an incomplete response instead of parsing partial output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  leadStyle: "direct-cautious",
                  leadText: DIRECT_LEAD,
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
      }),
    } as Response);

    let failure: unknown;
    try {
      await askTarvis(
        "Why did my glucose go low when I walked after dinner?",
        retrospectivePacket(),
        [],
        { epoch: 1 },
      );
    } catch (reason) {
      failure = reason;
    }

    expect(failure).toMatchObject({
      message: "OpenAI returned an incomplete answer (max_output_tokens).",
    });
    expect(getTarvisRequestFailureDetails(failure)).toMatchObject({
      modelRequestSent: true,
      requestMetrics: { totalTokens: 30 },
      usage: { totalTokens: 30 },
    });
    expect(mocks.saveUsage).toHaveBeenCalledWith(
      expect.objectContaining({ totalTokens: 30 }),
      { epoch: 1 },
    );
  });

  it("distinguishes a pre-fetch connection failure from a sent request", async () => {
    mocks.loadApiKey.mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    let failure: unknown;
    try {
      await askTarvis(
        "Why did my glucose go low when I walked after dinner?",
        retrospectivePacket(),
        [],
        { epoch: 1 },
      );
    } catch (reason) {
      failure = reason;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getTarvisRequestFailureDetails(failure)).toEqual({
      modelRequestSent: false,
      requestMetrics: undefined,
      usage: undefined,
      settingsRequired: true,
      retryAt: undefined,
    });
  });

  it("does not consume local model-request allowance when safety-ID loading fails before dispatch", async () => {
    mocks.getSafetyIdentifier.mockRejectedValue(new Error("secure read failed"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      askTarvis(
        "Why did my glucose go low when I walked after dinner?",
        retrospectivePacket(),
        [],
        { epoch: 1 },
      ),
    ).rejects.toThrow("secure read failed");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.saveUsage).not.toHaveBeenCalled();
  });

  it("does not consume planner allowance when safety-ID loading fails before dispatch", async () => {
    mocks.getSafetyIdentifier.mockRejectedValue(new Error("secure read failed"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const question =
      "I had a really high reading two days ago. Do you know why?";

    await expect(
      planTarvisEvidenceRequest(
        question,
        buildTarvisEvidencePlanningOptions(
          question,
          Date.parse("2026-08-26T10:00:00+01:00"),
        ),
        { epoch: 1 },
      ),
    ).rejects.toThrow("secure read failed");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.saveUsage).not.toHaveBeenCalled();
  });
});
