import type { TarvisConversationScope } from "@/data/tarvis/conversationStore";
import type { InsightReport } from "@/domain/insights";

export interface TarvisLaunchContext {
  asOf: number;
  liveData: boolean;
  scope: TarvisConversationScope;
}

export interface TarvisDatasetOwnerSource {
  sourceId: string;
  identityDigest: string;
}

const SOURCE_ID = /^[a-z0-9][a-z0-9-]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const GLOOKO_ACCOUNT_FINGERPRINT = /^af1_[0-9a-f]{64}$/i;

/**
 * Accepts only the canonical credential-free identity emitted below. This is
 * deliberately stricter than checking a prefix: migration code may rebind a
 * conversation only after proving its prior owner was a real dataset scope.
 */
export function isTarvisDatasetOwnerIdentity(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const segments = value.split("|");
  if (
    segments.length < 3 ||
    segments[0] !== "dataset-owner-v1" ||
    !/^epoch:(0|[1-9][0-9]*)$/.test(segments[1] ?? "")
  ) {
    return false;
  }
  const localDataEpoch = Number(segments[1]!.slice("epoch:".length));
  const glookoSegment = segments.at(-1)!;
  const glookoValue = glookoSegment.slice("glooko:".length);
  if (
    !glookoSegment.startsWith("glooko:") ||
    (glookoValue !== "none" &&
      !GLOOKO_ACCOUNT_FINGERPRINT.test(glookoValue))
  ) {
    return false;
  }
  const ownedSources: TarvisDatasetOwnerSource[] = [];
  for (const segment of segments.slice(2, -1)) {
    const separator = segment.indexOf(":");
    const sourceId = segment.slice(0, separator);
    const identityDigest = segment.slice(separator + 1);
    if (
      separator <= 0 ||
      !SOURCE_ID.test(sourceId) ||
      !SHA256_HEX.test(identityDigest)
    ) {
      return false;
    }
    ownedSources.push({ sourceId, identityDigest });
  }
  try {
    return (
      resolveTarvisDatasetOwnerIdentity({
        dataMode: "live",
        localDataEpoch,
        ownedSources,
        ...(glookoValue === "none"
          ? {}
          : { glookoFingerprint: glookoValue }),
      }) === value
    );
  } catch {
    return false;
  }
}

/**
 * Builds a collision-free, credential-free identity for the local health
 * dataset. Every supplied owner value is already a one-way digest. Keeping the
 * complete sorted tuple avoids weakening privacy isolation with a short hash.
 */
export function resolveTarvisDatasetOwnerIdentity({
  dataMode,
  glookoFingerprint,
  localDataEpoch,
  ownedSources,
}: {
  dataMode: string;
  glookoFingerprint?: string;
  localDataEpoch: number;
  ownedSources: readonly TarvisDatasetOwnerSource[];
}) {
  if (dataMode === "demo") return "demo-fixture-v1";
  if (!Number.isSafeInteger(localDataEpoch) || localDataEpoch < 0) {
    throw new Error("The Tarv1s dataset epoch is invalid.");
  }
  if (
    glookoFingerprint !== undefined &&
    !GLOOKO_ACCOUNT_FINGERPRINT.test(glookoFingerprint)
  ) {
    throw new Error("The Tarv1s Glooko owner fingerprint is invalid.");
  }
  const sources = ownedSources
    .map(({ identityDigest, sourceId }) => {
      if (!SOURCE_ID.test(sourceId) || !SHA256_HEX.test(identityDigest)) {
        throw new Error("A Tarv1s source owner identity is invalid.");
      }
      return `${sourceId}:${identityDigest.toLowerCase()}`;
    })
    .sort();
  if (
    new Set(sources.map((entry) => entry.split(":", 1)[0])).size !==
    sources.length
  ) {
    throw new Error("A Tarv1s source owner identity is duplicated.");
  }
  return [
    "dataset-owner-v1",
    `epoch:${localDataEpoch}`,
    ...sources,
    `glooko:${glookoFingerprint?.toLowerCase() ?? "none"}`,
  ].join("|");
}

function reviewIdentity(
  report: InsightReport,
  dataMode: string,
  ownerIdentity: string,
  reviewId?: string,
) {
  return reviewId
    ? `saved:${dataMode}:${ownerIdentity}:${reviewId}`
    : [
        "range",
        dataMode,
        ownerIdentity,
        report.previousRange.start,
        report.previousRange.end,
        report.currentRange.start,
        report.currentRange.end,
      ].join(":");
}

export function resolveTarvisLaunchContext({
  accountId,
  dataMode,
  isLatestCompletePeriod,
  now,
  ownerIdentity,
  report,
  reviewId,
}: {
  accountId?: string;
  dataMode: string;
  isLatestCompletePeriod: boolean;
  now: number;
  ownerIdentity?: string;
  report: InsightReport;
  reviewId?: string;
}): TarvisLaunchContext {
  const resolvedOwnerIdentity =
    ownerIdentity ??
    accountId ??
    (dataMode === "demo" ? "demo-fixture-v1" : "personal-local-store-v1");
  const liveData =
    dataMode === "live" && isLatestCompletePeriod && reviewId === undefined;
  if (liveData) {
    return {
      asOf: now,
      liveData: true,
      scope: {
        kind: "live",
        identity: `live:${dataMode}:${resolvedOwnerIdentity}`,
        dataMode,
        ownerIdentity: resolvedOwnerIdentity,
        ...(accountId ? { accountId } : {}),
      },
    };
  }
  return {
    // Insight ranges are half-open. Keep the assistant inside the selected
    // inclusive period rather than anchoring relative language to the next day.
    asOf: Math.max(report.currentRange.start, report.currentRange.end - 1),
    liveData: false,
    scope: {
      kind: "review",
      identity: reviewIdentity(
        report,
        dataMode,
        resolvedOwnerIdentity,
        reviewId,
      ),
      dataMode,
      ownerIdentity: resolvedOwnerIdentity,
      currentRange: { ...report.currentRange },
      previousRange: { ...report.previousRange },
      ...(accountId ? { accountId } : {}),
    },
  };
}

export type TarvisSettingsStatus = "loading" | "loaded" | "error";

export function tarvisSettingsPresentation(
  status: TarvisSettingsStatus,
  hasApiKey: boolean,
) {
  return {
    canEdit: status === "loaded",
    showConnectionForm: status === "loaded",
    showRemove: status === "loaded" && hasApiKey,
    showRetry: status === "error",
  };
}

export function resolveInsightRequestPresentation({
  error,
  hasSelectedReview,
  loading,
}: {
  error?: string;
  hasSelectedReview: boolean;
  loading: boolean;
}) {
  return {
    error: hasSelectedReview ? undefined : error,
    loading: !hasSelectedReview && loading,
  };
}

export function resolveInsightReviewAccess({
  dataMode,
  historyError,
  historyLoading,
  savedReviewCount,
}: {
  dataMode: string;
  historyError?: string;
  historyLoading: boolean;
  savedReviewCount: number;
}) {
  return {
    showReviewArea: dataMode === "live",
    showHistory: savedReviewCount > 0,
    showHistoryLoading: historyLoading && savedReviewCount === 0,
    historyError,
  };
}
