import { File } from "expo-file-system";

import T1ArcBackupCrypto from "../../../modules/t1arc-backup-crypto";
import { acquireLocalDataWriteLease, assertLocalDataWriteLeaseCurrent } from "@/data/privacy/localDataWriteEpoch";
import type { NotebookReport } from "./notebookReport";

/** Explicitly exports the already-previewed report. It is intentionally unencrypted. */
export async function exportNotebookReport(report: NotebookReport): Promise<"saved" | "cancelled"> {
  const lease = await acquireLocalDataWriteLease();
  // This private path is allowlisted by the existing native document picker.
  // The native module also sweeps interrupted files here after their lifetime.
  const file = new File(await T1ArcBackupCrypto.createWorkingFileAsync('.html'));
  try {
    file.write(report.html);
    await assertLocalDataWriteLeaseCurrent(lease);
    const result = await T1ArcBackupCrypto.saveTemporaryFileAsync(
      file.uri, `T1-Arc-appointment-notes-${new Date().toISOString().slice(0, 10)}.html`, "text/html",
    );
    return result.status;
  } finally {
    if (file.exists) file.delete();
  }
}
