import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { containsTreatmentDirective } from "@/data/tarvis/guardrails";
import {
  buildCarbsPerDayAnswer,
  buildInsulinBreakdownAnswer,
  carbsPerDayRange,
  recordPeriodWindow,
  recordPeriodsRange,
} from "@/data/tarvis/insulinBreakdownAnswer";
import { parseRecordQuestion, type InsulinBreakdownQuestion } from "@/data/tarvis/recordQuestions";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import { classifyTarvisSafety } from "@/data/tarvis/safety";
import type { BasalDelivery, BolusDelivery, InsulinDailyTotal, MealEvent, TimelineData } from "@/domain/models";

// Synthetic records only. Tests run in Europe/London (vitest.config.ts).
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = Date.parse("2030-11-12T14:30:00Z");
const TODAY = Date.parse("2030-11-12T00:00:00Z");
const YESTERDAY = Date.parse("2030-11-11T00:00:00Z");

let ids = 0;
function bolus(timestamp: number, units: number, extra: Partial<BolusDelivery> = {}): BolusDelivery {
  ids += 1;
  return { id: `bolus-${ids}`, timestamp, units, sourceId: "nightscout", ...extra };
}
function smb(timestamp: number, units: number) {
  return bolus(timestamp, units, { deliveryType: "SMB" });
}
function basal(start: number, end: number, rate: number, extra: Partial<BasalDelivery> = {}): BasalDelivery {
  ids += 1;
  return { id: `basal-${ids}`, start, end, rateUnitsPerHour: rate, units: (rate * (end - start)) / HOUR, sourceId: "nightscout", ...extra };
}
function meal(start: number, carbsGrams: number | undefined, extra: Partial<MealEvent> = {}): MealEvent {
  ids += 1;
  return { id: `meal-${ids}`, kind: "meal", start, title: "Carbs", mealType: "snack", carbsGrams, sourceId: "nightscout", origin: "imported", ...extra };
}
function timeline(changes: Partial<TimelineData>): TimelineData {
  return {
    range: { start: YESTERDAY - 10 * 24 * HOUR, end: NOW },
    glucose: [],
    basal: [],
    boluses: [],
    context: [],
    sources: [],
    ...changes,
  };
}
const today: InsulinBreakdownQuestion = { kind: "insulin-breakdown", periods: [{ kind: "today" }] };
const both: InsulinBreakdownQuestion = { kind: "insulin-breakdown", periods: [{ kind: "yesterday" }, { kind: "today" }] };

