import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canUpgradeTarvisConversationScope,
  createTarvisConversationPersistenceCoordinator,
  createTarvisConversationPersistenceOwner,
  loadTarvisConversationState,
  type LoadedStoredTarvisExchange,
  sameTarvisConversationScope,
  saveTarvisConversation,
  type StoredTarvisExchange,
  TarvisConversationCorruptError,
  type TarvisConversationScope,
} from "@/data/tarvis/conversationStore";
import {
  resolveInsightRequestPresentation,
  resolveInsightReviewAccess,
  resolveTarvisDatasetOwnerIdentity,
  resolveTarvisLaunchContext,
  tarvisSettingsPresentation,
} from "@/data/tarvis/conversationScope";
import type { InsightReport } from "@/domain/insights";

const persistence = vi.hoisted(() => ({
  value: undefined as string | undefined,
}));

vi.mock("@/data/persistence/t1arcDatabase", () => ({
  openT1ArcDatabase: vi.fn(async () => ({
    getFirstAsync: vi.fn(async (_sql: string, key: string) =>
      key === "local-data-write-epoch-v1" ||
      key === "local-data-erase-intent-v1" ||
      persistence.value === undefined
        ? null
        : { value: persistence.value },
    ),
  })),
  withT1ArcTransaction: vi.fn(
    async (work: (transaction: unknown) => Promise<void>) =>
      work({
        getFirstAsync: vi.fn(async () => null),
        runAsync: vi.fn(async (sql: string, _key: string, value?: string) => {
          persistence.value = sql.startsWith("DELETE") ? undefined : value;
        }),
      }),
  ),
}));
vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

const DAY = 86_400_000;
const END = Date.parse("2026-08-18T23:00:00Z");
const NOW = Date.parse("2026-08-19T12:00:00Z");

function report(startOffset = 7): InsightReport {
  return {
    currentRange: { start: END - startOffset * DAY, end: END },
    previousRange: {
      start: END - startOffset * DAY * 2,
      end: END - startOffset * DAY,
    },
  } as InsightReport;
}

