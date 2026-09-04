import { describe, expect, it, vi } from "vitest";

import { rebindSerializedTarvisConversationToDatasetOwner } from "@/data/tarvis/conversationMigration";
import {
  serializeTarvisConversation,
  type StoredTarvisExchange,
  type TarvisConversationScope,
} from "@/data/tarvis/conversationStore";
import {
  isTarvisDatasetOwnerIdentity,
  resolveTarvisDatasetOwnerIdentity,
} from "@/data/tarvis/conversationScope";

vi.mock("expo-sqlite", () => ({}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-secure-store", () => ({}));

const UPDATED_AT = Date.parse("2026-08-29T04:00:00Z");
const SOURCE_OWNER = resolveTarvisDatasetOwnerIdentity({
  dataMode: "live",
  localDataEpoch: 4,
  ownedSources: [
    { sourceId: "librelinkup", identityDigest: "a".repeat(64) },
  ],
  glookoFingerprint: `af1_${"b".repeat(64)}`,
});
const TARGET_OWNER = resolveTarvisDatasetOwnerIdentity({
  dataMode: "live",
  localDataEpoch: 0,
  ownedSources: [],
});

function exchange(
  id: string,
  scope: TarvisConversationScope,
): StoredTarvisExchange {
  return {
    id,
    threadId: "thread-preserved",
    question: `Question ${id}`,
    answer: {
      headline: `Answer ${id}`,
      answer: "Preserve this answer exactly.",
      confidence: "limited",
      evidenceIds: [],
      limitations: ["Preserve this limitation."],
    },
    evidence: [],
    createdAt: UPDATED_AT - 1_000,
    scope,
  };
}

function liveScope(ownerIdentity = SOURCE_OWNER): TarvisConversationScope {
  return {
    kind: "live",
    identity: `live:live:${ownerIdentity}`,
    dataMode: "live",
    ownerIdentity,
    accountId: "recovery-account-binding",
  };
}

describe("Tarv1s exact-migration conversation rebinding", () => {
  it("recognises only canonical credential-free dataset-owner identities", () => {
    expect(isTarvisDatasetOwnerIdentity(SOURCE_OWNER)).toBe(true);
    expect(isTarvisDatasetOwnerIdentity(TARGET_OWNER)).toBe(true);
    expect(
      isTarvisDatasetOwnerIdentity(
        `dataset-owner-v1|epoch:04|glooko:none`,
      ),
    ).toBe(false);
    expect(
      isTarvisDatasetOwnerIdentity(
        `dataset-owner-v1|epoch:4|librelinkup:${"z".repeat(64)}|glooko:none`,
      ),
    ).toBe(false);
    expect(isTarvisDatasetOwnerIdentity("personal-local-store-v1")).toBe(
      false,
    );
  });

  it("preserves exchanges, threads and review ranges while replacing only owner scope", () => {
    const currentRange = { start: 20_000, end: 30_000 };
    const previousRange = { start: 10_000, end: 20_000 };
    const serialized = serializeTarvisConversation(
      [
        exchange("live", liveScope()),
        exchange("saved", {
          kind: "review",
          identity: `saved:live:${SOURCE_OWNER}:review-7`,
          dataMode: "live",
          ownerIdentity: SOURCE_OWNER,
          currentRange,
          previousRange,
          accountId: "recovery-account-binding",
        }),
        exchange("range", {
          kind: "review",
          identity: [
            "range",
            "live",
            SOURCE_OWNER,
            previousRange.start,
            previousRange.end,
            currentRange.start,
            currentRange.end,
          ].join(":"),
          dataMode: "live",
          ownerIdentity: SOURCE_OWNER,
          currentRange,
          previousRange,
          accountId: "recovery-account-binding",
        }),
      ],
      UPDATED_AT,
    );

    const before = JSON.parse(serialized);
    const rebound = JSON.parse(
      rebindSerializedTarvisConversationToDatasetOwner(
        serialized,
        TARGET_OWNER,
      ),
    );

    expect(rebound).toMatchObject({ schemaVersion: 3, updatedAt: UPDATED_AT });
    expect(
      rebound.exchanges.map((item: StoredTarvisExchange) => ({
        id: item.id,
        threadId: item.threadId,
        question: item.question,
        answer: item.answer,
        evidence: item.evidence,
        createdAt: item.createdAt,
      })),
    ).toEqual(
      before.exchanges.map((item: StoredTarvisExchange) => ({
        id: item.id,
        threadId: item.threadId,
        question: item.question,
        answer: item.answer,
        evidence: item.evidence,
        createdAt: item.createdAt,
      })),
    );
    expect(rebound.exchanges[0].scope).toEqual({
      kind: "live",
      identity: `live:live:${TARGET_OWNER}`,
      dataMode: "live",
      ownerIdentity: TARGET_OWNER,
    });
    expect(rebound.exchanges[1].scope).toEqual({
      kind: "review",
      identity: `saved:live:${TARGET_OWNER}:review-7`,
      dataMode: "live",
      ownerIdentity: TARGET_OWNER,
      currentRange,
      previousRange,
    });
    expect(rebound.exchanges[2].scope.identity).toBe(
      [
        "range",
        "live",
        TARGET_OWNER,
        previousRange.start,
        previousRange.end,
        currentRange.start,
        currentRange.end,
      ].join(":"),
    );
  });

  it("fails closed for legacy, inconsistent, or multi-owner source scopes", () => {
    const legacy = serializeTarvisConversation(
      [exchange("legacy", { kind: "legacy-unknown", identity: "legacy-unknown" })],
      UPDATED_AT,
    );
    expect(() =>
      rebindSerializedTarvisConversationToDatasetOwner(legacy, TARGET_OWNER),
    ).toThrow(/dataset owner cannot be verified/i);

    const inconsistent = serializeTarvisConversation(
      [
        exchange("inconsistent", {
          kind: "live",
          identity: "live:live:wrong",
          dataMode: "live",
          ownerIdentity: SOURCE_OWNER,
          accountId: "recovery-account-binding",
        }),
      ],
      UPDATED_AT,
    );
    expect(() =>
      rebindSerializedTarvisConversationToDatasetOwner(
        inconsistent,
        TARGET_OWNER,
      ),
    ).toThrow(/dataset owner cannot be verified/i);

    const otherOwner = resolveTarvisDatasetOwnerIdentity({
      dataMode: "live",
      localDataEpoch: 4,
      ownedSources: [
        { sourceId: "nightscout", identityDigest: "c".repeat(64) },
      ],
    });
    const multiple = serializeTarvisConversation(
      [exchange("first", liveScope()), exchange("second", liveScope(otherOwner))],
      UPDATED_AT,
    );
    expect(() =>
      rebindSerializedTarvisConversationToDatasetOwner(multiple, TARGET_OWNER),
    ).toThrow(/dataset owner cannot be verified/i);
  });
});
