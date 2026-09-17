import type { PreparedGlookoImport } from './glookoImport';

/**
 * Keeps the exact manual source archive alive while SQLite is binding it.
 * React can unmount the preview at any await boundary; its normal disposal
 * must not zero the same Uint8Array until the database commit has settled.
 */
export class GlookoImportSourceCommitGuard {
  private activeBytes?: Uint8Array;

  begin(prepared: PreparedGlookoImport) {
    const bytes = prepared.sourcePayload?.bytes;
    if (!bytes) return;
    if (this.activeBytes && this.activeBytes !== bytes) {
      throw new Error('Another Glooko source archive is still being imported.');
    }
    this.activeBytes = bytes;
  }

  disposePreview(prepared: PreparedGlookoImport) {
    const bytes = prepared.sourcePayload?.bytes;
    if (bytes && bytes !== this.activeBytes) bytes.fill(0);
  }

  finish(prepared: PreparedGlookoImport) {
    const bytes = prepared.sourcePayload?.bytes;
    bytes?.fill(0);
    if (bytes === this.activeBytes) this.activeBytes = undefined;
  }
}

/** Zeroes the selected source archive and returns a preview-only result. */
export function releasePreparedGlookoImportSource(
  prepared: PreparedGlookoImport,
): PreparedGlookoImport {
  prepared.sourcePayload?.bytes.fill(0);
  return {
    preview: prepared.preview,
    batch: prepared.batch,
  };
}
