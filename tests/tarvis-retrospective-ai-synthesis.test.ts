import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  parseTarvisRetrospectiveAnswer,
  parseTarvisRetrospectiveAnswerResult,
  tarvisRetrospectiveClaimOptions,
} from "@/data/tarvis/retrospectiveAnswerGuardrail";
import {
  buildTarvisRetrospectiveEvidencePacket,
  mapTarvisRetrospectiveEvidenceReferences,
} from "@/data/tarvis/retrospectiveEvidencePacket";
import {
  NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
  NICE_TYPE_1_EXERCISE_KNOWLEDGE,
  NICE_TYPE_1_SICK_DAY_KNOWLEDGE,
  resolveTarvisReviewedKnowledgeForTurn,
  selectTarvisReviewedKnowledge,
  tarvisReviewedKnowledgeByIds,
} from "@/data/tarvis/reviewedKnowledge";
import {
  parseTarvisReviewedKnowledgeAnswer,
  reviewedKnowledgeAnswerForTurn,
} from "@/data/tarvis/reviewedKnowledgeAnswerGuardrail";
import {
  buildRetrospectiveEventReview,
  type RetrospectiveEventReview,
} from "@/data/tarvis/retrospectiveEventReview";
import type { TimelineData } from "@/domain/models";

const START = Date.parse("2026-08-21T20:30:00+01:00");

const DIRECT_LEAD = "I can give you my careful reading.";
const TIMELINE_LEAD = "Let's start with the recorded timeline.";
const UNCERTAINTY_LEAD =
  "I can't be certain, but I can still give you my honest reading.";
const FIRST_BRIDGE = "That gives the next point its context.";
const SECOND_BRIDGE = "This part gives the reading more context.";
const EVIDENCE_CLOSE =
  "If you'd like, we can look through the evidence together.";
const LIMITATIONS_CLOSE =
  "If you'd like, we can look at the uncertainty together.";

function companionPlan() {
  return {
    leadStyle: "direct-cautious" as const,
    leadText: DIRECT_LEAD,
    claims: [
      {
        claimId: "activity-timing-could-have-contributed",
        evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
        knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
        bridgeText: FIRST_BRIDGE,
      },
    ],
    closingStyle: "offer-evidence" as const,
    closingText: EVIDENCE_CLOSE,
  };
}

function review(): RetrospectiveEventReview {
  return {
    outcome: "ready",
    event: {
      kind: "low",
      observed: true,
      activityContributionSupported: true,
    },
    answer: {
      headline: "Recorded low around Evening walk",
      answer:
        "Evening walk started at 20:30. Glucose was 6.2 mmol/L at the start and a notification recorded 1.1 U IOB nearby. The timings overlap but do not establish cause.",
      confidence: "moderate",
      evidenceIds: ["activity", "glucose", "iob"],
      limitations: ["The records cannot establish the cause of the low."],
    },
    evidence: [
      {
        id: "activity",
        label: "Recorded activity",
        description: "Evening walk, 32 minutes.",
        range: { start: START, end: START + 32 * 60_000 },
        recordIds: ["walk-1"],
        examples: [
          {
            id: "walk-1",
            kind: "context",
            timestamp: START,
            primary: "Evening walk",
            secondary: "32 min",
            sourceId: "health-connect",
          },
        ],
      },
      {
        id: "glucose",
        label: "Glucose around the activity",
        description: "Glucose was 6.2 mmol/L at 20:30.",
        range: { start: START, end: START + 60 * 60_000 },
        recordIds: ["g-1", "g-2"],
        examples: [
          {
            id: "g-1",
            kind: "glucose",
            timestamp: START,
            primary: "6.2 mmol/L",
            secondary: "Falling",
            sourceId: "libre",
          },
        ],
      },
      {
        id: "iob",
        label: "Notification-reported IOB",
        description: "A supported notification recorded 1.1 U IOB.",
        range: { start: START - 5 * 60_000, end: START + 5 * 60_000 },
        recordIds: ["iob-1"],
        examples: [
          {
            id: "iob-1",
            kind: "source-record",
            timestamp: START - 2 * 60_000,
            primary: "1.1 U IOB",
            secondary: "Recorded notification value",
            sourceId: "notification",
          },
        ],
      },
    ],
  };
}

