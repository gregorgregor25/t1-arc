import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { AapsContextObservation } from "@/data/aaps/types";
import { createCurrentIobLoader, type CurrentIobEstimate } from "@/data/tarvis/currentIobLoader";
import { containsTreatmentDirective } from "@/data/tarvis/guardrails";
import { buildCurrentIobAnswer } from "@/data/tarvis/recordAnswers";
import { parseRecordQuestion } from "@/data/tarvis/recordQuestions";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

const MINUTE = 60 * 1000;
// A synthetic November afternoon (GMT).
const NOW = Date.parse("2030-11-12T15:00:00Z");

function estimate(extra: Partial<CurrentIobEstimate> = {}): CurrentIobEstimate {
  return { provenance: "aaps", iobUnits: 1.25, receivedAt: NOW - 4 * MINUTE, ...extra };
}

function aapsObservation(extra: Partial<AapsContextObservation> = {}): AapsContextObservation {
  return {
    id: "synthetic",
    receivedAt: NOW - 3 * MINUTE,
    writeEpoch: 1,
    selectionGeneration: 1,
    reconciliationScope: "local",
    ...extra,
  };
}

describe("current insulin on board questions", () => {
  it.each([
    "What is my IOB?",
    "What's my IOB now?",
    "How much insulin on board do I have?",
    "How much active insulin have I got right now?",
    "Current IOB?",
  ])("parses %s", (question) => {
    expect(parseRecordQuestion(question)).toEqual({ kind: "insulin-on-board" });
  });

  it.each([
    "What is IOB?",
    "What does insulin on board mean?",
    "What was my IOB at 10:00 yesterday?",
    "What was my IOB when I went low last night?",
    "Average IOB this week",
    "Should I worry about my IOB?",
    "What is my IOB and how much should I bolus?",
  ])("leaves %s to the existing pipeline", (question) => {
    expect(parseRecordQuestion(question)).toBeUndefined();
  });

  it("routes to the local record answer, and safety still refuses a dose question", () => {
    expect(coordinateTarvisRequest({ question: "What is my IOB now?", asOf: NOW })).toMatchObject({
      kind: "record-question",
      question: { kind: "insulin-on-board" },
    });
    expect(
      coordinateTarvisRequest({ question: "What is my IOB and how much should I bolus?", asOf: NOW }).kind,
    ).toBe("answer");
    expect(
      coordinateTarvisRequest({ question: "My IOB is 2 U, how much should I bolus now?", asOf: NOW }).kind,
    ).toBe("answer");
  });
});

