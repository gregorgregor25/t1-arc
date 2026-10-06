import { describe, expect, it } from "vitest";
import { buildInsightReport } from "@/domain/insights";
import type { TimelineData } from "@/domain/models";
import { addDays, zonedDateTimeToTimestamp, type DateKey } from "@/domain/time";
import { buildTarvisEvidencePacket, selectTarvisEvidencePacket } from "@/data/tarvis/evidencePacket";
import { localTarvisEvidenceFallback, parseTarvisEvidenceSelectionResult } from "@/data/tarvis/evidenceAnswerGuardrail";
import { focusTarvisEpisodeReviewPacket } from "@/data/tarvis/episodeReviewPacket";

function dailyOnly(startDate: DateKey, basalUnits: number): TimelineData {
  const range = { start: zonedDateTimeToTimestamp(startDate), end: zonedDateTimeToTimestamp(addDays(startDate, 7)) };
  return {
    range, basal: [], boluses: [], context: [], sources: [],
    glucose: Array.from({ length: (range.end - range.start) / 600_000 }, (_, index) => {
      const timestamp = range.start + index * 600_000;
      return { id: `glucose:${timestamp}`, timestamp, receivedAt: timestamp, mmolL: 6.4, sourceId: "cgm", quality: "measured" as const, trend: "flat" as const };
    }),
    dailyInsulinTotals: Array.from({ length: 7 }, (_, index) => {
      const dateKey = addDays(startDate, index);
      return { id: `daily:${dateKey}`, dateKey, timestamp: zonedDateTimeToTimestamp(addDays(dateKey, 1)) - 1, basalUnits, bolusUnits: 10, totalUnits: basalUnits + 10, sourceId: "glooko-export" };
    }),
  };
}

describe("requested daily basal evidence", () => {
  it("answers with supported daily totals even when a crowded report or model selection would omit them", () => {
    const current = dailyOnly("2026-09-28", 20);
    const previous = dailyOnly("2026-09-21", 18);
    const report = buildInsightReport(current, previous, current.range.end);
    const basal = report.findings.find(({ id }) => id === "basal-daily-totals");
    expect(basal).toBeDefined();
    const generic = report.findings.find(({ category }) => category === "glucose")!;
    report.findings = [...Array.from({ length: 25 }, (_, index) => ({ ...generic, id: `crowded-${index}` })), ...report.findings];
    const question = "Review my basal and glucose patterns over the last seven days.";
    const packet = selectTarvisEvidencePacket(question, buildTarvisEvidencePacket(report, { question }).packet);
    expect(packet.requiredFindingIds).toContain("basal-daily-totals");
    for (const answer of [localTarvisEvidenceFallback(packet), parseTarvisEvidenceSelectionResult(JSON.stringify({ findingIds: ["crowded-0"] }), packet).answer]) {
      expect(answer.answer).toContain(basal!.summary);
      expect(answer.evidenceIds).toEqual(expect.arrayContaining(basal!.evidence.map(({ id }) => id)));
      expect(answer.evidenceIds.length).toBeLessThanOrEqual(12);
      expect(answer.answer).not.toContain("Uncovered basal time");
    }
    expect(packet.findings.filter(({ id }) => id === "basal-daily-totals")).toHaveLength(1);
  });

  it("does not require basal evidence when the question only requests glucose", () => {
    const current = dailyOnly("2026-09-28", 20);
    const report = buildInsightReport(current, dailyOnly("2026-09-21", 18), current.range.end);
    const packet = selectTarvisEvidencePacket("Summarise my glucose patterns", buildTarvisEvidencePacket(report).packet);
    expect(packet.requiredFindingIds ?? []).not.toContain("basal-daily-totals");
  });

  it.each([true, false])("keeps requested daily basal context in an episode review (previous totals: %s)", (hasPreviousTotals) => {
    const current = dailyOnly("2026-09-28", 20);
    const previous = dailyOnly("2026-09-21", 18);
    if (!hasPreviousTotals) previous.dailyInsulinTotals = [];
    const report = buildInsightReport(current, previous, current.range.end);
    const question = "Review my high glucose episodes and basal insulin over the last seven days.";
    const packet = focusTarvisEpisodeReviewPacket(question, buildTarvisEvidencePacket(report, { question }).packet, "high");
    expect(packet.requiredFindingIds).toContain("basal-daily-totals");
    const answer = localTarvisEvidenceFallback(packet);
    expect(answer.answer).toContain("140 U");
    expect(answer.limitations.join(" ")).not.toContain("comparable insulin summary is not available");
    expect(packet.comparison.summary).toContain("cannot establish what caused");
  });
});
