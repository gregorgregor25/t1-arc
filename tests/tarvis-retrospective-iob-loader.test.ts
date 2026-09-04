import { describe, expect, it, vi } from "vitest";

import { createRetrospectiveIobLoader } from "@/data/tarvis/retrospectiveIobLoader";

describe("retrospective IOB live-data gate", () => {
  it("does not expose or invoke the live notification store in demo mode", async () => {
    const query = vi.fn(async () => ({ records: [], truncated: false }));
    const loader = createRetrospectiveIobLoader("demo", query);

    expect(loader).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("returns the bounded loader in live mode", async () => {
    const result = { records: [], truncated: false };
    const query = vi.fn(async () => result);
    const loader = createRetrospectiveIobLoader("live", query);
    const range = { start: 10, end: 20 };

    await expect(loader?.(range)).resolves.toBe(result);
    expect(query).toHaveBeenCalledWith(range);
  });
});
