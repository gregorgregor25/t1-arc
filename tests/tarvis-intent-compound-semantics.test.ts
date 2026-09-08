import { describe, expect, it } from "vitest";

import { resolveTarvisCompoundIntents, resolveTarvisIntent, validateTarvisIntentV1 } from "@/data/tarvis/intent";
import { resolveTarvisEvidenceRangeRequest } from "@/data/tarvis/evidenceRange";
import { dayRange } from "@/domain/time";

const NOW = Date.parse("2026-09-08T12:00:00+01:00");
const resolve = (question: string) => resolveTarvisIntent(question, {
  now: NOW, timezone: "Europe/London",
});

describe("validated single-metric plans for supported compound drafts", () => {
  const compound = (question: string) => resolveTarvisCompoundIntents(resolve(question), {
    now: NOW, timezone: "Europe/London",
  });

  it.each([
    "Hey. What was my average glucose over the last 7 days compared the previous 7 days? And how many periods of low sugar did I have in the last 7 days compared to the previous 7 days?",
    "Compare my mean glucose and number of low blood sugar periods over the last three days with the previous three days.",
    "Over the last 14 days, what was my average glucose and how many spells of low glucose did I have compared with the previous 14 days?",
  ])("validates both glucose operations, not a first-metric fallback: %s", (question) => {
    const intents = compound(question);
    expect(intents).toHaveLength(2);
    expect(intents?.map(({ operation }) => operation.value)).toEqual(["aggregate", "count_episodes"]);
    expect(intents?.every((intent) => validateTarvisIntentV1(intent).valid)).toBe(true);
    expect(intents?.[0]?.thresholds).toEqual([]);
    expect(intents?.[1]?.thresholds[0]?.value).toEqual({ role: "low", operator: "lt", unit: "mmol/L", value: 3.9 });
    expect(intents?.every(({ comparison }) => comparison?.value.kind === "previous_equal_period")).toBe(true);
  });

  it.each([
    "How many carbohydrates did I log yesterday versus how much bolus insulin I took?",
    "Yesterday, compare total carbohydrates with total bolus insulin.",
    "Compare my total carbs and my total bolus insulin yesterday.",
    "Show my total carbs and how many high episodes I had yesterday.",
    "Show my time in range and low episodes yesterday.",
  ])("returns complete individually validated same-scope metric plans: %s", (question) => {
    const intents = compound(question);
    expect(intents).toHaveLength(2);
    expect(intents?.every((intent) => validateTarvisIntentV1(intent).valid)).toBe(true);
    expect(intents?.every(({ temporalScope }) => temporalScope.value.kind === "calendar_period" && temporalScope.value.period === "yesterday")).toBe(true);
    expect(intents?.every(({ comparison }) => comparison === null)).toBe(true);
  });

  it("retains the configured glucose profile separately from non-threshold metrics", () => {
    const options = { now: NOW, timezone: "Europe/London", targetProfile: { id: "personal", unit: "mg/dL" as const, lowBelow: 75, highAbove: 190 } };
    const resolution = resolveTarvisIntent("My mean glucose and low blood sugar episodes yesterday", options);
    const intents = resolveTarvisCompoundIntents(resolution, options);
    expect(resolution.intent.thresholds[0]?.provenance.kind).toBe("profile");
    expect(intents?.[0]?.thresholds).toEqual([]);
    expect(intents?.[1]?.thresholds[0]?.value).toEqual({ role: "low", operator: "lt", unit: "mg/dL", value: 75 });
    expect(intents?.[1]?.thresholds[0]?.provenance.sourceText).toBe("personal");
    const preserved = resolveTarvisCompoundIntents(resolution, { now: NOW, timezone: "Europe/London" });
    expect(preserved?.[1]?.thresholds).toEqual(intents?.[1]?.thresholds);
  });

  it("retains an explicit bound attached to its sole matching metric", () => {
    const intents = compound("What was my average glucose and how many low episodes below 3.5 mmol/L did I have yesterday?");
    expect(intents).toHaveLength(2);
    expect(intents?.[0]?.thresholds).toEqual([]);
    expect(intents?.[1]?.thresholds[0]?.value).toEqual({ role: "low", operator: "lt", unit: "mmol/L", value: 3.5 });
    expect(intents?.[1]?.thresholds[0]?.provenance.kind).toBe("explicit");
  });

  it.each([
    "Show the percentage change in my average glucose and low episodes over the last 7 days compared with the previous 7 days.",
    "Give the percent difference in my mean glucose and low episodes over the last three days compared with the previous three days.",
    "Show the % change in my average glucose and low episodes over the last 7 days compared with the previous 7 days.",
    "Give the change in percent for my average glucose and low episodes over the last 7 days compared with the previous 7 days.",
    "By what percentage did my average glucose and low episodes change over the last 7 days compared with the previous 7 days?",
    "Show my time in range and low episodes over the last 7 days compared with the previous 7 days, including percentage point changes.",
    "Calculate the delta for my mean glucose and low episodes over the last 7 days compared with the previous 7 days.",
    "Show the ratio of total carbs to total bolus insulin yesterday.",
    "What was the rate of low episodes and my average glucose yesterday?",
    "Show the difference in my average glucose and low episodes over the last 7 days compared with the previous 7 days.",
    "Give the absolute change in my average glucose and low episodes over the last 7 days compared with the previous 7 days.",
    "What was the amount of change in my average glucose and low episodes over the last 7 days compared with the previous 7 days?",
    "How much did my average glucose and low episodes change over the last 7 days compared with the previous 7 days?",
    "How much higher were my average glucose and low episodes over the last 7 days compared with the previous 7 days?",
  ])("does not substitute paired values for a requested derived statistic: %s", (question) => {
    // The base parser still retains the requested metrics and exact scope;
    // only the bounded local compound adapter declines the extra operation.
    expect(resolve(question).outcome.code).toBe("unsupported_compound_question");
    expect(compound(question)).toBeNull();
  });

  it.each([
    "Compare my average glucose and low episodes over the last 7 days with the previous 7 days.",
    "How did my average glucose and low episodes compare over the last 7 days with the previous 7 days?",
    "Compare my time in range percentage and low episodes yesterday with the previous period.",
    "How many carbohydrates did I log yesterday versus how much bolus insulin I took?",
  ])("keeps ordinary paired values and percentage-valued metrics available: %s", (question) => {
    expect(compound(question)).toHaveLength(2);
  });

  it.each([
    "Compare my average glucose over the last 7 days with the previous 7 days.",
    "Show the percentage change in my average glucose over the last 7 days compared with the previous 7 days.",
    "What was the difference in low episodes over the last 7 days compared with the previous 7 days?",
  ])("does not alter an existing ready single-metric comparison: %s", (question) => {
    const resolution = resolve(question);
    expect(resolution.outcome.code).toBe("ready");
    expect(resolution.intent.metrics).toHaveLength(1);
    expect(resolution.intent.comparison?.value).toEqual({ kind: "previous_equal_period" });
    expect(resolveTarvisCompoundIntents(resolution)).toBeNull();
  });

  it.each([
    "What was my average glucose and how many low episodes above 3.5 mmol/L did I have yesterday?",
    "What was my average glucose below 3.5 mmol/L and how many low episodes did I have yesterday?",
    "What was my average glucose and how many low episodes below 3.5 and below 3.0 mmol/L did I have yesterday?",
    "What was my average glucose and how many low episodes lasting 10 minutes did I have yesterday?",
    "Compare total carbs yesterday versus total bolus insulin today.",
    "Compare total carbs and total bolus insulin over the last 7 days versus 2 weeks ago.",
    "What was my mean glucose over the last 7 days and low episodes 2 weeks ago?",
    "Compare my average glucose over the last 7 days with the previous 7 days and low sugar periods over the last 14 days with the previous 14 days.",
    "Compare my average glucose over the last 7 days with the previous 7 days and low episodes over the last 7 days.",
    "What was my mean glucose and low episodes yesterday after breakfast?",
    "What was my mean glucose and low episodes yesterday excluding manual readings?",
    "What was my mean glucose and low periods of sensor coverage yesterday?",
    "What was my mean glucose and low episodes per day yesterday?",
    "What was my mean glucose and low episodes yesterday between 2 and 4?",
    "What was my mean glucose and low episodes yesterday between 2am and 4am?",
    "What was my mean glucose and low episodes yesterday, and when was my minimum glucose?",
    "Explain why my mean glucose and low episodes changed yesterday.",
    "What is my current glucose and how many low episodes did I have yesterday?",
    "What was my average glucose yesterday?",
  ])("declines incomplete, conditioned or differently scoped plans: %s", (question) => {
    expect(compound(question)).toBeNull();
  });
});

