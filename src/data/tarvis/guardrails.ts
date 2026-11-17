import { evidenceIds } from "./evidencePacket";
import { TarvisAnswer, TarvisModelEvidencePacket, TarvisUsage } from "./types";

export const MAX_TARVIS_REQUESTS_PER_HOUR = 10;
export const MAX_TARVIS_REQUESTS_PER_DAY = 30;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_EVIDENCE_REFERENCES = 5;
// Personal-evidence answers may describe recorded events in the past tense
// ("you logged 30 g carbs at 13:00", "AAPS delivered 0.4 U as an SMB"). The
// filter below therefore looks for the grammatical forms that give treatment
// instructions: imperatives at the start of a clause, advice/modal phrasing,
// recommendation wording, passive "should be lowered" forms and dose
// amounts presented as a need. It never allows a dose, a treatment directive
// or a pump-setting recommendation through.
const TREATMENT_VERB =
  "take|inject|use|administer|bolus|pre-?bolus|correct|give|reduce|lower|raise|increase|decrease|adjust|change|double|halve|skip|stop|suspend|set|have|eat|drink|consume|add|cut|switch|top up|treat";
const TREATMENT_GERUND =
  "taking|injecting|using|administering|bolusing|pre-?bolusing|correcting|giving|reducing|lowering|raising|increasing|decreasing|adjusting|changing|doubling|halving|skipping|stopping|suspending|setting|having|eating|drinking|consuming|adding|cutting|switching|topping up|treating";
// Verbs that are a treatment in themselves, without a separate object.
const INHERENT_TREATMENT_VERB = "bolus|pre-?bolus|inject|correct with|give yourself";
const TREATMENT_TARGET =
  "(?:\\b(?:insulin|units?|doses?|dosing|bolus(?:es)?|basal(?: rates?)?|smbs?|super micro ?bolus(?:es)?|temp(?:orary)? (?:basal|target)s?|ratios?|factors?|isf|icr|targets?|carbs?|carbohydrates?|grams?|juice|glucose tablets?|dextrose|glucagon|profiles?|corrections?|sugar)\\b|\\b\\d+(?:[.,]\\d+)?\\s*(?:u|g)\\b)";
// Words that can follow an imperative treatment verb. Nouns and prepositions
// such as "of", "in", "at 12:30" or "readings" mark descriptive use instead
// ("increase of 0.2 U/h", "change in basal", "lower readings").
const IMPERATIVE_OBJECT =
  "(?=\\s+(?!a\\s+look\\b)(?:your|the|a|an|some|more|less|extra|another|half|up\\s+to|about|around|approximately|roughly|it|that|this|them|those|these|\\d+(?:[.,]\\d+)?|insulin|units?|doses?|bolus|basal|smbs?|ratio|factor|isf|icr|target|carbs?|carbohydrates?|glucose|juice|dextrose|glucagon|correction|temp|profile|earlier|later|sooner|by|now|straight away|immediately|before|for)\\b)";
const CLAUSE_START =
  "(?:^|[.!?;:\\n,(]\\s*|\\s[-–—]\\s+)(?:(?:please|then|now|so|just|also|instead|first|next|next time|for example|for instance|if needed|if so|otherwise|and|or|but|ideally|perhaps|maybe)\\s*,?\\s+)*";
