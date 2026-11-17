import { afterEach, describe, expect, it } from "vitest";

import { isReadyTarvisIntent, resolveTarvisIntent } from "@/data/tarvis/intent";
import { rangeForRetrospectiveEventQuestion } from "@/data/tarvis/retrospectiveEventReview";
import {
  findRecentWeekPhrases,
  hasRecentWeekPhrase,
} from "@/data/tarvis/recentWeekPhrase";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";
import { addDays, multiDayRange, toDateKey } from "@/domain/time";

// A synthetic Tuesday afternoon in London.
const TUESDAY = Date.parse("2030-04-16T15:00:00+01:00");
const options = { now: TUESDAY, timezone: "Europe/London" } as const;

afterEach(() => {
  setRuntimeRegionalProfile(DEFAULT_REGIONAL_PROFILE);
});

function scopeOf(question: string) {
  const resolution = resolveTarvisIntent(question, options);
  if (!isReadyTarvisIntent(resolution)) {
    throw new Error(`Expected a ready intent for: ${question}`);
  }
  return resolution.intent.temporalScope.value;
}

describe("the past week means the last 7 local days", () => {
  it.each([
    "What was my average glucose over the past week?",
    "What was my average glucose in the last week?",
    "What was my time in range during the last week?",
    "Average glucose past week",
  ])("resolves %s to the 7 days ending today", (question) => {
    expect(scopeOf(question)).toEqual({
      kind: "recent_local_days",
      count: 7,
      include: "through_now",
    });
  });

  it("keeps bare last week as the previous calendar week", () => {
    expect(scopeOf("What was my average glucose last week?")).toEqual({
      kind: "calendar_period",
      period: "last_week",
    });
  });

  it("matches the same phrases as last 7 days", () => {
    expect(scopeOf("What was my average glucose over the last 7 days?")).toEqual(
      scopeOf("What was my average glucose over the past week?"),
    );
  });

  it("does not treat a named calendar week as a recent window", () => {
    expect(hasRecentWeekPhrase("the last week of March")).toBe(false);
    expect(hasRecentWeekPhrase("last week")).toBe(false);
    expect(hasRecentWeekPhrase("previous week")).toBe(false);
    expect(findRecentWeekPhrases("Over the past week and in the last week").map((p) => p.raw)).toEqual([
      "the past week",
      "the last week",
    ]);
  });

  it("gives event reviews the same 7 days, ending today", () => {
    const range = rangeForRetrospectiveEventQuestion(
      "Why did I go low over the past week?",
      TUESDAY,
    );
    const today = toDateKey(TUESDAY);
    expect(range).toEqual(multiDayRange(today, 7, TUESDAY));
    expect(toDateKey(range.start)).toBe(addDays(today, -6));
    expect(range.end).toBe(TUESDAY);

    const calendar = rangeForRetrospectiveEventQuestion(
      "Why did I go low last week?",
      TUESDAY,
    );
    expect(calendar.end).toBeLessThan(TUESDAY);
  });

  it("uses 7 date keys across a clock change", () => {
    // UK clocks go forward on the last Sunday of March.
    const afterChange = Date.parse("2030-04-01T12:00:00+01:00");
    const range = multiDayRange(toDateKey(afterChange), 7, afterChange);
    expect(toDateKey(range.start)).toBe("2030-03-26");
    const resolution = resolveTarvisIntent(
      "Average glucose over the past week",
      { now: afterChange, timezone: "Europe/London" },
    );
    expect(isReadyTarvisIntent(resolution)).toBe(true);
    if (isReadyTarvisIntent(resolution)) {
      expect(resolution.intent.temporalScope.value).toMatchObject({ count: 7 });
    }
  });
});
