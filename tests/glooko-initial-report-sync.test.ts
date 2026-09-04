import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { runInitialGlookoReportSync } from "@/data/glooko/glookoInitialReportSync";

describe("initial Glooko report sync", () => {
  it("starts the report immediately and completes its outcome", async () => {
    const outcome = { status: "success" as const };
    const sync = vi.fn(async () => outcome);
    const complete = vi.fn(async () => outcome);
    const setSyncing = vi.fn();

    const pending = runInitialGlookoReportSync({
      sync,
      complete,
      setSyncing,
    });

    expect(sync).toHaveBeenCalledOnce();
    expect(setSyncing).toHaveBeenCalledWith(true);

    await expect(pending).resolves.toBeUndefined();
    expect(complete).toHaveBeenCalledWith(outcome);
    expect(setSyncing).toHaveBeenLastCalledWith(false);
  });

  it("keeps a successful CSV connection non-fatal when report startup fails", async () => {
    const complete = vi.fn();
    const setSyncing = vi.fn();

    await expect(
      runInitialGlookoReportSync({
        sync: async () => {
          throw new Error("Report connector unavailable");
        },
        complete,
        setSyncing,
      }),
    ).resolves.toBeUndefined();

    expect(complete).not.toHaveBeenCalled();
    expect(setSyncing.mock.calls).toEqual([[true], [false]]);
  });

  it("launches only inside the successful credential-verification branch", () => {
    const source = readFileSync(
      new URL("../src/providers/DataProvider.tsx", import.meta.url),
      "utf8",
    );
    const successStart = source.indexOf(
      'if (outcome.status === "success")',
      source.indexOf("const markGlookoCredentialsReady"),
    );
    const outcomeReturn = source.indexOf("return outcome;", successStart);
    const successFlow = source.slice(successStart, outcomeReturn);

    expect(successStart).toBeGreaterThanOrEqual(0);
    expect(outcomeReturn).toBeGreaterThan(successStart);
    expect(successFlow).toContain("void runInitialGlookoReportSync({");
    const stateSave = successFlow.indexOf(
      "saveGlookoReportSyncState(reportReady, writeLease)",
    );
    expect(stateSave).toBeGreaterThanOrEqual(0);
    expect(stateSave).toBeLessThan(
      successFlow.indexOf("void runInitialGlookoReportSync({"),
    );
  });
});
