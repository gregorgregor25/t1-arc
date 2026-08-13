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

  it('keeps the exact overnight screenshot question out of the legacy/OpenAI route', () => {
    const question =
      'What were my average overnight readings for the last two nights?';
    const resolution = resolveTarvisIntent(question, {
      now: NOW,
      timezone: 'Europe/London',
    });

    expect(resolution.outcome).toEqual({ status: 'ready', code: 'ready' });
    expect(routeTarvisIntent(resolution)).toEqual({ kind: 'scoped-glucose' });
    expect(resolution.intent.temporalScope?.value).toEqual({
      kind: 'recent_local_days',
      count: 2,
      include: 'most_recent_completed_windows',
    });
    expect(resolution.intent.clockWindow?.value).toMatchObject({
      start: { hour: 0, minute: 0 },
      end: { hour: 7, minute: 0 },
      crossesMidnight: false,
    });
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

  it.each([
    'What was my average glucose today over the last seven days?',
    'What was my average glucose on 6 August 2026 over the last seven days?',
    'What were my average overnight readings for the last two nights over the last seven days?',
    'What was my time in range above 4 mmol/L over the last 14 days?',
    'How many low-glucose events at most 4 mmol/L over the last 14 days?',
    'How many high-glucose events at least 10 mmol/L over the last 14 days?',
  ])(
    'routes a conflicting scope or invalid threshold to capability: %s',
    (question) => {
      expect(route(question).kind).toBe('capability');
    },
  );

  it('fails closed for an ambiguous clock rather than asking a model to guess', () => {
    const result = route(
      'What was my average glucose over the last three days between 10 and 3?',
    );
    expect(result.kind).toBe('capability');
    if (result.kind !== 'capability')
      throw new Error('Expected capability answer');
    expect(result.answer.answer).toMatch(/a\.m\.\/p\.m\.|clarif/i);
    expect(result.answer.limitations[0]).toContain('No calculation');
  });

  it('fails closed when an unknown modifier prevents personal analytics parsing', () => {
    const result = route(
      'What were my moonlit-smoothed readings across the last two nights?',
    );
    expect(result.kind).toBe('capability');
    if (result.kind !== 'capability') throw new Error('Expected capability');
    expect(result.answer.limitations[0]).toContain('No calculation');
  });

  it.each([
    'Average readings overnight?',
    'Show glucose for the last two nights.',
    'Median glucose last week.',
    'Moonlit-smoothed readings across the last two nights?',
    'Show readings on Tuesdays.',
  ])(
    'fails closed for a likely data query without a personal pronoun: %s',
    (question) => {
      expect(route(question).kind).not.toMatch(/^model-/);
    },
  );

  it('fails closed on temporal qualifiers even when no metric was recognised', () => {
    expect(route('Review my readings on alternating weekdays.').kind).toBe(
      'capability',
    );
    expect(route('Are mornings better for glucose?').kind).toBe('capability');
  });

  it.each([
    'What was my average glucose around 6 over the last three days?',
    'What was my average glucose over the last week excluding calibration readings?',
    'What was my average glucose over the last week leaving out readings above 10 mmol/L?',
    'What was my average glucose over the last week using only Dexcom readings?',
    'What was my average glucose after waking over the last week?',
    'What was my average glucose while exercising over the last week?',
    'What was my average glucose when fasting over the last week?',
  ])(
    'routes an unrepresented qualifier to capability, never scoped or legacy: %s',
    (question) => {
      expect(route(question).kind).toBe('capability');
    },
  );

  it('routes a recognised deterministic glucose statistic locally', () => {
    const result = route('What was my median glucose over the last 30 days?');
    expect(result.kind).toBe('scoped-glucose');
  });

  it('routes exact non-clock glucose periods locally without substituting a report', () => {
    expect(
      route('What was my average glucose over the last 30 days?').kind,
    ).toBe('scoped-glucose');
    expect(route('What was my average glucose today?').kind).toBe(
      'scoped-glucose',
    );
    expect(
      route(
        'Compare my average glucose over the last 24 hours with the previous period.',
      ).kind,
    ).toBe('scoped-glucose');
  });

  it('caps the total on-phone scope at 90 days before any data load', () => {
    expect(
      route('What was my average glucose over the last 90 days?').kind,
    ).toBe('scoped-glucose');
    const oversized = route(
      'What was my average glucose over the last 91 days?',
    );
    expect(oversized.kind).toBe('capability');
    if (oversized.kind !== 'capability') throw new Error('Expected capability');
    expect(oversized.answer.answer).toContain('up to 90 days');
    expect(oversized.answer.limitations[0]).toContain(
      'No health records were loaded',
    );
  });

  it('counts both equal comparison periods against the 90-day limit', () => {
    expect(
      route(
        'Compare my average glucose over the last 45 days with the previous period.',
      ).kind,
    ).toBe('scoped-glucose');
    expect(
      route(
        'Compare my average glucose over the last 46 days with the previous period.',
      ).kind,
    ).toBe('capability');
  });

  it('preserves the existing evidence path for other health questions', () => {
    expect(route('How did food line up with my glucose?').kind).toBe(
      'model-evidence',
    );
    expect(route('What is Type 1 diabetes?').kind).toBe('model-education');
  });
});
