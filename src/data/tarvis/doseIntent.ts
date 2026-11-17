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
  /\bshould\s+i\s+(?:just\s+|now\s+)?(?:eat|drink)\b/i,
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
  /\bsame\s+(?:again|tonight|today|now|for\s+(?:dinner|lunch|breakfast|tea|supper|this|that))\b/i,
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
  /\b(?:today|now|then|so)\s+(?:then\s+|for\s+|to\s+)?(?:dinner|lunch|breakfast|tea|supper)(?:\s+\d+\s*g?)?\W*$|\band\s+for\s+(?:dinner|lunch|breakfast|tea|supper)\W*$/i,
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
 * Removes the history question from sentences that open with one. Later
 * clauses of a run-on sentence ("How many SMBs did I get today and another
 * unit") stay, so a dose request cannot ride behind a history opener; later
 * clauses that are history themselves are dropped too.
 */
export function withoutHistoryOnlySentences(text: string) {
  const sentences = sentencesOf(text);
  if (!sentences.some(isHistoryOnlySentence)) return text;
  return sentences
    .flatMap((sentence) => {
      if (!isHistoryOnlySentence(sentence)) return [sentence];
      const tail = sentence
        .split(CLAUSE_JOINER)
        .slice(1)
        .filter((clause) => clause.trim() && !HISTORY_SENTENCE_START.test(clause));
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

export function requestsDoseIntent(text: string, context: string) {
  const gated = DOSE_CONTEXT.test(context);
  const strictlyGated = STRICT_DOSE_CONTEXT.test(context);
  if (gated && UNCHECKED_SCRIPT.test(context)) return true;
  return doseCheckUnits(text).some(({ text: unit, whole }) => {
    if (DIRECT_FRAMES.some((pattern) => pattern.test(unit))) return true;
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
/** A short reply that proposes or asks for an amount or a change. */
const FOLLOW_UP_DOSE =
  /\b(?:enough|more(?!\s+(?:detail|details|info|information))|less|extra|another|add|again|same|top\s+up|stack|should|shall|ok\s+to|safe\s+to|too\s+(?:many|much|few|little|high|low)|what\s+would\s+you|what\s+do\s+i|how\s+(?:much|many)\s+(?:for|to|should|do|now|more|then)|for\s+(?:dinner|lunch|breakfast|tea|supper|a\s+snack|the\s+meal|it|that|this|them))\b|\b\d+(?:[.,]\d+)?\s*(?:u|units?|iu|g|grams?|%)?(?![\w.,])(?!\s*(?:days?|weeks?|months?|hours?|hrs?|mins?|minutes?|am|pm|th|st|nd|rd|o'clock)\b)(?!\s*:)/i;
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

function previousExchange(history: readonly TarvisConversationTurn[]) {
  const last = history.at(-1);
  const assistant = last?.role === "assistant" ? last.text : undefined;
  const userTurn = assistant !== undefined ? history.at(-2) : last;
  const user = userTurn?.role === "user" ? userTurn.text : undefined;
  return { user, assistant };
}

/**
 * A short follow-up that continues a refused dose request ("yes", "so 6
 * then", "same again") or proposes an amount after a record or dose topic
 * ("so 2 more units", "is that enough", "ok and how much for 60g").
 * `previousWasRefusal` says whether the preflight refused the previous user
 * turn. Ordinary follow-ups ("thanks", "and yesterday?", "show all") pass.
 */
export function isDoseFollowUp(
  question: string,
  history: readonly TarvisConversationTurn[],
  previousWasRefusal: (previousQuestion: string) => boolean,
) {
  if (!history.length || question.length > FOLLOW_UP_MAX_LENGTH) return false;
  const { user, assistant } = previousExchange(history);
  if (!user) return false;
  const text = normaliseDoseWording(question.trim().normalize("NFKC").replace(/[’‘]/g, "'"));
  if (FOLLOW_UP_SHOW_MORE.test(text)) return false;
  if (FOLLOW_UP_NOT_A_REQUEST.test(text) && !FOLLOW_UP_DOSE.test(text.replace(FOLLOW_UP_NOT_A_REQUEST, " "))) return false;
  const refused =
    (assistant !== undefined && assistant.startsWith(TREATMENT_REFUSAL_HEADLINE)) || previousWasRefusal(user);
  if (refused && BARE_AGREEMENT.test(text)) return true;
  if (!refused && !DOSE_TOPIC_TURN.test(user)) return false;
  if (FOLLOW_UP_HISTORY.test(text)) return false;
  return FOLLOW_UP_DOSE.test(text);
}

