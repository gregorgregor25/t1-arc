import { describe, expect, it } from 'vitest';

import {
  beginSourceLoad,
  canCommitSourceLoad,
  mountSourceLoadGuard,
  SourceLoadGuard,
  unmountSourceLoadGuard,
} from '@/components/sourceLoadGuard';

describe('source load guard', () => {
  it('allows only the latest mounted request to commit', () => {
    const guard: SourceLoadGuard = { mounted: false, generation: 0 };
    mountSourceLoadGuard(guard);
    const first = beginSourceLoad(guard);
    const second = beginSourceLoad(guard);
    expect(canCommitSourceLoad(guard, first)).toBe(false);
    expect(canCommitSourceLoad(guard, second)).toBe(true);
  });

  it('invalidates an in-flight request when the component unmounts', () => {
    const guard: SourceLoadGuard = { mounted: false, generation: 0 };
    mountSourceLoadGuard(guard);
    const request = beginSourceLoad(guard);
    unmountSourceLoadGuard(guard);
    expect(canCommitSourceLoad(guard, request)).toBe(false);
  });
});
