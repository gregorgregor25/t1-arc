import { describe, expect, it } from "vitest";

import { resolveTarvisIntent } from "@/data/tarvis/intent";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

const AS_OF = Date.parse("2026-09-07T12:00:00+01:00");
const PHONE_QUESTIONS = [
  "Compare my low glucose episodes over the last 7 days with the previous 7 days. What patterns do my food, insulin, activity and sleep records suggest?",
  "Review my low glucose episodes over the last 14 days. Look at my meals, insulin, exercise and sleep, and explain which patterns the records actually support.",
];

describe("Tarv1s real-phone multi-source question regressions", () => {
  it.each(PHONE_QUESTIONS)("preserves the explicit period: %s", (question) => {
    const resolution = resolveTarvisIntent(question, {
      now: AS_OF,
      timezone: "Europe/London",
    });
    expect(resolution.intent.temporalScope, JSON.stringify(resolution)).toBeDefined();
  });

  it.each(PHONE_QUESTIONS)("plans a bounded evidence review: %s", (question) => {
    const request = coordinateTarvisRequest({ question, asOf: AS_OF });
    expect(request.kind, JSON.stringify(request)).toBe("model-evidence");
    if (request.kind !== "model-evidence") throw new Error("Expected period evidence");
    expect(request.evidenceRanges).toBeDefined();
    expect(request.episodeReviewKind).toBe("low");
    expect(request.evidenceRanges?.current.end).toBe(AS_OF);
  });

  it("uses the exact two seven-day periods, not the current Insights selection", () => {
    const request = coordinateTarvisRequest({ question: PHONE_QUESTIONS[0]!, asOf: AS_OF });
    expect(request).toMatchObject({
      kind: "model-evidence",
      evidenceRanges: {
        current: { start: Date.parse("2026-09-01T00:00:00+01:00"), end: AS_OF },
        previous: { start: Date.parse("2026-08-25T00:00:00+01:00"), end: Date.parse("2026-09-01T00:00:00+01:00") },
      },
    });
  });

  it.each([
    "Review my low glucose episodes over the past 7 days. What patterns do my meals and sleep suggest?",
    "Review my high glucose episodes over the last 14 days. Look at my meals and insulin.",
    "What patterns do my low glucose episodes and activity show last week?",
  ])("reviews the complete requested period rather than one selected incident: %s", (question) => {
    expect(coordinateTarvisRequest({ question, asOf: AS_OF }).kind).toBe("model-evidence");
  });

  it.each([
    "Review my low glucose episodes on 2 September after dinner. Look at my meals.",
    "Review my low glucose episodes at my meals over the last 14 days.",
    "Review my low glucose episodes over the last 7 days and previous 14 days.",
    "Review my low glucose episodes between 2 and 4 over the last 14 days.",
  ])("does not erase a genuine ambiguous filter: %s", (question) => {
    const resolution = resolveTarvisIntent(question, { now: AS_OF, timezone: "Europe/London" });
    expect(resolution.outcome.status).not.toBe("ready");
    const request = coordinateTarvisRequest({ question, asOf: AS_OF });
    expect(request.kind, JSON.stringify(request)).toBe("answer");
  });

  it.each([
    "How many low glucose episodes did I have over the last 7 days?",
    "Compare my low glucose episodes over the last 7 days with the previous 7 days.",
  ])("keeps exact counts on device: %s", (question) => {
    expect(coordinateTarvisRequest({ question, asOf: AS_OF }).kind).toBe("scoped-glucose");
  });
});

describe("Tarv1s open health-question remit", () => {
  it.each([
    "Can you explain that more simply?",
    "Explain it in plain English.",
    "Could you simplify that?",
    "Make it shorter.",
  ])("keeps the immediate explanation for a natural follow-up: %s", (question) => {
    const history = [
      { role: "user" as const, text: "An older unrelated question" },
      { role: "assistant" as const, text: "An older answer" },
      { role: "user" as const, text: "Explain HbA1c in plain English." },
      { role: "assistant" as const, text: "HbA1c reflects glycated haemoglobin." },
    ];
    expect(coordinateTarvisRequest({ question, asOf: AS_OF, conversationHistory: history }))
      .toMatchObject({ kind: "model-education", history: history.slice(-2) });
  });
  it.each([
    "What is the glycaemic index?",
    "Tell me about soluble fibre and digestion.",
    "How can menopause affect type 1 diabetes?",
    "Why does my glucose sometimes rise when I eat pizza?",
    "How does poor sleep affect appetite?",
    "What is the difference between aerobic and resistance training?",
    "Explain HbA1c in plain English.",
    "What is diabetes burnout?",
    "Tell me about depression.",
    "How can travelling to another country affect diabetes routines?",
    "How does hot weather affect glucose?",
  ])("allows general education without records or dates: %s", (question) => {
    const request = coordinateTarvisRequest({ question, asOf: AS_OF });
    expect(request, JSON.stringify(request)).toMatchObject({
      kind: "model-education",
      history: [],
    });
    expect(request).not.toHaveProperty("evidenceRanges");
  });
});
