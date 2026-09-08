import { describe, expect, it, vi } from "vitest";
import { createDemoRepository } from "@/data/demoRepository";
import { buildInsightReport } from "@/domain/insights";
import { buildTarvisEvidencePacket, selectTarvisEvidencePacket } from "@/data/tarvis/evidencePacket";
import { focusTarvisEpisodeReviewPacket } from "@/data/tarvis/episodeReviewPacket";
import { localTarvisEvidenceFallback } from "@/data/tarvis/evidenceAnswerGuardrail";
import { serializeTarvisConversation } from "@/data/tarvis/conversationStore";

vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

describe("period review persistence", () => {
  it("saves a multi-source answer whose sleep and basal records cross midnight", async () => {
    const now = Date.parse("2026-09-07T10:00:00+01:00");
    const repository = createDemoRepository(now);
    const currentRange = { start: Date.parse("2026-09-01T00:00:00+01:00"), end: now };
    const previousRange = { start: Date.parse("2026-08-25T00:00:00+01:00"), end: currentRange.start };
    const current = await repository.getTimeline(currentRange);
    const previous = await repository.getTimeline(previousRange);
    const sleep = current.context.find((event) => event.kind === "sleep")!;
    current.context.unshift({ ...sleep, id: "crossing-sleep", start: currentRange.start - 3600000, end: currentRange.start + 3600000 });
    current.basal.unshift({ ...current.basal[0]!, id: "crossing-basal", start: currentRange.start - 1800000, end: currentRange.start + 1800000, units: 1 });
    const report = buildInsightReport(current, previous, now);
    const recordedDays = 6 + 10 / 24;
    expect(report.current.insulinUnitsPerDay).toBe(Math.round(report.current.insulinUnits! / recordedDays * 10) / 10);
    const lookup = buildTarvisEvidencePacket(report);
    const question = "Review my low glucose episodes over the last 7 days. Look at my meals, insulin, activity and sleep.";
    const packet = selectTarvisEvidencePacket(question, focusTarvisEpisodeReviewPacket(question, lookup.packet, "low"));
    const answer = localTarvisEvidenceFallback(packet);
    const evidence = answer.evidenceIds.map((id) => lookup.references.get(id)!);
    expect(evidence.some(({ examples }) => examples.some(({ id }) => id === "crossing-sleep"))).toBe(true);
    expect(() => serializeTarvisConversation([{ id: "period-review", question, answer, evidence }], now)).not.toThrow();
    expect(lookup.references.get("current-sleep")?.examples.find(({ id }) => id === "crossing-sleep")?.timestamp).toBe(currentRange.start - 3600000);
  });
});
