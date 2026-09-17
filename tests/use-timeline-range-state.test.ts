import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginTimelineRangeLoad,
  latestStateAtNow,
  latestStateForRepository,
  loadLatestSnapshot,
  RangeTimelineState,
  timelineRequestKey,
  timelineRangeKey,
  timelineStateForRange,
} from "@/hooks/useTimeline";
import { DataSourceStatus, TimelineData } from "@/domain/models";
import type { DiabetesRepository } from "@/data/contracts";

vi.mock("@/providers/DataProvider", () => ({ useDataContext: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
});

function timeline(start: number, end: number): TimelineData {
  return {
    range: { start, end },
    glucose: [],
    basal: [],
    boluses: [],
    context: [],
    sources: [],
  };
}

describe("timeline range state", () => {
  it("keeps a moving endpoint under the same logical selection key", () => {
    const selectionKey = "today:2026-08-19:timeline:6h";
    const firstRange = { start: 1_000, end: 2_000 };
    const refreshedRange = { start: 1_030, end: 2_030 };

    expect(timelineRequestKey(firstRange, selectionKey)).toBe(selectionKey);
    expect(timelineRequestKey(refreshedRange, selectionKey)).toBe(selectionKey);
    expect(timelineRequestKey(firstRange)).not.toBe(
      timelineRequestKey(refreshedRange),
    );
  });

  it("does not expose previous-range data under a new requested range", () => {
    const firstRange = { start: 1_000, end: 2_000 };
    const secondRange = { start: 2_000, end: 3_000 };
    const state: RangeTimelineState = {
      data: timeline(firstRange.start, firstRange.end),
      loading: false,
      rangeKey: timelineRangeKey(firstRange),
    };

    expect(timelineStateForRange(state, timelineRangeKey(secondRange))).toEqual(
      { loading: true },
    );
    expect(
      beginTimelineRangeLoad(state, timelineRangeKey(secondRange)),
    ).toEqual({
      loading: true,
      rangeKey: timelineRangeKey(secondRange),
    });
  });

  it("preserves resolved data while the same range is revalidated", () => {
    const range = { start: 1_000, end: 2_000 };
    const data = timeline(range.start, range.end);
    const state: RangeTimelineState = {
      data,
      error: "Previous refresh failed.",
      loading: false,
      rangeKey: timelineRangeKey(range),
    };

    expect(beginTimelineRangeLoad(state, timelineRangeKey(range))).toEqual({
      data,
      error: undefined,
      loading: false,
      rangeKey: timelineRangeKey(range),
    });
    expect(timelineStateForRange(state, timelineRangeKey(range))).toBe(state);
  });

  it("never exposes timeline or latest glucose from a previous repository", () => {
    const previousRepository = {};
    const requestedRepository = {};
    const range = { start: 1_000, end: 2_000 };
    const state: RangeTimelineState = {
      data: timeline(range.start, range.end),
      loading: false,
      owner: previousRepository,
      rangeKey: timelineRangeKey(range),
    };

    expect(
      timelineStateForRange(
        state,
        timelineRangeKey(range),
        requestedRepository,
      ),
    ).toEqual({ loading: true });
    expect(
      beginTimelineRangeLoad(
        state,
        timelineRangeKey(range),
        requestedRepository,
      ),
    ).toEqual({
      loading: true,
      owner: requestedRepository,
      rangeKey: timelineRangeKey(range),
    });

    const latest = latestStateForRepository(
      {
        loading: false,
        owner: previousRepository,
        reading: {
          id: "demo-reading",
          mmolL: 6,
          quality: "measured",
          receivedAt: 1_500,
          sourceId: "demo",
          timestamp: 1_500,
          trend: "flat",
        },
        sources: [],
      },
      requestedRepository,
    );
    expect(latest).toEqual({
      loading: true,
      owner: requestedRepository,
      sources: [],
    });
  });

  it("coalesces mounted screens within a tick and rereads on the next tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 7, 19, 12));
    const getLatestGlucose = vi.fn().mockResolvedValue(undefined);
    const getSourceStatuses = vi.fn().mockResolvedValue([]);
    const repository = {
      refresh: vi.fn(),
      getTimeline: vi.fn(),
      getLatestGlucose,
      getSourceStatuses,
    } as DiabetesRepository;

    const firstEpoch = Date.now();
    const first = loadLatestSnapshot(repository, 4, firstEpoch);
    const second = loadLatestSnapshot(repository, 4, firstEpoch);

    expect(first).toBe(second);
    await Promise.all([first.reading, first.sources]);
    expect(getLatestGlucose).toHaveBeenCalledTimes(1);
    expect(getSourceStatuses).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.UTC(2026, 7, 19, 12, 0, 30));
    const sameRevision = loadLatestSnapshot(repository, 4, Date.now());
    await Promise.all([sameRevision.reading, sameRevision.sources]);
    expect(sameRevision).not.toBe(first);
    expect(getLatestGlucose).toHaveBeenCalledTimes(2);
    expect(getSourceStatuses).toHaveBeenCalledTimes(2);

    const nextRevision = loadLatestSnapshot(repository, 5, Date.now());
    await Promise.all([nextRevision.reading, nextRevision.sources]);
    expect(getLatestGlucose).toHaveBeenCalledTimes(3);
    expect(getSourceStatuses).toHaveBeenCalledTimes(3);
  });

  it("retries a rejected latest snapshot at the same revision", async () => {
    const currentReading = {
      id: "headless-current",
      sourceId: "t1arc-librelinkup",
      timestamp: Date.UTC(2026, 7, 24, 20, 4),
      receivedAt: Date.UTC(2026, 7, 24, 20, 4),
      mmolL: 9.9,
      trend: "slightUp" as const,
      quality: "measured" as const,
    };
    const getLatestGlucose = vi
      .fn()
      .mockRejectedValueOnce(new Error("database is busy"))
      .mockResolvedValueOnce(currentReading);
    const getSourceStatuses = vi.fn().mockResolvedValue([]);
    const repository = {
      refresh: vi.fn(),
      getTimeline: vi.fn(),
      getLatestGlucose,
      getSourceStatuses,
    } as DiabetesRepository;

    const epoch = Date.UTC(2026, 7, 24, 20, 4);
    const failed = loadLatestSnapshot(repository, 9, epoch);
    await expect(failed.reading).rejects.toThrow("database is busy");

    const retry = loadLatestSnapshot(repository, 9, epoch);
    expect(retry).not.toBe(failed);
    await expect(retry.reading).resolves.toEqual(currentReading);
    expect(getLatestGlucose).toHaveBeenCalledTimes(2);
    expect(getSourceStatuses).toHaveBeenCalledTimes(2);
  });

  it("replaces a successful stale snapshot on the next clock tick", async () => {
    const staleReading = {
      id: "foreground-stale",
      sourceId: "t1arc-librelinkup",
      timestamp: Date.UTC(2026, 7, 24, 19, 29),
      receivedAt: Date.UTC(2026, 7, 24, 19, 29),
      mmolL: 3.7,
      trend: "flat" as const,
      quality: "measured" as const,
    };
    const currentReading = {
      ...staleReading,
      id: "headless-current",
      timestamp: Date.UTC(2026, 7, 24, 20, 4),
      receivedAt: Date.UTC(2026, 7, 24, 20, 4),
      mmolL: 9.9,
      trend: "slightUp" as const,
    };
    const getLatestGlucose = vi
      .fn()
      .mockResolvedValueOnce(staleReading)
      .mockResolvedValueOnce(currentReading);
    const repository = {
      refresh: vi.fn(),
      getTimeline: vi.fn(),
      getLatestGlucose,
      getSourceStatuses: vi.fn().mockResolvedValue([]),
    } as DiabetesRepository;

    const stale = loadLatestSnapshot(
      repository,
      9,
      Date.UTC(2026, 7, 24, 20, 4),
    );
    await expect(stale.reading).resolves.toEqual(staleReading);

    const current = loadLatestSnapshot(
      repository,
      9,
      Date.UTC(2026, 7, 24, 20, 4, 15),
    );
    expect(current).not.toBe(stale);
    await expect(current.reading).resolves.toEqual(currentReading);
    expect(getLatestGlucose).toHaveBeenCalledTimes(2);
  });

  it("exposes cached glucose without waiting for a pending status read", async () => {
    const reading = {
      id: "cached",
      sourceId: "t1arc-librelinkup",
      timestamp: Date.UTC(2026, 7, 24, 13),
      receivedAt: Date.UTC(2026, 7, 24, 13),
      mmolL: 7.2,
      trend: "flat" as const,
      quality: "measured" as const,
    };
    const repository = {
      refresh: vi.fn(),
      getTimeline: vi.fn(),
      getLatestGlucose: vi.fn().mockResolvedValue(reading),
      getSourceStatuses: vi.fn(
        () => new Promise<DataSourceStatus[]>(() => {
          // Intentionally unresolved to verify latest-glucose loading is independent.
        }),
      ),
    } as DiabetesRepository;

    const request = loadLatestSnapshot(
      repository,
      1,
      Date.UTC(2026, 7, 24, 13),
    );

    await expect(request.reading).resolves.toEqual(reading);
  });

  it("updates glucose freshness locally as the clock advances", () => {
    const timestamp = Date.UTC(2026, 7, 19, 12);
    const state: Parameters<typeof latestStateAtNow>[0] = {
      loading: false,
      sources: [
        {
          id: "t1arc-live-glucose",
          label: "Glucose",
          detail: "Connected source",
          freshness: "current",
          origin: "live",
          dataThrough: timestamp,
          isLive: true,
        },
      ],
    };

    expect(latestStateAtNow(state, timestamp + 7 * 60_000).sources[0])
      .toMatchObject({ freshness: "delayed" });
    expect(latestStateAtNow(state, timestamp + 13 * 60_000).sources[0])
      .toMatchObject({ freshness: "stale" });
  });

  it("keeps source status aligned with a newer displayed glucose row", () => {
    const oldTimestamp = Date.UTC(2026, 7, 19, 12);
    const currentTimestamp = oldTimestamp + 20 * 60_000;
    const state: Parameters<typeof latestStateAtNow>[0] = {
      loading: false,
      reading: {
        id: "headless-current",
        sourceId: "t1arc-librelinkup",
        timestamp: currentTimestamp,
        receivedAt: currentTimestamp,
        mmolL: 6.5,
        trend: "slightDown",
        quality: "measured",
      },
      sources: [
        {
          id: "t1arc-live-glucose",
          label: "Glucose",
          detail: "Connected source",
          freshness: "stale",
          origin: "live",
          dataThrough: oldTimestamp,
          isLive: true,
        },
      ],
    };

    expect(latestStateAtNow(state, currentTimestamp + 3 * 60_000).sources[0])
      .toMatchObject({
        dataThrough: currentTimestamp,
        freshness: "current",
      });
  });
});
