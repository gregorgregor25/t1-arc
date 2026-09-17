import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as bundleModule from "@/data/tarvis/glucoseAnswerBundleV2";
import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { loadLocalCompoundAnswer } from "@/data/tarvis/localCompoundAnswer";
import {
  buildLocalGlucoseRangeAnswer,
  buildLocalGlucoseRangeComponent,
} from "@/data/tarvis/localGlucoseRangeAnswer";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import * as chartModule from "@/domain/evidenceQueryChart";
import type { GlucoseReading } from "@/domain/models";

const NOW = Date.parse("2026-09-08T18:20:50+01:00");

function ready(question: string) {
  const resolution = resolveTarvisIntent(question, {
    now: NOW,
    timezone: "Europe/London",
  });
  if (!isReadyTarvisIntent(resolution)) throw new Error(resolution.outcome.code);
  return resolution.intent;
}

function readings(count = 4_032): GlucoseReading[] {
  const start = NOW - 14 * 86_400_000;
  return Array.from({ length: count }, (_, index): GlucoseReading => {
    const timestamp = start + index * 5 * 60_000;
    const minuteOfDay = index % 288;
    return {
      id: `synthetic:${timestamp}`,
      timestamp,
      receivedAt: timestamp + 25_000,
      mmolL: minuteOfDay < 5 ? 3.3 : minuteOfDay > 280 ? 11.2 : 7,
      trend: "unknown",
      quality: "measured",
      sourceId: "synthetic-cgm",
    };
  }).filter((_, index) => index % 288 !== 120 && index % 288 !== 121);
}

describe("Exact glucose calculation-only compound components", () => {
  it.each([
    "Compare my average glucose over the last 7 days with the previous 7 days.",
    "How many low glucose episodes did I have yesterday?",
    "How many high glucose episodes did I have yesterday?",
    "What was my time in range yesterday?",
    "What was my minimum glucose yesterday?",
    "What was my median glucose yesterday?",
    "What was my glucose standard deviation yesterday?",
    "What was my GMI over the last 14 days?",
  ])("returns exactly the full answer, evidence and presentation: %s", (question) => {
    const input = { asOf: NOW, intent: ready(question), readings: readings() };
    const full = buildLocalGlucoseRangeAnswer(input);
    const { answerBundle, ...withoutBundle } = full;
    const component = buildLocalGlucoseRangeComponent(input);
    expect(component).toEqual(withoutBundle);
    expect(component).not.toHaveProperty("answerBundle");
    expectTypeOf(full.answerBundle).toEqualTypeOf<bundleModule.GlucoseAnswerBundleV2>();
    expectTypeOf(component).not.toHaveProperty("answerBundle");
    expect(() => bundleModule.assertGlucoseAnswerBundleV2(answerBundle)).not.toThrow();
    expect(Object.isFrozen(answerBundle)).toBe(true);
    expect(Object.isFrozen(answerBundle.records[0])).toBe(true);
    expect(full.evidence.every((reference) => full.answer.evidenceIds.includes(reference.id))).toBe(true);
  });

  it("preserves missing-data semantics exactly without manufacturing a bundle", () => {
    const input = { asOf: NOW, intent: ready("What was my average glucose yesterday?"), readings: [] };
    const { answerBundle: _bundle, ...expected } = buildLocalGlucoseRangeAnswer(input);
    expect(buildLocalGlucoseRangeComponent(input)).toEqual(expected);
    expect(expected.answer.confidence).toBe("limited");
    expect(expected.presentation.windows[0]!.metrics[0]!.value).toBeNull();
  });

  it("does not call the bundle constructor for the screenshot compound, but ordinary callers still do", async () => {
    const plan = coordinateTarvisRequest({
      question: "What was my average glucose over the last 7 days compared to the previous 7 days, and how many periods of low sugar did I have in those periods?",
      asOf: NOW,
    });
    expect(plan.kind).toBe("scoped-compound");
    if (plan.kind !== "scoped-compound") throw new Error(plan.kind);
    const construct = vi.spyOn(bundleModule, "createGlucoseAnswerBundleV2");
    try {
      const data = readings();
      const load = vi.fn(async () => data);
      const result = await loadLocalCompoundAnswer({ asOf: NOW, intents: plan.intents, loadGlucoseReadings: load });
      expect(load).toHaveBeenCalledTimes(1);
      expect(construct).not.toHaveBeenCalled();
      const metrics = result.evidence.flatMap((reference) => reference.calculation?.metrics ?? []);
      expect(metrics.filter((metric) => metric.id === "glucose.mean")).toHaveLength(2);
      expect(metrics.filter((metric) => metric.id === "glucose.low_episodes")).toHaveLength(2);
      expect(result).not.toHaveProperty("answerBundle");
      const ordinary = buildLocalGlucoseRangeAnswer({ asOf: NOW, intent: plan.intents[0]!, readings: data });
      expect(construct).toHaveBeenCalledTimes(1);
      expect(() => bundleModule.assertGlucoseAnswerBundleV2(ordinary.answerBundle)).not.toThrow();
      expect(Object.isFrozen(ordinary.answerBundle)).toBe(true);
    } finally {
      construct.mockRestore();
    }
  });

  it("still rejects invalid metric operations, unbounded periods and invalid or duplicate glucose", () => {
    const intent = ready("What was my average glucose yesterday?");
    const input = { asOf: NOW, intent, readings: readings() };
    expect(() => buildLocalGlucoseRangeComponent({
      ...input, intent: { ...intent, operation: { ...intent.operation, value: "count_episodes" } },
    })).toThrow();
    expect(() => buildLocalGlucoseRangeComponent({ ...input, asOf: Number.NaN })).toThrow();
    expect(() => buildLocalGlucoseRangeComponent({ ...input, readings: [{ ...input.readings[0]!, mmolL: Number.NaN }] })).toThrow();
    expect(() => buildLocalGlucoseRangeComponent({ ...input, readings: [input.readings[0]!, input.readings[0]!] })).toThrow(/duplicate/i);
  });

  it("retains the exact-range chart guard even when bundle packaging is omitted", () => {
    const validate = vi.spyOn(chartModule, "isEvidenceQueryVisualizationReference").mockReturnValue(false);
    try {
      expect(() => buildLocalGlucoseRangeComponent({
        asOf: NOW, intent: ready("What was my average glucose yesterday?"), readings: readings(),
      })).toThrow(/chart failed validation/i);
    } finally {
      validate.mockRestore();
    }
  });
});
