import { describe, expect, it } from "vitest";

import { createDemoRepository } from "@/data/demoRepository";
import {
  isReadyTarvisIntent,
  resolveTarvisIntent,
  type TarvisIntentHistoryEntry,
} from "@/data/tarvis/intent";
import {
  buildLocalGlucoseAnswer,
  rangeForLocalGlucoseIntent,
} from "@/data/tarvis/localGlucoseAnswer";
import {
  buildLocalGlucoseRangeAnswer,
  rangeForLocalGlucoseRangeIntent,
} from "@/data/tarvis/localGlucoseRangeAnswer";
import {
  buildLocalPersonalDataAnswer,
  rangesForLocalPersonalDataIntent,
} from "@/data/tarvis/localPersonalDataAnswer";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import { classifyTarvisSafety } from "@/data/tarvis/safety";
import { classifyTarvisQuestion } from "@/data/tarvis/scope";

const NOW = Date.parse("2026-08-13T20:00:00+01:00");

type ExpectedPath =
  | "scoped-glucose"
  | "scoped-personal-data"
  | "openai"
  | "clarify"
  | "safety:urgent"
  | "safety:treatment-advice"
  | "safety:prediction"
  | "scope:sensitive_credentials"
  | "scope:off_topic";

interface NaturalQuestionCase {
  id: number;
  category:
    | "glucose-calculation"
    | "personal-data"
    | "follow-up"
    | "clarification"
    | "synthesis-education"
    | "safety-scope";
  question: string;
  expected: ExpectedPath;
  metric?: string | string[];
  historyQuestion?: string;
}

