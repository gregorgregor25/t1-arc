import { describe, expect, it, vi } from "vitest";

import {
  insightRangeReferenceTime,
  insightRequestKey,
  insightStateForRequest,
} from "@/hooks/useInsights";
import { zonedDateTimeToTimestamp } from "@/domain/time";

vi.mock("@/providers/DataProvider", () => ({ useDataContext: vi.fn() }));
vi.mock("@/data/insights/loadInsightReport", () => ({
  loadInsightReport: vi.fn(),
}));

describe("insight request state", () => {
  it("does not move a completed range with the UI clock", () => {
    const shortlyAfterMidnight = zonedDateTimeToTimestamp("2026-08-19", 0, 1);
    const laterThatDay = zonedDateTimeToTimestamp("2026-08-19", 18);

    expect(insightRangeReferenceTime("2026-08-18", shortlyAfterMidnight)).toBe(
      insightRangeReferenceTime("2026-08-18", laterThatDay),
    );
    expect(insightRequestKey(7, "2026-08-18", "live")).toBe(
      insightRequestKey(7, "2026-08-18", "live"),
    );
  });

  it("continues moving a range that ends today without changing its selection", () => {
    const firstClock = zonedDateTimeToTimestamp("2026-08-19", 10);
    const nextClock = firstClock + 30_000;

    expect(insightRangeReferenceTime("2026-08-19", firstClock)).toBe(
      firstClock,
    );
    expect(insightRangeReferenceTime("2026-08-19", nextClock)).toBe(nextClock);
    expect(insightRequestKey(7, "2026-08-19", "live")).toBe(
      insightRequestKey(7, "2026-08-19", "live"),
    );
  });

  it("does not expose a report resolved for another period or repository", () => {
    const firstRepository = {};
    const secondRepository = {};
    const state = {
      loading: false,
      owner: firstRepository,
      report: { generatedAt: 10 } as never,
      requestKey: "period-a",
    };

    expect(insightStateForRequest(state, "period-b", firstRepository)).toEqual({
      loading: true,
      owner: firstRepository,
      requestKey: "period-b",
    });
    expect(insightStateForRequest(state, "period-a", secondRepository)).toEqual(
      {
        loading: true,
        owner: secondRepository,
        requestKey: "period-a",
      },
    );
    expect(insightStateForRequest(state, "period-a", firstRepository)).toBe(
      state,
    );
  });
});