const TREATMENT_DIRECTIVE_PATTERNS: readonly RegExp[] = [
  // Imperatives: "Take 2 units", "Increase your basal", "Bolus earlier".
  new RegExp(`${CLAUSE_START}(?:${INHERENT_TREATMENT_VERB})\\b${IMPERATIVE_OBJECT}`, "i"),
  new RegExp(`${CLAUSE_START}(?:${TREATMENT_VERB})\\b${IMPERATIVE_OBJECT}[\\s\\S]{0,60}${TREATMENT_TARGET}`, "i"),
  // Negative imperatives: "Don't bolus for that snack".
  new RegExp(`\\b(?:don't|don’t|do not|never)\\s+(?:${INHERENT_TREATMENT_VERB})\\b`, "i"),
  new RegExp(`\\b(?:don't|don’t|do not|never|avoid)\\s+(?:${TREATMENT_VERB}|${TREATMENT_GERUND})\\b[\\s\\S]{0,60}${TREATMENT_TARGET}`, "i"),
  // Modal advice: "You should bolus", "You need to inject insulin".
  new RegExp(`\\b(?:you|we|they)(?:'d|’d|\\s+would)?\\s+(?:should|must|need to|needs to|could|can|may want to|might want to|ought to|have to|had better|better)\\s+(?:(?:also|probably|perhaps|maybe|really|just|first|then|definitely|consider|try)\\s+)*(?:${INHERENT_TREATMENT_VERB})\\b`, "i"),
  new RegExp(`\\b(?:you|we|they)(?:'d|’d|\\s+would)?\\s+(?:should|must|need to|needs to|could|can|may want to|might want to|ought to|have to|had better|better)\\s+(?:(?:also|probably|perhaps|maybe|really|just|first|then|definitely|consider|try)\\s+)*(?:${TREATMENT_VERB}|${TREATMENT_GERUND})\\b[\\s\\S]{0,60}${TREATMENT_TARGET}`, "i"),
  // Recommendation wording.
  new RegExp(`\\b(?:i|we)(?:'d|’d|\\s+would)?\\s+(?:recommend|suggest|advise)\\b[\\s\\S]{0,100}${TREATMENT_TARGET}`, "i"),
  /\b(?:my|our)\s+(?:recommendation|suggestion|advice)\b/i,
  /\b(?:recommended|ideal|appropriate|right)\s+(?:dose|bolus|basal(?: rate)?|ratio|target|correction|amount of (?:insulin|carbs?|carbohydrates?))\b/i,
  new RegExp(`\\b(?:consider|try)\\s+(?:${TREATMENT_VERB}|${TREATMENT_GERUND})\\b[\\s\\S]{0,60}${TREATMENT_TARGET}`, "i"),
  new RegExp(`\\bit\\s+(?:may|might|could|would|will|can)\\s+(?:help|be\\s+(?:worth|better|best|wise|helpful|sensible|a good idea))\\b[\\s\\S]{0,100}${TREATMENT_TARGET}`, "i"),
  new RegExp(`\\b(?:worth|best to|better to|time to|aim to|important to|wise to|advisable to|sensible to|a good idea to)\\s+(?:${TREATMENT_VERB}|${TREATMENT_GERUND})\\b[\\s\\S]{0,60}${TREATMENT_TARGET}`, "i"),
  new RegExp(`\\b(?:is|are|would be|will be)\\s+to\\s+(?:${TREATMENT_VERB})\\b[\\s\\S]{0,60}${TREATMENT_TARGET}`, "i"),
  new RegExp(`\\b(?:${TREATMENT_GERUND})\\b[\\s\\S]{0,60}${TREATMENT_TARGET}[\\s\\S]{0,40}\\b(?:would|could|might|may|will|should)\\s+(?:help|work|be\\s+(?:better|best|wise|sensible))\\b`, "i"),
  // Passive recommendations: "Your basal should be lowered".
  /\b(?:should|must|ought to|needs? to|has to|have to)\s+be\s+(?:lowered|raised|increased|decreased|reduced|changed|adjusted|set|doubled|halved|stopped|skipped|given|taken|injected|delivered)\b/i,
  new RegExp(`${TREATMENT_TARGET}[^.!?\\n]{0,40}\\b(?:should|must|ought to|needs? to|has to|have to)\\s+be\\b`, "i"),
  new RegExp(`\\b(?:is|are|would be|will be)\\s+(?:needed|required|necessary|advisable|recommended)\\b[^.!?\\n]{0,40}${TREATMENT_TARGET}|${TREATMENT_TARGET}[^.!?\\n]{0,40}\\b(?:is|are|would be|will be)\\s+(?:needed|required|necessary|advisable|recommended)\\b`, "i"),
  // Dose amounts presented as a need: "You need about 2 units".
  /\b(?:you|it)(?:'d|’d|\s+would|\s+will)?\s+(?:need|needs|require|requires)\s+(?:about\s+|around\s+|roughly\s+|approximately\s+|another\s+|an extra\s+|extra\s+|more\s+|less\s+|up to\s+)?\d/i,
];

/**
 * True when text instructs or recommends a treatment action, a dose or a
 * pump-setting change. Past-tense descriptions of recorded events are not
 * directives and are not matched.
 */
export function containsTreatmentDirective(text: string) {
  return TREATMENT_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(text));
}
const PROHIBITED_CAUSAL_OUTPUT =
  /\b(?:definitely|certainly|clearly)\b[\s\S]{0,50}\b(?:caused|cause|because|due to)\b|\b(?:caused (?:your|the)|was caused by|was the cause of your|is the reason your|explains why your|led to (?:your|the)|triggered (?:your|the)|(?:your|the) (?:meal|walk|exercise|workout|insulin|bolus) explains? (?:your|the))\b/i;