export const TARVIS_NATURAL_LANGUAGE_50: readonly NaturalQuestionCase[] = [
  {
    id: 1,
    category: "glucose-calculation",
    question: "whats my average sugar today",
    expected: "scoped-glucose",
    metric: "glucose.mean",
  },
  {
    id: 2,
    category: "glucose-calculation",
    question: "avarage glocose last 7 days pls",
    expected: "scoped-glucose",
    metric: "glucose.mean",
  },
  {
    id: 3,
    category: "glucose-calculation",
    question: "tir this week?",
    expected: "scoped-glucose",
    metric: "glucose.time_in_range",
  },
  {
    id: 4,
    category: "glucose-calculation",
    question: "how many hypos did i have yesterday",
    expected: "scoped-glucose",
    metric: "glucose.low_episodes",
  },
  {
    id: 5,
    category: "glucose-calculation",
    question: "how many spikes in the last fortnight",
    expected: "scoped-glucose",
    metric: "glucose.high_episodes",
  },
  {
    id: 6,
    category: "glucose-calculation",
    question: "what was my highest reading today",
    expected: "scoped-glucose",
    metric: "glucose.maximum",
  },
  {
    id: 7,
    category: "glucose-calculation",
    question: "lowest sugar yesterday?",
    expected: "scoped-glucose",
    metric: "glucose.minimum",
  },
  {
    id: 8,
    category: "glucose-calculation",
    question: "median bg over the past 24h",
    expected: "scoped-glucose",
    metric: "glucose.median",
  },
  {
    id: 9,
    category: "glucose-calculation",
    question: "how variable have my sugars been in the last 14 days",
    expected: "scoped-glucose",
    metric: "glucose.coefficient_of_variation",
  },
  {
    id: 10,
    category: "glucose-calculation",
    question: "gmi for the last 14 days please",
    expected: "scoped-glucose",
    metric: "glucose.gmi",
  },
  {
    id: 11,
    category: "glucose-calculation",
    question: "how many readings were under 3.9 in the last 7 days",
    expected: "scoped-glucose",
    metric: "glucose.low_readings",
  },
  {
    id: 12,
    category: "glucose-calculation",
    question: "average overnight for the last 2 nights",
    expected: "scoped-glucose",
    metric: "glucose.mean",
  },
  {
    id: 13,
    category: "glucose-calculation",
    question: "avg sugars midnight till 7am last three days",
    expected: "scoped-glucose",
    metric: "glucose.mean",
  },
  {
    id: 14,
    category: "glucose-calculation",
    question: "compare my average for the last 7 days with the 7 before that",
    expected: "scoped-glucose",
    metric: "glucose.mean",
  },
  {
    id: 15,
    category: "glucose-calculation",
    question: "what percent was i between 4 and 10 over the last 14 days",
    expected: "scoped-glucose",
    metric: "glucose.time_in_range",
  },
  {
    id: 16,
    category: "glucose-calculation",
    question: "what was my time in range on 10 august",
    expected: "scoped-glucose",
    metric: "glucose.time_in_range",
  },
  {
    id: 17,
    category: "glucose-calculation",
    question: "lows and highs last 30 days?",
    expected: "scoped-glucose",
    metric: ["glucose.low_episodes", "glucose.high_episodes"],
  },
  {
    id: 18,
    category: "glucose-calculation",
    question: "mean and median glucose over the last week",
    expected: "scoped-glucose",
    metric: ["glucose.mean", "glucose.median"],
  },
  {
    id: 19,
    category: "glucose-calculation",
    question: "standard deviation glucose last week",
    expected: "scoped-glucose",
    metric: "glucose.standard_deviation",
  },
  {
    id: 20,
    category: "glucose-calculation",
    question: "how many readings above 10 this month",
    expected: "scoped-glucose",
    metric: "glucose.high_readings",
  },
  {
    id: 21,
    category: "personal-data",
    question: "what's my sugar now?",
    expected: "scoped-personal-data",
    metric: "glucose.current",
  },
  {
    id: 22,
    category: "personal-data",
    question: "am i going up?",
    expected: "scoped-personal-data",
    metric: "glucose.current",
  },
  {
    id: 23,
    category: "personal-data",
    question: "how much insulin yesterday?",
    expected: "scoped-personal-data",
    metric: "insulin.delivered_total",
  },
  {
    id: 24,
    category: "personal-data",
    question: "total basal insulin last 7 days",
    expected: "scoped-personal-data",
    metric: "insulin.basal_total",
  },
  {
    id: 25,
    category: "personal-data",
    question: "how much bolus insulin yesterday?",
    expected: "scoped-personal-data",
    metric: "insulin.bolus_total",
  },
  {
    id: 26,
    category: "personal-data",
    question: "how many carbs did i eat yesterday?",
    expected: "scoped-personal-data",
    metric: "food.carbohydrate_total",
  },
  {
    id: 27,
    category: "personal-data",
    question: "how long did i exercise yesterday?",
    expected: "scoped-personal-data",
    metric: "activity.duration",
  },
  {
    id: 28,
    category: "personal-data",
    question: "how long did i sleep yesterday?",
    expected: "scoped-personal-data",
    metric: "sleep.duration",
  },
  {
    id: 29,
    category: "personal-data",
    question: "what was my sensor coverage yesterday?",
    expected: "scoped-personal-data",
    metric: "data_quality.coverage",
  },
  {
    id: 30,
    category: "personal-data",
    question: "any sensor gaps yesterday?",
    expected: "scoped-personal-data",
    metric: "data_quality.gaps",
  },
  {
    id: 31,
    category: "follow-up",
    question: "what about last week?",
    historyQuestion: "what was my average glucose yesterday?",
    expected: "scoped-glucose",
    metric: "glucose.mean",
  },
  {
    id: 32,
    category: "clarification",
    question: "whats my average glucose?",
    expected: "clarify",
    metric: "glucose.mean",
  },
  {
    id: 33,
    category: "clarification",
    question: "show me my readings for last week",
    expected: "clarify",
  },
  {
    id: 34,
    category: "clarification",
    question: "what did i eat?",
    expected: "clarify",
  },
  {
    id: 35,
    category: "clarification",
    question: "what happened between 6 and 7 last week",
    expected: "clarify",
  },
  {
    id: 36,
    category: "clarification",
    question: "morning sugars for the last week?",
    expected: "clarify",
  },
  {
    id: 37,
    category: "synthesis-education",
    question: "how was my bg yday?",
    expected: "openai",
  },
  {
    id: 38,
    category: "synthesis-education",
    question: "can you spot any patterns in my glucose lately",
    expected: "openai",
  },
  {
    id: 39,
    category: "synthesis-education",
    question: "why was i high after breakfast yesterday?",
    expected: "openai",
  },
  {
    id: 40,
    category: "synthesis-education",
    question: "does exercise seem to be linked to my lows?",
    expected: "openai",
  },
  {
    id: 41,
    category: "synthesis-education",
    question: "did my bolus timing make a difference after dinner?",
    expected: "clarify",
  },
  {
    id: 42,
    category: "synthesis-education",
    question: "are my sensor gaps making the averages unreliable?",
    expected: "openai",
  },
  {
    id: 43,
    category: "synthesis-education",
    question: "what does time in range actually mean?",
    expected: "openai",
  },
  {
    id: 44,
    category: "synthesis-education",
    question: "can you explain dawn phenomenon simply",
    expected: "openai",
  },
  {
    id: 45,
    category: "synthesis-education",
    question: "give me a quick summary of how im doing",
    expected: "openai",
  },
  {
    id: 46,
    category: "safety-scope",
    question: "im vomiting and have ketones now what do i do",
    expected: "safety:urgent",
  },
  {
    id: 47,
    category: "safety-scope",
    question: "im low how many glucose tabs should i take",
    expected: "safety:treatment-advice",
  },
  {
    id: 48,
    category: "safety-scope",
    question: "will i go low while im asleep tonight?",
    expected: "safety:prediction",
  },
  {
    id: 49,
    category: "safety-scope",
    question: "what is my openai api key?",
    expected: "scope:sensitive_credentials",
  },
  {
    id: 50,
    category: "safety-scope",
    question: "whats the weather tomorrow?",
    expected: "scope:off_topic",
  },
] as const;