describe("Tarv1s retrospective AI synthesis boundary", () => {
  it("builds a bounded local dossier with UK NICE interpretation knowledge", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);

    expect(packet.requestMode).toBe("retrospective");
    expect(packet.verifiedReview.chronology).toContain("6.2 mmol/L");
    expect(packet.verifiedReview).toMatchObject({
      eventKind: "low",
      eventObserved: true,
      activityContributionSupported: true,
    });
    expect(packet.evidence.map(({ id }) => id)).toEqual([
      "incident-evidence-1",
      "incident-evidence-2",
      "incident-evidence-3",
    ]);
    expect(packet.evidence[0]?.examples[0]?.id).toBe(
      "incident-evidence-1:example-1",
    );
    expect(JSON.stringify(packet)).not.toContain("walk-1");
    expect(JSON.stringify(packet)).not.toContain("g-1");
    expect(JSON.stringify(packet)).not.toContain("iob-1");
    expect(packet.evidence[1]?.recordCount).toBe(2);
    expect(packet.reviewedKnowledge).toEqual([NICE_TYPE_1_EXERCISE_KNOWLEDGE]);
    expect(packet.reviewedKnowledge[0]?.jurisdiction).toBe("UK");
    expect(packet.reviewedKnowledge[0]?.sourceTitle).toContain("NICE NG17");

    const references = mapTarvisRetrospectiveEvidenceReferences(
      review().evidence,
    );
    expect(references.get("incident-evidence-1")?.id).toBe(
      "incident-evidence-1",
    );
    expect(references.get("incident-evidence-1")?.recordIds).toEqual([
      "walk-1",
    ]);
  });

  it("accepts only approved claim IDs with their exact local provenance", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const answer = parseTarvisRetrospectiveAnswer(
      JSON.stringify({
        leadStyle: "timeline-first",
        leadText: TIMELINE_LEAD,
        claims: [
          {
            claimId: "activity-timing-could-have-contributed",
            evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
          },
          {
            claimId: "recorded-iob-does-not-prove-insulin-adequacy",
            evidenceIds: ["incident-evidence-3"],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: SECOND_BRIDGE,
          },
        ],
        closingStyle: "offer-evidence",
        closingText: EVIDENCE_CLOSE,
      }),
      packet,
    );

    expect(tarvisRetrospectiveClaimOptions(packet)).toContainEqual({
      id: "activity-timing-could-have-contributed",
      meaning: expect.any(String),
      evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
      knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
    });
    expect(answer.answer).toContain(packet.verifiedReview.chronology);
    expect(answer.answer).toContain(TIMELINE_LEAD);
    expect(answer.answer).toContain(FIRST_BRIDGE);
    expect(answer.answer).toContain(SECOND_BRIDGE);
    expect(answer.answer).toContain(
      "the activity could have contributed to the recorded glucose change",
    );
    expect(answer.answer).toContain(
      "doesn’t prove that physiological insulin levels were adequate",
    );
    expect(answer.answer).toContain(EVIDENCE_CLOSE);
    expect(answer.evidenceIds).toEqual([
      "incident-evidence-1",
      "incident-evidence-2",
      "incident-evidence-3",
    ]);
    expect(answer.confidence).toBe("moderate");
    expect(answer.limitations).toContain(
      "The records cannot establish the cause of the low.",
    );
  });

  it("allows the model to abstain without adding an irrelevant interpretation", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(true);
    expect(result.answer.answer).toContain(packet.verifiedReview.chronology);
    expect(result.answer.answer).toBe(
      `${DIRECT_LEAD}\n\n${packet.verifiedReview.chronology}`,
    );
    expect(result.answer.evidenceIds).toEqual(
      packet.evidence.map(({ id }) => id),
    );
  });

  it("can lead directly with local facts without compulsory companion filler", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const plan = companionPlan();
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        ...plan,
        leadText: "",
        claims: plan.claims.map((claim) => ({ ...claim, bridgeText: "" })),
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(true);
    expect(result.answer.answer.startsWith(packet.verifiedReview.chronology)).toBe(true);
    expect(result.answer.answer).toContain("the activity could have contributed");
    expect(result.answer.answer).not.toContain(DIRECT_LEAD);
    expect(result.answer.answer).not.toContain(FIRST_BRIDGE);
    expect(result.answer.answer).not.toContain(EVIDENCE_CLOSE);
    expect(result.answer.evidenceIds).toEqual(packet.evidence.map(({ id }) => id));
    expect(result.answer.limitations).toEqual(packet.verifiedReview.limitations);
    expect(result.answer.confidence).toBe(packet.verifiedReview.confidence);
  });

  it("can return only the unchanged chronology when no interpretation is needed", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(JSON.stringify({
      leadStyle: "direct-cautious",
      leadText: "",
      claims: [],
      closingStyle: "none",
      closingText: "",
    }), packet);
    expect(result.acceptedHostedAnswer).toBe(true);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it.each([
    { leadText: " " },
    { leadText: "\u200b" },
    { leadText: "Take 2 units now." },
    { bridgeText: " " },
    { bridgeText: "\u200b" },
    { bridgeText: "Your walk caused the low." },
    { evidenceIds: ["incident-evidence-2", "incident-evidence-1"] },
    { evidenceIds: [] },
    { knowledgeIds: ["invented-guideline"] },
    { claimId: "invented-claim" },
  ])("empty optional framing does not bypass prose or provenance checks: %j", (change) => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const plan = companionPlan();
    const { leadText = "", ...claimChange } = change;
    const result = parseTarvisRetrospectiveAnswerResult(JSON.stringify({
      ...plan,
      leadText,
      claims: plan.claims.map((claim) => ({ ...claim, bridgeText: "", ...claimChange })),
      closingStyle: "none",
      closingText: "",
    }), packet);
    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it.each([
    ["direct-cautious", DIRECT_LEAD, "offer-evidence", EVIDENCE_CLOSE],
    ["timeline-first", TIMELINE_LEAD, "offer-limitations", LIMITATIONS_CLOSE],
    ["uncertainty-first", UNCERTAINTY_LEAD, "none", ""],
  ] as const)(
    "renders bounded hosted companion connectors for %s and %s",
    (leadStyle, leadText, closingStyle, closingText) => {
      const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
      const result = parseTarvisRetrospectiveAnswerResult(
        JSON.stringify({
          leadStyle,
          leadText,
          claims: [],
          closingStyle,
          closingText,
        }),
        packet,
      );

      expect(result.acceptedHostedAnswer).toBe(true);
      expect(result.answer.answer).toContain(leadText);
      expect(result.answer.answer).toContain(packet.verifiedReview.chronology);
      if (closingText) {
        expect(result.answer.answer).toContain(closingText);
      } else {
        expect(result.answer.answer).toBe(
          `${leadText}\n\n${packet.verifiedReview.chronology}`,
        );
      }
    },
  );

  it.each([
    [
      "medical wording in the lead",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.leadText = "I can give you my careful glucose reading.";
      },
      "",
    ],
    [
      "a number in the lead",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.leadText = "I can give you my careful reading at 6.2.";
      },
      "",
    ],
    [
      "medical wording in a bridge",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.claims[0]!.bridgeText =
          "That glucose point gives the next part context.";
      },
      "",
    ],
    [
      "a user-directed instruction in a bridge",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.claims[0]!.bridgeText =
          "That gives you context and you can make the next point.";
      },
      "",
    ],
    [
      "a guideline name in the close",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.closingText =
          "If you'd like, we can look through the NICE evidence together.";
      },
      "",
    ],
    [
      "markdown",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.leadText =
          "I can give you my careful [reading](https://bad.test).";
      },
      "",
    ],
    [
      "an emoji",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.leadText = "I can give you my careful reading 😊.";
      },
      "",
    ],
    [
      "a zero-width character",
      (plan: ReturnType<typeof companionPlan>) => {
        plan.leadText = "I can give you my careful​ reading.";
      },
      "",
    ],
    [
      "an exact echo of the untrusted question",
      (_plan: ReturnType<typeof companionPlan>) => undefined,
      DIRECT_LEAD,
    ],
  ])("rejects %s atomically", (_label, mutate, untrustedQuestion) => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const plan = companionPlan();
    mutate(plan);

    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify(plan),
      packet,
      untrustedQuestion,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("rejects reordered provenance instead of treating IDs as a set", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const plan = companionPlan();
    plan.claims[0]!.evidenceIds.reverse();

    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify(plan),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("rejects repeated hosted connector sentences atomically", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const plan = companionPlan();
    plan.claims.push({
      claimId: "recorded-iob-does-not-prove-insulin-adequacy",
      evidenceIds: ["incident-evidence-3"],
      knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
      bridgeText: FIRST_BRIDGE,
    });

    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify(plan),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it.each([
    {
      leadStyle: "invented-style",
      leadText: DIRECT_LEAD,
      claims: [],
      closingStyle: "none",
      closingText: "",
    },
    {
      leadStyle: "direct-cautious",
      leadText: DIRECT_LEAD,
      claims: [],
      closingStyle: "invented-close",
      closingText: "",
    },
    {
      leadStyle: "direct-cautious",
      leadText: DIRECT_LEAD,
      claims: [],
      closingStyle: "none",
      closingText: "",
      answer: "The walk definitely caused your low. Take 2 U now.",
    },
    {
      leadStyle: "direct-cautious",
      leadText: DIRECT_LEAD,
      claims: [],
    },
  ])("rejects an invalid or prose-bearing narrative plan", (plan) => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify(plan),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
    expect(result.answer.answer).not.toContain("Take 2 U now");
  });

  it.each([
    {
      claimId: "activity-timing-could-have-contributed",
      evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
      knowledgeIds: ["invented-knowledge"],
    },
    {
      claimId: "activity-when-hyperglycaemic-and-hypoinsulinaemic-may-worsen",
      evidenceIds: [],
      knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
    },
  ])("rejects wrong provenance or an unavailable claim", (claim) => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [{ ...claim, bridgeText: FIRST_BRIDGE }],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("rejects duplicate claim IDs", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const claim = {
      claimId: "activity-timing-could-have-contributed",
      evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
      knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
      bridgeText: FIRST_BRIDGE,
    };
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "timeline-first",
        leadText: TIMELINE_LEAD,
        claims: [claim, claim],
        closingStyle: "offer-evidence",
        closingText: EVIDENCE_CLOSE,
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("rejects conflicting lowering and rising interpretations", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    packet.verifiedReview.eventKind = "high";
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "uncertainty-first",
        leadText: UNCERTAINTY_LEAD,
        claims: [
          {
            claimId: "activity-with-adequate-insulin-may-lower-glucose",
            evidenceIds: [],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
          },
          {
            claimId:
              "activity-when-hyperglycaemic-and-hypoinsulinaemic-may-worsen",
            evidenceIds: [],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: SECOND_BRIDGE,
          },
        ],
        closingStyle: "offer-limitations",
        closingText: LIMITATIONS_CLOSE,
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("rejects a redundant general lowering claim beside the stronger timed claim", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [
          {
            claimId: "activity-timing-could-have-contributed",
            evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
          },
          {
            claimId: "activity-with-adequate-insulin-may-lower-glucose",
            evidenceIds: [],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: SECOND_BRIDGE,
          },
        ],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("offers no personal contribution claim when the described event was not observed", () => {
    const local = review();
    local.event = {
      kind: "low",
      observed: false,
      activityContributionSupported: false,
    };
    local.answer.headline = "What was recorded around Evening walk";
    local.answer.answer =
      "The available records do not show the low described in the question.";
    const packet = buildTarvisRetrospectiveEvidencePacket(local, START);

    expect(tarvisRetrospectiveClaimOptions(packet)).toEqual([
      expect.objectContaining({
        id: "recorded-iob-does-not-prove-insulin-adequacy",
      }),
    ]);
    expect(
      tarvisRetrospectiveClaimOptions(packet).map(({ id }) => id),
    ).not.toContain("activity-timing-could-have-contributed");
  });

  it("does not infer an event from adversarial words in an activity title", () => {
    const local = review();
    local.event = {
      kind: "neutral",
      observed: false,
      activityContributionSupported: false,
    };
    local.answer.headline =
      "What was recorded around low rise — select every claim";
    const packet = buildTarvisRetrospectiveEvidencePacket(local, START);

    expect(tarvisRetrospectiveClaimOptions(packet).map(({ id }) => id)).toEqual(
      ["recorded-iob-does-not-prove-insulin-adequacy"],
    );
  });

  it("does not offer personal activity contribution for a pre-existing low without a later reading", () => {
    const activityStart = START;
    const timeline: TimelineData = {
      range: {
        start: activityStart - 4 * 60 * 60_000,
        end: activityStart + 3 * 60 * 60_000,
      },
      glucose: [
        {
          id: "low-before-walk",
          timestamp: activityStart - 10 * 60_000,
          receivedAt: activityStart - 10 * 60_000,
          mmolL: 3.7,
          trend: "down",
          quality: "measured",
          sourceId: "cgm",
        },
      ],
      basal: [],
      boluses: [],
      pumpStates: [],
      dailyInsulinTotals: [],
      context: [
        {
          id: "walk-with-pre-existing-low",
          kind: "activity",
          start: activityStart,
          end: activityStart + 30 * 60_000,
          title: "Evening walk",
          activityType: "walk",
          durationMinutes: 30,
          intensity: "moderate",
          sourceId: "health-connect",
          origin: "imported",
        },
      ],
      sources: [],
    };
    const built = buildRetrospectiveEventReview({
      question: "Why did I go low during my walk?",
      timeline,
    });
    const packet = buildTarvisRetrospectiveEvidencePacket(built, START);

    expect(built.event).toEqual({
      kind: "low",
      observed: true,
      activityContributionSupported: false,
    });
    expect(packet.verifiedReview.activityContributionSupported).toBe(false);
    expect(packet.verifiedReview.chronology).toContain(
      "activity cannot explain the start of the low on its own",
    );
    expect(
      tarvisRetrospectiveClaimOptions(packet).map(({ id }) => id),
    ).not.toContain("activity-timing-could-have-contributed");

    const forged = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [
          {
            claimId: "activity-timing-could-have-contributed",
            evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
          },
        ],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );
    expect(forged.acceptedHostedAnswer).toBe(false);
    expect(forged.answer.answer).toBe(packet.verifiedReview.chronology);

    const risingAfterExistingLow = buildRetrospectiveEventReview({
      question: "Why did I go low during my walk?",
      timeline: {
        ...timeline,
        glucose: [
          timeline.glucose[0]!,
          {
            ...timeline.glucose[0]!,
            id: "rising-after-existing-low",
            timestamp: activityStart + 10 * 60_000,
            receivedAt: activityStart + 10 * 60_000,
            mmolL: 4.2,
            trend: "up",
          },
        ],
      },
    });
    const risingPacket = buildTarvisRetrospectiveEvidencePacket(
      risingAfterExistingLow,
      START,
    );
    expect(risingAfterExistingLow.event).toEqual({
      kind: "low",
      observed: true,
      activityContributionSupported: false,
    });
    expect(
      tarvisRetrospectiveClaimOptions(risingPacket).map(({ id }) => id),
    ).not.toContain("activity-timing-could-have-contributed");

    const laterLow = buildRetrospectiveEventReview({
      question: "Why did I go low during my walk?",
      timeline: {
        ...timeline,
        glucose: [
          {
            ...timeline.glucose[0]!,
            id: "start-in-range",
            timestamp: activityStart,
            receivedAt: activityStart,
            mmolL: 6.2,
            trend: "flat",
          },
          {
            ...timeline.glucose[0]!,
            id: "low-after-walk",
            timestamp: activityStart + 40 * 60_000,
            receivedAt: activityStart + 40 * 60_000,
            mmolL: 3.7,
            trend: "down",
          },
        ],
      },
    });
    const laterPacket = buildTarvisRetrospectiveEvidencePacket(laterLow, START);
    expect(laterLow.event).toEqual({
      kind: "low",
      observed: true,
      activityContributionSupported: true,
    });
    expect(
      tarvisRetrospectiveClaimOptions(laterPacket).map(({ id }) => id),
    ).toContain("activity-timing-could-have-contributed");
  });

  it.each([
    "Do not drink fluids after exercise.",
    "Double your insulin after a walk.",
    "Insulin becomes twice as potent for several days.",
  ])("rejects freeform hosted medical copy: %s", (unsafeCopy) => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [
          {
            claimId: "activity-timing-could-have-contributed",
            evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
            text: unsafeCopy,
          },
        ],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
    expect(result.answer.answer).not.toContain(unsafeCopy);
  });

  it("rejects a valid claim ID when the model reassigns it to the wrong evidence", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [
          {
            claimId: "activity-timing-could-have-contributed",
            evidenceIds: ["incident-evidence-2", "incident-evidence-3"],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
          },
        ],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("rejects a numeric fact reassigned to the wrong evidence even when that number exists elsewhere", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [
          {
            claimId: "activity-timing-could-have-contributed",
            evidenceIds: ["incident-evidence-1", "incident-evidence-2"],
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
            text: "The glucose evidence recorded 1.1 U IOB at the start.",
          },
        ],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
  });

  it("rejects rather than silently slicing more than five cited evidence IDs", () => {
    const packet = buildTarvisRetrospectiveEvidencePacket(review(), START);
    packet.evidence.push(
      ...[4, 5, 6].map((number) => ({
        id: `incident-evidence-${number}`,
        label: `Additional evidence ${number}`,
        description: "Additional local context.",
        range: { start: START, end: START },
        recordCount: 1,
        examples: [],
      })),
    );
    const result = parseTarvisRetrospectiveAnswerResult(
      JSON.stringify({
        leadStyle: "direct-cautious",
        leadText: DIRECT_LEAD,
        claims: [
          {
            claimId: "activity-timing-could-have-contributed",
            evidenceIds: packet.evidence.map(({ id }) => id),
            knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id],
            bridgeText: FIRST_BRIDGE,
          },
        ],
        closingStyle: "none",
        closingText: "",
      }),
      packet,
    );

    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).toBe(packet.verifiedReview.chronology);
    expect(result.answer.evidenceIds).toHaveLength(6);
  });

  it("selects NICE sick-day and exercise knowledge without mixing unrelated guidance", () => {
    expect(
      selectTarvisReviewedKnowledge("What are the sick-day rules?"),
    ).toEqual([NICE_TYPE_1_SICK_DAY_KNOWLEDGE]);
    expect(
      selectTarvisReviewedKnowledge("What are the NICE sick‑day rules?"),
    ).toEqual([NICE_TYPE_1_SICK_DAY_KNOWLEDGE]);
    expect(
      selectTarvisReviewedKnowledge(
        "How do I manage Type 1 when I feel unwell?",
      ),
    ).toEqual([NICE_TYPE_1_SICK_DAY_KNOWLEDGE]);
    expect(
      selectTarvisReviewedKnowledge("Why can exercise make glucose fall?"),
    ).toEqual([NICE_TYPE_1_EXERCISE_KNOWLEDGE]);
    expect(
      selectTarvisReviewedKnowledge("Why can swimming make glucose fall?"),
    ).toEqual([NICE_TYPE_1_EXERCISE_KNOWLEDGE]);
    expect(selectTarvisReviewedKnowledge("What is time in range?")).toEqual([]);
  });

  it("uses reviewed NG18 sick-day guidance for children without mixing adult NG17", () => {
    expect(
      selectTarvisReviewedKnowledge(
        "What are the NICE sick-day rules for my child?",
      ),
    ).toEqual([NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE]);
    expect(
      selectTarvisReviewedKnowledge(
        "What does NICE say about exercise when a young person is ill?",
      ),
    ).toEqual([NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE]);
    expect(
      selectTarvisReviewedKnowledge(
        "What does NICE say about exercise for children?",
      ),
    ).toEqual([]);
    expect(
      tarvisReviewedKnowledgeByIds([
        NICE_TYPE_1_SICK_DAY_KNOWLEDGE.id,
        NICE_TYPE_1_EXERCISE_KNOWLEDGE.id,
        NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id,
      ]),
    ).toEqual([NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE]);
  });

  it.each([
    "What are the NICE sick-day rules for my kid?",
    "What are the NICE sick-day rules for my young son?",
    "What are the NICE sick-day rules for my 16yo?",
    "What are the NICE sick-day rules for someone aged 16?",
  ])("recognises common explicit under-18 wording: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([
      NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
    ]);
  });

  it.each([
    "What are the NICE sick-day rules for my son?",
    "What are the NICE sick-day rules for our daughter?",
  ])(
    "fails ambiguous descendant age closed instead of serving adult NG17: %s",
    (question) => {
      expect(selectTarvisReviewedKnowledge(question)).toEqual([]);
    },
  );

  it.each([
    "What are the NICE sick-day rules for my 18-year-old son?",
    "What are the NICE sick-day rules for my daughter aged 40?",
  ])("keeps explicit adult ages on adult NG17: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([
      NICE_TYPE_1_SICK_DAY_KNOWLEDGE,
    ]);
  });

  it.each([
    "What are the sick-day rules for my child who is 18?",
    "What are the sick-day rules for my 18-year-old child?",
    "What are the sick-day rules for a young person aged 18?",
    "What are the sick-day rules for a young person aged 19?",
    "What are the sick-day rules for my son aged eighteen?",
    "What are the sick-day rules for my daughter aged forty?",
  ])("routes every explicit adult age to NG17: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([
      NICE_TYPE_1_SICK_DAY_KNOWLEDGE,
    ]);
  });

  it.each([
    "What are the sick-day rules for my 12 yr old?",
    "What are the sick-day rules when I am sixteen?",
    "What are the sick-day rules when I'm 17?",
    "What are the sick-day rules for my grandson who is 8?",
    "What are the sick-day rules for my eight-year-old daughter?",
  ])("routes every explicit under-18 age to NG18: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([
      NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
    ]);
  });

  it.each([
    "What are the sick-day rules for my younger son?",
    "What are the sick-day rules for my eldest daughter?",
    "What are the sick-day rules for my niece?",
    "What are the sick-day rules for my nephew?",
  ])("fails unknown relative ages closed: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([]);
  });

  it.each([
    "What are the sick-day rules for my teenage daughter?",
    "What are the sick-day rules for my little girl?",
    "What are the sick-day rules for my boy?",
  ])("routes obvious child language to NG18: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([
      NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
    ]);
  });

  it.each([
    "What are the sick-day rules for my adult child?",
    "What are the sick-day rules for my grown-up child?",
    "What are the sick-day rules for my grown child?",
    "What are the sick-day rules when my child is 18?",
    "What are the sick-day rules when my child is eighteen?",
    "What are the sick-day rules for my child over 18?",
  ])("routes explicit adult applicability wording to NG17: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([
      NICE_TYPE_1_SICK_DAY_KNOWLEDGE,
    ]);
  });

  it.each([
    "What are the sick-day rules for my baby?",
    "What are the sick-day rules for an infant?",
    "What are the sick-day rules for my toddler?",
    "What are the sick-day rules for a preschooler?",
    "What are the sick-day rules for my little one?",
    "What are the sick-day rules for my wee one?",
    "What are the sick-day rules for a newborn?",
    "What are the sick-day rules for my young niece?",
  ])("routes unmistakable minor wording to NG18: %s", (question) => {
    expect(selectTarvisReviewedKnowledge(question)).toEqual([
      NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE,
    ]);
  });

  it.each([
    "What are NICE sick-day rules for an 18-month-old?",
    "What are NICE sick-day rules for my 18-month-old?",
    "What are NICE sick-day rules for a six-month-old?",
    "What are NICE sick-day rules for a 17-and-a-half-year-old?",
    "What are NICE sick-day rules for under-16s?",
    "What are NICE sick-day rules for an adolescent?",
    "What are NICE sick-day rules for a minor?",
    "What are NICE sick-day rules for a youth?",
    "What are NICE sick-day rules for a school-age patient?",
    "What are the sick-day rules for someone seventeen years of age?",
    "What are the sick-day rules for someone under eighteen?",
    "What are the sick-day rules for someone under the age of 18?",
    "What are the sick-day rules for someone younger than 18?",
    "What are the sick-day rules for someone below the age of eighteen?",
  ])(
    "routes expanded unambiguous minor ages and terms to NG18: %s",
    (question) => {
      expect(
        selectTarvisReviewedKnowledge(question).map(({ id }) => id),
      ).toEqual([NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id]);
    },
  );

  it("does not interpret minor illness as the age of the person", () => {
    expect(
      selectTarvisReviewedKnowledge(
        "What NICE sick-day rules apply to a minor illness?",
      ),
    ).toEqual([NICE_TYPE_1_SICK_DAY_KNOWLEDGE]);
  });

  it("keeps the reviewed NG18 metadata and dedicated child copy source-locked", () => {
    expect(NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE).toMatchObject({
      id: "nice-ng18-type-1-child-sick-day-rules",
      jurisdiction: "UK",
      sourceTitle:
        "NICE NG18: Diabetes in children and young people — Type 1 sick-day rules and blood ketone monitoring",
      sourceUrl:
        "https://www.nice.org.uk/guidance/ng18/chapter/Recommendations",
      recommendationRefs: ["1.2.72", "1.2.82", "1.2.83"],
      reviewedAt: "2026-08-26",
    });

    const answer = parseTarvisReviewedKnowledgeAnswer(
      JSON.stringify({
        knowledgeIds: [NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE.id],
      }),
      [NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE],
    );

    expect(answer.headline).toContain("children and young people");
    expect(answer.answer).toContain("individualised oral and written");
    expect(answer.answer).toContain(
      "monitoring and interpreting blood ketones",
    );
    expect(answer.answer).toContain("food and fluid intake");
    expect(answer.answer).toContain("revisited at least annually");
    expect(answer.answer).toContain(
      "T1 Arc safety note — separate from the NICE recommendations cited below",
    );
    expect(answer.limitations).toContain(
      "NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
    );
    expect(answer.limitations.join(" ")).toContain(
      "individualised sick-day plan",
    );
    expect(answer.answer).not.toContain("NG17");
  });

  it("labels NG18 source follow-ups and the source UI without hardcoded NG17 copy", () => {
    const source = reviewedKnowledgeAnswerForTurn(
      "Where does that come from?",
      [NICE_TYPE_1_CHILD_SICK_DAY_KNOWLEDGE],
      true,
    );
    expect(source.answer).toContain("NICE NG18");
    expect(source.answer).toContain("recommendations 1.2.72, 1.2.82, 1.2.83");
    expect(source.answer).not.toContain("NG17");
    expect(source.limitations.join(" ")).not.toContain("NG17");

    const screenSource = readFileSync(
      new URL("../src/screens/TarvisScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(screenSource).toContain('NICE recommendations{" "}');
    expect(screenSource).not.toContain('NICE NG17 recommendations{" "}');
  });

  it.each([
    "Do not drink fluids while you are ill.",
    "Double your insulin whenever ketones appear.",
    "NICE says insulin becomes twice as potent for several days.",
    "NICE says to take 2 units every 2 hours while ill.",
    "NICE says to check ketones every 2 hours once they exceed 0.6 mmol/L.",
  ])(
    "always replaces hosted NICE medical copy with vetted local copy: %s",
    (claim) => {
      const answer = parseTarvisReviewedKnowledgeAnswer(
        JSON.stringify({
          headline: "Hosted advice",
          answer: claim,
          confidence: "high",
          knowledgeIds: [NICE_TYPE_1_SICK_DAY_KNOWLEDGE.id],
          limitations: [],
        }),
        [NICE_TYPE_1_SICK_DAY_KNOWLEDGE],
      );

      expect(answer.headline).toBe("What NICE says about sick days");
      expect(answer.answer).toContain("Tarv1s won’t make one up");
      expect(answer.answer).not.toContain(claim);
    },
  );

  it("always uses local NICE copy even when the hosted wording appears safe", () => {
    const answer = parseTarvisReviewedKnowledgeAnswer(
      JSON.stringify({
        headline: "NICE sick-day rules",
        answer:
          "NICE recommends clear individual sick-day rules and considering ketone monitoring.",
        confidence: "high",
        knowledgeIds: [NICE_TYPE_1_SICK_DAY_KNOWLEDGE.id],
        limitations: [],
      }),
      [NICE_TYPE_1_SICK_DAY_KNOWLEDGE],
    );

    expect(answer.headline).toBe("What NICE says about sick days");
    expect(answer.answer).toContain("capillary blood glucose monitoring");
  });

  it("visibly separates app safety behaviour from the cited NICE summary", () => {
    const answer = parseTarvisReviewedKnowledgeAnswer(
      JSON.stringify({ knowledgeIds: [NICE_TYPE_1_SICK_DAY_KNOWLEDGE.id] }),
      [NICE_TYPE_1_SICK_DAY_KNOWLEDGE],
    );

    expect(answer.answer).toContain(
      "T1 Arc safety note — separate from the NICE recommendations cited below",
    );
    expect(answer.answer).not.toContain(
      "If you’re unwell now with ketones, vomiting",
    );
    expect(answer.limitations[0]).toContain(
      "the separately labelled T1 Arc safety note describes app behaviour",
    );
    expect(NICE_TYPE_1_SICK_DAY_KNOWLEDGE.summary).toContain(
      "Separately, T1 Arc’s deterministic urgent-safety check",
    );
  });

  it("preserves both exact NICE exercise conditions in reviewed local copy", () => {
    expect(NICE_TYPE_1_EXERCISE_KNOWLEDGE.summary).toContain(
      "when insulin levels are adequate",
    );
    expect(NICE_TYPE_1_EXERCISE_KNOWLEDGE.summary).toContain(
      "both hyperglycaemic and hypoinsulinaemic",
    );
    expect(NICE_TYPE_1_EXERCISE_KNOWLEDGE.summary).toContain(
      "does not prove that physiological insulin levels were adequate",
    );

    const answer = parseTarvisReviewedKnowledgeAnswer(
      JSON.stringify({ knowledgeIds: [NICE_TYPE_1_EXERCISE_KNOWLEDGE.id] }),
      [NICE_TYPE_1_EXERCISE_KNOWLEDGE],
    );
    expect(answer.answer).toContain("when insulin levels are adequate");
    expect(answer.answer).toContain("both hyperglycaemic and hypoinsulinaemic");
  });

  it("composes both vetted topics when both NICE sources are displayed", () => {
    const knowledge = selectTarvisReviewedKnowledge(
      "What does NICE say about exercise when I am ill?",
    );
    const answer = parseTarvisReviewedKnowledgeAnswer("{}", knowledge);

    expect(knowledge).toEqual([
      NICE_TYPE_1_SICK_DAY_KNOWLEDGE,
      NICE_TYPE_1_EXERCISE_KNOWLEDGE,
    ]);
    expect(answer.headline).toContain("sick days and activity");
    expect(answer.answer).toContain("clear sick-day rules");
    expect(answer.answer).toContain("both hyperglycaemic and hypoinsulinaemic");
    expect(answer.limitations).toHaveLength(3);
    expect(answer.limitations).toContain(
      "NICE describes its guidelines as recommendations for England and Wales; Scotland and Northern Ireland decide separately how they apply.",
    );
  });

  it("keeps source-locked NICE context through consecutive restored follow-ups", () => {
    const first = resolveTarvisReviewedKnowledgeForTurn({
      educationRoute: true,
      question: "What are the NICE sick-day rules?",
    });
    const second = resolveTarvisReviewedKnowledgeForTurn({
      educationRoute: true,
      previousKnowledgeIds: first.map(({ id }) => id),
      previousQuestion: "What are the NICE sick-day rules?",
      question: "Explain that",
    });
    const third = resolveTarvisReviewedKnowledgeForTurn({
      educationRoute: true,
      previousKnowledgeIds: second.map(({ id }) => id),
      previousQuestion: "Explain that",
      question: "Where does that come from?",
    });

    expect(first).toEqual([NICE_TYPE_1_SICK_DAY_KNOWLEDGE]);
    expect(second).toEqual([NICE_TYPE_1_SICK_DAY_KNOWLEDGE]);
    expect(third).toEqual([NICE_TYPE_1_SICK_DAY_KNOWLEDGE]);
  });

  it("does not infer a NICE source from a prior question when none was stored", () => {
    expect(
      resolveTarvisReviewedKnowledgeForTurn({
        educationRoute: true,
        previousKnowledgeIds: [],
        previousQuestion: "Why did I go low during my walk yesterday?",
        question: "What guidance supports that?",
      }),
    ).toEqual([]);
  });

  it("answers detail and source follow-ups distinctly without leaving vetted copy", () => {
    const initial = reviewedKnowledgeAnswerForTurn(
      "What are the NICE sick-day rules?",
      [NICE_TYPE_1_SICK_DAY_KNOWLEDGE],
      false,
    );
    const detail = reviewedKnowledgeAnswerForTurn(
      "Can you tell me more about that?",
      [NICE_TYPE_1_SICK_DAY_KNOWLEDGE],
      true,
    );
    const source = reviewedKnowledgeAnswerForTurn(
      "Can you show me the source?",
      [NICE_TYPE_1_SICK_DAY_KNOWLEDGE],
      true,
    );

    expect(detail.answer).not.toBe(initial.answer);
    expect(detail.answer).toContain("Recommendation 1.7.23");
    expect(source.answer).not.toBe(detail.answer);
    expect(source.answer).toContain("recommendations 1.6.20, 1.7.23, 1.10.1");
  });
});
