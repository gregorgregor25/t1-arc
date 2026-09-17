import { sameTarvisConversationScope, type LoadedStoredTarvisExchange, type TarvisConversationScope } from './conversationStore';

/** Explicit read-only history, never input to the current conversation. */
export function archivedConversationThreads(exchanges: readonly LoadedStoredTarvisExchange[], current: TarvisConversationScope) {
  if (current.kind === 'legacy-unknown') return [];
  const groups = new Map<string, LoadedStoredTarvisExchange[]>();
  for (const exchange of exchanges) {
    const scope = exchange.scope;
    if (scope.kind === 'legacy-unknown' || scope.dataMode !== current.dataMode || sameTarvisConversationScope(scope, current)) continue;
    const key = JSON.stringify([scope.identity, scope.accountId, exchange.threadId]);
    const group = groups.get(key) ?? [];
    group.push(exchange); groups.set(key, group);
  }
  return [...groups].map(([id, entries]) => {
    const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt);
    return { id, title: ordered[0]!.question, updatedAt: ordered.at(-1)!.createdAt, exchanges: ordered };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
