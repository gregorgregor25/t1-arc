import { buildGlucoseProfile, type GlucoseProfile } from './glucoseProfile';
import { presentGlucoseRangeStatistics } from './glucoseRangePresentation';
import {
  calculateGlucoseRangeSummary,
  CONSENSUS_GLUCOSE_THRESHOLDS,
  formatGlucoseThreshold,
} from './glucoseRanges';
import { DEFAULT_OBSERVATION_GAP_MS } from './glucoseStatistics';
import { describeTimeZone, formatClock, formatDay } from './exportTime';
import type { GlucoseReading, TimeRange } from './models';
import type { PeriodSummary } from './periodSummary';
import {
  carbSummaryLines,
  formatGlucoseSpread,
  insulinSummaryLines,
  periodLabel,
  type SummarySettings,
} from './periodSummaryText';
import { formatGlucose, formatRegionalNumber, glucoseUnitLabel } from './regionalFormat';
import { recordSourceLabels } from './recordSourceLabels';
import { addDays, type DateKey, toDateKey, zonedDateTimeToTimestamp } from './time';

export const CLINIC_REPORT_DEFAULT_DAYS = 14;

export interface ClinicReportInput {
  summary: PeriodSummary;
  /** Readings for the period (already the same set used for `summary`). */
  glucose: readonly GlucoseReading[];
  settings: SummarySettings;
  generatedAt: number;
}

export interface ClinicReport {
  html: string;
  /** Section ids actually included, in order. */
  sections: ClinicReportSection[];
  fileName: string;
}

export type ClinicReportSection = 'glucose' | 'typical-day' | 'daily' | 'insulin-carbs';

const Y_MIN_MMOL = 2;
const Y_MAX_MMOL = 22;
const COLOURS = {
  text: '#20232a',
  muted: '#4b5260',
  grid: '#d5d9e0',
  target: '#e3f2e6',
  outer: '#c9d6f0',
  inner: '#8faadc',
  median: '#1f3f80',
  trace: '#3156a5',
  bands: {
    veryLow: '#a3192b',
    low: '#e0525f',
    inRange: '#3a9a5b',
    high: '#e9a23b',
    veryHigh: '#c46a1a',
  },
} as const;

export function escapeReportHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

const esc = escapeReportHtml;

function fixed(value: number) {
  return Math.round(value * 10) / 10;
}

function yFor(mmolL: number, top: number, height: number) {
  const clamped = Math.min(Y_MAX_MMOL, Math.max(Y_MIN_MMOL, mmolL));
  return fixed(top + height - ((clamped - Y_MIN_MMOL) / (Y_MAX_MMOL - Y_MIN_MMOL)) * height);
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Contiguous runs of bins that have percentiles. */
function profileRuns(profile: GlucoseProfile) {
  const runs: GlucoseProfile['bins'][] = [];
  let current: GlucoseProfile['bins'] = [];
  profile.bins.forEach((bin) => {
    if (bin.median === undefined) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push(bin);
    }
  });
  if (current.length) runs.push(current);
  return runs;
}

