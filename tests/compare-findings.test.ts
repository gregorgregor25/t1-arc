import { describe, expect, it } from "vitest";

import { moreFindingsLabel, splitCompareFindings } from "@/components/tarvis/compareFindings";

describe("Compare periods findings fold", () => {
  it("shows the first three findings, changes before possible influences", () => {
    const split = splitCompareFindings({ changes: ["c1", "c2"], context: ["x1", "x2", "x3"] });
    expect(split.top).toEqual({ changes: ["c1", "c2"], context: ["x1"] });
    expect(split.more).toEqual({ changes: [], context: ["x2", "x3"] });
    expect(split.moreCount).toBe(2);
  });

  it("folds extra changes and every influence when changes fill the top three", () => {
    const split = splitCompareFindings({ changes: ["c1", "c2", "c3", "c4"], context: ["x1"] });
    expect(split.top).toEqual({ changes: ["c1", "c2", "c3"], context: [] });
    expect(split.more).toEqual({ changes: ["c4"], context: ["x1"] });
    expect(split.moreCount).toBe(2);
  });

  it("folds nothing when there are three or fewer findings", () => {
    const split = splitCompareFindings({ changes: ["c1"], context: ["x1", "x2"] });
    expect(split.moreCount).toBe(0);
    expect(split.more).toEqual({ changes: [], context: [] });
  });

  it("keeps every finding exactly once", () => {
    const changes = ["a", "b", "c", "d", "e"];
    const context = ["f", "g"];
    const split = splitCompareFindings({ changes, context });
    expect([...split.top.changes, ...split.more.changes]).toEqual(changes);
    expect([...split.top.context, ...split.more.context]).toEqual(context);
  });

  it("labels the fold plainly", () => {
    expect(moreFindingsLabel(4, false, String)).toBe("More findings (4)");
    expect(moreFindingsLabel(4, true, String)).toBe("Fewer findings");
  });
});
