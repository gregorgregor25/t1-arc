import { describe, expect, it } from "vitest";

import {
  buildTarvisEvidencePacket,
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
