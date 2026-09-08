import { describe, expect, it } from "vitest";
import { TARVIS_VOICE_GUIDANCE } from "@/data/tarvis/voice";
import { TARVIS_SYSTEM_PROMPT } from "@/data/tarvis/prompt";
import { TARVIS_GENERAL_EDUCATION_PROMPT } from "@/data/tarvis/generalEducation";
import { buildLocalGlucoseRangeAnswer } from "@/data/tarvis/localGlucoseRangeAnswer";
import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import type { GlucoseReading } from "@/domain/models";

describe("Tarv1s shared conversational voice", () => {
  it.each([TARVIS_SYSTEM_PROMPT, TARVIS_GENERAL_EDUCATION_PROMPT])(
    "uses the same concise, non-patronising voice without weakening safety",
    (prompt) => {
      expect(prompt).toContain(TARVIS_VOICE_GUIDANCE);
      expect(prompt).toContain("No compulsory closing question");
      expect(prompt).toContain("Keep important uncertainty and missing data visible");
      expect(prompt).toContain("Never use pet names");
      expect(prompt).toContain("treatment or dosing instructions");
    },
  );

  it("retains open-ended general health questions and locally grounded personal answers", () => {
    expect(TARVIS_GENERAL_EDUCATION_PROMPT).toContain("not a fixed question list");
    expect(TARVIS_GENERAL_EDUCATION_PROMPT).toContain("no personal health records");
    expect(TARVIS_SYSTEM_PROMPT).toContain("Do not write personal or medical prose");
    expect(TARVIS_SYSTEM_PROMPT).toContain("Prefer empty leadText and bridgeText");
    expect(TARVIS_SYSTEM_PROMPT).toContain("copying their exact evidenceIds and knowledgeIds");
  });

  it.each([true, false])("keeps simple calculations local and their coverage visible (complete=%s)", (complete) => {
    const start = Date.parse("2026-08-07T00:00:00+01:00");
    const asOf = start + 60 * 60_000;
    const resolution = resolveTarvisIntent("What was my average glucose today?", {
      now: asOf,
      timezone: "Europe/London",
    });
    if (!isReadyTarvisIntent(resolution)) throw new Error("Expected local calculation");
    const readings: GlucoseReading[] = Array.from({ length: complete ? 12 : 1 }, (_, index) => ({
      id: `reading-${index}`,
      timestamp: start + index * 5 * 60_000,
      receivedAt: start + index * 5 * 60_000,
      mmolL: 6.6,
      sourceId: "test-cgm",
      quality: "measured",
      trend: "unknown",
    }));
    const result = buildLocalGlucoseRangeAnswer({ asOf, intent: resolution.intent, readings });
    expect(result.answer.headline).toBe(`${complete ? "Your" : "Observed"} average glucose: 6.6 mmol/L`);
    expect(result.answer.answer).toContain("your average glucose from the available readings was 6.6 mmol/L");
    expect(result.answer.answer).toContain("observed sensor coverage");
    expect(result.answer.answer).not.toMatch(/arithmetic mean|treatment recommendation|great question/i);
    expect(result.answer.answer.indexOf("6.6 mmol/L")).toBeLessThan(result.answer.answer.indexOf("observed sensor coverage"));
    expect(result.answer.confidence).toBe(complete ? "high" : "limited");
    expect(result.answer.evidenceIds).toEqual(result.evidence.map(({ id }) => id));
    expect(result.evidence[0]?.recordIds).toEqual(readings.map(({ id }) => id));
    if (!complete) expect(result.answer.limitations.join(" ")).toContain("less than 70% sensor coverage");
  });
});
