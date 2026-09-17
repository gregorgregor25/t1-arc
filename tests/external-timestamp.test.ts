import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { parseExternalAbsoluteTimestamp } from '@/domain/externalTimestamp';

function parseUnderDeviceZone(timeZone: string) {
  const script = `const parse = ${parseExternalAbsoluteTimestamp.toString()}; process.stdout.write(JSON.stringify({ absolute: parse('2026-08-01T12:00:00Z'), offsetless: parse('2026-08-01T12:00:00') ?? null }));`;
  return JSON.parse(
    execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, TZ: timeZone },
    }),
  ) as { absolute: number; offsetless: null };
}

describe('external absolute timestamps', () => {
  it('is invariant across device zones and rejects offsetless provider clocks', () => {
    const utc = parseUnderDeviceZone('UTC');
    const newYork = parseUnderDeviceZone('America/New_York');

    expect(utc).toEqual(newYork);
    expect(utc).toEqual({
      absolute: Date.parse('2026-08-01T12:00:00Z'),
      offsetless: null,
    });
  });

  it('accepts explicit ISO and RFC offsets only', () => {
    expect(parseExternalAbsoluteTimestamp('2026-08-01T12:00:00+02:00')).toBe(
      Date.parse('2026-08-01T10:00:00Z'),
    );
    expect(parseExternalAbsoluteTimestamp('2026-08-01 12:00:00+02:00')).toBe(
      Date.parse('2026-08-01T10:00:00Z'),
    );
    expect(
      parseExternalAbsoluteTimestamp('Sat, 01 Aug 2026 12:00:00 GMT'),
    ).toBe(Date.parse('2026-08-01T12:00:00Z'));
    expect(
      parseExternalAbsoluteTimestamp('Sat, 01 Aug 2026 12:00:00'),
    ).toBeUndefined();
    expect(
      parseExternalAbsoluteTimestamp('2026-02-30T12:00:00Z'),
    ).toBeUndefined();
    expect(
      parseExternalAbsoluteTimestamp('2026-08-01T25:00:00Z'),
    ).toBeUndefined();
    expect(
      parseExternalAbsoluteTimestamp('Mon, 30 Feb 2026 12:00:00 GMT'),
    ).toBeUndefined();
    expect(
      parseExternalAbsoluteTimestamp('Foo, 01 Aug 2026 12:00:00 GMT'),
    ).toBeUndefined();
    expect(
      parseExternalAbsoluteTimestamp('Mon, 01 Aug 2026 12:00:00 GMT'),
    ).toBeUndefined();
    expect(
      parseExternalAbsoluteTimestamp('Sat, 01 Aug 2026 25:00:00 GMT'),
    ).toBeUndefined();
  });
});
