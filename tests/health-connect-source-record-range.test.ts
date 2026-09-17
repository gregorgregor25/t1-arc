import { describe, expect, it, vi } from "vitest";

import {
  healthConnectSourceRecordRangeKey,
  healthConnectSourceRecordRequestKey,
  sourceRecordStateForRange,
} from "@/hooks/useHealthConnectSourceRecords";

vi.mock("@/providers/DataProvider", () => ({ useDataContext: vi.fn() }));
vi.mock("@/data/healthConnect/sourceRecords", () => ({
  getHealthConnectSourceRecordPage: vi.fn(),
}));

describe("Health Connect source-record date boundaries", () => {
  it("keeps a moving current-day endpoint under one selected-day key", () => {
    const selectionKey = "health-connect-day:2026-08-19";

    expect(
      healthConnectSourceRecordRequestKey({ start: 10, end: 20 }, selectionKey),
    ).toBe(selectionKey);
    expect(
      healthConnectSourceRecordRequestKey({ start: 10, end: 50 }, selectionKey),
    ).toBe(selectionKey);
  });

  it("hides the previous day while the requested day loads", () => {
    const tuesdayKey = healthConnectSourceRecordRangeKey({
      start: 10,
      end: 20,
    });
    const wednesdayKey = healthConnectSourceRecordRangeKey({
      start: 20,
      end: 30,
    });
    const visible = sourceRecordStateForRange(
      {
        rangeKey: tuesdayKey,
        records: [{ id: "tuesday-record" } as never],
        totalRecords: 1,
        loading: false,
        loadingMore: false,
      },
      wednesdayKey,
      true,
    );

    expect(visible).toEqual({
      rangeKey: wednesdayKey,
      records: [],
      totalRecords: 0,
      loading: true,
      loadingMore: false,
    });
  });

  it("retains a resolved page while the same range revalidates", () => {
    const rangeKey = healthConnectSourceRecordRangeKey({ start: 10, end: 20 });
    const state = {
      rangeKey,
      records: [{ id: "same-day-record" } as never],
      totalRecords: 1,
      loading: false,
      loadingMore: false,
    };

    expect(sourceRecordStateForRange(state, rangeKey, true)).toBe(state);
  });

  it("synchronously hides records whenever loading is disabled", () => {
    const rangeKey = healthConnectSourceRecordRangeKey({ start: 10, end: 20 });

    expect(
      sourceRecordStateForRange(
        {
          rangeKey,
          records: [{ id: "must-not-leak" } as never],
          totalRecords: 1,
          loading: false,
          loadingMore: true,
          error: "old error",
        },
        rangeKey,
        false,
      ),
    ).toEqual({
      rangeKey,
      records: [],
      totalRecords: 0,
      loading: false,
      loadingMore: false,
    });
  });
});
