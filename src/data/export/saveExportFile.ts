import { File } from "expo-file-system";

import T1ArcBackupCrypto from "../../../modules/t1arc-backup-crypto";
import { acquireLocalDataWriteLease, assertLocalDataWriteLeaseCurrent } from "@/data/privacy/localDataWriteEpoch";

export type ExportFileKind = "csv" | "html";

const MIME_TYPES: Record<ExportFileKind, string> = {
  csv: "text/csv",
  html: "text/html",
};

/** Only plain names; the native picker rejects path separators anyway. */
export function safeExportFileName(name: string, kind: ExportFileKind) {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 120) || "T1-Arc-export";
  return base.toLowerCase().endsWith(`.${kind}`) ? base : `${base}.${kind}`;
}

/**
 * Explicit, user-initiated export of an unencrypted file through Android's
 * save dialog. The temporary copy lives in the native-allowlisted private
 * directory and is removed afterwards; the native module also sweeps any
 * interrupted copy. Nothing is uploaded.
 */
export async function saveExportFile(
  contents: string,
  fileName: string,
  kind: ExportFileKind,
): Promise<"saved" | "cancelled"> {
  const lease = await acquireLocalDataWriteLease();
  // The native module accepts only its own working-file suffixes. The saved
  // file's name and type come from the save dialog request below.
  const file = new File(await T1ArcBackupCrypto.createWorkingFileAsync(kind === "html" ? ".html" : ".txt"));
  try {
    file.write(contents);
    await assertLocalDataWriteLeaseCurrent(lease);
    const result = await T1ArcBackupCrypto.saveTemporaryFileAsync(
      file.uri,
      safeExportFileName(fileName, kind),
      MIME_TYPES[kind],
    );
    return result.status;
  } finally {
    if (file.exists) file.delete();
  }
}