describe("Tarv1s compound metric and comparison semantics", () => {
  it.each([
    "Hey. What was my average glucose over the last 7 days compared the previous 7 days? And how many periods of low sugar did I have in the last 7 days compared to the previous 7 days?",
    "Compare my mean glucose and number of low blood sugar periods over the last three days with the previous three days.",
    "Over the last 14 days, what was my average glucose and how many spells of low glucose did I have compared with the previous 14 days?",
    "How many bouts of hypoglycaemia did I have over the last seven days? Also show my average glucose for the last seven days versus the previous seven days.",
  ])("retains both the average and explicitly requested low episodes: %s", (question) => {
    const result = resolve(question);
    expect(result.intent.metrics.map(({ value }) => value)).toEqual(expect.arrayContaining([
      "glucose.mean", "glucose.low_episodes",
    ]));
    expect(result.intent.metrics).toHaveLength(2);
    expect(result.outcome.code).toBe("unsupported_compound_question");
    expect(result.intent.comparison?.value).toEqual({ kind: "previous_equal_period" });
    expect(resolveTarvisEvidenceRangeRequest(result, NOW).kind).toBe("resolved");
  });

  it.each([
    ["How many periods of low sugar did I have yesterday?", "glucose.low_episodes"],
    ["Count my low blood glucose episodes yesterday.", "glucose.low_episodes"],
    ["How many spells of high blood sugar did I have yesterday?", "glucose.high_episodes"],
    ["What was the number of hyperglycaemic periods yesterday?", "glucose.high_episodes"],
  ])("preserves episode direction without inventing the opposite metric: %s", (question, metric) => {
    const result = resolve(question);
    expect(result.intent.metrics.map(({ value }) => value)).toEqual([metric]);
    expect(result.outcome.status).toBe("ready");
  });

  it.each([
    "How many carbohydrates did I log yesterday versus how much bolus insulin I took?",
    "Yesterday, compare total carbohydrates with total bolus insulin.",
    "How much bolus insulin did I take yesterday compared with how many carbs did I log?",
    "Compare my total carbs and my total bolus insulin yesterday.",
    "How many carbs did I record yesterday vs how much bolus insulin did I use yesterday?",
  ])("compares two reported metrics within yesterday, not two periods: %s", (question) => {
    const result = resolve(question);
    expect(result.intent.metrics.map(({ value }) => value)).toEqual(expect.arrayContaining([
      "food.carbohydrate_total", "insulin.bolus_total",
    ]));
    expect(result.intent.metrics).toHaveLength(2);
    expect(result.intent.temporalScope?.value).toEqual({ kind: "calendar_period", period: "yesterday" });
    expect(result.intent.comparison).toBeFalsy();
    expect(result.outcome.code).toBe("unsupported_compound_question");
    expect(resolveTarvisEvidenceRangeRequest(result, NOW)).toEqual({
      kind: "resolved",
      ranges: { current: dayRange("2026-09-07", NOW), previous: dayRange("2026-09-06", NOW) },
    });
  });

  it.each([
    "Compare total carbs yesterday versus total bolus insulin today.",
    "Compare total carbs and total bolus insulin over the last 7 days versus 2 weeks ago.",
    "Compare total carbs and total bolus insulin over the last 7 days with last month.",
    "Compare total carbs on 1 September versus total bolus insulin on 4 September.",
    "Compare my average glucose over the last 7 days with the previous 7 days and low sugar periods over the last 14 days with the previous 14 days.",
    "Compare my mean glucose over the past 7 days with the previous 7 days and low episodes over the last 7 days with the previous 7 days.",
    "Compare my mean glucose today, over the last 1 day, with the previous 1 day and low episodes over the last 7 days with the previous 7 days.",
  ])("does not erase a genuinely different or unresolved comparison period: %s", (question) => {
    expect(resolveTarvisEvidenceRangeRequest(resolve(question), NOW).kind).toBe("unsupported");
  });

  it.each([
    "What was my average glucose yesterday, during periods of low sugar?",
    "What was my average glucose yesterday, excluding low blood sugar periods?",
    "What was my average glucose in low periods of sensor coverage yesterday?",
  ])("does not turn a filter or unrelated low period into an executable compound: %s", (question) => {
    expect(resolve(question).outcome.status).not.toBe("ready");
  });
});
