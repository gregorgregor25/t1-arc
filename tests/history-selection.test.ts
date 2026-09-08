import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHistoryRangeSelection, historySelectionForRequest, historySelectionLabel, isHistoryRangeSelection } from '@/domain/historySelection';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';
import { multiDayRange, toDateKey } from '@/domain/time';

const now = Date.parse('2026-09-08T09:30:00Z');
const owner = 'live-owner';
beforeEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, analysisTimeZone: 'Europe/London', followDeviceTimeZone: false }));
afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

describe('Today to History exact range navigation', () => {
  it.each([6, 12, 24])('keeps the trailing %i-hour window rather than replacing it with a calendar day', (hours) => {
    const range = { start: now - hours * 3_600_000, end: now };
    const selection = createHistoryRangeSelection(range, owner);
    expect(historySelectionForRequest('glucose', selection, now + 60_000, owner)).toEqual({ ...range, ownerIdentity: owner });
    expect(selection.start).not.toBe(multiDayRange(toDateKey(now), 1, now).start);
  });

  it('does not apply a glucose selection to an insulin or ordinary calendar request', () => {
    const selection = createHistoryRangeSelection({ start: now - 6 * 3_600_000, end: now }, owner);
    expect(historySelectionForRequest('insulin', selection, now, owner)).toBeUndefined();
    expect(historySelectionForRequest(undefined, selection, now, owner)).toBeUndefined();
    expect(historySelectionForRequest('glucose', undefined, now, owner)).toBeUndefined();
  });

  it('keeps a selected window fixed after midnight and fails closed across owners', () => {
    const selection = createHistoryRangeSelection({ start: now - 24 * 3_600_000, end: now }, owner);
    expect(historySelectionForRequest('glucose', selection, now + 24 * 3_600_000, owner)).toEqual(selection);
    expect(historySelectionForRequest('glucose', selection, now, 'other-owner')).toBeUndefined();
    expect(selection.end).toBe(now);
  });

  it('rejects malformed, future and unbounded navigation ranges', () => {
    const selection = createHistoryRangeSelection({ start: now - 6 * 3_600_000, end: now }, owner);
    for (const invalid of [null, 'range', { ...selection, start: NaN }, { ...selection, start: 0 },
      { ...selection, end: now + 1 }, { ...selection, start: now },
      { ...selection, start: now - 32 * 86_400_000 }, { ...selection, ownerIdentity: '' }]) {
      expect(isHistoryRangeSelection(invalid, now, owner)).toBe(false);
    }
  });

  it('labels both dates and timezone offsets across a repeated DST hour', () => {
    const selection = createHistoryRangeSelection({ start: Date.parse('2026-10-25T00:30:00Z'), end: Date.parse('2026-10-25T01:30:00Z') }, owner);
    const label = historySelectionLabel(selection, 'en-GB', 'Europe/London');
    expect(label).toMatch(/25 Oct 2026/);
    expect(label).toMatch(/BST|GMT\+1/);
    expect(label).toMatch(/GMT/);
    expect(selection.end - selection.start).toBe(3_600_000);
  });

  it('wires manual date/range controls to leave the explicit selection and avoids a misleading day caption', () => {
    const source = readFileSync(new URL('../src/screens/HistoryScreen.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/function chooseDate\(date: DateKey\)\s*\{\s*setExplicitSelection\(undefined\)/);
    expect(source).toMatch(/onChange=\{\(choice\) => \{[\s\S]*?setExplicitSelection\(undefined\);\s*setRangeChoice\(choice\)/);
    expect(source).toContain("summaryLabel={activeSelection ? 'Selected period' : undefined}");
    expect(source).toContain('!activeSelection ? <Text');
    const today = readFileSync(new URL('../src/screens/TodayScreen.tsx', import.meta.url), 'utf8');
    expect(today).toContain('selectedRange: createHistoryRangeSelection(range, ownerIdentity)');
  });
});
