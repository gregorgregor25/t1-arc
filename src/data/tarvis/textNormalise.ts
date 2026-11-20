/**
 * Text clean-up shared by the Tarv1s safety checks: the request preflight
 * (safety.ts, doseIntent.ts) and the hosted-reply guardrail (guardrails.ts,
 * generalEducation.ts).
 *
 * The checks read English words, ASCII digits and plain punctuation. People
 * and models can write the same words with look-alike characters: fullwidth
 * digits, zero-width joiners inside a word, Cyrillic or Greek letters that
 * look Latin, accents, non-breaking spaces and hyphens, or digits standing in
 * for letters ("h0w much 1nsulin"). This module maps those back to plain text
 * so a rule cannot be dodged by spelling alone.
 *
 * The result is used only for classification. Stored and displayed text is
 * never changed.
 *
 * Hermes: no lookbehind, named groups, Unicode property escapes or s/y/u/v/d
 * flags; every pattern is linear.
 */

/** Soft hyphen, zero-width characters, bidi controls, word joiners and the BOM. */
const FORMAT_CHARACTERS = /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
/** No-break and other typographic spaces. */
const UNUSUAL_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
/** Hyphens and minus signs. */
const DASHES = /[\u2010\u2011\u2212\ufe63\uff0d]/g;
/** Figure, en and em dashes and the horizontal bar break a clause: "2 U at breakfast\u2014but another unit". */
const LONG_DASHES = /\s*[\u2012-\u2015\ufe58]\s*/g;
const SINGLE_QUOTES = /[\u2018\u2019\u201a\u201b\u2032\u02bc`\u00b4]/g;
const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f\u2033]/g;
/** Fullwidth ASCII (U+FF01-U+FF5E), in case normalize() is unavailable. */
const FULLWIDTH = /[\uff01-\uff5e]/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Cyrillic and Greek letters that look like Latin letters. */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  // Cyrillic lower case
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y",
  "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l",
  "к": "k", "ѵ": "v", "ԛ": "q", "ԝ": "w", "є": "e", "ї": "i",
  // Cyrillic upper case
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H",
  "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "У": "Y",
  "І": "I", "Ј": "J", "Ѕ": "S", "Ӏ": "I",
  // Greek lower case
  "α": "a", "ο": "o", "ν": "v", "ι": "i", "κ": "k", "ρ": "p",
  "υ": "u", "τ": "t", "ε": "e",
  // Greek upper case
  "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I",
  "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
  "Υ": "Y", "Χ": "X",
};
/** A run of Latin, Greek or Cyrillic letters. */
const LETTER_RUN = /[A-Za-z\u0370-\u03ff\u0400-\u052f]+/g;
const LATIN_LETTER = /[A-Za-z]/;
const NON_LATIN_LETTER = /[\u0370-\u03ff\u0400-\u052f]/;

/**
 * Maps look-alike letters in a word that mixes scripts ("unіts" with a
 * Cyrillic i) or that is spelled entirely in look-alikes ("ТАКЕ"). Ordinary
 * Russian or Greek words keep their letters, so the non-English checks still
 * see them.
 */
function mapHomoglyphs(text: string) {
  if (!NON_LATIN_LETTER.test(text)) return text;
  return text.replace(LETTER_RUN, (run) => {
    if (!NON_LATIN_LETTER.test(run)) return run;
    let mapped = "";
    let allMappable = true;
    for (const character of run) {
      const latin = HOMOGLYPHS[character];
      if (latin === undefined && NON_LATIN_LETTER.test(character)) allMappable = false;
      mapped += latin ?? character;
    }
    return LATIN_LETTER.test(run) || allMappable ? mapped : run;
  });
}

/** Words whose letters are spaced out ("i.n.s.u.l.i.n", "t a k e") are joined only when they spell one of these. */
const SPACED_WORDS = new Set([
  "insulin", "take", "dose", "bolus", "units", "unit", "inject", "basal", "carbs", "give",
  "correct", "correction", "much", "many", "should", "how",
]);
const SPACED_LETTERS = /\b[a-z](?:[.\s-]+[a-z]\b){2,}/gi;

function joinSpacedLetters(text: string) {
  return text.replace(SPACED_LETTERS, (run) => {
    const joined = run.replace(/[.\s-]+/g, "");
    if (SPACED_WORDS.has(joined.toLowerCase())) return joined;
    // "should i t a k e": a lone "i" or "a" can run into the spaced word.
    const rest = joined.slice(1);
    return /^[ia]$/i.test(joined[0] ?? "") && SPACED_WORDS.has(rest.toLowerCase()) ? `${joined[0]} ${rest}` : run;
  });
}

/** A token that mixes letters and digits, such as "h0w", "1nsulin" or "t4ke". */
const MIXED_TOKEN = /\b[a-z0-9]*(?:[a-z][0-9]|[0-9][a-z])[a-z0-9]*\b/gi;
/** Amounts, times, ordinals and device names that legitimately mix digits and letters. */
const KEEP_MIXED_TOKEN =
  /^(?:\d+(?:u|iu|g|kg|mg|ml|l|am|pm|h|hr|hrs|min|mins|m|s|d|w|y|x|k|th|st|nd|rd|mmol|units?|grams?|hours?|days?|weeks?|e)|[a-z]{1,2}\d+|[a-z]+\d+|t1d?|t2d?|hba1c|a1c|g[4-7]|mp\d|\d+[a-z]{1,2}\d*)$/i;
const LEET: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/** "h0w much 1nsulin sh0uld i t4ke" reads as "how much insulin should i take". */
function mapLeetspeak(text: string) {
  return text.replace(MIXED_TOKEN, (token) => {
    if (KEEP_MIXED_TOKEN.test(token)) return token;
    // A digit that sits between letters, or that starts a word of letters, stands for a letter.
    if (!/[a-z]\d|\d[a-z]{2,}/i.test(token)) return token;
    return token.replace(/\d/g, (digit) => LEET[digit] ?? digit);
  });
}

export function safeNormalize(text: string, form: "NFKC" | "NFKD" | "NFC") {
  try {
    return typeof text.normalize === "function" ? text.normalize(form) : text;
  } catch {
    return text;
  }
}

export interface SafetyTextOptions {
  /** Read digits inside words as letters ("t4ke"). On by default. */
  leetspeak?: boolean;
  /**
   * Zero-width and other hidden format characters are removed by default, so
   * "un\u200bits" reads "units". "break" reads each as a break between two
   * phrases instead, as the original characters do for a reader.
   */
  formatCharacters?: "remove" | "break";
}

/**
 * Plain-text form of `text` for the safety checks: compatibility forms,
 * hidden characters, look-alike letters, accents, dashes, quotes and
 * spaced-out or digit-substituted dose words are all mapped to plain ASCII
 * where an English rule can read them.
 */
export function normaliseSafetyText(text: string, options: SafetyTextOptions = {}) {
  let value = safeNormalize(text, "NFKC")
    .replace(FULLWIDTH, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(FORMAT_CHARACTERS, options.formatCharacters === "break" ? "\n" : "")
    .replace(UNUSUAL_SPACES, " ")
    .replace(DASHES, "-")
    .replace(LONG_DASHES, " - ")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"');
  value = mapHomoglyphs(value);
  // Accents are dropped ("unités" -> "unites"); recomposing keeps Korean
  // syllables and other precomposed scripts whole for the script check.
  value = safeNormalize(safeNormalize(value, "NFKD").replace(COMBINING_MARKS, ""), "NFC");
  value = joinSpacedLetters(value);
  if (options.leetspeak !== false) value = mapLeetspeak(value);
  return value.trim();
}

const HAS_FORMAT_CHARACTER = /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;

/**
 * The readings of `text` the safety checks classify: one, or two when the
 * text holds a hidden format character that may sit inside a word or
 * between two words. The caller keeps the most cautious result.
 */
export function safetyTextReadings(text: string, options: Omit<SafetyTextOptions, "formatCharacters"> = {}) {
  const removed = normaliseSafetyText(text, options);
  if (!HAS_FORMAT_CHARACTER.test(text)) return [removed];
  return [removed, normaliseSafetyText(text, { ...options, formatCharacters: "break" })];
}
