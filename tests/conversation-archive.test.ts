import { describe, expect, it, vi } from 'vitest';
import { archivedConversationThreads } from '@/data/tarvis/conversationArchive';
import type { LoadedStoredTarvisExchange, TarvisConversationScope } from '@/data/tarvis/conversationStore';
vi.mock('expo-file-system', () => ({}));
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({}));

const scope = (owner: string, dataMode = 'live'): Extract<TarvisConversationScope, { kind: 'live' }> => ({ kind: 'live', identity: `live:${dataMode}:${owner}`, ownerIdentity: owner, dataMode });
const row = (id: string, owner: string, createdAt: number, dataMode = 'live') => ({
  id, threadId: 'same-thread-id', question: id, createdAt, scope: scope(owner, dataMode),
}) as LoadedStoredTarvisExchange;

describe('explicit read-only conversation archive', () => {
  it('keeps previous installations accessible without mixing current replies, demo data or different owners', () => {
    const records = [row('current', 'new-install', 4), row('old-one', 'old-install', 1), row('old-two', 'old-install', 2),
      row('another-account', 'other-account', 3), row('demo', 'demo', 5, 'demo')];
    const original = JSON.stringify(records);
    const result = archivedConversationThreads(records, scope('new-install'));
    expect(result.map(thread => thread.exchanges.map(exchange => exchange.id)))
      .toEqual([['another-account'], ['old-one', 'old-two']]);
    expect(new Set(result.map(thread => thread.id)).size).toBe(2);
    expect(JSON.stringify(records)).toBe(original);
  });

  it('does not expose unknown-mode legacy entries or combine matching thread ids with different account ids', () => {
    const a = row('a', 'previous', 1); const b = row('b', 'previous', 2);
    a.scope = { ...scope('previous'), accountId: 'first' };
    b.scope = { ...scope('previous'), accountId: 'second' };
    const legacy = { ...row('legacy', 'unknown', 3), scope: { kind: 'legacy-unknown', identity: 'legacy-unknown' } } as LoadedStoredTarvisExchange;
    expect(archivedConversationThreads([a, b, legacy], scope('current'))).toHaveLength(2);
    expect(archivedConversationThreads([a, b], legacy.scope)).toEqual([]);
  });
});
