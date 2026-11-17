/**
 * Record questions Tarv1s answers on the phone from stored records, with no
 * AI request. The parser is conservative: when it is not sure, it returns
 * `undefined` and the existing pipeline runs.
 */

export type RecordedChangeKind = "site" | "sensor" | "insulin";

export type DeviceChangeQuestion = {
  kind: "device-change";
  /** The changes asked about, in a fixed order. */
  changes: RecordedChangeKind[];
};

export type RecordQuestion =
  | DeviceChangeQuestion
  | {
      /** The latest insulin-on-board estimate AAPS or Nightscout reported. */
      kind: "insulin-on-board";
    };

const SITE = /\b(?:sites?|pods?|cannulas?|infusion\s+sets?|sets?)\b/i;
const SENSOR = /\b(?:sensors?|cgms?|libre|dexcom)\b/i;
const INSULIN =
  /\b(?:insulin\s+(?:cartridges?|reservoirs?|change)|cartridges?|reservoirs?|refill(?:ed)?\s+(?:the\s+|my\s+)?(?:pump|insulin)|changed?\s+(?:the\s+|my\s+)?insulin)\b/i;
const CHANGE =
  /\b(?:chang(?:e|ed|es|ing)|replac(?:e|ed|ing)|swap(?:ped)?|start(?:ed)?|new|refill(?:ed)?|put\s+(?:in|on))\b/i;
const WHEN =
  /\b(?:when|last|how\s+old|age|how\s+long\s+ago|how\s+many\s+(?:days|hours))\b/i;
// Questions about the future or about what to do are not record questions.
const FORWARD =
  /\b(?:should|shall|need\s+to|do\s+i\s+need|due|next|overdue|how\s+often|recommend\w*|remind)\b/i;

const IOB = /\b(?:iob|insulin\s+on\s+board|active\s+insulin)\b/i;
// "Now" or a personal form; "What is IOB?" is a general question.
const IOB_CURRENT =
  /\b(?:my|do\s+i\s+have|have\s+i\s+got|i've\s+got|i\s+have|now|current(?:ly)?|right\s+now|at\s+the\s+moment|at\s+present)\b/i;
// A past time, a period or a summary belongs to the history pipeline.
const IOB_PAST_OR_PERIOD =
  /\b(?:was|were|had|ago|yesterday|today|tonight|overnight|night|morning|afternoon|evening|week|month|day|days|hours?|during|before|after|since|between|when|while|at\s+\d|average|mean|peak|highest|lowest|max(?:imum)?|min(?:imum)?|trend|chart|graph)\b/i;
const IOB_EXPLAIN = /\b(?:explain|mean|means|meaning|how\s+does|how\s+is|why|calculated?|work)\b/i;

function parseIobQuestion(text: string): RecordQuestion | undefined {
  if (!IOB.test(text) || !IOB_CURRENT.test(text)) return undefined;
  if (IOB_PAST_OR_PERIOD.test(text) || IOB_EXPLAIN.test(text)) return undefined;
  return { kind: "insulin-on-board" };
}

export function parseRecordQuestion(question: string): RecordQuestion | undefined {
  const text = question.replace(/[‘’]/g, "'");
  if (FORWARD.test(text)) return undefined;
  const iob = parseIobQuestion(text);
  if (iob) return iob;
  if (!CHANGE.test(text) || !WHEN.test(text)) return undefined;
  const changes: RecordedChangeKind[] = [];
  if (SITE.test(text) && !/\bsets?\s+(?:a|the|my)\s+(?:temp|target|profile)/i.test(text)) {
    changes.push("site");
  }
  if (SENSOR.test(text)) changes.push("sensor");
  if (INSULIN.test(text)) changes.push("insulin");
  return changes.length ? { kind: "device-change", changes } : undefined;
}
