import {
  TarvisClockWindowLiteral,
  TarvisComparisonLiteral,
  TarvisDateLiteral,
  TarvisDurationLiteral,
  TarvisGlucoseUnit,
  TarvisLiteralExtraction,
  TarvisNegationLiteral,
  TarvisNumberLiteral,
  TarvisRecurringClockWindow,
  TarvisThresholdLiteral,
  TarvisTimeLiteral,
  TarvisUnitLiteral,
} from './types';

const SMALL_NUMBER_WORDS: Record<string, number> = {
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

const NUMBER_WORD_PATTERN = Object.keys(SMALL_NUMBER_WORDS)
  .concat(['hundred', 'thousand'])
  .join('|');

const NUMBER_WORD_SEQUENCE = new RegExp(
  `\\b(?:${NUMBER_WORD_PATTERN})(?:(?:[\\s-]+(?:and[\\s-]+)?)(?:${NUMBER_WORD_PATTERN}))*\\b`,
  'gi',
);

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const CLOCK_TOKEN =
  '(?:midnight|noon|(?:[01]?\\d|2[0-4])(?::[0-5]\\d)?(?:\\s*(?:a\\.?\\s*m\\.?|p\\.?\\s*m\\.?))?)';

function parseNumberWords(raw: string): number | null {
  const words = raw
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((word) => word && word !== 'and');
  let total = 0;
  let current = 0;
  for (const word of words) {
    const small = SMALL_NUMBER_WORDS[word];
    if (small !== undefined) {
      current += small;
    } else if (word === 'hundred') {
      current = Math.max(1, current) * 100;
    } else if (word === 'thousand') {
      total += Math.max(1, current) * 1_000;
      current = 0;
    } else {
      return null;
    }
  }
  return total + current;
}

function spansOverlap(
  left: Pick<TarvisNumberLiteral, 'start' | 'end'>,
  right: Pick<TarvisNumberLiteral, 'start' | 'end'>,
) {
  return left.start < right.end && right.start < left.end;
}

export function extractTarvisNumberLiterals(
  question: string,
): TarvisNumberLiteral[] {
  const literals: TarvisNumberLiteral[] = [];
  for (const match of question.matchAll(
    /(?<![A-Za-z0-9])\d+(?:[.,]\d+)?(?![\d.,])/g,
  )) {
    const raw = match[0];
    const start = match.index;
    const value = Number(raw.replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    literals.push({
      raw,
      start,
      end: start + raw.length,
      value,
      notation: 'digits',
    });
  }

  for (const match of question.matchAll(NUMBER_WORD_SEQUENCE)) {
    const raw = match[0];
    const start = match.index;
    const value = parseNumberWords(raw);
    if (value === null) continue;
    const literal: TarvisNumberLiteral = {
      raw,
      start,
      end: start + raw.length,
      value,
      notation: 'words',
    };
    if (!literals.some((existing) => spansOverlap(existing, literal))) {
      literals.push(literal);
    }
  }

  return literals.sort((left, right) => left.start - right.start);
}

function durationUnit(raw: string): TarvisDurationLiteral['unit'] | null {
  const normalized = raw.toLowerCase().replace(/\./g, '');
  if (/^(?:minute|minutes|min|mins|m)$/.test(normalized)) return 'minute';
  if (/^(?:hour|hours|hr|hrs|h)$/.test(normalized)) return 'hour';
  if (/^(?:day|days|d)$/.test(normalized)) return 'day';
  if (/^(?:week|weeks|wk|wks|w)$/.test(normalized)) return 'week';
  if (/^(?:month|months|mo|mos)$/.test(normalized)) return 'month';
  return null;
}

function extractDurations(
  question: string,
  numbers: TarvisNumberLiteral[],
): TarvisDurationLiteral[] {
  const durations: TarvisDurationLiteral[] = [];
  for (const number of numbers) {
    const suffix = question.slice(number.end, number.end + 18);
    const unitMatch = /^(?:\s*|-)(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|wks?|w|months?|mos?)\b/i.exec(
      suffix,
    );
    if (!unitMatch) continue;
    const unitRaw = unitMatch[1];
    if (!unitRaw) continue;
    const unit = durationUnit(unitRaw);
    if (!unit) continue;
    const end = number.end + unitMatch[0].length;
    durations.push({
      raw: question.slice(number.start, end),
      start: number.start,
      end,
      value: number.value,
      unit,
      number,
    });
  }

  for (const match of question.matchAll(/\b(?:a\s+)?fortnight\b/gi)) {
    const raw = match[0];
    const start = match.index;
    durations.push({
      raw,
      start,
      end: start + raw.length,
      value: 2,
      unit: 'week',
      number: {
        raw: raw.toLowerCase().startsWith('a ') ? 'a' : 'fortnight',
        start,
        end: start + raw.length,
        value: 2,
        notation: 'words',
      },
    });
  }
  return durations.sort((left, right) => left.start - right.start);
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function localDateParts(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function shiftDate(value: string, amount: number) {
  const [year, month, day] = value.split('-').map(Number);
  const shifted = new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + amount),
  );
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function extractDates(
  question: string,
  now: number,
  timezone: string,
): TarvisDateLiteral[] {
  const dates: TarvisDateLiteral[] = [];
  const push = (literal: TarvisDateLiteral) => {
    if (!dates.some((existing) => spansOverlap(existing, literal))) {
      dates.push(literal);
    }
  };

  for (const match of question.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const raw = match[0];
    const start = match.index;
    const value = dateKey(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!value) continue;
    push({
      raw,
      start,
      end: start + raw.length,
      kind: 'absolute',
      date: value,
      yearWasInferred: false,
    });
  }

  for (const match of question.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const raw = match[0];
    const start = match.index;
    const value = dateKey(Number(match[3]), Number(match[2]), Number(match[1]));
    if (!value) continue;
    push({
      raw,
      start,
      end: start + raw.length,
      kind: 'absolute',
      date: value,
      yearWasInferred: false,
    });
  }

  const monthPattern = Object.keys(MONTHS).join('|');
  const namedDatePattern = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:\\s+(\\d{4}))?\\b`,
    'gi',
  );
  const current = localDateParts(now, timezone);
  for (const match of question.matchAll(namedDatePattern)) {
    const raw = match[0];
    const start = match.index;
    const monthName = match[2]?.toLowerCase();
    const month = monthName ? MONTHS[monthName] : undefined;
    const explicitYear = match[3] ? Number(match[3]) : null;
    if (!month) continue;
    const value = dateKey(
      explicitYear ?? current.year,
      month,
      Number(match[1]),
    );
    if (!value) continue;
    push({
      raw,
      start,
      end: start + raw.length,
      kind: 'absolute',
      date: value,
      yearWasInferred: explicitYear === null,
    });
  }

  const today = dateKey(current.year, current.month, current.day)!;
  for (const match of question.matchAll(/\b(today|yesterday)\b/gi)) {
    const raw = match[0];
    const start = match.index;
    push({
      raw,
      start,
      end: start + raw.length,
      kind: 'relative',
      date: raw.toLowerCase() === 'today' ? today : shiftDate(today, -1),
      yearWasInferred: false,
    });
  }

  return dates.sort((left, right) => left.start - right.start);
}

function parseMeridiem(raw: string) {
  return raw.toLowerCase().replace(/[.\s]/g, '');
}

function parseClockToken(raw: string, start: number): TarvisTimeLiteral | null {
  const trimmed = raw.trim();
  const leading = raw.indexOf(trimmed);
  const literalStart = start + Math.max(0, leading);
  const lower = trimmed.toLowerCase();
  if (lower === 'midnight') {
    return {
      raw: trimmed,
      start: literalStart,
      end: literalStart + trimmed.length,
      minuteOfDay: 0,
      candidates: [0],
      notation: 'keyword',
    };
  }
  if (lower === 'noon') {
    return {
      raw: trimmed,
      start: literalStart,
      end: literalStart + trimmed.length,
      minuteOfDay: 12 * 60,
      candidates: [12 * 60],
      notation: 'keyword',
    };
  }

  const clock = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?$/i.exec(
    trimmed,
  );
  if (!clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2] ?? 0);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null;
  const meridiem = clock[3] ? parseMeridiem(clock[3]) : null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const minuteOfDay =
      ((hour % 12) + (meridiem === 'pm' ? 12 : 0)) * 60 + minute;
    return {
      raw: trimmed,
      start: literalStart,
      end: literalStart + trimmed.length,
      minuteOfDay,
      candidates: [minuteOfDay],
      notation: 'twelve_hour',
    };
  }
  if (hour === 0 || hour > 12 || trimmed.includes(':')) {
    const minuteOfDay = hour * 60 + minute;
    const hasLeadingZero = /^0\d:/.test(trimmed);
    if (
      hour <= 12 &&
      trimmed.includes(':') &&
      hour !== 0 &&
      !hasLeadingZero
    ) {
      const candidates = [minuteOfDay, minuteOfDay + 12 * 60].filter(
        (value) => value < 24 * 60,
      );
      return {
        raw: trimmed,
        start: literalStart,
        end: literalStart + trimmed.length,
        minuteOfDay: null,
        candidates,
        notation: 'ambiguous',
      };
    }
    return {
      raw: trimmed,
      start: literalStart,
      end: literalStart + trimmed.length,
      minuteOfDay,
      candidates: [minuteOfDay],
      notation: 'twenty_four_hour',
    };
  }
  const am = (hour % 12) * 60 + minute;
  const pm = am + 12 * 60;
  return {
    raw: trimmed,
    start: literalStart,
    end: literalStart + trimmed.length,
    minuteOfDay: null,
    candidates: [am, pm],
    notation: 'ambiguous',
  };
}

function withResolvedTime(
  literal: TarvisTimeLiteral,
  minuteOfDay: number,
  inference: string,
): TarvisTimeLiteral {
  return {
    ...literal,
    minuteOfDay,
    candidates: [minuteOfDay],
    notation: literal.notation,
    inference,
  };
}

function inferWindowTimes(
  start: TarvisTimeLiteral,
  end: TarvisTimeLiteral,
): [TarvisTimeLiteral, TarvisTimeLiteral] {
  let resolvedStart = start;
  let resolvedEnd = end;
  if (start.minuteOfDay !== null && end.minuteOfDay === null) {
    let candidate: number | undefined;
    if (start.minuteOfDay === 0) {
      candidate = end.candidates.find((value) => value <= 12 * 60);
    } else if (start.minuteOfDay === 12 * 60) {
      candidate = end.candidates.find((value) => value >= 12 * 60);
    } else if (start.minuteOfDay > 12 * 60) {
      candidate = end.candidates.find((value) => value < 12 * 60);
    }
    if (candidate !== undefined) {
      resolvedEnd = withResolvedTime(
        end,
        candidate,
        `Meridiem inferred from ${start.raw}`,
      );
    }
  }
  if (resolvedStart.minuteOfDay === null && resolvedEnd.minuteOfDay !== null) {
    const endValue = resolvedEnd.minuteOfDay;
    let candidate: number | undefined;
    if (endValue < 12 * 60) {
      candidate = resolvedStart.candidates.find((value) => value > endValue);
    } else if (endValue > 12 * 60) {
      candidate = [...resolvedStart.candidates]
        .reverse()
        .find((value) => value < endValue);
    }
    if (candidate !== undefined) {
      resolvedStart = withResolvedTime(
        resolvedStart,
        candidate,
        `Meridiem inferred from ${resolvedEnd.raw}`,
      );
    }
  }
  return [resolvedStart, resolvedEnd];
}

function clockTime(minuteOfDay: number) {
  const normalized = minuteOfDay === 24 * 60 ? 0 : minuteOfDay;
  return {
    hour: Math.floor(normalized / 60),
    minute: normalized % 60,
  };
}

function extractClockWindows(question: string): TarvisClockWindowLiteral[] {
  const pattern = new RegExp(
    `\\b(?:(?:between\\s+|from\\s+)(${CLOCK_TOKEN})\\s+(?:and|to|until|till|through|-)\\s+(${CLOCK_TOKEN})|(${CLOCK_TOKEN})\\s+(?:to|until|till|through|-)\\s+(${CLOCK_TOKEN}))`,
    'gi',
  );
  const windows: TarvisClockWindowLiteral[] = [];
  for (const match of question.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index;
    const before = question.slice(Math.max(0, start - 64), start);
    const after = question.slice(start + raw.length, start + raw.length + 16);
    const looksLikeGlucoseBand =
      /^\s*(?:mmol(?:\s*\/?\s*l)?|mg\s*\/?\s*dl)\b/i.test(after) ||
      /\b(?:percentage|percent|time in range|target range)\b[\s\S]*$/i.test(
        before,
      ) ||
      /\b(?:glucose\s+)?readings?\s+(?:was|were)\s*$/i.test(before);
    if (looksLikeGlucoseBand) continue;
    const startRaw = match[1] ?? match[3];
    const endRaw = match[2] ?? match[4];
    if (!startRaw || !endRaw) continue;
    const startRelative = raw.indexOf(startRaw);
    const endRelative = raw.lastIndexOf(endRaw);
    const parsedStart = parseClockToken(startRaw, start + startRelative);
    const parsedEnd = parseClockToken(endRaw, start + endRelative);
    if (!parsedStart || !parsedEnd) continue;
    const [startTime, endTime] = inferWindowTimes(parsedStart, parsedEnd);
    let window: TarvisRecurringClockWindow | null = null;
    let ambiguity: string | undefined;
    if (startTime.minuteOfDay === 24 * 60) {
      ambiguity = '24:00 can only be used as the end of a clock window.';
    } else if (startTime.minuteOfDay === null || endTime.minuteOfDay === null) {
      ambiguity = 'One or both clock times need an a.m./p.m. qualifier.';
    } else if (startTime.minuteOfDay === endTime.minuteOfDay) {
      ambiguity = 'The start and end time are identical.';
    } else {
      window = {
        start: clockTime(startTime.minuteOfDay),
        end: clockTime(endTime.minuteOfDay),
        crossesMidnight:
          endTime.minuteOfDay <= startTime.minuteOfDay ||
          endTime.minuteOfDay === 24 * 60,
        occurrenceAnchor: 'start_date',
      };
    }
    windows.push({
      raw,
      start,
      end: start + raw.length,
      startTime,
      endTime,
      window,
      ...(ambiguity ? { ambiguity } : {}),
    });
  }
  return windows;
}

function extractTimes(
  question: string,
  windows: TarvisClockWindowLiteral[],
): TarvisTimeLiteral[] {
  const times: TarvisTimeLiteral[] = [];
  const push = (literal: TarvisTimeLiteral | null) => {
    if (!literal) return;
    if (!times.some((existing) => spansOverlap(existing, literal))) {
      times.push(literal);
    }
  };
  for (const window of windows) {
    push(window.startTime);
    push(window.endTime);
  }
  for (const match of question.matchAll(/\b(?:midnight|noon)\b/gi)) {
    push(parseClockToken(match[0], match.index));
  }
  for (const match of question.matchAll(
    /\b(?:[01]?\d|2[0-4])(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)(?![a-z])/gi,
  )) {
    push(parseClockToken(match[0], match.index));
  }
  for (const match of question.matchAll(/\b(?:[01]?\d|2[0-4]):[0-5]\d\b/g)) {
    push(parseClockToken(match[0], match.index));
  }
  return times.sort((left, right) => left.start - right.start);
}

function extractUnits(question: string): TarvisUnitLiteral[] {
  const units: TarvisUnitLiteral[] = [];
  for (const match of question.matchAll(/\bmmol(?:\s*\/?\s*l)?\b/gi)) {
    const raw = match[0];
    const start = match.index;
    units.push({ raw, start, end: start + raw.length, unit: 'mmol/L' });
  }
  for (const match of question.matchAll(/\bmg\s*\/?\s*d[lL]\b/gi)) {
    const raw = match[0];
    const start = match.index;
    units.push({ raw, start, end: start + raw.length, unit: 'mg/dL' });
  }
  return units.sort((left, right) => left.start - right.start);
}

function thresholdOperator(
  raw: string,
): TarvisThresholdLiteral['operator'] | null {
  if (/^(?:below|under|less than|lower than)$/i.test(raw)) return 'lt';
  if (/^(?:above|over|greater than|higher than)$/i.test(raw)) return 'gt';
  if (/^(?:at most|no more than)$/i.test(raw)) return 'lte';
  if (/^(?:at least|no less than)$/i.test(raw)) return 'gte';
  return null;
}

function extractThresholds(
  question: string,
  numbers: TarvisNumberLiteral[],
  units: TarvisUnitLiteral[],
): TarvisThresholdLiteral[] {
  const thresholds: TarvisThresholdLiteral[] = [];
  for (const number of numbers) {
    const beforeStart = Math.max(0, number.start - 24);
    const before = question.slice(beforeStart, number.start);
    const operatorMatch =
      /(below|under|less than|lower than|above|over|greater than|higher than|at most|no more than|at least|no less than)\s*$/i.exec(
        before,
      );
    if (!operatorMatch) continue;
    const operatorRaw = operatorMatch[1];
    if (!operatorRaw) continue;
    const operator = thresholdOperator(operatorRaw);
    if (!operator) continue;
    const start = beforeStart + (operatorMatch.index ?? 0);
    const adjacentUnit = units.find(
      (unit) => unit.start >= number.end && unit.start - number.end <= 3,
    );
    const end = adjacentUnit?.end ?? number.end;
    thresholds.push({
      raw: question.slice(start, end),
      start,
      end,
      operator,
      value: number.value,
      unit: adjacentUnit?.unit ?? null,
      number,
    });
  }

  for (let index = 0; index < numbers.length - 1; index += 1) {
    const lower = numbers[index];
    const upper = numbers[index + 1];
    if (!lower || !upper) continue;
    const beforeStart = Math.max(0, lower.start - 40);
    const before = question.slice(beforeStart, lower.start);
    if (!/\bbetween\s*$/i.test(before)) continue;
    if (!/^\s*and\s*$/i.test(question.slice(lower.end, upper.start))) continue;
    const adjacentUnit = units.find(
      (unit) => unit.start >= upper.end && unit.start - upper.end <= 3,
    );
    const context = question.slice(beforeStart, upper.end).toLowerCase();
    if (
      !adjacentUnit &&
      !/\b(?:range|glucose|readings?|levels?|blood sugar|percentage|percent)\b/.test(context)
    ) {
      continue;
    }
    const betweenMatch = /\bbetween\s*$/i.exec(before);
    const rangeStart = beforeStart + (betweenMatch?.index ?? before.length);
    const rangeEnd = adjacentUnit?.end ?? upper.end;
    const unit = adjacentUnit?.unit ?? null;
    thresholds.push(
      {
        raw: question.slice(rangeStart, lower.end),
        start: rangeStart,
        end: lower.end,
        operator: 'gte',
        value: lower.value,
        unit,
        number: lower,
      },
      {
        raw: question.slice(lower.end, rangeEnd),
        start: lower.end,
        end: rangeEnd,
        operator: 'lte',
        value: upper.value,
        unit,
        number: upper,
      },
    );
  }
  return thresholds.sort((left, right) => left.start - right.start);
}

function extractNegations(question: string): TarvisNegationLiteral[] {
  const results: TarvisNegationLiteral[] = [];
  const patterns: Array<[RegExp, TarvisNegationLiteral['kind']]> = [
    [/\bnot\b/gi, 'not'],
    [/\b(?:exclude|excluding|instead of|rather than)\b/gi, 'exclude'],
    [/\bwithout\b/gi, 'without'],
    [/\bexcept(?: for)?\b/gi, 'except'],
    [/\b(?:no,?\s+i meant|i mean)\b/gi, 'correction'],
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of question.matchAll(pattern)) {
      const raw = match[0];
      const start = match.index;
      results.push({ raw, start, end: start + raw.length, kind });
    }
  }
  return results.sort((left, right) => left.start - right.start);
}

function extractComparisons(question: string): TarvisComparisonLiteral[] {
  const results: TarvisComparisonLiteral[] = [];
  const patterns: Array<[RegExp, TarvisComparisonLiteral['kind']]> = [
    [/\bcompar(?:e|ed|ing)(?:\s+(?:to|with|against))?\b/gi, 'compare'],
    [/\b(?:versus|vs\.?)\b/gi, 'versus'],
    [/\bprevious\s+(?:equal\s+)?(?:period|window|week|month|days?)\b/gi, 'previous_period'],
    [/\b(?:the\s+)?(?:same\s+)?(?:number\s+of\s+days\s+)?before\s+that\b/gi, 'previous_period'],
    [/\bbefore\s+and\s+after\b/gi, 'before_after'],
    [/\b(?:higher|lower|more|less|better|worse)\s+than\b/gi, 'relative_difference'],
  ];
  for (const [pattern, kind] of patterns) {
    for (const match of question.matchAll(pattern)) {
      const raw = match[0];
      const start = match.index;
      results.push({ raw, start, end: start + raw.length, kind });
    }
  }
  return results.sort((left, right) => left.start - right.start);
}

export interface ExtractTarvisLiteralOptions {
  now?: number;
  timezone?: string;
}

export function extractTarvisLiterals(
  question: string,
  options: ExtractTarvisLiteralOptions = {},
): TarvisLiteralExtraction {
  const now = options.now ?? Date.now();
  const timezone = options.timezone ?? 'Europe/London';
  const numbers = extractTarvisNumberLiterals(question);
  const units = extractUnits(question);
  const clockWindows = extractClockWindows(question);
  return {
    numbers,
    durations: extractDurations(question, numbers),
    dates: extractDates(question, now, timezone),
    times: extractTimes(question, clockWindows),
    clockWindows,
    units,
    thresholds: extractThresholds(question, numbers, units),
    negations: extractNegations(question),
    comparisons: extractComparisons(question),
  };
}

export function glucoseUnitFromLiteral(
  unit: TarvisUnitLiteral | undefined,
  fallback: TarvisGlucoseUnit,
): TarvisGlucoseUnit {
  return unit?.unit ?? fallback;
}