describe("breakdown and carbs-per-day questions", () => {
  it.each([
    ["How much insulin did AAPS give me today, split into basal and boluses? How many boluses were SMBs vs entered by me?", [{ kind: "today" }]],
    ["Of the boluses AAPS gave me today, how many were automatic SMBs and how many did I enter myself? Totals in units.", [{ kind: "today" }]],
    ["Compare yesterday with today so far: meal boluses I entered, automatic SMBs, and carbs entered.", [{ kind: "yesterday" }, { kind: "today" }]],
    ["How many SMBs did I get yesterday?", [{ kind: "yesterday" }]],
    ["Basal vs bolus split for the last 3 days?", [{ kind: "last-days", days: 3 }]],
  ])("parses %s", (question, periods) => {
    expect(parseRecordQuestion(question)).toEqual({ kind: "insulin-breakdown", periods });
  });

  it.each([
    ["How many grams of carbs did I enter on each of the last 7 days?", 7],
    ["How many carbs did I log each day for the past five days?", 5],
    ["My carbs per day over the last week", 7],
  ])("parses carbs per day: %s", (question, days) => {
    expect(parseRecordQuestion(question)).toEqual({ kind: "carbs-per-day", days });
  });

  it.each([
    "What is an SMB?",
    "How did my glucose go after SMBs yesterday?",
    "Did SMBs cause my low today?",
    "Should I increase my overnight basal rate because AAPS gave lots of SMBs?",
    "How many SMBs did I get between 06:00 and 07:30 this morning?",
    "How much insulin did I get today?",
    "How many carbs should I eat per day?",
    "What is a good amount of carbs per day?",
    "How many carbs did I eat yesterday?",
    "Average glucose for the last 7 days",
    "How many SMBs over the last 90 days?",
  ])("leaves %s to the existing pipeline", (question) => {
    expect(parseRecordQuestion(question)).toBeUndefined();
  });

  it("answers the SMB record questions instead of refusing them", () => {
    for (const question of [
      "Of the boluses AAPS gave me today, how many were automatic SMBs and how many did I enter myself? Totals in units.",
      "How much insulin did AAPS give me today, split into basal and boluses? How many boluses were SMBs vs entered by me?",
      "Compare yesterday with today so far: meal boluses I entered, automatic SMBs, and carbs entered.",
      "How many grams of carbs did I enter on each of the last 7 days?",
    ]) {
      expect(classifyTarvisSafety(question).kind, question).toBe("allow");
      expect(coordinateTarvisRequest({ question, asOf: NOW }).kind, question).toBe("record-question");
    }
  });

  it("still refuses dose and setting questions that mention SMBs", () => {
    for (const question of [
      "How many units should I bolus now, given the SMBs today?",
      "AAPS gave lots of SMBs overnight. Should I increase my overnight basal rate?",
      "How much insulin should I bolus for 40 g of carbs right now?",
    ]) {
      expect(coordinateTarvisRequest({ question, asOf: NOW }).kind, question).toBe("answer");
      expect(classifyTarvisSafety(question).kind, question).not.toBe("allow");
    }
  });
});

describe("period edges", () => {
  it("uses local calendar days, including a 25-hour DST day", () => {
    // UK clocks went back on Sunday 27 October 2030.
    const asOf = Date.parse("2030-10-28T09:00:00Z");
    const window = recordPeriodWindow({ kind: "yesterday" }, asOf);
    expect(window.range.end - window.range.start).toBe(25 * HOUR);
    expect(recordPeriodWindow({ kind: "today" }, asOf).range).toEqual({ start: Date.parse("2030-10-28T00:00:00Z"), end: asOf });
  });

  it("loads the union of the asked periods", () => {
    expect(recordPeriodsRange(both.periods, NOW)).toEqual({ start: YESTERDAY, end: NOW });
    expect(carbsPerDayRange({ kind: "carbs-per-day", days: 7 }, NOW)).toEqual({ start: TODAY - 6 * 24 * HOUR, end: NOW });
  });
});