// No-record education may state that a measure cannot identify a cause. Mask
// only that explicit denial before applying the existing causal-claim filter.
// Personal-evidence answers keep the stricter original filter unchanged.
const EDUCATION_CAUSAL_UNCERTAINTY =
  /\b(?:cannot|can't|can not|does not|doesn't|will not|won't)\s+(?:identify|determine|show|establish|tell(?: you)?|know)\s+what caused (?:your|the)\b/gi;
const PROHIBITED_DIAGNOSIS_OUTPUT =
  /\byou (?:have|definitely have|are developing|are suffering from)\s+(?:dka|diabetic ketoacidosis|gastroparesis|neuropathy|retinopathy|hypoglyc(?:aemia|emia) unawareness)\b|\b(?:this|that|it)\s+(?:is|looks like|appears to be|could be|may be)\s+(?:dka|diabetic ketoacidosis|gastroparesis|neuropathy|retinopathy|hypoglyc(?:aemia|emia) unawareness)\b/i;

// General physiology uses verbs such as "reduce insulin sensitivity" and
// "increase glucose absorption" descriptively. In no-record education, detect
// directives rather than treating every occurrence of those verbs as advice.
// Personal-evidence parsing retains its stricter, existing output filter.
const PROHIBITED_EDUCATION_TREATMENT_OUTPUT =
  /(?:^|[.!?;:\n,]\s*)(?:(?:please|then|for example)\s+)?(?:take|inject|use|administer|bolus|correct with|give yourself|reduce|lower|increase|decrease|adjust|change|double|halve|skip|stop|set|have|eat|drink|consume)\b[\s\S]{0,80}\b(?:insulin|units?|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|grams?|juice|glucose tablets?)\b|\b(?:you (?:should|must|need to|can)|(?:i |we )?(?:recommend|suggest|advise)|consider|try|best to|to treat|to correct)\b[\s\S]{0,100}\b(?:tak(?:e|ing)|inject(?:ing)?|us(?:e|ing)|administer(?:ing)?|bolus|giv(?:e|ing)|reduc(?:e|ing)|lower(?:ing)?|increas(?:e|ing)|decreas(?:e|ing)|adjust(?:ing)?|chang(?:e|ing)|doubl(?:e|ing)|halv(?:e|ing)|skip(?:ping)?|stop(?:ping)?|set(?:ting)?|hav(?:e|ing)|eat(?:ing)?|drink(?:ing)?|consum(?:e|ing))\b[\s\S]{0,60}\b(?:insulin|units?|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|grams?|juice|glucose tablets?)\b/i;
// A level-3 definition can describe someone being unable to self-treat and
// needing another person's assistance. That past-tense description is not an
// instruction to administer anything. Keep the exception this specific.
const EDUCATION_ASSISTANCE_DESCRIPTION =
  /\bwhether (?:the episode caused sufficient cognitive or physical impairment that )?(?:you were|a person was|they were) unable to treat it (?:yourself|themselves) and needed (?:someone else|another person) to administer (?:carbohydrates|glucagon)\b/gi;

function cleanModelText(value: unknown, validEvidenceIds: Set<string>) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\[([^\]]+)\]/g, (match, contents: string) => {
      const referencesKnownEvidence = [...validEvidenceIds].some((id) =>
        contents.includes(id),
      );
      return referencesKnownEvidence ? "" : match;
    })
    .replace(/\*\*|__|`/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function checkTarvisRateLimit(
  usage: TarvisUsage,
  now = Date.now(),
  requiredRequests = 1,
) {
  if (!Number.isSafeInteger(requiredRequests) || requiredRequests < 1) {
    throw new RangeError("A positive local model-request reservation is required.");
  }
  const recent = usage.requestTimestamps.filter(
    (timestamp) => now - timestamp < DAY_MS,
  );
  const hourly = recent.filter((timestamp) => now - timestamp < HOUR_MS);
  if (hourly.length + requiredRequests > MAX_TARVIS_REQUESTS_PER_HOUR) {
    throw new Error(
      "Tarv1s has reached its hourly safety limit of 10 model requests on this device. Try again later.",
    );
  }
  if (recent.length + requiredRequests > MAX_TARVIS_REQUESTS_PER_DAY) {
    throw new Error(
      "Tarv1s has reached its daily safety limit of 30 model requests on this device. Try again tomorrow.",
    );
  }
  return recent;
}

export function parseTarvisAnswer(
  value: string,
  packet?: TarvisModelEvidencePacket,
  options: { generalEducation?: boolean } = {},
): TarvisAnswer {
  let parsed: Partial<TarvisAnswer>;
  try {
    parsed = JSON.parse(value) as Partial<TarvisAnswer>;
  } catch {
    throw new Error("TARV1S returned an unreadable answer. Please try again.");
  }
  const validEvidenceIds = packet ? evidenceIds(packet) : new Set<string>();
  const confidence =
    parsed.confidence === "high" ||
    parsed.confidence === "moderate" ||
    parsed.confidence === "limited"
      ? parsed.confidence
      : "limited";
  const answer = cleanModelText(parsed.answer, validEvidenceIds);
  if (!answer) {
    throw new Error("TARV1S returned an empty answer. Please try again.");
  }
  const headline = cleanModelText(parsed.headline, validEvidenceIds)
    ? cleanModelText(parsed.headline, validEvidenceIds)
    : "Evidence review";
  const limitations = Array.isArray(parsed.limitations)
    ? parsed.limitations
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanModelText(item, validEvidenceIds))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  let selectedEvidenceIds: string[] = [];
  const visibleCopy = [headline, answer, ...limitations].join("\n");
  const generalEducation = options.generalEducation && !packet;
  const causalCopy = generalEducation
    ? visibleCopy.replace(EDUCATION_CAUSAL_UNCERTAINTY, "")
    : visibleCopy;
  const treatmentCopy = generalEducation
    ? visibleCopy.replace(EDUCATION_ASSISTANCE_DESCRIPTION, "")
    : visibleCopy;
  if (
    (generalEducation
      ? PROHIBITED_EDUCATION_TREATMENT_OUTPUT.test(treatmentCopy)
      : containsTreatmentDirective(treatmentCopy)) ||
    PROHIBITED_CAUSAL_OUTPUT.test(causalCopy) ||
    PROHIBITED_DIAGNOSIS_OUTPUT.test(visibleCopy)
  ) {
    throw new Error(
      "TARV1S returned an answer outside its safe evidence boundary. Please try again.",
    );
  }
  if (packet) {
    if (
      !Array.isArray(parsed.evidenceIds) ||
      parsed.evidenceIds.length === 0 ||
      parsed.evidenceIds.length > MAX_EVIDENCE_REFERENCES ||
      !parsed.evidenceIds.every(
        (id): id is string =>
          typeof id === "string" && validEvidenceIds.has(id),
      ) ||
      new Set(parsed.evidenceIds).size !== parsed.evidenceIds.length
    ) {
      throw new Error(
        "TARV1S returned an answer without exact supporting evidence. Please try again.",
      );
    }
    selectedEvidenceIds = [...parsed.evidenceIds];
  }
  return {
    headline,
    answer,
    confidence,
    evidenceIds: selectedEvidenceIds,
    limitations,
  };
}
