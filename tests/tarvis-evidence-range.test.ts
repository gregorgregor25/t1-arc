import { describe, expect, it } from 'vitest';

import {
  rangesForTarvisEvidenceResolution,
  resolveTarvisEvidenceRangeRequest,
} from '@/data/tarvis/evidenceRange';
import { resolveTarvisIntent } from '@/data/tarvis/intent';
import { dayRange } from '@/domain/time';

const NOW = Date.parse('2026-08-13T20:00:00+01:00');

describe('Tarv1s bounded model evidence ranges', () => {
  it('loads exactly yesterday plus the preceding local day for a broad assessment', () => {
    const resolution = resolveTarvisIntent('how was my bg yday?', {
      now: NOW,
      timezone: 'Europe/London',
    });

    expect(rangesForTarvisEvidenceResolution(resolution, NOW)).toEqual({
      current: dayRange('2026-08-12', NOW),
      previous: dayRange('2026-08-11', NOW),
    });
  });

  it('recovers an explicit date even when an event-relative filter is not executable', () => {
    const resolution = resolveTarvisIntent(
      'why was i high after breakfast yesterday?',
      { now: NOW, timezone: 'Europe/London' },
    );

    expect(rangesForTarvisEvidenceResolution(resolution, NOW)).toEqual({
      current: dayRange('2026-08-12', NOW),
      previous: dayRange('2026-08-11', NOW),
    });
  });

  it('does not guess ambiguous clock windows or arbitrary comparisons', () => {
    const clock = resolveTarvisIntent(
      'what happened between 6 and 7 last week',
      {
        now: NOW,
        timezone: 'Europe/London',
      },
    );
    const comparison = resolveTarvisIntent(
      'what changed compared with last month?',
      {
        now: NOW,
        timezone: 'Europe/London',
      },
    );

    expect(rangesForTarvisEvidenceResolution(clock, NOW)).toBeNull();
    expect(rangesForTarvisEvidenceResolution(comparison, NOW)).toBeNull();
  });

  it('distinguishes no requested range from an unsupported explicit range', () => {
    const education = resolveTarvisIntent('what does time in range mean?', {
      now: NOW,
      timezone: 'Europe/London',
    });
    const unsupported = resolveTarvisIntent(
      'why were my sugars higher in the last 5 days compared with 2 weeks ago?',
      { now: NOW, timezone: 'Europe/London' },
    );

    expect(resolveTarvisEvidenceRangeRequest(education, NOW)).toEqual({
      kind: 'none',
    });
    expect(resolveTarvisEvidenceRangeRequest(unsupported, NOW).kind).toBe(
      'unsupported',
    );
  });
});
