/**
 * Extra checks on hosted Tarv1s replies, added to the sentence rules in
 * guardrails.ts and generalEducation.ts. They catch a dose, a setting value or
 * a treatment choice written in shapes those rules do not read: ratios
 * ("1:8", "8 g per unit"), a setting next to a number ("ISF 2.4"), a
 * percentage of basal or profile, an amount spelled out ("half a unit", "a
 * couple of units", "6 of NovoRapid"), dose arithmetic ("60/10 = 6"), "no
 * need to bolus", a bare number or yes/no, and the same in other languages.
 *
 * The model text is first mapped to plain text (normaliseSafetyText), so
 * fullwidth digits, hidden characters, look-alike letters and digits written
 * for letters ("un1ts") read as the plain words.
 *
 * General education may still explain what a setting is, how insulin and
 * food act, and that changes belong with the diabetes team.
 *
 * Hermes: no lookbehind, named groups, Unicode property escapes or s/y/u/v/d
 * flags; every pattern is linear.
 */
import { safetyTextReadings } from "./textNormalise";

const NUMBER_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|half)`;
const AMOUNT = String.raw`(?:\d+(?:[.,]\d+)?|${NUMBER_WORD})`;
const INSULIN_NAME = String.raw`(?:lantus|levemir|tresiba|toujeo|abasaglar|basaglar|semglee|novorapid|novolog|humalog|fiasp|lyumjev|apidra|admelog|trurapi|insulatard|humulin|actrapid)`;
/** Settings a reply must not give a value for or a direction to. */
const SETTING = String.raw`(?:isf|icr|i\s*:\s*c|(?:carb(?:ohydrate)?\s+)?ratios?|basal(?:\s+rates?)?|targets?(?!\s+ranges?)|temp(?:orary)?\s+(?:targets?|basals?)|(?:insulin\s+)?sensitivity\s+factor|correction\s+factors?|profiles?(?:\s+percentage)?|dia|max\s+(?:iob|smb(?:\s+minutes)?|basal)|smb\s+(?:settings?|minutes)|autosens)`;
/** Any treatment topic, for the endorsement checks. */
const TREATMENT_WORD = String.raw`(?:insulin|units?|u|bolus\w*|pre-?bolus\w*|basal|smbs?|ratios?|isf|icr|targets?|profiles?|doses?|dosing|corrections?|carbs?|carbohydrates?|sugar|juice|glucose\s+tablets?|dextrose|jelly\s+bab(?:y|ies)|glucagon|snacks?|suspend\w*|disconnect\w*|dia|iob|${INSULIN_NAME}|eating\s+soon|exercise\s+mode|temp\s+target|\d+\s*(?:g|grams?|ml|%|minutes?|mins?))`;
const LOW_TREATMENT = String.raw`(?:jelly\s+(?:babies|beans)|glucose\s+(?:tabs?|tablets?|gel)|dextrose(?:\s+tablets?)?|tablets?|sweets|biscuits?|juice|lucozade|cola|coke|fizzy\s+drinks?|sugary\s+drinks?|glucogel|haribo|skittles)`;
const LOW_TREATMENT_CONTEXT = String.raw`(?:fast|quick|sugar|glucose|juice|dextrose|tablets?|sweets|jelly|lows?|hypos?|treat\w*|snack|without\s+insulin|recheck|re-check|check\s+again|fix|bring\s+you\s+up|bedtime|before\s+bed)`;

const CARE_TEAM = String.raw`(?:(?:your|the|their|a)\s+(?:diabetes|healthcare|health\s+care|care|clinical|medical)\s+team|(?:your|the|their|a)\s+(?:clinician|doctor|gp|nurse|dsn|consultant|specialist|educator|dietitian))`;
/** Wording that hands the decision to the care team: "best agreed with your diabetes team". */
const TEAM_DEFERRAL = new RegExp(
  String.raw`\b(?:question|matter|decision|conversation|something|one)\s+(?:for|to\s+(?:raise|discuss|agree)\s+with)\s+${CARE_TEAM}|\b(?:agreed|discussed|decided|worked\s+out|reviewed|made|set)\s+(?:with|by)\s+${CARE_TEAM}|\b(?:discuss|agree|decide|talk\s+(?:through|about)|review)\b[^.?!\n]{0,40}\bwith\s+${CARE_TEAM}|\b(?:ask|talk\s+to|check\s+with|speak\s+(?:to|with))\s+${CARE_TEAM}`,
  "i",
);
/** "how many grams of carbohydrate one unit of insulin covers" defines a ratio without giving one. */
const UNIT_DEFINITION =
  /\b(?:one|a|each|every|per)\s+unit\s+of\s+(?:rapid[\s-]acting\s+|fast[\s-]acting\s+|bolus\s+|basal\s+)?insulin\s+(?:covers|lowers|reduces|drops|brings|will|would|is\s+expected|can|could|might|may)\b/gi;
/** A verdict on an amount: "that amount sounds right", "it's too much", "fine to take". */
const AMOUNT_VERDICT =
  /\b(?:safe|right|correct|reasonable)\s+amount\b|\b(?:that|this|it)(?:'s|\s+is|\s+would\s+be|\s+sounds|\s+seems|\s+looks)\s+(?:like\s+)?(?:too\s+(?:much|little|many|few)|plenty(?!\s+of\s+(?:time|data|records?|readings?|days?|nights?|information))|not\s+enough(?!\s+(?:data|records?|readings?|days?|nights?|information|coverage))|enough(?:\s+(?:insulin|units?|carbs?|to\s+(?:cover|take|bring|fix|treat)))?\W*$|fine\s+to\s+take\b|a\s+safe\b)|\b(?:fine|ok(?:ay)?|safe|alright)\s+to\s+(?:take|bolus|inject|correct|disconnect|suspend|skip|stack|eat|leave|have)\b|\b(?:that|this|the|your)\s+(?:amount|dose|number|figure|bolus|correction|plan|setting|ratio|split|basal)\s+(?:sounds|seems|looks|is)\s+(?:about\s+)?(?:right|correct|ok(?:ay)?|fine|reasonable|good|safe|sensible|spot\s+on)\b|^\W*(?:yes|yep|yeah)\b[^.?!\n]{0,30}\b(?:sounds|looks|seems)\s+(?:right|fine|good|ok(?:ay)?|correct|reasonable)\b/i;

/** Rules for every sentence of an education reply. */
const EDUCATION_RULES: readonly RegExp[] = [
  // Ratios: "1:8", "one to eight", "8 g per unit", "1 unit per 10 grams", "2.5 mmol/L per unit", "0.5 U/h".
  /\b1\s*:\s*\d/,
  /\bone\s+to\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|\d+)\b(?!\s+(?:hours?|minutes?|days?|weeks?|months?|years?|times?|people|percent|mmol|of\b))/i,
  new RegExp(String.raw`\b(?:units?|u|g|grams?|mmol(?:\s*\/\s*l)?|mg\s*\/\s*dl)\s+(?:per|for\s+(?:every|each))\s+(?:(?:\d+(?:[.,]\d+)?|${NUMBER_WORD})\s*)?(?:units?|u\b|mmol|mg|g\b|grams?|hours?|hr|h\b)`, "i"),
  /\bu\s*\/\s*h(?:r|our)?\b|\bunits?\s+(?:per|an|a)\s+hour\b/i,
  // A setting with a value: "ISF 2.4", "Target: 5.5", "a target of 5.5 mmol/L", "5.5 mmol/L target", "DIA should be 6 hours".
  new RegExp(String.raw`\b${SETTING}\b[^.?!\n\d]{0,25}\d`, "i"),
  new RegExp(String.raw`\b\d+(?:[.,]\d+)?\s*(?:mmol\s*\/\s*l|mg\s*\/\s*dl|u\s*\/\s*h|%|percent)?\s+(?:${SETTING})\b`, "i"),
  new RegExp(String.raw`\b${SETTING}\s+(?:should|ought\s+to|needs?\s+to|must|wants?\s+to)\s+be\b|\byours\s+(?:wants|needs|should|ought)\b`, "i"),
  // Percentages of basal, profile or a dose: "basal by 10-20%", "an 80% profile", "60% up front", "ten percent more".
  new RegExp(String.raw`(?:\d+(?:[.,]\d+)?(?:\s*-\s*\d+)?\s*(?:%|percent|per\s+cent)|\b(?:ten|twenty|thirty|forty|fifty|five|fifteen|eighty|ninety|a\s+hundred|hundred|a\s+third|a\s+quarter|a\s+half)\s+(?:percent|per\s+cent)?)[^.?!\n]{0,40}\b(?:basal|profile|temp|ratio|insulin|bolus|dose|target|reduction|less|more|lower|higher|up\s+front|off|increase|decrease|cut|over)\b`, "i"),
  /\b(?:basal|profile|temp\s+basal|ratio|bolus|dose|insulin|reduc\w*|lower\w*|rais\w*|increas\w*|decreas\w*|cut\w*|add|knock|drop\w*|by|at|to|un|de)\s+(?:\w+\s+){0,3}?\d+(?:[.,]\d+)?(?:\s*-\s*\d+)?\s*(?:%|percent|per\s+cent)|\b(?:by|add)\s+(?:ten|twenty|thirty|fifty|five|fifteen|a\s+third|a\s+quarter)\s*(?:percent|per\s+cent)?\b/i,
  new RegExp(String.raw`\b(?:${SETTING}|bolus|insulin)\b[^.?!\n]{0,30}\b(?:too|a\s+touch|a\s+bit|slightly|rather|probably|likely)\s+(?:high|low|weak|strong|short|long|aggressive|much|little|soft|cautious)\b|\btoo\s+(?:much|little)\s+(?:${SETTING}|insulin|bolus)\b|\b(?:${SETTING})\s+(?:is|looks|seems|appears)\s+(?:too|a\s+touch|a\s+bit|slightly)\b`, "i"),
  new RegExp(String.raw`\b(?:raise|raising|lower|lowering|set|setting|change|changing|move|moving|increase|increasing|reduce|reducing|drop|dropping|ease|easing|go|going|dial|dialling|dialing|bring|bringing|nudge|nudging|switch|switching)\b[^.?!\n]{0,30}\b(?:${SETTING}|it)\b[^.?!\n]{0,20}\b(?:to|at|from|down\s+to|up\s+to)\s+\d`, "i"),
  /\b(?:shave|knock|take)\s+(?:a\s+little|a\s+bit|some|\d+\s*%|ten\s+percent)\s+off\b|\bfront[\s-]?load\w*|\bdial\s+(?:\w+\s+){0,2}?(?:back|down|up)\b|\bnudge\s+(?:\w+\s+){0,2}?(?:up|down)\b/i,
  // Features on or off: "SMBs off overnight", "Autosens off", "switching off SMBs".
  /\b(?:smbs?|autosens|the\s+loop|closed\s+loop|uam|dynamic\s+isf|super\s+bolus)\s+(?:switched\s+|turned\s+)?(?:off|on)\b|\b(?:switch|turn)(?:ing)?\s+(?:off|on)\s+(?:smbs?|autosens|the\s+loop|uam|dynamic\s+isf)\b|\b(?:switch|turn)(?:ing)?\s+(?:smbs?|autosens|the\s+loop|uam)\s+(?:off|on)\b/i,
  // Amounts of insulin: "6 units", "6U", "6 IU", "6-unit", "6 E", "6 Einheiten", "twelve units".
  new RegExp(String.raw`\b${AMOUNT}\s*-?\s*(?:units?|iu|u|einheiten|einheit|unidades|unidad|unites|unite|unita|eenheden|eenheid|jednostek|jednostki)\b`, "i"),
  /\b\d+(?:[.,]\d+)?\s?E\b|\b\d+e\b/,
  /\b(?:half\s+a|a\s+couple\s+of|a\s+few|an?\s+extra|another|a\s+further|one\s+more|a\s+single)\s+units?\b|\ba\s+unit\s+and\s+a\s+half\b|\band\s+a\s+half\s+units?\b|\bhalf\s+a\s+dozen\b/i,
  new RegExp(String.raw`\b${AMOUNT}\s+(?:of\s+)?(?:${INSULIN_NAME}|(?:rapid|fast|short|long|quick)[\s-]acting|basal\s+insulin|bolus\s+insulin|insulin)\b`, "i"),
  new RegExp(String.raw`\bworks?\s+out\s+(?:at|to|as)\s+(?:about\s+|around\s+|roughly\s+)?(?:${AMOUNT}|a\s+dozen)\b|\b(?:answer|amount|dose|figure|result)\s+(?:is|would\s+be|=)\s+(?:about\s+|around\s+|roughly\s+)?${AMOUNT}\b`, "i"),
  // Dose arithmetic: "60/10 = 6", "45 / 9 = 5", "(14 - 6) ÷ 3 ≈ 2.7", "sixty over ten is six", "45 divided by 9".
  /[=≈÷×]\s*\(?\s*\d|\d\s*\)?\s*[=≈÷×]/,
  new RegExp(String.raw`\b(?:${AMOUNT}|sixty|seventy|ninety|hundred)\s*(?:g|grams?)?\s+(?:over|divided\s+by|minus|times|multiplied\s+by)\s+${AMOUNT}\b`, "i"),
  /\b\d+\s*\/\s*\d+\b[^.?!\n]{0,40}\b(?:over|split|up\s+front|suits?|hours?|bolus|dose|units?|insulin|pizza)\b/i,
  // Not dosing: "no need to bolus", "skip your bolus", "nothing extra is needed".
  /\bno\s+need\s+(?:to\s+)?(?:bolus|inject|correct|take|cover|dose|for\s+(?:insulin|a\s+bolus))\b|\b(?:don't|do\s+not)\s+need\s+(?:any\s+|to\s+(?:take|bolus|inject|give|cover)\s+)?(?:insulin|bolus|a\s+bolus|units?|correction|anything|any)\b|\bnothing\s+extra\b|\bno\s+(?:bolus|insulin|correction)\s+(?:is\s+)?(?:needed|required|necessary)\b|\bskip(?:ping)?\s+(?:your|the|a)\s+(?:bolus|basal|dose|insulin|correction|injection)\b|\bwithout\s+insulin\b/i,
  // Timing: "15 minutes before", "Pre-bolusing 15-20 minutes ahead", "a 15 minute pre-bolus", "20 minutes after bolusing".
  new RegExp(String.raw`\b(?:\d+(?:\s*-\s*\d+)?|${NUMBER_WORD}|forty[\s-]five|ninety)[\s-]*(?:minutes?|mins?|hours?|hrs?)\s+(?:before|ahead|earlier|prior|in\s+advance|after\s+(?:bolus\w*|eating|injecting|the\s+bolus))\b|\b\d+[\s-]*minute\s+pre-?bolus|\bpre-?bolus\w*\s+(?:about\s+|around\s+)?\d`, "i"),
  // Low treatment: "15 g of fast carbohydrate", "Three glucose tablets", "150 ml of juice", "a glass of juice is the standard fix".
  new RegExp(String.raw`\b(?:\d+(?:[.,]\d+)?(?:\s*-\s*\d+)?|${NUMBER_WORD})\s*(?:g|grams?|ml|millilitres?|milliliters?)\b[^.?!\n]{0,40}\b${LOW_TREATMENT_CONTEXT}|\b${LOW_TREATMENT_CONTEXT}\b[^.?!\n]{0,40}\b(?:\d+(?:[.,]\d+)?|${NUMBER_WORD})\s*(?:g|grams?|ml)\b`, "i"),
  new RegExp(String.raw`\b${AMOUNT}(?:\s+or\s+${AMOUNT})?\s+(?:small\s+|large\s+)?${LOW_TREATMENT}`, "i"),
  new RegExp(String.raw`\b(?:glass|cup|carton|can|bottle|box|handful)\s+of\s+(?:juice|coke|cola|lucozade|sweets|jelly\s+babies)\b[^.?!\n]{0,40}\b(?:fix|treat|bring|raise|standard|usual|right|enough|should|will|would)\b`, "i"),
  // Medicines and insulin brands chosen for the reader.
  new RegExp(String.raw`\b(?:switch\w*|mov(?:e|ing)|start\w*|stop\w*|add\w*|try\w*)\s+(?:\w+\s+){0,2}?(?:to\s+)?(?:${INSULIN_NAME}|metformin|sglt-?2\w*|glp-?1\w*|dapagliflozin|empagliflozin|semaglutide|ozempic|wegovy|mounjaro|tirzepatide|acarbose)\b|\b(?:${INSULIN_NAME}|metformin|semaglutide|ozempic|mounjaro)\b[^.?!\n]{0,40}\b(?:would|might|could|will|may)\s+(?:suit|help|work|be\s+better|solve)`, "i"),
  // Fixed plans: "half now, half later", "the rest later", "an extended bolus over three hours", "two now".
  new RegExp(String.raw`\bhalf\s+(?:now|up\s+front|at\s+the\s+start)\b|\bthe\s+rest\s+(?:later|after|over|once)\b|\bextended\s+bolus\s+over\s+(?:\d|${NUMBER_WORD}|an?\s+hour)|\b${AMOUNT}\s*(?:u|units?)?\s+(?:now|up\s+front|straight\s+away|right\s+away)\b|\bthen\s+${AMOUNT}\b(?!\s+(?:hours?|minutes?|days?|weeks?|months?|years?|times?|people|percent|mmol))|\blowers?\s+(?:you|glucose|it)\s+by\s+(?:about\s+|around\s+)?\d|\bfrom\s+\d+(?:[.,]\d+)?\s+to\s+\d+(?:[.,]\d+)?\b[^.?!\n]{0,20}\btakes?\b`, "i"),
  // Personal markers: "for you", "in your case", "if I were you", "my view", "TL;DR", "your next step", "step one".
  /\b(?:if\s+i\s+were\s+you|my\s+(?:view|take|advice|suggestion|recommendation)|personally|tl;?\s*dr|short\s+version|your\s+next\s+step|step\s+(?:one|two|three|1|2|3)\b|in\s+practice\s+that\s+means|what\s+you\s+(?:want|need)(?:\s+here)?|i\s+(?:would|'d)\s+(?:go|take|lower|raise|start|try|use|set))\b/i,
  /^\W*(?:\(?\s*\d+\s*[).]|[•*-])\s*(?:more|less|stronger|weaker|higher|lower|earlier|later|raise|lower|turn|switch|reduce|increase)\b/im,
  AMOUNT_VERDICT,
];

/**
 * Directions, fit and personal framing. A sentence that hands the decision to
 * the diabetes team and gives no number may use them: "Whether a stronger
 * ratio suits you is a question for your diabetes team".
 */
const DEFERRABLE_RULES: readonly RegExp[] = [
  /\bsuits?\s+you\b|\bsolves?\s+(?:that|it|this)\b/i,
  /\b(?:for\s+you|in\s+your\s+(?:case|position|situation))\b/i,
  // A direction for a setting or dose: "a stronger ratio", "more basal", "less insulin at dinner", "earlier boluses".
  new RegExp(String.raw`\b(?:stronger|weaker|higher|lower|bigger|smaller|larger|more|less|extra|tighter|looser|gentler|softer|aggressive|earlier|later|sooner)\s+(?:\w+\s+)?(?:${SETTING}|bolus(?:es)?|corrections?|doses?|smbs?|insulin(?!\s+(?:sensitivity|resistance|absorption|needs|requirements?|action|levels?|production|is|can|may|works?)))\b`, "i"),
  new RegExp(String.raw`\b(?:lower|lowering|raise|raising|increase|increasing|decrease|decreasing|reduce|reducing|strengthen\w*|weaken\w*|tighten\w*|loosen\w*|bump\w*|nudge|nudging|drop|dropping|cut|cutting|shave|shaving|knock|knocking|ease|easing|change|changing|adjust\w*|tweak\w*|dial\w*|move|moving|shift\w*|up|upping|run|running|set|setting|split|splitting|front[\s-]?load\w*)\s+(?:your|the|my|a|an)\s+(?:\w+\s+){0,2}?(?:${SETTING}|bolus(?:es)?|corrections?|doses?|smbs?)\b`, "i"),
];

/** Endorsement phrases that turn a treatment named in the same sentence into advice. */
const ENDORSEMENT =
  /\b(?:is|are)\s+(?:typical|usual|common|standard|normal|fine|ok(?:ay)?|plenty|enough|about\s+right|right|best|better|safer|cleaner|ideal)\b|\b(?:a\s+)?(?:common|typical|usual|standard|sensible|reasonable|good|safe)\s+(?:first\s+step|choice|amount|approach|place\s+to\s+(?:start|begin)|starting\s+point|fix|answer|adjustment|way|option|setting|setup|call)\b|\b(?:place\s+to\s+(?:start|begin)|starting\s+point|where\s+most\s+(?:people|runners)\s+start|what\s+most\s+(?:people|runners)\s+do|the\s+way\s+to\s+go|the\s+right\s+call|works?\s+(?:well|better)|tends?\s+to\s+(?:cover|prevent|help|work|fix)|usually\s+(?:works|solves|fixes|flattens|helps|covers)|should\s+(?:do|bring|cover|help|work|fix)|ought\s+to\s+do|would\s+(?:cover|do|help|fix|be\s+gentler|give)|is\s+what\s+(?:the\s+pattern\s+calls\s+for|to\s+set|you\s+need)|calls\s+for|the\s+(?:fix|answer|solution)\s+(?:is|here)|(?:is|are)\s+the\s+(?:answer|fix|solution)|ballpark|suits?\b|fits?\s+what\s+you)\b/i;
const TREATMENT_TOPIC = new RegExp(String.raw`\b${TREATMENT_WORD}\b`, "i");

/** A whole reply that is only an answer word: "Yes.", "No.", "Don't.", "I would.". */
const ANSWER_WORD_ONLY =
  /^\W*(?:yes|no|yep|nope|yeah|sure|don't|do\s+not|do\s+it|go\s+(?:ahead|for\s+it)|i\s+would(?:\s+not|n't)?|i\s+wouldn't|i\s+would|definitely(?:\s+not)?|absolutely(?:\s+not)?|correct|right|fine|ok(?:ay)?)\W*(?:(?:yes|no|that's\s+(?:fine|right))\W*)?$/i;
/** A short sentence that is a number: "Six.", "2u.", "Three should do.", "About six would cover it.", "120%.". */
const BARE_AMOUNT_SENTENCE = new RegExp(
  String.raw`^\W*(?:(?:about|around|roughly|approximately|maybe|probably|just|yes|no|so|then|and|or|tl;?\s*dr)\W+)*${AMOUNT}(?:\s+and\s+a\s+half)?(?:\s*(?:u|units?|iu|g|grams?|ml|%|percent|mmol(?:\s*\/\s*l)?))?(?:\s+(?:would|should|ought|will|could|might|may|is|sounds|now|then|overnight|tonight|daily|at\s+night)\b[^.?!\n]{0,40})?\W*$`,
  "i",
);
/** Common names with digits that are not amounts. */
const NAMES_WITH_DIGITS = /\b(?:type\s*[12]|t[12]d?|hba1c|a1c|covid-?19|g[4-7]|libre\s*[23]|omnipod\s*5|level\s*[123])\b/gi;

function sentencesOf(text: string) {
  return text
    .split(/[.?!]+(?=\s|$)|\n+|;|\s[•*]\s/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(sentence: string) {
  return sentence.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

const ANY_AMOUNT = new RegExp(String.raw`\b${AMOUNT}\b`, "i");

/** Removes a ratio definition when the sentence then gives no amount. */
function withoutUnitDefinition(sentence: string) {
  const masked = sentence.replace(UNIT_DEFINITION, " ");
  return masked !== sentence && !ANY_AMOUNT.test(masked) ? masked : sentence;
}

// A general explanation can describe how therapy works. Pair the subject
// with a decision, or a direction addressed to a person, in either order.
const CHOICE = /\b(?:my|our|best|better)\s+(?:pick|vote|bet|choice|preference)\b|\b(?:gets?|has)\s+my\s+vote\b/i;
const PERSONAL_FRAME = /\b(?:you|your|yours|yourself)\b/i;
const ADJUSTABLE_THERAPY = new RegExp(String.raw`\b(?:${SETTING}|bolus(?:es)?|doses?|units?|pen clicks?)\b`, "i");
// "units" alone can be a definition ("measured in units"); with a quantity
// before it ("6 units", "a dozen units", "several units") it is an amount.
const UNIT_QUANTITY = String.raw`(?:\d+(?:[.,]\d+)?\s*|\b(?:several|some|many|dozen|handful\s+of|few|more|fewer|less|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\s+)(?:u|units?)\b`;
const DIRECTION_OR_AMOUNT = new RegExp(
  String.raw`\b(?:higher|lower|stronger|weaker|gentler|further|up|down|earlier|later|extra|fewer|more|less|bigger|smaller|larger|percent|quarter|half|(?:double|single)\s+digits?|(?:looks?|seems?|is|are)\s+(?:a\s+bit\s+|too\s+|quite\s+|rather\s+)?(?:small|big|large|low|high|light|heavy))\b|\d\s*%|${UNIT_QUANTITY}`,
  "i",
);

// Hosted prose is requested as plain text. A table can distribute its
// condition, unit and treatment across cells with no complete sentence.
const TABLE_ROW = /\|[^\n|]*\|/;

function sentenceBreaksRules(original: string) {
  const sentence = withoutUnitDefinition(original);
  const deferred = TEAM_DEFERRAL.test(sentence) && !/\d/.test(sentence);
  return (
    (TREATMENT_TOPIC.test(sentence) && (
      CHOICE.test(sentence) ||
      (!deferred && ADJUSTABLE_THERAPY.test(sentence) && PERSONAL_FRAME.test(sentence) && DIRECTION_OR_AMOUNT.test(sentence))
    )) ||
    EDUCATION_RULES.some((rule) => rule.test(sentence)) ||
    (!deferred && DEFERRABLE_RULES.some((rule) => rule.test(sentence))) ||
    (!deferred && TREATMENT_TOPIC.test(sentence) && ENDORSEMENT.test(sentence))
  );
}

function sentenceGivesTreatment(sentence: string) {
  if (sentenceBreaksRules(sentence)) return true;
  const plain = sentence.replace(NAMES_WITH_DIGITS, " ");
  if (BARE_AMOUNT_SENTENCE.test(plain)) return true;
  // A very short sentence with a number gives the number: "0.85 overnight.", "15 g.".
  return wordCount(plain) <= 3 && ANY_AMOUNT.test(plain) && !/\b(?:hours?|minutes?|days?|weeks?|months?|years?)\b/i.test(plain);
}

function readingGivesTreatment(answer: string, rest: string) {
  if (TABLE_ROW.test(answer) || TABLE_ROW.test(rest) || ANSWER_WORD_ONLY.test(answer)) return true;
  if (sentencesOf(answer).some(sentenceGivesTreatment)) return true;
  // Headline and limitations get the sentence rules, but not the short-sentence ones.
  return sentencesOf(rest).some(sentenceBreaksRules);
}

/**
 * True when a general-education reply gives a dose, a setting value, a
 * treatment amount or a treatment choice for the reader.
 */
export function educationReplyGivesTreatment(reply: { headline: string; answer: string; limitations: readonly string[] }) {
  const answers = safetyTextReadings(reply.answer);
  const rest = safetyTextReadings([reply.headline, ...reply.limitations].join("\n"));
  return answers.some((answer) => rest.some((other) => readingGivesTreatment(answer, other)));
}

/**
 * The part of the education checks that also applies to answers built from
 * the user's records. Recorded values ("Your basal was 0.85 U/h overnight")
 * stay allowed there; a verdict, a bare amount or an endorsement does not.
 */
const PERSONAL_RULES: readonly RegExp[] = [
  AMOUNT_VERDICT,
  // "The answer is six." A recorded value ("The recorded bolus amount is 3.5 U") stays allowed.
  new RegExp(String.raw`\b(?:answer|figure)\s+(?:is|would\s+be|=)\s+(?:about\s+|around\s+|roughly\s+)?${AMOUNT}\b|\b(?:amount|dose)\s+(?:would|should|ought\s+to|could)\s+be\s+(?:about\s+|around\s+|roughly\s+)?${AMOUNT}\b`, "i"),
  /\bpersonally\b|\b(?:take|bring|knock|turn|dial)\s+(?:it|that|this|things?|them|everything)\s+(?:down|up|back)\s+(?:a\s+)?(?:notch|bit|little|touch)\b|\ba\s+notch\b/i,
  /\bdisconnect\w*\b[^.?!\n]{0,40}\b(?:is|are)\s+(?:fine|ok(?:ay)?|safe|alright)\b/i,
  /\bhalf\s+(?:now|up\s+front)\b|\bthe\s+rest\s+(?:later|after)\b/i,
  new RegExp(String.raw`\b${AMOUNT}(?:\s+or\s+${AMOUNT})?\s+(?:small\s+|large\s+)?${LOW_TREATMENT}\b[^.?!\n]{0,30}\b(?:right|enough|fine|should|will|would|for\s+a\s+(?:low|hypo))`, "i"),
  new RegExp(String.raw`\b(?:${INSULIN_NAME}|metformin)\b[^.?!\n]{0,40}\b(?:would|might|could|will|may)\s+(?:suit|help|work|be\s+better)|\bsuits?\s+(?:you|pizza|that|this|the\s+meal)\b|\bsolves?\s+(?:that|it|this)\b`, "i"),
  /\b(?:the\s+way\s+to\s+go|what\s+most\s+(?:people|runners)\s+do|place\s+to\s+(?:start|begin)|starting\s+point|plenty\s+for\s+you|my\s+(?:view|take|advice)|if\s+i\s+were\s+you|tl;?\s*dr)\b/i,
  new RegExp(String.raw`\b${SETTING}\s+(?:should|ought\s+to|needs?\s+to|must|wants?\s+to)\s+be\b|\byours\s+(?:wants|needs|should|ought)\b|\b(?:your|the)\s+${SETTING}\s+(?:is|looks|seems)\s+too\s+\w+`, "i"),
  /\b1\s*:\s*\d+(?:[.,]\d+)?\b[^.?!\n]{0,30}\b(?:at\s+breakfast|would|should|begin|start|nearer|instead|better)\b|\b(?:nearer|around|about)\s+1\s*:\s*\d/i,
  new RegExp(String.raw`\b\d+\s*\/\s*\d+\b[^.?!\n]{0,40}\b(?:over|split|up\s+front|suits?)\b`, "i"),
];

function personalReadingGivesTreatment(text: string) {
  if (TABLE_ROW.test(text) || ANSWER_WORD_ONLY.test(text)) return true;
  return sentencesOf(text).some((sentence) => {
    if (PERSONAL_RULES.some((rule) => rule.test(sentence))) return true;
    const plain = sentence.replace(NAMES_WITH_DIGITS, " ");
    return BARE_AMOUNT_SENTENCE.test(plain) && !/\b(?:was|were|had|recorded|logged)\b/i.test(plain);
  });
}

/** True when an answer built from records gives a verdict, a bare amount or an endorsement of a treatment. */
export function personalReplyGivesTreatment(text: string) {
  return safetyTextReadings(text).some(personalReadingGivesTreatment);
}
