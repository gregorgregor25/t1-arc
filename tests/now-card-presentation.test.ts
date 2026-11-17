import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  lowReadingMessage,
  nowCardSourceName,
  nowCardState,
  staleReadingMessage,
} from "@/components/nowCardPresentation";

describe("Today Now card presentation", () => {
  it("gives every state a word and a shape, never colour alone", () => {
    expect(nowCardState("target", "current")).toEqual({ mode: "normal", word: "In range", shape: "circle" });
    expect(nowCardState("high", "current")).toEqual({ mode: "normal", word: "High", shape: "triangle-up" });
    expect(nowCardState("veryHigh", "delayed")).toEqual({ mode: "normal", word: "Very high", shape: "triangle-up" });
    expect(nowCardState("low", "current")).toEqual({ mode: "low", word: "Low", shape: "triangle-down" });
    expect(nowCardState("veryLow", "current")).toEqual({ mode: "low", word: "Very low", shape: "triangle-down" });
  });

  it("treats a stale or missing reading as no new reading, whatever its old value", () => {
    expect(nowCardState("stale", "stale")).toEqual({ mode: "stale", word: "No new reading", shape: "ring" });
    expect(nowCardState("veryLow", "stale").mode).toBe("stale");
    expect(nowCardState("target", "missing").mode).toBe("stale");
  });

  it("names the source without guessing at the cause", () => {
    expect(nowCardSourceName("aaps-local")).toBe("AAPS");
    expect(nowCardSourceName(undefined)).toBeUndefined();
    expect(staleReadingMessage("AAPS", "08:14")).toBe(
      "AAPS has not sent a glucose reading since 08:14. Check your sensor and AAPS. Use a meter if you need a reading now.",
    );
    expect(staleReadingMessage(undefined, "08:14")).toBe(
      "Your glucose source has not sent a glucose reading since 08:14. Check your sensor and glucose source. Use a meter if you need a reading now.",
    );
  });

  it("states which configured level a low value is below", () => {
    expect(lowReadingMessage("low", "3.9 mmol/L")).toBe("Below your low level of 3.9 mmol/L.");
    expect(lowReadingMessage("veryLow", "3.0 mmol/L")).toBe("At or below your very low level of 3.0 mmol/L.");
  });

  it("puts the connection fix before the meter reading and keeps the hypo log one tap away", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/CurrentGlucoseCard.tsx"), "utf8");
    expect(source.indexOf("Check the connection")).toBeGreaterThan(0);
    expect(source.indexOf("Check the connection")).toBeLessThan(source.indexOf("Log a meter reading"));
    expect(source).toContain("Log hypo treatment");
    expect(source).toContain("textDecorationLine: 'line-through'");
    // Trend details stay reachable by tapping the number.
    expect(source).toContain('testID="now-card-reading"');
    expect(source).toContain("Close trend details");
  });
});

describe("sensor change action near sensor end", () => {
  it("comes forward on the last expected day only when an expected life is chosen", async () => {
    const { sensorChangeDue } = await import("@/domain/deviceAge");
    const day = 86_400_000;
    const start = Date.parse("2026-11-01T08:00:00Z");
    const chip = { kind: "sensor" as const, startedAt: start } as Parameters<typeof sensorChangeDue>[0][number];
    expect(sensorChangeDue([chip], start + 8.5 * day, 10)).toBe(false); // day 9 of 10
    expect(sensorChangeDue([chip], start + 9.5 * day, 10)).toBe(true); // day 10 of 10
    expect(sensorChangeDue([chip], start + 12 * day, 10)).toBe(true); // past expected life
    expect(sensorChangeDue([chip], start + 12 * day, null)).toBe(false);
    expect(sensorChangeDue([], start + 12 * day, 10)).toBe(false);
  });
});
