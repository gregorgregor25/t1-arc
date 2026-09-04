import { describe, expect, it } from "vitest";

import {
  type KeyedAsyncSnapshot,
  snapshotValueForKey,
} from "@/hooks/keyedAsyncSnapshot";
import {
  healthDateAfterTodayChange,
  presentHealthEmptyState,
} from "@/screens/healthDateSelection";

describe("dated health data boundaries", () => {
  it("never exposes a completed request under a different date key", () => {
    const tuesday: KeyedAsyncSnapshot<string, { value: number }> = {
      key: "2026-08-18",
      value: { value: 135 },
    };

    expect(snapshotValueForKey(tuesday, "2026-08-18")).toEqual({ value: 135 });
    expect(snapshotValueForKey(tuesday, "2026-08-19")).toBeUndefined();

    const wednesday: KeyedAsyncSnapshot<string, { value: number }> = {
      key: "2026-08-19",
      value: { value: 42 },
    };
    expect(snapshotValueForKey(wednesday, "2026-08-19")).toEqual({ value: 42 });
  });

  it("follows midnight when the screen was showing the previous today", () => {
    expect(
      healthDateAfterTodayChange("2026-08-18", "2026-08-18", "2026-08-19"),
    ).toBe("2026-08-19");
  });

  it("preserves a deliberately selected historical date at midnight", () => {
    expect(
      healthDateAfterTodayChange("2026-08-12", "2026-08-18", "2026-08-19"),
    ).toBe("2026-08-12");
  });

  it("also follows today across a multi-day clock jump", () => {
    expect(
      healthDateAfterTodayChange("2026-08-18", "2026-08-18", "2026-08-21"),
    ).toBe("2026-08-21");
  });

  it("does not claim there are no records when source choice suppressed them", () => {
    expect(presentHealthEmptyState(true)).toEqual({
      title: "Choose which health app to use",
      detail: expect.stringContaining("choose one source"),
    });
    expect(presentHealthEmptyState(false).title).toBe(
      "No health records for this day",
    );
  });
});
