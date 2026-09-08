import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteNotebookEntry, loadNotebook, saveNotebookEntry, updateNotebookNote } from "@/data/notebook/notebookRepository";
import { NOTEBOOK_STORAGE_KEY, type NotebookEntry } from "@/domain/personalNotebook";

const mocks = vi.hoisted(() => ({ value: undefined as string | undefined, queue: Promise.resolve() as Promise<unknown>, epoch: 1, read: vi.fn() }));
vi.mock("@/data/persistence/personalAppState", () => ({
  readPersonalAppState: async (key: string) => { mocks.read(key); return mocks.value; },
  updatePersonalAppState: <T>(key: string, update: (value: string | undefined) => { value: string; result: T }, lease?: { epoch: number }) => {
    mocks.read(key);
    const operation = mocks.queue.catch(() => undefined).then(() => {
      if (lease && lease.epoch !== mocks.epoch) throw new Error("superseded");
      const next = update(mocks.value); mocks.value = next.value; return next.result;
    });
    mocks.queue = operation;
    return operation;
  },
}));
vi.mock("@/data/privacy/localDataWriteEpoch", () => ({
  acquireLocalDataWriteLease: async () => ({ epoch: mocks.epoch }),
  assertLocalDataWriteLeaseCurrent: async (lease: { epoch: number }) => { if (lease.epoch !== mocks.epoch) throw new Error("superseded"); },
}));

const scope = { ownerIdentity: "owner-one", dataMode: "live" };
const entry: NotebookEntry = { id: "answer-one", ...scope, createdAt: 1_778_000_000_000, title: "Yesterday's average", answer: "Average 6.6 mmol/L.", note: "Ask at my next appointment", limitations: ["Based on recorded readings."], evidence: [{ label: "Glucose", description: "Recorded arithmetic mean.", range: { start: 1_777_000_000_000, end: 1_777_100_000_000 }, recordCount: 300, sourceIds: ["librelinkup"] }] };

beforeEach(() => { mocks.value = undefined; mocks.queue = Promise.resolve(); mocks.epoch = 1; vi.clearAllMocks(); });

describe("private personal notebook", () => {
  it("starts empty and uses the encrypted application metadata store", async () => {
    expect(await loadNotebook(scope)).toEqual({ active: [], archived: [] });
    await saveNotebookEntry(entry, scope);
    expect((await loadNotebook(scope)).active).toEqual([entry]);
    expect(mocks.read).toHaveBeenCalledWith(NOTEBOOK_STORAGE_KEY);
  });
  it("keeps another connection in an archive and excludes demo records", async () => {
    await saveNotebookEntry(entry, scope);
    await saveNotebookEntry({ ...entry, id: "demo", dataMode: "demo" }, { ...scope, dataMode: "demo" });
    await saveNotebookEntry({ ...entry, id: "other", ownerIdentity: "owner-two" }, { ...scope, ownerIdentity: "owner-two" });
    expect(await loadNotebook(scope)).toMatchObject({ active: [{ id: "answer-one" }], archived: [{ id: "other" }] });
    expect((await loadNotebook({ ...scope, dataMode: "demo" })).active.map((item) => item.id)).toEqual(["demo"]);
  });
  it("never overwrites an existing saved answer, evidence or note on a repeated save", async () => {
    await saveNotebookEntry(entry, scope);
    await saveNotebookEntry({ ...entry, answer: "Different", note: "" }, scope);
    expect((await loadNotebook(scope)).active[0]).toEqual(entry);
  });
  it("edits a personal note without changing the answer or evidence", async () => {
    await saveNotebookEntry(entry, scope);
    await updateNotebookNote(entry.id, "This was after travelling", scope);
    expect((await loadNotebook(scope)).active[0]).toEqual({ ...entry, note: "This was after travelling" });
  });
  it("rejects saving, editing or deleting records for a different owner", async () => {
    await expect(saveNotebookEntry({ ...entry, ownerIdentity: "other" }, scope)).rejects.toThrow("different");
    await saveNotebookEntry(entry, scope);
    const other = { ...scope, ownerIdentity: "other" };
    await expect(updateNotebookNote(entry.id, "new note", other)).rejects.toThrow("current notebook");
    await expect(deleteNotebookEntry(entry.id, other)).rejects.toThrow("current notebook");
    expect((await loadNotebook(scope)).active[0]).toEqual(entry);
  });
  it("serializes concurrent saves without losing either entry", async () => {
    await Promise.all([saveNotebookEntry(entry, scope), saveNotebookEntry({ ...entry, id: "second" }, scope)]);
    expect((await loadNotebook(scope)).active).toHaveLength(2);
  });
  it("removes only the chosen notebook entry", async () => {
    await saveNotebookEntry(entry, scope);
    await saveNotebookEntry({ ...entry, id: "second" }, scope);
    await deleteNotebookEntry(entry.id, scope);
    expect((await loadNotebook(scope)).active.map((item) => item.id)).toEqual(["second"]);
  });
  it("does not discard malformed stored notebooks to make room for a new save", async () => {
    mocks.value = "{broken";
    await expect(saveNotebookEntry(entry, scope)).rejects.toThrow();
    expect(mocks.value).toBe("{broken");
  });
  it("reports the capacity limit without evicting records", async () => {
    mocks.value = JSON.stringify({ version: 1, entries: Array.from({ length: 150 }, (_, index) => ({ ...entry, id: `saved-${index}` })) });
    const previous = mocks.value;
    await expect(saveNotebookEntry(entry, scope)).rejects.toThrow("150");
    expect(mocks.value).toBe(previous);
  });
  it("retains the lease captured before fetching a chart snapshot", async () => {
    mocks.epoch = 2;
    await expect(saveNotebookEntry(entry, scope, { epoch: 1 })).rejects.toThrow("superseded");
    expect(mocks.value).toBeUndefined();
  });
  it("allows explicitly confirmed archive removal without ever deleting another data mode", async () => {
    await saveNotebookEntry(entry, scope);
    const other = { ...scope, ownerIdentity: "other" };
    await deleteNotebookEntry(entry.id, other, { allowArchived: true });
    expect((await loadNotebook(scope)).active).toHaveLength(0);
    await saveNotebookEntry({ ...entry, dataMode: "demo" }, { ...scope, dataMode: "demo" });
    await expect(deleteNotebookEntry(entry.id, other, { allowArchived: true })).rejects.toThrow("current notebook");
  });
});
