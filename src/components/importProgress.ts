import { formatRegionalNumber } from "@/domain/regionalFormat";

export type ImportProgressStage = "sync" | "read" | "save" | "report";

export const IMPORT_PROGRESS_COPY: Record<
  ImportProgressStage,
  { title: string; detail: string }
> = {
  sync: {
    title: "Updating Glooko history",
    detail:
      "Requesting an export, checking its records and saving your history. A first import can take several minutes.",
  },
  read: {
    title: "Reading your export",
    detail:
      "Checking dates, units and records on this phone. You can review the file before importing it.",
  },
  save: {
    title: "Saving your history",
    detail:
      "Adding the confirmed records to encrypted storage. Keep T1 Arc open until this finishes.",
  },
  report: {
    title: "Checking pump history",
    detail:
      "The glucose and insulin import finished. Now checking the separate Daily Overview report.",
  },
};

/** A running clock is not a completion estimate or a claim of network progress. */
export function formatImportElapsed(milliseconds: number, locale: string) {
  const seconds = Number.isFinite(milliseconds)
    ? Math.max(0, Math.floor(milliseconds / 1_000))
    : 0;
  const number = (value: number) =>
    formatRegionalNumber(value, locale, { maximumFractionDigits: 0 });
  return seconds < 60
    ? `${number(seconds)} sec`
    : `${number(Math.floor(seconds / 60))} min ${number(seconds % 60)} sec`;
}
