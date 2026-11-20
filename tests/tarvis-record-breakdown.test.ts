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
import { reconcileBolusSources } from "@/domain/insulinSourceReconciliation";
import { MANUAL_CONTEXT_SOURCE_ID } from "@/data/manualContext";
import type { BasalDelivery, BolusDelivery, DataSourceStatus, InsulinDailyTotal, MealEvent, TimelineData } from "@/domain/models";

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
function source(changes: Partial<DataSourceStatus> & { id: string }): DataSourceStatus {
  return { label: changes.id, detail: "", freshness: "current", origin: "imported", isLive: false, ...changes };
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
    ["My carbs per day over the past week", 7],
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
    const data = timeline({
      boluses: [smb(TODAY + 2 * HOUR, 0.2)],
      sources: [source({ id: "nightscout", dataFrom: TODAY + HOUR })],
    });
    const { answer } = buildInsulinBreakdownAnswer({ question: both, timeline: data, asOf: NOW });
    expect(answer.limitations.some((item) => item.startsWith("Stored records start on"))).toBe(true);
    expect(answer.shortNotice).toContain("Stored records start on");
  });
});

describe("carbs per day", () => {
  it("lists every day newest first, marks today and empty days", () => {
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
    expect(lines[0]).toContain("newest first");
    expect(lines[1]).toMatch(/^• .+ \(so far\): 25 g \(1 entry\)$/);
    expect(lines[2]).toMatch(/^• .+: no carb entries stored$/);
    expect(lines[3]).toMatch(/^• .+: 75\.5 g \(2 entries\)$/);
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

describe("review fixes: SMB marking across sources (H2)", () => {
  it("counts SMBs from the AAPS copy when Glooko holds the same boluses", () => {
    const raw: BolusDelivery[] = [];
    for (let index = 0; index < 10; index += 1) {
      raw.push({ id: `ns-${index}`, timestamp: TODAY + (index + 1) * HOUR, units: 0.3, deliveryType: "SMB", sourceId: "nightscout" });
      if (index < 8) {
        raw.push({ id: `gl-${index}`, timestamp: TODAY + (index + 1) * HOUR + 20_000, units: 0.3, deliveryType: "Normal", sourceId: "glooko-export" });
      }
    }
    raw.push({ id: "ns-meal", timestamp: TODAY + 12.5 * HOUR, units: 6, deliveryType: "Meal Bolus", sourceId: "nightscout" });
    const reconciled = reconcileBolusSources(raw).boluses;
    // Totals are unchanged: one record per delivery, Glooko copies kept.
    expect(reconciled).toHaveLength(11);
    expect(reconciled.reduce((sum, record) => sum + record.units, 0)).toBeCloseTo(9);
    expect(reconciled.filter((record) => record.sourceId === "glooko-export")).toHaveLength(8);
    const { answer } = buildInsulinBreakdownAnswer({ question: today, timeline: timeline({ boluses: reconciled }), asOf: NOW });
    expect(answer.answer).toContain("• SMBs delivered, marked SMB by AAPS: 10 (3.00 U)");
    expect(answer.answer).toContain("• Other boluses delivered, not marked SMB: 1 (6.00 U)");
    expect(answer.shortNotice ?? "").not.toMatch(/mark automatic/);
  });

  it("keeps a Glooko bolus with a matched non-SMB copy as a known other bolus", () => {
    const reconciled = reconcileBolusSources([
      { id: "gl-1", timestamp: TODAY + HOUR, units: 4, deliveryType: "Normal", sourceId: "glooko-export" },
      { id: "ns-1", timestamp: TODAY + HOUR, units: 4, deliveryType: "Meal Bolus", sourceId: "nightscout" },
    ]).boluses;
    expect(reconciled).toEqual([
      expect.objectContaining({ id: "gl-1", deliveryType: "Normal", smbMarking: { sourceId: "nightscout", smb: false } }),
    ]);
    const { answer } = buildInsulinBreakdownAnswer({ question: today, timeline: timeline({ boluses: reconciled }), asOf: NOW });
    expect(answer.answer).toContain("• SMBs delivered, marked SMB by AAPS: none");
    expect(answer.shortNotice).toBeUndefined();
  });

  it("says visibly how many boluses came only from Glooko", () => {
    const boluses = [
      smb(TODAY + HOUR, 0.3),
      ...Array.from({ length: 8 }, (_, index) => bolus(TODAY + (index + 2) * HOUR, 0.5, { sourceId: "glooko-export" })),
    ];
    const { answer } = buildInsulinBreakdownAnswer({ question: today, timeline: timeline({ boluses }), asOf: NOW });
    expect(answer.shortNotice).toContain("8 boluses came from Glooko, which doesn't mark automatic boluses");
  });
});

describe("review fixes: conflicting totals are visible (M1)", () => {
  const total: InsulinDailyTotal = {
    id: "total-2",
    timestamp: YESTERDAY + 23 * HOUR,
    dateKey: "2030-11-11",
    basalUnits: 12,
    bolusUnits: 9.5,
    totalUnits: 21.5,
    sourceId: "glooko-export",
  };
  const data = () => timeline({
    boluses: [
      bolus(YESTERDAY + 8 * HOUR, 4, { sourceId: "glooko-export" }),
      bolus(TODAY + 8 * HOUR, 3, { sourceId: "glooko-export" }),
    ],
    dailyInsulinTotals: [total],
  });

  it("shows both totals in the visible notice for one period", () => {
    const { answer } = buildInsulinBreakdownAnswer({
      question: { kind: "insulin-breakdown", periods: [{ kind: "yesterday" }] },
      timeline: data(),
      asOf: NOW,
    });
    expect(answer.shortNotice).toContain("Saved daily bolus total 9.50 U, bolus records 4.00 U");
  });

  it("shows both totals in the visible notice and an early list line for two periods", () => {
    const { answer } = buildInsulinBreakdownAnswer({ question: both, timeline: data(), asOf: NOW });
    expect(answer.shortNotice).toContain("Yesterday: saved daily bolus total 9.50 U, bolus records 4.00 U");
    const items = answer.answer.split("\n").filter((line) => line.startsWith("• "));
    expect(items.findIndex((line) => line.startsWith("• Saved daily bolus total"))).toBeLessThan(4);
  });

  it("says a shared source note once for two periods and does not repeat notices in Details", () => {
    const { answer } = buildInsulinBreakdownAnswer({ question: both, timeline: data(), asOf: NOW });
    expect(answer.shortNotice).toBe(
      "Yesterday: saved daily bolus total 9.50 U, bolus records 4.00 U; both shown, neither picked. "
        + "Boluses in both periods came from Glooko, which doesn't mark automatic boluses, so SMBs can't be counted.",
    );
    expect(answer.limitations.join(" ")).not.toContain("both shown, neither picked");
    expect(answer.limitations.join(" ")).not.toContain("Boluses in both periods");
  });
});

describe("review fixes: long-acting injections are never dropped (M2)", () => {
  it("lists manual long-acting injections with units and in the evidence", () => {
    const { answer, evidence } = buildInsulinBreakdownAnswer({
      question: today,
      timeline: timeline({
        boluses: [
          { id: "m1", timestamp: TODAY + 8 * HOUR, units: 20, deliveryType: "Manual long-acting dose", sourceId: MANUAL_CONTEXT_SOURCE_ID },
          { id: "m2", timestamp: TODAY + 9 * HOUR, units: 5, deliveryType: "Manual rapid-acting dose", sourceId: MANUAL_CONTEXT_SOURCE_ID },
        ],
      }),
      asOf: NOW,
    });
    const items = answer.answer.split("\n").filter((line) => line.startsWith("• "));
    expect(items[1]).toBe("• Long-acting injections: 1 (20.00 U)");
    expect(evidence[0]!.recordIds).toEqual(["m1", "m2"]);
  });
});

describe("review fixes: periods are never widened (M3)", () => {
  it.each([
    "How many SMBs the day before yesterday?",
    "How many SMBs on 3 November vs today",
    "How many SMBs on 3rd Nov?",
    "How many SMBs on 03/11?",
    "How many SMBs did I get today at lunch",
    "How many SMBs yesterday evening?",
    "How many SMBs today vs tomorrow",
    "How many SMBs today so far vs the last 7 days",
    "How many SMBs this week vs last week?",
    "How many SMBs in the last 24 hours?",
    "How many carbs a day did I have this week",
    "How many carbs a day did I have last week",
  ])("does not answer a different period locally: %s", (question) => {
    expect(parseRecordQuestion(question)).toBeUndefined();
  });

  it("reads this week and last week as calendar weeks", () => {
    expect(parseRecordQuestion("How many SMBs this week?")).toEqual({ kind: "insulin-breakdown", periods: [{ kind: "this-week" }] });
    expect(parseRecordQuestion("How many SMBs last week?")).toEqual({ kind: "insulin-breakdown", periods: [{ kind: "last-week" }] });
    expect(parseRecordQuestion("How many SMBs over the past week?")).toEqual({
      kind: "insulin-breakdown",
      periods: [{ kind: "last-days", days: 7 }],
    });
    // NOW is Tuesday 12 November 2030, 14:30 in London.
    expect(recordPeriodWindow({ kind: "this-week" }, NOW).range).toEqual({ start: TODAY - 24 * HOUR, end: NOW });
    expect(recordPeriodWindow({ kind: "last-week" }, NOW).range).toEqual({
      start: TODAY - 8 * 24 * HOUR,
      end: TODAY - 24 * HOUR,
    });
  });

  it("keeps a Monday-to-Sunday last week across the October DST change", () => {
    // Monday 28 October 2030; the week before ran Monday 21 to Sunday 27 October, with a 25-hour Sunday.
    const asOf = Date.parse("2030-10-28T09:00:00Z");
    const window = recordPeriodWindow({ kind: "last-week" }, asOf);
    expect(window.range.end - window.range.start).toBe(7 * 24 * HOUR + HOUR);
    expect(window.dates).toMatch(/21 Oct .+ 27 Oct/);
  });
});

describe("review fixes: freshness and coverage (M4, M6)", () => {
  it("uses the insulin source's last record time, not now, in the lead line and notice", () => {
    const { answer } = buildInsulinBreakdownAnswer({
      question: today,
      timeline: timeline({
        boluses: [smb(TODAY + 8 * HOUR, 0.4)],
        sources: [
          source({ id: "nightscout", freshness: "stale", dataFrom: TODAY + 7 * HOUR, dataThrough: TODAY + 9 * HOUR }),
          source({ id: "libre", dataFrom: YESTERDAY - 300 * 24 * HOUR, dataThrough: NOW }),
        ],
      }),
      asOf: NOW,
    });
    expect(answer.answer.split("\n")[0]).toMatch(/records up to 09:00:$/);
    expect(answer.answer).not.toContain("until 14:30");
    expect(answer.shortNotice).toContain("Records are stored only up to 09:00");
    // The glucose source's much earlier start must not hide the insulin source's late start.
    expect(answer.shortNotice).toContain("Stored records start on");
    expect(answer.confidence).toBe("moderate");
  });

  it("puts the period and basal coverage of both periods in the compact context line", () => {
    const data = timeline({ basal: [basal(YESTERDAY, NOW, 0.5)], boluses: [smb(TODAY + HOUR, 0.2)] });
    expect(buildInsulinBreakdownAnswer({ question: both, timeline: data, asOf: NOW }).answer.shortContext).toBe(
      "Yesterday vs today so far · basal records 100% / 100% · boluses 0 / 1",
    );
    expect(buildInsulinBreakdownAnswer({ question: today, timeline: data, asOf: NOW }).answer.shortContext).toBe(
      "Today so far · basal records 100% · 1 bolus, 0 carb entries",
    );
  });

  it("gives carbs per day a context line and a per-source limitation", () => {
    const data = timeline({
      context: [meal(TODAY + 8 * HOUR, 30, { sourceLabel: "Nightscout" }), meal(TODAY + 9 * HOUR, 12, { sourceLabel: "Health Connect" })],
    });
    const { answer } = buildCarbsPerDayAnswer({ question: { kind: "carbs-per-day", days: 7 }, timeline: data, asOf: NOW });
    expect(answer.shortContext).toBe("Last 7 days · 1 day with entries · 2 carb entries");
    expect(answer.limitations.join(" ")).toContain("Carb entries come from Nightscout and Health Connect");
    expect(answer.shortNotice).toContain("1 day has carbs from more than one source");
  });
});

describe("round 3: records that stop before the period (M4 residual)", () => {
  it("says today isn't covered when the insulin source stopped yesterday evening", () => {
    const { answer } = buildInsulinBreakdownAnswer({
      question: today,
      timeline: timeline({
        sources: [source({ id: "nightscout", label: "Nightscout", capabilities: [{ kind: "bolus-events", fidelity: "source-event" }, { kind: "carbohydrates", fidelity: "source-event" }], freshness: "stale", dataFrom: YESTERDAY - 30 * 24 * HOUR, dataThrough: YESTERDAY + 20 * HOUR })],
      }),
      asOf: NOW,
    });
    expect(answer.shortNotice).toContain("Records are stored only up to 20:00 yesterday, so today isn't covered.");
    expect(answer.answer.split("\n")[0]).toContain("not covered by stored records");
    expect(answer.answer).toContain("SMBs delivered, marked SMB by AAPS: not covered by stored records");
    expect(answer.answer).toContain("Other boluses delivered, not marked SMB: not covered by stored records");
    expect(answer.answer).not.toMatch(/: none$/m);
    expect(answer.confidence).toBe("moderate");
  });

  it("checks insulin on its own when carbs come from a source that is up to date", () => {
    const { answer } = buildInsulinBreakdownAnswer({
      question: today,
      timeline: timeline({
        boluses: [bolus(YESTERDAY + 9 * HOUR, 2, { sourceId: "glooko-export" })],
        context: [meal(TODAY + 8 * HOUR, 30, { sourceId: MANUAL_CONTEXT_SOURCE_ID })],
        sources: [
          source({ id: "glooko-export", label: "Glooko", freshness: "stale", dataThrough: YESTERDAY + 20 * HOUR }),
          source({ id: MANUAL_CONTEXT_SOURCE_ID, label: "Entered in T1 Arc", dataThrough: NOW }),
        ],
      }),
      asOf: NOW,
    });
    expect(answer.shortNotice).toContain("Insulin records are stored only up to 20:00 yesterday, so today isn't covered.");
    expect(answer.answer).toContain("Carbs entered: 30 g");
    expect(answer.confidence).toBe("moderate");
  });

  it("names the period when records stop before an earlier compared period", () => {
    const { answer } = buildInsulinBreakdownAnswer({
      question: both,
      timeline: timeline({
        sources: [source({ id: "nightscout", capabilities: [{ kind: "bolus-events", fidelity: "source-event" }, { kind: "carbohydrates", fidelity: "source-event" }], freshness: "stale", dataThrough: YESTERDAY - 4 * HOUR })],
      }),
      asOf: NOW,
    });
    expect(answer.shortNotice).toContain("so yesterday isn't covered.");
    expect(answer.shortNotice).toContain("so today isn't covered.");
  });

  it("says when no insulin records are stored at all, instead of a bare none", () => {
    // A source that does not say it holds insulin records (here a glucose-only one) is not used for coverage.
    const { answer } = buildInsulinBreakdownAnswer({
      question: today,
      timeline: timeline({ sources: [source({ id: "libre", freshness: "stale", dataThrough: YESTERDAY + 20 * HOUR })] }),
      asOf: NOW,
    });
    expect(answer.shortNotice).toContain("No insulin records are stored on this phone");
    expect(answer.confidence).toBe("moderate");
  });

  it("says the carbs days aren't covered when the carb source stopped before them", () => {
    const { answer } = buildCarbsPerDayAnswer({
      question: { kind: "carbs-per-day", days: 3 },
      timeline: timeline({
        context: [meal(YESTERDAY - 5 * 24 * HOUR, 40)],
        sources: [source({ id: "nightscout", freshness: "stale", dataThrough: YESTERDAY - 5 * 24 * HOUR })],
      }),
      asOf: NOW,
    });
    expect(answer.shortNotice).toMatch(/Records are stored only up to .+, so the last 3 days aren't covered\./);
    expect(answer.answer.split("\n")[0]).toContain("not covered by stored records");
    expect(answer.confidence).toBe("moderate");
  });

  it("keeps an up-to-date answer free of coverage notices", () => {
    const { answer } = buildInsulinBreakdownAnswer({
      question: today,
      timeline: timeline({
        basal: [basal(TODAY, NOW, 0.5)],
        boluses: [smb(TODAY + HOUR, 0.2)],
        sources: [source({ id: "nightscout", dataFrom: YESTERDAY - 30 * 24 * HOUR, dataThrough: NOW })],
      }),
      asOf: NOW,
    });
    expect(answer.shortNotice ?? "").not.toMatch(/stored only up to|not covered|No insulin records/);
  });
});

describe("round 3: SMB marking is carried only when certain (H2 residual)", () => {
  const glooko = (id: string, timestamp: number, units: number): BolusDelivery =>
    ({ id, timestamp, units, deliveryType: "Normal", sourceId: "glooko-export" });

  it.each([
    [
      "two Nightscout records could be the same delivery",
      [
        glooko("gl-1", TODAY + HOUR + 20_000, 0.3),
        { id: "ns-1", timestamp: TODAY + HOUR, units: 0.3, deliveryType: "SMB", sourceId: "nightscout" },
        { id: "ns-2", timestamp: TODAY + HOUR + 60_000, units: 0.3, deliveryType: "Correction Bolus", sourceId: "nightscout" },
      ],
    ],
    [
      "the amounts differ, even within the duplicate tolerance",
      [glooko("gl-1", TODAY + HOUR, 0.3), { id: "ns-1", timestamp: TODAY + HOUR, units: 0.32, deliveryType: "SMB", sourceId: "nightscout" }],
    ],
    [
      "the only Nightscout match is 90 seconds away, so it may be another delivery",
      [glooko("gl-1", TODAY + 12 * HOUR, 0.5), { id: "ns-1", timestamp: TODAY + 12 * HOUR + 90_000, units: 0.5, deliveryType: "SMB", sourceId: "nightscout" }],
    ],
    [
      "the Nightscout copy has no delivery type",
      [glooko("gl-1", TODAY + HOUR, 0.3), { id: "ns-1", timestamp: TODAY + HOUR, units: 0.3, sourceId: "nightscout" }],
    ],
    [
      "the AAPS and Nightscout copies disagree",
      [
        glooko("gl-1", TODAY + HOUR, 0.3),
        { id: "ns-1", timestamp: TODAY + HOUR, units: 0.3, deliveryType: "SMB", sourceId: "nightscout" },
        { id: "aaps-1", timestamp: TODAY + HOUR, units: 0.3, deliveryType: "Correction Bolus", sourceId: "aaps-local" },
      ],
    ],
  ] as [string, BolusDelivery[]][])("leaves the Glooko bolus unmarked when %s, and counts it in the note", (_, raw) => {
    const reconciled = reconcileBolusSources(raw).boluses;
    const kept = reconciled.find((record) => record.id === "gl-1");
    expect(kept).toBeDefined();
    expect(kept?.smbMarking).toBeUndefined();
    const { answer } = buildInsulinBreakdownAnswer({ question: today, timeline: timeline({ boluses: reconciled }), asOf: NOW });
    expect(answer.shortNotice).toMatch(/came from Glooko, which doesn't mark automatic boluses/);
    expect(answer.answer).not.toContain("SMBs delivered, marked SMB by AAPS: 1 (0.30 U)");
  });

  it("carries the marking when AAPS and Nightscout each hold one matching SMB copy", () => {
    const reconciled = reconcileBolusSources([
      glooko("gl-1", TODAY + HOUR, 0.3),
      { id: "ns-1", timestamp: TODAY + HOUR, units: 0.3, deliveryType: "SMB", sourceId: "nightscout" },
      { id: "aaps-1", timestamp: TODAY + HOUR, units: 0.3, deliveryType: "SMB", sourceId: "aaps-local" },
    ]).boluses;
    expect(reconciled).toEqual([expect.objectContaining({ id: "gl-1", smbMarking: expect.objectContaining({ smb: true }) })]);
  });
});
