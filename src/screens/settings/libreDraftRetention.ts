import type { LibreLinkUpCredentials } from "@/data/libreLinkUp/types";

/** Unsaved form input belongs to this mounted Settings screen only. */
export function createLibreDraftRetention(onErased: () => void) {
  let draft: LibreLinkUpCredentials | undefined;
  return {
    read: () => draft,
    write: (next: LibreLinkUpCredentials | undefined) => {
      draft = next;
    },
    clearAfterErase: () => {
      draft = undefined;
      onErased();
    },
  };
}

export type LibreDraftRetention = ReturnType<typeof createLibreDraftRetention>;
