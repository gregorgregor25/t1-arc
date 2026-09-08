import { describe, expect, it } from "vitest";
import { notebookTracePlot, type NotebookGlucoseTrace } from "@/domain/notebookTrace";
import { buildNotebookReport } from "@/data/notebook/notebookReport";
import type { NotebookEntry } from "@/domain/personalNotebook";

const start = Date.parse("2026-09-07T12:00:00Z");
const trace: NotebookGlucoseTrace = {
  range: { start, end: start + 7_200_000 }, maximumGapMs: 720_000,
  points: [
    { timestamp: start, mmolL: 6 }, { timestamp: start + 60_000, mmolL: 6.2 },
    { timestamp: start + 3_600_000, mmolL: 7 }, { timestamp: start + 3_660_000, mmolL: 7.1 },
  ],
};
const settings = { locale: "en-GB", timeZone: "Europe/London", glucoseUnit: "mmolL" as const };
const entry: NotebookEntry = {
  id: "test", ownerIdentity: "private-owner", dataMode: "live", createdAt: start, title: "Recorded glucose", note: "", answer: "Observed values.",
  limitations: ["There is a gap in these records."], evidence: [], glucoseTrace: trace,
};

describe("saved observed glucose trace", () => {
  it("breaks the line across missing periods without generating extra points", () => {
    const plot = notebookTracePlot(trace, settings);
    expect(plot?.paths).toHaveLength(2);
    expect(plot?.paths.join(" ").match(/[ML]/g)).toHaveLength(4);
    expect(plot?.description).toContain("4 recorded readings");
    expect(plot?.description).toContain("12 minutes");
    expect(trace.points).toHaveLength(4);
  });
  it("shows isolated observations instead of dropping them", () => {
    const plot = notebookTracePlot({ ...trace, points: [trace.points[0]!] }, settings);
    expect(plot?.paths).toHaveLength(0);
    expect(plot?.isolated).toHaveLength(1);
  });
  it("uses regional units without changing canonical stored values", () => {
    const plot = notebookTracePlot(trace, { ...settings, locale: "en-US", glucoseUnit: "mgDl" });
    expect(plot?.unit).toBe("mg/dL");
    expect(plot?.description).toContain("108 mg/dL");
    expect(trace.points[0]?.mmolL).toBe(6);
  });
  it.each([
    { ...trace, points: [] },
    { ...trace, points: [trace.points[1]!, trace.points[0]!] },
    { ...trace, points: [{ timestamp: trace.range.end, mmolL: 5 }] },
    { ...trace, points: [{ timestamp: start, mmolL: NaN }] },
    { ...trace, points: [{ timestamp: start, mmolL: 0 }] },
    { ...trace, maximumGapMs: 0 },
    { ...trace, points: Array.from({ length: 4001 }, (_, index) => ({ timestamp: start + index, mmolL: 5 })) },
  ])("does not plot invalid or oversized observations", (candidate) => {
    expect(notebookTracePlot(candidate, settings)).toBeUndefined();
  });
  it("uses the same genuine trace in preview and printable HTML", () => {
    const report = buildNotebookReport([entry], { ownerIdentity: entry.ownerIdentity, dataMode: entry.dataMode }, settings);
    expect(report.charts).toHaveLength(1);
    for (const path of report.charts?.[0]?.plot.paths ?? []) expect(report.html).toContain(`d="${path}"`);
    expect(report.html).toContain("<svg");
    expect(report.html).toContain("There is a gap in these records.");
    expect(report.html).toContain("mmol/L");
  });
  it("does not invent a chart for a personal note", () => {
    const report = buildNotebookReport([{ ...entry, glucoseTrace: undefined }], { ownerIdentity: entry.ownerIdentity, dataMode: entry.dataMode }, settings);
    expect(report.charts).toHaveLength(0);
    expect(report.html).not.toContain("<svg");
  });
});