function exchange(scope?: TarvisConversationScope): StoredTarvisExchange {
  return {
    id: "exchange-1",
    question: "What happened?",
    answer: {
      headline: "Available records",
      answer: "A bounded answer.",
      confidence: "limited",
      evidenceIds: [],
      limitations: [],
    },
    evidence: [],
    ...(scope ? { scope, createdAt: NOW } : {}),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Tarv1s conversation data scopes", () => {
  beforeEach(() => {
    persistence.value = undefined;
  });

  it("derives a stable, order-independent identity from verified dataset owners", () => {
    const sources = [
      { sourceId: "librelinkup", identityDigest: "a".repeat(64) },
      { sourceId: "nightscout", identityDigest: "b".repeat(64) },
    ];
    const input = {
      dataMode: "live",
      localDataEpoch: 4,
      glookoFingerprint: `af1_${"c".repeat(64)}`,
    };
    const first = resolveTarvisDatasetOwnerIdentity({
      ...input,
      ownedSources: sources,
    });
    const reordered = resolveTarvisDatasetOwnerIdentity({
      ...input,
      ownedSources: [...sources].reverse(),
    });

    expect(reordered).toBe(first);
    expect(first).not.toContain("password");
    expect(first).not.toContain("@");
  });

  it("changes the dataset scope when any verified owner or erase epoch changes", () => {
    const base = {
      dataMode: "live",
      localDataEpoch: 4,
      ownedSources: [
        { sourceId: "librelinkup", identityDigest: "a".repeat(64) },
      ],
      glookoFingerprint: `af1_${"b".repeat(64)}`,
    };
    const identity = resolveTarvisDatasetOwnerIdentity(base);

    expect(
      resolveTarvisDatasetOwnerIdentity({ ...base, localDataEpoch: 5 }),
    ).not.toBe(identity);
    expect(
      resolveTarvisDatasetOwnerIdentity({
        ...base,
        ownedSources: [
          { sourceId: "librelinkup", identityDigest: "c".repeat(64) },
        ],
      }),
    ).not.toBe(identity);
    expect(
      resolveTarvisDatasetOwnerIdentity({
        ...base,
        glookoFingerprint: `af1_${"d".repeat(64)}`,
      }),
    ).not.toBe(identity);
    expect(
      resolveTarvisDatasetOwnerIdentity({ ...base, dataMode: "demo" }),
    ).toBe("demo-fixture-v1");
  });

  it("fails closed on malformed or duplicated owner inputs", () => {
    expect(() =>
      resolveTarvisDatasetOwnerIdentity({
        dataMode: "live",
        localDataEpoch: 1,
        ownedSources: [
          { sourceId: "libre", identityDigest: "raw-account@example.com" },
        ],
      }),
    ).toThrow(/owner identity is invalid/i);
    expect(() =>
      resolveTarvisDatasetOwnerIdentity({
        dataMode: "live",
        localDataEpoch: 1,
        ownedSources: [
          { sourceId: "libre", identityDigest: "a".repeat(64) },
          { sourceId: "libre", identityDigest: "b".repeat(64) },
        ],
      }),
    ).toThrow(/duplicated/i);
  });

  it("wires the verified dataset owner identity through to the Tarv1s launch", () => {
    const provider = readFileSync(
      resolve(process.cwd(), "src/providers/DataProvider.tsx"),
      "utf8",
    );
    const insights = readFileSync(
      resolve(process.cwd(), "src/screens/InsightsScreen.tsx"),
      "utf8",
    );

    expect(provider).toContain("resolveTarvisDatasetOwnerIdentity({");
    expect(provider).toContain("ownerIdentity,");
    expect(insights).toMatch(
      /resolveTarvisLaunchContext\(\{[\s\S]{0,260}ownerIdentity,[\s\S]{0,120}report:/,
    );
  });

  it("isolates launch scopes when the verified dataset owner changes", () => {
    const firstOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 1,
      ownedSources: [{ sourceId: "libre", identityDigest: "a".repeat(64) }],
    });
    const secondOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 1,
      ownedSources: [{ sourceId: "libre", identityDigest: "b".repeat(64) }],
    });
    const firstScope = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      ownerIdentity: firstOwner,
      report: report(),
    }).scope;
    const secondScope = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      ownerIdentity: secondOwner,
      report: report(),
    }).scope;

    expect(sameTarvisConversationScope(firstScope, secondScope)).toBe(false);
  });

  it("adopts a conversation only when Glooko first verifies the same local dataset", () => {
    const unboundOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 7,
      ownedSources: [{ sourceId: "librelinkup", identityDigest: "a".repeat(64) }],
    });
    const verifiedOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 7,
      ownedSources: [{ sourceId: "librelinkup", identityDigest: "a".repeat(64) }],
      glookoFingerprint: `af1_${"b".repeat(64)}`,
    });
    const unbound = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      ownerIdentity: unboundOwner,
      report: report(),
    }).scope;
    const verified = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      ownerIdentity: verifiedOwner,
      report: report(),
    }).scope;

    expect(canUpgradeTarvisConversationScope(unbound, verified)).toBe(true);
    expect(canUpgradeTarvisConversationScope(verified, unbound)).toBe(false);
  });

  it("never adopts a conversation across a source, epoch, account or review change", () => {
    const owner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 7,
      ownedSources: [{ sourceId: "librelinkup", identityDigest: "a".repeat(64) }],
    });
    const verifiedOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 7,
      ownedSources: [{ sourceId: "librelinkup", identityDigest: "a".repeat(64) }],
      glookoFingerprint: `af1_${"b".repeat(64)}`,
    });
    const sourceChangedOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 7,
      ownedSources: [{ sourceId: "librelinkup", identityDigest: "c".repeat(64) }],
      glookoFingerprint: `af1_${"b".repeat(64)}`,
    });
    const scope = (ownerIdentity: string, reviewId?: string) =>
      resolveTarvisLaunchContext({
        dataMode: "live",
        isLatestCompletePeriod: reviewId === undefined,
        now: NOW,
        ownerIdentity,
        report: report(),
        reviewId,
      }).scope;

    expect(canUpgradeTarvisConversationScope(scope(owner), scope(sourceChangedOwner))).toBe(false);
    expect(canUpgradeTarvisConversationScope(scope(owner, "one"), scope(verifiedOwner, "two"))).toBe(false);
  });

  it("anchors an unsaved historical review inside its exclusive end", () => {
    const context = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: false,
      now: NOW,
      report: report(),
    });

    expect(context.liveData).toBe(false);
    expect(context.asOf).toBe(END - 1);
    expect(context.scope.kind).toBe("review");
  });

  it("keeps the current unsaved view live but isolates a saved review", () => {
    const live = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      report: report(),
    });
    const saved = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      report: report(),
      reviewId: "review-a",
    });

    expect(live).toMatchObject({ asOf: NOW, liveData: true });
    expect(live.scope.kind).toBe("live");
    expect(saved).toMatchObject({ asOf: END - 1, liveData: false });
    expect(saved.scope).toMatchObject({
      kind: "review",
      identity: "saved:live:personal-local-store-v1:review-a",
    });
    expect(sameTarvisConversationScope(live.scope, saved.scope)).toBe(false);
  });

  it("does not reuse review A history in review B or a different range", () => {
    const reviewA = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: false,
      now: NOW,
      report: report(),
      reviewId: "review-a",
    }).scope;
    const reviewB = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: false,
      now: NOW,
      report: report(),
      reviewId: "review-b",
    }).scope;
    const otherRange = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: false,
      now: NOW,
      report: report(30),
      reviewId: "review-a",
    }).scope;

    expect(sameTarvisConversationScope(reviewA, reviewB)).toBe(false);
    expect(sameTarvisConversationScope(reviewA, otherRange)).toBe(false);
  });

  it("separates demo and personal repositories for the same review range", () => {
    const personal = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: false,
      now: NOW,
      report: report(),
    }).scope;
    const demo = resolveTarvisLaunchContext({
      dataMode: "demo",
      isLatestCompletePeriod: false,
      now: NOW,
      report: report(),
    }).scope;
    const otherOwner = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: false,
      now: NOW,
      ownerIdentity: "other-personal-store",
      report: report(),
    }).scope;

    expect(sameTarvisConversationScope(personal, demo)).toBe(false);
    expect(sameTarvisConversationScope(personal, otherOwner)).toBe(false);
    expect(personal).toMatchObject({
      dataMode: "live",
      ownerIdentity: "personal-local-store-v1",
    });
    expect(demo).toMatchObject({
      dataMode: "demo",
      ownerIdentity: "demo-fixture-v1",
    });
  });

  it("returns missing, loaded and corrupt storage states explicitly", async () => {
    await expect(loadTarvisConversationState()).resolves.toEqual({
      status: "missing",
      exchanges: [],
    });

    const scope = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      report: report(),
    }).scope;
    await saveTarvisConversation([exchange(scope)]);
    const loaded = await loadTarvisConversationState();
    expect(loaded.status).toBe("loaded");
    expect(loaded.exchanges[0]).toMatchObject({ createdAt: NOW, scope });

    persistence.value = "";
    await expect(loadTarvisConversationState()).resolves.toMatchObject({
      status: "corrupt",
      exchanges: [],
    });

    persistence.value = "{not-json";
    const corrupt = await loadTarvisConversationState();
    expect(corrupt).toMatchObject({ status: "corrupt", exchanges: [] });
    await expect(
      saveTarvisConversation([exchange(scope)]),
    ).rejects.toBeInstanceOf(TarvisConversationCorruptError);
    expect(persistence.value).toBe("{not-json");
  });

  it("migrates legacy exchanges into an incompatible fail-closed scope", async () => {
    persistence.value = JSON.stringify({
      schemaVersion: 3,
      updatedAt: NOW,
      exchanges: [exchange()],
    });

    const result = await loadTarvisConversationState();
    expect(result.status).toBe("loaded");
    expect(result.exchanges[0]).toMatchObject({
      createdAt: NOW,
      scope: { kind: "legacy-unknown", identity: "legacy-unknown" },
    });
    const liveScope = resolveTarvisLaunchContext({
      dataMode: "live",
      isLatestCompletePeriod: true,
      now: NOW,
      report: report(),
    }).scope;
    expect(
      sameTarvisConversationScope(result.exchanges[0]!.scope, liveScope),
    ).toBe(false);
  });

  it("migrates an older scoped exchange without owner identity fail-closed", async () => {
    const olderScoped = {
      ...exchange(),
      scope: {
        kind: "review",
        identity: "saved:old-review",
        currentRange: report().currentRange,
        previousRange: report().previousRange,
      },
    };
    persistence.value = JSON.stringify({
      schemaVersion: 3,
      updatedAt: NOW,
      exchanges: [olderScoped],
    });

    const result = await loadTarvisConversationState();
    expect(result.status).toBe("loaded");
    expect(result.exchanges[0]?.scope).toEqual({
      kind: "legacy-unknown",
      identity: "legacy-unknown",
    });
  });

  it("serializes an in-flight save before a newer clear so history cannot reappear", async () => {
    const firstWrite = deferred();
    const operations: string[] = [];
    const coordinator = createTarvisConversationPersistenceCoordinator({
      save: async () => {
        operations.push("save-start");
        await firstWrite.promise;
        operations.push("save-finish");
      },
      clear: async () => {
        operations.push("clear");
      },
    });

    const save = coordinator.save([exchange()]);
    await vi.waitFor(() => expect(operations).toEqual(["save-start"]));
    const clear = coordinator.replace([]);
    firstWrite.resolve();
    await Promise.all([save, clear]);

    expect(operations).toEqual(["save-start", "save-finish", "clear"]);
  });

  it("skips an older queued save once a replacement generation is requested", async () => {
    const firstWrite = deferred();
    const savedIds: string[] = [];
    const coordinator = createTarvisConversationPersistenceCoordinator({
      save: async (items) => {
        savedIds.push(items[0]?.id ?? "empty");
        if (items[0]?.id === "first") await firstWrite.promise;
      },
      clear: async () => {
        savedIds.push("clear");
      },
    });
    const first = { ...exchange(), id: "first" };
    const stale = { ...exchange(), id: "stale" };

    const firstSave = coordinator.save([first]);
    await vi.waitFor(() => expect(savedIds).toEqual(["first"]));
    const staleSave = coordinator.save([stale]);
    const clear = coordinator.replace([]);
    firstWrite.resolve();

    await expect(staleSave).resolves.toBe("superseded");
    await Promise.all([firstSave, clear]);
    expect(savedIds).toEqual(["first", "clear"]);
  });

  it("serializes a new scope load behind an older pending replacement", async () => {
    const replacementGate = deferred();
    const scopeB: LoadedStoredTarvisExchange = {
      ...exchange({
        kind: "live",
        identity: "scope-b",
        dataMode: "live",
        ownerIdentity: "owner-b",
      }),
      id: "scope-b",
      threadId: "thread-b",
      createdAt: NOW,
      scope: {
        kind: "live",
        identity: "scope-b",
        dataMode: "live",
        ownerIdentity: "owner-b",
      },
    };
    let stored: LoadedStoredTarvisExchange[] = [scopeB];
    const operations: string[] = [];
    const coordinator = createTarvisConversationPersistenceCoordinator({
      load: async () => {
        operations.push("load");
        return { status: "loaded" as const, exchanges: [...stored] };
      },
      save: async (items) => {
        operations.push("replacement-start");
        await replacementGate.promise;
        stored = items.map((item): LoadedStoredTarvisExchange => ({
          ...item,
          createdAt: item.createdAt ?? NOW,
          scope: item.scope ?? {
            kind: "legacy-unknown",
            identity: "legacy-unknown",
          },
          threadId: item.threadId ?? "legacy:legacy-unknown",
        }));
        operations.push("replacement-finish");
      },
      clear: async () => {
        stored = [];
      },
    });

    const replacement = coordinator.replace([scopeB]);
    await vi.waitFor(() => expect(operations).toEqual(["replacement-start"]));
    const scopeBLoad = coordinator.load();
    await Promise.resolve();
    expect(operations).toEqual(["replacement-start"]);

    replacementGate.resolve();
    await replacement;
    await expect(scopeBLoad).resolves.toEqual({
      status: "loaded",
      exchanges: [scopeB],
    });
    expect(operations).toEqual([
      "replacement-start",
      "replacement-finish",
      "load",
    ]);
  });

  it("captures the erase lease before a queued save waits behind older work", async () => {
    const firstWrite = deferred();
    let currentEpoch = 6;
    const acquireWriteLease = vi.fn(async () => ({ epoch: currentEpoch }));
    const coordinator = createTarvisConversationPersistenceCoordinator({
      acquireWriteLease,
      save: async (items, lease) => {
        if (items[0]?.id === "first") {
          await firstWrite.promise;
          return;
        }
        if (lease?.epoch !== currentEpoch) {
          const error = new Error("superseded");
          error.name = "LocalDataWriteSupersededError";
          throw error;
        }
      },
      clear: async () => undefined,
    });
    const first = { ...exchange(), id: "first" };
    const queued = { ...exchange(), id: "queued" };

    const firstSave = coordinator.save([first]);
    await vi.waitFor(() => expect(acquireWriteLease).toHaveBeenCalledOnce());
    const queuedSave = coordinator.save([queued]);
    expect(acquireWriteLease).toHaveBeenCalledTimes(2);

    currentEpoch = 7;
    firstWrite.resolve();
    await firstSave;
    await expect(queuedSave).rejects.toMatchObject({
      name: "LocalDataWriteSupersededError",
    });
  });

  it("shares the generation across screen remount handles", async () => {
    const oldMountWrite = deferred();
    const operations: string[] = [];
    const owner = createTarvisConversationPersistenceOwner({
      save: async () => {
        operations.push("old-mount-save-start");
        await oldMountWrite.promise;
        operations.push("old-mount-save-finish");
      },
      clear: async () => {
        operations.push("new-mount-clear");
      },
    });
    const oldMount = owner.forMount();
    const oldSave = oldMount.save([exchange()]);
    await vi.waitFor(() =>
      expect(operations).toEqual(["old-mount-save-start"]),
    );

    const newMount = owner.forMount();
    expect(newMount).toBe(oldMount);
    const clear = newMount.replace([]);
    oldMountWrite.resolve();
    await Promise.all([oldSave, clear]);

    expect(operations).toEqual([
      "old-mount-save-start",
      "old-mount-save-finish",
      "new-mount-clear",
    ]);
  });
});

