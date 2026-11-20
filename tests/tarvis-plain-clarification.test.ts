import { describe, expect, it } from "vitest";

import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

// A synthetic Tuesday evening in London.
const NOW = Date.parse("2030-04-16T19:00:00+01:00");

// Words from the resolver's internals that must never reach the person.
const JARGON =
  /executable|inherited|silently|represented by|foundation|\bscope\b|recurring window|metric was stated|non-equivalent|schema|intent|domain|operation/i;

// Questions the phone answers itself with a clarification or a "can't do
// that yet" reply. None of them may contain internal terms.
const QUESTIONS = [
  "What was my glucose at 07:10?",
  "What was my average glucose around 7?",
  "Compare my average glucose on Monday, Tuesday and Wednesday",
  "Average glucose on weekdays last month",
  "What was my average glucose today and yesterday?",
  "Average glucose in the last 3 days and last 10 days",
  "Average glucose today excluding the readings from the sensor warm-up",
  "Average glucose after lunch",
  "What was my time in range in the evening yesterday?",
  "Average glucose at night this week",
  "Average glucose from 5 to 7 yesterday",
  "Average glucose between 08:00 and 08:00 yesterday",
  "Average glucose from 3 March to 1 March",
  "Average glucose over the last 2 months",
  "Average glucose over the completed last 2 weeks",
  "How many lows below 3.9 and below 3.0 last week?",
  "What were my average glucose and carbs per meal yesterday?",
  "Compare my average glucose this week with March",
  "Not the average, just glucose today",
  "Average glucose for the past 0 days",
];

function replyText(question: string) {
  const plan = coordinateTarvisRequest({ question, asOf: NOW });
  if (plan.kind !== "answer") return undefined;
  const { headline, answer, limitations } = plan.answer;
  return [headline, answer, ...limitations].join(" ");
}

describe("Tarv1s clarification and capability replies use plain words", () => {
  it.each(QUESTIONS)("has no internal terms: %s", (question) => {
    const resolution = resolveTarvisIntent(question, {
      now: NOW,
      timezone: "Europe/London",
    });
    if (!isReadyTarvisIntent(resolution)) {
      const outcome = resolution.outcome;
      const text = [
        "message" in outcome ? outcome.message : "",
        "clarification" in outcome ? outcome.clarification : "",
      ].join(" ");
      expect(text).not.toMatch(JARGON);
    }
    const reply = replyText(question);
    if (reply !== undefined) expect(reply).not.toMatch(JARGON);
  });

  it("asks for a start and an end for a single clock time, with an example", () => {
    const reply = replyText("What was my average glucose at 07:10 today?");
    expect(reply).toBeDefined();
    expect(reply).toMatch(/start and an end/);
    expect(reply).toMatch(/for example/);
  });

  it("explains a several-period comparison in one plain question", () => {
    const resolution = resolveTarvisIntent(
      "Compare my average glucose today, yesterday and last week",
      { now: NOW, timezone: "Europe/London" },
    );
    expect(isReadyTarvisIntent(resolution)).toBe(false);
    if (!isReadyTarvisIntent(resolution)) {
      const outcome = resolution.outcome;
      expect("message" in outcome ? outcome.message : "").toMatch(
        /more than one period/i,
      );
    }
  });

  it("never asks two questions in a row", () => {
    for (const question of QUESTIONS) {
      const reply = replyText(question);
      if (reply === undefined) continue;
      expect(reply).not.toMatch(/\?\s+[^.!]*\?/);
    }
  });
});
