import { normaliseSafetyText } from "./textNormalise";
import type { TarvisConversationTurn } from "./types";

/**
 * General dose and treatment intent for the Tarv1s safety preflight.
 *
 * safety.ts holds the older, phrase-by-phrase rules. They kept leaking
 * because people ask for a dose in endless ways. This module adds a general
 * layer on top: a first- or second-person request frame ("should I", "am I
 * ok to", "is it safe to", "I'll", "what would you") joined to a dose,
 * setting or treatment object. It also holds the wording clean-up that lets
 * the rules read common typing slips, and the history test that keeps
 * questions about what already happened answerable.
 *
 * Every pattern is linear on a 1,500-character prompt: no lookbehind, no
 * named groups, no Unicode property escapes, no s or y flags (Hermes), and
 * every gap between words is bounded.
 */

const INSULIN_NAME = String.raw`(?:lantus|levemir|tresiba|toujeo|abasaglar|basaglar|semglee|novorapid|novolog|humalog|fiasp|lyumjev|apidra|admelog|trurapi|insulatard|humulin)`;
const LOW_TREATMENT_ITEM = String.raw`(?:jelly\s+(?:babies|beans)|glucose\s+(?:tabs?|tablets?|gel|juice|sweets)|dextrose(?:\s+(?:tabs?|tablets?))?|sweets|lucozade|haribo|skittles|glucogel|hypostop|juice|sugary\s+drinks?|fizzy\s+drinks?|coke|biscuits?)`;
const NUMBER_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|half\s+a)`;
const CARB_AMOUNT = String.raw`(?:\d+(?:[.,]\d+)?\s*(?:g|grams?)\b|(?:ten|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(?:g|grams?)\b)`;
const MEAL = String.raw`(?:breakfast|lunch|dinner|tea|supper|snack|meal|pizza|pasta|curry|chips|cake|takeaway|dessert|pudding|food)`;
const DOSE_NOUN = String.raw`(?:insulin|units?(?!\s+(?:to|from|in)\s+(?:mg|mmol))|u|iu|bolus(?:es)?|basal|smbs?|doses?|dosing|corrections?|shots?|injections?|${INSULIN_NAME})`;
const SETTING = String.raw`(?:basal(?:\s+rates?)?|bolus(?:es)?|smbs?|max\s+(?:iob|smb|basal)|(?:carb(?:ohydrate)?\s+)?ratios?|i\s*:\s*c|isf|(?:insulin\s+)?sensitivity(?:\s+factor)?|correction\s+factors?|targets?(?!\s+ranges?)|temp(?:orary)?\s+(?:targets?|basals?)|profiles?|tdd|total\s+daily\s+dose|dia|aaps|the\s+loop|${INSULIN_NAME})`;
/** What a request verb such as "take", "have" or "set" acts on in a dose request. */
const TREATMENT_OBJECT = String.raw`(?:${DOSE_NOUN}|${SETTING}|${LOW_TREATMENT_ITEM}|carbs?|carbohydrates?|glucagon|${CARB_AMOUNT}|snack|something|more|another|extra|less|some|half|it|that|this|them|${NUMBER_WORD}|\d+(?:[.,]\d+)?)`;

/** A dose, setting, carbohydrate or treatment topic: the gate for the looser frames. */
const DOSE_CONTEXT = new RegExp(
  String.raw`\b(?:${DOSE_NOUN}|${SETTING}|${LOW_TREATMENT_ITEM}|carbs?|carbohydrates?|glucagon|${MEAL}|lows?|hypos?|pre[\s-]?bolus\w*|inject\w*|correct\w*|treat\w*|suspend\w*|disconnect\w*|pump|loop)\b|${CARB_AMOUNT}|\bi'm\s+\d|\b\d+(?:[.,]\d+)?\s*(?:u|iu|mmol)\b`,
  "i",
);
/** Narrower than DOSE_CONTEXT: insulin, settings and carbohydrate amounts only. */
const STRICT_DOSE_CONTEXT = new RegExp(
  String.raw`\b(?:${DOSE_NOUN}|${SETTING}|${LOW_TREATMENT_ITEM}|carbs?|carbohydrates?|glucagon|pre[\s-]?bolus\w*|inject\w*|correct\w*)\b|${CARB_AMOUNT}|\b\d+(?:[.,]\d+)?\s*(?:u|iu)\b`,
  "i",
);

/** Verbs that order a change to a setting. */
const SETTING_CHANGE_VERB = String.raw`(?:alter|amend|modify|revise|update|tighten|loosen|raise|lower|increase|decrease|reduce|change|adjust|tweak|bump(?:\s+up)?|up|drop|cut|halve|double|ease\s+off(?:\s+on)?|back\s+off(?:\s+on)?|dial\s+(?:back|down|up)|ramp\s+(?:up|down)|turn\s+(?:up|down)|set|switch|cancel)`;

/** Verbs that are a dose or treatment action on their own. */
const INHERENT_VERB = String.raw`(?:bolus(?:ing)?|pre[\s-]?bolus(?:ing)?|inject(?:ing)?|correct(?:ing)?|dose|dosing|treat(?:ing)?(?:\s+(?:it|this|that|the\s+low|the\s+hypo|my\s+low))?|top\s+up|topping\s+up|stack(?:ing)?|suspend(?:ing)?|disconnect(?:ing)?|skip(?:ping)?\s+(?:my\s+|the\s+|a\s+)?(?:bolus|basal|dose|insulin|injection|correction)|do\s+(?:that|it|this|the\s+same)(?:\s+again)?)`;
/** Verbs that are a dose action only with a dose object after them. */
const OBJECT_VERB = String.raw`(?:(?:take|taking|give|giving|have|having|eat|eating|drink|drinking|add|adding|use|using|run|running|set|setting|put|putting|up|upping|change|changing|alter|altering|amend|modify|adjust|adjusting|tweak|tweaking|raise|raising|lower|lowering|increase|increasing|decrease|decreasing|reduce|reducing|cut|cutting|halve|halving|double|doubling|split|splitting|extend|need|go\s+(?:for|with|up|down|higher|lower)|stop|stopping|pause|pausing|turn|turning)(?!\s+(?:a\s+)?(?:look|peek|glance|break|walk|shower|nap|rest|photo|picture|screenshot)\b))`;
const FRAME_FILLER = String.raw`(?:(?:just|still|now|then|maybe|really|also|actually|definitely|go\s+ahead\s+and|try\s+(?:to|and)|need\s+to|have\s+to|want\s+to|be)\s+){0,3}`;
const VERB_PHRASE = String.raw`(?:${INHERENT_VERB}\b|${OBJECT_VERB}\s+(?:[\w']+\s+){0,3}?${TREATMENT_OBJECT}\b)`;

/** "should I", "can I", "do I" and the like. Habit questions ("do I usually") are not requests. */
const MODAL_I = String.raw`(?:should|shall|can|could|must|may|might|ought\s+to|do(?!\s+i\s+(?:usually|normally|typically|generally|often|always|ever|tend)\b))\s+i\s+`;
/** "I'll", "I'm going to", "I need to" and other first-person plans. */
const FIRST_PERSON_PLAN = String.raw`\bi(?:'ll|\s+will|'d|\s+would|'m\s+(?:going\s+to|about\s+to|thinking\s+(?:of|about)|planning\s+(?:to|on))|\s+am\s+(?:going\s+to|about\s+to|thinking\s+(?:of|about)|planning\s+(?:to|on))|\s+(?:need|want|plan|intend|have)\s+to|\s+might|\s+could|\s+should|\s+must)\s+`;

/**
 * Request frames that are refused only when the prompt has a dose,
 * setting, carbohydrate or treatment topic.
 */
