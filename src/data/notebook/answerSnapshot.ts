import type { EvidenceReference } from "@/domain/insights";
import type { NotebookEntry } from "@/domain/personalNotebook";
import { DEFAULT_OBSERVATION_GAP_MS } from "@/domain/glucoseStatistics";
import { evidenceQueryChartPointRecordIds } from "@/domain/evidenceQueryChart";
import type { TarvisAnswer } from "@/data/tarvis/types";

/** Copy original full-resolution evidence, never reconstruct it from today's rows. */
export function originalAnswerGlucoseTrace(reference: EvidenceReference): NotebookEntry["glucoseTrace"] {
  const visualization = reference.visualization;
  if (!visualization || visualization.kind === "recurring-clock-overlay-v1" || reference.visualizationOmission ||
      visualization.units !== "mmol/L" || visualization.gapThresholdMilliseconds !== DEFAULT_OBSERVATION_GAP_MS || visualization.windows.length !== 1) return undefined;
  const window = visualization.windows[0];
  if (!window || window.sampling || !window.points.length || window.points.length > 4_000 ||
      window.range.start !== reference.range.start || window.range.end !== reference.range.end) return undefined;
  const expected = new Set(reference.recordIds);
  const observed = window.points.flatMap(evidenceQueryChartPointRecordIds);
  if (!expected.size || observed.length !== expected.size || new Set(observed).size !== observed.length ||
      observed.some((id) => !expected.has(id)) || window.recordCount !== expected.size) return undefined;
  for (let index = 0; index < window.points.length; index += 1) {
    const point = window.points[index]!;
    const previous = window.points[index - 1];
    if (!Number.isFinite(point.timestamp) || point.timestamp < reference.range.start || point.timestamp >= reference.range.end ||
        !Number.isFinite(point.mmolL) || point.mmolL <= 0 || (previous && point.timestamp <= previous.timestamp)) return undefined;
    // A compact trace cannot carry a special short segment break, so do not
    // flatten such original evidence into a misleading continuous line.
    if (previous && (previous.segmentId !== undefined || point.segmentId !== undefined) && previous.segmentId !== point.segmentId && point.timestamp - previous.timestamp <= DEFAULT_OBSERVATION_GAP_MS) return undefined;
  }
  return {
    range: { ...reference.range }, maximumGapMs: DEFAULT_OBSERVATION_GAP_MS,
    points: window.points.map(({ timestamp, mmolL }) => ({ timestamp, mmolL })),
  };
}

export function notebookEntryFromAnswer(input: {
  id: string; title: string; answer: TarvisAnswer; evidence: EvidenceReference[]; createdAt: number;
  ownerIdentity: string; dataMode: string;
}): NotebookEntry {
  const headline = input.answer.headline.trim();
  const body = input.answer.answer.trim();
  const answer = !headline || body.toLocaleLowerCase().startsWith(headline.toLocaleLowerCase())
    ? body : [headline, body].filter(Boolean).join("\n\n");
  const entry: NotebookEntry = {
    id: `answer:${input.id}`, title: input.title, answer, createdAt: input.createdAt,
    ownerIdentity: input.ownerIdentity, dataMode: input.dataMode, note: "", limitations: [...input.answer.limitations],
    evidence: input.evidence.map((reference) => ({
      label: reference.label, description: reference.description, range: { ...reference.range },
      recordCount: new Set(reference.recordIds).size,
      sourceIds: [...new Set(reference.examples.map((record) => record.sourceId))],
    })),
  };
  for (const reference of input.evidence) {
    const trace = originalAnswerGlucoseTrace(reference);
    if (trace) { entry.glucoseTrace = trace; break; }
  }
  if (!entry.glucoseTrace && input.evidence.some((reference) => reference.calculation || reference.examples.some((record) => record.kind === "glucose"))) {
    entry.limitations.push("No complete original glucose chart was saved with this answer. The saved answer and its evidence details are retained.");
  }
  return entry;
}

export function notebookSaveError(error: unknown, kind: "answer" | "note" = "answer") {
  if (error instanceof Error && ["Your notebook has 150 items. Remove an item before saving another.", "Your notebook is full. Remove an item before saving another."].includes(error.message)) return error.message;
  return `This ${kind} could not be saved. Check your current connection and try again. Your existing notebook is unchanged.`;
}