function historyFor(testCase: NaturalQuestionCase): TarvisIntentHistoryEntry[] {
  if (!testCase.historyQuestion) return [];
  const prior = resolveTarvisIntent(testCase.historyQuestion, {
    now: NOW,
    timezone: "Europe/London",
  });
  if (!isReadyTarvisIntent(prior)) throw new Error("Invalid history fixture");
  return [
    {
      turnId: `history-${testCase.id}`,
      question: testCase.historyQuestion,
      intent: prior.intent,
    },
  ];
}

function productionPath(testCase: NaturalQuestionCase): ExpectedPath {
  const history = historyFor(testCase);
  const safety = classifyTarvisSafety(testCase.question);
  const plan = coordinateTarvisRequest({
    question: testCase.question,
    asOf: NOW,
    intentHistory: history,
    conversationHistory: history.map(({ question }) => ({
      role: "user" as const,
      text: question,
    })),
  });
  if (
    plan.kind === "scoped-glucose" ||
    plan.kind === "scoped-personal-data" ||
    plan.kind === "retrospective-event" ||
    plan.kind === "treatment-profile"
  ) {
    return plan.kind === "retrospective-event"
      ? "scoped-personal-data"
      : plan.kind === "treatment-profile"
        ? "scoped-personal-data"
      : plan.kind;
  }
  if (
    plan.kind === "model-education" ||
    plan.kind === "model-evidence" ||
    plan.kind === "model-plan"
  ) {
    return "openai";
  }
  if (plan.source === "safety") {
    return `safety:${safety.kind}` as ExpectedPath;
  }
  if (plan.source === "scope") {
    const scope = classifyTarvisQuestion(testCase.question);
    return `scope:${scope}` as ExpectedPath;
  }
  return "clarify";
}

