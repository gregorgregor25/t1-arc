import { TarvisAnswer } from "./types";

export type TarvisSafetyDecision =
  | { kind: "allow" }
  | { kind: "urgent"; answer: TarvisAnswer }
  | { kind: "treatment-advice"; answer: TarvisAnswer }
  | { kind: "diagnosis"; answer: TarvisAnswer }
  | { kind: "prediction"; answer: TarvisAnswer };

const DOSE_OR_SETTING =
  /\b(?:insulin|bolus|correction|dose|units?|basal(?: rate)?|carb(?:ohydrate)? ratio|correction factor|sensitivity|target(?: glucose)?|pump setting|profile)\b/i;
const DIRECT_TREATMENT_REQUEST =
  /\b(?:how much|how many|what (?:dose|bolus|correction))\b[\s\S]{0,60}\b(?:insulin|bolus|correction|dose|units?)\b|\bwhat\s+(?:dose|bolus|correction)\s+should\s+i\s+(?:take|give|inject|do|use)\b|\b(?:should|shall|do i need to|can i)\s+i?\s*(?:take|give|inject|bolus|correct|change|adjust|increase|decrease|raise|lower|set)\b|\b(?:tell me (?:to|how to)|recommend|advise)\b[\s\S]{0,60}\b(?:take|give|inject|bolus|correct|change|adjust|increase|decrease|raise|lower|set|insulin|dose|basal|ratio|factor|target)\b|\b(?:calculate|work out|give me)\b[\s\S]{0,50}\b(?:dose|bolus|correction|units?)\b|\b(?:change|adjust|increase|decrease|raise|lower|set)\s+(?:my|the)\s+(?:basal(?: rate)?|carb(?:ohydrate)? ratio|correction factor|sensitivity|target(?: glucose)?|pump setting|profile)\b|\bwhat should my\s+(?:basal(?: rate)?|carb(?:ohydrate)? ratio|correction factor|sensitivity|target(?: glucose)?|pump setting|profile)\s+be\b/i;
const UNAMBIGUOUS_TREATMENT_ACTION =
  /\b(?:(?:should|shall)\s+i|do i need to|can i)\s+(?:inject|correct)\b|\b(?:tell me (?:to|how to)|recommend|advise)\b[\s\S]{0,40}\b(?:inject|correct)\b/i;
const LOW_GLUCOSE_CONTEXT = /\b(?:low|hypo|hypoglyc(?:aemia|emia|emic))\b/i;
const DIRECT_LOW_CARB_TREATMENT =
  /\bhow (?:many|much)\b[\s\S]{0,30}\b(?:carbs?|carbohydrates?|glucose (?:tabs?|tablets?)|dextrose (?:tabs?|tablets?)|juice)\b|\b(?:(?:should|shall)\s+i|do i need to|can i)\s+(?:eat|drink|take|have|consume)\b[\s\S]{0,40}\b(?:carbs?|carbohydrates?|glucose (?:tabs?|tablets?)|dextrose (?:tabs?|tablets?)|juice|\d+(?:[.,]\d+)?\s*g(?:rams?)?)\b|\bwhat should i\s+(?:eat|drink|take|have|consume)\b|\b(?:how|what)\s+(?:should|do)\s+i\s+(?:treat|handle|manage)\b/i;
const IMMEDIATE_TIME =
  /\b(?:now|right now|currently|at the moment|today|just|still|won't|will not|can't|cannot)\b/i;
