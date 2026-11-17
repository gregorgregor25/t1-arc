import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createManualContextEvent,
  isManualKetoneEvent,
  isManualMeterReadingEvent,
  manualContextDraftFromEvent,
  meterReadingMmolLFromInput,
  reviseManualContextEvent,
} from "@/data/manualContext";
import { contextNoteDisplayTitle } from "@/domain/contextNotes";
import { gmiSummary } from "@/domain/gmiSummary";
import type { ContextNoteEvent, HealthContextEvent } from "@/domain/models";
import { calculateGlucoseStats } from "@/domain/stats";

const timestamp = Date.parse("2026-11-17T08:30:00Z");
const mmol = { locale: "en-GB", glucoseUnit: "mmolL" } as const;
const mgdl = { locale: "en-US", glucoseUnit: "mgDl" } as const;

function meter(value = 5.4, unit: "mmolL" | "mgDl" = "mmolL") {
  return createManualContextEvent(
    { kind: "meter-glucose", timestamp, glucoseMmolL: value, enteredUnit: unit },
    { id: "meter-1", recordedAt: timestamp + 1_000 },
  ) as ContextNoteEvent;
}

describe("manual meter (fingerstick) readings", () => {
  it("is stored as a traceable manual note with a canonical value and provenance", () => {
    const event = meter();
    expect(event).toMatchObject({
      id: "meter-1",
      kind: "note",
      category: "other",
      start: timestamp,
      glucoseMmolL: 5.4,
      sourceId: "t1arc-manual",
      origin: "manual",
      recordedAt: timestamp + 1_000,
    });
    expect(event.title).toMatch(/^Meter reading · /);
    expect(event.detail).toContain("fingerstick");
    expect(event.detail).toContain("not used for alarms");
    expect(event.observation).toBeUndefined();
    expect(event.sensorStarted).toBeUndefined();
  });

  it("converts mg/dL entries to canonical mmol/L and keeps the entered unit in the provenance", () => {
    expect(meterReadingMmolLFromInput(97, "mgDl")).toBeCloseTo(5.38, 2);
    expect(meterReadingMmolLFromInput(5.4, "mmolL")).toBe(5.4);
    const event = meter(meterReadingMmolLFromInput(97, "mgDl"), "mgDl");
    expect(event.detail).toContain("mg/dL");
    expect(contextNoteDisplayTitle(event, mgdl)).toBe("Meter reading · 97 mg/dL");
  });

  it("rejects impossible values and future times", () => {
    expect(() => meterReadingMmolLFromInput(0.5, "mmolL")).toThrow(/between/);
    expect(() => meterReadingMmolLFromInput(41, "mmolL")).toThrow(/between/);
    expect(() => meterReadingMmolLFromInput(Number.NaN, "mmolL")).toThrow(/between/);
    expect(() => meterReadingMmolLFromInput(800, "mgDl")).toThrow(/between/);
    expect(() =>
      createManualContextEvent({
        kind: "meter-glucose",
        timestamp: Date.now() + 10 * 60_000,
        glucoseMmolL: 5,
        enteredUnit: "mmolL",
      }),
    ).toThrow("Meter readings cannot be dated in the future.");
  });

  it("opens again as a meter reading and keeps its identity when corrected", () => {
    const event = meter();
    expect(isManualMeterReadingEvent(event)).toBe(true);
    expect(isManualKetoneEvent(event)).toBe(false);
    expect(manualContextDraftFromEvent(event)).toMatchObject({
      kind: "meter-glucose",
      glucoseMmolL: 5.4,
      timestamp,
    });
    const corrected = reviseManualContextEvent(event, {
      kind: "meter-glucose",
      timestamp,
      glucoseMmolL: 5.9,
      enteredUnit: "mmolL",
    });
    expect(corrected).toMatchObject({ id: "meter-1", recordedAt: timestamp + 1_000, glucoseMmolL: 5.9 });
    expect(() =>
      reviseManualContextEvent(event, { kind: "note", timestamp, category: "other" }),
    ).toThrow("The type of an existing context entry cannot be changed.");
  });

  it("is labelled as a meter reading, while imported meter checks keep their source wording", () => {
    expect(contextNoteDisplayTitle(meter(), mmol)).toBe("Meter reading · 5.4 mmol/L");
    const imported: ContextNoteEvent = {
      ...meter(),
      id: "glooko-1",
      sourceId: "glooko-export",
      origin: "imported",
      title: "Blood glucose check",
    };
    expect(isManualMeterReadingEvent(imported)).toBe(false);
    expect(contextNoteDisplayTitle(imported, mmol)).toBe("Blood glucose check · 5.4 mmol/L");
  });

  it("does not count as a sensor reading in time in range, statistics or GMI", () => {
    const range = { start: timestamp - 3_600_000, end: timestamp + 3_600_000 };
    const context: HealthContextEvent[] = [meter(2.5)];
    // Statistics take sensor readings only; a meter note has no path into them.
    const stats = calculateGlucoseStats([], range);
    expect(stats.observedMinutes).toBe(0);
    expect(gmiSummary([], range).percent).toBeNull();
    expect(context.every((event) => !("mmolL" in event))).toBe(true);
  });

  it("keeps sensor-only calculations and alarm inputs free of note glucose values", () => {
    const sensorOnlyModules = [
      "src/domain/stats.ts",
      "src/domain/glucoseStatistics.ts",
      "src/domain/gmiSummary.ts",
      "src/domain/glucoseAlarms.ts",
      "src/domain/trend.ts",
      "src/domain/freshness.ts",
      "src/data/glucoseAlerts/glucoseAlarms.ts",
    ];
    for (const file of sensorOnlyModules) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toContain("glucoseMmolL");
      expect(source, file).not.toContain("glucose_mmol_l");
      expect(source, file).not.toContain("isManualMeterReadingEvent");
    }
  });
});
