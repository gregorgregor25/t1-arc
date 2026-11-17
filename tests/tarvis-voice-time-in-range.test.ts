import { describe, expect, it } from "vitest";

import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { routeTarvisIntent } from "@/data/tarvis/onDeviceRouting";

// A synthetic evening in London.
const NOW = Date.parse("2030-04-16T19:00:00+01:00");
const options = { now: NOW, timezone: "Europe/London" } as const;

function metricsOf(question: string) {
  const resolution = resolveTarvisIntent(question, options);
  return resolution.intent.metrics.map(({ value }) => value);
}

describe("speech-to-text forms of time in range", () => {
  it.each([
    "What's my timing range been over the last 7 days?",
    "What was my time and range over the last 7 days?",
    "What was my time in rage over the last 7 days?",
    "What was my time-in-range over the last 7 days?",
    "What was my Time And Range last week?",
    "timing range last 14 days",
  ])("reads %s as time in range and answers it on the phone", (question) => {
    const resolution = resolveTarvisIntent(question, options);
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    expect(resolution.intent.metrics.map(({ value }) => value)).toEqual([
      "glucose.time_in_range",
    ]);
    expect(routeTarvisIntent(resolution)).toEqual({ kind: "scoped-glucose" });
  });

  it("gives the same period as the typed question", () => {
    const typed = resolveTarvisIntent("What was my time in range over the last 7 days?", options);
    const spoken = resolveTarvisIntent("What's my timing range been over the last 7 days?", options);
    expect(spoken.intent.temporalScope?.value).toEqual(typed.intent.temporalScope?.value);
  });

  it.each([
    ["What was my average glucose over the last 7 days?", ["glucose.mean"]],
    ["How many lows did I have in the last 7 days?", ["glucose.low_episodes"]],
    ["What was my highest glucose over the last 7 days?", ["glucose.maximum"]],
    ["How much time below range did I have in the last 7 days?", ["glucose.time_in_range"]],
  ])("leaves other metrics alone: %s", (question, metrics) => {
    expect(metricsOf(question)).toEqual(metrics);
  });

  it("does not turn unrelated words into time in range", () => {
    expect(metricsOf("What was my insulin timing yesterday?")).not.toContain("glucose.time_in_range");
    expect(metricsOf("How much did my glucose range over the last 7 days?")).not.toContain(
      "glucose.time_in_range",
    );
  });
});
