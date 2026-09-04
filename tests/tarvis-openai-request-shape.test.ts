import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetTarvisConnectionCoordinatorForTests } from "@/data/tarvis/connectionCoordinator";
import {
  askTarvis,
  getTarvisRequestFailureDetails,
  planTarvisEvidenceRequest,
} from "@/data/tarvis/openAiClient";
import { buildTarvisEvidencePlanningOptions } from "@/data/tarvis/evidencePlanner";
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
  loadUsage: vi.fn(),
  saveUsage: vi.fn(),
  getSafetyIdentifier: vi.fn(),
}));

vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: mocks.acquireLease,
  assertLocalDataWriteLeaseCurrent: mocks.assertLeaseCurrent,
}));

vi.mock("@/data/tarvis/secureStore", () => ({
  getTarvisSafetyIdentifier: mocks.getSafetyIdentifier,
  loadTarvisApiKey: mocks.loadApiKey,
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
    resetTarvisConnectionCoordinatorForTests();
    mocks.acquireLease.mockResolvedValue({ epoch: 1 });
    mocks.assertLeaseCurrent.mockResolvedValue(undefined);
    mocks.loadApiKey.mockResolvedValue("test-key");
    mocks.loadUsage.mockResolvedValue({
      requestTimestamps: [],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    mocks.saveUsage.mockResolvedValue(undefined);
    mocks.getSafetyIdentifier.mockResolvedValue("safety-id");
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
    expect(result.modelRequestSent).toBe(true);
    expect(result.requestMetrics).toBeDefined();
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

  it("keeps unreviewed education local and makes no model request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await askTarvis(
      "What does time in range mean?",
      undefined,
      [],
      { epoch: 1 },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.modelRequestSent).toBe(false);
    expect(result.answerSource).toBe("local");
    expect(result.answer.answer).toMatch(/won’t improvise medical guidance/i);
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
    expect(result.answer.answer).toMatch(/won’t improvise medical guidance/i);
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