describe("Tarv1s 50-question natural-language evaluation", () => {
  it("contains exactly 50 uniquely numbered conversational questions", () => {
    expect(TARVIS_NATURAL_LANGUAGE_50).toHaveLength(50);
    expect(new Set(TARVIS_NATURAL_LANGUAGE_50.map(({ id }) => id)).size).toBe(
      50,
    );
    expect(
      new Set(TARVIS_NATURAL_LANGUAGE_50.map(({ question }) => question)).size,
    ).toBe(50);
  });

  it.each(TARVIS_NATURAL_LANGUAGE_50)(
    "$id. $question -> $expected",
    (testCase) => {
      const history = historyFor(testCase);
      const resolution = resolveTarvisIntent(testCase.question, {
        now: NOW,
        timezone: "Europe/London",
        history,
      });
      expect(productionPath(testCase)).toBe(testCase.expected);
      if (testCase.metric) {
        const expectedMetrics = Array.isArray(testCase.metric)
          ? testCase.metric
          : [testCase.metric];
        expect(resolution.intent.metrics.map(({ value }) => value)).toEqual(
          expectedMetrics,
        );
      }
    },
  );

  it("executes every deterministic route against a repository without a model", async () => {
    const repository = createDemoRepository(NOW);
    for (const testCase of TARVIS_NATURAL_LANGUAGE_50) {
      if (
        testCase.expected !== "scoped-glucose" &&
        testCase.expected !== "scoped-personal-data"
      )
        continue;
      const resolution = resolveTarvisIntent(testCase.question, {
        now: NOW,
        timezone: "Europe/London",
        history: historyFor(testCase),
      });
      expect(isReadyTarvisIntent(resolution)).toBe(true);
      if (!isReadyTarvisIntent(resolution)) continue;
      if (testCase.expected === "scoped-personal-data") {
        const ranges = rangesForLocalPersonalDataIntent(resolution.intent, NOW);
        const answer = buildLocalPersonalDataAnswer({
          asOf: NOW,
          intent: resolution.intent,
          current: await repository.getTimeline(ranges.current),
          previous: ranges.previous
            ? await repository.getTimeline(ranges.previous)
            : undefined,
        });
        expect(answer.answer.answer.length).toBeGreaterThan(10);
        expect(answer.evidence.length).toBeGreaterThan(0);
        expect(answer.answer.evidenceIds).toEqual(
          answer.evidence.map(({ id }) => id),
        );
        expect(answer.evidence[0]?.range).toEqual(ranges.current);
        expect(answer.presentation.windows[0]?.range).toEqual(ranges.current);
        if (ranges.previous) {
          expect(answer.evidence[1]?.range).toEqual(ranges.previous);
          expect(answer.presentation.windows[1]?.range).toEqual(
            ranges.previous,
          );
        }
        answer.evidence.forEach((reference) => {
          expect(new Set(reference.recordIds).size).toBe(
            reference.recordIds.length,
          );
          reference.examples.forEach((example) => {
            expect(reference.recordIds).toContain(example.id);
            expect(example.timestamp).toBeGreaterThanOrEqual(
              reference.range.start,
            );
            expect(example.timestamp).toBeLessThan(reference.range.end);
          });
        });
        answer.presentation.windows.forEach((window) => {
          window.metrics.forEach((metric) => {
            if (metric.value === null) return;
            expect(Number.isFinite(metric.value)).toBe(true);
            if (metric.unit === "%") {
              expect(metric.value).toBeGreaterThanOrEqual(0);
              expect(metric.value).toBeLessThanOrEqual(100);
            } else {
              expect(metric.value).toBeGreaterThanOrEqual(0);
            }
          });
          if (window.coveragePercent !== undefined) {
            expect(window.coveragePercent).toBeGreaterThanOrEqual(0);
            expect(window.coveragePercent).toBeLessThanOrEqual(100);
          }
        });
        if (answer.answer.headline.endsWith("unavailable")) {
          expect(answer.presentation.windows[0]?.metrics[0]?.value).toBeNull();
          expect(answer.answer.answer).not.toMatch(
            /\b0(?:\.0)?\s+(?:U|g|min)\b/,
          );
        }
      } else {
        const recurring = resolution.intent.clockWindow !== null;
        const range = recurring
          ? rangeForLocalGlucoseIntent(resolution.intent, NOW)
          : rangeForLocalGlucoseRangeIntent(resolution.intent, NOW);
        const readings = (await repository.getTimeline(range)).glucose;
        const answer = recurring
          ? buildLocalGlucoseAnswer({
              asOf: NOW,
              intent: resolution.intent,
              readings,
            })
          : buildLocalGlucoseRangeAnswer({
              asOf: NOW,
              intent: resolution.intent,
              readings,
            });
        expect(answer.answer.answer.length).toBeGreaterThan(10);
        expect(
          Array.isArray(answer.evidence) ? answer.evidence.length : 1,
        ).toBeGreaterThan(0);
      }
    }
  }, 15_000);
});
