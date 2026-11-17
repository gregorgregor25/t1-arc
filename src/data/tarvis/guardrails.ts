import { evidenceIds } from "./evidencePacket";
import { TarvisAnswer, TarvisModelEvidencePacket, TarvisUsage } from "./types";

export const MAX_TARVIS_REQUESTS_PER_HOUR = 10;
export const MAX_TARVIS_REQUESTS_PER_DAY = 30;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_EVIDENCE_REFERENCES = 5;
// Personal-evidence answers are checked one sentence at a time, in two layers.
// The patterns below catch common instruction shapes anywhere in a sentence.
// Then every sentence about insulin, carbohydrate, boluses, basal, pump
// settings, targets or ratios is rejected unless it reads as a description of
// a recorded event ("You logged 30 g carbs at 13:00", "AAPS recorded a 0.4 U
// SMB at 08:12"). When a sentence cannot be classified, it is rejected.
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

// The conservative filter in place before descriptive records were allowed
// (commit b165e1d). Any sentence it matches must also pass the recorded-event
// test below.
const PROHIBITED_TREATMENT_OUTPUT =
  /\b(?:take|inject|use|administer|bolus|correct with|give yourself|reduce|lower|increase|decrease|adjust|change|double|halve|skip|stop|set|have|eat|drink|consume)\b[\s\S]{0,60}\b(?:insulin|units?|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|grams?|juice|glucose tablets?)\b|\bconsider\s+(?:taking|injecting|using|reducing|lowering|increasing|decreasing|adjusting|changing|skipping|stopping)\b[\s\S]{0,50}\b(?:insulin|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?)\b|\b(?:you (?:should|must|need to)|i (?:recommend|suggest|advise))\b[\s\S]{0,80}\b(?:take|inject|bolus|correct|change|adjust|increase|decrease|raise|lower|double|halve|skip|stop|set)\b[\s\S]{0,50}\b(?:insulin|dose|bolus|basal|ratio|factor|target|carbs?|carbohydrates?|glucose tablets?)\b/i;
const NUMBER_WORD =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|half|a couple of|a few|several";
// Glucose-range wording is not a treatment topic.
const RANGE_WORDING = /\b(?:target|glucose|standard|tight|personal)\s+ranges?\b|\btime in range\b/gi;
const TREATMENT_TOPIC = new RegExp(
  "\\b(?:insulin|units?|u|doses?|dosing|bolus\\w*|basal|smbs?|super micro ?bolus\\w*|temp(?:orary)? (?:basal|target)s?|carbs?|carbohydrates?|grams?|g|ratios?|icr|isf|sensitivity|factors?|targets?|profiles?|juice|glucose tablets?|dextrose|glucagon|correct\\w*|pump|sugar|snacks?)\\b|\\d\\s*(?:u|g)\\b",
  "i",
);
const AMOUNT = new RegExp(`\\d|\\b(?:${NUMBER_WORD})\\b`, "i");
// Verbs that are a treatment action in themselves, whatever the sentence is about.
const INHERENT_TREATMENT_ACTION =
  /\b(?:inject|pre-?bolus|administer|eat|drink|consume|swallow|sip|chew|correct with|top up|give yourself|treat (?:the|a|your|it|this|that|any) (?:low|hypo|high))\b/i;
// Base-form treatment verbs: an instruction ("take", "lower") or a present-tense
// habit, never a record. Past forms such as "took", "logged" or "set by AAPS"
// are handled by the masks below.
const BASE_TREATMENT_VERB =
  /\b(?:take|inject|administer|give|bolus|pre-?bolus|correct|eat|drink|consume|have|add|increase|decrease|raise|lower|reduce|change|adjust|set|double|halve|skip|stop|suspend|resume|cancel|cut|switch|top up|treat|use|cover|enter|log|start|apply|put|go|split|spread|delay|move|extend|avoid|leave|hold|run|do|make|get|grab|pop|dial|programme|program|press|deliver|send|bump|drop|tweak|boost|limit|bring|keep|aim|wait|repeat|turn|pause|restart|proceed|dose)\b|\bup\s+(?:your|the)\b/i;
const TREATMENT_GERUND_FORM =
  /\b(?:taking|injecting|administering|giving|bolusing|pre-?bolusing|correcting|eating|drinking|consuming|having|adding|increasing|decreasing|raising|lowering|reducing|changing|adjusting|setting|doubling|halving|skipping|stopping|suspending|cutting|switching|topping|treating|using|covering|splitting|delaying|extending|dialling|dialing|bumping|tweaking|boosting|limiting)\b/i;