const URGENT_SYMPTOM =
  /\b(?:ketones?|vomit(?:ing|ed)?|being sick|difficulty breathing|trouble breathing|deep breathing|confus(?:ed|ion)|very drowsy|unconscious|passed out|seizure|can't keep (?:food|fluids?) down|cannot keep (?:food|fluids?) down)\b/i;
const FIRST_PERSON_CURRENT_URGENT =
  /\b(?:i(?:'m| am)\s+(?:vomiting|being sick|confused|very drowsy|unconscious|having (?:difficulty|trouble) breathing)|(?:i\s+|and\s+)?have\s+(?:ketones?|difficulty breathing|trouble breathing)|i(?:'m| am)\s+having\s+(?:a seizure|seizures)|i (?:can't|cannot) keep (?:food|fluids?) down|my ketones?\s+(?:are|is|show|read|say))\b/i;
const HISTORICAL_ONLY_URGENT =
  /\b(?:i (?:was|had)|my [a-z ]+ (?:was|were))\b[\s\S]{0,50}\b(?:yesterday|last (?:night|week|month|tuesday|monday|wednesday|thursday|friday|saturday|sunday)|\d+ (?:minutes?|hours?|days?) ago)\b/i;
const DESCRIPTIVE_INSULIN_HISTORY =
  /\b(?:how much|how many|what)\b[\s\S]{0,70}\b(?:did i (?:take|receive|deliver|use|have)|i (?:took|received|used|had)|was delivered|did (?:my )?pump deliver)\b|\b(?:how much|how many|what)\s+(?:total\s+)?(?:insulin|bolus|basal)\b[\s\S]{0,50}\b(?:today|yesterday|last|past|previous|on\s+\d|between|from)\b/i;
const DANGEROUS_CURRENT_GLUCOSE =
  /\b(?:my (?:glucose|blood sugar|sugar|reading)|i(?:'m| am))\b[\s\S]{0,40}\b(?:low|hypo|very high|2(?:[.,]\d)?\s*mmol|3(?:[.,][0-4])?\s*mmol|(?:below|under)\s*3(?:[.,]9)?|(?:above|over)\s*(?:20|360))\b/i;
const DIAGNOSIS_REQUEST =
  /\b(?:do i have|have i got|am i developing|diagnose|is this|was that)\b[\s\S]{0,60}\b(?:diabetes|dka|ketoacidosis|gastroparesis|neuropathy|retinopathy|hypoglyc(?:aemia|emia) unawareness|complication)\b/i;
const FUTURE_PREDICTION =
  /\b(?:predict|forecast|what will|where will|going to be)\b[\s\S]{0,50}\b(?:glucose|blood sugar|sugar|reading|level)\b|\b(?:(?:will|could|might) i|am i (?:going|likely) to)\s+(?:go|be|get|become|run|stay|have)?\s*(?:a\s+|too\s+)?(?:low|high|hypo|hyper|hypoglyc(?:aemic|emic)|hyperglyc(?:aemic|emic))\b|\b(?:will|is)\s+(?:my\s+)?(?:glucose|blood sugar|sugar|reading|levels?)\b[\s\S]{0,40}\b(?:going to\s+)?(?:rise|fall|drop|climb|go\s+(?:low|high)|low|high|hypo|hyper)\b/i;

function answer(
  headline: string,
  copy: string,
  limitations: string[] = [],
): TarvisAnswer {
  return {
    headline,
    answer: copy,
    confidence: "high",
    evidenceIds: [],
    limitations,
  };
}

/**
 * Deterministic preflight for requests where analytics must not be allowed to
 * delay urgent help or drift into treatment, diagnosis or prediction.
 */
export function classifyTarvisSafety(question: string): TarvisSafetyDecision {
  const prompt = question.trim();
  if (
    URGENT_SYMPTOM.test(prompt) &&
    (FIRST_PERSON_CURRENT_URGENT.test(prompt) ||
      (!HISTORICAL_ONLY_URGENT.test(prompt) &&
        (IMMEDIATE_TIME.test(prompt) ||
          /\bhelp|what should i do\b/i.test(prompt))))
  ) {
    return {
      kind: "urgent",
      answer: answer(
        "Please act on this now",
        "Don't wait for Tarv1s to analyse your records. Follow your trusted diabetes emergency or sick-day plan now. If you may have diabetic ketoacidosis, cannot safely treat a severe low, are confused, very drowsy, vomiting, having difficulty breathing, having a seizure or are unconscious, seek urgent medical help now. In the UK, call 999 for an emergency or NHS 111 for urgent advice when it is not immediately life-threatening.",
        ["Tarv1s is not an emergency service and no data analysis was run."],
      ),
    };
  }
  if (
    DANGEROUS_CURRENT_GLUCOSE.test(prompt) &&
    /\b(?:what (?:do|should)|help|treat|correct)\b/i.test(prompt)
  ) {
    return {
      kind: "urgent",
      answer: answer(
        "Use your trusted treatment plan now",
        "A current very low or very high reading needs your established diabetes plan, not a historical Tarv1s analysis. Follow that plan and confirm with your usual meter if your sensor reading does not match how you feel. Seek urgent medical help if you cannot treat safely, have severe symptoms or are getting worse.",
        ["Tarv1s did not calculate a dose or treatment change."],
      ),
    };
  }
  if (
    (UNAMBIGUOUS_TREATMENT_ACTION.test(prompt) ||
      (DIRECT_TREATMENT_REQUEST.test(prompt) && DOSE_OR_SETTING.test(prompt)) ||
      (LOW_GLUCOSE_CONTEXT.test(prompt) &&
        DIRECT_LOW_CARB_TREATMENT.test(prompt))) &&
    !DESCRIPTIVE_INSULIN_HISTORY.test(prompt)
  ) {
    return {
      kind: "treatment-advice",
      answer: answer(
        "I can review the records, but not set treatment",
        "I can show your delivered insulin, glucose response, meals, activity and recurring patterns, but I can't calculate a dose or recommend changing a basal rate, ratio, target, correction factor or pump setting. Those decisions need your agreed diabetes plan or diabetes team.",
        [
          "No OpenAI request was made and no treatment calculation was performed.",
        ],
      ),
    };
  }
  if (DIAGNOSIS_REQUEST.test(prompt)) {
    return {
      kind: "diagnosis",
      answer: answer(
        "The records cannot make that diagnosis",
        "Tarv1s can describe the glucose pattern and the records around it, but it cannot diagnose a condition or complication. If this is about current symptoms or ketones, use your trusted emergency or sick-day plan and seek appropriate medical advice rather than waiting for an analytics answer.",
        ["A diagnosis requires clinical assessment beyond the data in T1 Arc."],
      ),
    };
  }
  if (FUTURE_PREDICTION.test(prompt)) {
    return {
      kind: "prediction",
      answer: answer(
        "Future glucose prediction is not available",
        "Tarv1s can explain recorded trends and previous patterns, but this build does not have a separately validated glucose prediction engine. I won't turn a historical pattern into a treatment prediction.",
        ["No forecast was generated."],
      ),
    };
  }
  return { kind: "allow" };
}
