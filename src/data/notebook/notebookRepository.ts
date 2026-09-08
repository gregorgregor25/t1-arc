import { readPersonalAppState, updatePersonalAppState } from "@/data/persistence/personalAppState";
import { acquireLocalDataWriteLease, assertLocalDataWriteLeaseCurrent, type LocalDataWriteLease } from "@/data/privacy/localDataWriteEpoch";
import { MAX_NOTEBOOK_ENTRIES, NOTEBOOK_STORAGE_KEY, parseNotebook, type NotebookEntry, type PersonalNotebook } from "@/domain/personalNotebook";

export interface NotebookScope { ownerIdentity: string; dataMode: string }
export interface NotebookSections { active: NotebookEntry[]; archived: NotebookEntry[] }

function read(stored: string | undefined): PersonalNotebook {
  return stored ? parseNotebook(JSON.parse(stored)) : { version: 1, entries: [] };
}

function assertScope(scope: NotebookScope) {
  if (!scope.ownerIdentity || !scope.dataMode) throw new Error("Wait for your current data connection before opening the notebook.");
}

function belongs(entry: NotebookEntry, scope: NotebookScope) {
  return entry.ownerIdentity === scope.ownerIdentity && entry.dataMode === scope.dataMode;
}

export function notebookSections(notebook: PersonalNotebook, scope: NotebookScope): NotebookSections {
  assertScope(scope);
  const entries = notebook.entries.filter((entry) => entry.dataMode === scope.dataMode)
    .sort((a, b) => b.createdAt - a.createdAt);
  return {
    active: entries.filter((entry) => entry.ownerIdentity === scope.ownerIdentity),
    archived: entries.filter((entry) => entry.ownerIdentity !== scope.ownerIdentity),
  };
}

export async function loadNotebook(scope: NotebookScope): Promise<NotebookSections> {
  assertScope(scope);
  const lease = await acquireLocalDataWriteLease();
  const notebook = read(await readPersonalAppState(NOTEBOOK_STORAGE_KEY));
  await assertLocalDataWriteLeaseCurrent(lease);
  return notebookSections(notebook, scope);
}

export async function saveNotebookEntry(entry: NotebookEntry, scope: NotebookScope, lease?: LocalDataWriteLease) {
  assertScope(scope);
  const checked = parseNotebook({ version: 1, entries: [entry] }).entries[0];
  if (!checked || !belongs(checked, scope)) throw new Error("This answer belongs to a different data connection.");
  return updatePersonalAppState(NOTEBOOK_STORAGE_KEY, (stored) => {
    const notebook = read(stored);
    const existing = notebook.entries.find((item) => item.id === checked.id);
    if (existing) {
      if (!belongs(existing, scope)) throw new Error("This saved item belongs to another connection.");
      // Saving an answer twice never overwrites its original evidence or a note.
      return { value: JSON.stringify(notebook), result: existing };
    }
    if (notebook.entries.length >= MAX_NOTEBOOK_ENTRIES) throw new Error("Your notebook has 150 items. Remove an item before saving another.");
    const next = parseNotebook({ version: 1, entries: [...notebook.entries, checked] });
    return { value: JSON.stringify(next), result: checked };
  }, lease);
}

export async function updateNotebookNote(id: string, note: string, scope: NotebookScope) {
  assertScope(scope);
  if (note.length > 4_000) throw new Error("Keep your note under 4,000 characters.");
  return updatePersonalAppState(NOTEBOOK_STORAGE_KEY, (stored) => {
    const notebook = read(stored);
    const entry = notebook.entries.find((item) => item.id === id);
    if (!entry || !belongs(entry, scope)) throw new Error("This saved item is not in your current notebook.");
    const updated = { ...entry, note };
    const next = parseNotebook({ version: 1, entries: notebook.entries.map((item) => item.id === id ? updated : item) });
    return { value: JSON.stringify(next), result: updated };
  });
}

export async function deleteNotebookEntry(id: string, scope: NotebookScope, options: { allowArchived?: boolean } = {}) {
  assertScope(scope);
  return updatePersonalAppState(NOTEBOOK_STORAGE_KEY, (stored) => {
    const notebook = read(stored);
    const entry = notebook.entries.find((item) => item.id === id);
    if (entry && !belongs(entry, scope) && !(options.allowArchived && entry.dataMode === scope.dataMode)) throw new Error("This saved item is not in your current notebook.");
    return { value: JSON.stringify({ version: 1, entries: notebook.entries.filter((item) => item.id !== id) }), result: undefined };
  });
}
