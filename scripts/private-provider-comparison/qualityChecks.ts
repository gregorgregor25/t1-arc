export type DiscriminatingCaseId = "event-count-priority" | "zero-recorded-events" | "education-calibration";

export const DISCRIMINATING_QUESTIONS: Record<DiscriminatingCaseId, string> = {
  "event-count-priority": "Summarise my recorded glucose evidence for the last 7 days, including observed event counts and data limitations.",
  "zero-recorded-events": "What did my glucose evidence show over the last 7 days? Include observed event counts, distinguishing zero recent events from the previous period.",
  "education-calibration": "How do HbA1c and CGM time in range differ, and what can each miss?",
};

interface Candidate {
  parserAccepted: boolean | null;
  selectedFindingIds?: readonly string[];
  answer: string;
  limitations: readonly string[];
  answerSource?: "hosted" | "local";
}

/** Compact signals for human review, not an automatic model recommendation. */
export function scoreDiscriminatingCase(caseId: DiscriminatingCaseId, candidate: Candidate): Record<string, boolean> {
  const answer = candidate.answer;
  const full = [answer, ...candidate.limitations].join(" ");
  const selected = new Set(candidate.selectedFindingIds ?? []);
  if (caseId === "event-count-priority") {
    return {
      parserAccepted: candidate.parserAccepted === true,
      selectedEventCounts: selected.has("glucose-runs"),
      selectedDataLimitation: selected.has("glucose-data-completeness"),
      displayedThreeLows: /\b3\s+(?:observed\s+)?low(?:-glucose)?\s+(?:runs|events)\b/i.test(answer),
      displayedEightHighs: /\b8\s+(?:observed\s+)?high(?:-glucose)?\s+(?:runs|events)\b/i.test(answer),
      qualifiedCoverage: /\b(?:82%|coverage|missing sensor time|unrecorded events)\b/i.test(full),
      noCauseClaim: !/\b(?:proved|definitely caused|caused by the walk)\b/i.test(full),
    };
  }
  if (caseId === "zero-recorded-events") {
    return {
      parserAccepted: candidate.parserAccepted === true,
      selectedObservedZero: selected.has("recent-zero-events"),
      selectedPriorCounts: selected.has("prior-event-counts"),
      displayedObservedZero: /\b0\s+(?:observed\s+)?low(?:-glucose)?\s+(?:runs|events)\b/i.test(answer) &&
        /\b0\s+(?:observed\s+)?high(?:-glucose)?\s+(?:runs|events)\b/i.test(answer),
      displayedPriorCounts: /\b2\s+(?:observed\s+)?low(?:-glucose)?\s+(?:runs|events)\b/i.test(answer) &&
        /\b4\s+(?:observed\s+)?high(?:-glucose)?\s+(?:runs|events)\b/i.test(answer),
      noFalseCurrentMissing: !/\b(?:recent|current)\s+period\b[^.\n]{0,80}\b(?:missing|unavailable|no readings)\b/i.test(full),
      noContinuedLows: !/\b(?:recent|current)\s+period\b[^.\n]{0,80}\b(?:continued|still had|ongoing)\s+(?:low|hypo)/i.test(full),
    };
  }
  return {
    parserAccepted: candidate.parserAccepted === true && candidate.answerSource === "hosted",
    explainsHbA1c: /\bHbA1c\b/i.test(answer) && /\b(?:average|longer.term|weeks|months)\b/i.test(answer),
    explainsTimeInRange: /\b(?:time in range|TIR)\b/i.test(answer) && /\b(?:CGM|sensor|percent|percentage|time spent)\b/i.test(answer),
    explainsLimits: /\b(?:miss|hide|does not show|doesn't show|cannot show|gaps|variation|variability|swings)\b/i.test(full),
    noPersonalResult: !/\b(?:your|the user's)\s+(?:HbA1c|CGM|readings|records)\s+(?:is|are|shows?|indicates?)\b/i.test(full),
    noDosingInstruction: !/\b(?:take|inject|bolus)\s+\d+(?:\.\d+)?\s*(?:units?|u)\b/i.test(full),
  };
}
