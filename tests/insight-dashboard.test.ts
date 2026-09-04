import { describe, expect, it } from "vitest";

import { groupInsightFindingsForDashboard } from "../src/domain/insightDashboard";
import type { InsightFinding } from "../src/domain/insights";

function finding(
  id: string,
  kind: InsightFinding["kind"],
): InsightFinding {
  return {
    id,
    kind,
    category: kind === "limitation" ? "data-quality" : "glucose",
    title: id,
    summary: id,
    evidence: [],
  };
}

describe("groupInsightFindingsForDashboard", () => {
  it("separates changes, possible context and confidence notes", () => {
    const groups = groupInsightFindingsForDashboard([
      finding("glucose-overview", "observation"),
      finding("glucose-variability", "observation"),
      finding("activity-context", "context-clue"),
      finding("coverage", "limitation"),
    ]);

    expect(groups.changes.map(({ id }) => id)).toEqual([
      "glucose-variability",
    ]);
    expect(groups.context.map(({ id }) => id)).toEqual(["activity-context"]);
    expect(groups.confidence.map(({ id }) => id)).toEqual(["coverage"]);
  });

  it("puts sustained glucose events and ketones ahead of lower priority context", () => {
    const groups = groupInsightFindingsForDashboard([
      finding("insulin-change", "observation"),
      finding("glucose-runs", "observation"),
      finding("sleep-context", "context-clue"),
      finding("recorded-ketone-readings", "context-clue"),
    ]);

    expect(groups.changes.map(({ id }) => id)).toEqual([
      "glucose-runs",
      "insulin-change",
    ]);
    expect(groups.context.map(({ id }) => id)).toEqual([
      "recorded-ketone-readings",
      "sleep-context",
    ]);
  });

  it("keeps the glucose overview when it is the only observed change", () => {
    const groups = groupInsightFindingsForDashboard([
      finding("glucose-overview", "observation"),
    ]);

    expect(groups.changes.map(({ id }) => id)).toEqual(["glucose-overview"]);
  });
});
