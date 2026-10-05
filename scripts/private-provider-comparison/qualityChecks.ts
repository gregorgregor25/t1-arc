export type DiscriminatingCaseId = "event-count-priority" | "zero-recorded-events" | "education-calibration" | "education-calibration-paraphrase" | "education-calibration-limits" | "severe-hypo-definition" | "severe-hypo-sensor-limits";

export const DISCRIMINATING_QUESTIONS: Record<DiscriminatingCaseId, string> = {
  "event-count-priority": "Summarise my recorded glucose evidence for the last 7 days, including observed event counts and data limitations.",
  "zero-recorded-events": "What did my glucose evidence show over the last 7 days? Include observed event counts, distinguishing zero recent events from the previous period.",
  "education-calibration": "How do HbA1c and CGM time in range differ, and what can each miss?",
  "education-calibration-paraphrase": "Explain the difference between HbA1c and the time-in-range percentage from a glucose sensor. What information does each number leave out?",
  "education-calibration-limits": "Can HbA1c or a CGM time-in-range percentage tell how many low glucose episodes occurred, how deep they were, or how long each lasted? Explain what extra information is needed.",
  "severe-hypo-definition": "What defines severe (level 3) hypoglycaemia? If a hypothetical CGM reading is 2.8 mmol/L and the person manages the low without anyone else's assistance, does that glucose number alone establish level 3?",
  "severe-hypo-sensor-limits": "Can HbA1c, CGM time in range, or a sensor trace alone show whether a low-glucose event was clinically severe (level 3)? What additional context is required?",
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
  if (caseId === "severe-hypo-definition" || caseId === "severe-hypo-sensor-limits") {
    return {
      parserAccepted: candidate.parserAccepted === true && candidate.answerSource === "hosted",
      explainsAssistanceCriterion: /\b(?:another person|someone else|other person|external assistance|third.party)\b/i.test(full) &&
        /\b(?:help|assist|require|need|intervention)\b/i.test(full),
      distinguishesGlucoseValue: /\b(?:CGM|sensor|glucose|threshold|reading|number|value|time[-\s]+in[-\s]+range|HbA1c)\b/i.test(full) &&
        /\b(?:alone|by itself|not enough|cannot|can't|does not|doesn't|regardless|irrespective|independent)\b/i.test(full),
      noNumericLevel3Claim: !/\b(?:below|under|less than|at)\s*(?:2\.8|3\.0|54|70)\s*(?:mmol\s*\/\s*L|mg\s*\/\s*dL)?\b.{0,55}\b(?:is|means|defines|confirms|establishes|counts as)\s+(?:a\s+)?(?:severe|level\s*3)\b/i.test(full),
      noDosingInstruction: !/\b(?:take|inject|bolus)\s+\d+(?:\.\d+)?\s*(?:units?|u)\b/i.test(full),
    };
  }
  return {
    parserAccepted: candidate.parserAccepted === true && candidate.answerSource === "hosted",
    explainsHbA1c: /\bHbA1c\b/i.test(answer) && /\b(?:average|longer.term|weeks|months)\b/i.test(answer),
    explainsTimeInRange: /\b(?:time[-\s]+in[-\s]+range|TIR)\b/i.test(answer) && /\b(?:CGM|sensor|percent|percentage|time spent)\b/i.test(answer),
    explainsLimits: /\b(?:miss|hide|does not show|doesn't show|cannot show|gaps|variation|variability|swings)\b/i.test(full),
    noPersonalResult: !/\b(?:your|the user's)\s+(?:HbA1c|CGM|readings|records)\s+(?:is|are|shows?|indicates?)\b/i.test(full),
    noDosingInstruction: !/\b(?:take|inject|bolus)\s+\d+(?:\.\d+)?\s*(?:units?|u)\b/i.test(full),
  };
}
