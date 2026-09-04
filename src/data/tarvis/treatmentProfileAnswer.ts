import type { TarvisAnswer } from "./types";
import type { TarvisTreatmentProfile } from "./treatmentProfile";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { formatRegionalWallClockMinute } from "@/domain/regionalWallClock";

const RATIO_TERM =
  /\b(?:(?:insulin[- ]to[- ]carb(?:ohydrate)?|carb(?:ohydrate)?[- ]to[- ]insulin)(?:\s+ratios?)?|carb(?:ohydrate)?\s+ratios?|grams?\s+(?:of\s+)?carb(?:ohydrate)?s?\s+per\s+unit)\b/i;
const EXPLICIT_SAVED_PROFILE_MARKER =
  /\b(?:saved|configured|entered|recorded|show|list|repeat|read back)\b/i;

export function isTarvisTreatmentProfileQuestion(question: string) {
  return (
    RATIO_TERM.test(question) && EXPLICIT_SAVED_PROFILE_MARKER.test(question)
  );
}

export function buildTarvisTreatmentProfileAnswer(
  profile: TarvisTreatmentProfile | undefined,
  locale: string,
): TarvisAnswer {
  const schedule = [...(profile?.carbRatioSchedule ?? [])].sort(
    (left, right) => left.startMinute - right.startMinute,
  );
  if (!profile || schedule.length === 0) {
    return {
      headline: "No saved carb-ratio profile",
      answer:
        "T1 Arc does not have a confirmed insulin-to-carb ratio saved. Add only the ratios already agreed in your care plan under Settings → Diabetes profile.",
      confidence: "limited",
      evidenceIds: [],
      limitations: [
        "No OpenAI request was made.",
        "Tarv1s did not calculate a dose or recommend a ratio.",
      ],
    };
  }

  const periods = schedule.map(
    ({ gramsPerUnit, startMinute }) =>
      `from ${formatRegionalWallClockMinute(startMinute, locale)}, 1 unit covers ${formatRegionalNumber(gramsPerUnit, locale, { maximumFractionDigits: 1 })} g carbohydrate`,
  );
  return {
    headline: "Your saved carb-ratio profile",
    answer: `Your confirmed care-plan profile says ${joinPeriods(periods)}. This only repeats the settings you entered; Tarv1s did not calculate a dose or recommend a change.`,
    confidence: "high",
    evidenceIds: [],
    limitations: [
      "These values were entered manually in T1 Arc and were not verified against a pump or care-team record.",
      "No OpenAI request was made.",
    ],
  };
}

export function treatmentProfileLoadFailureAnswer(): TarvisAnswer {
  return {
    headline: "I could not read your saved profile safely",
    answer:
      "T1 Arc did not use the saved ratio because its local profile could not be validated. Open Settings → Diabetes profile to review and save it again.",
    confidence: "limited",
    evidenceIds: [],
    limitations: [
      "No OpenAI request was made.",
      "Tarv1s did not calculate a dose or recommend a ratio.",
    ],
  };
}

function joinPeriods(periods: string[]) {
  if (periods.length === 1) return periods[0];
  if (periods.length === 2) return `${periods[0]}; and ${periods[1]}`;
  return `${periods.slice(0, -1).join("; ")}; and ${periods.at(-1)}`;
}
