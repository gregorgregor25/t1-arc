import type { TimeRange } from './models';

export const NOTEBOOK_STORAGE_KEY = 'personal-notebook-v1';
export const MAX_NOTEBOOK_ENTRIES = 150;
export const MAX_NOTEBOOK_JSON_CHARACTERS = 8_000_000;
export interface NotebookEvidence {
  label: string;
  description: string;
  range: TimeRange;
  recordCount: number;
  sourceIds: string[];
}
export interface NotebookEntry {
  id: string;
  ownerIdentity: string;
  dataMode: string;
  createdAt: number;
  title: string;
  answer: string;
  note: string;
  limitations: string[];
  evidence: NotebookEvidence[];
  glucoseTrace?: { range: TimeRange; points: { timestamp: number; mmolL: number }[]; maximumGapMs: number };
}
export interface PersonalNotebook { version: 1; entries: NotebookEntry[] }

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 8_640_000_000_000_000;

export function parseNotebook(value: unknown): PersonalNotebook {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Your notebook could not be read.');
  const notebook = value as PersonalNotebook;
  if (notebook.version !== 1 || !Array.isArray(notebook.entries) || notebook.entries.length > MAX_NOTEBOOK_ENTRIES) throw new Error('Your notebook could not be read.');
  const ids = new Set<string>();
  for (const entry of notebook.entries) {
    if (
      !entry || !text(entry.id, 160) || !entry.id || ids.has(entry.id) ||
      !text(entry.ownerIdentity, 4096) || !entry.ownerIdentity ||
      !text(entry.dataMode, 40) || !time(entry.createdAt) ||
      !text(entry.title, 1000) || !text(entry.answer, 40000) || !text(entry.note, 4000) ||
      !Array.isArray(entry.limitations) || entry.limitations.length > 100 ||
      !entry.limitations.every(item => text(item, 8000)) ||
      !Array.isArray(entry.evidence) || entry.evidence.length > 100
    ) throw new Error('A saved notebook item is invalid.');
    ids.add(entry.id);
    if (entry.glucoseTrace) {
      const trace = entry.glucoseTrace;
      if (
        !trace.range || !time(trace.range.start) || !time(trace.range.end) ||
        trace.range.end <= trace.range.start || trace.maximumGapMs !== 720_000 ||
        !Array.isArray(trace.points) || trace.points.length > 4000 ||
        trace.points.some((point, index) =>
          !point || !time(point.timestamp) || point.timestamp < trace.range.start ||
          point.timestamp >= trace.range.end || !Number.isFinite(point.mmolL) ||
          point.mmolL <= 0 || (index > 0 && trace.points[index - 1]!.timestamp >= point.timestamp))
      ) throw new Error('The saved glucose chart is invalid.');
    }
    for (const evidence of entry.evidence) {
      if (
        !evidence || !text(evidence.label, 1000) || !text(evidence.description, 12000) ||
        !evidence.range || !time(evidence.range.start) || !time(evidence.range.end) ||
        evidence.range.end <= evidence.range.start ||
        !Number.isSafeInteger(evidence.recordCount) || evidence.recordCount < 0 ||
        !Array.isArray(evidence.sourceIds) || evidence.sourceIds.length > 100 ||
        !evidence.sourceIds.every(source => text(source, 256))
      ) throw new Error('Saved notebook evidence is invalid.');
    }
  }
  // Return a detached, allowlisted shape. Never persist unknown imported fields.
  const detached: PersonalNotebook = { version: 1, entries: notebook.entries.map(entry => ({
    id: entry.id, ownerIdentity: entry.ownerIdentity, dataMode: entry.dataMode,
    createdAt: entry.createdAt, title: entry.title, answer: entry.answer, note: entry.note,
    limitations: [...entry.limitations], evidence: entry.evidence.map(item => ({
      label: item.label, description: item.description, range: { start: item.range.start, end: item.range.end }, recordCount: item.recordCount, sourceIds: [...item.sourceIds],
    })),
    ...(entry.glucoseTrace ? { glucoseTrace: { range: { start: entry.glucoseTrace.range.start, end: entry.glucoseTrace.range.end }, maximumGapMs: entry.glucoseTrace.maximumGapMs, points: entry.glucoseTrace.points.map(point => ({ timestamp: point.timestamp, mmolL: point.mmolL })) } } : {}),
  })) };
  if (JSON.stringify(detached).length > MAX_NOTEBOOK_JSON_CHARACTERS) throw new Error('Your notebook is full. Remove an item before saving another.');
  return detached;
}

export function validateSerializedNotebook(value: string): string {
  if (value.length > MAX_NOTEBOOK_JSON_CHARACTERS) throw new Error('This notebook is too large to restore.');
  return JSON.stringify(parseNotebook(JSON.parse(value)));
}

export function mergeSerializedNotebooks(existing: string, incoming: string): string {
  const destination = parseNotebook(JSON.parse(validateSerializedNotebook(existing)));
  const source = parseNotebook(JSON.parse(validateSerializedNotebook(incoming)));
  const ids = new Set(destination.entries.map(entry => entry.id));
  const entries = [...destination.entries, ...source.entries.filter(entry => !ids.has(entry.id))];
  if (entries.length > MAX_NOTEBOOK_ENTRIES) throw new Error('Combining these notebooks would exceed 150 saved items. No notebook items were replaced.');
  return validateSerializedNotebook(JSON.stringify({ version: 1, entries }));
}

export function notebookEntryDateLabel(entry: Pick<NotebookEntry, 'id'>): 'Answer from' | 'Saved' {
  return entry.id.startsWith('answer:') ? 'Answer from' : 'Saved';
}

export function notebookSummaryText(entries: readonly NotebookEntry[], locale: string, timeZone: string): string {
  const date = (timestamp: number) => new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
  return ['T1 Arc | Appointment notes', 'Selected personal observations and questions. Not treatment recommendations.', ...entries.map(entry => [
    entry.title, `${notebookEntryDateLabel(entry)} ${date(entry.createdAt)}`, entry.answer,
    entry.note ? `My note / question\n${entry.note}` : '',
    ...entry.evidence.map(item => `${item.label}\n${date(item.range.start)} to ${date(item.range.end - 1)}\n${item.recordCount} records${item.sourceIds.length ? ` | Sources: ${item.sourceIds.join(', ')}` : ''}\n${item.description}`),
    ...entry.limitations.map(item => `Limitation: ${item}`),
  ].filter(Boolean).join('\n\n'))].join('\n\n');
}
