import {
  type StoredTarvisExchange,
  type TarvisConversationScope,
  validateSerializedTarvisConversation,
} from "@/data/tarvis/conversationStore";
import { isTarvisDatasetOwnerIdentity } from "@/data/tarvis/conversationScope";

interface PortableTarvisConversation {
  schemaVersion: 3;
  updatedAt: number;
  exchanges: StoredTarvisExchange[];
}

function invalidMigrationScope(): never {
  throw new Error(
    "The migration contains a Tarv1s conversation whose dataset owner cannot be verified.",
  );
}

function rebindScope(
  scope: TarvisConversationScope,
  targetOwnerIdentity: string,
): TarvisConversationScope {
  if (
    scope.kind === "legacy-unknown" ||
    scope.dataMode !== "live" ||
    !isTarvisDatasetOwnerIdentity(scope.ownerIdentity)
  ) {
    return invalidMigrationScope();
  }
  if (scope.kind === "live") {
    if (scope.identity !== `live:live:${scope.ownerIdentity}`) {
      return invalidMigrationScope();
    }
    return {
      kind: "live",
      identity: `live:live:${targetOwnerIdentity}`,
      dataMode: "live",
      ownerIdentity: targetOwnerIdentity,
    };
  }

  const savedPrefix = `saved:live:${scope.ownerIdentity}:`;
  const expectedRangeIdentity = [
    "range",
    "live",
    scope.ownerIdentity,
    scope.previousRange.start,
    scope.previousRange.end,
    scope.currentRange.start,
    scope.currentRange.end,
  ].join(":");
  let identity: string;
  if (scope.identity.startsWith(savedPrefix)) {
    const reviewId = scope.identity.slice(savedPrefix.length);
    if (!reviewId) return invalidMigrationScope();
    identity = `saved:live:${targetOwnerIdentity}:${reviewId}`;
  } else if (scope.identity === expectedRangeIdentity) {
    identity = [
      "range",
      "live",
      targetOwnerIdentity,
      scope.previousRange.start,
      scope.previousRange.end,
      scope.currentRange.start,
      scope.currentRange.end,
    ].join(":");
  } else {
    return invalidMigrationScope();
  }
  return {
    kind: "review",
    identity,
    dataMode: "live",
    ownerIdentity: targetOwnerIdentity,
    currentRange: { ...scope.currentRange },
    previousRange: { ...scope.previousRange },
  };
}

/**
 * Rebinds an authenticated, portable conversation from one verified recovery
 * dataset to the clean target sandbox. It preserves every exchange, thread,
 * answer and evidence field while deliberately removing obsolete account
 * binding. Multiple source owners or ambiguous legacy scopes fail closed.
 */
export function rebindSerializedTarvisConversationToDatasetOwner(
  value: unknown,
  targetOwnerIdentity: string,
) {
  if (!isTarvisDatasetOwnerIdentity(targetOwnerIdentity)) {
    throw new Error("The target Tarv1s dataset owner is invalid.");
  }
  const document = JSON.parse(
    validateSerializedTarvisConversation(value),
  ) as PortableTarvisConversation;
  const sourceOwners = new Set<string>();
  const accountIds = new Set<string>();
  for (const exchange of document.exchanges) {
    const scope = exchange.scope;
    if (!scope || scope.kind === "legacy-unknown") invalidMigrationScope();
    sourceOwners.add(scope.ownerIdentity);
    if (scope.accountId) accountIds.add(scope.accountId);
  }
  if (sourceOwners.size > 1 || accountIds.size > 1) invalidMigrationScope();

  return validateSerializedTarvisConversation(
    JSON.stringify({
      ...document,
      exchanges: document.exchanges.map((exchange) => ({
        ...exchange,
        scope: rebindScope(exchange.scope!, targetOwnerIdentity),
      })),
    } satisfies PortableTarvisConversation),
  );
}

/** Empty-store recovery may include demo threads; they must remain demo-only. */
export function rebindRecoveredTarvisConversationToDatasetOwner(
  value: unknown,
  targetOwnerIdentity: string,
) {
  const document = JSON.parse(validateSerializedTarvisConversation(value)) as PortableTarvisConversation;
  const liveExchanges = document.exchanges.filter(exchange =>
    exchange.scope?.kind !== 'legacy-unknown' && exchange.scope?.dataMode === 'live');
  const rebound = JSON.parse(rebindSerializedTarvisConversationToDatasetOwner(
    JSON.stringify({ ...document, exchanges: liveExchanges }), targetOwnerIdentity,
  )) as PortableTarvisConversation;
  const byId = new Map(rebound.exchanges.map(exchange => [exchange.id, exchange]));
  return validateSerializedTarvisConversation(JSON.stringify({
    ...document,
    exchanges: document.exchanges.map(exchange => byId.get(exchange.id) ?? exchange),
  }));
}
