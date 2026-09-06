import { TarvisAnswer } from "./types";
import { getRuntimeEmergencyCareTerms } from "@/domain/emergencyCare";
import { formatGlucose } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

export type TarvisSafetyDecision =
  | { kind: "allow" }
  | { kind: "urgent"; answer: TarvisAnswer }
  | { kind: "treatment-advice"; answer: TarvisAnswer }
  | { kind: "diagnosis"; answer: TarvisAnswer }
  | { kind: "prediction"; answer: TarvisAnswer };

const DOSE_OR_SETTING =
  /\b(?:insulin|bolus|correction|dose|units?|basal(?: rate)?|carb(?:ohydrate)? ratio|correction factor|sensitivity|target(?: glucose)?|pump setting|profile)\b/i;
const DIRECT_TREATMENT_REQUEST =
  /\b(?:how much|how many|what (?:dose|bolus|correction))\b[\s\S]{0,60}\b(?:insulin|bolus|correction|dose|units?)\b|\bwhat\s+(?:dose|bolus|correction)\b(?:\s+should\s+i\s+(?:take|give|inject|do|use)|[\s\S]{0,40}\b(?:for|with)\b)|\bdo i need\s+(?:any\s+)?(?:insulin|a\s+bolus|a\s+correction)\b|\b(?:should|shall|do i need to|can i)\s+i?\s*(?:take|give|inject|bolus|correct|change|adjust|increase|decrease|raise|lower|set)\b|\b(?:tell me (?:to|how to|my|the)|recommend|advise)\b[\s\S]{0,60}\b(?:take|give|inject|bolus|correct|correction dose|change|adjust|increase|decrease|raise|lower|set|insulin|dose|basal|ratio|factor|target)\b|\b(?:calculate|work out|give me)\b[\s\S]{0,50}\b(?:dose|bolus|correction|units?)\b|\b(?:change|adjust|increase|decrease|raise|lower|set)\s+(?:my|the)\s+(?:basal(?: rate)?|carb(?:ohydrate)? ratio|correction factor|sensitivity|target(?: glucose)?|pump setting|profile)\b|\b(?:what should|is) my\s+(?:basal(?: rate)?|carb(?:ohydrate)? ratio|correction factor|sensitivity|target(?: glucose)?|pump setting|profile)(?:\s+be|\s+too\s+(?:low|high))?\b/i;
const UNAMBIGUOUS_TREATMENT_ACTION =
  /\b(?:(?:should|shall)\s+i|do i need to|can i)\s+(?:inject|correct)\b|\b(?:tell me (?:to|how to)|recommend|advise)\b[\s\S]{0,40}\b(?:inject|correct)\b/i;
const LOW_GLUCOSE_CONTEXT = /\b(?:low|hypo|hypoglyc(?:aemia|emia|emic))\b/i;
const DIRECT_LOW_CARB_TREATMENT =
  /\bhow (?:many|much)\b[\s\S]{0,30}\b(?:carbs?|carbohydrates?|glucose (?:tabs?|tablets?)|dextrose (?:tabs?|tablets?)|juice)\b|\b(?:(?:should|shall)\s+i|do i need to|can i)\s+(?:eat|drink|take|have|consume)\b[\s\S]{0,40}\b(?:carbs?|carbohydrates?|glucose (?:tabs?|tablets?)|dextrose (?:tabs?|tablets?)|juice|\d+(?:[.,]\d+)?\s*g(?:rams?)?)\b|\bwhat should i\s+(?:eat|drink|take|have|consume)\b|\b(?:how|what)\s+(?:should|do|can)\s+i\s+(?:treat|handle|manage)\b|\b(?:what (?:should|do|can) i do (?:for|about)|how (?:should|do|can) i (?:treat|handle|manage)|help me (?:treat|handle|manage)|what(?:'s| is) the best way to (?:treat|handle|manage)|what(?:'s| is) best to (?:eat|drink|take|have))\b[\s\S]{0,40}\b(?:low|hypo)\b|\bis\s+\d+(?:[.,]\d+)?\s*g(?:rams?)?\s+enough\b[\s\S]{0,30}\b(?:low|hypo)\b|\bwhat should i do about (?:it|this)\b|\bcan you tell me what to do about (?:this|the|my)\s+(?:low|hypo)\b|\b(?:can|could) you\s+(?:work out|tell me)\b[\s\S]{0,60}\b(?:treat|handle|manage)\s+(?:this|the|my)?\s*(?:low|hypo)\b/i;
const IMMEDIATE_TIME =
  /\b(?:now|right now|currently|at the moment|today|this morning|all morning|just|still|won't|will not|can't|cannot)\b/i;
const URGENT_SYMPTOM =
  /\b(?:vomit(?:ing|ed)?|throwing up|being sick|been sick|dehydrat(?:ed|ion)|hyperventilat(?:ing|ion)|difficulty breathing|trouble breathing|struggling to breathe|hard to breathe|breathing is difficult|breathless|gasping for breath|can't breath(?:e)?|cannot breathe|unable to breathe|not breathing(?!\s+(?:rapidly|fast|deeply))|short of breath|can't catch (?:my|their) breath|cannot catch (?:my|their) breath|deep breathing|breathing deeply|breathing (?:very\s+)?(?:fast|rapidly)|rapid breathing|taking (?:very\s+)?deep breaths|confus(?:ed|ion)|disorient(?:ed|ation)|reduced (?:level of )?consciousness|don't know where i am|can't think straight|cannot think straight|(?:feel )?out of it|can't stay awake|cannot stay awake|(?:very|really|extremely) (?:drowsy|sleepy)|drowsy|unconscious|unresponsive|pass(?:ed)? out|faint(?:ed)?|black(?:ed)? out|seizure|seizing|convulsing|having a fit|fitting|can't keep (?:anything|food|fluids?|liquids?|water|drinks?) down|cannot keep (?:anything|food|fluids?|liquids?|water|drinks?) down|unable to keep (?:anything|food|fluids?|liquids?|water|drinks?) down)\b/i;
const FIRST_PERSON_CURRENT_URGENT =
  /\b(?:i(?:'m| am)\s+(?:(?:repeatedly\s+)?(?:vomiting|throwing up|being sick)|dehydrated|hyperventilating|breathing deeply|breathing (?:fast|rapidly)|struggling to breathe|short of breath|breathless|gasping for breath|confused|disoriented|out of it|seizing|convulsing|fitting|(?:(?:very|really|extremely) )?(?:drowsy|sleepy)|unconscious|having (?:difficulty|trouble) breathing|having (?:a )?(?:fit|seizure))|i (?:can't|cannot) (?:catch my breath|breathe|think straight|stay awake)|i don't know where i am|i(?:'ve| have)\s+(?:vomited|thrown up|passed out|fainted|blacked out|had (?:a )?seizure|become (?:(?:very|really|extremely) )?(?:drowsy|sleepy)|been\s+(?:vomiting|throwing up|being sick|sick))|i\s+(?:had (?:a )?seizure|passed out|fainted|blacked out)|i\s+(?:vomited|threw up|was sick)\s+(?:(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+times|twice)|(?:(?:i|and)\s+)?(?:now\s+)?(?:feel|am)\s+(?:confused|disoriented|out of it|(?:(?:very|really|extremely) )?(?:drowsy|sleepy))|i keep (?:throwing up|vomiting|being sick)|i\s+have\s+(?:difficulty|trouble) breathing|i\s+have\s+reduced (?:level of )?consciousness|i(?:'m| am)\s+having\s+(?:a seizure|seizures)|i (?:can't|cannot) keep (?:anything|food|fluids?|liquids?|water) down)\b/i;
const UNAMBIGUOUS_CURRENT_SEVERE =
  /\b(?:(?:i(?:'m| am)|he(?:'s| is)|she(?:'s| is)|they(?:'re| are)|someone is|my (?:son|daughter|child|partner|husband|wife) is)\s+(?:unconscious|unresponsive|dehydrated|hyperventilating|confused|disoriented|vomiting|throwing up|being sick|seizing|convulsing|fitting|breathless|short of breath|gasping for breath|breathing deeply|breathing (?:fast|rapidly)|not breathing|(?:(?:very|really|extremely) )?(?:drowsy|sleepy)|having (?:a )?(?:fit|seizure)|having (?:difficulty|trouble) breathing|unable to breathe)|(?:i|he|she|they|my (?:son|daughter|child|partner|husband|wife)) (?:has|have) reduced (?:level of )?consciousness|(?:he|she|they|my (?:son|daughter|child|partner|husband|wife)) keeps? (?:vomiting|throwing up|being sick)|having (?:a )?seizure|(?:can't|cannot|unable to) breathe|not breathing|(?:it's|it is) hard to breathe|breathing is difficult|(?:i|he|she|they|my (?:son|daughter|child|partner|husband|wife)) (?:passed out|fainted|blacked out))\b/i;
const IMMEDIATE_999_SYMPTOM =
  /\b(?:unconscious|unresponsive|reduced (?:level of )?consciousness|pass(?:ed)? out|faint(?:ed)?|black(?:ed)? out|seizure|seizing|convulsing|having (?:a )?fit|can't breath(?:e)?|cannot breathe|unable to breathe|not breathing(?!\s+(?:rapidly|fast|deeply))|gasping for breath|struggling to breathe|can't catch (?:my|their) breath|cannot catch (?:my|their) breath)\b/i;
