import { describe, expect, it } from "vitest";

import {
  buildTarvisEvidencePacket,
  currentPeriodTarvisEvidence,
  selectTarvisEvidencePacket,
} from "@/data/tarvis/evidencePacket";
import {
  localTarvisEvidenceFallback,
  parseTarvisEvidenceSelectionResult,
} from "@/data/tarvis/evidenceAnswerGuardrail";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import { buildInsightReport } from "@/domain/insights";
import type { TimelineData, TimeRange } from "@/domain/models";

const DAY = 86_400_000;
const CURRENT = {
  start: Date.parse("2026-09-28T00:00:00Z"),
  end: Date.parse("2026-10-05T00:00:00Z"),
};
const PREVIOUS = { start: CURRENT.start - 7 * DAY, end: CURRENT.start };
const QUESTION = "Review patterns in my glucose and sleep records over the last 7 days, including missing data.";

function timeline(range: TimeRange, withSleep: boolean): TimelineData {
  const sleepStart = range.start + DAY + 22 * 3_600_000;
  return {
    range,
    glucose: Array.from({ length: (range.end - range.start) / 600_000 }, (_, index) => {
      const timestamp = range.start + index * 600_000;
      return { id: `glucose:${timestamp}`, timestamp, receivedAt: timestamp,
        mmolL: 6.4, sourceId: "cgm", quality: "measured" as const, trend: "flat" as const };
    }),
    basal: [], boluses: [], context: withSleep ? [{
      id: `sleep:${range.start}`, kind: "sleep", title: "Recorded sleep",
      sourceId: "health-connect", origin: "imported", start: sleepStart,
      end: sleepStart + 7 * 3_600_000, durationMinutes: 420,
    }] : [],
    sources: [],
  };
}

function packet(
  currentSleep: boolean,
  previousSleep: boolean,
  crowded = false,
  question = QUESTION,
  requiredFindingIds?: string[],
) {
  const report = buildInsightReport(
    timeline(CURRENT, currentSleep), timeline(PREVIOUS, previousSleep), CURRENT.end,
  );
  expect(report.ready).toBe(true);
  if (crowded) {
    const generic = report.findings.find(({ category }) => category === "glucose")!;
    report.findings = [
      ...Array.from({ length: 25 }, (_, index) => ({ ...generic, id: `crowded-${index}` })),
      ...report.findings,
    ];
  }
  const built = buildTarvisEvidencePacket(report, { question }).packet;
  if (requiredFindingIds) built.requiredFindingIds = requiredFindingIds;
  return selectTarvisEvidencePacket(question, built);
}

