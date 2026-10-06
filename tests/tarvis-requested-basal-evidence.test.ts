import { describe, expect, it } from "vitest";
import { buildInsightReport } from "@/domain/insights";
import type { TimelineData } from "@/domain/models";
import { addDays, zonedDateTimeToTimestamp, type DateKey } from "@/domain/time";
import { buildTarvisEvidencePacket, currentPeriodTarvisEvidence, selectTarvisEvidencePacket } from "@/data/tarvis/evidencePacket";
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
  it("keeps daily basal values when glucose comparison coverage is unavailable", () => {
    const current = dailyOnly("2026-09-28", 20);
    const previous = dailyOnly("2026-09-21", 18);
    current.glucose = [];
    previous.glucose = [];
    const report = buildInsightReport(current, previous, current.range.end);
    expect(report.ready).toBe(false);
    const basal = report.findings.find(({ id }) => id === "basal-daily-totals");
    expect(basal?.currentPeriodSummary).toContain("2026-09-28: 20 U");
    const question = "What do my daily basal totals show over the last seven completed days?";
    const scoped = currentPeriodTarvisEvidence(buildTarvisEvidencePacket(report, { question }), report, question);
    const packet = selectTarvisEvidencePacket(question, scoped.packet);
    expect(packet.comparison.headline).toBe("Daily basal totals in the requested period");
    expect(packet.findings.find(({ id }) => id === "basal-daily-totals")?.summary).toContain("2026-10-04: 20 U");
    expect(localTarvisEvidenceFallback(packet).answer).toContain("140 U");
    expect(JSON.stringify(packet)).not.toContain("2026-09-21");
  });

  it("keeps both periods' daily basal totals for an explicit comparison despite sparse CGM", () => {
    const current = dailyOnly("2026-09-28", 20);
    const previous = dailyOnly("2026-09-21", 18);
    current.glucose = [];
    previous.glucose = [];
    const report = buildInsightReport(current, previous, current.range.end);
    const question = "Compare my daily basal totals over the last seven completed days with the previous seven days.";
    const packet = selectTarvisEvidencePacket(question, buildTarvisEvidencePacket(report, { question }).packet);
    const answer = localTarvisEvidenceFallback(packet).answer;
    expect(answer).toContain("140 U");
    expect(answer).toContain("126 U");
    expect(packet.comparison.previous).toBeDefined();
    expect(packet.evidence.map(({ id }) => id)).toContain("previous-basal-daily-totals");
  });

  it("does not quote previous basal totals when that period's insulin source is marked missing", () => {
    const current = dailyOnly("2026-09-28", 20);
    const previous = dailyOnly("2026-09-21", 18);
    current.glucose = [];
    previous.glucose = [];
    previous.sources = [{ id: "missing-insulin", label: "Insulin", detail: "Not connected",
      freshness: "missing", origin: "delayed", isLive: false }];
    const report = buildInsightReport(current, previous, current.range.end);
    const question = "Compare my daily basal totals over the last seven completed days with the previous seven days.";
    const packet = selectTarvisEvidencePacket(question, buildTarvisEvidencePacket(report, { question }).packet);
    const answer = localTarvisEvidenceFallback(packet).answer;
    expect(answer).toContain("Previous-period daily basal totals are unavailable");
    expect(answer).not.toContain("126 U");
    expect(packet.evidence.map(({ id }) => id)).not.toContain("previous-basal-daily-totals");
  });

  it.each([false, true])("reports missing current daily totals without exposing previous totals or treating them as zero (sparse CGM: %s)", (sparseCgm) => {
    const current = dailyOnly("2026-09-28", 20);
    current.dailyInsulinTotals = [];
    const previous = dailyOnly("2026-09-21", 91);
    if (sparseCgm) {
      current.glucose = [];
      previous.glucose = [];
    }
    const report = buildInsightReport(current, previous, current.range.end);
    const question = "What do my daily basal totals show over the last seven completed days?";
    const packet = selectTarvisEvidencePacket(question,
      currentPeriodTarvisEvidence(buildTarvisEvidencePacket(report, { question }), report, question).packet);
    const answer = localTarvisEvidenceFallback(packet).answer;
    expect(answer).toContain("no usable source-reported basal total");
    expect(answer).toContain("not counted as zero");
    expect(JSON.stringify(packet)).not.toContain("91 U");
    expect(JSON.stringify(packet)).not.toContain("2026-09-21");
    expect(packet.comparison.previous).toBeUndefined();
  });

  it("explains when neither period has usable source-reported basal totals", () => {
    const current = dailyOnly("2026-09-28", 20);
    const previous = dailyOnly("2026-09-21", 18);
    current.dailyInsulinTotals = [];
    previous.dailyInsulinTotals = [];
    const report = buildInsightReport(current, previous, current.range.end);
    const question = "What do my daily basal totals show over the last seven completed days?";
    const packet = selectTarvisEvidencePacket(question,
      currentPeriodTarvisEvidence(buildTarvisEvidencePacket(report, { question }), report, question).packet);
    expect(localTarvisEvidenceFallback(packet).answer).toContain("No usable source-reported daily basal totals are available");
    expect(JSON.stringify(packet)).not.toContain("Previous period");
    expect(packet.evidence.find(({ id }) => id === "current-basal-data-availability")?.recordCount).toBe(0);
    expect(packet.comparison.current.basalUnitsPerDay).toBeUndefined();
  });

  it("retains every selected daily basal amount in the bounded answer evidence", () => {
    const current = dailyOnly("2026-09-28", 20);
    current.dailyInsulinTotals = current.dailyInsulinTotals!.map((total, index) => ({
      ...total,
      basalUnits: 10 + index,
      totalUnits: 20 + index,
    }));
    const first = current.dailyInsulinTotals[0]!;
    current.dailyInsulinTotals.unshift({
      ...first,
      id: "older-duplicate",
      timestamp: first.timestamp - 60_000,
      basalUnits: 99,
      totalUnits: 109,
    });
    const previous = dailyOnly("2026-09-21", 18);
    const question = "What do my daily basal totals show over the last seven completed days?";
    const report = buildInsightReport(current, previous, current.range.end);
    const packet = selectTarvisEvidencePacket(question, buildTarvisEvidencePacket(report, { question }).packet);
    const basalFinding = packet.findings.find(({ id }) => id === "basal-daily-totals");
    expect(basalFinding).toBeDefined();
    for (let index = 0; index < 7; index++) {
      const datedValue = `${addDays("2026-09-28", index)}: ${10 + index} U`;
      expect(basalFinding?.summary).toContain(datedValue);
      expect(localTarvisEvidenceFallback(packet).answer).toContain(datedValue);
    }
    expect(basalFinding?.summary).not.toContain("99 U");
    expect(basalFinding?.caveat).toContain("not a timestamped basal delivery timeline");
  });

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