// Modal, advice, recommendation, timing and judgement wording.
const DIRECTIVE_MARKER =
  /\b(?:should|shouldn't|must|mustn't|need|needs|needed|ought|have to|has to|had to|had better|could|couldn't|can|can't|cannot|may|might|would|wouldn't|will|won't|shall|let's|lets|recommend\w*|suggest|suggests|suggestion|advis\w*|advice|consider\w*|try|trying|want|wants|worth|best|better|ideal\w*|optimal|appropriate|right|proper|help|helps|helpful|go ahead|make sure|remember|forget|plan|time to|important|wise|sensible|prefer\w*|please|required|require|requires|necessary|essential|option|alternative|approach|strategy|idea|next time|in future|in the future|going forward|from now on|tonight|tomorrow|next (?:meal|bolus|dose|time|breakfast|lunch|dinner|snack|correction)|before (?:your|the) next|instead|if you|when you|now|right away|straight away|immediately|enough|too|off|wrong|incorrect|insufficient|excessive|aggressive|don't|do not|just|simply|is to|are to|to be|indicated|warranted|justified|called for|advised|advisable|recommended|preferred|go with|go for|do it|do the trick)\b|'(?:ll|d)\b/i;
// A recorded event: an explicit past-tense record verb, a record noun or
// "there was/were". Only listed verbs count: a generic "-ed" ending also
// matches judgement words ("indicated", "warranted") and imperatives such as
// "Proceed".
const RECORD_MARKER =
  /\b(?:was|were|had|been|took|ate|gave|ran|rose|fell|showed|shows|show|lists|listed|contains|contained|includes|included|totals?|totalled|totaled|averaged|records?|recorded|entr(?:y|ies)|logs|logged|history|there (?:was|were|is|are)|delivered|entered|imported|received|injected|bolused|corrected|counted|calculated|estimated|reported|stored|synced|uploaded|started|ended|stopped|finished|resumed|suspended|paused|changed|switched|cancelled|canceled|replaced|noted|added|increased|decreased|reduced|raised|lowered|treated|covered|peaked|dropped|measured|appeared|occurred|happened|followed|preceded|expired)\b|\b(?:aaps|loop|pump|system|algorithm|automation)\s+(?:set|cut|ran)\b/i;
const NOUN_MODIFIER =
  "(?:meal|correction|extended|combo|combination|dual|square|wave|manual|automatic|automated|small|large|big|single|first|second|third|last|previous|recorded|logged|earlier|later|overnight|basal|insulin|carb|sharp|steep|gradual|slight|total|\\d+(?:[.,]\\d+)?\\s*(?:u|g|units?|%)?)";
const NOUN_VERB =
  "bolus|pre-?bolus|increase|decrease|change|drop|raise|rise|cut|switch|start|stop|log|run|use|set|dose|split|delay|hold";
