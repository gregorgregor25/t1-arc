import { describe, expect, it } from "vitest";

import {
  isReadyTarvisIntent,
  resolveTarvisClarificationReply,
  resolveTarvisIntent,
} from "@/data/tarvis/intent";

const NOW = Date.parse("2026-08-07T20:00:00+01:00");
const options = { now: NOW, timezone: "Europe/London" } as const;

describe("Tarv1s clarification replies", () => {
  it("fills a missing period from the immediately following reply", () => {
    const question = "What was my average glucose?";
    const pending = {
      question,
      resolution: resolveTarvisIntent(question, options),
    };
    const result = resolveTarvisClarificationReply(
      "Over the last 30 days",
      options,
      pending,
    );
    expect(isReadyTarvisIntent(result)).toBe(true);
    if (!isReadyTarvisIntent(result)) throw new Error("Expected ready intent");
    expect(result.intent.metrics[0]?.value).toBe("glucose.mean");
    expect(result.intent.temporalScope.value).toEqual({
      kind: "recent_local_days",
      count: 30,
      include: "through_now",
    });
  });

  it("understands a bare duration reply to a period clarification", () => {
    const question = "What was my average glucose?";
    const pending = {
      question,
      resolution: resolveTarvisIntent(question, options),
    };
    const result = resolveTarvisClarificationReply("30 days", options, pending);
    expect(isReadyTarvisIntent(result)).toBe(true);
    if (!isReadyTarvisIntent(result)) throw new Error("Expected ready intent");
    expect(result.intent.temporalScope.value).toMatchObject({
      kind: "recent_local_days",
      count: 30,
    });
  });

  it("replaces an ambiguous clock phrase instead of retaining both versions", () => {
    const question =
      "What was my average glucose over the last three days between 10 and 3?";
    const pending = {
      question,
      resolution: resolveTarvisIntent(question, options),
    };
    const result = resolveTarvisClarificationReply(
      "10 p.m. to 3 a.m.",
      options,
      pending,
    );
    expect(isReadyTarvisIntent(result)).toBe(true);
    if (!isReadyTarvisIntent(result)) throw new Error("Expected ready intent");
    expect(result.intent.clockWindow?.value).toMatchObject({
      start: { hour: 22, minute: 0 },
      end: { hour: 3, minute: 0 },
      crossesMidnight: true,
    });
  });

  it("preserves two named overnight windows while clarifying the metric", () => {
    const question = "Show my overnight readings for the last two nights.";
    const pending = {
      question,
      resolution: resolveTarvisIntent(question, options),
    };
    expect(pending.resolution.outcome).toMatchObject({
      status: "needs_clarification",
      code: "missing_metric",
    });

    const result = resolveTarvisClarificationReply(
      "Average readings",
      options,
      pending,
    );

    expect(isReadyTarvisIntent(result)).toBe(true);
    if (!isReadyTarvisIntent(result)) throw new Error("Expected ready intent");
    expect(result.intent.metrics[0]?.value).toBe("glucose.mean");
    expect(result.intent.temporalScope.value).toEqual({
      kind: "recent_local_days",
      count: 2,
      include: "most_recent_completed_windows",
    });
    expect(result.intent.clockWindow?.value).toMatchObject({
      start: { hour: 0, minute: 0 },
      end: { hour: 7, minute: 0 },
    });
  });

  it("does not use a pending draft when the new question is already complete", () => {
    const question = "What was my average glucose?";
    const pending = {
      question,
      resolution: resolveTarvisIntent(question, options),
    };
    const result = resolveTarvisClarificationReply(
      "How many low-glucose events did I have yesterday?",
      options,
      pending,
    );
    expect(isReadyTarvisIntent(result)).toBe(true);
    if (!isReadyTarvisIntent(result)) throw new Error("Expected ready intent");
    expect(result.intent.metrics.map(({ value }) => value)).toEqual([
      "glucose.low_episodes",
    ]);
  });
});
