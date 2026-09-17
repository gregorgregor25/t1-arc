import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/providers/DataProvider.tsx", import.meta.url),
  "utf8",
);

function section(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Glooko deletion barriers", () => {
  it("drains and holds CSV plus report work during ordinary imported-data deletion", () => {
    const clear = section(
      "const clearImportedGlookoData",
      "const clearImportedDexcomData",
    );

    expect(clear).toContain("const barrier = beginGlookoDataChange()");
    expect(clear).toContain(
      "const reportBarrier = beginGlookoReportDataChange()",
    );
    expect(clear).toContain(
      "await Promise.all([barrier.ready, reportBarrier.ready])",
    );
    expect(clear).toContain("barrier.release()");
    expect(clear).toContain("reportBarrier.release()");
  });

  it("does not mutate Glooko state while the full-erase intent is active", () => {
    const erase = section(
      "const eraseAllLocalHealthData",
      "const deleteManualContext",
    );
    const intent = erase.indexOf("await invalidateLocalDataWritesForErase()");
    const dataErase = erase.indexOf("await eraseLocalHealthData()");
    const disable = erase.indexOf("await updateGlookoSyncState(");

    expect(disable).toBeGreaterThanOrEqual(0);
    expect(disable).toBeLessThan(intent);
    expect(dataErase).toBeGreaterThan(intent);
    expect(erase.slice(intent, dataErase)).not.toContain(
      "updateGlookoSyncState(",
    );
    expect(erase).toContain("reportBarrier.ready");
    expect(erase).toContain("reportBarrier?.release()");
    expect(
      erase.indexOf("updateGlookoBackgroundSyncRegistration()", dataErase),
    ).toBeGreaterThan(dataErase);
  });
});
