import type { InsightFinding } from "./insights";

const CHANGE_PRIORITY: Record<string, number> = {
  "glucose-runs": 0,
  "glucose-timing": 1,
  "glucose-variability": 2,
  "insulin-change": 3,
  "glucose-overview": 99,
};

const CONTEXT_PRIORITY: Record<string, number> = {
  "recorded-ketone-readings": 0,
  "post-meal-pattern": 1,
  "repeated-meal-pattern": 2,
  "activity-context": 3,
  "health-connect-activity": 4,
  "sleep-context": 5,
  "food-context": 6,
  "medication-context": 7,
  "recorded-context-notes": 8,
};

function byPriority(priorities: Record<string, number>) {
  return (left: InsightFinding, right: InsightFinding) =>
    (priorities[left.id] ?? 50) - (priorities[right.id] ?? 50);
}

export function groupInsightFindingsForDashboard(
  findings: readonly InsightFinding[],
) {
  const observations = findings
    .filter((finding) => finding.kind === "observation")
    .sort(byPriority(CHANGE_PRIORITY));
  const changes = observations.filter(
    (finding) => finding.id !== "glucose-overview",
  );

  return {
    changes: changes.length ? changes : observations,
    context: findings
      .filter((finding) => finding.kind === "context-clue")
      .sort(byPriority(CONTEXT_PRIORITY)),
    confidence: findings.filter((finding) => finding.kind === "limitation"),
  };
}