describe("current insulin on board answers", () => {
  it("reports a fresh AAPS estimate with its parts, time, age and provenance", () => {
    const { answer, evidence } = buildCurrentIobAnswer({
      estimate: estimate({ bolusIobUnits: 0.8, basalIobUnits: 0.45 }),
      liveData: true,
      asOf: NOW,
    });
    expect(answer.answer).toMatch(/^AAPS reported 1\.25 U of insulin on board at \S+ \(4 min ago\)\. /);
    expect(answer.answer).toContain("Bolus part: 0.80 U. Basal part: 0.45 U.");
    expect(answer.answer).toContain(
      "This is AAPS's own estimate, received on this phone. T1 Arc did not calculate it.",
    );
    expect(answer.answer).not.toContain("not current");
    expect(answer.confidence).toBe("moderate");
    expect(evidence).toEqual([]);
    // The model-output guard flags any "bolus … U" pair, so the two part
    // labels are checked separately: they state values, never an action.
    const withoutParts = answer.answer.replace(/(?:Bolus|Basal) part: \S+ U\. ?/g, "");
    expect(containsTreatmentDirective(withoutParts)).toBe(false);
    expect(answer.answer).not.toMatch(/\b(?:should|take|give|suggest|recommend|consider|try)\b/i);
  });

  it("says an old estimate is not current and gives its date and time", () => {
    const { answer } = buildCurrentIobAnswer({
      estimate: estimate({ receivedAt: NOW - 50 * MINUTE }),
      liveData: true,
      asOf: NOW,
    });
    expect(answer.answer).toMatch(
      /^The latest insulin-on-board estimate is not current\. AAPS reported 1\.25 U of insulin on board at .+ \(50 min ago\)\./,
    );
    expect(answer.confidence).toBe("limited");
  });

  it("names Nightscout as the route for a looping-system estimate", () => {
    const { answer } = buildCurrentIobAnswer({
      estimate: estimate({ provenance: "nightscout" }),
      liveData: true,
      asOf: NOW,
    });
    expect(answer.answer).toMatch(
      /^Your looping system reported 1\.25 U of insulin on board through Nightscout at /,
    );
    expect(answer.answer).toContain("read from Nightscout. T1 Arc did not calculate it.");
  });

  it("shows a negative estimate as it is", () => {
    const { answer } = buildCurrentIobAnswer({
      estimate: estimate({ iobUnits: -0.4 }),
      liveData: true,
      asOf: NOW,
    });
    expect(answer.answer).toContain("reported -0.40 U of insulin on board");
    expect(answer.answer).toContain("A value below zero can happen in this estimate.");
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });

  it("does not claim an age when the receipt time is ahead of the phone clock", () => {
    const { answer } = buildCurrentIobAnswer({
      estimate: estimate({ receivedAt: NOW + 10 * MINUTE }),
      liveData: true,
      asOf: NOW,
    });
    expect(answer.answer).toContain("ahead of this phone’s clock, so its age can't be checked.");
    expect(answer.answer).not.toMatch(/ ago|min ahead/);
    expect(answer.confidence).toBe("limited");
  });

  it("says no estimate is available, never a calculated one", () => {
    const { answer } = buildCurrentIobAnswer({ estimate: undefined, liveData: true, asOf: NOW });
    expect(answer.answer).toBe(
      "No insulin-on-board estimate is available. T1 Arc shows the estimate AAPS or Nightscout reports and does not calculate its own.",
    );
    const demo = buildCurrentIobAnswer({ estimate: undefined, liveData: false, asOf: NOW });
    expect(demo.answer.answer).toContain("only shown for live data");
  });
});

describe("current insulin on board loader", () => {
  it("is not created for sample data", () => {
    expect(createCurrentIobLoader("demo")).toBeUndefined();
  });

  it("uses AAPS when it is the selected source, with its parts", async () => {
    const loader = createCurrentIobLoader("live", {
      aaps: async () => aapsObservation({ iobUnits: 1.1, bolusIobUnits: 0.7, basalIobUnits: 0.4 }),
      nightscout: async () => ({ iobUnits: 9, timestamp: NOW }),
    });
    await expect(loader!(NOW)).resolves.toEqual({
      provenance: "aaps",
      iobUnits: 1.1,
      bolusIobUnits: 0.7,
      basalIobUnits: 0.4,
      receivedAt: NOW - 3 * MINUTE,
    });
  });

  it("does not mix sources when the AAPS broadcast has no estimate", async () => {
    const loader = createCurrentIobLoader("live", {
      aaps: async () => aapsObservation(),
      nightscout: async () => ({ iobUnits: 9, timestamp: NOW }),
    });
    await expect(loader!(NOW)).resolves.toBeUndefined();
  });

  it("falls back to the Nightscout status when AAPS is not selected", async () => {
    const loader = createCurrentIobLoader("live", {
      aaps: async () => undefined,
      nightscout: async () => ({ iobUnits: 0.9, cobGrams: 12, timestamp: NOW - MINUTE }),
    });
    await expect(loader!(NOW)).resolves.toEqual({
      provenance: "nightscout",
      iobUnits: 0.9,
      receivedAt: NOW - MINUTE,
    });
  });

  it("is answered locally in the Tarv1s screen and passed only for live data", () => {
    const screen = readFileSync("src/screens/TarvisScreen.tsx", "utf8");
    const block = screen.slice(
      screen.indexOf('if (plan.kind === "record-question")'),
      screen.indexOf('if (plan.kind === "therapy-state")'),
    );
    expect(block).toContain("buildCurrentIobAnswer(");
    expect(block).toContain('answerSource: "local"');
    expect(block).toContain("modelRequestSent: false");
    const insights = readFileSync("src/screens/InsightsScreen.tsx", "utf8");
    expect(insights).toMatch(
      /loadCurrentIob=\{\s*tarvisContext\.liveData \? loadTarvisCurrentIob : undefined\s*\}/,
    );
  });
});