describe("explicitly requested sleep evidence", () => {
  const togetherQuestion = "What do my sleep and glucose records show together over the last seven days, without assuming one caused the other?";

  it("gives a current-only sleep and glucose answer without repeated reference counts or prior data", () => {
    const report = buildInsightReport(timeline(CURRENT, true), timeline(PREVIOUS, true), CURRENT.end);
    report.previous.sleepMinutesPerNight = 9123;
    const lookup = buildTarvisEvidencePacket(report, { question: togetherQuestion });
    lookup.packet.evidence.find(({ id }) => id === "previous-glucose")!.description = "PRIOR_SECRET_9123";
    lookup.packet.comparison.current.mealCarbsPerDay = 6543;
    lookup.packet.findings.push(
      { id: "repeated-glucose-a", category: "glucose", kind: "observation", title: "Old comparison", summary: "PRIOR_SECRET_9123", evidenceIds: ["current-glucose", "previous-glucose"] },
      { id: "repeated-glucose-b", category: "glucose", kind: "observation", title: "Old comparison", summary: "PRIOR_SECRET_9123", evidenceIds: ["current-glucose", "previous-glucose"] },
      { id: "glucose-timing", category: "glucose", kind: "observation", title: "Prior-period timing change", summary: "PRIOR_SECRET_9123", caveat: "This comparison needs 70% coverage and follows local clock boundaries.", evidenceIds: ["current-glucose", "previous-glucose"] },
    );
    lookup.packet.requiredFindingIds = ["repeated-glucose-b"];
    const selected = selectTarvisEvidencePacket(togetherQuestion,
      currentPeriodTarvisEvidence(lookup, report, togetherQuestion).packet);
    const answer = localTarvisEvidenceFallback(selected);
    expect(answer.headline).toBe("Sleep and glucose in the requested period");
    expect(answer.answer).toContain("time in range");
    expect(answer.answer).toContain("Recorded sleep averaged");
    expect(answer.answer).toContain("cannot show whether sleep and glucose changed together over time");
    expect(answer.answer).not.toContain("The requested period has");
    expect(answer.answer).not.toContain("normalised glucose readings");
    expect(selected.findings.filter(({ id }) => id.startsWith("repeated-glucose-")).map(({ id }) => id)).toEqual(["repeated-glucose-b"]);
    expect(selected.findings.find(({ id }) => id === "glucose-timing")?.caveat).toContain("local clock boundaries");
    expect(selected.findings.find(({ id }) => id === "glucose-timing")?.caveat).toContain("70% observed coverage");
    expect(selected.requiredFindingIds).toContain("sleep-context");
    expect(JSON.stringify(selected)).not.toContain("PRIOR_SECRET_9123");
    expect(JSON.stringify(selected)).not.toContain("6543");
    expect(JSON.stringify(selected)).not.toContain("previous-glucose");
    expect(selected.comparison.previous).toBeUndefined();
  });

  it("describes missing sleep as unavailable rather than claiming a sleep-glucose relationship", () => {
    const report = buildInsightReport(timeline(CURRENT, false), timeline(PREVIOUS, true), CURRENT.end);
    const selected = selectTarvisEvidencePacket(togetherQuestion,
      currentPeriodTarvisEvidence(buildTarvisEvidencePacket(report, { question: togetherQuestion }), report, togetherQuestion).packet);
    const answer = localTarvisEvidenceFallback(selected);
    expect(answer.headline).toBe("Sleep and glucose in the requested period");
    expect(answer.answer).toContain("No recorded sleep summary is available for the requested period");
    expect(answer.answer).toContain("does not prove that no sleep occurred");
    expect(answer.answer).not.toContain("Recorded sleep averaged");
    expect(JSON.stringify(selected)).not.toContain("previous-sleep");
  });

  it("does not turn missing glucose into zero observed episodes", () => {
    const current = timeline(CURRENT, true);
    current.glucose = [];
    const report = buildInsightReport(current, timeline(PREVIOUS, true), CURRENT.end);
    const selected = selectTarvisEvidencePacket(togetherQuestion,
      currentPeriodTarvisEvidence(buildTarvisEvidencePacket(report, { question: togetherQuestion }), report, togetherQuestion).packet);
    const answer = localTarvisEvidenceFallback(selected);
    expect(answer.answer).toContain("No recorded glucose readings; glucose results are unavailable, not zero");
    expect(answer.answer).not.toContain("time in range 0%");
    expect(JSON.stringify(selected)).not.toContain("previous-glucose");
  });

  it("uses a general heading for an unqualified broad question", () => {
    const question = "How am I doing this week?";
    const report = buildInsightReport(timeline(CURRENT, true), timeline(PREVIOUS, true), CURRENT.end);
    const scoped = currentPeriodTarvisEvidence(buildTarvisEvidencePacket(report, { question }), report, question);
    expect(scoped.packet.comparison.headline).toBe("Your requested records");
  });

  it("retains real sleep evidence ahead of the report cap and requires it in hosted and local answers", () => {
    expect(coordinateTarvisRequest({ question: QUESTION, asOf: CURRENT.end }).kind).toBe("model-evidence");
    const selected = packet(true, true, true);
    expect(selected.findings.length).toBeLessThanOrEqual(10);
    expect(selected.findings.some(({ id }) => id === "sleep-context")).toBe(true);
    expect(selected.requiredFindingIds).toContain("sleep-context");
    expect(selected.evidence.map(({ id }) => id)).toContain("current-sleep");
    expect(selected.evidence.map(({ id }) => id)).toContain("previous-sleep");
    for (const answer of [
      localTarvisEvidenceFallback(selected),
      parseTarvisEvidenceSelectionResult(JSON.stringify({ findingIds: ["crowded-0"] }), selected).answer,
      parseTarvisEvidenceSelectionResult(JSON.stringify({ findingIds: [] }), selected).answer,
      parseTarvisEvidenceSelectionResult("not-json", selected).answer,
    ]) {
      expect(answer.answer).toContain("Recorded sleep sessions averaged");
      expect(answer.evidenceIds).toContain("current-sleep");
      expect(answer.evidenceIds).toContain("previous-sleep");
      expect(answer.answer).not.toContain("No recorded sleep summary");
    }
  });

  it("retains a recent-only sleep observation without implying a prior comparison", () => {
    const selected = packet(true, false);
    expect(selected.requiredFindingIds).toContain("recorded-sleep-current-period");
    const answer = parseTarvisEvidenceSelectionResult(JSON.stringify({ findingIds: [] }), selected).answer;
    expect(answer.answer).toContain("Sleep recorded in this period");
    expect(answer.answer).toContain("preceding comparison period has no sleep record");
    expect(answer.evidenceIds).toContain("current-sleep");
  });

  it.each(["bedtime", "sleeping"])(
    "retains requested %s records through category filtering and answer selection",
    (subject) => {
      const question = `Review patterns in my glucose and ${subject} records over the last 7 days, including missing data.`;
      const selected = packet(true, true, true, question);
      expect(selected.requiredFindingIds).toContain("sleep-context");
      expect(selected.findings.some(({ category }) => category === "sleep")).toBe(true);
      const answer = parseTarvisEvidenceSelectionResult(
        JSON.stringify({ findingIds: [] }), selected,
      ).answer;
      expect(answer.answer).toContain("Recorded sleep sessions averaged");
      expect(answer.evidenceIds).toContain("current-sleep");
    },
  );

  it("states when existing required findings exhaust the safe selection limit", () => {
    const required = Array.from({ length: 6 }, (_, index) => `crowded-${index}`);
    const selected = packet(true, true, true, QUESTION, required);
    expect(selected.requiredFindingIds).toEqual(required);
    expect(selected.findings.some(({ category }) => category === "sleep")).toBe(true);
    for (const answer of [
      localTarvisEvidenceFallback(selected),
      parseTarvisEvidenceSelectionResult(JSON.stringify({ findingIds: ["sleep-context"] }), selected).answer,
    ]) {
      expect(answer.answer).toContain("recorded sleep finding is available");
      expect(answer.answer).toContain("could not include its supporting evidence");
      expect(answer.evidenceIds).not.toContain("current-sleep");
      expect(answer.evidenceIds.length).toBeLessThanOrEqual(12);
    }
  });

  it("explains a previous-only sleep summary without claiming there was no recent sleep", () => {
    const selected = packet(false, true);
    expect(selected.findings.some(({ category }) => category === "sleep")).toBe(false);
    const answer = localTarvisEvidenceFallback(selected);
    expect(answer.answer).toContain("A sleep summary is available for the previous period");
    expect(answer.answer).toContain("does not prove that no sleep occurred recently");
    expect(answer.limitations.join(" ")).toContain("sleep cannot be compared");
  });

  it("explains absent sleep summaries without treating missing records as no sleep", () => {
    const selected = packet(false, false);
    const answer = parseTarvisEvidenceSelectionResult(JSON.stringify({ findingIds: [] }), selected).answer;
    expect(answer.answer).toContain("No recorded sleep summary is available for either period");
    expect(answer.answer).toContain("does not prove that no sleep occurred");
    expect(answer.evidenceIds.every((id) => !id.includes("sleep"))).toBe(true);
  });
});
