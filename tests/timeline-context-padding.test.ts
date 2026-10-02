import { describe, expect, it, vi } from "vitest";

import type { DiabetesRepository } from "@/data/contracts";
import type { HealthContextEvent, TimeRange, TimelineData } from "@/domain/models";
import {
  loadTimelineWithContext,
  paddedContextRange,
} from "@/domain/timelineContextLoading";

const visibleRange: TimeRange = { start: 4 * 3_600_000, end: 8 * 3_600_000 };
const nearbyMeal = {
  id: "meal-before-window",
  kind: "meal",
  title: "Breakfast",
  start: visibleRange.start - 15 * 60_000,
  mealType: "breakfast",
  sourceId: "t1arc-food",
  origin: "manual",
} as HealthContextEvent;

function timeline(range: TimeRange, context: HealthContextEvent[] = []): TimelineData {
  return {
    range,
    glucose: [{ id: "reading", timestamp: visibleRange.start + 60_000, mmolL: 7.2 } as TimelineData["glucose"][number]],
    basal: [],
    boluses: [],
    context,
    sources: [],
  };
}

describe("timeline context padding", () => {
  it("includes a meal before the visible edge without extending plotted readings", async () => {
    const getTimeline = vi.fn(async (range: TimeRange) =>
      range.start < visibleRange.start
        ? timeline(range, [nearbyMeal])
        : timeline(range),
    );
    const repository = { getTimeline } as unknown as DiabetesRepository;
    const result = await loadTimelineWithContext(
      repository,
      visibleRange,
      45 * 60_000,
      visibleRange.end + 20 * 60_000,
    );

    expect(result.range).toEqual(visibleRange);
    expect(result.glucose).toHaveLength(1);
    expect(result.context).toEqual([nearbyMeal]);
    expect(getTimeline).toHaveBeenCalledWith(visibleRange);
    expect(getTimeline).toHaveBeenCalledWith({
      start: visibleRange.start - 45 * 60_000,
      end: visibleRange.end + 20 * 60_000,
    });
  });

  it("does not query beyond the current time", () => {
    expect(paddedContextRange(visibleRange, 45 * 60_000, visibleRange.end)).toEqual({
      start: visibleRange.start - 45 * 60_000,
      end: visibleRange.end,
    });
  });

  it("rejects when the padded context query fails", async () => {
    const getTimeline = vi.fn(async (range: TimeRange) => {
      if (range.start < visibleRange.start) throw new Error("Context unavailable");
      return timeline(range);
    });
    const repository = { getTimeline } as unknown as DiabetesRepository;
    await expect(
      loadTimelineWithContext(repository, visibleRange, 45 * 60_000),
    ).rejects.toThrow("Context unavailable");
  });
});
