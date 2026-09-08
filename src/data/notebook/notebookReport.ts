import { notebookSummaryText, parseNotebook, type NotebookEntry } from "@/domain/personalNotebook";
import { notebookTracePlot, type NotebookTracePlot } from "@/domain/notebookTrace";
import type { T1ArcRegionalDefaults } from "@/domain/regionalProfile";
import type { NotebookScope } from "./notebookRepository";

export interface NotebookReport { text: string; html: string; charts?: { title: string; plot: NotebookTracePlot }[] }

export function escapeNotebookHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function notebookTraceSvg(plot: NotebookTracePlot) {
  const safe = escapeNotebookHtml;
  return `<figure><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 166" role="img" aria-label="${safe(plot.description)}" style="width:100%;max-height:280px"><title>Saved glucose readings</title><text x="52" y="12" font-size="11" fill="#4b5260">${safe(plot.unit)}</text>${plot.ticks.map((tick) => `<line x1="52" x2="348" y1="${tick.y}" y2="${tick.y}" stroke="#ccd0d8"/><text x="46" y="${tick.y + 4}" text-anchor="end" font-size="11" fill="#4b5260">${safe(tick.label)}</text>`).join("")}${plot.paths.map((path) => `<path d="${safe(path)}" fill="none" stroke="#3156a5" stroke-width="2"/>`).join("")}${plot.isolated.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.5" fill="#3156a5"/>`).join("")}<text x="52" y="155" font-size="11" fill="#4b5260">${safe(plot.startLabel)}</text><text x="348" y="155" text-anchor="end" font-size="11" fill="#4b5260">${safe(plot.endLabel)}</text></svg><figcaption>${safe(plot.period)}<br>${safe(plot.description)}</figcaption></figure>`;
}

export function buildNotebookReport(
  selected: readonly NotebookEntry[],
  scope: NotebookScope,
  options: { locale: string; timeZone: string; glucoseUnit?: T1ArcRegionalDefaults["glucoseUnit"]; includeArchives?: boolean },
): NotebookReport {
  if (!scope.ownerIdentity || !scope.dataMode || selected.length < 1 || selected.length > 5) throw new Error("Choose between one and five notebook items.");
  const entries = parseNotebook({ version: 1, entries: selected }).entries;
  if (entries.some((entry) => entry.dataMode !== scope.dataMode)) throw new Error("Demo and personal records cannot share an appointment summary.");
  if (!options.includeArchives && entries.some((entry) => entry.ownerIdentity !== scope.ownerIdentity)) throw new Error("Review records from other connections before including them.");
  const labeled = entries.map((entry) => entry.ownerIdentity === scope.ownerIdentity ? entry : {
    ...entry, title: `${entry.title}\nFrom another connection or restored backup`,
  });
  const plots = labeled.map((entry) => entry.glucoseTrace ? notebookTracePlot(entry.glucoseTrace, {
    locale: options.locale, timeZone: options.timeZone, glucoseUnit: options.glucoseUnit ?? "mmolL",
  }) : undefined);
  const charts = labeled.flatMap((entry, index) => {
    const plot = plots[index];
    return plot ? [{ title: entry.title, plot }] : [];
  });
  const text = `${scope.dataMode === "demo" ? "DEMO RECORDS\n\n" : ""}${notebookSummaryText(labeled, options.locale, options.timeZone)}\n\nTimes shown in ${options.timeZone}. This is a selected record summary, not a complete medical record. Saved answers describe the evidence available when they were saved.`;
  const html = `<!doctype html><html lang="${escapeNotebookHtml(options.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>T1 Arc appointment notes</title><style>body{font-family:system-ui,sans-serif;color:#20232a;margin:32px auto;padding:0 24px;max-width:760px;line-height:1.55}h1{font-size:28px}p{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:1px solid #ccd0d8;padding-top:16px;margin-top:24px}small,figcaption{color:#4b5260}figure{margin:20px 0;break-inside:avoid}figcaption{font-size:12px}@page{size:A4;margin:18mm}@media print{body{margin:0;padding:0;font-size:11pt}h1{font-size:20pt}h2{break-after:avoid}}</style></head><body><h1>T1 Arc</h1><h2>${scope.dataMode === "demo" ? "Demo appointment notes" : "Appointment notes"}</h2><p>Selected personal observations and questions. Not treatment recommendations.</p>${labeled.map((entry, index) => {
    const detail = notebookSummaryText([entry], options.locale, options.timeZone).split("\n\n").slice(2).join("\n\n");
    const plot = plots[index];
    return `<section><p>${escapeNotebookHtml(detail)}</p>${plot ? notebookTraceSvg(plot) : ""}</section>`;
  }).join("")}<p><small>Times shown in ${escapeNotebookHtml(options.timeZone)}. This is a selected record summary, not a complete medical record. Saved answers describe the evidence available when they were saved.</small></p></body></html>`;
  return { text, html, charts };
}