const GATED_FRAMES: readonly RegExp[] = [
  new RegExp(String.raw`\b${MODAL_I}${FRAME_FILLER}${VERB_PHRASE}`, "i"),
  new RegExp(String.raw`${FIRST_PERSON_PLAN}${FRAME_FILLER}${VERB_PHRASE}`, "i"),
  // "am I ok to bolus", "is it safe to take more", "ok to stack", "fine for me to correct".
  new RegExp(String.raw`\b(?:ok(?:ay)?|safe|fine|alright|all\s+right|wise|sensible|better|best|a\s+good\s+idea)\s+(?:for\s+me\s+)?to\s+${FRAME_FILLER}${VERB_PHRASE}`, "i"),
  new RegExp(String.raw`\bworth\s+(?:a\s+|an\s+)?(?:bolus\w*|correct\w*|inject\w*|taking|treating|topping\s+up|stacking|extra|another|units?)\b`, "i"),
  // "how much do I give", "how many units should I take", "how much would you take".
  new RegExp(String.raw`\bhow\s+(?:many|much)\b[^.?!\n]{0,40}\b(?:do|should|shall|would|will|can|must)\s+(?:i|you)\s+(?:take|give|bolus|inject|have|eat|use|add|dose|correct|need|go\s+for|put|set|run)\b`, "i"),
  // "what do I do", "what do I give", "what should I eat". "What should I do
  // differently next time?" after a past event is a reflective question and
  // goes to the answer route, whose output check blocks any directive.
  new RegExp(String.raw`\bwhat\s+(?:do|should|shall|can|must)\s+i\s+(?:give|take|inject|bolus|dose|change|alter|adjust|set|eat|have|do(?!\s+differently\b))\b(?!\s+to\s+(?:see|view|read|check|find|look|open|get|show)\b)`, "i"),
  // "How much for the same meal next time?", "grams per unit?" after a record question.
  /^\W*(?:(?:and|so|ok(?:ay)?)\s+)?how\s+(?:much|many)\b(?:(?!\b(?:did|was|were|had)\b)[^.?!\n]){0,60}?\b(?:next\s+time|same\s+meal|same\s+again)\b/i,
  /^\W*(?:(?:and|so|ok(?:ay)?)\s+)?(?:grams?|g|carbs?)\s+(?:per|a|an|for\s+(?:a|one|each))\s+unit\W*$/i,
  // Choosing between amounts: "20 or 22", "1:8 or 1:10", "15g or 20g", "15 or 20 mins".
  new RegExp(String.raw`\b(?:\d+:)?\d+(?:[.,]\d+)?\s*(?:u|units?|iu|g|grams?|%|percent|mins?|minutes?|mmol)?\s+or\s+(?:\d+:)?\d+(?:[.,]\d+)?\s*(?:u|units?|iu|g|grams?|%|percent|mins?|minutes?|mmol)?\b(?!\s*(?:days?|weeks?|months?|hours?|hrs?|years?|times?|readings?|am|pm|o'clock|:))|\b1\s+to\s+\d+\s+or\s+1\s+to\s+\d+\b`, "i"),
  // "60g pasta what do you reckon": a whole sentence ending with an opinion request.
  /\bwhat\s+(?:do|would)\s+you\s+(?:reckon|think|suggest|recommend|advise)\W*$/i,
  /\b(?:need|want)\s+a\s+bit\s+(?:extra|more)\b|\breckon\s+i\s+need\b/i,
  /\b(?:won't|wont|will\s+not)\s+hurt\b|\bhow\s+much\s+is\s+too\s+much\b/i,
  new RegExp(String.raw`\b(?:anything|something|what)\s+(?:i\s+(?:should|ought\s+to|need\s+to|could|can)\s+|to\s+)(?:change|alter|adjust|tweak|amend|modify)\b`, "i"),
  /\b(?:more|less)\s+aggressive\b/i,
  /\bis\s+(?:this|that|it)\s+enough\b/i,
  // "Same tonight?" with a dose topic; "the same today as yesterday" compares records.
  /\bsame\s+(?:tonight|today|now)\b(?!\s+(?:as|than)\b)/i,
  /^\W*(?:(?:so|and|but)\s+)?(?:is\s+)?(?:that|this|it)\s+(?:ok(?:ay)?|alright|fine|enough|safe|too\s+(?:much|many))\W*$/i,
  /\b(?:work|figure)\s+it\s+out\b/i,
  // "pizza later how much", "60g pasta how many units".
  new RegExp(String.raw`\b(?:${MEAL}|${CARB_AMOUNT})[^.?!\n]{0,30}\bhow\s+(?:much|many)\b`, "i"),
  // Choosing between treatments: "inject or wait", "juice or tablets", "open loop or closed loop".
  /\b(?:inject|correct|bolus|treat|eat|juice|tablets|dextrose|wait|leave\s+it|open[\s-]loop|closed[\s-]loop|suspend)(?:\s+(?:now|it))?\s+or\s+(?:\w+\s+)?(?:inject|correct|bolus|treat|eat|juice|tablets|dextrose|wait|leave\s+it|closed[\s-]loop|open[\s-]loop|suspend)\b/i,
];

/** Dose, setting and treatment requests clear enough to refuse without a topic gate. */
const DIRECT_FRAMES: readonly RegExp[] = [
  new RegExp(String.raw`\b${MODAL_I}${FRAME_FILLER}${INHERENT_VERB}\b`, "i"),
  // "Convert to units", "convert that into insulin": carbs turned into a dose.
  /\bconvert\w*\s+(?:(?:that|it|this|them|those|these|my\s+carbs|the\s+carbs)\s+)?(?:in)?to\s+(?:units?|insulin|a\s+dose|a\s+bolus)\b/i,
  // "Lowered basal next?", "higher ratio tonight?".
  new RegExp(String.raw`\b(?:lower(?:ed)?|raised?|higher|increased?|decreased?|reduced?|cut|upped|stronger|weaker)\s+(?:my\s+|the\s+)?(?:${SETTING}|basal|bolus|insulin)\s+(?:next|tonight|tomorrow|then)\b`, "i"),
  // "Should I eat something?", "should I drink juice": eating or drinking to
  // treat glucose. "Should I eat more protein?" is general nutrition.
  new RegExp(String.raw`\bshould\s+i\s+(?:just\s+|now\s+|still\s+)?(?:eat|drink|have)(?:\s*(?:[.?!,;\n]|$)|\s+(?:(?:a|an|some|more|another|my|the)\s+)?(?:something|anything|carbs?|carbohydrates?|sugar\w*|${LOW_TREATMENT_ITEM}|snack|\d|now\b|before\s+bed|to\s+(?:bring|treat|fix|raise|stop|prevent|cover)))`, "i"),
  // "what would you do", "how much would you take", "would you bolus".
  new RegExp(String.raw`\b(?:what|how\s+(?:much|many)(?:\s+[\w']+){0,2})\s+would\s+you\s+(?:do|take|give|bolus|inject|use|set|change|recommend|suggest|advise|go\s+for|correct|eat|have)\b`, "i"),
  /\bwould\s+you\s+(?:take|give|bolus|inject|correct|eat|treat|change|lower|raise|increase|decrease|set|stack|skip|suspend)\b/i,
  /\b(?:what|how\s+(?:much|many))\s+(?:[\w']+\s+){0,2}?do\s+you\s+(?:reckon|recommend|suggest|advise)\b/i,
  /\bin\s+my\s+shoes\b|\byour\s+call\b|\bif\s+you\s+were\s+me\b/i,
  // "is 2 units fine", "is two units ok", "15 grams enough".
  new RegExp(String.raw`\b(?:\d+(?:[.,]\d+)?|${NUMBER_WORD})\s*(?:u|units?|iu|g|grams?)\s+(?:(?:of\s+\w+\s+)?(?:is|be|would\s+be|sounds?|seems?)\s+)?(?:fine|ok(?:ay)?|enough|alright|right|safe|good|sensible|too\s+(?:much|many|little|few|high|low)|plenty)\b`, "i"),
  // "what's my dose", "what is my bolus for lunch" (not "what was", not "my bolus history").
  /\bwhat(?:'s|s|\s+is)\s+(?:my|the)\s+(?:right\s+|correct\s+|next\s+)?(?:dose|bolus|correction)\b(?!\s+(?:history|records?|totals?|count|data|was|were|did|yesterday|last|at\s+\d|on\s+\w+day))/i,
  /\b(?:give|giving)\s+myself\b/i,
  // "what bolus gets me to 6", "bring me down from 16", "how far will 2u drop me".
  /\b(?:gets?|brings?|takes?)\s+me\s+(?:back\s+)?(?:down\s+|up\s+)?(?:to|under|below|into)\s+(?:range|\d)|\b(?:bring|get)\s+(?:me|it)\s+(?:back\s+)?(?:down|up)\b|\bget\s+(?:me\s+)?(?:back\s+)?(?:down\s+)?to\s+\d|\b(?:drop|lower)\s+me\b|\bcome\s+down\s+(?:by\s+)?\d|\bget\s+(?:me\s+|it\s+)?from\s+\d+(?:[.,]\d+)?\s+(?:down\s+)?to\s+\d|\bhow\s+(?:do|can|should)\s+i\s+get\s+(?:it\s+|my\s+\w+\s+)?(?:back\s+)?(?:down|up)\b/i,
  // Applying a ratio or sensitivity: "use my ratio to work out 80g", "80g at 1:10".
  new RegExp(String.raw`\b(?:apply|use|using)\s+my\s+(?:isf|(?:carb\s+)?ratio|correction\s+factor|sensitivity)\b|\bdivided\s+by\s+my\s+(?:(?:carb\s+)?ratio|isf)\b|\bat\s+1\s*(?::|to)\s*\d+\b[^.?!\n]{0,30}\b(?:units?|how\s+(?:many|much)|is)\b|${CARB_AMOUNT}\s*at\s+1\s*(?::|to)\s*\d+`, "i"),
  new RegExp(String.raw`\b(?:work\s+out|calculate|figure\s+out|do\s+the\s+maths?\s+(?:for|on))\s+(?:my\s+|the\s+|a\s+)?(?:${MEAL}|${CARB_AMOUNT})`, "i"),
  // Hypo treatment amounts: "how many jelly babies", "carbs to treat this low".
  new RegExp(String.raw`\bhow\s+(?:many|much)\s+(?:[\w']+\s+){0,2}?${LOW_TREATMENT_ITEM}\b`, "i"),
  /\b(?:carbs?|grams?|g|sugar)\s+(?:do\s+i\s+need\s+|should\s+i\s+have\s+)?to\s+(?:treat|fix|bring\s+(?:it\s+|me\s+)?up|raise|sort)\b/i,
  /\b(?:needs?|requires?|takes?)\s+how\s+(?:many|much)\b/i,
  new RegExp(String.raw`\b(?:sensible|reasonable|right|good|correct|safe)\s+(?:amount\s+|dose\s+|bolus\s+|number\s+)?(?:for|with)\s+(?:a\s+|the\s+|my\s+)?(?:${MEAL}|${CARB_AMOUNT})`, "i"),
  new RegExp(String.raw`\b(?:thinking|reckon(?:ing)?|planning|plan|about\s+to|going\s+to)\s+(?:of\s+|on\s+|to\s+)?(?:[\w']+\s+)?(?:\d+(?:[.,]\d+)?|${NUMBER_WORD})\s*(?:u|units?|iu)\b`, "i"),
  new RegExp(String.raw`\b(?:\d+(?:[.,]\d+)?|${NUMBER_WORD})\s*(?:u|units?|iu)\s+(?:for|with|to\s+cover)\s+(?:the\s+|my\s+|a\s+|this\s+|that\s+)?(?:${MEAL}|${CARB_AMOUNT}|it|that|this|them)`, "i"),
  new RegExp(String.raw`\b(?:bolus|insulin|dose|units?|correction)\s+(?:for|with)\s+${CARB_AMOUNT}`, "i"),
  new RegExp(String.raw`\bhow\s+(?:many|much)\s+(?:units?\s+(?:of\s+)?|insulin\s+)?(?:for|before|with|to\s+cover)\s+(?:a\s+|the\s+|my\s+)?(?:${MEAL}|${CARB_AMOUNT})`, "i"),
  new RegExp(String.raw`\bhow\s+(?:much|many)\s+(?:units?\s+(?:of\s+)?)?${INSULIN_NAME}\b`, "i"),
  // "how much insulin for the carbs I entered", "units of insulin against the carbs", "how many carbs a day for me".
  /\b(?:insulin|units?|bolus|dose)\b[^.?!\n]{0,20}?\b(?:for|against|vs|versus|to\s+cover|to\s+match|per)\s+(?:(?:the|my|today's|tonight's|those|these|each|a|every|all)\s+)?(?:[\w']+\s+){0,2}?(?:carbs?|carbohydrates?|grams?|g)\b/i,
  /\b(?:carbs?|carbohydrates?|grams?|g)\s+(?:of\s+carbs?\s+)?(?:for|per|to)\s+(?:each|every|a|one|1)\s+units?\b/i,
  /\bhow\s+(?:many|much)\s+(?:grams?\s+of\s+)?(?:carbs?|carbohydrates?|insulin|units?|bolus|basal)\b[^.?!\n]{0,40}\bfor\s+me\b/i,
  // "another unit", "a bit more insulin", "top up with a unit".
  /\b(?:another|one\s+more|a\s+bit\s+(?:more|extra)|bit\s+more|bit\s+extra|an\s+extra|add\s+a|top\s+up\s+with\s+a)\s+(?:units?|u|bolus|correction|insulin|dose|shot|injection|smb)\b/i,
  /\bstack(?:ing)?\s+(?:another|a|more|insulin|bolus\w*|it|them|corrections?)\b|\bto\s+stack\b/i,
  /\b(?:would|will|could)\s+(?:a|one|another|an\s+extra|half\s+a)\s+(?:units?|bolus|correction)\s+(?:hurt|help|work|do)\b/i,
  new RegExp(String.raw`\bskip\s+(?:my\s+|the\s+|a\s+|tonight's\s+)?(?:bolus|basal|dose|insulin|injection|correction|${INSULIN_NAME})\b`, "i"),
  new RegExp(String.raw`\b(?:half|halve|double|quarter)\s+(?:of\s+)?(?:my\s+|the\s+)?(?:usual\s+)?(?:dose|bolus|basal|insulin|ratio|${INSULIN_NAME})\b|\busual\s+(?:dose|bolus|basal|amount)\s+or\b|\bsame\s+(?:dose|bolus|amount|basal|correction|units?)\s+as\b|\brepeat\s+(?:[\w']+\s+){0,2}?(?:bolus|dose|correction|basal)\b|\bsplit\s+(?:my|the)\s+(?:basal|bolus|dose|${INSULIN_NAME})\b`, "i"),
  /\brage\s+bolus\w*|\b(?:extended|split|dual|combo|square)(?:\s+wave)?\s+bolus\b(?!\s+(?:records?|history|data|totals?))/i,
  /\bpre[\s-]?bolus\w*\s+how\s+(?:long|early|soon|much)\b|\bhow\s+(?:long|early|soon)\b[^.?!\n]{0,30}\b(?:should|do|shall|to)\s+(?:i\s+)?pre[\s-]?bolus/i,
  /\bhow\s+long\s+(?:to|should\s+i|do\s+i|can\s+i)\s+(?:suspend|disconnect|stop|pause|leave\s+(?:it|the\s+pump))\b/i,
  /\bmean\s+for\s+my\s+(?:dose|bolus|basal|insulin|ratio|settings?|profile|isf|target)\b/i,
  // Profile percentage, temporary targets and basals, modes and loop state.
  /\b(?:what|which)\s+(?:%|percent(?:age)?)\s+profile\b|\bprofile\s+(?:at\s+|to\s+|of\s+)?\d{2,3}\s*(?:%|percent)|\b\d{2,3}\s*(?:%|percent)\s+profile\b/i,
  /\bset\s+(?:a\s+|my\s+|the\s+|up\s+a\s+)?temp(?:orary)?\s+(?:targets?|basals?)\b|\btemp(?:orary)?\s+(?:basal|target)\s+(?:of\s+|at\s+|to\s+)?\d|\b\d+\s*(?:%|percent)?\s+temp\b|\b(?:what|which)\s+temp(?:orary)?\s+(?:basal|target)\s+(?:should|shall|do|would|can)\s+i\b/i,
  /\b(?:eating\s+soon|exercise|activity|sport)\s+(?:mode|target)\b[^.?!\n]{0,30}\b(?:before|for|now|later|tonight|should|start|turn|put|set|use|go)\b|\b(?:should\s+i|start|turn\s+on|put\s+on|set|use)\s+(?:an?\s+|the\s+|my\s+)?(?:eating\s+soon|exercise|activity)\s+(?:mode|target)\b/i,
  /\b(?:open|close)\s+(?:the\s+|my\s+)?loop\b|\bgo\s+(?:closed|open)[\s-]loop\b/i,
  /\bshould\s+(?:aaps|the\s+loop|my\s+pump|it|the\s+pump)\s+be\s+\w+ing\b/i,
  // Judging a setting: "basal seems low to you", "does my basal look right", "am I on enough basal".
  new RegExp(String.raw`\b${SETTING}\s+(?:rate\s+)?(?:seems?|looks?|sounds?|feels?)\s+(?:a\s+bit\s+|too\s+|very\s+|quite\s+|about\s+)?(?:ok(?:ay)?|right|fine|correct|wrong|off|high|low|excessive|aggressive|weak|strong|much|little|enough)\b|\b(?:does|do)\s+(?:my|the)\s+${SETTING}\s+(?:\w+\s+)?(?:look|seem|sound)\b`, "i"),
  new RegExp(String.raw`\benough\s+(?:basal|insulin|bolus|units?|carbs?|${INSULIN_NAME})\b|\b(?:basal|insulin|bolus|units?|carbs?)\s+enough\b|\b(?:am\s+i|i'm)\s+(?:taking|having|getting|on|giving|eating|using)\s+(?:enough|too\s+(?:much|many|little|few))\b`, "i"),
  /\b(?:what|how)\s+about\s+(?:a\s+|an\s+|i\s+(?:do|try|use|set)\s+)?(?:temp(?:orary)?\s+(?:basal|target)|correction|bolus|extended\s+bolus|split\s+bolus|profile\s+switch|\d+(?:[.,]\d+)?\s*(?:u|units?|g|%))\b/i,
  new RegExp(String.raw`\b(?:best|ideal|optimal|right|correct|recommended|good|better)\s+(?:carb(?:ohydrate)?\s+ratio|ratio|isf|target(?!\s+ranges?)|basal(?:\s+rate)?|bolus|dose|profile|temp\s+target|correction\s+factor|tdd|amount\s+of\s+(?:insulin|carbs?)|${INSULIN_NAME}\s+dose)\b`, "i"),
  // "Same again", "same tonight", "same for dinner". Not "same again for
  // yesterday" (repeat the record question) or "the same today as yesterday".
  /\bsame\s+again\b(?!\s+(?:but\s+)?for\s+(?:yesterday|last|the\s+(?:day|week|last|previous|past)|(?:mon|tues|wednes|thurs|fri|satur|sun)day))|\bsame\s+for\s+(?:dinner|lunch|breakfast|tea|supper|this|that)\b/i,
  // A clause that orders a setting change: "alter my basal", "and tighten my ratio", "ease off the basal".
  new RegExp(String.raw`^\W*(?:(?:and|then|so|please|now|just|ok(?:ay)?|maybe|also)\s+){0,3}(?:i\s+(?:want|need|have|ought|plan|intend)\s+to\s+|let'?s\s+|time\s+to\s+|to\s+)?${SETTING_CHANGE_VERB}\s+(?:(?:the|my|our|aaps|aaps's)\s+)?(?:[\w']+\s+)?(?:${SETTING}|settings?)\b`, "i"),
  new RegExp(String.raw`\b(?:can|could|would|will)\s+you\s+(?:please\s+)?${SETTING_CHANGE_VERB}\s+(?:(?:the|my|our)\s+)?(?:[\w']+\s+)?(?:${SETTING}|settings?)\b`, "i"),
  new RegExp(String.raw`\b(?:what\s+)?should\s+(?:(?:my|the)\s+)?${SETTING}\s+(?:rate\s+)?be\b|\bis\s+(?:my|the)\s+${SETTING}\s+(?:rate\s+)?(?:too|a\s+bit|very|quite|way)\s+\w+`, "i"),
  /\bwhat\s+(?:to|i\s+(?:should|need\s+to|ought\s+to))\s+(?:alter|change|adjust|tweak|amend|modify|reduce|increase|lower|raise)\b|\bi\s+should\s+(?:change|alter|adjust|tweak|amend|modify|reduce|increase|lower|raise|take|give|bolus|inject|eat|correct)\b/i,
  /\bhow\s+much\s+(?:should\s+i\s+|to\s+|do\s+i\s+)(?:reduce|cut|lower|drop|decrease|increase|raise|take\s+off|knock\s+off)\b/i,
  /\bcorrection\s+(?:amount|dose|size)\s+(?:for|at|with)\s+(?:a\s+)?\d/i,
  /\bwhen\s+(?:do|should|shall|must)\s+i\s+(?:pre[\s-]?)?bolus\b/i,
  // "is it safe to take 2 more", "ok to have another": permission for an amount, no insulin word needed.
  /\b(?:ok(?:ay)?|safe|fine|alright|all\s+right)\s+(?:for\s+me\s+)?to\s+(?:take|give|have|add|inject|bolus|stack|use)\s+(?:\d|more\b|another\b|extra\b|some\s+more\b|a\s+(?:bit|few|unit|little|couple)\b|one\b|two\b|three\b|half\b)/i,
  // "60g to units?", "how much basal tonight", "bolus amount please", "correction pls".
  new RegExp(String.raw`${CARB_AMOUNT}[^.?!\n]{0,20}\b(?:units?|u|insulin|bolus|dose)\W*$`, "i"),
  /\bhow\s+(?:much|many)\s+(?:units?\s+(?:of\s+)?)?(?:basal|bolus|insulin|correction)\s+(?:tonight|tomorrow|now|later|next|this\s+(?:evening|afternoon|morning)|for\s+(?:tonight|tomorrow|bed))\b/i,
  /\b(?:dose|bolus|correction|insulin|units?)\s+(?:amount\s+)?please\b/i,
  // A request word opening a sentence: "what target ...", "glucagon ...", "eating soon mode ...".
  /^\W*(?:what|which)\s+(?:target|profile|ratio|isf)\b(?!\s+(?:was|were|did|had|is|are|has|have|do|does|ranges?|records?|changes?|history|switch(?:es)?|active|used|names?))/i,
  /^\W*(?:eating\s+soon|exercise|activity)\s+(?:mode|target)\b(?!\s+(?:was|were|did|had|records?|history|used|uses|times|events?))/i,
  /^\W*glucagon\s+(?!(?:was|were|did|had|is|are|does|do|records?|history|use|used|events?|kit|pen|expir\w*|work\w*|mean\w*)\b)\w/i,
  new RegExp(String.raw`\b${SETTING}\s+(?:rate\s+)?(?:ok(?:ay)?|alright|fine|right)\b(?!\s+(?:now|so\s+far|records?|history|at\s+the\s+moment))`, "i"),
  // "How much basal and bolus for today?": an amount for a day still to come, not a total.
  /\bhow\s+(?:much|many)\s+(?:units?\s+(?:of\s+)?)?(?:basal|bolus(?:es)?|insulin|correction)(?:\s+(?:and|&|or|vs|versus)\s+(?:basal|bolus(?:es)?))?\s+for\s+(?:today|tonight|tomorrow)\b/i,
  // A meal named after a record question: "How many SMBs today then dinner", "today and for dinner".
  // Not "carbs today for lunch?", which asks what was entered.
  /^(?!\W*(?:(?:how\s+many|what|show|and)\s+)?(?:carbs?|carbohydrates?|grams?|food|meals?)\b)[^\n]*?\b(?:(?:today|now|then|so)\s+(?:then\s+|for\s+|to\s+)?(?:dinner|lunch|breakfast|tea|supper)(?:\s+\d+\s*g?)?\W*$|and\s+for\s+(?:dinner|lunch|breakfast|tea|supper)\W*$)/i,
  /^\W*(?:more|less|extra|higher|lower|bigger|smaller)\s+(?:basal|bolus(?:es)?|insulin|smbs?|units?|carbs?|correction)\W*$/i,
  // "basal vs bolus today dose?": a bare dose word closing a record question (not "daily dose").
  /\b(?!(?:total|daily|my|the|a|an|insulin|that|this|each|per|basal|bolus|correction|average|usual|your|what|which|last|first)\b)[a-z']+\s+dose\W*$/i,
  new RegExp(String.raw`^\W*(?:(?:so|ok(?:ay)?|and|right)\s+)?(?:going\s+to|about\s+to|planning\s+(?:to|on)|thinking\s+(?:of|about))\s+${VERB_PHRASE}`, "i"),
];

/**
 * A whole sentence that is only a dose word, a setting check, an amount or a
 * bare request: "dose?", "bolus amount pls", "basal ok?", "+2u", "what
 * target", "how much", "what would you do".
 */
const ELLIPTICAL_DOSE_SENTENCES: readonly RegExp[] = [
  new RegExp(String.raw`^\W*(?:(?:so|and|ok(?:ay)?|then|well|right|my|the|a|any|but)\s+)*(?:dose|doses|bolus|correction|units?|(?:bolus|correction|dose)\s+amount|how\s+much(?:\s+insulin)?|how\s+many(?:\s+units)?)(?:\s+(?:please|now|then|amount|for\s+me|needed|required))*\W*$`, "i"),
  // Index 1 onward also apply to one item of a list ("basal vs bolus today, need insulin?").
  new RegExp(String.raw`^\W*(?:(?:so|and|ok(?:ay)?|then|well|right|but)\s+)*(?:glucagon|another\s+unit|one\s+more(?:\s+unit)?|more\s+insulin|(?:do\s+i\s+)?need\s+(?:a\s+|an\s+|some\s+|more\s+|any\s+)?(?:insulin|correction|bolus|units?|carbs?|sugar|glucagon|basal))(?:\s+(?:please|now|then|amount|for\s+me|needed|required))*\W*$`, "i"),
  /^\W*\+\s*\d+(?:[.,]\d+)?\s*(?:u|units?|g)?\W*$/i,
  new RegExp(String.raw`^\W*(?:my\s+|the\s+)?${SETTING}\s+(?:rate\s+)?(?:ok(?:ay)?|right|fine|alright|correct|good|enough|too\s+\w+|about\s+right)\W*$`, "i"),
  /^\W*(?:what|which)\s+(?:target|profile|ratio|isf|basal(?:\s+rate)?|temp(?:orary)?\s+(?:target|basal)|dose|bolus|correction|%\s+profile|percent(?:age)?\s+profile)(?:\s+(?:should|shall|do|would|could)\s+i\s+(?:use|run|set|pick|choose|go\s+for|have|be\s+on))?\W*$/i,
  /^\W*(?:suspend|disconnect|stop|pause)\s+(?:the\s+|my\s+)?pump\W*$/i,
  /^\W*(?:so\s+|and\s+|ok(?:ay)?\s+)?what\s+would\s+you\s+do\W*$/i,
  /^\W*(?:eating\s+soon|exercise|activity|hypo)\s+(?:mode|target)(?:\s+\w+){0,3}\W*$/i,
];
/** "Should I?", "Do I need to?": a bare request that leans on a dose topic elsewhere in the prompt. */
const BARE_REQUEST_SENTENCE =
  /^\W*(?:(?:so|and|then|ok(?:ay)?|but)\s+)?(?:should|shall|do|can|must)\s+i(?:\s+(?:need\s+to|have\s+to|then|now|too|again|as\s+well|do\s+(?:it|that)))?\W*$/i;

/**
 * Questions about what already happened: they start with a past auxiliary
 * ("Did I", "Was", "Has my basal") or a question word followed by one ("How
 * many units did I", "What was my bolus"), or state a past action ("I had 4
 * units"). Such a sentence is exempt from the dose rules unless it also asks
 * about now, next, a plan or a judgement.
 */
const HISTORY_SENTENCE_START =
  /^\W*(?:(?:and|so|but|also|ok(?:ay)?|hey|hi|please|then|tarv[1i]s)\W+){0,3}(?:(?:did|didn't|was|wasn't|were|weren't|has|hasn't|had|hadn't)\b|have\s+(?:i|aaps|you|we|they|my)\b|(?:how\s+(?:many|much|long|often|early|late|big|high|low)|what|when|which|why|where|whose)\b(?:(?!\b(?:how|what|when|which|why|where|should|shall|can|could|would|will)\b)[^.?!\n]){0,80}?\b(?:did|didn't|was|were|had|has|have\s+i)\b|i\s+(?:had|took|gave|bolused|injected|entered|ate|logged|recorded|set|changed|treated|corrected|used|got)\b)/i;
const FORWARD_OR_JUDGEMENT =
  /\b(?:should|shall|would|could|will|can|must|ought|going\s+to|gonna|now|next|tonight|tomorrow|later|ok(?:ay)?|safe|enough|too|right|wrong|better|best|ideal|fine|alright|reckon|think|suggest\w*|recommend\w*|advi[sc]e|if|instead|again|same|want|plan\w*|need\s+to\s+(?:take|give|bolus|inject|eat|change|set|lower|raise|increase|decrease|correct))\b/i;

/** "Is my basal in my profile the same as last month?": comparing a stored value with the past. */
const HISTORY_COMPARISON = new RegExp(
  String.raw`^\W*(?:is|are|was|were)\s+(?:my|the)\s+(?:[\w']+\s+){0,4}?(?:the\s+same\s+as|different\s+(?:from|to|than)|changed\s+(?:since|from))\s+(?:(?:it\s+was|in|on|at|over|during)\s+)?(?:last|yesterday|before|previous|a\s+(?:week|month|year)\s+ago|\d+\s+(?:days?|weeks?|months?)\s+ago)\b`,
  "i",
);
/**
 * "Did I take enough carbs for my low yesterday?": a judgement about an
 * event at a named past time, asked with did/was/were, is a history question.
 */
const PAST_JUDGEMENT =
  /^\W*(?:(?:and|so|but|also|ok(?:ay)?)\W+){0,2}(?:did|didn't|was|wasn't|were|weren't)\s+(?:i|my|it|that|the|aaps)\b[^.?!\n]{0,120}?\b(?:yesterday|last\s+(?:night|week|month|time|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this\s+morning|earlier\s+today|\d+\s+(?:days?|weeks?)\s+ago|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const FORWARD_REQUEST = /\b(?:should|shall|would|could|will|can|must|ought|going\s+to|need\s+to|want\s+to|next|tonight|tomorrow|later)\b/i;

export function isHistoryOnlySentence(sentence: string) {
  if (HISTORY_COMPARISON.test(sentence)) return !FORWARD_REQUEST.test(sentence);
  if (PAST_JUDGEMENT.test(sentence)) return !FORWARD_REQUEST.test(sentence);
  return HISTORY_SENTENCE_START.test(sentence) && !FORWARD_OR_JUDGEMENT.test(sentence);
}

/* ------------------------------------------------------------------------ */
/* Read-only sentences: definitions, current-state lookups, readbacks         */
/* ------------------------------------------------------------------------ */

/**
 * Reading back what is stored or recorded, and explaining what a term means,
 * is always allowed. Only a request to choose, change or judge an amount or
 * a setting for the user is refused. The sentences below are set aside before
 * the dose rules, like history questions, unless they also carry wording
 * that turns them into such a request.
 */
const LEADING_FILLER = String.raw`^\W*(?:(?:and|so|ok(?:ay)?|but|also|hey|hi|please|right|tarv[1i]s)\W+){0,3}`;
/** Wording that makes a lookup or a definition personal, forward-looking or a judgement of an amount. */
const READ_ONLY_FORWARD = String.raw`should|shall|would|could|must|ought|need(?:s|ed)?|want(?:s)?\s+to|going\s+to|gonna|plan\w*|next|tonight|tomorrow|later|instead|i'll|i\s+will|i'd|recommend\w*|suggest\w*|advi[sc]e|sensible|reasonable|safe|safer|enough|too|normal|typical|usual|if\s+(?:i|you|someone|my|a\s+person)|hypothetical\w*|someone|friend|accept|trust|agree|confirm|sound|sounds|worth|go\s+with|stick\s+with`;
const READ_ONLY_BLOCKER = new RegExp(
  String.raw`\b(?:${READ_ONLY_FORWARD}|ideal|optimal|best|better|good|safe|sensible|reasonable|recommended|appropriate|suitable|right(?!\s+now)|correct|rule\s+of|\d+[\s-]+\d+\s+rule|\d{3,4}\s+rule|insulin[\s-]wise|(?:for|with|to\s+cover)\s+(?:a\s+|the\s+|my\s+|this\s+|that\s+)?(?:${MEAL}|\d))\b|${CARB_AMOUNT}|[=÷×]|\d\s*[/:]\s*\d|\b\d+(?:[.,]\d+)?\s*(?:u|iu|units?)\b`,
  "i",
);
/** Same, without comparison words: "Which day had the better basal to bolus ratio?" compares records. */
const READBACK_BLOCKER = new RegExp(
  String.raw`\b(?:${READ_ONLY_FORWARD}|ideal|optimal|rule\s+of|insulin[\s-]wise|(?:for|to\s+cover)\s+(?:a\s+|this\s+|my\s+next\s+|the\s+next\s+)?(?:\d))\b|[=÷×]`,
  "i",
);
/** A first-person word: a definition about "my" settings is a personal question, not a definition. */
const FIRST_PERSON = /\b(?:i|i'm|me|my|mine|we|our)\b/i;

/**
 * "What is an extended bolus?", "What does open loop mean?", "Glucagon how
 * does it work?", "What's an SMB again?", "What does it mean to stack
 * corrections?".
 */
const DEFINITION_SENTENCE = new RegExp(
  LEADING_FILLER +
    String.raw`(?:what(?:'s|s|\s+is|\s+are)\s+(?:an?\s+|the\s+)?\w|what\s+does\s+(?:it\s+mean\s+to\s+\w|[\w' -]{1,60}?\s+(?:mean|do|stand\s+for)\b)|what\s+do\s+(?:people|you|they)\s+mean\s+by\b|how\s+does\s+(?:an?\s+|the\s+)?[\w' -]{1,60}?\s+work\b|(?:explain|define|describe)\s+(?:what\s+)?(?:an?\s+|the\s+)?\w|tell\s+me\s+(?:about|what)\s+(?:an?\s+|the\s+)?\w|[\w' -]{1,40}?(?:\s*,\s*|\s+)(?:how\s+does\s+(?:it|that|this)\s+work|what\s+(?:is|are)\s+(?:it|they|that|this)|what\s+does\s+(?:it|that)\s+(?:mean|do)))`,
  "i",
);
/** "How does the bolus wizard work out a dose?": how a device or AAPS behaves. */
const SYSTEM_BEHAVIOUR_SENTENCE = new RegExp(
  LEADING_FILLER +
    String.raw`how\s+does\s+(?:the\s+|a\s+|an\s+)?(?:bolus\s+wizard|bolus\s+calculator|wizard|calculator|aaps|loop|pump|algorithm|autosens|dynamic\s+isf|smb\s+feature|app)\s+(?:work\s+out|calculate|decide|choose|pick|figure\s+out|estimate)\b`,
  "i",
);
/**
 * Current stored state: "Which profile am I on?", "What target am I on right
 * now?", "What ISF am I using at the moment?", "Is the correct profile
 * active?".
 */
const STATE_LOOKUP_SENTENCE = new RegExp(
  LEADING_FILLER +
    String.raw`(?:(?:what|which)\s+(?:carb\s+)?(?:target|profile|ratio|isf|basal(?:\s+rate)?|temp(?:orary)?\s+target|mode|dia|max\s+iob|sensitivity|correction\s+factor)(?:\s+(?:setting|value|percentage))?\s+(?:am\s+i|are\s+we|is\s+(?:aaps|the\s+loop|my\s+pump|it|set|active|running|in\s+use))(?:\s+(?:currently|still|now))?(?:\s+(?:on|using|running|in|set\s+to|active))?|is\s+(?:the\s+|my\s+)?(?:correct|right|expected|usual|normal|intended|same|new|old)?\s*(?:profile|target|temp(?:orary)?\s+target|mode|basal\s+profile)\s+(?:active|running|on|selected|set|in\s+use|loaded|switched\s+on))(?:\s+(?:right\s+now|at\s+the\s+moment|currently|now|today|still))?\W*$`,
  "i",
);
/** Past or so-far markers that make a noun phrase or a "show" request a readback. */
const PAST_MARKER =
  /\b(?:last|previous|latest|most\s+recent|recent|yesterday'?s?|earlier|ago|history|records?|logged|delivered|entered|so\s+far|this\s+(?:week|month|morning)|today'?s?|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|since)\b/i;
/** "show my last Lantus dose", "list the boluses from yesterday". */
const SHOW_SENTENCE = new RegExp(
  LEADING_FILLER + String.raw`(?:show|list|display|pull\s+up|find)\s+(?:me\s+)?(?:my|the|all|every|each)\b`,
  "i",
);
/** "last night's dose?", "yesterday's total insulin please", "today's boluses". */
const PAST_NOUN_PHRASE = new RegExp(
  LEADING_FILLER +
    String.raw`(?:(?:what\s+about|and)\s+)?(?:my\s+|the\s+)?(?:last|previous|latest|most\s+recent|yesterday's|last\s+night's|this\s+morning's|today's|the\s+day\s+before's)\b(?:\s+[\w']+){0,5}\W*$`,
  "i",
);
/** "What's the bolus breakdown for today?", "What's my bolus insulin today?", "What is my bolus to basal split today?". */
const TOTALS_LOOKUP = new RegExp(
  LEADING_FILLER +
    String.raw`what(?:'s|s|\s+is|\s+are|\s+was|\s+were)\s+(?:my|the)\s+(?:[\w']+\s+){0,3}?(?:breakdown|totals?|split|count|number|history|insulin|records?|log|summary|delivery)\b(?:\s+(?:for\s+)?(?:today|yesterday|so\s+far|this\s+week|last\s+\w+(?:\s+days)?|over\s+[\w\s]{1,20}))?\W*$`,
  "i",
);
/** "SMB units please", "totals in units please": a request to show recorded totals. */
const RECORDED_TOTALS_PHRASE = new RegExp(
  LEADING_FILLER +
    String.raw`(?:the\s+|my\s+)?(?:smbs?|totals?|delivered|automatic\s+boluses|basal\s+and\s+bolus(?:es)?|bolus(?:es)?\s+and\s+basal)(?:\s+(?:and\s+|in\s+)?(?:units?|totals?|counts?|only|today|yesterday|so\s+far|this\s+week|last\s+week|delivered|given|breakdown|split|grams?|numbers?|please|then|too))*\W*$`,
  "i",
);
/** "How long does AAPS usually take to bring me back into range?": a question about recorded patterns. */
const PATTERN_QUESTION = new RegExp(
  LEADING_FILLER +
    String.raw`how\s+(?:long|often|quickly|fast|soon|many\s+times)\s+(?:does|did|do|has|have|is|was)\s+(?:it|aaps|the\s+loop|my\s+loop|a\s+correction|corrections|my\s+[\w-]+|i|the\s+pump)\b[^.?!]{0,80}\b(?:usually|normally|typically|tend|on\s+average|take|bring|get|took|within)\b`,
  "i",
);
/** "When do I usually bolus for dinner?", "How many units do I usually take for breakfast?": habits in the records. */
const HABIT_QUESTION = new RegExp(
  LEADING_FILLER +
    String.raw`(?:when|what\s+time|how\s+(?:many|much|often|early|late|long)|what|which)\b[^.?!]{0,60}?\b(?:do|does|did)\s+(?:i|aaps|the\s+loop|my\s+loop)\s+(?:usually|normally|typically|generally|tend\s+to|on\s+average)\b`,
  "i",
);
const HABIT_BLOCKER = new RegExp(String.raw`\b(?:now|today|tonight|having|eating|about\s+to|so\s+i\s+can|then\s+i'll)\b|${CARB_AMOUNT}`, "i");
/** "Which day had the better basal to bolus ratio?" */
const RECORD_COMPARISON = new RegExp(
  LEADING_FILLER + String.raw`which\s+(?:day|days|week|weeks|night|nights|meal|meals|month|one)\s+(?:had|was|were|did|showed)\b`,
  "i",
);

/** Objects of an app action: "disconnect Glooko", "suspend alerts", "correct a carb entry". */
const APP_OBJECT = String.raw`(?:alerts?|alarms?|notifications?|sounds?|vibrations?|reminders?|glooko|nightscout|dexcom(?:\s+share)?|libre(?:\s*link(?:\s*up)?)?|linkup|health\s+connect|xdrip\+?|carelink|diasend|tidepool|the\s+app|t1\s*arc|account|connections?|sync(?:ing)?|backups?|exports?|imports?|widgets?|watch|wear\s+os|units\s+to\s+(?:mg|mmol)\S*|(?:carb|food|meal|bolus|insulin|glucose|treatment)\s+(?:entry|entries|logs?|records?|readings?)|entry|entries|a\s+reading|the\s+reading|readings?|charts?|graphs?|theme|language|target\s+range|range|intro|tarv[1i]s|provider|api\s+key|key|password|data|notes?)`;
/** "How do I disconnect Glooko?", "Can I suspend alerts overnight?", "How do I correct a carb entry I logged wrong?". */
const APP_USAGE_SENTENCE = new RegExp(
  LEADING_FILLER +
    String.raw`(?:how\s+(?:do|can|could|would)\s+i|can\s+i|could\s+i|should\s+i|is\s+it\s+(?:ok(?:ay)?|possible)\s+to|where\s+(?:do|can)\s+i|is\s+there\s+a\s+way\s+to)\s+(?:\w+\s+){0,2}?(?:disconnect|connect|reconnect|suspend|silence|mute|snooze|pause|turn\s+off|turn\s+on|switch\s+off|switch\s+on|disable|enable|change|edit|fix|correct|delete|remove|undo|add|export|import|sync|reset|set\s+up|link|unlink|log\s+out|sign\s+out|skip|hide|show|see|use|install|reinstall|update)\s+(?:(?:the|my|a|an|all|this|that)\s+)?(?:[\w']+\s+){0,2}?${APP_OBJECT}\b`,
  "i",
);
/** Therapy words that keep an app-style sentence under the dose rules: "disconnect my pump", "suspend the loop". */
const APP_USAGE_BLOCKER = new RegExp(
  String.raw`\b(?:pump|loop|insulin|bolus\w*|basal|doses?|ratios?|isf|smbs?|temp|profiles?|cannula|site|${INSULIN_NAME})\b|\d|\b(?:next|tonight|tomorrow|instead)\b`,
  "i",
);
/** "in units please", "totals in units please", "as a list": how to show the answer, not a request. */
const FORMAT_ONLY_SENTENCE =
  /^\W*(?:(?:and|please|can\s+you|could\s+you|ok(?:ay)?)\s+)*(?:(?:give|show|put|list|answer|do)\s+(?:it|them|that|this|the\s+totals?)\s+)?(?:(?:the\s+)?totals?\s+)?(?:(?:in|as)\s+(?:units?|grams?|g|mmol(?:\/l)?|mg\/dl|a\s+list|a\s+table|percent(?:ages?)?)|units?)(?:\s+please)?\W*$/i;

function isDefinitionSentence(sentence: string) {
  if (SYSTEM_BEHAVIOUR_SENTENCE.test(sentence)) return !FIRST_PERSON.test(sentence.replace(/^\W*how\s+does\b/i, ""));
  return DEFINITION_SENTENCE.test(sentence) && !FIRST_PERSON.test(sentence) && !READ_ONLY_BLOCKER.test(sentence);
}

function isReadbackSentence(sentence: string) {
  if (STATE_LOOKUP_SENTENCE.test(sentence)) return !READBACK_BLOCKER.test(sentence);
  if (APP_USAGE_SENTENCE.test(sentence)) return !APP_USAGE_BLOCKER.test(sentence) && !/\b(?:should|shall)\s+i\s+(?!disconnect|connect|reconnect|turn|switch|reinstall|update|export|sync)/i.test(sentence);
  if (READBACK_BLOCKER.test(sentence)) return false;
  if (SHOW_SENTENCE.test(sentence)) {
    return PAST_MARKER.test(sentence) || !new RegExp(String.raw`\bfor\s+(?:a\s+|the\s+|my\s+|this\s+)?(?:${MEAL}|\d)`, "i").test(sentence);
  }
  return (
    PAST_NOUN_PHRASE.test(sentence) ||
    TOTALS_LOOKUP.test(sentence) ||
    RECORDED_TOTALS_PHRASE.test(sentence) ||
    PATTERN_QUESTION.test(sentence) ||
    RECORD_COMPARISON.test(sentence) ||
    (HABIT_QUESTION.test(sentence) && !HABIT_BLOCKER.test(sentence))
  );
}

/**
 * A sentence that only reads back records or stored values, or asks what a
 * term means: set aside before the dose rules.
 */
export function isReadOnlySentence(sentence: string) {
  return isHistoryOnlySentence(sentence) || isReadbackSentence(sentence) || isDefinitionSentence(sentence);
}

/** Splits on sentence ends that are followed by a space or the end, so "3.5" stays whole. */
function sentencesOf(text: string) {
  return text
    .split(/[.?!]+(?=\s|$)|[;\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Joins between clauses of a run-on sentence: "...today and change my profile". */
const CLAUSE_JOINER = /\s*,\s*|\s+(?:and|but|then|plus|also|so|&)\s+/i;

/**
 * "..., totals in units please" at the end of a sentence says how to show the
 * answer. It is dropped like a separate format sentence; what is left is
 * checked as usual.
 */
function withoutFormatTail(sentence: string) {
  // A bare ", units?" asks for an amount ("I'm at 14, units?"), so the tail
  // must say how to show the answer: "in units", "totals", "please".
  // The rest must ask about the record ("did", "gave") and give no reading or
  // amount, so "I'm at 14, in units please" keeps its tail.
  const tail = /,\s*([^,]*)$/.exec(sentence);
  if (!tail) return sentence;
  const words = tail[1] ?? "";
  const rest = sentence.slice(0, tail.index).trim();
  const recordQuestion =
    /\b(?:did|were|was|gave|given|had|got|entered|logged|delivered)\b/i.test(rest) &&
    !/\d/.test(rest.replace(/\b(?:(?:last|past|previous)\s+)?\d+\s+days?\b/gi, " "));
  return recordQuestion && FORMAT_ONLY_SENTENCE.test(words) && /\b(?:in|as|totals?|please)\b/i.test(words) ? rest : sentence;
}

/**
 * Removes the history question from sentences that open with one. Later
 * clauses of a run-on sentence ("How many SMBs did I get today and another
 * unit") stay, so a dose request cannot ride behind a history opener; later
 * clauses that are history themselves are dropped too.
 */
export function withoutHistoryOnlySentences(text: string) {
  const original = sentencesOf(text);
  const sentences = original.map(withoutFormatTail);
  if (!sentences.some(isReadOnlySentence)) {
    return sentences.some((sentence, index) => sentence !== original[index]) ? sentences.join(". ") : text;
  }
  return sentences
    .flatMap((sentence) => {
      // "Totals in units please." after a record question says how to show it.
      if (FORMAT_ONLY_SENTENCE.test(sentence)) return [];
      if (!isReadOnlySentence(sentence)) return [sentence];
      const tail = sentence
        .split(CLAUSE_JOINER)
        .slice(1)
        .filter(
          (clause) =>
            clause.trim() &&
            !HISTORY_SENTENCE_START.test(clause) &&
            !FORMAT_ONLY_SENTENCE.test(clause) &&
            !isReadOnlySentence(clause),
        );
      // The remaining clauses stay one sentence, so "split into basal and
      // bolus" is not read as a bare "bolus" request.
      return tail.length ? [tail.join(", ")] : [];
    })
    .join(". ");
}

/**
 * Lookups of a stored value are not judgements: "What is my basal rate?",
 * "What's my ISF in my profile?", "How much insulin on board do I have right
 * now?". They are masked before the dose rules run.
 */
const STORED_SETTING_LOOKUP =
  /^\W*(?:and\s+|so\s+)?what(?:'s|s|\s+is|\s+are)\s+(?:my|the)\s+(?:current\s+)?(?:basal(?:\s+rates?)?|carb(?:ohydrate)?\s+ratios?|ratios?|isf|(?:insulin\s+)?sensitivity(?:\s+factor)?|correction\s+factors?|targets?|profile(?:\s+settings)?|max\s+iob)(?:\s+(?:set\s+to|in\s+(?:my\s+)?(?:profile|aaps|pump)|now|currently|right\s+now|at\s+the\s+moment))?\W*$/i;
const INSULIN_ON_BOARD = /\b(?:insulin\s+on\s+board|active\s+insulin)\b/gi;

export function maskStoredLookups(text: string) {
  const masked = text.replace(INSULIN_ON_BOARD, "IOB");
  const sentences = sentencesOf(masked);
  if (!sentences.some((sentence) => STORED_SETTING_LOOKUP.test(sentence))) return masked;
  return sentences
    .map((sentence) => (STORED_SETTING_LOOKUP.test(sentence) ? "what is the stored profile value" : sentence))
    .join(". ");
}

/**
 * True when a prompt asks for a dose, an amount of treatment, a setting
 * change or a judgement about one. `text` should already have history-only
 * sentences removed; `context` is the whole prompt, used for the topic gate.
 */
/** Starts of a new question inside a run-on sentence: "glucagon how many SMBs did I get". */
const INNER_QUESTION_START =
  /\s+(?=(?:how\s+(?:many|much|long|often)|what|which|when|why|do\s+i|should\s+i|can\s+i|is\s+(?:my|it|this|that))\b)/gi;
const CLAUSE_SPLIT = /\s*[,:;/()\u200b]\s*|\s+[-\u2013\u2014]+\s*|\s+(?:and|but|then|plus|also|&)\s+/i;
/** A bare dose word ("bolus") is a request as a whole sentence, but not as one item of a list. */
const CLAUSE_REQUEST_WORD = /\b(?:please|amount|now|needed|required|for\s+me)\b/i;

interface DoseCheckUnit {
  text: string;
  /** A whole sentence or a question that starts inside one, rather than one item of a list. */
  whole: boolean;
}

/** Each sentence, plus its inner questions and clauses, so a request cannot hide inside a run-on. */
function doseCheckUnits(text: string) {
  const units: DoseCheckUnit[] = [];
  for (const sentence of sentencesOf(text)) {
    units.push({ text: sentence, whole: true });
    const questions = sentence.replace(INNER_QUESTION_START, "\n").split("\n");
    for (const question of questions) {
      const trimmed = question.trim();
      if (!trimmed) continue;
      if (questions.length > 1) units.push({ text: trimmed, whole: true });
      const clauses = trimmed.split(CLAUSE_SPLIT);
      if (clauses.length > 1) {
        units.push(...clauses.map((clause) => clause.trim()).filter(Boolean).map((clause) => ({ text: clause, whole: false })));
      }
    }
  }
  return units;
}

/**
 * Greek, Cyrillic, Hebrew, Arabic, Indic, Thai, Japanese, Chinese and Korean
 * letters. These rules read English only, so a prompt that mixes such text
 * with a dose, setting or meal topic cannot be checked and is refused.
 */
const UNCHECKED_SCRIPT =
  /[Ͱ-ϿЀ-ԯ֐-ۿऀ-෿฀-๿぀-ヿ㐀-鿿가-힯]/;

/**
 * Indirect dose, setting and treatment requests: arithmetic on a dose,
 * asking someone else's view of the settings, an amount offered for
 * agreement, a missed dose, a glucose number to bring down, a meal to cover,
 * and dose words in other languages. Each is checked like a direct frame.
 */
const CLINICIAN = String.raw`(?:dsn|nurse|doctor|gp|consultant|diabetes\s+(?:team|nurse|specialist|doctor|consultant)|endo\w*|team|specialist|clinician|educator|dietitian|dietician)`;
const SETTING_NOUN = String.raw`(?:isf|icr|i\s*:\s*c|(?:carb(?:ohydrate)?\s+)?ratios?|basal(?:\s+rates?)?|targets?|temp(?:orary)?\s+targets?|(?:insulin\s+)?sensitivity(?:\s+factor)?|correction\s+factors?|profiles?|smb\s+settings?|smbs?|settings?|dia|max\s+(?:iob|smb|basal))`;
const ACTING_INSULIN = String.raw`(?:(?:long|rapid|fast|short|quick|slow|intermediate)[\s-]?acting|rapid|fast\s+insulin|novo\w*|background(?:\s+insulin)?|basal\s+insulin|bolus\s+insulin|${INSULIN_NAME})`;
const GLUCOSE_PROBLEM = String.raw`(?:lows?|highs?|hypos?|hypers?|spikes?|going\s+(?:low|high)|dropping|rising|dawn\s+phenomenon|(?:morning|overnight|night[\s-]?time|post[\s-]?meal|after[\s-]?meal)\s+(?:highs?|lows?|spikes?|rises?|drops?))`;
const FOREIGN_DOSE_WORD = String.raw`(?:einheiten|einheit|unidades|unidad|unites|unita|eenheden|eenheid|jednost\w*|единиц\w*|инсулин\w*)`;
const FOREIGN_QUESTION = String.raw`(?:cuant\w*|cuanto|combien|wie\s+viel\w*|quant\w*|hoeveel|ile|сколько|debo|deberia|dois|devrais|soll|sollte|devo|dovrei|moet|mam|musze|\?)`;

const INDIRECT_DOSE_FRAMES: readonly RegExp[] = [
  // Arithmetic on a dose: "60 divided by 10 units?", "80/8 in insulin terms", "60g / 10 = 6u", "units = carbs / ratio".
  new RegExp(String.raw`\b\d+(?:[.,]\d+)?\s*(?:g|grams?)?\s*(?:÷|divided\s+by|over)\s*\d[^.?!\n]{0,40}\b(?:units?|u|insulin|bolus|dose|ratio)\b`, "i"),
  new RegExp(String.raw`\b(?:units?|u|insulin|bolus|dose)\b[^.?!\n]{0,40}\b\d+(?:[.,]\d+)?\s*(?:g|grams?)?\s*(?:÷|divided\s+by|over)\s*\d`, "i"),
  /\b\d+(?:[.,]\d+)?\s*(?:g|grams?)\s*\/\s*\d/i,
  /=\s*\d+(?:[.,]\d+)?\s*(?:u|units?|iu)\b|\bunits?\s*=|\bcarbs?\s*\/\s*(?:ratio|icr|i\s*:\s*c|\d)/i,
  /\b(?:in\s+insulin\s+terms|insulin[\s-]wise|in\s+terms\s+of\s+(?:insulin|units))\b/i,
  // "What does a 1:10 ratio give for 60g?"
  /\b1\s*:\s*\d+(?:[.,]\d+)?\b[^.?!\n]{0,40}\b(?:give|gives|for|cover|covers|need|needs|work\s+out)\b/i,
  // Third person: "how much should she take", "how much does my son need"
  /\bhow\s+(?:much|many)\b[^.?!\n]{0,40}\b(?:should|shall|does|do|would|must|could|can)\s+(?:she|he|they|my\s+(?:son|daughter|child|kid|friend|partner|wife|husband|mum|mom|dad|mother|father|brother|sister|boyfriend|girlfriend))\s+(?:take|have|give|bolus|inject|need|use|eat|correct)\b/i,
  // Setting judgements: "my ISF needs strengthening", "which setting is causing my lows"
  new RegExp(String.raw`\b${SETTING_NOUN}\s+(?:needs?|requires?)\s+(?:strengthening|weakening|changing|adjusting|tweaking|lowering|raising|increasing|decreasing|reducing|a\s+(?:change|tweak|bump)|to\s+(?:go|be|change|come))\b`, "i"),
  new RegExp(String.raw`\bwhat\s+would\s+(?:a|my|the|your|an)\s+${CLINICIAN}\s+(?:change|tweak|adjust|do|suggest|recommend|say|set|alter)\b|\bif\s+you\s+were\s+(?:my|a|an)\s+${CLINICIAN}\b`, "i"),
  new RegExp(String.raw`\bwhich\s+(?:of\s+my\s+|one\s+of\s+my\s+)?${SETTING_NOUN}\s+(?:is|are|was|were|might\s+be|could\s+be)\s+(?:causing|wrong|off|to\s+blame|responsible|the\s+problem|behind|too\s+\w+)`, "i"),
  new RegExp(String.raw`\bwhat\s+(?:does|do)\s+my\s+(?:data|records?|history|numbers?|cgm|readings?)\s+(?:say|suggest|show|tell\s+me)\s+(?:my\s+|about\s+my\s+)?(?:real\s+|true\s+|actual\s+)?${SETTING_NOUN}\s+(?:really\s+|actually\s+)?(?:is|are|should)\b`, "i"),
  /\bis\s+(?:aaps|the\s+loop|my\s+loop|my\s+pump|the\s+pump|the\s+algorithm)\s+(?:giving\s+me\s+too\s+(?:much|little)|giving\s+(?:me\s+)?(?:enough|too\s+\w+)|under[\s-]?dosing|over[\s-]?dosing|too\s+aggressive|not\s+aggressive\s+enough|too\s+(?:weak|strong|cautious|timid))/i,
  /\b(?:tighten|loosen)\s+(?:things|it|everything|control|my\s+control|my\s+settings|my\s+loop)\s+up\b/i,
  // The device's number offered for agreement: "wizard says 4.5u, trust it?", "AAPS suggests 3.2, accept?"
  /\b(?:aaps|wizard|bolus\s+wizard|calculator|the\s+loop|loop|pump|app)\s+(?:says?|suggests?|recommends?|wants?|calculated|calculates|is\s+suggesting|offers?|gives?)\s+[^.?!\n]{0,20}\d[^?!\n]{0,30}\b(?:trust|accept|agree|right|ok(?:ay)?|correct|follow|take|go\s+with|sound|fine|safe|listen)\b/i,
  /\b(?:override|overrule|ignore)\s+(?:aaps|the\s+loop|my\s+loop|the\s+wizard|the\s+bolus\s+wizard|the\s+algorithm|my\s+pump)\b|\bcorrect\s+(?:it\s+)?manually\b|\bmanual(?:ly)?\s+correct\w*/i,
  // Autotune run on the user's data
  /\b(?:run|use|apply|do)\s+autotune\b|\bautotune[\s-]*(?:style|like)\b|\bautotune\s+(?:would\s+)?(?:suggest|recommend|say|give|output|result)\w*\b|\bwhat\s+would\s+autotune\b|\bautotune\b[^.?!\n]{0,30}\b(?:my|for\s+me)\b/i,
  // Typical settings for a person: "typical ICR for a 70kg adult", "what temp target do people use for running"
  new RegExp(String.raw`\b(?:typical|normal|usual|average|standard|common|ideal|starting|good)\s+${SETTING_NOUN}\s+for\b`, "i"),
  new RegExp(String.raw`\bwhat\s+(?:${SETTING_NOUN}|profile\s+(?:percentage|%)|percentage|temp\s+basal)\s+(?:do|would|should)\s+(?:people|most\s+people|others|other\s+people|type\s+1s?|t1s?|runners|athletes|you|i)\s+(?:use|set|run|pick|choose|go\s+for|have)\b`, "i"),
  // Rule-of-thumb sums on the user's numbers: "500 rule with my TDD", "Use the 100 rule to give my ISF"
  /\b(?:\d{3,4})\s+rule\b[^.?!\n]{0,30}\b(?:my|me|give|work\s+out|calculate|for)\b|\b(?:use|apply|with)\s+the\s+\d{3,4}\s+rule\b/i,
  /^\W*(?:the\s+)?(?:rule\s+of\s+15|15[\s-]+15\s+rule|15\s*\/\s*15)\W*$|\b(?:rule\s+of\s+15|15[\s-]+15\s+rule)\b[^.?!\n]{0,40}\b(?:now|should|follow|use|apply|me|my)\b|\bshould\s+i\s+(?:follow|use|apply|do)\s+(?:it|that|this|the\s+\w+)/i,
  /\b(?:extended|dual[\s-]wave|square[\s-]wave|split|normal|combo|standard)\s+(?:bolus\s+)?or\s+(?:an?\s+)?(?:extended|normal|dual(?:[\s-]wave)?|square(?:[\s-]wave)?|split|combo|standard)(?:\s+bolus)?\s*(?:for\b|with\b|tonight|now|\?|$)/i,
  // An amount offered for agreement: "5 units, agreed?", "Shall we say 5 units?", "Sticking with 6 units, sound?"
  /\b\d+(?:[.,]\d+)?\s*(?:u|units?|iu)\b[^.?!\n]{0,30}\b(?:agreed|agree|sound|sounds|right|ok(?:ay)?|fine|correct|reasonable|sensible|good|trust|accept|alright)\b/i,
  /\b(?:shall|should)\s+(?:we|i)\s+say\s+\d/i,
  /\b(?:take|took|have|bolus|give|do)\s+\d+(?:[.,]\d+)?\b[^.?!\n]{0,30}\b(?:go|stick)\s+with\s+(?:that|it|this)\b/i,
  /^\W*(?:i'm\s+|i\s+am\s+|so\s+|ok\s+)?(?:going|sticking|bolusing|injecting|giving|doing)\s+(?:with\s+)?\d+(?:[.,]\d+)?(?:\s*(?:u|units?|iu))?\b/i,
  // A missed dose: "Missed my bolus, take it late?", "Forgot basal injection what do I do"
  new RegExp(String.raw`\b(?:missed|forgot|forgotten|skipped|didn't\s+take|did\s+not\s+take)\s+(?:to\s+(?:take|give|do)\s+)?(?:my\s+|a\s+|the\s+|our\s+)?(?:${ACTING_INSULIN}\s+)?(?:bolus|basal|dose|insulin|injection|jab|shot|correction|${ACTING_INSULIN})\b[^\n]{0,60}(?:\?|\bwhat\s+(?:do|should|now)\b|\btake\s+it\b|\blate\b|\bdouble\b|\bnow\b|\bmake\s+up\b)`, "i"),
  // Which insulin, how much: "how much long acting tonight", "Pump died, how much long-acting to cover"
  // "How much Lantus?" asks for an amount; "How much bolus insulin today?" asks for the record.
  new RegExp(String.raw`\bhow\s+(?:much|many)\s+(?:units?\s+(?:of\s+)?)?${ACTING_INSULIN}\b(?![^?!\n]*\b(?:today|yesterday|so\s+far|last|did|was|were|had|have\s+i|has|delivered|given|got|this\s+(?:week|month)|on\s+board|in\s+total|recorded|logged)\b)`, "i"),
  /\bhow\s+much\s+(?:extra|more)\b/i,
  // Readings then a bare request: "BG 12.4 IOB 1.2 ISF 2.5 target 6: units?", "IOB is 2, carbs 40, BG 9 - bolus?"
  /\b(?:bg|iob|cob|isf|icr|target|carbs?|glucose|sugar|reading|i'm|at)\b\s*(?:is\s+|of\s+|at\s+|=\s*|:\s*)?\d[^?!\n]{0,80}[:,-]\s*(?:bolus|units?|u|dose|correction|insulin|how\s+much|how\s+many)\W*$/i,
  /^\W*[\w' ]{1,30}:\s*(?:insulin|units?|bolus|dose|correction)\W*$/i,
  // Glucose to bring down or up
  new RegExp(String.raw`\bhow\s+(?:do|can|should|could)\s+i\s+(?:stop|prevent|avoid|fix|sort(?:\s+out)?|deal\s+with|handle|treat|get\s+rid\s+of|bring\s+down|reduce|lower|cure|manage)\s+(?:my\s+|the\s+|these\s+|this\s+|those\s+)?(?:\w+\s+){0,2}?${GLUCOSE_PROBLEM}\b(?!\s+(?:alerts?|alarms?|notifications?|warnings?|readings?\s+(?:in|on)\s+the\s+app))`, "i"),
  /\b(?:tips?|ways?|how)\s+(?:to|for)\s+(?:bring(?:ing)?|get(?:ting)?|knock(?:ing)?)\s+(?:(?:a|my|this|the)\s+(?:\w+\s+)?(?:high|low|number|glucose|bg|sugar)\s+)?(?:down|up)\b/i,
  /\b(?:get|bring|knock)\s+(?:(?:this|my|a|the)\s+(?:\w+\s+)?(?:high|low|number|glucose|bg|sugar|reading|levels?)\s+(?:down|up)|it\s+down)\b/i,
  /\bi'm\s+\d+(?:[.,]\d+)?\b[^.?!\n]{0,20}\bwhat\s+(?:now|do\s+i\s+do|should\s+i\s+do|next)\b|\b\d+(?:[.,]\d+)?\s*(?:mmol\S*|mg\/dl)?\s*[,.-]?\s*what\s+(?:now|do\s+i\s+do|should\s+i\s+do)\b/i,
  /\b(?:need|want|have|got)\s+to\s+(?:come|get|go|bring\s+(?:it|this|me))\s+down\b/i,
  /\bwhat\s+(?:brings?|gets?|takes?|will\s+(?:bring|get|take)|would\s+(?:bring|get|take))\s+(?:me\s+|it\s+)?(?:from\s+)?\d+(?:[.,]\d+)?\s+(?:down\s+)?to\s+\d/i,
  /^\W*(?:from\s+)?(?:[1-3]\d(?:[.,]\d)?|\d[.,]\d)\s+(?:down\s+)?to\s+\d+(?:[.,]\d+)?\W*$/i,
  /\b(?:fix|knock\s+down|bring\s+down|correct|treat|sort)\s+(?:a|my|this|the)\s+\d+(?:[.,]\d+)?\b(?![.,]?\d)(?!\s*(?:carb|entr|records?|readings?|days?|times?|items?|g\b|grams?))/i,
  /\bwhat\s+(?:do|should|would|will)\s+i\s+need\s+for\s+(?:a|my|this|the)\s+\d/i,
  // A meal to cover: "cover 60g?", "cover this meal", "what covers 60g"
  new RegExp(String.raw`\bcover(?:s|ing)?\s+(?:a\s+|the\s+|this\s+|that\s+|my\s+)?(?:${CARB_AMOUNT}|${MEAL}|carbs|it)\b`, "i"),
  // Dose words in other languages, asked: "Wie viele Einheiten soll ich spritzen?", "Combien d'unites"
  new RegExp(String.raw`(?:^|[^a-z])${FOREIGN_DOSE_WORD}(?:[^a-z]|$)[^\n]*${FOREIGN_QUESTION}|${FOREIGN_QUESTION}[^\n]*(?:^|[^a-z])${FOREIGN_DOSE_WORD}(?:[^a-z]|$)`, "i"),
];
/** "U?": a bare capital U asks for units (the sentence split has already removed the "?"). */
const BARE_UNIT_QUESTION = /^\W*U\W*$/;

export function requestsDoseIntent(text: string, context: string) {
  const gated = DOSE_CONTEXT.test(context);
  const strictlyGated = STRICT_DOSE_CONTEXT.test(context);
  if (gated && UNCHECKED_SCRIPT.test(context)) return true;
  return doseCheckUnits(text).some(({ text: unit, whole }) => {
    if (DIRECT_FRAMES.some((pattern) => pattern.test(unit))) return true;
    if (INDIRECT_DOSE_FRAMES.some((pattern) => pattern.test(unit)) || BARE_UNIT_QUESTION.test(unit)) return true;
    if (
      ELLIPTICAL_DOSE_SENTENCES.some(
        (pattern, index) => pattern.test(unit) && (whole || index > 0 || CLAUSE_REQUEST_WORD.test(unit)),
      )
    ) {
      return true;
    }
    if (strictlyGated && BARE_REQUEST_SENTENCE.test(unit)) return true;
    return gated && GATED_FRAMES.some((pattern) => pattern.test(unit));
  });
}

const TYPO_FIXES: readonly [RegExp, string][] = [
  [/\b(?:inslin|insuln|insulen|insuline|insilin|insullin|insolin|insulin's|insulina)\b/gi, "insulin"],
  [/\b(?:mch|mutch|muhc|mich)\b/gi, "much"],
  [/\b(?:howmuch)\b/gi, "how much"],
  [/\b(?:howmany)\b/gi, "how many"],
  [/\b(?:shud|shld|shoud|shuld|sould|shoudl|shold)\b/gi, "should"],
  [/\b(?:wot|wat|wht|whta)\b/gi, "what"],
  [/\bwhats\b/gi, "what's"],
  [/\b(?:bolis|bolous|bolos|bolas|boluss|bollus)\b/gi, "bolus"],
  [/\b(?:tak|tke|takke)\b/gi, "take"],
  [/\b(?:pls|plz|plez)\b/gi, "please"],
  [/\bgonna\b/gi, "going to"],
  [/\bwanna\b/gi, "want to"],
  [/\bgotta\b/gi, "got to"],
  [/\bwont\b/gi, "won't"],
  [/\bim\b/gi, "i'm"],
  // "ill take": only at a sentence start or after "so", "then", "ok" or "and",
  // so "feel ill" keeps its meaning for the urgent checks.
  [/(^|[.?!,]\s*|\b(?:so|then|ok|okay|and)\s+)ill\s+(?=(?:just\s+)?(?:give|take|bolus|inject|do|have|eat|go|correct|set|try|use|add|put)\b)/gi, "$1i'll "],
  [/\bd[\s.-]+o[\s.-]+s[\s.-]+e\b/gi, "dose"],
  [/\bcu(?:a|á)nta\b/gi, "how much"],
  // "dose 4 dinner": a "4" between a dose word and a meal reads as "for".
  [/\b(dose|bolus|insulin|units?|u|correction)\s+4\s+(?=(?:breakfast|lunch|dinner|tea|supper|snack|bed|pizza|pasta|the|my|a|this|that)\b)/gi, "$1 for "],
  // Syringe and pizza emoji, arrows and question-mark emoji (written as escapes).
  [/💉/g, " dose "],
  [/🍕/g, " pizza "],
  [/➡️?|→|⇒/g, " to "],
  [/[↑⬆]️?/g, " up "],
  [/[↓⬇]️?/g, " down "],
  [/[❓❔]/g, "?"],
];

/**
 * Typing slips and shorthand read as the words they stand for, so the
 * safety rules see "how much insulin should I take" in "how mch inslin shud
 * i tak". Applied only for safety classification; the stored prompt is not
 * changed.
 */
export function normaliseDoseWording(text: string) {
  let normalised = TYPO_FIXES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
  // "How many jelly babies for a 3.4": a hypo treatment for a low reading is
  // read as the current reading it names, so the urgent low response applies.
  const lowReading = new RegExp(String.raw`\b${LOW_TREATMENT_ITEM}\b[^.?!\n]{0,40}\b(?:for|treat|fix)\s+(?:a|my|this)\s+(\d(?:[.,]\d)?)\b(?![.,]?\d)`, "i").exec(normalised);
  if (lowReading) normalised = `${normalised} i'm ${lowReading[1]}`;
  return normalised;
}

/* ------------------------------------------------------------------------ */
/* Follow-up turns                                                           */
/* ------------------------------------------------------------------------ */

/** The refusal headline the preflight shows; used to recognise a refused turn in the history. */
export const TREATMENT_REFUSAL_HEADLINE = "I can review the records, but not set treatment";

const FOLLOW_UP_MAX_LENGTH = 120;
/** "yes", "go on", "just tell me": agreeing to the refused request. */
const BARE_AGREEMENT =
  /^\W*(?:(?:ok(?:ay)?|so|well|but|and|then)\W+)*(?:yes|yeah|yep|yup|ya|sure|ok(?:ay)?|go\s+on(?:\s+then)?|go\s+ahead|please|do\s+it|just\s+(?:tell|say|give)(?:\s+me)?(?:\s+(?:anyway|a\s+number|the\s+number|roughly))?|tell\s+me\s+anyway|come\s+on|fine|alright|correct|exactly|right|that's\s+right|roughly|approximately|ballpark|a\s+rough\s+(?:idea|number|guess)|best\s+guess|your\s+best\s+guess|guess|estimate)(?:\W+(?:then|please|anyway|thanks|mate))*\W*$/i;

/*
 * After a record or dose topic, a short follow-up is refused only when it
 * proposes or asks for an amount to take, or a change to make. Asking to see
 * more records, another period, a definition or a comparison passes.
 */
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const SMALL_NUMBER_WORD = String.raw`(?:half|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)`;
const FOLLOW_UP_AMOUNT: readonly RegExp[] = [
  // "6u", "2 units"
  new RegExp(String.raw`\b${NUMBER}\s*(?:u|units?|iu)\b`, "i"),
  // "so 6 then", "6?", "maybe 4", "what about 5", "a couple?"
  new RegExp(
    String.raw`^\W*(?:(?:ok(?:ay)?|so|then|and|but|or|maybe|about|around|roughly|like|say|just|try|what\s+about|how\s+about|is|was|would|should)\W+)*(?:${NUMBER}|${SMALL_NUMBER_WORD}|a\s+(?:couple|few))(?:\s*(?:g|grams?|%))?(?:\W+(?:then|now|instead|ok(?:ay)?|right|yes|please|maybe|too|tonight|ish|enough|fine))*\W*$`,
    "i",
  ),
  // "2 more", "half a unit more"
  new RegExp(
    String.raw`\b(?:${NUMBER}|${SMALL_NUMBER_WORD}|a\s+(?:couple|few))\s+(?:more|extra|less|fewer|on\s+top)\b(?!\s+(?:days?|weeks?|months?|records?|readings?|rows?|entries|boluses|smbs?|times?|of\s+(?:the|my|those|them)))`,
    "i",
  ),
  // "add 2", "take another 1", "go with 5"
  new RegExp(
    String.raw`\b(?:add|take|give|bolus|inject|try|go\s+with|stick\s+with)\s+(?:another\s+|an?\s+extra\s+)?(?:${NUMBER}|${SMALL_NUMBER_WORD}\b|a\s+(?:couple|few|unit|bit|little))`,
    "i",
  ),
  // "more insulin", "another bolus", "less basal", "more for dinner", "extra now"
  new RegExp(
    String.raw`\b(?:more|extra|another|less|fewer|a\s+(?:bit|little|touch)\s+(?:more|less))\s+(?:(?:rapid|fast|long)[-\s]?acting\s+)?(?:${DOSE_NOUN}|carbs?|sugar|for\b|now\b|then\b|tonight\b|on\s+top)(?![^.?!\n]*\bthan\b)`,
    "i",
  ),
  // "more?", "a bit more?", "less then?"
  /^\W*(?:(?:ok(?:ay)?|so|and|then|maybe|just)\W+)*(?:a\s+(?:bit|little|touch)\s+)?(?:more|less|extra|another)(?:\W+(?:then|now|please|instead))*\W*$/i,
  // "is that enough", "enough?" (but not "enough data/records to tell")
  /\benough\b(?!\s+(?:data|records?|readings?|info\w*|history|days?|coverage|evidence|detail|to\s+(?:tell|say|know|judge|compare|go\s+on)))/i,
  /\btoo\s+(?:much|many|little|few)\b/i,
  // "should I?", "should I add more", "ok to bolus now", "safe to correct"
  /^\W*(?:(?:ok(?:ay)?|so|and|but|then|well)\W+)*(?:should|shall|can|could|do|must)\s+i(?:\s+(?:then|now|too|still|really|though))*\W*$/i,
  /\b(?:should|shall|must|do|can|could)\s+i\s+(?:just\s+|still\s+|now\s+|also\s+|then\s+)?(?:take|give|add|bolus|inject|correct|eat|drink|have|up|lower|raise|change|increase|decrease|reduce|cut|drop|turn|stack|top|treat|cover|pre-?bolus|split|extend|suspend|skip|override|accept|set|use)\b/i,
  /\b(?:ok|okay|safe|fine|alright|wise|smart|best)\s+to\s+(?:take|give|add|bolus|inject|correct|stack|top|eat|skip|suspend|cover)\b/i,
  // "same again", "the same", "do it again", "same dose"
  /^\W*(?:(?:ok(?:ay)?|so|and|then|just)\W+)*(?:(?:the\s+)?same(?:\s+again)?|again|repeat(?:\s+(?:it|that))?|do\s+(?:it|that|the\s+same)\s+again|one\s+more)(?:\W+(?:then|please|tonight|now|today|for\s+(?:dinner|lunch|breakfast|tea|supper)))*\W*$/i,
  /\bsame\s+(?:amount|dose|bolus|units?|correction|as\s+(?:before|last\s+time))\b|\b(?:take|give|bolus|inject|do|have)\s+(?:it|that|this|the\s+same|them)\s+again\b|\brepeat\s+(?:the\s+|that\s+|my\s+)?(?:dose|bolus|correction|amount)\b/i,
  /\b(?:top\s+(?:it\s+|me\s+|that\s+)?up|stack(?:\s+(?:it|them|more|another|on))?)\W*$/i,
  // "and for dinner", "what about for 60g", "for a snack?"
  new RegExp(
    String.raw`\bfor\s+(?:(?:my|the|a|this)\s+)?(?:dinner|lunch|breakfast|tea|supper|snack|meal|pizza|pasta|${CARB_AMOUNT})|^\W*(?:(?:ok(?:ay)?|so|and|then|what|how)\W+)*(?:about\s+)?for\s+(?:it|that|this|them)\W*$`,
    "i",
  ),
  /\bhow\s+(?:much|many)\s+(?:for|to|should|do|now|more|then|extra|less|would|insulin|units?|u)\b/i,
  /\bwhat\s+would\s+you\s+(?:do|take|give|suggest|recommend|say|go\s+with|change|set)\b|\bwhat\s+(?:do|should|shall)\s+i\s+(?:do|take|give|need|set|change|use)\b/i,
  // "+10% profile", "drop basal 20%", "80% then"
  /[+-]\s*\d+\s*%|\b\d+\s*%\s*(?:profile|basal|temp|less|more|lower|higher|up|down|then|instead)\b|\b(?:profile|basal|temp\s+basal)\s+(?:to\s+|at\s+)?\d+\s*%/i,
];

/** "show all", "show more", "tell me more": asking to see more of the records. */
const FOLLOW_UP_SHOW_MORE =
  /^\W*(?:(?:ok(?:ay)?|so|and|please)\W+)*(?:show|tell|list)\s+(?:me\s+)?(?:all|more|everything|the\s+rest|the\s+details?|details?)(?:\s+(?:please|then|of\s+(?:it|them|that)))*\W*$/i;
const FOLLOW_UP_NOT_A_REQUEST =
  /^\W*(?:(?:ok(?:ay)?|so|and|right|great|cool)\W+)*(?:thanks|thank\s+you|cheers|ta|never\s*mind|nevermind|no\s+thanks|got\s+it|understood|that's\s+fine|fair\s+enough)\b/i;
const FOLLOW_UP_HISTORY = /\b(?:did|was|were|had|yesterday|last\s+(?:night|week|month)|ago)\b/i;
const DOSE_TOPIC_TURN = new RegExp(
  String.raw`\b(?:${DOSE_NOUN}|${SETTING}|carbs?|carbohydrates?|glucose|blood\s+sugar|lows?|hypos?|highs?|${LOW_TREATMENT_ITEM})\b|${CARB_AMOUNT}`,
  "i",
);

/*
 * After a refused dose request, a short reply is read as pressing the same
 * request ("just a number", "hypothetically", "for a friend", "👍") unless it
 * clearly starts a new topic: thanks, another period, a stored-record
 * question, a definition or an app question that does not point back at the
 * refused request.
 */
/** Words that point back at the refused request or ask for its answer another way. */
const REFUSAL_BACK_REFERENCE = new RegExp(
  String.raw`\b(?:that|it|this|them|those|these|same|usual|again|then|instead|anyway|roughly|ballpark|hypothetical\w*|friend|typical\w*|average|normally|usually|pretend|ignore|rules?|sum|maths?|math|arithmetic|calculat\w*|formula|work\s+(?:it\s+)?out|ratio|profile|wizard|units?|number|amount|dose|dosing|would|could|if|more|less|higher|lower|closer|nearer|between|than|half|handful|dozen|ish|i'll|i\s+will|so\s+i\s+can|take|took|give|bolus\s+for)\b|${CARB_AMOUNT}`,
  "i",
);
const CONTINUATION_START = /^\W*(?:and|or|so|but|then|what\s+about|how\s+about|what\s+if|and\s+if)\b/i;
/** "and yesterday?", "what about last week?": the same records for another period. */
const PERIOD_ONLY =
  /^\W*(?:(?:and|ok(?:ay)?|so)\W+)?(?:(?:what|how)\s+about\s+)?(?:for\s+|on\s+)?(?:yesterday|today|last\s+(?:night|week|month|\d+\s+days)|this\s+(?:week|month)|the\s+day\s+before|the\s+last\s+\d+\s+days|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\W*$/i;
const EXPLICIT_NEW_TOPIC =
  /^\W*(?:(?:ok(?:ay)?|right|fine)\W+)?(?:new|different|another|separate|unrelated)\s+(?:question|topic|thing)\b|\b(?:change\s+of\s+subject|something\s+else)\b/i;

/** "What was my average glucose yesterday?", "How did I sleep last night?": a past record that is not a dose. */
const PAST_NON_DOSE_RECORD =
  /^\W*(?:what|how|when|which|did|was|were|have|has)\b[^?!\n]{0,60}\b(?:glucose|time\s+in\s+range|tir|readings?|sleep|slept|steps|heart\s+rate|weight|hba1c|a1c|activity|exercise|walks?|runs?|cgm|sensor|site|cannula|pod|sync\w*)\b[^?!\n]{0,40}\b(?:was|were|did|have|has|had|last|yesterday|today|so\s+far|this\s+(?:week|month)|overnight)\b|^\W*(?:what|how|when)\b[^?!\n]{0,40}\b(?:was|were|did|have|has|had)\b[^?!\n]{0,40}\b(?:glucose|time\s+in\s+range|tir|readings?|sleep|steps|heart\s+rate|weight|hba1c|a1c|activity|exercise|cgm|sensor|site|cannula|pod)\b/i;
/** Dose, treatment and hypothetical words that keep a follow-up tied to the refused request. */
const NON_DOSE_RECORD_BLOCKER = new RegExp(
  String.raw`\b(?:insulin|units?|bolus\w*|basal|doses?|dosing|ratios?|isf|carbs?|take|took|give|correct\w*|treat\w*|cover|should|would|could|if|than|that|it|this|same|instead|so\s+i\s+can|need|enough|more|less|higher|lower)\b|${CARB_AMOUNT}`,
  "i",
);

function isNewTopicAfterRefusal(text: string, isRecordQuestion: (question: string) => boolean): boolean {
  const notARequest = FOLLOW_UP_NOT_A_REQUEST.exec(text);
  if (notARequest) {
    const rest = text.slice(notARequest[0].length).replace(/^\W+/, "");
    return !rest || isNewTopicAfterRefusal(rest, isRecordQuestion);
  }
  if (PERIOD_ONLY.test(text)) return true;
  if (EXPLICIT_NEW_TOPIC.test(text)) {
    const rest = text.replace(EXPLICIT_NEW_TOPIC, " ").replace(/^\W+/, "");
    return !rest || !REFUSAL_BACK_REFERENCE.test(rest);
  }
  if (CONTINUATION_START.test(text)) return false;
  if (PAST_NON_DOSE_RECORD.test(text) && !NON_DOSE_RECORD_BLOCKER.test(text) && !/\d/.test(text.replace(/\blast\s+\d+\s+days\b/gi, " "))) {
    return true;
  }
  if (REFUSAL_BACK_REFERENCE.test(text)) return false;
  if (FOLLOW_UP_AMOUNT.some((pattern) => pattern.test(text))) return false;
  if (isRecordQuestion(text)) return true;
  // "what's 60 divided by 10": numbers after a refused dose request are the same request.
  return !/\d/.test(text) && isReadOnlySentence(text);
}

function previousExchange(history: readonly TarvisConversationTurn[]) {
  const last = history.at(-1);
  const assistant = last?.role === "assistant" ? last.text : undefined;
  const userTurn = assistant !== undefined ? history.at(-2) : last;
  const user = userTurn?.role === "user" ? userTurn.text : undefined;
  return { user, assistant };
}

/**
 * A short follow-up that continues a refused dose request ("yes", "just a
 * number", "hypothetically", "so 6 then") or proposes an amount after a
 * record or dose topic ("so 2 more units", "is that enough", "ok and how much
 * for 60g"). `previousWasRefusal` says whether the preflight refused the
 * previous user turn; `isRecordQuestion` recognises a stored-record question,
 * which starts a new topic after a refusal. Ordinary follow-ups ("thanks",
 * "and the last 14?", "explain more", "is that too high?") pass.
 */
export function isDoseFollowUp(
  question: string,
  history: readonly TarvisConversationTurn[],
  previousWasRefusal: (previousQuestion: string) => boolean,
  isRecordQuestion: (question: string) => boolean = () => false,
) {
  if (!history.length || question.length > FOLLOW_UP_MAX_LENGTH) return false;
  const { user, assistant } = previousExchange(history);
  if (!user) return false;
  const text = normaliseDoseWording(normaliseSafetyText(question));
  const refused =
    (assistant !== undefined && assistant.startsWith(TREATMENT_REFUSAL_HEADLINE)) || previousWasRefusal(user);
  if (refused) return BARE_AGREEMENT.test(text) || !isNewTopicAfterRefusal(text, isRecordQuestion);
  if (FOLLOW_UP_SHOW_MORE.test(text)) return false;
  if (!DOSE_TOPIC_TURN.test(user)) return false;
  const notARequest = FOLLOW_UP_NOT_A_REQUEST.exec(text);
  const request = notARequest ? text.slice(notARequest[0].length) : text;
  if (FOLLOW_UP_HISTORY.test(request)) return false;
  return FOLLOW_UP_AMOUNT.some((pattern) => pattern.test(request));
}

