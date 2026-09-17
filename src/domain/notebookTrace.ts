import { formatGlucose, glucoseUnitLabel } from "./regionalFormat";
import type { T1ArcRegionalDefaults } from "./regionalProfile";

export interface NotebookGlucoseTrace {
  range: { start: number; end: number };
  points: { timestamp: number; mmolL: number }[];
  maximumGapMs: number;
}
export interface NotebookTracePlot {
  paths: string[];
  isolated: { x: number; y: number }[];
  ticks: { y: number; label: string }[];
  unit: string;
  startLabel: string;
  endLabel: string;
  period: string;
  description: string;
}

/** Draw only retained observations. Never bridge a known gap or generate values. */
export function notebookTracePlot(
  trace: NotebookGlucoseTrace,
  settings: Pick<T1ArcRegionalDefaults, "locale" | "timeZone" | "glucoseUnit">,
): NotebookTracePlot | undefined {
  if (!trace.points.length || trace.points.length > 4_000 || !Number.isFinite(trace.range.start) || !Number.isFinite(trace.range.end) || trace.range.end <= trace.range.start || !Number.isFinite(trace.maximumGapMs) || trace.maximumGapMs <= 0) return undefined;
  let previous = -Infinity;
  for (const point of trace.points) {
    if (!Number.isFinite(point.timestamp) || point.timestamp < trace.range.start || point.timestamp >= trace.range.end || point.timestamp <= previous || !Number.isFinite(point.mmolL) || point.mmolL <= 0) return undefined;
    previous = point.timestamp;
  }
  const values = trace.points.map((point) => point.mmolL);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ceiling = Math.max(12, Math.ceil(max / 2) * 2);
  const y = (value: number) => 20 + (1 - value / ceiling) * 112;
  const groups: { x: number; y: number }[][] = [];
  let group: { x: number; y: number }[] = [];
  previous = -Infinity;
  for (const point of trace.points) {
    if (point.timestamp - previous > trace.maximumGapMs && group.length) { groups.push(group); group = []; }
    group.push({ x: 52 + (point.timestamp - trace.range.start) / (trace.range.end - trace.range.start) * 296, y: y(point.mmolL) });
    previous = point.timestamp;
  }
  if (group.length) groups.push(group);
  const time = new Intl.DateTimeFormat(settings.locale, { timeZone: settings.timeZone, hour: "numeric", minute: "2-digit" });
  const date = new Intl.DateTimeFormat(settings.locale, { timeZone: settings.timeZone, dateStyle: "medium", timeStyle: "short" });
  return {
    paths: groups.filter((points) => points.length > 1).map((points) => points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")),
    isolated: groups.filter((points) => points.length === 1).flat(),
    ticks: [0, ceiling / 2, ceiling].map((value) => ({ y: y(value), label: formatGlucose(value, settings, { withUnit: false }) })),
    unit: glucoseUnitLabel(settings.glucoseUnit),
    startLabel: time.format(trace.range.start), endLabel: time.format(trace.range.end - 1),
    period: `${date.format(trace.range.start)} to ${date.format(trace.range.end - 1)} (${settings.timeZone})`,
    description: `${trace.points.length} recorded readings, from ${formatGlucose(min, settings)} to ${formatGlucose(max, settings)}. Gaps longer than ${new Intl.NumberFormat(settings.locale, { maximumFractionDigits: 1 }).format(trace.maximumGapMs / 60_000)} minutes are left unconnected. No missing readings are estimated.`,
  };
}
