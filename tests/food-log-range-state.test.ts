import { describe, expect, it, vi } from "vitest";

import {
  failedFoodLogSnapshot,
  foodLogRangeKey,
  foodLogRequestKey,
} from "@/hooks/useFoodLogs";
import { snapshotValueForKey } from "@/hooks/keyedAsyncSnapshot";

vi.mock("@/providers/DataProvider", () => ({ useDataContext: vi.fn() }));
vi.mock("@/data/food/foodLogRepository", () => ({ getFoodLogs: vi.fn() }));

describe("food-log range state", () => {
  it("keeps today's moving endpoint under its logical history selection", () => {
    const selectionKey = "history:2026-08-19:1d";

    expect(foodLogRequestKey({ start: 10, end: 20 }, selectionKey)).toBe(
      selectionKey,
    );
    expect(foodLogRequestKey({ start: 10, end: 50 }, selectionKey)).toBe(
      selectionKey,
    );
  });

  it("does not expose logs resolved for the previous range", () => {
    const previousKey = foodLogRangeKey({ start: 10, end: 20 });
    const requestedKey = foodLogRangeKey({ start: 20, end: 30 });
    const previous = {
      key: previousKey,
      value: { logs: [{ id: "previous-meal" }] },
    };

    expect(snapshotValueForKey(previous, requestedKey)).toBeUndefined();
  });

  it("preserves same-range food details on refresh failure only", () => {
    const previousKey = foodLogRangeKey({ start: 10, end: 20 });
    const logs = [{ id: "existing-meal" }] as never[];
    const previous = { key: previousKey, value: { logs } };

    expect(
      failedFoodLogSnapshot(previous, previousKey, "Unavailable").value,
    ).toEqual({ logs, error: "Unavailable" });
    expect(
      failedFoodLogSnapshot(previous, "20:30", "Unavailable").value,
    ).toEqual({ logs: [], error: "Unavailable" });
  });
});
