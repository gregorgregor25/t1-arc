/**
 * One rule for "the past week" in every Tarv1s range parser.
 *
 * "past week", "the past week", "the last week" and "in/over/during the last
 * week" mean the last 7 local calendar days including today so far, the same
 * as "last 7 days". Bare "last week" or "previous week" (no "the") keeps
 * meaning the previous calendar week. "The last week of March" is a calendar
 * phrase, not a recent window, so it is left alone.
 */
const RECENT_WEEK_PHRASE =
  /\b(?:the\s+(?:last|past)\s+week|past\s+week)\b(?!\s+of\b)/gi;

export const RECENT_WEEK_DAYS = 7;

export interface RecentWeekPhrase {
  raw: string;
  start: number;
  end: number;
}

export function findRecentWeekPhrases(text: string): RecentWeekPhrase[] {
  return [...text.matchAll(RECENT_WEEK_PHRASE)].map((match) => ({
    raw: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function hasRecentWeekPhrase(text: string) {
  return findRecentWeekPhrases(text).length > 0;
}

/** True when `start`–`end` lies inside a recent-week phrase in `text`. */
export function insideRecentWeekPhrase(text: string, start: number, end: number) {
  return findRecentWeekPhrases(text).some(
    (phrase) => start >= phrase.start && end <= phrase.end,
  );
}