// Descriptive uses of words that are otherwise treatment verbs. Each mask is
// narrow; anything it does not cover stays visible to the checks above.
const DESCRIPTIVE_MASKS: readonly RegExp[] = [
  new RegExp(`\\b(?:a|an|the|this|that|these|those|each|every|no|any|your|its|their|his|her|our|my)\\s+(?:${NOUN_MODIFIER}\\s+){0,2}(?:${NOUN_VERB})\\b`, "gi"),
  /\b\d+(?:[.,]\d+)?\s*(?:u|units?)\s+(?:bolus|smb)\w*/gi,
  /\bbolus\s+(?:records?|entries|entry|wizard|calculator|history|data|events?|amounts?|totals?|count|timing|times?|of|was|were|is|are|from|by)\b/gi,
  /\b(?:increase|decrease|change|drop|rise|raise|cut|switch|start|stop)\s+(?:of|in)\b/gi,
  /\b(?:was|were|is|are|been|slightly|much|even|bit|somewhat|generally|than|and|or)\s+(?:lower|higher)\b/gi,
  /\b(?:lower|higher)\s+(?:readings?|values?|glucose|levels?|than|range|end|limit|threshold|bound|overnight)\b/gi,
  /\b(?:wizard|calculator|aaps|loop|pump|system|algorithm)\s+suggested\b/gi,
  /\b(?:aaps|loop|pump|it|system|algorithm|automation)\s+(?:set|cut|ran)\b/gi,
  /\b(?:was|were|been|being)\s+(?:set|cut|put|run|stopped|started)\b/gi,
  /\b(?:you|we|they|records|which|that|these|those)\s+(?:have|had)\b(?!\s+to\b)/gi,
  /\b(?:profile|pump)\s+(?:switch|suspend|stop|start)\w*/gi,
  /\binsulin\s+use\b/gi,
  // A recorded state: "The pump was off from 12:00".
  /\b(?:was|were|been|being|went|is|are|stayed|remained)\s+(?:switched\s+|turned\s+)?off\b/gi,
  /\b(?:records?|data|readings?|entries|logs?|export|report|sensor|chart|coverage)\s+(?:may|might|can|cannot|can't|could|won't|wouldn't)\s+(?:not\s+)?(?:include|show|cover|contain|reflect|miss|capture|list|prove|establish|identify|confirm|tell|explain|be (?:incomplete|missing|partial|delayed|duplicated|approximate|estimated|complete|available))\b/gi,
];

const IMPERATIVE_START =
  /^\W*(?:(?:please|then|now|so|just|also|instead|first|next|next time|simply|ideally|perhaps|maybe|and|or|but)\s*,?\s+)*(?:take|inject|give|bolus|pre-?bolus|correct|eat|drink|have|add|increase|decrease|raise|lower|reduce|change|adjust|set|double|halve|skip|stop|suspend|cut|switch|treat|cover|do|repeat|try|go|aim|dial|dose|resume|restart|pause|bump|boost|tweak|turn|proceed|program|programme|deliver|bring|keep|cancel|drop)\b|^\W*up\s+(?:your|the)\b/i;
// "Same again" or "repeat" points back at an earlier treatment on its own.
const STRONG_BACK_REFERENCE = /\b(?:same again|repeat(?!ed\b)\w*)\b/i;
// "The same" or "as before" is a comparison unless instruction wording joins
// it: "Your mean glucose was the same" passes; "You could do the same tonight"
// does not.
const BACK_REFERENCE =
  /\b(?:the same|same amount|again|that amount|that much|as much|as before|like last time|like before)\b/i;
// Clause boundaries inside one sentence. A recorded clause must not shelter
// an instruction after it: "You logged 3 U at lunch; repeat this dose".
const CLAUSE_BOUNDARY = /;|\s[-–—]\s|,\s*(?=(?:so|then|and then|but|now|next time)\b)/i;

function maskDescriptiveForms(sentence: string) {
  return DESCRIPTIVE_MASKS.reduce((text, mask) => text.replace(mask, " "), sentence);
}

function splitSentences(text: string) {
  return text
    // Semicolons stay inside a sentence so "...; do the same" keeps its topic.
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isRecordedEventDescription(sentence: string, masked: string) {
  if (DIRECTIVE_MARKER.test(masked)) return false;
  if (BASE_TREATMENT_VERB.test(masked) || TREATMENT_GERUND_FORM.test(masked)) return false;
  if (AMOUNT.test(sentence) && !RECORD_MARKER.test(sentence)) return false;
  return true;
}

function backReferenceInstruction(masked: string) {
  return (
    STRONG_BACK_REFERENCE.test(masked) ||
    (BACK_REFERENCE.test(masked) && DIRECTIVE_MARKER.test(masked))
  );
}

function clauseIsTreatmentDirective(clause: string) {
  if (TREATMENT_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(clause))) return true;
  const masked = maskDescriptiveForms(clause);
  if (INHERENT_TREATMENT_ACTION.test(masked)) return true;
  const topical = clause.replace(RANGE_WORDING, " ");
  if (!TREATMENT_TOPIC.test(topical) && !PROHIBITED_TREATMENT_OUTPUT.test(topical)) {
    // A clause with no treatment word can still give the instruction by
    // pointing back at an earlier one: "Do the same tonight."
    return IMPERATIVE_START.test(masked) || backReferenceInstruction(masked);
  }
  return !isRecordedEventDescription(clause, masked);
}

function sentenceIsTreatmentDirective(sentence: string) {
  if (clauseIsTreatmentDirective(sentence)) return true;
  // Each later clause is checked on its own as well, so a recorded first
  // clause cannot make an instruction after it look like a record.
  const clauses = sentence.split(CLAUSE_BOUNDARY).map((clause) => clause.trim()).filter(Boolean);
  return clauses.length > 1 && clauses.some(clauseIsTreatmentDirective);
}

/**
 * Education answers explain physiology in the present tense ("activity can
 * increase insulin sensitivity"), so the recorded-event test does not apply.
 * They still get the instruction patterns and the imperative and
 * back-reference checks, sentence by sentence.
 */
function containsEducationTreatmentDirective(text: string) {
  const normalised = text.replace(/[‘’]/g, "'");
  if (TREATMENT_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(normalised))) return true;
  return splitSentences(normalised)
    .flatMap((sentence) => [sentence, ...sentence.split(CLAUSE_BOUNDARY)])
    .some((clause) => {
      const masked = maskDescriptiveForms(clause.trim());
      return (
        IMPERATIVE_START.test(masked) ||
        /\bgo ahead and\b/i.test(masked) ||
        STRONG_BACK_REFERENCE.test(masked)
      );
    });
}

/**
 * True when text instructs or recommends a treatment action, a dose or a
 * pump-setting change, or when a sentence about treatment cannot be shown to
 * describe a recorded event. Only past-tense or plainly descriptive
 * statements about recorded events pass.
 */
export function containsTreatmentDirective(text: string) {
  const normalised = text.replace(/[‘’]/g, "'");
  return (
    TREATMENT_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(normalised)) ||
    splitSentences(normalised).some(sentenceIsTreatmentDirective)
  );
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
      ? PROHIBITED_EDUCATION_TREATMENT_OUTPUT.test(treatmentCopy) ||
        containsEducationTreatmentDirective(treatmentCopy)
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