/** Typical-day chart: median with middle-50% and middle-80% bands. */
export function typicalDaySvg(profile: GlucoseProfile, settings: SummarySettings): string {
  const left = 44;
  const right = 632;
  const top = 12;
  const height = 176;
  const width = right - left;
  const xFor = (minute: number) => fixed(left + (minute / 1440) * width);
  const center = (bin: GlucoseProfile['bins'][number]) => bin.startMinute + profile.binMinutes / 2;
  const t = CONSENSUS_GLUCOSE_THRESHOLDS;
  const ticks = [t.veryLowBelow.mmolL, t.rangeLower.mmolL, t.rangeUpper.mmolL, t.veryHighAbove.mmolL];
  const band = (run: GlucoseProfile['bins'], upper: 'p90' | 'p75', lower: 'p10' | 'p25') => {
    const forward = run.map((bin) => `${xFor(center(bin))},${yFor(bin[upper]!, top, height)}`);
    const back = [...run].reverse().map((bin) => `${xFor(center(bin))},${yFor(bin[lower]!, top, height)}`);
    if (run.length === 1) {
      const bin = run[0]!;
      const x0 = xFor(bin.startMinute);
      const x1 = xFor(bin.startMinute + profile.binMinutes);
      return `${x0},${yFor(bin[upper]!, top, height)} ${x1},${yFor(bin[upper]!, top, height)} ${x1},${yFor(bin[lower]!, top, height)} ${x0},${yFor(bin[lower]!, top, height)}`;
    }
    return [...forward, ...back].join(' ');
  };
  const runs = profileRuns(profile);
  const parts: string[] = [];
  parts.push(`<rect x="${left}" y="${yFor(t.rangeUpper.mmolL, top, height)}" width="${width}" height="${fixed(yFor(t.rangeLower.mmolL, top, height) - yFor(t.rangeUpper.mmolL, top, height))}" fill="${COLOURS.target}"/>`);
  ticks.forEach((mmolL) => {
    const y = yFor(mmolL, top, height);
    parts.push(`<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="${COLOURS.grid}"/>`);
    parts.push(`<text x="${left - 6}" y="${fixed(y + 4)}" text-anchor="end" font-size="10" fill="${COLOURS.muted}">${esc(formatGlucoseThreshold(mmolL, settings, { withUnit: false }))}</text>`);
  });
  for (let hour = 0; hour <= 24; hour += 3) {
    const x = xFor(hour * 60);
    parts.push(`<line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" stroke="${COLOURS.grid}" stroke-dasharray="2 3"/>`);
    parts.push(`<text x="${x}" y="${top + height + 14}" text-anchor="middle" font-size="10" fill="${COLOURS.muted}">${hourLabel(hour % 24)}</text>`);
  }
  runs.forEach((run) => {
    parts.push(`<polygon points="${band(run, 'p90', 'p10')}" fill="${COLOURS.outer}"/>`);
    parts.push(`<polygon points="${band(run, 'p75', 'p25')}" fill="${COLOURS.inner}"/>`);
    if (run.length === 1) {
      const bin = run[0]!;
      const y = yFor(bin.median!, top, height);
      parts.push(`<line x1="${xFor(bin.startMinute)}" x2="${xFor(bin.startMinute + profile.binMinutes)}" y1="${y}" y2="${y}" stroke="${COLOURS.median}" stroke-width="2"/>`);
    } else {
      parts.push(`<polyline points="${run.map((bin) => `${xFor(center(bin))},${yFor(bin.median!, top, height)}`).join(' ')}" fill="none" stroke="${COLOURS.median}" stroke-width="2"/>`);
    }
  });
  parts.push(`<text x="4" y="${top + 4}" font-size="10" fill="${COLOURS.muted}">${esc(glucoseUnitLabel(settings.glucoseUnit))}</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 210" role="img" aria-label="Typical day: median glucose with the middle 50% and middle 80% of readings at each time of day" style="width:100%;height:auto">${parts.join('')}</svg>`;
}

interface DayWindow {
  date: DateKey;
  /** Start of the natural local day; used for x positions. */
  dayStart: number;
  dayEnd: number;
  /** The part of the day inside the report period. */
  range: TimeRange;
}

export function reportDays(range: TimeRange, timeZone: string): DayWindow[] {
  const days: DayWindow[] = [];
  let date = toDateKey(range.start, timeZone);
  for (let guard = 0; guard < 400; guard += 1) {
    const dayStart = zonedDateTimeToTimestamp(date, 0, 0, 0, timeZone);
    if (dayStart >= range.end) break;
    const dayEnd = zonedDateTimeToTimestamp(addDays(date, 1), 0, 0, 0, timeZone);
    const clipped = { start: Math.max(dayStart, range.start), end: Math.min(dayEnd, range.end) };
    if (clipped.end > clipped.start) days.push({ date, dayStart, dayEnd, range: clipped });
    date = addDays(date, 1);
  }
  return days;
}

/** Five-minute averages keep a dense day readable without inventing values. */
function fiveMinutePoints(readings: readonly GlucoseReading[], range: TimeRange) {
  const buckets = new Map<number, { total: number; count: number; first: number }>();
  readings.forEach((reading) => {
    if (reading.timestamp < range.start || reading.timestamp >= range.end) return;
    const key = Math.floor(reading.timestamp / 300_000);
    const bucket = buckets.get(key) ?? { total: 0, count: 0, first: reading.timestamp };
    bucket.total += reading.mmolL;
    bucket.count += 1;
    bucket.first = Math.min(bucket.first, reading.timestamp);
    buckets.set(key, bucket);
  });
  return [...buckets.values()]
    .map((bucket) => ({ timestamp: bucket.first, mmolL: bucket.total / bucket.count }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function dailyTraceSvg(readings: readonly GlucoseReading[], day: DayWindow): string {
  const w = 120;
  const h = 40;
  const t = CONSENSUS_GLUCOSE_THRESHOLDS;
  const span = day.dayEnd - day.dayStart;
  const xFor = (timestamp: number) => fixed(((timestamp - day.dayStart) / span) * w);
  const points = fiveMinutePoints(readings, day.range);
  const segments: string[][] = [];
  let current: string[] = [];
  let previous: number | undefined;
  points.forEach((point) => {
    if (previous !== undefined && point.timestamp - previous > DEFAULT_OBSERVATION_GAP_MS) {
      if (current.length) segments.push(current);
      current = [];
    }
    current.push(`${xFor(point.timestamp)},${yFor(point.mmolL, 0, h)}`);
    previous = point.timestamp;
  });
  if (current.length) segments.push(current);
  const lines = segments.map((segment) =>
    segment.length === 1
      ? `<circle cx="${segment[0]!.split(',')[0]}" cy="${segment[0]!.split(',')[1]}" r="1" fill="${COLOURS.trace}"/>`
      : `<polyline points="${segment.join(' ')}" fill="none" stroke="${COLOURS.trace}" stroke-width="1"/>`,
  );
  const upper = yFor(t.rangeUpper.mmolL, 0, h);
  const lower = yFor(t.rangeLower.mmolL, 0, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="width:100%;height:auto"><rect x="0" y="${upper}" width="${w}" height="${fixed(lower - upper)}" fill="${COLOURS.target}"/>${lines.join('')}</svg>`;
}

function percent(value: number | null, settings: SummarySettings) {
  return value === null
    ? '—'
    : `${formatRegionalNumber(value, settings.locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function bandBarSvg(summary: PeriodSummary) {
  const order = ['veryHigh', 'high', 'inRange', 'low', 'veryLow'] as const;
  let y = 0;
  const rects = order.map((band) => {
    const share = summary.ranges.bands[band].percent ?? 0;
    const height = fixed(share * 1.6);
    const rect = `<rect x="0" y="${fixed(y)}" width="28" height="${height}" fill="${COLOURS.bands[band]}"/>`;
    y += share * 1.6;
    return rect;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 160" aria-hidden="true" style="width:28px;height:160px">${rects.join('')}</svg>`;
}

/**
 * A self-contained, printable HTML report of stored records. It follows the
 * usual consensus layout (summary, typical day, daily overview) without
 * copying any licensed report. Empty sections are left out.
 */
export function buildClinicReport(input: ClinicReportInput): ClinicReport {
  const { summary, settings, generatedAt } = input;
  const range = summary.range;
  const glucose = input.glucose.filter((reading) => reading.timestamp >= range.start && reading.timestamp < range.end);
  const presentation = presentGlucoseRangeStatistics(summary.ranges, settings);
  const sections: ClinicReportSection[] = [];
  const body: string[] = [];

  body.push(`<header><h1>Glucose report</h1><p class="meta">${esc(periodLabel(summary, settings))} · times in ${esc(describeTimeZone(settings.timeZone, settings.locale, range.end))} · glucose in ${esc(glucoseUnitLabel(settings.glucoseUnit))}</p></header>`);

  if (presentation.observed) {
    sections.push('glucose');
    const stats = summary.statistics;
    const [standard, tight, personal] = presentation.ranges;
    const bandRows = [...presentation.bands].reverse().map((band) =>
      `<tr><td><span class="swatch" style="background:${COLOURS.bands[band.band]}"></span>${esc(band.name)}</td><td>${esc(band.bounds)}</td><td class="num">${esc(band.value)}</td></tr>`,
    ).join('');
    const figures: [string, string][] = [
      ['Sensor coverage', presentation.coverage],
      ['Readings', formatRegionalNumber(stats.sampleCount, settings.locale, { maximumFractionDigits: 0 })],
    ];
    if (stats.arithmeticMeanMmolL !== null) figures.push(['Average glucose', formatGlucose(stats.arithmeticMeanMmolL, settings)]);
    figures.push(['GMI', summary.gmi.status === 'shown'
      ? `${formatRegionalNumber(summary.gmi.percent, settings.locale, { maximumFractionDigits: 1 })}% (${formatRegionalNumber(summary.gmi.mmolMol, settings.locale, { maximumFractionDigits: 0 })} mmol/mol)`
      : 'Not shown']);
    if (stats.coefficientOfVariationPercent !== null) {
      figures.push(['Coefficient of variation', `${formatRegionalNumber(stats.coefficientOfVariationPercent, settings.locale, { maximumFractionDigits: 1 })}%`]);
    }
    if (stats.populationStandardDeviationMmolL !== null) {
      figures.push(['Standard deviation', formatGlucoseSpread(stats.populationStandardDeviationMmolL, settings)]);
    }
    const rangeRows = [
      `<tr><td>${esc(standard!.label)}</td><td class="num">${esc(standard!.value)}</td></tr>`,
      `<tr><td>${esc(tight!.label)}</td><td class="num">${esc(tight!.value)}</td></tr>`,
      ...(personal ? [`<tr><td>${esc(personal.label)} <small>(your own setting)</small></td><td class="num">${esc(personal.value)}</td></tr>`] : []),
    ].join('');
    body.push(`<section class="summary"><h2>Glucose summary</h2>${presentation.coverageNotice ? `<p class="notice">${esc(presentation.coverageNotice)}</p>` : ''}<div class="grid"><div class="bands">${bandBarSvg(summary)}<table><caption>Time in ranges (share of recorded time)</caption><tbody>${bandRows}</tbody></table></div><div><table><tbody>${figures.map(([label, value]) => `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`).join('')}</tbody></table><table><caption>Time in range by range</caption><tbody>${rangeRows}</tbody></table></div></div>${summary.gmi.status === 'withheld' ? `<p class="small">${esc(summary.gmi.reason)}</p>` : '<p class="small">GMI (glucose management indicator) is an estimate from sensor readings expressed like HbA1c; it can differ from a laboratory result.</p>'}</section>`);

    const profile = buildGlucoseProfile([...glucose], range);
    if (profile.representedBins > 0) {
      sections.push('typical-day');
      body.push(`<section class="typical"><h2>Typical day</h2>${typicalDaySvg(profile, settings)}<p class="small">All ${esc(formatRegionalNumber(profile.expectedDays, settings.locale, { maximumFractionDigits: 0 }))} days laid over one day in ${esc(formatRegionalNumber(profile.binMinutes, settings.locale, { maximumFractionDigits: 0 }))}-minute periods. Line: median. Dark band: middle 50% of readings. Light band: middle 80%. A period is drawn only when readings come from at least ${esc(formatRegionalNumber(profile.minimumDaysPerBin, settings.locale, { maximumFractionDigits: 0 }))} days. Shaded area: standard range.</p></section>`);
    }

    const days = reportDays(range, settings.timeZone);
    const tiles = days.map((day) => {
      const dayReadings = glucose.filter((reading) => reading.timestamp >= day.range.start && reading.timestamp < day.range.end);
      const daySummary = calculateGlucoseRangeSummary({ readings: dayReadings, range: day.range });
      const label = formatDay(day.dayStart + 12 * 3_600_000, settings);
      return `<div class="day"><div class="day-head"><strong>${esc(label)}</strong></div>${dayReadings.length ? dailyTraceSvg(dayReadings, day) : '<div class="empty">No readings</div>'}<div class="day-foot">In range ${esc(percent(daySummary.standard.inRange.percent, settings))} · coverage ${esc(percent(daySummary.coveragePercent, settings))}</div></div>`;
    });
    if (tiles.length) {
      sections.push('daily');
      body.push(`<section class="daily"><h2>Daily overview</h2><p class="small">Each day from 00:00 to 24:00. Shaded band: standard range. In range uses the standard range.</p><div class="days">${tiles.join('')}</div></section>`);
    }
  }

  const insulinLines = insulinSummaryLines(summary, generatedAt, settings);
  const carbLines = carbSummaryLines(summary, generatedAt, settings);
  if (insulinLines.length || carbLines.length) {
    sections.push('insulin-carbs');
    const perDay = summary.insulin && summary.lengthDays >= 1
      ? `<li>Average per day: ${esc(formatRegionalNumber(summary.insulin.summary.stats.totalUnits / summary.lengthDays, settings.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))} U</li>`
      : '';
    body.push(`<section class="insulin"><h2>Insulin and carbohydrate records</h2><ul>${[...insulinLines, ...carbLines].map((line) => `<li>${esc(line.trim())}</li>`).join('')}${perDay}</ul><p class="small">Totals add up stored records. Missing or delayed records make totals lower; they are not estimated.</p></section>`);
  }

  if (!sections.length) {
    body.push('<section><p>No glucose, insulin or carbohydrate records are stored for this period.</p></section>');
  }

  const sourceLabels = recordSourceLabels([
    ...summary.glucoseSourceIds,
    ...(summary.insulin?.sourceIds ?? []),
    ...(summary.carbs?.sourceIds ?? []),
  ]);
  body.push(`<footer><p>Prepared on this phone by T1 Arc on ${esc(formatDay(generatedAt, settings))} at ${esc(formatClock(generatedAt, settings))}. Nothing was uploaded by T1 Arc to make it.</p><p>T1 Arc is not a medical device. This report shows stored records and does not give treatment advice. Ranges follow the international consensus on time in ranges.</p>${sourceLabels.length ? `<p>Data sources: ${esc(sourceLabels.join(', '))}.</p>` : ''}</footer>`);

  const css = `body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:${COLOURS.text};margin:24px auto;padding:0 20px;max-width:820px;line-height:1.45;font-size:13px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:0 0 6px}.meta,.small,caption,footer{color:${COLOURS.muted}}.small{font-size:11px}section{border-top:1px solid ${COLOURS.grid};padding-top:10px;margin-top:14px;break-inside:avoid}table{border-collapse:collapse;margin:0 0 8px}caption{text-align:left;font-size:11px;padding-bottom:2px}td{padding:2px 10px 2px 0;vertical-align:top}.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.grid{display:flex;flex-wrap:wrap;gap:24px}.bands{display:flex;gap:10px;align-items:flex-start}.swatch{display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:2px}.notice{background:#fff6e0;padding:6px 8px;border-radius:4px}.days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.day{border:1px solid ${COLOURS.grid};border-radius:4px;padding:3px;font-size:9px}.day-foot{color:${COLOURS.muted}}.empty{height:28px;color:${COLOURS.muted};display:flex;align-items:center}footer{font-size:10px;border-top:1px solid ${COLOURS.grid};margin-top:14px;padding-top:8px}@page{size:A4;margin:12mm}@media print{body{margin:0;padding:0;max-width:none;font-size:10.5pt}.days{gap:4px}}`;
  const html = `<!doctype html><html lang="${esc(settings.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>T1 Arc glucose report</title><style>${css}</style></head><body>${body.join('')}</body></html>`;
  const endDate = toDateKey(Math.max(range.start, range.end - 1), settings.timeZone);
  return { html, sections, fileName: `T1-Arc-glucose-report-${endDate}.html` };
}
