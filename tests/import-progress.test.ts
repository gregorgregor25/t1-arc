import { describe, expect, it } from "vitest";

import {
  formatImportElapsed,
  IMPORT_PROGRESS_COPY,
} from "@/components/importProgress";

describe("import progress presentation", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 0, 999])(
    "clamps an invalid or sub-second duration (%s)",
    (duration) => {
      expect(formatImportElapsed(duration, "en-GB")).toBe("0 sec");
    },
  );

  it("formats seconds and minute boundaries without rounding into the future", () => {
    expect(formatImportElapsed(59_999, "en-GB")).toBe("59 sec");
    expect(formatImportElapsed(60_000, "en-GB")).toBe("1 min 0 sec");
    expect(formatImportElapsed(125_800, "en-GB")).toBe("2 min 5 sec");
  });

  it("uses the selected number format", () => {
    expect(formatImportElapsed(65_000, "ar-EG")).toBe("١ min ٥ sec");
  });

  it("keeps file validation, saving and separate pump history distinct", () => {
    expect(IMPORT_PROGRESS_COPY.read.detail).toContain("before importing");
    expect(IMPORT_PROGRESS_COPY.save.detail).toContain("confirmed records");
    expect(IMPORT_PROGRESS_COPY.report.detail).toContain(
      "separate Daily Overview",
    );
    expect(IMPORT_PROGRESS_COPY.sync.detail).toContain("several minutes");
    for (const copy of Object.values(IMPORT_PROGRESS_COPY)) {
      expect(`${copy.title} ${copy.detail}`).not.toMatch(
        /\d+%|remaining|almost done/i,
      );
    }
  });
});