describe("Tarv1s UI truthfulness helpers", () => {
  it("does not show a false disconnected form after settings load failure", () => {
    expect(tarvisSettingsPresentation("error", false)).toEqual({
      canEdit: false,
      showConnectionForm: false,
      showRemove: false,
      showRetry: true,
    });
    expect(tarvisSettingsPresentation("loaded", true)).toMatchObject({
      canEdit: true,
      showConnectionForm: true,
      showRemove: true,
    });
  });

  it("keeps a selected saved snapshot independent of background request state", () => {
    expect(
      resolveInsightRequestPresentation({
        error: "Background query failed",
        hasSelectedReview: true,
        loading: true,
      }),
    ).toEqual({ error: undefined, loading: false });
    expect(
      resolveInsightRequestPresentation({
        error: "Current query failed",
        hasSelectedReview: false,
        loading: true,
      }),
    ).toEqual({ error: "Current query failed", loading: true });
  });

  it("keeps saved review access independent of the current comparison result", () => {
    expect(
      resolveInsightReviewAccess({
        dataMode: "live",
        historyError: undefined,
        historyLoading: false,
        savedReviewCount: 2,
      }),
    ).toMatchObject({ showReviewArea: true, showHistory: true });
    expect(
      resolveInsightReviewAccess({
        dataMode: "live",
        historyError: "Saved history failed",
        historyLoading: false,
        savedReviewCount: 0,
      }),
    ).toEqual({
      showReviewArea: true,
      showHistory: false,
      showHistoryLoading: false,
      historyError: "Saved history failed",
    });
  });
});