describe("breakdown answers", () => {
  it("splits SMBs, other boluses, basal and carbs with exact counts and sums", () => {
    const data = timeline({
      basal: [basal(TODAY, NOW, 0.5)],
      boluses: [
        smb(TODAY + 1 * HOUR, 0.25),
        smb(TODAY + 2 * HOUR, 0.4),
        smb(TODAY + 3 * HOUR, 0.35),
        bolus(TODAY + 8 * HOUR, 3.5, { deliveryType: "Meal Bolus" }),
        // Belongs to yesterday: midnight starts today, so this is the last record of yesterday.
        bolus(TODAY - MINUTE, 2, { deliveryType: "Meal Bolus" }),
        // Exactly at midnight belongs to today.
        smb(TODAY, 0.1),
      ],
      context: [meal(TODAY + 8 * HOUR, 45), meal(TODAY + 12 * HOUR, 20), meal(TODAY + 13 * HOUR, undefined)],
    });
    const { answer, evidence } = buildInsulinBreakdownAnswer({ question: today, timeline: data, asOf: NOW });
    const lines = answer.answer.split("\n");
    expect(answer.headline).toBe("Insulin and carbs, today so far");
    expect(lines).toContain("• Basal delivered: 7.25 U");
    expect(lines).toContain("• SMBs delivered, marked SMB by AAPS: 4 (1.10 U)");
    expect(lines).toContain("• Other boluses delivered, not marked SMB: 1 (3.50 U)");
    expect(lines).toContain("• Total delivered: 11.85 U");
    expect(lines).toContain("• Carbs entered: 65 g (2 entries)");
    expect(answer.limitations.some((item) => /basal total is not available/.test(item))).toBe(false);
    expect(evidence.map(({ id }) => id)).toEqual(["breakdown-boluses", "breakdown-carbs"]);
    expect(evidence[0]!.recordIds).toHaveLength(5);
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });

  it("withholds basal when timed basal covers too little of the period", () => {
    const data = timeline({
      basal: [basal(TODAY, TODAY + 6 * HOUR, 0.8)],
      boluses: [smb(TODAY + HOUR, 0.2)],
    });
    const { answer } = buildInsulinBreakdownAnswer({ question: today, timeline: data, asOf: NOW });
    expect(answer.answer).toContain("• Basal delivered: not totalled (timed basal records span 41% of this period)");
    expect(answer.answer).not.toContain("Total delivered");
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
    expect(answer.limitations).toContain(
      "Basal: recorded temporary basals cover 41% of this period, so a basal total is not available.",
    );
  });

  it("counts a temp basal running past now only up to now", () => {
    const data = timeline({ basal: [basal(TODAY, NOW + 2 * HOUR, 1)] });
    const { answer } = buildInsulinBreakdownAnswer({ question: today, timeline: data, asOf: NOW });
    expect(answer.answer).toContain("• Basal delivered: 14.50 U");
  });

  it("compares yesterday with a partial today, one line per part", () => {
    const data = timeline({
      basal: [basal(YESTERDAY, NOW, 0.5)],
      boluses: [
        bolus(YESTERDAY + 8 * HOUR, 4, { deliveryType: "Meal Bolus" }),
        bolus(YESTERDAY + 13 * HOUR, 2.5, { deliveryType: "Meal Bolus" }),
        smb(YESTERDAY + 15 * HOUR, 0.3),
        smb(TODAY + 2 * HOUR, 0.2),
        smb(TODAY + 3 * HOUR, 0.15),
      ],
      context: [meal(YESTERDAY + 8 * HOUR, 50), meal(YESTERDAY + 13 * HOUR, 30)],
    });
    const { answer } = buildInsulinBreakdownAnswer({ question: both, timeline: data, asOf: NOW });
    const lines = answer.answer.split("\n");
    expect(answer.headline).toBe("Yesterday vs today so far");
    expect(lines[0]).toMatch(/^Yesterday \(.+\) compared with today so far \(.+, until .+\):$/);
    expect(lines).toContain("• SMBs delivered, marked SMB by AAPS: yesterday 1 (0.30 U) · today so far 2 (0.35 U)");
    expect(lines).toContain("• Other boluses delivered, not marked SMB: yesterday 2 (6.50 U) · today so far none");
    expect(lines).toContain("• Carbs entered: yesterday 80 g (2 entries) · today so far no carb entries stored");
    expect(lines).toContain("• Basal delivered: yesterday 12.00 U · today so far 7.25 U");
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });

  it("counts a bolus stored once after reconciliation once", () => {
    // TimelineData.boluses is already reconciled across sources; the same record id is never counted twice.
    const shared = bolus(TODAY + HOUR, 1, { deliveryType: "Meal Bolus" });
    const { evidence, answer } = buildInsulinBreakdownAnswer({
      question: today,
      timeline: timeline({ boluses: [shared] }),
      asOf: NOW,
    });
    expect(answer.answer).toContain("• Other boluses delivered, not marked SMB: 1 (1.00 U)");
    expect(evidence[0]!.recordIds).toEqual([shared.id]);
  });

  it("says when records cannot tell automatic boluses apart", () => {
    const data = timeline({
      boluses: [bolus(TODAY + HOUR, 1, { sourceId: "glooko-export" }), bolus(TODAY + 2 * HOUR, 0.5, { sourceId: "glooko-export" })],
    });
    const { answer } = buildInsulinBreakdownAnswer({ question: today, timeline: data, asOf: NOW });
    expect(answer.answer).toContain("• SMBs delivered, marked SMB by AAPS: not marked in these records");
    expect(answer.limitations).toContain("These records do not say whether a bolus was automatic.");
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });

  it("shows both a saved daily total and the records when they differ", () => {
    const total: InsulinDailyTotal = {
      id: "total-1",
      timestamp: YESTERDAY + 23 * HOUR,
      dateKey: "2030-11-11",
      basalUnits: 11,
      bolusUnits: 9,
      totalUnits: 20,
      sourceId: "nightscout",
    };
    const data = timeline({
      boluses: [bolus(YESTERDAY + 8 * HOUR, 4, { deliveryType: "Meal Bolus" })],
      dailyInsulinTotals: [total],
    });
    const { answer } = buildInsulinBreakdownAnswer({
      question: { kind: "insulin-breakdown", periods: [{ kind: "yesterday" }] },
      timeline: data,
      asOf: NOW,
    });
    expect(answer.answer).toContain("• Saved daily bolus total: 9.00 U");
    expect(answer.answer).not.toContain("Total delivered");
    expect(answer.limitations.join(" ")).toContain("the individual bolus records add up to 4.00 U");
  });

  it("says where stored history starts when the period is earlier", () => {
    const data = timeline({ sources: [{ dataFrom: TODAY + HOUR } as TimelineData["sources"][number]] });
    const { answer } = buildInsulinBreakdownAnswer({ question: both, timeline: data, asOf: NOW });
    expect(answer.limitations.some((item) => item.startsWith("Stored records start on"))).toBe(true);
  });
});

