import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notebookEntryFromAnswer, notebookSaveError, originalAnswerGlucoseTrace } from "@/data/notebook/answerSnapshot";
import type { EvidenceReference } from "@/domain/insights";
import type { EvidenceRangeTraceVisualization } from "@/domain/evidenceQueryChart";
import type { TarvisAnswer } from "@/data/tarvis/types";

const start = Date.parse("2026-09-08T12:00:00Z");
const range = { start, end: start + 3_600_000 };
const visualization: EvidenceRangeTraceVisualization = {
  kind: "range-trace-v1", metric: "glucose.mean", gapThresholdMilliseconds: 720_000, schemaVersion: 1,
  subtitle: "The selected period", targetRange: { minimum: 4, maximum: 10 }, timezone: "Europe/London", title: "Glucose", units: "mmol/L", valueDomain: { minimum: 0, maximum: 12 },
  windows: [{ coveragePercent: 20, coverageStatus: "limited", distribution: null, events: [], id: "window", label: "The period", meanMmolL: 6.1,
    points: [{ timestamp: start, mmolL: 6, recordIds: ["a"] }, { timestamp: start + 60_000, mmolL: 6.2, recordIds: ["b"] }], range, recordCount: 2 }],
};
const evidence: EvidenceReference = { id: "evidence", label: "Glucose", description: "Two recorded readings.", range, recordIds: ["a", "b"], examples: [], visualization };
const answer: TarvisAnswer = { headline: "Your average was 6.1 mmol/L.", answer: "For the selected period, based on two readings.", confidence: "limited", evidenceIds: [evidence.id], limitations: ["Limited coverage."] };
const input = { id: "question", title: "What was my average?", answer, evidence: [evidence], createdAt: start, ownerIdentity: "owner", dataMode: "live" };

describe("saved original answer snapshot", () => {
  it("retains the actual answer in its headline as well as the explanatory body", () => {
    expect(notebookEntryFromAnswer(input).answer).toBe(`${answer.headline}\n\n${answer.answer}`);
    expect(notebookEntryFromAnswer({ ...input, answer: { ...answer, answer: `${answer.headline} More detail.` } }).answer).toBe(`${answer.headline} More detail.`);
  });
  it("copies a complete original visualization without using current database rows", () => {
    const entry = notebookEntryFromAnswer(input);
    expect(entry.glucoseTrace?.points).toEqual([{ timestamp: start, mmolL: 6 }, { timestamp: start + 60_000, mmolL: 6.2 }]);
    entry.glucoseTrace!.points[0]!.mmolL = 99;
    expect(visualization.windows[0]?.points[0]?.mmolL).toBe(6);
    const source = readFileSync("src/components/SaveToNotebookButton.tsx", "utf8");
    expect(source).not.toContain("await loadGlucoseReadings");
  });
  it("does not treat matching record IDs or an aggregate metric as proof of original values", () => {
    expect(originalAnswerGlucoseTrace({ ...evidence, visualization: undefined })).toBeUndefined();
    const entry = notebookEntryFromAnswer({ ...input, evidence: [{ ...evidence, visualization: undefined, examples: [{ id: "a", kind: "glucose", timestamp: start, primary: "6", secondary: "", sourceId: "source" }] }] });
    expect(entry.glucoseTrace).toBeUndefined();
    expect(entry.limitations).toContain("No complete original glucose chart was saved with this answer. The saved answer and its evidence details are retained.");
  });
  it("rejects compacted display points even if a subset happens to look plausible", () => {
    const window = visualization.windows[0]!;
    expect(originalAnswerGlucoseTrace({ ...evidence, visualization: { ...visualization, windows: [{ ...window, sampling: { kind: "deterministic-time-bucket-envelope-v1", sourceRecordCount: 10, sourceSampleCount: 10, displayedPointCount: 2, maximumDisplayedPoints: 2, sourceGapCount: 0 } }] } })).toBeUndefined();
  });
  it("rejects extra/missing IDs, wrong ranges and truncated windows", () => {
    const window = visualization.windows[0]!;
    expect(originalAnswerGlucoseTrace({ ...evidence, recordIds: ["a"] })).toBeUndefined();
    expect(originalAnswerGlucoseTrace({ ...evidence, recordIds: ["a", "b", "c"] })).toBeUndefined();
    expect(originalAnswerGlucoseTrace({ ...evidence, visualization: { ...visualization, windows: [{ ...window, range: { start: start + 1, end: range.end } }] } })).toBeUndefined();
    expect(originalAnswerGlucoseTrace({ ...evidence, visualization: { ...visualization, windows: [window, window] } })).toBeUndefined();
  });
  it("does not flatten an explicit short segment boundary", () => {
    const window = visualization.windows[0]!;
    expect(originalAnswerGlucoseTrace({ ...evidence, visualization: { ...visualization, windows: [{ ...window, points: window.points.map((point, index) => ({ ...point, segmentId: String(index) })) }] } })).toBeUndefined();
  });
  it("fences the async save with the original lease and both owner and data mode", () => {
    const source = readFileSync("src/components/SaveToNotebookButton.tsx", "utf8");
    expect(source).toContain("scope.current.ownerIdentity === ownerIdentity");
    expect(source).toContain("scope.current.dataMode === dataMode");
    expect(source).toContain("saveNotebookEntry(entry, { ownerIdentity, dataMode }, lease)");
    expect(source).toContain("await assertLocalDataWriteLeaseCurrent(saved.lease)");
    expect(source).toContain("busy: saving");
    expect(source).toContain("if (busy || inFlight.current || !stillCurrent()) return;");
  });
  it("does not expose raw database or private-path errors", () => {
    expect(notebookSaveError(new Error("SQLite /data/user/0/private"))).not.toContain("SQLite");
    const capacity = "Your notebook has 150 items. Remove an item before saving another.";
    expect(notebookSaveError(new Error(capacity))).toBe(capacity);
  });
});
