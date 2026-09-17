import { describe, expect, it } from "vitest";

import {
  modelSafeTarvisHistory,
  tarvisConversationTurnsForExchange,
} from "@/data/tarvis/modelConversationPrivacy";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

const NOW = Date.parse("2026-08-25T08:00:00+01:00");

describe("Tarv1s hosted model history privacy", () => {
  it("keeps a local retrospective value, time, and source private even when no IOB evidence was found", () => {
    const secretValue = "1.25 U IOB";
    const secretTime = "19:15";
    const secretSource = "Omnipod 5";
    const history = tarvisConversationTurnsForExchange({
      answer: `At ${secretTime}, T1 Arc captured a ${secretSource} notification reporting ${secretValue}.`,
      answerSource: "local",
      headline: "Recorded low around Outdoor walk",
      question: `Why did ${secretSource} show ${secretValue} at ${secretTime}?`,
    });

    const plan = coordinateTarvisRequest({
      question: "Can you explain that?",
      asOf: NOW,
      conversationHistory: history,
    });

    expect(plan.kind).toBe("model-education");
    if (plan.kind !== "model-education") {
      throw new Error("Expected educational follow-up route");
    }
    const hostedHistory = JSON.stringify(plan.history);
    expect(hostedHistory).not.toContain(secretValue);
    expect(hostedHistory).not.toContain(secretTime);
    expect(hostedHistory).not.toContain(secretSource);
    expect(hostedHistory).not.toContain("notification-observation");
    expect(hostedHistory).toContain("not shared with the hosted model");
  });

  it("retains ordinary non-private context for a dependent educational follow-up", () => {
    const history = tarvisConversationTurnsForExchange({
      answer: "Insulin on board is an estimate of active insulin.",
      answerSource: "hosted",
      headline: "Insulin on board",
      question: "What does insulin on board mean?",
    });
    const plan = coordinateTarvisRequest({
      question: "Can you explain that?",
      asOf: NOW,
      conversationHistory: history,
    });
    expect(plan.kind).toBe("model-education");
    if (plan.kind !== "model-education")
      throw new Error("Expected model route");
    expect(JSON.stringify(plan.history)).toContain(
      "Insulin on board is an estimate of active insulin.",
    );
  });

  it("replaces a hosted exchange marked local-only with placeholders", () => {
    const privateQuestion = "Why was my glucose 3.4 mmol/L at 02:17?";
    const privateAnswer =
      "The local chronology linked that reading to a private insulin record.";
    const history = tarvisConversationTurnsForExchange({
      answer: privateAnswer,
      answerSource: "hosted",
      headline: "Private retrospective",
      modelSharing: "local-only",
      question: privateQuestion,
    });

    expect(
      history.every(({ modelSharing }) => modelSharing === "local-only"),
    ).toBe(true);
    expect(modelSafeTarvisHistory(history)).toEqual([
      {
        role: "user",
        text: "A previous user question belonged to a local private-data review and is not shared with the hosted model.",
      },
      {
        role: "assistant",
        text: "A previous answer was calculated locally from private health records and is not shared with the hosted model.",
      },
    ]);

    const plan = coordinateTarvisRequest({
      question: "Can you explain that?",
      asOf: NOW,
      conversationHistory: history,
    });
    expect(JSON.stringify(plan)).not.toContain(privateQuestion);
    expect(JSON.stringify(plan)).not.toContain(privateAnswer);
    expect(JSON.stringify(plan)).not.toContain("3.4 mmol/L");
  });

  it("keeps a verified local fallback private even when a hosted request was attempted", () => {
    const history = modelSafeTarvisHistory(
      tarvisConversationTurnsForExchange({
        answer: "The private local chronology contained 4.2 mmol/L at 21:15.",
        answerSource: "local",
        headline: "Verified local fallback",
        question: "Why did I go low after my private evening walk?",
      }),
    );

    expect(JSON.stringify(history)).not.toContain("4.2 mmol/L");
    expect(JSON.stringify(history)).not.toContain("private evening walk");
    expect(JSON.stringify(history)).toContain(
      "not shared with the hosted model",
    );
  });
});