describe("carbs per day", () => {
  it("lists every day oldest first, marks today and empty days", () => {
    const data = timeline({
      context: [
        meal(TODAY - 2 * 24 * HOUR + 9 * HOUR, 40),
        meal(TODAY - 2 * 24 * HOUR + 18 * HOUR, 35.5),
        meal(TODAY - 24 * HOUR + 12 * HOUR, 60, { excludedFoodSource: true }),
        meal(TODAY + 8 * HOUR, 25),
      ],
    });
    const { answer } = buildCarbsPerDayAnswer({ question: { kind: "carbs-per-day", days: 3 }, timeline: data, asOf: NOW });
    const lines = answer.answer.split("\n");
    expect(answer.headline).toBe("Carbs entered, last 3 days");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/^• .+: 75\.5 g \(2 entries\)$/);
    expect(lines[2]).toMatch(/^• .+: no carb entries stored$/);
    expect(lines[3]).toMatch(/^• .+ \(so far\): 25 g \(1 entry\)$/);
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });

  it("keeps grams from different sources apart", () => {
    const data = timeline({
      context: [meal(TODAY + 8 * HOUR, 30, { sourceLabel: "Nightscout" }), meal(TODAY + 9 * HOUR, 12, { sourceLabel: "Health Connect" })],
    });
    const { answer } = buildCarbsPerDayAnswer({ question: { kind: "carbs-per-day", days: 1 }, timeline: data, asOf: NOW });
    expect(answer.answer).toContain("Health Connect 12 g · Nightscout 30 g (2 entries, per source)");
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });
});

describe("screen wiring", () => {
  it("answers breakdown and carbs-per-day questions locally with no provider request", () => {
    const screen = readFileSync("src/screens/TarvisScreen.tsx", "utf8");
    const start = screen.indexOf('if (plan.kind === "record-question")');
    const block = screen.slice(start, screen.indexOf('if (plan.kind === "therapy-state")', start));
    expect(block).toContain("buildInsulinBreakdownAnswer({");
    expect(block).toContain("buildCarbsPerDayAnswer({");
    expect(block).toContain('answerSource: "local"');
    expect(block).toContain("modelRequestSent: false");
  });
});
