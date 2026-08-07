import { describe, expect, it } from 'vitest';

import { resolveTarvisIntent } from '@/data/tarvis/intent';
import { routeTarvisIntent } from '@/data/tarvis/onDeviceRouting';

const NOW = Date.parse('2026-08-07T20:14:00+01:00');

function route(question: string) {
  return routeTarvisIntent(
    resolveTarvisIntent(question, {
      now: NOW,
      timezone: 'Europe/London',
    }),
  );
}

describe('Tarv1s on-device routing', () => {
  it('routes an exact recurring glucose question to the scoped engine', () => {
    expect(
      route(
        'What are my average readings over the last three days between midnight and 7 a.m.?',
      ).kind,
    ).toBe('scoped-glucose');
  });

  it('fails closed for clock-window shapes the recurring executor cannot represent', () => {
    expect(
      route(
        'What was my average glucose on 5 August between midnight and 7 a.m.?',
      ).kind,
    ).toBe('capability');
    expect(
      route(
        'Compare my average glucose over the last three days between midnight and 7 a.m. with the previous period.',
      ).kind,
    ).toBe('capability');
  });

  it('fails closed for an ambiguous clock rather than asking a model to guess', () => {
    const result = route(
      'What was my average glucose over the last three days between 10 and 3?',
    );
    expect(result.kind).toBe('capability');
    if (result.kind !== 'capability') throw new Error('Expected capability answer');
    expect(result.answer.answer).toMatch(/a\.m\.\/p\.m\.|clarif/i);
    expect(result.answer.limitations[0]).toContain('No calculation');
  });

  it('fails closed for a recognised but unsupported glucose metric', () => {
    const result = route('What was my median glucose over the last 30 days?');
    expect(result.kind).toBe('capability');
    if (result.kind !== 'capability') throw new Error('Expected capability answer');
    expect(result.answer.answer).toContain("won’t substitute");
  });

  it('routes exact non-clock glucose periods locally without substituting a report', () => {
    expect(route('What was my average glucose over the last 30 days?').kind).toBe(
      'scoped-glucose',
    );
    expect(route('What was my average glucose today?').kind).toBe(
      'scoped-glucose',
    );
    expect(
      route(
        'Compare my average glucose over the last 24 hours with the previous period.',
      ).kind,
    ).toBe('scoped-glucose');
  });

  it('preserves the existing evidence path for other health questions', () => {
    expect(route('How did food line up with my glucose?').kind).toBe('legacy');
  });
});