const IMMEDIATE_999_SYNONYM =
  /\b(?:(?:won't|will not|(?:is|'s)\s+not)\s+(?:wake(?:\s+up)?|respond)|(?:can't|cannot|unable to)\s+be\s+woken|(?:i\s+)?(?:can't|cannot)\s+wake\s+(?:him|her|them|the\s+child)(?:\s+up)?|(?:is|are|'s|'re)\s+(?:hard|difficult)\s+to\s+wake|(?:is|are|'s|'re)\s+(?:barely|hardly)\s+awake|(?:is|are|'s|'re)\s+not\s+responding|(?:is|are|'s|'re)\s+having\s+convulsions?|(?:is|are|'s|'re)\s+struggling\s+for\s+breath|(?:can't|cannot)\s+(?:get\s+(?:my|their|his|her)\s+breath|catch\s+(?:my|their|his|her)\s+breath)|(?:has|have|'s|'ve)\s+stopped\s+breathing|(?:is|are|'s|'re)\s+(?:barely|hardly)\s+breathing|(?:is|are|'s|'re)\s+unrousable|(?:is|are|'s|'re)\s+out\s+cold|(?:i|he|she|they|someone|somebody|the patient|my (?:mum|mom|mother|dad|father|brother|sister|child|son|daughter|wife|husband|partner|friend|colleague)|our (?:child|son|daughter|partner|friend))\s+(?:(?:has|have)\s+)?(?:collapsed|lost\s+consciousness))\b/i;
const IMMEDIATE_999_NATURAL_PRESENT =
  /\b(?:(?:i(?:'ve| have)|he(?:'s| has)|she(?:'s| has)|they(?:'ve| have)|(?:my|our)\s+(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague)\s+(?:has|have))\s+(?:just\s+)?(?:collapsed|lost\s+consciousness)|(?:i(?:'m| am)|he(?:'s| is)|she(?:'s| is)|they(?:'re| are)|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague)(?:\s+is|'s))\s+(?:fitting|having\s+(?:a\s+)?(?:fits?|seizures?))|(?:i|he|she|they|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague))\s+(?:started\s+fitting|(?:just\s+)?had\s+(?:a\s+)?(?:fit|seizure)|stopped\s+breathing)|(?:he|she|they|my\s+(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague))\s+can\s+barely\s+breathe|(?:i|he|she|they|someone|somebody|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague))(?:'s|\s+is)\s+(?:gasping|having\s+(?:difficulty|trouble)\s+breathing)|(?:(?:my|our)\s+)?(?:child|kid|son|daughter)(?:'s|\s+is)\s+breathing\s+is\s+difficult|(?:isn't|aren't)\s+breathing(?!\s+(?:rapidly|fast|deeply)))\b/i;
const IMMEDIATE_999_HUMAN_PRESENT =
  /\b(?:(?:i|he|she|they|someone|somebody|the\s+(?:person|patient)|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|neighbou?r))(?:'s|\s+is)?\s+(?:not\s+waking(?:\s+up)?|out\s+cold|fitting|choking|gasping|blue\s+around\s+the\s+lips|breathing\s+(?:very\s+)?(?:slowly|shallowly))|(?:i|he|she|they|someone|somebody|the\s+(?:person|patient)|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|neighbou?r))\s+(?:has\s+)?turned\s+blue|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|neighbou?r)'s\s+breathing\s+is\s+(?:very\s+)?(?:slow|shallow))\b/i;
const IMMEDIATE_999_CRITICAL_RESPONSE_OR_AIRWAY =
  /\b(?:(?:i\s+)?(?:can't|cannot)\s+rouse\s+(?:him|her|them|the\s+child)|(?:he|she|they|someone|somebody|the\s+(?:person|patient)|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|mate|colleague|neighbou?r))\s+(?:cannot|can't)\s+be\s+roused|(?:he|she|they|someone|somebody)\s+(?:won't|will\s+not)\s+come\s+round|i\s+(?:can't|cannot)\s+get\s+(?:any\s+)?response\s+from\s+(?:him|her|them)|(?:(?:my|our)\s+)?(?:mate|friend|colleague|neighbou?r)\s+has\s+(?:just\s+)?collapsed|(?:he|she|they|someone|somebody|the\s+(?:person|patient))\s+is\s+having\s+(?:a\s+)?convulsion|(?:he|she|they|someone|somebody)\s+(?:can't|cannot)\s+spea(?:k|king)\s+or\s+breathe|(?:he|she|they|someone|somebody)\s+(?:isn't|is\s+not|aren't|are\s+not)\s+taking\s+(?:any\s+)?breaths|(?:his|her|their)\s+breathing\s+(?:has\s+stopped|has\s+ceased|is\s+agonal)|(?:he|she|they|someone|somebody)\s+(?:has|have)\s+agonal\s+breathing|(?:his|her|their)\s+lips\s+(?:are|have\s+gone)\s+blue|(?:his|her|their)\s+face\s+is\s+(?:turning|going)\s+blue|(?:his|her|their)\s+airway\s+is\s+blocked|(?:he|she|they|someone|somebody)\s+is\s+(?:making\s+)?gasping\s+noises|(?:he|she|they|someone|somebody)\s+is\s+only\s+taking\s+occasional\s+breaths|(?:he|she|they|someone|somebody)\s+(?:has\s+)?gone\s+blue|(?:he|she|they|someone|somebody)\s+(?:has\s+)?ceased\s+breathing)\b/i;
const IMMEDIATE_999_ADDITIONAL_HUMAN =
  /\b(?:(?:(?:my|our)\s+)?(?:boyfriend|girlfriend)\s+(?:is|'s)\s+(?:choking|unconscious|unresponsive|seizing|fitting|not\s+breathing)|(?:he|she|they|someone|somebody)\s+(?:won't|will\s+not)\s+(?:come\s+a?round|open\s+(?:his|her|their)\s+eyes)|i(?:'m|\s+am)\s+getting\s+no\s+response\s+from\s+(?:him|her|them)|(?:there\s+is|there's)\s+no\s+response\s+from\s+(?:him|her|them)|(?:he|she|they)(?:'s|\s+is)\s+(?:making\s+gasping\s+(?:noises|sounds)|only\s+taking\s+(?:occasional|a\s+few)\s+breaths|going\s+blue)|(?:he|she|they)(?:'s|\s+has)\s+gone\s+blue|(?:his|her|their)\s+airway\s+is\s+(?:blocked|obstructed)|(?:his|her|their)\s+(?:mouth|lips|face)\s+is\s+(?:turning|going)\s+blue|(?:my|our)\s+(?:child|kid|son|daughter)\s+(?:with\s+(?:type\s*1(?:\s+diabetes)?|type\s+one(?:\s+diabetes)?|t1d)\s+)?(?:is|'s|has|keeps)\s+(?:(?:barely|hardly)\s+conscious|(?:drifting|fading)\s+in\s+and\s+out\s+of\s+consciousness|labou?red\s+breathing))\b/i;
const IMMEDIATE_999_TURNED_BLUE =
  /\b(?:his|her|their)\s+(?:face|mouth|lips)\s+(?:has|have)\s+turned\s+blue\b/i;
const RECENT_FIT_OR_SEIZURE =
  /\b(?:i|he|she|they|someone|somebody|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|neighbou?r))\s+(?:just\s+)?had\s+(?:a\s+)?(?:fit|seizure)(?:\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+minutes?\s+ago)?\b/i;
const IMMEDIATE_999_FAMILY_PRESENT =
  /\b(?:(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague)(?:(?:'s|\s+has)\s+(?:just\s+)?collapsed|\s+just\s+collapsed|\s+collapsed\s+just\s+now|(?:'s|\s+has|\s+)\s*stopped\s+breathing|(?:'s|\s+has)\s+just\s+had\s+(?:a\s+)?(?:fit|seizure))|(?:i(?:'ve| have)|he(?:'s| has)|she(?:'s| has)|they(?:'ve| have))\s+just\s+had\s+(?:a\s+)?(?:fit|seizure))\b/i;
const IMMEDIATE_999_COLLAPSE_PRESENT =
  /\b(?:(?:has|'s)\s+(?:just\s+)?collapsed|collapsed\s+just\s+now)\b/i;
const NON_HUMAN_COLLAPSE_SUBJECT =
  /\b(?:app|application|sensor|pump|software|screen|connection|system|service|database|phone|watch|program|process|cannula|site)\b[\s\S]{0,20}\b(?:has|'s)\s+(?:just\s+)?collapsed\b/i;
const NON_HUMAN_IMMEDIATE_CONTEXT =
  /^\s*(?:i(?:'m|\s+am)\s+fitting\s+(?:(?:a|an|the|my)\s+)?(?:new\s+)?(?:glucose\s+)?(?:sensor|cgm|pump|infusion\s+set|cannula)|(?:(?:the|my|our|this|that)\s+)?(?:app|application|pump|sensor|cgm|phone|watch|software|service|system)\s+(?:is|'s|has\s+become)\s+(?:unconscious|unresponsive|seizing|fitting))\s*[.!?]?\s*$/i;
const HUMAN_COLLAPSE_PRESENT =
  /\b(?:(?:i|he|she|they|someone|somebody)(?:'s|\s+has)?|(?:my|our)\s+(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|neighbou?r)(?:'s|\s+has)?|(?:a|the)\s+(?:man|woman|person|patient|driver|passenger)(?:'s|\s+has)?)\s*(?:just\s+)?collapsed\b|\b(?:(?:i|he|she|they|someone|somebody)|(?:my|our)\s+(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|neighbou?r)|(?:a|the)\s+(?:man|woman|person|patient|driver|passenger))\s+collapsed\s+just\s+now\b/i;
const NAMED_COLLAPSE_PRESENT =
  /\b[A-Z][a-z]{1,30}(?:'s|\s+has)\s+(?:just\s+)?collapsed\b|\b[A-Z][a-z]{1,30}\s+collapsed\s+just\s+now\b/;
const EXPLICITLY_NEGATED_IMMEDIATE_999 =
  /\b(?:nobody|no one)\s+(?:is|was|has)\b[\s\S]{0,35}\b(?:unconscious|unresponsive|seizing|fitting|collapsed|not breathing|having\s+(?:a\s+)?(?:fit|seizure)|seizures?)\b|\b(?:i|he|she|they|someone|somebody|the\s+(?:person|patient)|my\s+(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner))\s+(?:never|did not|didn't|has not|hasn't|is not|isn't)\b[\s\S]{0,25}\b(?:pass(?:ed)? out|faint(?:ed)?|collapse(?:d)?|unconscious|unresponsive|seiz(?:e|ed|ing)|fitting|waking(?:\s+up)?|having\s+(?:a\s+)?(?:fit|seizure))\b|\bnot\s+(?:unconscious|unresponsive|seizing|fitting|convulsing)\b/i;
const BROAD_PRESENT_IMMEDIATE_999 =
  /\b(?:is|are|has|have)\s+(?:unconscious|unresponsive|reduced (?:level of )?consciousness|seizing|convulsing|having (?:a )?(?:fit|seizure)|not breathing|gasping for breath|struggling to breathe|unable to breathe)\b|\b(?:passed out|fainted|blacked out)\b/i;
const HISTORICAL_ONLY_URGENT =
  /\b(?:(?:i|he|she|they|my (?:son|daughter|child|partner|husband|wife)) (?:was|were|had|had been|threw up|vomited|felt|passed out|fainted|blacked out)|my [a-z ]+ (?:was|were))\b[\s\S]{0,90}\b(?:yesterday|last (?:night|week|month|year|tuesday|monday|wednesday|thursday|friday|saturday|sunday)|earlier|previously|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+) (?:minutes?|hours?|days?|weeks?|months?|years?) ago|on (?:tuesday|monday|wednesday|thursday|friday|saturday|sunday))\b/i;
const ONGOING_URGENT_CONTINUATION =
  /\b(?:and\s+)?still\s+(?:am|are|do|does|have|has)\b|\bsince\s+(?:yesterday|last (?:night|week|month|tuesday|monday|wednesday|thursday|friday|saturday|sunday)|earlier|\d+\s+(?:minutes?|hours?|days?)\s+ago)\b/i;
const HISTORICAL_STATE_LANGUAGE =
  /\b(?:used to|no longer|previously|in the past)\b/i;
const DESCRIPTIVE_INSULIN_HISTORY =
  /\b(?:how much|how many|what)\b[\s\S]{0,70}\b(?:did i (?:take|receive|deliver|use|have)|i (?:took|received|used|had)|was delivered|did (?:my )?pump deliver)\b|\b(?:how much|how many|what)\s+(?:total\s+)?(?:insulin|bolus|basal)\b[\s\S]{0,50}\b(?:today|yesterday|last|past|previous|on\s+\d|between|from)\b/i;
const DANGEROUS_CURRENT_GLUCOSE =
  /\b(?:(?:my (?:glucose|blood sugar|sugar|reading)(?: (?:reading|level))?\s+(?:is|reads?|shows?)|current (?:glucose|blood sugar|sugar|reading)(?: (?:reading|level))?(?:\s+(?:is|reads?|shows?))?|i(?:'m| am)(?: currently)?(?: at)?)\s*[\s\S]{0,20}\b(?:low|hypo|very high|(?:[0-2](?:[.,]\d+)?|3(?:[.,]\d+)?)\s*mmol|(?:below|under)\s*4(?:[.,]0)?|(?:above|over)\s*(?:20|360))\b)/i;
const CURRENT_HIGH_KETONES =
  /\b(?:(?:i|he|she|my (?:son|daughter|child|partner|husband|wife))\b[\s\S]{0,40}\b)?(?:have|has|got)\s+(?:very\s+)?(?:high|large|moderate)\s+ketones?\b|\b(?:my\s+)?(?:urine\s+)?ketones?(?:\s+(?:level|reading))?\s+(?:are|is|show|shows|read|reads|say|says)?\s*(?:very\s+)?(?:high|large|moderate)\b|\b(?:high|large|moderate)\s+(?:urine\s+)?ketones?\b/i;
const CURRENT_ANY_KETONES =
  /\bi\s+(?:have|have got|'ve got)\s+ketones?\b|\bi(?:'ve| have)\s+got\s+ketones?\b/i;
const CURRENT_KETONE_VALUE =
  /\b(?:my\s+)?(?:(?:blood|urine)\s+)?ketone(?:s|\s+(?:level|reading|meter|strip|test|result))?(?:\s+(?:are|is|was|were|show|shows|read|reads|say|says|of|at|currently)|\s+(?:have|has)\s+gone\s+up\s+to|\s*[:=])?\s*(?:(?:exactly|approximately|approx\.?|about|around|roughly)\s+)?(?:[<>]=?|[≥≤])?\s*(\d+(?:[.,]\d+)?)(?:\s*mmol(?:\/l)?)?\b|\b(?:[<>]=?|[≥≤])?\s*(\d+(?:[.,]\d+)?)\s*(?:mmol(?:\/l)?\s+)?(?:blood\s+)?ketones?\b/i;
const CURRENT_KETONE_MIXED_DECIMAL =
  /\b(?:my\s+)?(?:(?:blood|urine)\s+)?ketone(?:s|\s+(?:level|reading|meter|strip|test|result))?(?:\s+(?:are|is|was|were|show|shows|read|reads|say|says|of|at|currently)|\s+(?:have|has)\s+gone\s+up\s+to|\s*[:=])?\s*(\d+)\s+(?:point|dot|decimal)\s+(\d+|oh|nought|naught|zero|one|two|three|four|five|six|seven|eight|nine)\b/i;
const CURRENT_KETONE_RESULT_VALUE =
  /(?:\b(?:my|the)\s+(?:blood\s+|urine\s+)?ketone\s+result\s+(?:is|was|reads?|shows?)|\b(?:my\s+)?(?:blood\s+|urine\s+)?ketones?\s+came\s+back(?:\s+(?:at|as))?|\bi\s+tested\s+(?:my\s+)?ketones?\s+and\s+got)\s*(\d+(?:[.,]\d+)?)/i;
const CURRENT_KETONE_EXTENDED_RESULT_VALUE =
  /(?:\b(?:my\s+)?(?:blood\s+|urine\s+)?ketone(?:s|\s+(?:level|reading|meter|test|result))?\s+(?:has\s+reached|have\s+reached|reached|equals?|equal|came\s+back(?:\s+(?:at|as))?)\s*|\bi\s+got\s+)(\d+(?:[.,]\d+)?)(?:\s*(?:mmol(?:\/l)?))?(?:\s+on\s+my\s+(?:blood\s+|urine\s+)?ketone\s+meter)?\b/i;
const CURRENT_KETONE_AT_VALUE =
  /\b(?:my\s+)?(?:blood\s+|urine\s+)?ketones?\s+(?:are|is)\s+at\s+(\d+(?:[.,]\d+)?)/i;
const CURRENT_KETONE_NATURAL_RESULT_VALUE =
  /\b(?:my\s+)?(?:blood\s+|urine\s+)?ketone(?:s|\s+(?:level|reading|result))?\s+(?:(?:has|have)\s+(?:risen|climbed)\s+to|(?:returned|came\s+back)(?:\s+(?:at|as))?)\s*(\d+(?:[.,]\d+)?)\b/i;
const CURRENT_KETONE_RANGE_VALUE =
  /\b(?:my\s+)?(?:blood\s+|urine\s+)?ketone(?:s|\s+(?:level|reading|result))?(?:\s+(?:are|is|was|were|reads?|shows?))?\s+between\s+(\d+(?:[.,]\d+)?)\s+and\s+(\d+(?:[.,]\d+)?)\b/i;
const CURRENT_KETONE_WORD_VALUE =
  /\b(?:my\s+)?(?:blood\s+|urine\s+)?ketone(?:s|\s+(?:level|reading|meter|strip|test))?(?:\s+(?:are|is|was|were|show|shows|read|reads|say|says|of|at|currently)|\s+(?:have|has)\s+gone\s+up\s+to|\s*[:=])?\s*(?:(?:a\s+little\s+|just\s+)?(?:over|above|greater than|higher than|more than|at least)\s+)?(zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+(?:point|dot|decimal|comma)\s+((?:oh|nought|naught|zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:oh|nought|naught|zero|one|two|three|four|five|six|seven|eight|nine))*))?\b/i;
const CURRENT_KETONE_HALF_VALUE =
  /\b(?:my\s+)?(?:blood\s+|urine\s+)?ketone(?:s|\s+(?:level|reading|meter|strip|test))?(?:\s+(?:are|is|show|shows|read|reads|say|says|of|at|currently)|\s*[:=])?\s*(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+and\s+a\s+half\b/i;
const CURRENT_KETONE_QUARTER_VALUE =
  /\b(?:my\s+)?(?:blood\s+|urine\s+)?ketone(?:s|\s+(?:level|reading|meter|strip|test))?(?:\s+(?:are|is|show|shows|read|reads|say|says|of|at|currently)|\s*[:=])?\s*(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+and\s+(a\s+quarter|three\s+quarters)\b/i;
const KETONE_ABOVE_THREE_THRESHOLD =
  /\b(?:my\s+)?(?:blood\s+)?ketone(?:s|\s+(?:level|reading|meter|test))?(?:\s+(?:are|is|show|shows|read|reads|say|says|of|at|currently)|\s+(?:have|has)\s+gone\s+up\s+to|\s*[:=])?\s*(?:>(?!=)\s*3(?:[.,]0+)?|(?:(?:a\s+little|a\s+bit|slightly|just)\s+)?(?:over|above|greater than|higher than|more than)\s+(?:3(?:[.,]0+)?|three(?:\s+point\s+(?:zero\s*)+)?))\b/i;
const KETONE_EXCEEDS_THREE_THRESHOLD =
  /\b(?:my\s+)?(?:blood\s+)?ketones?\b[\s\S]{0,18}\b(?:(?:are\s+)?at\s+least\s+3[.,](?:0*\d*[1-9]\d*)|(?:exceed|exceeds|have\s+exceeded|has\s+exceeded)\s+3(?:[.,]0+)?)\b/i;
const KETONE_AT_LEAST_THREE =
  /\b(?:my\s+)?(?:blood\s+)?ketones?\b[\s\S]{0,18}\b(?:are\s+)?at\s+least\s+3(?:[.,]0+)?\b/i;
const URINE_KETONE_EMERGENCY_READING =
  /\b(?:my\s+)?(?:(?:urine|wee|pee)\s+ketones?|(?:urine|wee|pee)(?:\s+ketone)?\s+(?:test(?:\s+strip)?|strip|dipstick|result|reading)|ketostix(?:\s+result)?|urinalysis|urine\s+analysis)\b(?:\s+(?:are|is|show|shows|read|reads|say|says|came\s+back(?:\s+(?:at|as))?)|\s*[:=])?\s*(?:exactly\s+|at\s+least\s+)?(?:\+{3,}|(?:3|4)\s*\+|(?:three|four)\s+(?:plus|crosses)|plus\s+plus\s+plus(?:\s+plus)?|large)(?:\s+ketones?)?(?=\s|$|[,.!?;:])/i;
const URINE_KETONE_URGENT_READING =
  /\b(?:my\s+)?(?:(?:urine|wee|pee)\s+ketones?|(?:urine|wee|pee)(?:\s+ketone)?\s+(?:test(?:\s+strip)?|strip|dipstick|result|reading)|ketostix(?:\s+result)?|urinalysis|urine\s+analysis)\b(?:\s+(?:are|is|show|shows|read|reads|say|says|came\s+back(?:\s+(?:at|as))?)|\s*[:=])?\s*(?:exactly\s+|at\s+least\s+)?(?:\+{2}|2\s*\+|two\s+(?:plus|crosses)|plus\s+plus)(?:\s+ketones?)?(?=\s|$|[,.!?;:])/i;
const URINE_KETONE_EMERGENCY_THRESHOLD =
  /\b(?:my\s+)?urine\s+ketone(?:s|\s+(?:strip|test|reading))?(?:\s+(?:are|is|show|shows|read|reads|say|says)|\s*[:=])?\s*(?:>(?!=)\s*(?:2|two)\s*(?:\+|plus)|(?:>=|≥)\s*(?:3|three)\s*(?:\+|plus)|(?:just\s+)?(?:over|above|greater than|more than)\s+(?:2|two)\s*(?:\+|plus)|(?:3|4|three|four)\s*(?:\+|plus)|plus\s+plus\s+plus(?:\s+plus)?)(?=\s|$|[,.!?;:])/i;
const URINE_KETONE_WORD_PLUS =
  /\b(?:my\s+)?urine\s+ketone(?:s|\s+(?:strip|test|reading))?(?:\s+(?:are|is|show|shows|read|reads|say|says)|\s*[:=])?\s*plus\s+plus(?:\s+plus){0,2}(?=\s|$|[,.!?;:])/i;
const URINE_KETONE_EMERGENCY_RESULT =
  /\b(?:my\s+)?(?:urine(?:\s+ketone)?(?:\s+test)?\s+strip|urine\s+ketones?)(?:\s+(?:are|is|show|shows|read|reads|say|says|came\s+back(?:\s+(?:at|as))?)|\s*[:=])?\s*(?:3\s*\+|three\s+plus|plus\s+plus\s+plus(?:\s+plus)?)(?:\s+ketones?)?(?=\s|$|[,.!?;:])/i;
const URINE_KETONE_EMERGENCY_NATURAL =
  /\b(?:(?:my\s+)?(?:urine\s+(?:ketone\s+)?test|pee\s+stick)\s+(?:showed|shows|said|says|read|reads)\s+(?:\+{3,}|(?:3|4)\s*\+|large)|(?:my\s+)?urine\s+ketones?\s+(?:are|show|shows|read|reads)?\s*(?:3|4|three|four)\s+pluses|there\s+(?:is|are)\s+(?:a\s+)?large\s+amount\s+of\s+ketones?\s+in\s+my\s+urine)(?=\s|$|[,.!?;:])/i;
const URINE_KETONE_EMERGENCY_DIP =
  /\b(?:my\s+)?urine\s+(?:ketone\s+)?dip\s+(?:is|was|reads?|shows?|returned)\s+(?:\+{3,}|(?:3|4)\s*\+|(?:three|four)\s+plus(?:es)?|large)(?=\s|$|[,.!?;:])/i;
const URINE_KETONE_POSITIVE_RESULT =
  /\b(?:my\s+)?(?:urine(?:\s+ketone)?(?:\s+test)?\s+strip|urine\s+ketones?)(?:\s+(?:are|is|show|shows|read|reads|say|says|came\s+back(?:\s+(?:at|as))?)|\s*[:=])?\s*(?:2\s*\+|two\s+plus|plus\s+plus)(?:\s+ketones?)?(?=\s|$|[,.!?;:])/i;
const WORD_DIGIT_VALUES: Readonly<Record<string, number>> = {
  oh: 0,
  naught: 0,
  nought: 0,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const KETONE_CONTEXT_LANGUAGE =
  /\bketones?\b|\b(?:urine|wee|pee)(?:\s+ketone)?\s+(?:test(?:\s+strip)?|strip|stick|dip|dipstick|result|reading)\b|\b(?:ketostix|urinalysis|urine\s+analysis)\b|\bblood\s+ketone\s+(?:meter|result)\b/i;
const CURRENT_LARGE_KETONES =
  /\b(?:ketones?\s*(?:are|is|show|shows|read|reads|say|says|[:=])?\s*(?:\+{2,}(?:\s|$)|large\b|moderate\b)|(?:large|moderate)\s+(?:urine\s+)?ketones?\b)/i;
const CURRENT_EMERGENCY_KETONES =
  /(?:\b(?:urine\s+)?ketones?(?:\s+(?:are|is|show|shows|read|reads|say|says)|\s*[:=])?\s*(?:\+{3,}|(?:3|4)\s*\+|(?:over|above|more than)\s*2\s*\+)(?=\s|$|[,.!?;:])|\b(?:large|very high)\s+(?:urine\s+)?ketones?\b|\b(?:urine\s+)?ketones?(?:\s+(?:are|is|show|shows|read|reads|say|says))?\s+(?:large|very high)\b)/i;
const OVER_THREE_KETONES =
  /\b(?:ketones?|blood ketones?)(?:\s+(?:are|is|show|shows|read|reads|say|says))?\s+(?:over|above|greater than|more than)\s*3(?:[.,]0+)?\b/i;
const ILL_WITH_KETONES =
  /\b(?:i(?:'m| am| feel)\s+(?:ill|poorly|unwell|sick)|i\s+have\s+(?:the\s+)?flu)\b[\s\S]{0,50}\bketones?\b/i;
const CURRENT_GENERAL_ILLNESS =
  /\bi(?:'m| am| feel)\s+(?:ill|poorly|unwell|sick)\b/i;
const RESOLVED_NOW =
  /\b(?:normal|fine|okay|ok|all right|alright|better|well|recovered|awake|conscious|resolved|gone|clear|cleared)\s+now\b|\bnow\s+(?:normal|fine|okay|ok|all right|alright|better|well|recovered|awake|conscious|resolved|gone|clear|cleared)\b|\bnot\s+(?:unconscious|unresponsive|confused|drowsy|vomiting|being sick|breathless)\s+(?:anymore|any longer)\b/i;
const FIRST_PERSON_RESOLVED_EVENT =
  /\bi\s+(?:was|had|had been|have been|felt)\b[\s\S]{0,80}\b(?:sick|vomit(?:ing|ed)?|throwing up|being sick|been sick|stomach (?:pain|ache)|abdominal (?:pain|ache)|tummy (?:pain|ache)|dehydrated|hyperventilating|confused|drowsy|unconscious|unresponsive|breathless|unable to breathe|not breathing|passed out|fainted|had (?:a )?(?:fit|seizure))\b[\s\S]{0,100}\b(?:but|however|although)\b[\s\S]{0,40}\bi(?:'m| am)\s+(?:normal|fine|okay|ok|all right|alright|better|well|recovered|awake|conscious)\s+now\b/i;
const OTHER_PERSON_RESOLVED_EVENT =
  /\b(?:my|our)\s+(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|niece|nephew|grandson|granddaughter)(?:\s+with\b[\s\S]{0,30})?\s+(?:was|had|had been|has been|used to)\b[\s\S]{0,80}\b(?:sick|vomit(?:ing|ed)?|throwing up|being sick|been sick|stomach (?:pain|ache)|abdominal (?:pain|ache)|tummy (?:pain|ache)|dehydrated|hyperventilating|confused|drowsy|unconscious|unresponsive|breathless|unable to breathe|not breathing|passed out|fainted|had (?:a )?(?:fit|seizure))\b[\s\S]{0,100}\b(?:but|however|although)\b[\s\S]{0,35}\b(?:(?:he|she|they)(?:'s| is| are)\s+|(?:is|are)\s+)?(?:normal|fine|okay|ok|all right|alright|better|well|recovered|awake|conscious)\s+now\b/i;
const OTHER_PERSON_CURRENT_RESOLVED_EVENT =
  /\b(?:my|our)\s+(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|niece|nephew|grandson|granddaughter)(?:\s+with\b[\s\S]{0,35})?\s+(?:is|has|feels?|keeps?)\b[\s\S]{0,70}\b(?:sick|vomit(?:ing|ed)?|throwing up|being sick|stomach (?:pain|ache)|abdominal (?:pain|ache)|tummy (?:pain|ache)|dehydrated|hyperventilating|confused|drowsy|unconscious|unresponsive|breathless)\b[\s\S]{0,80}\b(?:but|however|although)\b[\s\S]{0,35}\b(?:he|she|they)(?:'s| is| are)\s+(?:normal|fine|okay|ok|all right|alright|better|well|recovered|awake|conscious)\s+now\b/i;
const KETONE_RESULT_RESOLVED_EVENT =
  /\b(?:my\s+)?(?:(?:blood|urine)\s+)?ketones?\b[\s\S]{0,45}\b(?:was|were|read|showed|came back)\b[\s\S]{0,45}(?:\b(?:but|however|although|and)\b|;)[\s\S]{0,45}\b(?:(?:they|mine)(?:'re| are)|(?:ketones?\s+)?(?:are|is)|now)\b[\s\S]{0,20}\b(?:normal|negative|none|zero|gone|clear|cleared|0(?:[.,]\d+)?)(?:\s+now)?\b/i;
const GLUCOSE_RESOLVED_EVENT =
  /(?:\b(?:my\s+)?(?:glucose|blood sugar|sugar|reading|sensor|meter|cgm)\b[\s\S]{0,25}\bwas\s+(?:lo|low|hi|high)\b[\s\S]{0,60}\b(?:but|however|although|and)\b[\s\S]{0,30}\b(?:normal|fine|okay|ok|back\s+in\s+range)\s+now\b|\b(?:my\s+)?(?:glucose|blood sugar|sugar|reading|sensor|meter|cgm)\b[\s\S]{0,15}\b(?:is\s+)?no\s+longer\s+(?:lo|low|hi|high)\b)/i;
const KETONE_READING_HISTORICAL_CORRECTION =
  /\b(?:my\s+)?(?:(?:blood|urine)\s+)?ketones?\s+(?:are|is|read|show)\s+(?:[<>]=?\s*)?\d+(?:[.,]\d+)?\b[\s\S]{0,30}\bbut\s+that\s+was\s+(?:yesterday|earlier|last\s+(?:night|week|month))\b/i;
const BREATHING_RESTORED_EVENT =
  /\b(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague)\s+(?:stopped|wasn't|was not)\s+breathing\b[\s\S]{0,80}\b(?:but|however|although)\b[\s\S]{0,30}\b(?:(?:he|she|they)(?:'s| is| are)\s+|(?:is|are)\s+)?breathing\s+now\b/i;
const STILL_KETONE_DANGER =
  /\bketones?\b[\s\S]{0,80}\bstill\s+(?:high|large|positive|present|are|is|have|do)\b/i;
const HYPOTHETICAL_REVIEWED_KETONES =
  /(?:\b(?:nice|sick[- ]?day|rules?|guidance)\b[\s\S]{0,100}\b(?:if|when|whenever)\b[\s\S]{0,80}\bketones?\b|\b(?:if|when|whenever)\b[\s\S]{0,80}\bketones?\b[\s\S]{0,100}\b(?:nice|sick[- ]?day|rules?|guidance)\b)/i;
const KETONE_EDUCATION_QUESTION =
  /(?:\b(?:what (?:does (?:(?:nice|nhs|the nhs|guidance) say about)|are|is|if)|can you explain|tell me about|according to (?:nice|nhs|the nhs|guidance))\b[\s\S]{0,80}\b(?:high|large|moderate)?\s*(?:blood\s+|urine\s+)?ketones?\b|\bwhat\s+(?:do|does)\b[\s\S]{0,60}\bketones?\b[\s\S]{0,30}\bmean\b|\b(?:can you )?explain\b[\s\S]{0,60}\b(?:when|if)\b[\s\S]{0,60}\bketones?\b)/i;
const GENERAL_KETONE_EDUCATION =
  /^\s*(?:(?:why\s+are|are)\b[\s\S]{0,70}\bketones?\b[\s\S]{0,35}\bdangerous\b|(?:does|do)\s+(?:nice|(?:the\s+)?nhs|guidance)\s+say\b[\s\S]{0,80}\bketones?\b)/i;
const GENERAL_KETONE_HYPOTHETICAL =
  /^\s*(?:if|when|whenever|suppose|imagine|hypothetically|for\s+(?:training|education)|in\s+(?:(?:an?|this|the)\s+)?(?:(?:hypothetical\s+)?example|case\s+study))\b/i;
const EXPLICITLY_ABSENT_KETONES =
  /\b(?:no|without)\s+(?:(?:high|large|moderate)\s+)?(?:urine\s+)?ketones?\b(?!\s+(?:strips?|tests?|meter|dipsticks?))|\b(?:i|he|she|they)\s+(?:do not|don't|does not|doesn't)\s+have\s+(?:(?:high|large|moderate)\s+)?(?:urine\s+)?ketones?\b(?!\s+(?:strips?|tests?|meter|dipsticks?))|\b(?:urine\s+)?ketones?\s+(?:are|is|read|reads|show|shows)?\s*(?:normal|negative|none|zero)\b/i;
const IMMINENT_LOSS_OF_CONSCIOUSNESS =
  /\b(?:i think i(?:'m| am) going to|i(?:'m| am) about to|i feel like i (?:might|may|could))\s+(?:pass out|faint|black out)\b/i;
const URGENT_KETONE_ACTION =
  /\b(?:what (?:do|should|can) i (?:do|take)|what do i need to do|how (?:do|should|can) i (?:treat|manage|handle|lower|clear)|help(?: me)?(?: with)?)\b[\s\S]{0,70}\b(?:high\s+)?ketones?\b|\b(?:high\s+)?ketones?\b[\s\S]{0,70}\b(?:what (?:do|should|can) i (?:do|take)|help(?: me)?)\b/i;
const DKA_LANGUAGE = /\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b/i;
const DKA_TERM = "(?:dka|diabetic\\s+ketoacidosis|ketoacidosis)";
const CLOSE_OTHER =
  "(?:my|our)\\s+(?:adult\\s+)?(?:son|daughter|child|kid|boy|girl|baby|infant|toddler|pre[- ]?schooler|adolescent|minor|youth|teen|teenager|young\\s+person|niece|nephew|grandson|granddaughter|partner|husband|wife)";
const CHILD_SUBJECT =
  "(?:my|our)\\s+(?:(?:little|young|teenage|teen)\\s+(?:boy|girl|son|daughter|niece|nephew)|little\\s+one|boy|girl|son|daughter|child|kid|baby|infant|toddler|pre[- ]?schooler|adolescent|minor|youth|teen|teenager|young\\s+person|niece|nephew|grandson|granddaughter|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)[- ]year[- ]old(?:\\s+(?:boy|girl|son|daughter|child|kid|niece|nephew))?|\\d{1,2}(?:(?:[- ]year[- ]old|\\s*yo)(?:\\s+(?:boy|girl|son|daughter|child|kid|niece|nephew))?))";
const EXPLICIT_ADULT_RELATION_LANGUAGE =
  /\b(?:my|our)\s+(?:adult\s+(?:son|daughter|child)|(?:son|daughter|child)\s+(?:aged?\s+(?:1[89]|[2-9]\d|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)|is\s+(?:1[89]|[2-9]\d))|(?:1[89]|[2-9]\d)[- ]year[- ]old\s+(?:son|daughter|child))\b/i;
const EXPLICIT_ADULT_RELATION_DKA_CONCERN =
  /\b(?:my|our)\s+(?:(?:adult|(?:1[89]|[2-9]\d)[- ]year[- ]old)\s+(?:son|daughter|child)|(?:son|daughter|child)\s+(?:aged?\s+(?:1[89]|[2-9]\d|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)|is\s+(?:1[89]|[2-9]\d)))\b[\s\S]{0,50}\b(?:has|may\s+have|might\s+have|could\s+have|is\s+in|might\s+be\s+in)\s+(?:dka|diabetic ketoacidosis|ketoacidosis)\b/i;
const EXPLICIT_ADULT_DESCRIPTOR_LANGUAGE =
  /\b(?:my|our)\s+(?:(?:adult|grown[- ]up|grown)\s+(?:son|daughter|child|kid)|(?:son|daughter|child|kid|niece|nephew|grandson|granddaughter|young\s+person)\s+(?:who\s+(?:is|just\s+turned)|is|aged?|over|older\s+than)\s+(?:18|eighteen))\b/i;
const SUBJECT_DKA_CONCERN_LANGUAGE =
  /\b(?:has(?:\s+got)?|may\s+have|might\s+have|could\s+have|is\s+(?:in|going\s+into|developing)|may\s+be\s+(?:in|going\s+into|developing)|might\s+be\s+(?:in|going\s+into|developing)|could\s+be\s+(?:in|going\s+into|developing))\s+(?:dka|diabetic\s+ketoacidosis|ketoacidosis)\b/i;
const KNOWN_DIABETES =
  /\b(?:type\s*1(?:\s+diabetes)?|type one(?:\s+diabetes)?|t1d|t1(?!\s*arc\b)|diabetic|known diabetes|has diabetes|have diabetes|with diabetes)\b/i;
const PERSONAL_HEALTH_SUBJECT =
  /\b(?:i|my|our|he|she|they|someone|somebody|a person|the person|the patient)\b/i;
const NAMED_HEALTH_SUBJECT_ASSERTION =
  /\b[A-Z][a-z]{1,30}\b[\s\S]{0,45}\b(?:is|has|feels|says|cannot|can't|keeps)\b/;
const DESCRIBED_HEALTH_SUBJECT_ASSERTION =
  /\b(?:(?:my|our)\s+(?:teenager|teen|nephew|niece|grandson|granddaughter|boy|girl|young person|\d{1,2}(?:\s*yo|[- ]year[- ]old)?)|the\s+(?:child|young person|teenager|patient))\b[\s\S]{0,45}\b(?:is|has|feels|says|cannot|can't|keeps)\b/i;
const HISTORICAL_DKA_REQUEST =
  /\b(?:was that|were those|did i have|have i had|could i have had|might i have had|was i in|i (?:had|thought i had|suspected i had|was in|was diagnosed with))\b[\s\S]{0,70}\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b/i;
const EXPLICITLY_NEGATED_DKA =
  /\b(?:i|he|she|they|my (?:son|daughter|child|partner|husband|wife))\s+(?:(?:do not|does not|don't|doesn't)\s+(?:have|think|believe|suspect|fear|worry)|(?:am|is|are)\s+not\s+(?:in|developing|going into)|(?:have|has)\s+not\s+(?:got\s+)?)\b[\s\S]{0,35}\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b|\b(?:no|without)\s+(?:signs?|symptoms?|evidence|concern|suspicion)\s+of\s+(?:dka|diabetic ketoacidosis|ketoacidosis)\b|\b(?:my\s+)?(?:symptoms?|signs?)\s+(?:do not|don't|does not|doesn't)\s+(?:suggest|indicate|look like|point to)\b[\s\S]{0,20}\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b|\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b[\s\S]{0,20}\b(?:ruled out|excluded)\b/i;
const DKA_RULED_OUT =
  /\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b[\s\S]{0,24}\b(?:ruled out|excluded)\b|\b(?:hospital|doctor|clinician|diabetes team)\b[\s\S]{0,30}\b(?:ruled out|excluded)\b[\s\S]{0,20}\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b/i;
const CLEAR_DKA_EDUCATION =
  /^\s*(?:what\s+(?:is|are\s+the\s+(?:signs|symptoms)\s+of|does\s+(?:(?:possible|probable|suspected)\s+)?(?:dka|diabetic ketoacidosis|ketoacidosis)\s+(?:mean|look like)|does\s+(?:nice|the\s+nhs|nhs|guidance)\s+say|are\s+(?:the\s+)?(?:nice|nhs)\s+sick[- ]?day\s+rules)|how\s+does|why\s+does|can\s+you\s+explain|tell\s+me\s+about|help\s+me\s+understand|according\s+to\s+(?:nice|the\s+nhs|nhs|guidance)|in\s+(?:a\s+)?(?:hypothetical|example|case\s+study)|for\s+(?:training|education))\b/i;
const CLEAR_DKA_HYPOTHETICAL =
  /^\s*(?:if|when|whenever|suppose|imagine|for\s+(?:training|education))\b|\b(?:hypothetically|in\s+(?:(?:an?|this|the)\s+)?(?:(?:hypothetical\s+)?example|case\s+study))\b/i;
const CLEAR_MEDICAL_GUIDANCE_WRAPPER =
  /^\s*(?:what\s+does\s+(?:nice|the\s+nhs|nhs)(?:\s+guidance)?\s+say|what\s+does\s+guidance\s+say|what\s+are\s+(?:the\s+)?(?:nice\s+|nhs\s+)?sick[- ]?day\s+rules|what\s+if\b|what\s+should\s+i\s+do\s+if\b|(?:generally\s*,?\s*)?what\s+(?:should|do|can)\s+(?:you|someone|a\s+person)\b[\s\S]{0,40}\bdo\s+if|what\s+should\s+i\s+do\s+if\s+(?:someone|somebody|a\s+person|the\s+patient)\b|(?:can|could)\s+you\s+explain\b[\s\S]{0,50}\bif|(?:explain|describe)\b[\s\S]{0,50}\bwhat\s+to\s+do\s+if|when\s+(?:someone|somebody|a\s+person|the\s+patient)\b|according\s+to\s+(?:(?:nice|(?:the\s+)?nhs)(?:\s+guidance)?|guidance)|for\s+(?:training|education|teaching\s+purposes)|in\s+(?:a\s+)?(?:training\s+scenario|first[- ]aid\s+(?:exercise|guide)|guide)\b|(?:educational|training)\s+example\b|this\s+is\s+an\s+example\b|i(?:'m|\s+am)\s+writing\s+(?:a\s+)?first[- ]aid\s+guide\b|research\s+says\b|(?:a|the)\s+textbook\s+says\b|(?:a|an|the)\s+hypothetical\s+(?:patient|person|case|example)\b|(?:a|an|the|this)\s+example\b|(?:a|the|this)\s+case\s+study\b|in\s+(?:(?:an?|this|the)\s+)?(?:(?:hypothetical\s+)?example|case\s+study))\b|\b(?:in\s+(?:(?:an?|this|the)\s+)?(?:hypothetical\s+)?example|(?:a|the|this)\s+case\s+study)\b/i;
const GENERAL_EDUCATIONAL_WRAPPER =
  /^\s*(?:generally\b|what\s+should\s+(?:a|the)\s+(?:child|young person)\b[\s\S]{0,45}\bdo\s+if|in\s+(?:a\s+)?(?:first[- ]aid\s+exercise|training\s+scenario|film|fictional\s+case|hypothetical\s+case)\b|my\s+first[- ]aid\s+course\s+says\b|an?\s+article\s+says\b|(?:(?:the\s+)?nice|(?:the\s+)?nhs)(?:\s+guidance)?\s+says\b|for\s+teaching\s+purposes\b|(?:educational|training)\s+example\b|case\s+study\b|this\s+is\s+an\s+example\b|(?:a|the)\s+textbook\s+says\b|in\s+a\s+guide\b)/i;
const STRICT_FICTIONAL_EDUCATIONAL_WRAPPER =
  /^\s*in\s+(?:a\s+)?(?:film|fictional\s+case|hypothetical\s+case)\b/i;
const GENERAL_IMMEDIATE_EDUCATION =
  /^\s*(?:what\s+(?:is|are)\s+(?:an?\s+)?(?:seizure|fit|convulsion|loss\s+of\s+consciousness)|what\s+does\s+(?:unconscious|unresponsive)\s+mean)\b/i;
const EXPLICIT_REAL_CURRENT_OVERRIDE =
  /(?:\b(?:but|however|although)\b[\s\S]{0,80}|(?:^|[.!?]\s*)(?:actually\s+)?)(?:this|it|that)\s+(?:is|'s)(?:\s+actually)?\s+(?:happening|current|real)\b[\s\S]{0,20}\bnow\b/i;
const EXPLICIT_PERSONAL_PRESENT_ASSERTION =
  /\b(?:i(?:'m| am)\b|i\s+(?:have|feel|cannot|can't|won't|will not|may|might|could)\b|(?:he|she|they)(?:'s|'re|\s+(?:is|are|has|have|feels?|keeps?|cannot|can't|won't|will not|may|might|could))\b|(?:(?:my|our)\s+)?(?:mum|mom|mother|dad|father|brother|sister|child|kid|son|daughter|wife|husband|partner|friend|colleague|niece|nephew|grandson|granddaughter)(?:\s+with\b[\s\S]{0,35})?\s+(?:is|are|has|have|feels?|keeps?|smells?|cannot|can't|won't|will not|may|might|could)\b|(?:my|our)\s+(?:breath|blood\s+ketones?|urine\s+ketones?|ketones?)\s+(?:is|are|has|have|smells?)\b)/i;
const EXPLICIT_CURRENT_TIME =
  /\b(?:now|right now|currently|at the moment|just now)\b/i;
const AMBIGUOUS_CURRENT_HEALTH_READING =
  /^\s*(?:(?:mine|they)\s+(?:are|read|show)|they're|(?:it\s+is|it's)|the\s+reading\s+(?:is|reads|shows))\s+(?:[<>]=?|[≥≤])?\s*(?:\d+(?:[.,]\d+)?|\+{2,}|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+point\s+(?:oh|zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:oh|zero|one|two|three|four|five|six|seven|eight|nine))*)?)(?:\s*(?:mmol(?:\/l)?|\+|plus))?(?:\s+(?:now|right now|currently|at the moment))?\s*[.!?]?\s*$/i;
const AMBIGUOUS_SPOKEN_HEALTH_READING =
  /^\s*(?:(?:mine|they|it|the\s+reading)\s+(?:is|are|reads?|shows?)\s+)?(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:point|dot|decimal|comma)\s+(?:oh|nought|naught|zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:oh|nought|naught|zero|one|two|three|four|five|six|seven|eight|nine))*\s*[.!?]?\s*$/i;
const PAST_DKA_GRAMMAR =
  /\b(?:did\s+i\s+have|could\s+i\s+have\s+had|might\s+i\s+have\s+had|was\s+i\s+in|i\s+(?:had|thought\s+i\s+had|suspected\s+i\s+had|was\s+in|was\s+diagnosed\s+with)|my\s+(?:son|daughter|child|partner|husband|wife)\s+(?:had|was\s+in|was\s+diagnosed\s+with)|my\s+(?:doctor|clinician|diabetes\s+(?:doctor|team))\s+suspected)\b[\s\S]{0,40}\b(?:dka|diabetic ketoacidosis|ketoacidosis)\b/i;
const PRESENT_DKA_CONCERN = new RegExp(
  [
    `\\b(?:do|can|could|may|might)\\s+i\\s+(?:have|be\\s+(?:in|going\\s+into|developing))\\s+${DKA_TERM}\\b`,
    `\\bam\\s+i\\s+(?:in|going\\s+into|developing)\\s+${DKA_TERM}\\b`,
    `\\bi(?:'m|\\s+am)\\s+(?:in|going\\s+into|developing)\\s+${DKA_TERM}\\b`,
    `\\bi\\s+(?:may|might|could)\\s+(?:have|be\\s+(?:in|going\\s+into|developing))\\s+${DKA_TERM}\\b`,
    `\\bi\\s+(?:have(?:\\s+got)?(?:\\s+(?:possible|probable|suspected))?|am\\s+(?:in|going\\s+into|developing))\\s+${DKA_TERM}\\b`,
    `\\bi(?:'ve|\\s+have)\\s+got\\s+${DKA_TERM}\\b`,
    `\\bi(?:'m|\\s+am)\\s+(?:worried|concerned)\\b[\\s\\S]{0,35}\\bi(?:'ve|\\s+have)\\s+got\\s+${DKA_TERM}\\b`,
    `\\bi\\s+(?:think|believe|fear|worry)(?:\\s+that)?\\s+(?:i\\s+have|i(?:'m|\\s+am)\\s+(?:in|going\\s+into|developing)|this\\s+is)\\s+${DKA_TERM}\\b`,
    `\\bi\\s+(?:think|believe|fear|worry|am\\s+scared)(?:\\s+that)?\\s+(?:it|this)\\s+(?:is|'s|may\\s+be|might\\s+be|could\\s+be)\\s+${DKA_TERM}\\b`,
    `\\bi(?:'m|\\s+am)\\s+scared(?:\\s+that)?\\s+(?:it|this)\\s+(?:is|'s|may\\s+be|might\\s+be|could\\s+be)\\s+${DKA_TERM}\\b`,
    `\\bi\\s+suspect(?:\\s+(?:that\\s+)?i\\s+have)?\\s+${DKA_TERM}\\b`,
    `\\bi\\s+(?:do\\s+not|don't)\\s+know\\s+(?:if|whether)\\s+i\\s+(?:have|am\\s+in)\\s+${DKA_TERM}\\b`,
    `\\b(?:maybe|perhaps|possibly|probably)\\s+i\\s+(?:have|am\\s+in)\\s+${DKA_TERM}\\b`,
    `\\bi\\s+(?:have|am\\s+showing)\\s+(?:symptoms?|signs?)\\s+of\\s+${DKA_TERM}\\b`,
    `\\bmy\\s+(?:symptoms?|signs?)\\s+(?:suggest|look\\s+like|could\\s+be|may\\s+be|might\\s+be)\\s+${DKA_TERM}\\b`,
    `\\b${CLOSE_OTHER}\\s+(?:(?:may|might|could)\\s+(?:have|be\\s+(?:in|going\\s+into|developing))|has(?:\\s+got)?(?:\\s+(?:possible|probable|suspected))?|is\\s+(?:in|going\\s+into|developing)|(?:thinks|believes|suspects)\\s+(?:they|he|she)?\\s*(?:have|has|are\\s+in|is\\s+in))\\s+${DKA_TERM}\\b`,
    `\\b(?:he|she|they)\\s+(?:(?:may|might|could)\\s+(?:have|be\\s+(?:in|going\\s+into|developing))|has(?:\\s+got)?(?:\\s+(?:possible|probable|suspected))?|is\\s+(?:in|going\\s+into|developing))\\s+${DKA_TERM}\\b`,
    `\\b(?:i\\s+think\\s+)?${CLOSE_OTHER}\\s+(?:has|may\\s+have|might\\s+have|could\\s+have|is\\s+in|may\\s+be\\s+in)\\s+${DKA_TERM}\\b`,
    `\\bmy\\s+(?:doctor|clinician|diabetes\\s+(?:doctor|team))\\s+(?:suspects?|thinks?|believes?)\\b[\\s\\S]{0,20}\\b${DKA_TERM}\\b`,
    `\\b(?:this|these\\s+symptoms?|my\\s+symptoms?)\\s+(?:is|are|may\\s+be|might\\s+be|could\\s+be|looks?\\s+like|suggests?)\\s+${DKA_TERM}\\b`,
    `\\b(?:is|can|could|may|might)\\s+(?:this|it|these\\s+symptoms?|my\\s+symptoms?)\\s+(?:be\\s+)?${DKA_TERM}\\b`,
    `\\b(?:do|does)\\s+(?:this|it|these\\s+symptoms?|my\\s+symptoms?)\\s+(?:mean|look\\s+like|suggest)\\s+${DKA_TERM}\\b`,
    `\\bare\\s+(?:these|my)\\s+symptoms?\\s+${DKA_TERM}\\b`,
  ].join("|"),
  "i",
);
const DKA_SHORTHAND = new RegExp(
  `(?:^|\\b)(?:(?:maybe|perhaps|possible|probable|suspected)\\s+${DKA_TERM}|^\\s*(?:could|may|might)\\s+be\\s+${DKA_TERM}|(?:help(?:\\s+me)?|i\\s+need\\s+help)\\b[\\s\\S]{0,20}\\b${DKA_TERM}|${DKA_TERM}\\s+(?:now|right\\s+now|currently|help(?:\\s+me)?))\\b`,
  "i",
);
const CURRENT_DKA_DIAGNOSIS = new RegExp(
  `\\b(?:(?:(?:i|he|she|they|${CLOSE_OTHER})\\s+(?:was|were)\\s+diagnosed|i(?:'ve|\\s+have)\\s+been\\s+diagnosed|(?:the\\s+)?(?:doctor|clinician|diabetes\\s+(?:doctor|team))\\s+diagnosed\\s+me)\\s+with\\s+${DKA_TERM}[\\s\\S]{0,30}(?:today|now|this\\s+(?:morning|afternoon|evening))|i\\s+was\\s+told\\s+(?:today\\s+)?(?:that\\s+)?(?:it(?:'s|\\s+is)|i\\s+have)\\s+${DKA_TERM})\\b`,
  "i",
);
const DKA_ANAPHORIC_CURRENT =
  /\b(?:(?:i\s+(?:think|believe|fear|worry|suspect)(?:\s+that)?\s+(?:i\s+have|i(?:'ve| have)\s+got)|i\s+(?:may|might|could)\s+have|my\s+(?:doctor|clinician|diabetes\s+(?:doctor|team))\s+(?:thinks?|believes?|suspects?)\s+(?:that\s+)?i\s+have)\s+it(?:\s+again)?\s+(?:now|right now|currently|at the moment)|i(?:'ve|\s+have)\s+got\s+it\s+again|(?:this|it|that)\s+(?:is|'s)(?:\s+actually)?\s+happening\s+(?:right\s+)?now[\s\S]{0,60}\bi\s+(?:may|might|could)\s+have\s+it)\b/i;
const EXPLICIT_PRESENT_DKA_DECLARATION = new RegExp(
  `\\b(?:i\\s+have|i(?:'m|\\s+am)\\s+(?:in|going\\s+into|developing)|i(?:'ve|\\s+have)\\s+(?:got|gone\\s+into)|(?:he|she|they)\\s+(?:has|have|is\\s+in|are\\s+in)|${CLOSE_OTHER}\\s+(?:has|is\\s+in))\\s+${DKA_TERM}\\b(?!\\s+(?:symptoms?|signs?|risk))`,
  "i",
);
const DKA_UNCERTAINTY =
  /\b(?:think|believe|fear|worry|worried|concerned|suspect|may|might|could|possibly|possible|probably|probable|perhaps|maybe|don't know|do not know)\b/i;
const CURRENT_CHILD_DKA = new RegExp(
  `\\b${CHILD_SUBJECT}\\b[\\s\\S]{0,70}\\b${DKA_TERM}\\b`,
  "i",
);
const CHILD_SUBJECT_LANGUAGE = new RegExp(`\\b${CHILD_SUBJECT}\\b`, "i");
const CURRENT_CHILD_DKA_ASSERTION = new RegExp(
  `\\b${CHILD_SUBJECT}\\b[\\s\\S]{0,35}\\b(?:(?:has|is\\s+(?:in|going\\s+into|developing))|(?:may|might|could)\\s+(?:have|be\\s+(?:in|going\\s+into|developing)))\\s+${DKA_TERM}\\b`,
  "i",
);
const CHILD_DKA_ANAPHORIC_CURRENT = new RegExp(
  `(?:\\b${CHILD_SUBJECT}\\b[\\s\\S]{0,35}\\b(?:has|may\\s+have|might\\s+have|could\\s+have)\\s+it|\\b(?:he|she|they)\\s+(?:(?:may|might|could)\\s+have|has|have)\\s+it)(?:\\s+again)?(?:\\s+(?:now|right\\s+now|currently|at\\s+the\\s+moment))?\\b`,
  "i",
);
const EXPLICIT_CURRENT_DKA =
  /\b(?:now|right now|currently|at the moment|please help|help me|i need help)\b|\bsince\s+(?:yesterday|last (?:night|week)|earlier|\d+\s+(?:minutes?|hours?|days?)\s+ago)\b|\b(?:and\s+)?still\s+(?:have|has|am|is|are)\b/i;
const DKA_SYMPTOM =
  /\b(?:thirsty|very thirsty|extreme thirst|thirstier than usual|peeing (?:a lot|frequently|more)|urinating (?:a lot|frequently|more)|frequent urination|stomach (?:pain|ache)|abdominal (?:pain|ache)|tummy (?:pain|ache|hurts)|sore tummy|feeling sick|feels? sick|queasy|was sick|been sick|nausea|nauseous|nauseated|vomit(?:ing|ed)?|throwing up|threw up|being sick|can't keep (?:anything|food|fluids?|liquids?|water|drinks?) down|cannot keep (?:anything|food|fluids?|liquids?|water|drinks?) down|unable to keep (?:anything|food|fluids?|liquids?|water|drinks?) down|diarrh(?:oe|e)a|dehydrat(?:ed|ion)|hyperventilat(?:ing|ion)|deep breathing|breathing deeply|breathing (?:(?:very|really)\s+)?(?:fast|quickly|rapidly)|rapid breathing|taking (?:(?:very|really)\s+)?(?:deep|rapid|fast|quick) breaths|fruity(?:[- ]smelling)? breath|pear[- ]drop breath|(?:acetone|nail polish remover) breath|breath (?:is|smells?) fruity|breath smells (?:like|of) (?:pear drops|acetone|nail polish remover)|very tired|extremely tired|very sleepy|extremely sleepy|feel(?:ing)? sleepy|sleepy|drowsy|confused|reduced (?:level of )?consciousness|blurred vision|feel unwell|feeling unwell)\b/i;
const ADDITIONAL_DKA_SYMPTOM =
  /\b(?:belly\s+(?:pain|ache|hurts)|sore\s+(?:tummy|belly)|(?:tummy|belly)\s+(?:is\s+)?sore|puk(?:e|es|ed|ing)|looks?\s+dehydrated|kussmaul\s+breathing|labou?red\s+breathing|breathing\s+(?:really|very)\s+(?:quickly|fast|rapidly)|taking\s+(?:rapid|fast|quick)\s+breaths)\b/i;
const PRESENT_DKA_SYMPTOM_CONTEXT =
  /\b(?:i(?:'m| am| have| feel| cannot| can't| vomited| threw up)|i(?:'ve| have)\s+(?:got|been)|my\s+(?:breath|vision)|(?:he|she|they)(?:'s| is| are| has| have| feels?| looks?| seems?| says?| cannot| can't| may| might| could| vomited| threw up)|my\s+(?:son|daughter|child|kid|partner|husband|wife)\b[\s\S]{0,35}\b(?:is|has|feels?|looks?|seems?|says?|cannot|can't|is unable to|may|might|could|vomited|threw up)|and\s+(?:i(?:'m| am| have| feel)|is|are|has|have|feels?|looks?|seems?|my\s+(?:breath|vision)))\b/i;
const DKA_SYMPTOM_CATEGORIES = [
  /\b(?:thirsty|extreme thirst|thirstier than usual|peeing (?:a lot|frequently|more)|urinating (?:a lot|frequently|more)|frequent urination)\b/i,
  /\b(?:feeling sick|feels? sick|queasy|was sick|been sick|nausea|nauseous|nauseated|vomit(?:ing|ed)?|throwing up|threw up|being sick|can't keep (?:anything|food|fluids?|liquids?|water|drinks?) down|cannot keep (?:anything|food|fluids?|liquids?|water|drinks?) down|unable to keep (?:anything|food|fluids?|liquids?|water|drinks?) down|diarrh(?:oe|e)a)\b/i,
  /\b(?:stomach (?:pain|ache)|abdominal (?:pain|ache)|tummy (?:pain|ache|hurts)|sore tummy)\b/i,
  /\b(?:hyperventilat(?:ing|ion)|deep breathing|breathing deeply|breathing (?:(?:very|really)\s+)?(?:fast|quickly|rapidly)|rapid breathing|taking (?:(?:very|really)\s+)?(?:deep|rapid|fast|quick) breaths)\b/i,
  /\b(?:fruity(?:[- ]smelling)? breath|pear[- ]drop breath|(?:acetone|nail polish remover) breath|breath (?:is|smells?) fruity|breath smells (?:like|of) (?:pear drops|acetone|nail polish remover))\b/i,
  /\b(?:very tired|extremely tired|very sleepy|extremely sleepy|feel(?:ing)? sleepy|sleepy|drowsy|confused|reduced (?:level of )?consciousness|blurred vision)\b/i,
  /\bdehydrat(?:ed|ion)\b/i,
] as const;
const HIGH_SPECIFICITY_DKA_SYMPTOM =
  /\b(?:fruity(?:[- ]smelling)? breath|pear[- ]drop breath|(?:acetone|nail polish remover) breath|breath (?:is|smells?) fruity|breath smells (?:like|of) (?:pear drops|acetone|nail polish remover))\b/i;
const HIGH_RISK_DKA_SYMPTOM =
  /\b(?:vomit(?:ing|ed)?|throwing up|being sick|been sick|stomach (?:pain|ache)|abdominal (?:pain|ache)|tummy (?:pain|ache)|dehydrat(?:ed|ion)|hyperventilat(?:ing|ion)|deep breathing|breathing deeply|breathing (?:fast|rapidly)|fruity breath|pear[- ]drop breath|acetone breath|nail polish remover breath|drowsy|sleepy|confused|reduced (?:level of )?consciousness|can't keep (?:anything|food|fluids?|liquids?|water) down|cannot keep (?:anything|food|fluids?|liquids?|water) down)\b/i;
const EXPLICITLY_NEGATED_DKA_SYMPTOM =
  /\b(?:no|without|does not|doesn't|do not|don't|is not|isn't|am not|has not|hasn't|have not|haven't|never)\b[\s\S]{0,35}\b(?:thirsty|feel(?:ing|s)? sick|being sick|been sick|nausea|nauseous|nauseated|vomit(?:ing|ed)?|thrown up|abdominal (?:pain|ache)|stomach (?:pain|ache)|tummy (?:pain|ache)|hyperventilat(?:ing|ion)|breathing (?:rapidly|fast|deeply)|dehydrat(?:ed|ion)|reduced (?:level of )?consciousness|fruity breath|pear[- ]drop breath|acetone breath|nail polish remover breath)\b/i;
const NEGATED_BREATHING_MODIFIER =
  /\b(?:am|is|are)\s+not\s+breathing\s+(?:rapidly|fast|deeply)\b/i;
const CANNOT_CHECK_KETONES =
  /\b(?:i|he|she|they|my (?:son|daughter|child|partner|husband|wife))\s+(?:can't|cannot|is unable to|are unable to|am unable to)\s+(?:check|test|measure)\s+(?:(?:my|their|his|her)\s+)?ketones?\b|\bi\s+(?:have\s+)?(?:no|run\s+out\s+of|haven't\s+got|have\s+not\s+got|don't\s+have|do\s+not\s+have)\s+(?:any\s+)?(?:blood\s+|urine\s+)?ketone\s+(?:strips?|tests?|meter|dipsticks?)\b/i;
const GENERAL_DKA_EDUCATION =
  /^\s*(?:what (?:is|are the (?:signs|symptoms) of|causes)|what does (?:(?:possible|probable|suspected)\s+)?(?:dka|diabetic ketoacidosis|ketoacidosis) (?:mean|look like)|how does|why does|can you explain|tell me about|help me understand|what does nice say|for (?:training|education))\b/i;
const DEVICE_CAPABILITY_KETONE_READING =
  /^\s*(?:(?:my|the|a)\s+)?(?:blood\s+ketone\s+)?meter\s+(?:can|could|will)\s+(?:show|display|read|measure)\s+(?:blood\s+)?ketones?\s+(?:of|at)?\s*\d+(?:[.,]\d+)?(?:\s*mmol(?:\/l)?)?\s*[.!?]?\s*$/i;
const DIAGNOSIS_REQUEST =
  /\b(?:do i have|have i got|could i have|did i have|have i had|could i have had|might i have had|was i in|i think i have|i think i had|i might have|i suspect|am i developing|am i in|could i be in|i think i(?:'m| am) in|am i going into|diagnose|is this|was that|tell me whether i have)\b[\s\S]{0,60}\b(?:diabetes|dka|ketoacidosis|gastroparesis|neuropathy|retinopathy|hypoglyc(?:aemia|emia) unawareness|complication)\b|\b(?:could|can|might|does|do)\s+(?:this|that|it|these symptoms?|my symptoms?)\s+(?:be|mean|look like)\s+(?:dka|diabetic ketoacidosis|gastroparesis|neuropathy|retinopathy|a complication)\b|\bthis might be\s+(?:dka|diabetic ketoacidosis)\b|\bare\s+(?:these|my)\s+symptoms?\s+(?:dka|diabetic ketoacidosis)\b/i;
const FUTURE_PREDICTION =
  /\b(?:predict|forecast|what will|where will|going to be)\b[\s\S]{0,50}\b(?:glucose|blood sugar|sugar|reading|level)\b|\b(?:(?:will|could|might) i|am i (?:going|likely|about|headed)(?:\s+to)?|am i headed for|should i expect|do you think i(?:'ll| will))\s+(?:go|drop|fall|be|get|become|run|stay|have)?\s*(?:a\s+|too\s+)?(?:low|high|hypo|hyper|hypoglyc(?:aemic|emic)|hyperglyc(?:aemic|emic))\b|\b(?:(?:will|could|might|is)\s+(?:my\s+)?(?:glucose|blood sugar|sugar|reading|levels?)|do you think\s+(?:my\s+)?(?:glucose|blood sugar|sugar|reading|levels?)\s+will)\b[\s\S]{0,40}\b(?:going to\s+)?(?:rise|fall|drop|crash|climb|go\s+(?:low|high)|low|high|hypo|hyper|do)\b|\b(?:what(?:'s| is)\s+(?:my\s+)?(?:glucose|blood sugar|sugar|reading)\s+going to do|where(?:'s| is)\s+(?:my\s+)?(?:glucose|blood sugar|sugar|reading)\s+going)\b|\b(?:will|could)\s+(?:this|this meal|exercise)\s+(?:send|make|push|drive|spike)\s+(?:me\s+)?(?:low|high|hypo|hyper)?\b|\bis\s+(?:a\s+)?(?:low|high|hypo|hyper)\s+coming\b|\bwhat happens to\s+(?:my\s+)?(?:glucose|blood sugar|sugar|reading)\s+next\b|\bwhere is\s+(?:my\s+)?(?:glucose|blood sugar|sugar|reading)\s+heading\b|\bwill this meal\s+(?:spike|raise|drop|lower)\s+(?:me|my glucose|my blood sugar)\b/i;

const CURRENT_GLUCOSE_NUMBER =
  /\b(?:my\s+(?:glucose|blood sugar|sugar|reading|meter|sensor|cgm)(?:\s+(?:reading|level))?|(?:bg|glucose|blood sugar|libre|dexcom|cgm|xdrip|nightscout|sensor|meter|finger[- ]?prick|capillary reading))(?:\s+(?:is|was|reads?|shows?|says?))?\s+(\d+(?:[.,]\d+)?)(?:\s*mmol(?:\/l)?)?\b/i;
const CURRENT_GLUCOSE_SHORTHAND =
  /\b(?:i(?:'m| am)(?:\s+at)?|at)\s+(\d+(?:[.,]\d+)?)\b|\b(\d+[.,]\d+)\s+(?:now|and\s+(?:falling|rising))\b/i;
const CURRENT_GLUCOSE_SPOKEN =
  /(?:\b(?:my\s+)?(?:glucose|blood sugar|sugar|reading)(?:\s+(?:reading|level))?\s+(?:is|reads?|shows?)|\bi(?:'m|\s+am)|^\s*)\s*(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+point\s+(\d+|oh|zero|one|two|three|four|five|six|seven|eight|nine)(?:\s*mmol(?:\/l)?)?(?:\s+(?:now|currently|right now|at the moment))?\b/i;
const CURRENT_ANAPHORIC_GLUCOSE_NUMBER =
  /^(?:(?:(?:now|today)\s+)?it\s+is(?:\s+now)?|(?:the\s+)?current\s+reading\s+(?:is|reads?|shows?)|is)\s+(\d+(?:[.,]\d+)?)(?:\s+again)?(?:\s+now)?\b/i;
const CURRENT_LOW_TEXT =
  /\b(?:my\s+)?(?:libre|dexcom|cgm|xdrip|nightscout|sensor|meter|bg|glucose|blood sugar|reading|finger[- ]?prick|capillary reading)(?:\s+(?:is|was|reads?|shows?|says?))?\s+(?:lo|low|hi|high)\b/i;
const HISTORICAL_TIME_CONTEXT =
  /\b(?:yesterday|last (?:night|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening|night))?|earlier|previously|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago|(?:on|from)\s+(?:(?:last|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|from\s+yesterday|on\s+(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?:\s+(?:january|february|march|april|may|june|july|august|september|october|november|december))?|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/i;
const PAST_KETONE_VALUE_GRAMMAR =
  /\b(?:blood\s+|urine\s+)?ketones?\b[\s\S]{0,30}\b(?:was|were)\b/i;
const CURRENT_GLUCOSE_CONTINUATION =
  /\b(?:now|currently|right now|at the moment|today|still|again)\b/i;
const CURRENT_GLUCOSE_AFTER_HISTORY =
  /\b(?:libre|dexcom|cgm|sensor|meter|bg|glucose|blood sugar|reading)\b[\s\S]{0,120}?\b(?:but|however|although)\b(?:[\s\S]{0,30}?\b(\d+(?:[.,]\d+)?)\s+again\s+now\b|\s*now\s+(?:it\s+)?(?:is|reads?|shows?)?\s*(\d+(?:[.,]\d+)?)\b)/i;
const INSULIN_NOT_LOWERING_HIGH_GLUCOSE =
  /(?=[\s\S]*(?:\b(?:my\s+)?(?:glucose|blood sugar)(?:\s+(?:reading|level))?(?:\s+(?:is|reads?|shows?|of))?\s+(?:still\s+)?(?:high|19[.,]9|(?:2\d|[3-9]\d)(?:[.,]\d+)?|nineteen\s+point\s+nine|twenty)\b|\bhigh\s+(?:glucose|blood sugar)\b))(?=[\s\S]*\b(?:insulin|correction)\b)(?:[\s\S]*\b(?:insulin|correction)\b[\s\S]{0,100}\b(?:isn't|is not|doesn't|does not|won't|will not|hasn't|has not|not)\b[\s\S]{0,45}\b(?:bring(?:ing)?\s+(?:my\s+)?(?:glucose\s+)?(?:it\s+)?down|lower(?:ing)?|work(?:ing)?|touching|come\s+down)\b|[\s\S]*\b(?:insulin|correction)\b[\s\S]{0,60}\b(?:is\s+doing\s+nothing|has\s+done\s+nothing|hasn't\s+worked|has\s+not\s+worked)\b|[\s\S]*\b(?:glucose|blood sugar)\b[\s\S]{0,35}\bnot\s+responding\s+to\s+(?:insulin|a\s+correction)\b|[\s\S]*\bi(?:'ve|\s+have)\s+taken\s+insulin\b[\s\S]{0,60}\bstill\s+high\b|[\s\S]*\bi\s+took\s+insulin\b[\s\S]{0,60}\b(?:glucose|blood sugar)\b[\s\S]{0,20}\bwon't\s+come\s+down\b)/i;
const INSULIN_FAILURE_IMPLYING_HIGH_GLUCOSE =
  /\b(?:insulin|correction)\b[\s\S]{0,30}\b(?:isn't|is not|doesn't|does not|won't|will not|hasn't|has not|not)\b[\s\S]{0,30}\bbring(?:ing)?\s+(?:my\s+)?(?:high\s+glucose|glucose\s+of\s+(?:19[.,]9|(?:2\d|[3-9]\d)(?:[.,]\d+)?))\s+down\b|\bi\s+took\s+insulin\b[\s\S]{0,70}\b(?:glucose|blood sugar)\b[\s\S]{0,25}\bwon't\s+come\s+down\b/i;
const PERSISTENT_HIGH_GLUCOSE_AFTER_INSULIN =
  /(?:\bi(?:'ve|\s+have)\s+taken\s+insulin\b[\s\S]{0,60}\bi(?:'m|\s+am)\s+still\s+(?:at\s+)?(?:19[.,]9|(?:2\d|[3-9]\d)(?:[.,]\d+)?)\b|\bi(?:'m|\s+am)\s+(?:at\s+)?(?:19[.,]9|(?:2\d|[3-9]\d)(?:[.,]\d+)?)\b[\s\S]{0,60}\binsulin\b[\s\S]{0,30}\b(?:isn't|is\s+not|doesn't|does\s+not|won't|will\s+not)\b[\s\S]{0,25}\b(?:touching|lowering|bringing)\b|\bmy\s+(?:glucose|blood\s+sugar)\s+remains\s+at\s+(?:19[.,]9|(?:2\d|[3-9]\d)(?:[.,]\d+)?)\b[\s\S]{0,30}\bafter\s+(?:insulin|a\s+correction)\b)/i;
const CORRECTION_NOT_SHIFTING_HIGH_GLUCOSE =
  /\b(?:a|my)\s+correction\s+(?:hasn't|has\s+not|isn't|is\s+not)\s+(?:shifted|moved|lowered|brought)\s+(?:my\s+)?(?:bg|glucose|blood\s+sugar)\s+(?:down\s+)?from\s+(?:19[.,]9|(?:2\d|[3-9]\d)(?:[.,]\d+)?)\b/i;
const DIRECT_CURRENT_DKA_CONCERN =
  /\b(?:i\s+fear\s+(?:it|this)(?:'s|\s+is)|i(?:'m|\s+am)\s+scared\s+(?:it|this)(?:'s|\s+is)|i\s+reckon\s+(?:it|this)(?:'s|\s+is)|(?:it|this)\s+(?:feels|looks|seems)\s+like)\s+(?:dka|diabetic ketoacidosis|ketoacidosis)\b/i;
const ALL_DKA_SYMPTOMS_WITH_UNKNOWN_KETONES =
  /\bi(?:\s+(?:have|have\s+got)|'ve\s+got)\s+(?:all|every(?:\s+one\s+of)?)\s+(?:the\s+)?(?:(?:signs?|symptoms?)\s+of\s+(?:dka|diabetic\s+ketoacidosis|ketoacidosis)|(?:dka|diabetic\s+ketoacidosis|ketoacidosis)\s+(?:signs?|symptoms?))\b[\s\S]{0,60}\b(?:do\s+not|don't|cannot|can't)\s+(?:know|check|test|measure)\s+(?:my\s+)?ketones?\b/i;
const EXPLICIT_PRESENT_GLUCOSE =
  /\b(?:(?:my\s+)?(?:libre|dexcom|cgm|xdrip|nightscout|sensor|meter|bg|glucose|blood sugar|reading|finger[- ]?prick|capillary reading)(?:\s+(?:reading|level))?\s+(?:is|reads?|shows?|says?)|current\s+(?:glucose|blood sugar|sugar|reading)|i(?:'m| am)(?:\s+currently)?(?:\s+at)?)\b/i;
const HYPOTHETICAL_LOW =
  /\b(?:if|when|whenever)\b[\s\S]{0,100}\b(?:libre|dexcom|cgm|xdrip|nightscout|sensor|meter|bg|glucose|blood sugar|reading|finger[- ]?prick|capillary reading)\b[\s\S]{0,30}\b(?:lo|low|hi|high)\b/i;
const EXPLICITLY_NEGATED_GLUCOSE_DANGER =
  /\b(?:my\s+)?(?:glucose|blood sugar|sugar|reading|sensor|meter|cgm)\b[\s\S]{0,20}\b(?:isn't|is not|wasn't|was not|doesn't\s+read|does\s+not\s+read)\s+(?:low|high|lo|hi)\b/i;
const MINUTES_AGO =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+minutes?\s+ago\b/i;

const AGE_WORD_VALUES: Readonly<Record<string, number>> = {
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function answer(
  headline: string,
  copy: string,
  limitations: string[] = [],
): TarvisAnswer {
  return {
    responseKind: 'safety-boundary',
    headline,
    answer: copy,
    confidence: "high",
    evidenceIds: [],
    limitations,
  };
}

function symptomClauses(prompt: string) {
  return prompt
    .split(
      /[!?;]+|\.(?=\s|$)|\b(?:but|however|although|whereas)\b|\band\b(?!\s+still\b)/i,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function dkaClauses(prompt: string) {
  return prompt
    .split(
      /[!?;]+|\.(?=\s|$)|\b(?:but|however|although|whereas)\b(?=\s+(?:i\b|he\b|she\b|they\b|his\b|her\b|their\b|someone\b|somebody\b|(?:my|our|the)\b))|,\s*(?=(?:and\s+)?(?:i\b|he\b|she\b|they\b|his\b|her\b|their\b|someone\b|somebody\b|(?:my|our|the)\b))|\band\b(?=\s+(?:now\b|i\b|he\b|she\b|they\b|his\b|her\b|their\b|someone\b|somebody\b|(?:my|our|the)\b))/i,
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function ketoneClauses(prompt: string) {
  let ketoneContext: "blood" | "urine" | "generic" | undefined;
  return prompt
    .split(
      /[!?;]+|\.(?=\s|$)|\b(?:but|however|although|whereas)\b|,\s*(?=(?:and\s+)?(?:now|currently|right now))|\band\s+now\b/i,
    )
    .map((rawClause) => {
      const clause = rawClause.trim();
      if (KETONE_CONTEXT_LANGUAGE.test(clause)) {
        ketoneContext =
          /\b(?:urine|wee|pee)(?:\s+ketone)?\s+(?:test(?:\s+strip)?|strip|dipstick|result|reading)\b|\b(?:urine|wee|pee)\s+ketones?\b|\b(?:ketostix|urinalysis|urine\s+analysis)\b/i.test(
            clause,
          )
            ? "urine"
            : /\bblood\s+ketones?\b/i.test(clause)
              ? "blood"
              : "generic";
        return clause;
      }
      if (!ketoneContext) return clause;
      const currentReading = clause.match(
        /^(?:(?:and\s+)?(?:now|today|currently|right now)\s+)?(?:(?:they(?:'re|\s+are)|mine\s+(?:are|read|show)|it\s+(?:is|reads?|shows?)|the\s+reading\s+(?:is|reads?|shows?)|are|is)\s+)?((?:(?:[<>]=?|[≥≤])\s*)?(?:\d+(?:[.,]\d+)?|\+{2,}|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+point\s+(?:zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine))*)?)(?:\s*(?:mmol(?:\/l)?|\+|plus))?|(?:over|above|greater\s+than|more\s+than)\s+(?:\d+(?:[.,]\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*(?:\+|plus))?)(?:\s+(?:now|today|right now|currently|at the moment))?$/i,
      )?.[1];
      if (currentReading) {
        const prefix =
          ketoneContext === "urine"
            ? "urine ketones"
            : ketoneContext === "blood"
              ? "blood ketones"
              : "ketones";
        return `${prefix} ${currentReading} now`;
      }
      if (
        /\b(?:normal|negative|none|zero|gone|clear|cleared)\s+now\b/i.test(
          clause,
        )
      ) {
        return `ketones ${clause}`;
      }
      return clause;
    })
    .filter(Boolean);
}

function minutesAgo(clause: string) {
  const value = MINUTES_AGO.exec(clause)?.[1];
  if (value === undefined) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  return WORD_DIGIT_VALUES[value.toLowerCase()];
}

function explicitSubjectAgeYears(prompt: string) {
  const halfYear = prompt.match(
    /\b(?:my|our)\s+(\d{1,2})[- ]and[- ]a[- ]half[- ]year[- ]old\b/i,
  )?.[1];
  if (halfYear !== undefined) return Number(halfYear) + 0.5;

  const months = prompt.match(
    /\b(?:my|our)\s+(\d{1,3})[- ]months?[- ]old\b/i,
  )?.[1];
  if (months !== undefined) return Number(months) / 12;

  const prefixedNumeric = prompt.match(
    /\b(?:my|our)\s+(\d{1,2})(?:\s*(?:y\s*\/\s*o|yo)|[-\s]*(?:years?|yrs?)[-\s]*old)\b/i,
  )?.[1];
  if (prefixedNumeric !== undefined) return Number(prefixedNumeric);

  const prefixedWord = prompt.match(
    /\b(?:my|our)\s+(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ]year[- ]old\b/i,
  )?.[1];
  if (prefixedWord !== undefined) {
    return AGE_WORD_VALUES[prefixedWord.toLowerCase()];
  }

  const relatedNumeric = prompt.match(
    /\b(?:my|our)\s+(?:son|daughter|child|kid|niece|nephew|grandson|granddaughter|teen|teenager|young\s+person)\s+(?:who\s+(?:is|just\s+turned)|is|aged?)\s+(\d{1,2})\b/i,
  )?.[1];
  if (relatedNumeric !== undefined) return Number(relatedNumeric);

  const overNumeric = prompt.match(
    /\b(?:my|our)\s+(?:son|daughter|child|kid|niece|nephew|grandson|granddaughter|young\s+person)\s+(?:is\s+)?(?:over|older\s+than)\s+(\d{1,2})\b/i,
  )?.[1];
  if (overNumeric !== undefined) return Number(overNumeric) + 0.1;

  return undefined;
}

function expandExplicitSamePromptReadingReference(prompt: string) {
  const currentReference =
    /\b(?:mine\s+(?:is|are)\s+now|(?:(?:that|it)(?:'s|\s+is))\s+my\s+reading\s+now)\s*[.!?]?\s*$/i;
  if (!currentReference.test(prompt)) {
    return prompt;
  }
  const prefix = prompt.replace(currentReference, "");
  const urine = prefix.match(
    /\burine\s+ketones?\b[\s\S]{0,45}?((?:\+{2,4})|(?:(?:two|three|four|2|3|4)\s*(?:\+|plus)))/i,
  )?.[1];
  if (urine) return `${prompt} My urine ketones are ${urine} now.`;
  const blood = prefix.match(
    /\bblood\s+ketones?\b[\s\S]{0,45}?((?:(?:over|above|greater\s+than|higher\s+than|more\s+than)\s+)?\d+(?:[.,]\d+)?)/i,
  )?.[1];
  if (blood) return `${prompt} My blood ketones are ${blood} now.`;
  const glucose = prefix.match(
    /\b(?:glucose|blood sugar)\b[\s\S]{0,35}?\b(?:of|is|reads?|shows?)?\s*(\d+(?:[.,]\d+)?)/i,
  )?.[1];
  if (glucose) return `${prompt} My glucose is ${glucose} now.`;
  return prompt;
}

function hasImmediate999Language(prompt: string) {
  if (NON_HUMAN_IMMEDIATE_CONTEXT.test(prompt)) return false;
  return (
    IMMEDIATE_999_SYMPTOM.test(prompt) ||
    IMMEDIATE_999_SYNONYM.test(prompt) ||
    IMMEDIATE_999_NATURAL_PRESENT.test(prompt) ||
    IMMEDIATE_999_HUMAN_PRESENT.test(prompt) ||
    IMMEDIATE_999_CRITICAL_RESPONSE_OR_AIRWAY.test(prompt) ||
    IMMEDIATE_999_ADDITIONAL_HUMAN.test(prompt) ||
    IMMEDIATE_999_TURNED_BLUE.test(prompt) ||
    RECENT_FIT_OR_SEIZURE.test(prompt) ||
    IMMEDIATE_999_FAMILY_PRESENT.test(prompt) ||
    HUMAN_COLLAPSE_PRESENT.test(prompt) ||
    NAMED_COLLAPSE_PRESENT.test(prompt) ||
    (IMMEDIATE_999_COLLAPSE_PRESENT.test(prompt) &&
      !NON_HUMAN_COLLAPSE_SUBJECT.test(prompt) &&
      (HUMAN_COLLAPSE_PRESENT.test(prompt) ||
        NAMED_COLLAPSE_PRESENT.test(prompt)))
  );
}

function hasPersonalPresentDanger(prompt: string) {
  return (
    EXPLICIT_PERSONAL_PRESENT_ASSERTION.test(prompt) &&
    (URGENT_SYMPTOM.test(prompt) ||
      hasImmediate999Language(prompt) ||
      DKA_SYMPTOM.test(prompt) ||
      DKA_LANGUAGE.test(prompt) ||
      /\bketones?\b/i.test(prompt))
  );
}

function hasRealCurrentOverride(prompt: string) {
  if (
    STRICT_FICTIONAL_EDUCATIONAL_WRAPPER.test(prompt) &&
    !EXPLICIT_REAL_CURRENT_OVERRIDE.test(prompt)
  ) {
    return false;
  }
  return (
    EXPLICIT_REAL_CURRENT_OVERRIDE.test(prompt) ||
    (EXPLICIT_CURRENT_TIME.test(prompt) &&
      (hasPersonalPresentDanger(prompt) ||
        EXPLICIT_PRESENT_GLUCOSE.test(prompt)))
  );
}

function isPureMedicalEducation(prompt: string) {
  return (
    (CLEAR_MEDICAL_GUIDANCE_WRAPPER.test(prompt) ||
      GENERAL_EDUCATIONAL_WRAPPER.test(prompt) ||
      GENERAL_IMMEDIATE_EDUCATION.test(prompt) ||
      CLEAR_DKA_EDUCATION.test(prompt) ||
      CLEAR_DKA_HYPOTHETICAL.test(prompt) ||
      GENERAL_DKA_EDUCATION.test(prompt) ||
      GENERAL_KETONE_EDUCATION.test(prompt) ||
      GENERAL_KETONE_HYPOTHETICAL.test(prompt)) &&
    !hasRealCurrentOverride(prompt)
  );
}

function isClearlyResolvedPrompt(prompt: string) {
  const resolved = [
    FIRST_PERSON_RESOLVED_EVENT.exec(prompt),
    OTHER_PERSON_RESOLVED_EVENT.exec(prompt),
    OTHER_PERSON_CURRENT_RESOLVED_EVENT.exec(prompt),
    KETONE_RESULT_RESOLVED_EVENT.exec(prompt),
    GLUCOSE_RESOLVED_EVENT.exec(prompt),
    BREATHING_RESTORED_EVENT.exec(prompt),
  ]
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((left, right) => right.index - left.index)[0];
  if (!resolved) return false;
  const tail = prompt.slice(resolved.index + resolved[0].length);
  return !(
    EXPLICIT_REAL_CURRENT_OVERRIDE.test(tail) ||
    hasPersonalPresentDanger(tail) ||
    ONGOING_URGENT_CONTINUATION.test(tail)
  );
}

function isCurrentUrgentSymptomClause(clause: string, prompt: string) {
  if (NON_HUMAN_IMMEDIATE_CONTEXT.test(clause)) return false;
  if (EXPLICITLY_NEGATED_IMMEDIATE_999.test(clause)) return false;
  if (NEGATED_BREATHING_MODIFIER.test(clause)) return false;
  if (!URGENT_SYMPTOM.test(clause) && !hasImmediate999Language(clause)) {
    return false;
  }
  if (
    EXPLICIT_REAL_CURRENT_OVERRIDE.test(prompt) &&
    !EXPLICITLY_NEGATED_DKA_SYMPTOM.test(clause)
  ) {
    return true;
  }
  if (
    (GENERAL_KETONE_HYPOTHETICAL.test(clause) ||
      GENERAL_IMMEDIATE_EDUCATION.test(clause) ||
      CLEAR_MEDICAL_GUIDANCE_WRAPPER.test(clause) ||
      GENERAL_EDUCATIONAL_WRAPPER.test(clause)) &&
    !hasRealCurrentOverride(prompt)
  ) {
    return false;
  }
  if (ONGOING_URGENT_CONTINUATION.test(clause)) return true;
  if (minutesAgo(clause) !== undefined && !RESOLVED_NOW.test(prompt)) {
    return true;
  }
  if (
    (HISTORICAL_ONLY_URGENT.test(clause) ||
      HISTORICAL_STATE_LANGUAGE.test(clause)) &&
    !IMMEDIATE_TIME.test(clause)
  ) {
    return false;
  }
  if (
    FIRST_PERSON_CURRENT_URGENT.test(clause) ||
    UNAMBIGUOUS_CURRENT_SEVERE.test(clause) ||
    IMMINENT_LOSS_OF_CONSCIOUSNESS.test(clause)
  ) {
    return true;
  }
  return (
    IMMEDIATE_TIME.test(clause) || /\b(?:help|what should i do)\b/i.test(clause)
  );
}

function hasCurrentUrgentSymptom(prompt: string) {
  if (isClearlyResolvedPrompt(prompt)) return false;
  return symptomClauses(prompt).some((clause) =>
    isCurrentUrgentSymptomClause(clause, prompt),
  );
}

function hasCurrentImmediate999Symptom(prompt: string) {
  if (isClearlyResolvedPrompt(prompt)) return false;
  return symptomClauses(prompt).some((clause) => {
    if (!hasImmediate999Language(clause) || RESOLVED_NOW.test(clause)) {
      return false;
    }
    if (EXPLICITLY_NEGATED_IMMEDIATE_999.test(clause)) return false;
    if (
      (GENERAL_KETONE_HYPOTHETICAL.test(clause) ||
        GENERAL_IMMEDIATE_EDUCATION.test(clause) ||
        CLEAR_MEDICAL_GUIDANCE_WRAPPER.test(clause) ||
        GENERAL_EDUCATIONAL_WRAPPER.test(clause)) &&
      !hasRealCurrentOverride(prompt)
    ) {
      return false;
    }
    if (
      (HISTORICAL_TIME_CONTEXT.test(clause) ||
        HISTORICAL_ONLY_URGENT.test(clause) ||
        HISTORICAL_STATE_LANGUAGE.test(clause)) &&
      !IMMEDIATE_TIME.test(clause) &&
      !ONGOING_URGENT_CONTINUATION.test(clause) &&
      minutesAgo(clause) === undefined
    ) {
      return false;
    }
    return (
      isCurrentUrgentSymptomClause(clause, prompt) ||
      BROAD_PRESENT_IMMEDIATE_999.test(clause) ||
      hasImmediate999Language(clause)
    );
  });
}

function ketoneValue(clause: string) {
  if (
    KETONE_CONTEXT_LANGUAGE.test(clause) &&
    /(?:\bketones?\b[\s\S]{0,25}|^\s*)(?:<(?!=)|<=|≤)\s*\d/i.test(clause)
  ) {
    return undefined;
  }
  const range = CURRENT_KETONE_RANGE_VALUE.exec(clause);
  if (range?.[1] && range[2]) {
    return Math.max(
      Number(range[1].replace(",", ".")),
      Number(range[2].replace(",", ".")),
    );
  }
  const mixed = CURRENT_KETONE_MIXED_DECIMAL.exec(clause);
  if (mixed?.[1] && mixed[2]) {
    const fraction = /^\d+$/.test(mixed[2])
      ? mixed[2]
      : WORD_DIGIT_VALUES[mixed[2].toLowerCase()]?.toString();
    if (fraction !== undefined) return Number(`${mixed[1]}.${fraction}`);
  }

  const half = CURRENT_KETONE_HALF_VALUE.exec(clause)?.[1];
  if (half !== undefined) {
    const integer = /^\d+$/.test(half)
      ? Number(half)
      : WORD_DIGIT_VALUES[half.toLowerCase()];
    if (integer !== undefined) return integer + 0.5;
  }

  const quarter = CURRENT_KETONE_QUARTER_VALUE.exec(clause);
  if (quarter?.[1] && quarter[2]) {
    const integer = /^\d+$/.test(quarter[1])
      ? Number(quarter[1])
      : WORD_DIGIT_VALUES[quarter[1].toLowerCase()];
    if (integer !== undefined) {
      return integer + (/three\s+quarters/i.test(quarter[2]) ? 0.75 : 0.25);
    }
  }

  const atValue = CURRENT_KETONE_AT_VALUE.exec(clause)?.[1];
  if (atValue !== undefined) {
    return Number(atValue.replace(",", "."));
  }

  const naturalResultValue =
    CURRENT_KETONE_NATURAL_RESULT_VALUE.exec(clause)?.[1];
  if (naturalResultValue !== undefined) {
    return Number(naturalResultValue.replace(",", "."));
  }

  const resultValue = CURRENT_KETONE_RESULT_VALUE.exec(clause)?.[1];
  if (resultValue !== undefined) {
    return Number(resultValue.replace(",", "."));
  }

  const extendedResultValue =
    CURRENT_KETONE_EXTENDED_RESULT_VALUE.exec(clause)?.[1];
  if (extendedResultValue !== undefined) {
    return Number(extendedResultValue.replace(",", "."));
  }

  const value = clause
    .match(CURRENT_KETONE_VALUE)
    ?.slice(1)
    .find((candidate) => candidate !== undefined);
  if (value !== undefined) return Number(value.replace(",", "."));

  const spoken = CURRENT_KETONE_WORD_VALUE.exec(clause);
  if (!spoken) return undefined;
  const integerWord = spoken[1];
  if (!integerWord) return undefined;
  const integer = WORD_DIGIT_VALUES[integerWord.toLowerCase()];
  if (integer === undefined) return undefined;
  const fraction = spoken[2]
    ?.toLowerCase()
    .split(/\s+/)
    .map((digit) => WORD_DIGIT_VALUES[digit])
    .join("");
  return fraction ? Number(`${integer}.${fraction}`) : integer;
}

function hasAffirmedDkaSymptom(clause: string) {
  return clause
    .split(/\b(?:and|but|however|although|whereas)\b/i)
    .some((fragment) => {
      return (
        (DKA_SYMPTOM.test(fragment) || ADDITIONAL_DKA_SYMPTOM.test(fragment)) &&
        !EXPLICITLY_NEGATED_DKA_SYMPTOM.test(fragment) &&
        !NEGATED_BREATHING_MODIFIER.test(fragment)
      );
    });
}

function isCurrentDkaSymptomClause(clause: string) {
  if (NEGATED_BREATHING_MODIFIER.test(clause)) return false;
  if (!hasAffirmedDkaSymptom(clause)) return false;
  if (RESOLVED_NOW.test(clause)) return false;
  if (PRESENT_DKA_SYMPTOM_CONTEXT.test(clause)) return true;
  if (
    HISTORICAL_TIME_CONTEXT.test(clause) &&
    !IMMEDIATE_TIME.test(clause) &&
    !ONGOING_URGENT_CONTINUATION.test(clause)
  ) {
    return false;
  }
  return (
    IMMEDIATE_TIME.test(clause) ||
    ONGOING_URGENT_CONTINUATION.test(clause) ||
    /\b(?:help|what should i do)\b/i.test(clause)
  );
}

function hasCurrentDkaSymptom(prompt: string) {
  if (isClearlyResolvedPrompt(prompt) || isPureMedicalEducation(prompt)) {
    return false;
  }
  return dkaClauses(prompt).some(isCurrentDkaSymptomClause);
}

function currentDkaSymptomCategoryCount(prompt: string) {
  if (isClearlyResolvedPrompt(prompt) || isPureMedicalEducation(prompt)) {
    return 0;
  }
  const categories = new Set<number>();
  dkaClauses(prompt).forEach((clause) => {
    if (!isCurrentDkaSymptomClause(clause)) return;
    DKA_SYMPTOM_CATEGORIES.forEach((pattern, index) => {
      if (
        clause
          .split(/\band\b/i)
          .some(
            (fragment) =>
              pattern.test(fragment) &&
              !EXPLICITLY_NEGATED_DKA_SYMPTOM.test(fragment),
          )
      ) {
        categories.add(index);
      }
    });
  });
  return categories.size;
}

function hasCurrentHighSpecificityDkaSymptom(prompt: string) {
  if (isClearlyResolvedPrompt(prompt) || isPureMedicalEducation(prompt)) {
    return false;
  }
  return dkaClauses(prompt).some(
    (clause) =>
      isCurrentDkaSymptomClause(clause) &&
      clause
        .split(/\band\b/i)
        .some(
          (fragment) =>
            HIGH_SPECIFICITY_DKA_SYMPTOM.test(fragment) &&
            !EXPLICITLY_NEGATED_DKA_SYMPTOM.test(fragment),
        ),
  );
}

type HealthSubject = "self" | "male" | "female" | "child" | "plural" | "named";

function healthSubjectForKnownDiabetes(
  clause: string,
): HealthSubject | undefined {
  if (!KNOWN_DIABETES.test(clause)) return undefined;
  const relation = clause
    .match(
      /\b(?:my|our)\s+(son|boy|brother|dad|father|husband|nephew|grandson|daughter|girl|sister|mum|mom|mother|wife|niece|granddaughter|child|kid|teen|teenager|young person|partner)\b/i,
    )?.[1]
    ?.toLowerCase();
  if (relation) {
    if (
      /^(?:son|boy|brother|dad|father|husband|nephew|grandson)$/.test(relation)
    ) {
      return "male";
    }
    if (
      /^(?:daughter|girl|sister|mum|mom|mother|wife|niece|granddaughter)$/.test(
        relation,
      )
    ) {
      return "female";
    }
    return "child";
  }
  if (/\bi(?:'m|\s+am|\s+have|\s+have\s+got)\b/i.test(clause)) {
    return "self";
  }
  if (/\b[A-Z][a-z]{1,30}\b[\s\S]{0,35}\b(?:has|with|is)\b/.test(clause)) {
    return "named";
  }
  return undefined;
}

function healthSubjectForSymptom(clause: string): HealthSubject | undefined {
  if (/\b(?:the\s+)?(?:dog|cat|animal|pet)\b/i.test(clause)) return undefined;
  if (/\b(?:someone|somebody)\s+else\b/i.test(clause)) return undefined;
  const relation = clause
    .match(
      /\b(?:my|our)\s+(son|boy|brother|dad|father|husband|nephew|grandson|daughter|girl|sister|mum|mom|mother|wife|niece|granddaughter|child|kid|teen|teenager|young person|partner|friend)\b/i,
    )?.[1]
    ?.toLowerCase();
  if (relation) {
    if (
      /^(?:son|boy|brother|dad|father|husband|nephew|grandson)$/.test(relation)
    ) {
      return "male";
    }
    if (
      /^(?:daughter|girl|sister|mum|mom|mother|wife|niece|granddaughter)$/.test(
        relation,
      )
    ) {
      return "female";
    }
    return relation === "friend" || relation === "partner"
      ? undefined
      : "child";
  }
  if (
    /\bi(?:'m|\s+am|\s+have|\s+feel|\s+cannot|\s+can't)\b|\bmy\s+(?:breath|tummy|stomach|vision)\b/i.test(
      clause,
    )
  ) {
    return "self";
  }
  if (/\bhe(?:'s|\s+is|\s+has|\s+feels|\s+can't|\s+cannot)\b/i.test(clause))
    return "male";
  if (/\bshe(?:'s|\s+is|\s+has|\s+feels|\s+can't|\s+cannot)\b/i.test(clause))
    return "female";
  if (/\bthey(?:'re|\s+are|\s+have|\s+feel|\s+can't|\s+cannot)\b/i.test(clause))
    return "plural";
  if (
    /\b[A-Z][a-z]{1,30}\b[\s\S]{0,35}\b(?:is|has|feels|says)\b/.test(clause)
  ) {
    return "named";
  }
  return undefined;
}

function compatibleHealthSubjects(
  known: HealthSubject,
  symptom: HealthSubject,
) {
  if (known === symptom) return true;
  if (symptom === "plural") {
    return (
      known === "male" ||
      known === "female" ||
      known === "child" ||
      known === "named"
    );
  }
  if (known === "child") return symptom === "male" || symptom === "female";
  if (known === "named") return symptom === "male" || symptom === "female";
  return false;
}

function hasCurrentKnownDiabetesDkaSymptom(prompt: string) {
  if (isClearlyResolvedPrompt(prompt) || isPureMedicalEducation(prompt)) {
    return false;
  }
  const clauses = dkaClauses(prompt);
  const ketoneValues = ketoneClauses(prompt)
    .map(ketoneValue)
    .filter((value): value is number => value !== undefined);
  const explicitlySafeKetones =
    EXPLICITLY_ABSENT_KETONES.test(prompt) ||
    (ketoneValues.length > 0 && ketoneValues.every((value) => value < 0.6));
  if (explicitlySafeKetones && !HIGH_RISK_DKA_SYMPTOM.test(prompt)) {
    return false;
  }

  const isCurrentKnownSymptomClause = (
    clause: string,
    requireKnownDiabetes: boolean,
  ) => {
    const hasPresentSubject =
      PERSONAL_HEALTH_SUBJECT.test(clause) ||
      NAMED_HEALTH_SUBJECT_ASSERTION.test(clause) ||
      DESCRIBED_HEALTH_SUBJECT_ASSERTION.test(clause);
    if (
      !hasPresentSubject ||
      (requireKnownDiabetes && !KNOWN_DIABETES.test(clause)) ||
      !hasAffirmedDkaSymptom(clause) ||
      RESOLVED_NOW.test(clause) ||
      NEGATED_BREATHING_MODIFIER.test(clause)
    ) {
      return false;
    }
    if (
      (CLEAR_DKA_HYPOTHETICAL.test(clause) ||
        CLEAR_MEDICAL_GUIDANCE_WRAPPER.test(clause) ||
        GENERAL_EDUCATIONAL_WRAPPER.test(clause)) &&
      !hasRealCurrentOverride(prompt)
    ) {
      return false;
    }
    if (
      (HISTORICAL_TIME_CONTEXT.test(clause) ||
        HISTORICAL_STATE_LANGUAGE.test(clause)) &&
      !IMMEDIATE_TIME.test(clause) &&
      !ONGOING_URGENT_CONTINUATION.test(clause) &&
      !/\b(?:is|has|feels|keeps)\s+(?:nauseous|vomiting|throwing up|dehydrated|hyperventilating|unconscious|unresponsive|confused|drowsy|sleepy|(?:abdominal|stomach|tummy) pain|reduced (?:level of )?consciousness)\b/i.test(
        clause,
      )
    ) {
      return false;
    }
    return (
      isCurrentDkaSymptomClause(clause) ||
      NAMED_HEALTH_SUBJECT_ASSERTION.test(clause) ||
      DESCRIBED_HEALTH_SUBJECT_ASSERTION.test(clause)
    );
  };

  if (clauses.some((clause) => isCurrentKnownSymptomClause(clause, true))) {
    return true;
  }
  for (let knownIndex = 0; knownIndex < clauses.length; knownIndex += 1) {
    const knownSubject = healthSubjectForKnownDiabetes(
      clauses[knownIndex] ?? "",
    );
    if (!knownSubject) continue;
    for (let offset = 1; offset <= 2; offset += 1) {
      const nextClause = clauses[knownIndex + offset];
      if (!nextClause || !isCurrentKnownSymptomClause(nextClause, false)) {
        continue;
      }
      const symptomSubject = healthSubjectForSymptom(nextClause);
      if (
        symptomSubject &&
        compatibleHealthSubjects(knownSubject, symptomSubject)
      ) {
        return true;
      }
      break;
    }
  }
  return false;
}

function hasCurrentKnownDiabetesImmediate999Symptom(prompt: string) {
  if (isClearlyResolvedPrompt(prompt)) return false;
  return dkaClauses(prompt).some((clause) => {
    if (
      !PERSONAL_HEALTH_SUBJECT.test(clause) ||
      !KNOWN_DIABETES.test(clause) ||
      !hasImmediate999Language(clause) ||
      RESOLVED_NOW.test(clause) ||
      EXPLICITLY_NEGATED_IMMEDIATE_999.test(clause) ||
      EXPLICITLY_NEGATED_DKA_SYMPTOM.test(clause) ||
      ((CLEAR_DKA_HYPOTHETICAL.test(clause) ||
        CLEAR_MEDICAL_GUIDANCE_WRAPPER.test(clause) ||
        GENERAL_EDUCATIONAL_WRAPPER.test(clause)) &&
        !hasRealCurrentOverride(prompt))
    ) {
      return false;
    }
    return (
      (!HISTORICAL_TIME_CONTEXT.test(clause) &&
        !HISTORICAL_STATE_LANGUAGE.test(clause)) ||
      IMMEDIATE_TIME.test(clause) ||
      ONGOING_URGENT_CONTINUATION.test(clause)
    );
  });
}

function hasCurrentKetoneDanger(prompt: string) {
  if (
    isClearlyResolvedPrompt(prompt) ||
    KETONE_READING_HISTORICAL_CORRECTION.test(prompt) ||
    (DEVICE_CAPABILITY_KETONE_READING.test(prompt) &&
      !hasRealCurrentOverride(prompt))
  ) {
    return false;
  }
  const clauses = ketoneClauses(prompt);
  const recordedValues = clauses
    .map(ketoneValue)
    .filter((value): value is number => value !== undefined);
  const explicitlySafe =
    EXPLICITLY_ABSENT_KETONES.test(prompt) ||
    (recordedValues.length > 0 && recordedValues.every((value) => value < 0.6));
  if (
    recordedValues.some((value) => value >= 0.6 && value <= 1.5) &&
    (hasCurrentDkaSymptom(prompt) || CURRENT_GENERAL_ILLNESS.test(prompt)) &&
    !RESOLVED_NOW.test(prompt)
  ) {
    return true;
  }
  if (
    (STILL_KETONE_DANGER.test(prompt) ||
      (ILL_WITH_KETONES.test(prompt) && !explicitlySafe)) &&
    !RESOLVED_NOW.test(prompt)
  ) {
    return true;
  }
  return clauses.some((clause) => {
    if (!KETONE_CONTEXT_LANGUAGE.test(clause)) return false;
    if (
      (CLEAR_MEDICAL_GUIDANCE_WRAPPER.test(clause) ||
        GENERAL_EDUCATIONAL_WRAPPER.test(clause)) &&
      !hasRealCurrentOverride(prompt)
    ) {
      return false;
    }
    if (
      (HYPOTHETICAL_REVIEWED_KETONES.test(clause) ||
        KETONE_EDUCATION_QUESTION.test(clause) ||
        GENERAL_KETONE_EDUCATION.test(clause) ||
        GENERAL_KETONE_HYPOTHETICAL.test(clause)) &&
      !hasRealCurrentOverride(prompt)
    ) {
      return false;
    }
    if (EXPLICITLY_ABSENT_KETONES.test(clause)) return false;
    const ongoing = ONGOING_URGENT_CONTINUATION.test(clause);
    const currentHigh = CURRENT_HIGH_KETONES.test(clause);
    const currentAny = CURRENT_ANY_KETONES.test(clause);
    const urgentAction = URGENT_KETONE_ACTION.test(clause);
    const value = ketoneValue(clause);
    const historical =
      HISTORICAL_TIME_CONTEXT.test(clause) ||
      PAST_KETONE_VALUE_GRAMMAR.test(clause);
    const recentMinutes = minutesAgo(clause);
    const recent = recentMinutes !== undefined && recentMinutes <= 30;
    if (RESOLVED_NOW.test(clause) && !ongoing) return false;
    if (value !== undefined && Number.isFinite(value) && value < 1.6) {
      return value >= 0.6 && hasCurrentDkaSymptom(prompt);
    }
    if (
      historical &&
      !recent &&
      !ongoing &&
      !currentAny &&
      !urgentAction &&
      !CURRENT_GLUCOSE_CONTINUATION.test(clause)
    ) {
      return false;
    }
    if (
      ongoing ||
      currentHigh ||
      currentAny ||
      urgentAction ||
      CURRENT_LARGE_KETONES.test(clause) ||
      CURRENT_EMERGENCY_KETONES.test(clause) ||
      OVER_THREE_KETONES.test(clause) ||
      KETONE_ABOVE_THREE_THRESHOLD.test(clause) ||
      KETONE_EXCEEDS_THREE_THRESHOLD.test(clause) ||
      KETONE_AT_LEAST_THREE.test(clause) ||
      URINE_KETONE_EMERGENCY_THRESHOLD.test(clause) ||
      URINE_KETONE_WORD_PLUS.test(clause) ||
      URINE_KETONE_EMERGENCY_RESULT.test(clause) ||
      URINE_KETONE_EMERGENCY_NATURAL.test(clause) ||
      URINE_KETONE_EMERGENCY_DIP.test(clause) ||
      URINE_KETONE_EMERGENCY_READING.test(clause) ||
      URINE_KETONE_URGENT_READING.test(clause) ||
      URINE_KETONE_POSITIVE_RESULT.test(clause)
    ) {
      return true;
    }
    return value !== undefined && Number.isFinite(value) && value >= 1.6;
  });
}

function hasCurrentKetoneEmergency(prompt: string) {
  if (
    isClearlyResolvedPrompt(prompt) ||
    KETONE_READING_HISTORICAL_CORRECTION.test(prompt)
  ) {
    return false;
  }
  return ketoneClauses(prompt).some((clause) => {
    if (!hasCurrentKetoneDanger(clause)) return false;
    const value = ketoneValue(clause);
    return (
      (value !== undefined && Number.isFinite(value) && value > 3) ||
      CURRENT_EMERGENCY_KETONES.test(clause) ||
      OVER_THREE_KETONES.test(clause) ||
      KETONE_ABOVE_THREE_THRESHOLD.test(clause) ||
      KETONE_EXCEEDS_THREE_THRESHOLD.test(clause) ||
      URINE_KETONE_EMERGENCY_THRESHOLD.test(clause) ||
      URINE_KETONE_EMERGENCY_RESULT.test(clause) ||
      URINE_KETONE_EMERGENCY_NATURAL.test(clause) ||
      URINE_KETONE_EMERGENCY_DIP.test(clause) ||
      URINE_KETONE_EMERGENCY_READING.test(clause) ||
      /\bplus\s+plus\s+plus(?:\s+plus)?\b/i.test(clause)
    );
  });
}

function hasCurrentUnknownOrConcerningKetones(prompt: string) {
  if (isClearlyResolvedPrompt(prompt)) return false;
  if (EXPLICITLY_ABSENT_KETONES.test(prompt)) return false;
  const values = ketoneClauses(prompt)
    .map(ketoneValue)
    .filter((value): value is number => value !== undefined);
  if (values.length > 0) return false;
  if (CANNOT_CHECK_KETONES.test(prompt) || hasCurrentKetoneDanger(prompt)) {
    return true;
  }
  return dkaClauses(prompt).some((clause) => {
    if (!/\bketones?\b/i.test(clause) || RESOLVED_NOW.test(clause)) {
      return false;
    }
    if (
      (HYPOTHETICAL_REVIEWED_KETONES.test(clause) ||
        KETONE_EDUCATION_QUESTION.test(clause) ||
        GENERAL_KETONE_EDUCATION.test(clause) ||
        GENERAL_KETONE_HYPOTHETICAL.test(clause)) &&
      !IMMEDIATE_TIME.test(clause)
    ) {
      return false;
    }
    if (
      HISTORICAL_TIME_CONTEXT.test(clause) &&
      !IMMEDIATE_TIME.test(clause) &&
      !ONGOING_URGENT_CONTINUATION.test(clause)
    ) {
      return false;
    }
    return PRESENT_DKA_SYMPTOM_CONTEXT.test(clause);
  });
}

function hasCurrentDkaConcern(prompt: string) {
  if (isClearlyResolvedPrompt(prompt)) return false;
  if (isPureMedicalEducation(prompt)) return false;
  if (
    /\bi(?:'ve|\s+have)\s+gone\s+into\s+(?:dka|diabetic\s+ketoacidosis|ketoacidosis)\b/i.test(
      prompt,
    )
  ) {
    return true;
  }
  if (
    (explicitSubjectAgeYears(prompt) !== undefined ||
      EXPLICIT_ADULT_DESCRIPTOR_LANGUAGE.test(prompt)) &&
    SUBJECT_DKA_CONCERN_LANGUAGE.test(prompt) &&
    !EXPLICITLY_NEGATED_DKA.test(prompt) &&
    !isPureMedicalEducation(prompt)
  ) {
    return true;
  }
  if (
    DIRECT_CURRENT_DKA_CONCERN.test(prompt) &&
    !isPureMedicalEducation(prompt)
  ) {
    return true;
  }
  if (
    EXPLICIT_ADULT_RELATION_DKA_CONCERN.test(prompt) &&
    !isPureMedicalEducation(prompt)
  ) {
    return true;
  }
  if (
    DKA_LANGUAGE.test(prompt) &&
    DKA_ANAPHORIC_CURRENT.test(prompt) &&
    !EXPLICITLY_NEGATED_DKA.test(prompt) &&
    !isPureMedicalEducation(prompt)
  ) {
    return true;
  }
  return dkaClauses(prompt).some((clause) => {
    if (!DKA_LANGUAGE.test(clause)) return false;
    if (RESOLVED_NOW.test(clause) || DKA_RULED_OUT.test(clause)) return false;
    if (EXPLICITLY_NEGATED_DKA.test(clause)) return false;
    const explicitNow = EXPLICIT_CURRENT_DKA.test(clause);
    const currentDiagnosis = CURRENT_DKA_DIAGNOSIS.test(clause);
    const presentConcern = PRESENT_DKA_CONCERN.test(clause) || currentDiagnosis;
    if (
      (CLEAR_DKA_EDUCATION.test(clause) ||
        CLEAR_DKA_HYPOTHETICAL.test(clause) ||
        GENERAL_DKA_EDUCATION.test(clause) ||
        CLEAR_MEDICAL_GUIDANCE_WRAPPER.test(clause) ||
        GENERAL_EDUCATIONAL_WRAPPER.test(clause)) &&
      !(presentConcern && explicitNow)
    ) {
      return false;
    }
    const shorthand = DKA_SHORTHAND.test(clause);
    if (
      (HISTORICAL_DKA_REQUEST.test(clause) || PAST_DKA_GRAMMAR.test(clause)) &&
      !explicitNow &&
      !currentDiagnosis
    ) {
      return false;
    }
    return presentConcern || shorthand || explicitNow;
  });
}

function hasExplicitCurrentDkaDeclaration(prompt: string) {
  if (isClearlyResolvedPrompt(prompt) || isPureMedicalEducation(prompt)) {
    return false;
  }
  if (
    DKA_LANGUAGE.test(prompt) &&
    DKA_ANAPHORIC_CURRENT.test(prompt) &&
    /(?:^|[.!?]\s*)i(?:'ve|\s+have)\s+got\s+it\s+again\b/i.test(prompt)
  ) {
    return true;
  }
  return dkaClauses(prompt).some((clause) => {
    if (!hasCurrentDkaConcern(clause)) return false;
    if (CURRENT_DKA_DIAGNOSIS.test(clause)) return true;
    return (
      EXPLICIT_PRESENT_DKA_DECLARATION.test(clause) &&
      !DKA_UNCERTAINTY.test(clause)
    );
  });
}

function hasCurrentChildDkaConcern(prompt: string) {
  if (isClearlyResolvedPrompt(prompt) || isPureMedicalEducation(prompt)) {
    return false;
  }
  const explicitAge = explicitSubjectAgeYears(prompt);
  if (
    (explicitAge !== undefined && explicitAge >= 18) ||
    EXPLICIT_ADULT_RELATION_LANGUAGE.test(prompt) ||
    EXPLICIT_ADULT_DESCRIPTOR_LANGUAGE.test(prompt)
  ) {
    return false;
  }
  if (
    explicitAge !== undefined &&
    explicitAge < 18 &&
    DKA_LANGUAGE.test(prompt) &&
    SUBJECT_DKA_CONCERN_LANGUAGE.test(prompt) &&
    !EXPLICITLY_NEGATED_DKA.test(prompt) &&
    !DKA_RULED_OUT.test(prompt)
  ) {
    return true;
  }
  if (
    EXPLICIT_REAL_CURRENT_OVERRIDE.test(prompt) &&
    /\b(?:a|the)\s+(?:child|young person)\b[\s\S]{0,40}\b(?:type\s*1|type one|t1d|diabetic)\b/i.test(
      prompt,
    ) &&
    hasAffirmedDkaSymptom(prompt)
  ) {
    return true;
  }
  if (
    DKA_LANGUAGE.test(prompt) &&
    CHILD_SUBJECT_LANGUAGE.test(prompt) &&
    CHILD_DKA_ANAPHORIC_CURRENT.test(prompt) &&
    !EXPLICITLY_NEGATED_DKA.test(prompt)
  ) {
    return true;
  }
  return dkaClauses(prompt).some((clause) => {
    if (
      !CURRENT_CHILD_DKA.test(clause) ||
      EXPLICITLY_NEGATED_DKA.test(clause) ||
      DKA_RULED_OUT.test(clause) ||
      (PAST_DKA_GRAMMAR.test(clause) &&
        !CURRENT_CHILD_DKA_ASSERTION.test(clause) &&
        !EXPLICIT_CURRENT_DKA.test(clause)) ||
      (HISTORICAL_TIME_CONTEXT.test(clause) &&
        !CURRENT_CHILD_DKA_ASSERTION.test(clause) &&
        !EXPLICIT_CURRENT_DKA.test(clause))
    ) {
      return false;
    }
    return (
      CURRENT_CHILD_DKA_ASSERTION.test(clause) || hasCurrentDkaConcern(clause)
    );
  });
}

function hasDangerousGlucoseClause(
  clause: string,
  historicalGlucoseAnchor: boolean,
) {
  const historical = HISTORICAL_TIME_CONTEXT.test(clause);
  const recentMinutes = minutesAgo(clause);
  const recent = recentMinutes !== undefined && recentMinutes <= 30;
  if (historical && !recent && !CURRENT_GLUCOSE_CONTINUATION.test(clause)) {
    return false;
  }
  if (DANGEROUS_CURRENT_GLUCOSE.test(clause)) return true;
  if (
    CURRENT_LOW_TEXT.test(clause) &&
    !(
      HYPOTHETICAL_LOW.test(clause) &&
      !/\b(?:now|currently|right now|at the moment)\b/i.test(clause)
    )
  ) {
    if (
      historicalGlucoseAnchor &&
      !EXPLICIT_PRESENT_GLUCOSE.test(clause) &&
      !CURRENT_GLUCOSE_CONTINUATION.test(clause)
    ) {
      return false;
    }
    return true;
  }
  const directValue = CURRENT_GLUCOSE_NUMBER.exec(clause)?.[1];
  const shorthandMatch = CURRENT_GLUCOSE_SHORTHAND.exec(clause);
  const shorthandValue = shorthandMatch?.[1] ?? shorthandMatch?.[2];
  const spokenMatch = CURRENT_GLUCOSE_SPOKEN.exec(clause);
  const spokenInteger = spokenMatch?.[1];
  const spokenFraction = spokenMatch?.[2];
  const spokenIntegerValue =
    spokenInteger === undefined
      ? undefined
      : /^\d+$/.test(spokenInteger)
        ? Number(spokenInteger)
        : WORD_DIGIT_VALUES[spokenInteger.toLowerCase()];
  const spokenFractionValue =
    spokenFraction === undefined
      ? undefined
      : /^\d+$/.test(spokenFraction)
        ? spokenFraction
        : WORD_DIGIT_VALUES[spokenFraction.toLowerCase()]?.toString();
  const spokenValue =
    spokenIntegerValue !== undefined && spokenFractionValue !== undefined
      ? `${spokenIntegerValue}.${spokenFractionValue}`
      : undefined;
  const anaphoricValue = historicalGlucoseAnchor
    ? CURRENT_ANAPHORIC_GLUCOSE_NUMBER.exec(clause)?.[1]
    : undefined;
  const value = directValue ?? shorthandValue ?? spokenValue ?? anaphoricValue;
  if (!value) return false;
  if (
    historicalGlucoseAnchor &&
    !historical &&
    !EXPLICIT_PRESENT_GLUCOSE.test(clause) &&
    !CURRENT_GLUCOSE_CONTINUATION.test(clause) &&
    anaphoricValue === undefined
  ) {
    return false;
  }
  if (
    !directValue &&
    !/[.,]/.test(value) &&
    !/\b(?:mmol(?:\/l)?|now|falling|rising|low|high|help|advise)\b/i.test(
      clause,
    )
  ) {
    return false;
  }
  const glucose = Number(value.replace(",", "."));
  return Number.isFinite(glucose) && (glucose <= 3.9 || glucose >= 20);
}

function hasDangerousCurrentGlucose(prompt: string) {
  if (isClearlyResolvedPrompt(prompt)) return false;
  if (isPureMedicalEducation(prompt)) return false;
  if (EXPLICITLY_NEGATED_GLUCOSE_DANGER.test(prompt)) return false;
  if (
    KETONE_CONTEXT_LANGUAGE.test(prompt) &&
    !/\b(?:glucose|blood sugar|sugar|libre|dexcom|cgm|xdrip|nightscout|sensor|finger[- ]?prick|capillary reading)\b/i.test(
      prompt,
    )
  ) {
    return false;
  }
  if (
    AMBIGUOUS_CURRENT_HEALTH_READING.test(prompt) ||
    AMBIGUOUS_SPOKEN_HEALTH_READING.test(prompt)
  ) {
    return true;
  }
  const continuedValue = CURRENT_GLUCOSE_AFTER_HISTORY.exec(prompt)
    ?.slice(1)
    .find((value) => value !== undefined);
  if (continuedValue !== undefined) {
    const glucose = Number(continuedValue.replace(",", "."));
    if (Number.isFinite(glucose) && (glucose <= 3.9 || glucose >= 20)) {
      return true;
    }
  }
  const clauses = symptomClauses(prompt);
  const historicalGlucoseAnchor = clauses.some(
    (clause) =>
      HISTORICAL_TIME_CONTEXT.test(clause) &&
      /\b(?:libre|dexcom|cgm|xdrip|nightscout|sensor|meter|bg|glucose|blood sugar|reading|finger[- ]?prick|capillary reading|low|hypo|hypoglyc(?:aemia|emia|emic))\b/i.test(
        clause,
      ),
  );
  return clauses.some((clause) =>
    hasDangerousGlucoseClause(clause, historicalGlucoseAnchor),
  );
}

/**
 * Deterministic preflight for requests where analytics must not be allowed to
 * delay urgent help or drift into treatment, diagnosis or prediction.
 */
export function classifyTarvisSafety(question: string): TarvisSafetyDecision {
  const regional = getRuntimeRegionalDefaults();
  const emergencyCare = getRuntimeEmergencyCareTerms();
  const reviewedUkDkaPack = regional.clinicalJurisdiction === "GB";
  const prompt = expandExplicitSamePromptReadingReference(
    question.trim().normalize("NFKC").replace(/[’‘]/g, "'"),
  );
  const currentUrgentSymptom = hasCurrentUrgentSymptom(prompt);
  const currentDkaSymptom = hasCurrentDkaSymptom(prompt);
  const currentKetoneDanger = hasCurrentKetoneDanger(prompt);
  const currentDkaConcern = hasCurrentDkaConcern(prompt);
  const immediate999 =
    hasCurrentImmediate999Symptom(prompt) ||
    hasCurrentKnownDiabetesImmediate999Symptom(prompt);
  if (immediate999) {
    return {
      kind: "urgent",
      answer: answer(
        emergencyCare.call,
        `${emergencyCare.call} and ask for an ambulance. Do not drive or try to take the person to ${emergencyCare.department} yourself. Follow the call handler’s instructions and your trusted diabetes emergency plan while help is being arranged, but do not wait for Tarv1s to analyse any records.`,
        ["Tarv1s is not an emergency service and no data analysis was run."],
      ),
    };
  }
  // Reviewed against current NHS/NHS Inform DKA escalation thresholds on
  // 2026-08-26: >3 mmol/L blood or >2+ urine needs 999/A&E; 1.6–3 mmol/L
  // needs urgent diabetes-team/111 advice. NICE NG18 separately requires
  // urgent hospital assessment for suspected DKA in a child or young person.
  const emergency =
    (ALL_DKA_SYMPTOMS_WITH_UNKNOWN_KETONES.test(prompt) &&
      !isPureMedicalEducation(prompt)) ||
    (reviewedUkDkaPack && hasCurrentKetoneEmergency(prompt)) ||
    ((currentDkaConcern || hasCurrentUnknownOrConcerningKetones(prompt)) &&
      currentDkaSymptom) ||
    currentDkaSymptomCategoryCount(prompt) >= 2 ||
    hasExplicitCurrentDkaDeclaration(prompt) ||
    hasCurrentChildDkaConcern(prompt) ||
    hasCurrentKnownDiabetesDkaSymptom(prompt);
  if (emergency) {
    return {
      kind: "urgent",
      answer: answer(
        emergencyCare.emergency,
        `This could be a life-threatening emergency. ${emergencyCare.emergency.charAt(0).toUpperCase()}${emergencyCare.emergency.slice(1)} if you can do so safely; do not drive yourself. Follow your trusted diabetes emergency or sick-day plan while help is being arranged, but do not wait for Tarv1s to analyse your records.`,
        ["Tarv1s is not an emergency service and no data analysis was run."],
      ),
    };
  }
  if (
    currentUrgentSymptom ||
    currentKetoneDanger ||
    currentDkaConcern ||
    hasCurrentHighSpecificityDkaSymptom(prompt) ||
    ((INSULIN_NOT_LOWERING_HIGH_GLUCOSE.test(prompt) ||
      INSULIN_FAILURE_IMPLYING_HIGH_GLUCOSE.test(prompt) ||
      PERSISTENT_HIGH_GLUCOSE_AFTER_INSULIN.test(prompt) ||
      CORRECTION_NOT_SHIFTING_HIGH_GLUCOSE.test(prompt)) &&
      !isPureMedicalEducation(prompt))
  ) {
    const escalationDetail = reviewedUkDkaPack
      ? `${emergencyCare.emergencyAction.charAt(0).toUpperCase()}${emergencyCare.emergencyAction.slice(1)} immediately if blood ketones are over 3 mmol/L, urine ketones are over 2+, you cannot breathe, have a seizure, become unconscious, or you do not know the ketone level and have symptoms of diabetic ketoacidosis.`
      : `${emergencyCare.emergencyAction.charAt(0).toUpperCase()}${emergencyCare.emergencyAction.slice(1)} immediately if you cannot breathe, have a seizure, become unconscious, have symptoms of diabetic ketoacidosis, or your own emergency or sick-day plan says to seek emergency care.`;
    return {
      kind: "urgent",
      answer: answer(
        "Get urgent diabetes advice now",
        `Don't wait for Tarv1s to analyse your records. ${emergencyCare.urgentAdvice.charAt(0).toUpperCase()}${emergencyCare.urgentAdvice.slice(1)}. ${escalationDetail} Do not drive yourself. Follow your trusted diabetes emergency or sick-day plan while you get help.`,
        ["Tarv1s is not an emergency service and no data analysis was run."],
      ),
    };
  }
  if (
    AMBIGUOUS_CURRENT_HEALTH_READING.test(prompt) ||
    AMBIGUOUS_SPOKEN_HEALTH_READING.test(prompt)
  ) {
    const readingDetail = reviewedUkDkaPack
      ? `If blood ketones are over 3 mmol/L or urine ketones are over 2+ (for example +++), ${emergencyCare.emergencyAction} and do not drive yourself. If this is a low glucose reading such as ${formatGlucose(3.2, regional)}, follow your trusted hypo treatment plan now.`
      : `For a ketone result, follow your own diabetes emergency or sick-day plan and ${emergencyCare.urgentAdvice}. For a current low glucose result, follow your trusted hypo treatment plan now.`;
    return {
      kind: "urgent",
      answer: answer(
        "Clarify this reading now",
        `First confirm whether this is glucose, blood ketones or urine ketones. ${readingDetail} If you cannot identify the reading safely, ${emergencyCare.urgentAdvice}.`,
        [
          "Tarv1s could not safely infer the measurement type from this message.",
        ],
      ),
    };
  }
  if (hasDangerousCurrentGlucose(prompt)) {
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
