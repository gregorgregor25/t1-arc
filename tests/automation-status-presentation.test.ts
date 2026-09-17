import { describe, expect, it } from 'vitest';

import {
  automationHeaderPresentation,
  glucoseAutomationScope,
} from '@/components/automationStatusPresentation';

const NOW = 2_000_000_000;

function presentation(
  overrides: Partial<Parameters<typeof automationHeaderPresentation>[0]> = {},
) {
  return automationHeaderPresentation({
    hasStatus: false,
    loading: true,
    refreshFailed: false,
    hasAttention: false,
    registeredCount: 0,
    now: NOW,
    ...overrides,
  });
}

describe('automation status header', () => {
  it('does not call the initial unresolved state unavailable', () => {
    expect(presentation()).toMatchObject({
      kind: 'checking',
      label: 'Checking',
    });
  });

  it('reports an initial check failure honestly', () => {
    expect(presentation({ loading: false, refreshFailed: true })).toMatchObject(
      {
        kind: 'refresh-failed',
        label: 'Couldn’t check',
      },
    );
  });

  it('does not leave a retained active status after refresh fails', () => {
    const result = presentation({
      hasStatus: true,
      schedulerAvailable: true,
      checkedAt: NOW - 5 * 60_000,
      loading: false,
      refreshFailed: true,
      registeredCount: 2,
    });
    expect(result.label).toBe('Couldn’t refresh');
    expect(result.summary).toBe(
      'Status could not be refreshed. Last checked 5 min ago.',
    );
  });
});

describe('live glucose automation scope', () => {
  it('names every configured provider under the single live-glucose row', () => {
    expect(
      glucoseAutomationScope(['Dexcom Share', 'Medtrum', 'Dexcom Share']),
    ).toEqual({
      label: 'Live glucose',
      connectedDetail:
        'Dexcom Share and Medtrum are connected and checked through this one update.',
    });
  });

  it('does not imply a provider is connected when none is configured', () => {
    expect(glucoseAutomationScope([])).toEqual({
      label: 'Live glucose',
      connectedDetail: undefined,
    });
  });
});
