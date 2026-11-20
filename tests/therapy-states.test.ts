import { describe, expect, it, vi } from 'vitest';

import { normalizeAapsLocalTreatments } from '@/data/aaps/localAapsTreatments';
import { MG_DL_PER_MMOL_L } from '@/domain/models';
import { normalizeNightscoutTreatments } from '@/data/nightscout/NightscoutTreatmentImporter';
import { MemoryHealthRecordStore } from '@/data/persistence/HealthRecordStore';
import {
  describeTherapyState,
  notableTherapyStates,
  therapyStateLabel,
  therapyStateSourceNote,
} from '@/domain/therapyStatePresentation';
import {
  resolveTherapyStateIntervals,
  therapyStateEventFromTreatment,
  therapyStateEventsFromRawRecords,
  therapyStatesForRange,
  type TherapyStateEvent,
  type TherapyStateRawRecord,
  type TherapyStateSourceRef,
} from '@/domain/therapyStates';

vi.mock('../modules/t1arc-glucose-display', () => ({ default: {} }));
vi.mock('@/data/aaps/localAapsSource', () => ({ getAapsLocalSourceStatus: vi.fn() }));
vi.mock('@/data/privacy/localDataWriteEpoch', () => ({
  acquireLocalDataWriteLease: vi.fn(async () => ({ epoch: 1 })),
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(16).padStart(64, '0');
  }),
}));

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.parse('2026-11-10T17:00:00Z');

const NS: TherapyStateSourceRef = {
  rawRecordId: 'ns',
  sourceId: 'nightscout',
  sourceFile: 'treatments.json',
};

function source(rawRecordId: string, sourceId = 'nightscout', sourceFile = 'treatments.json') {
  return { rawRecordId, sourceId, sourceFile };
}

function event(treatment: Record<string, unknown>, ref: TherapyStateSourceRef = NS) {
  return therapyStateEventFromTreatment(treatment, ref);
}

function raw(
  id: string,
  payload: Record<string, unknown>,
  sourceId = 'nightscout',
  sourceFile = 'treatments.json',
): TherapyStateRawRecord {
  return {
    id,
    sourceId,
    sourceFile,
    recordKind: sourceId === 'nightscout' ? 'nightscout-treatment' : 'aaps-local-treatment',
    payloadJson: JSON.stringify(payload),
  };
}

describe('therapy-state parsing per route', () => {
  it('reads an AAPS Nightscout temporary target in mg/dL with its reason', () => {
    expect(
      event({
        eventType: 'Temporary Target',
        created_at: '2026-11-10T17:00:00.000Z',
        date: T0,
        reason: 'Activity',
        targetBottom: 140,
        targetTop: 140,
        units: 'mg/dl',
        duration: 90,
        durationInMilliseconds: 90 * MINUTE,
      }),
    ).toMatchObject({
      kind: 'temporary-target',
      isEnd: false,
      start: T0,
      targetReason: 'activity',
      programmedDurationMs: 90 * MINUTE,
      targetLowMmolL: 140 / MG_DL_PER_MMOL_L,
      targetHighMmolL: 140 / MG_DL_PER_MMOL_L,
    });
  });

  it('reads an xDrip+ broadcast temporary target in mmol/L and its cancel shape', () => {
    expect(
      event({
        eventType: 'Temporary Target',
        date: T0,
        reason: 'Eating Soon',
        targetBottom: 4.5,
        targetTop: 4.5,
        units: 'mmol',
        duration: 45,
      }),
    ).toMatchObject({ targetReason: 'eating-soon', targetLowMmolL: 4.5, programmedDurationMs: 45 * MINUTE });
    // AAPS's xDrip+ cancel: a new record with no reason and no targets.
    expect(event({ eventType: 'Temporary Target', date: T0, duration: 0 })).toMatchObject({
      kind: 'temporary-target',
      isEnd: true,
    });
    expect(event({ eventType: 'Temporary Target Cancel', date: T0 })).toMatchObject({ isEnd: true });
  });

  it('keeps a temporary target that has a reason but no target values', () => {
    expect(event({ eventType: 'Temporary Target', date: T0, reason: 'Hypo', duration: 30 })).toMatchObject({
      isEnd: false,
      targetReason: 'hypo',
      targetLowMmolL: undefined,
    });
  });

  it('reads a profile switch percentage, time shift and exact original duration', () => {
    expect(
      event({
        eventType: 'Profile Switch',
        date: T0,
        profile: 'Default (80%,2h)',
        originalProfileName: 'Default',
        percentage: 80,
        timeshift: 2,
        duration: 90,
        originalDuration: 90 * MINUTE,
      }),
    ).toMatchObject({
      kind: 'profile-switch',
      profileName: 'Default',
      percentage: 80,
      timeshiftHours: 2,
      programmedDurationMs: 90 * MINUTE,
    });
    // Older uploads only carry the percentage in the customised name.
    expect(event({ eventType: 'Profile Switch', date: T0, profile: 'Default (120%)', duration: 0 })).toMatchObject({
      percentage: 120,
      programmedDurationMs: undefined,
    });
  });

  it('maps running modes and the older OpenAPS Offline reasons', () => {
    expect(
      event({ eventType: 'OpenAPS Offline', date: T0, mode: 'SUSPENDED_BY_USER', duration: 60, originalDuration: HOUR }),
    ).toMatchObject({ kind: 'loop-mode', loopMode: 'suspended-by-user', temporaryOverlay: true, programmedDurationMs: HOUR });
    expect(
      event({ eventType: 'OpenAPS Offline', date: T0, mode: 'DISABLED_LOOP', duration: 5_256_000, originalDuration: 0 }),
    ).toMatchObject({ loopMode: 'disabled-loop', temporaryOverlay: false, programmedDurationMs: undefined });
    expect(event({ eventType: 'OpenAPS Offline', date: T0, reason: 'DISCONNECT_PUMP', duration: 30 })).toMatchObject({
      loopMode: 'disconnected-pump',
      programmedDurationMs: 30 * MINUTE,
    });
    expect(event({ eventType: 'OpenAPS Offline', date: T0, mode: 'SOMETHING_NEW' })).toMatchObject({ loopMode: 'unknown' });
  });

  it('treats only suspend-type temporary basals as pump suspensions', () => {
    expect(
      event({ eventType: 'Temp Basal', date: T0, type: 'PUMP_SUSPEND', rate: 0, duration: 20 }),
    ).toMatchObject({ kind: 'pump-suspend', suspendBasis: 'temp-basal', programmedDurationMs: 20 * MINUTE });
    expect(event({ eventType: 'Temp Basal', date: T0, type: 'NORMAL', rate: 0, duration: 20 })).toBeUndefined();
    expect(event({ eventType: 'Pump Resume', date: T0 })).toMatchObject({ kind: 'pump-suspend', isEnd: true });
  });

  it('needs a duration for logged exercise and ignores withdrawn records', () => {
    expect(event({ eventType: 'Exercise', date: T0, duration: 40 })).toMatchObject({ kind: 'exercise' });
    expect(event({ eventType: 'Exercise', date: T0 })).toBeUndefined();
    expect(event({ eventType: 'Note', date: T0, notes: 'Exercise class', duration: 50 })).toMatchObject({ kind: 'exercise' });
    expect(event({ eventType: 'Note', date: T0, notes: 'Dinner', duration: 50 })).toBeUndefined();
    expect(event({ eventType: 'Temporary Target', date: T0, reason: 'Activity', duration: 60, isValid: false })).toBeUndefined();
  });

  it('falls back to created_at when no numeric time is present', () => {
    expect(
      event({ eventType: 'Profile Switch', created_at: '2026-11-10T17:00:00.000Z', percentage: 80, duration: 60 }),
    ).toMatchObject({ start: T0 });
    expect(event({ eventType: 'Profile Switch', percentage: 80, duration: 60 })).toBeUndefined();
  });
});

function ev(partial: Partial<TherapyStateEvent> & Pick<TherapyStateEvent, 'kind' | 'start'>): TherapyStateEvent {
  return { isEnd: false, source: source(`${partial.kind}-${partial.start}`), ...partial };
}

describe('therapy-state interval resolution', () => {
  it('ends at the programmed duration, a cancel, the next record or the end of data', () => {
    const intervals = resolveTherapyStateIntervals(
      [
        ev({ kind: 'temporary-target', start: T0, programmedDurationMs: HOUR, targetReason: 'activity' }),
        ev({ kind: 'temporary-target', start: T0 + 2 * HOUR, programmedDurationMs: 2 * HOUR, targetReason: 'hypo' }),
        ev({ kind: 'temporary-target', start: T0 + 2.5 * HOUR, isEnd: true }),
        ev({ kind: 'profile-switch', start: T0, percentage: 80 }),
        ev({ kind: 'profile-switch', start: T0 + 3 * HOUR, percentage: 100 }),
      ],
      T0 + 5 * HOUR,
    );
    expect(intervals.map(({ kind, start, end, endBasis, baseline }) => ({ kind, start, end, endBasis, baseline }))).toEqual([
      { kind: 'profile-switch', start: T0, end: T0 + 3 * HOUR, endBasis: 'next-record', baseline: false },
      { kind: 'temporary-target', start: T0, end: T0 + HOUR, endBasis: 'programmed', baseline: false },
      { kind: 'temporary-target', start: T0 + 2 * HOUR, end: T0 + 2.5 * HOUR, endBasis: 'cancelled', baseline: false },
      { kind: 'profile-switch', start: T0 + 3 * HOUR, end: T0 + 5 * HOUR, endBasis: 'open', baseline: true },
    ]);
  });

  it('marks a state with no duration and no later record as open, not ended', () => {
    const [state] = resolveTherapyStateIntervals(
      [ev({ kind: 'pump-suspend', start: T0, suspendBasis: 'pump-event' })],
      T0 + 40 * MINUTE,
    );
    expect(state).toMatchObject({ end: T0 + 40 * MINUTE, endBasis: 'open' });
    expect(describeTherapyState(state!)).toContain('no end was recorded');
  });

  it('does not let a temporary loop suspension end the ongoing running mode', () => {
    const intervals = resolveTherapyStateIntervals(
      [
        ev({ kind: 'loop-mode', start: T0, loopMode: 'closed-loop', temporaryOverlay: false }),
        ev({ kind: 'loop-mode', start: T0 + HOUR, loopMode: 'suspended-by-user', temporaryOverlay: true, programmedDurationMs: 30 * MINUTE }),
        ev({ kind: 'loop-mode', start: T0 + 4 * HOUR, loopMode: 'open-loop', temporaryOverlay: false }),
      ],
      T0 + 6 * HOUR,
    );
    expect(intervals.map(({ loopMode, start, end, baseline }) => ({ loopMode, start, end, baseline }))).toEqual([
      { loopMode: 'closed-loop', start: T0, end: T0 + 4 * HOUR, baseline: true },
      { loopMode: 'suspended-by-user', start: T0 + HOUR, end: T0 + 1.5 * HOUR, baseline: false },
      { loopMode: 'open-loop', start: T0 + 4 * HOUR, end: T0 + 6 * HOUR, baseline: false },
    ]);
    expect(notableTherapyStates(intervals).map(({ loopMode }) => loopMode)).toEqual(['suspended-by-user', 'open-loop']);
  });

  it('ends a suspension overlay early when another running-mode record follows', () => {
    const [suspended] = resolveTherapyStateIntervals(
      [
        ev({ kind: 'loop-mode', start: T0, loopMode: 'suspended-by-user', temporaryOverlay: true, programmedDurationMs: 2 * HOUR }),
        ev({ kind: 'loop-mode', start: T0 + 20 * MINUTE, loopMode: 'closed-loop', temporaryOverlay: false }),
      ],
      T0 + 3 * HOUR,
    );
    expect(suspended).toMatchObject({ end: T0 + 20 * MINUTE, endBasis: 'next-record' });
  });

  it('uses a shortened AAPS record as the cancelled end', () => {
    // AAPS cancels early by shortening the same record's duration.
    const [state] = therapyStatesForRange(
      [raw('tt-1', { eventType: 'Temporary Target', date: T0, reason: 'Activity', targetBottom: 140, targetTop: 140, units: 'mg/dl', duration: 25 })],
      { start: T0 - HOUR, end: T0 + 3 * HOUR },
      T0 + 3 * HOUR,
    );
    expect(state).toMatchObject({ end: T0 + 25 * MINUTE, endBasis: 'programmed' });
  });

  it('never runs past now or the requested range and keeps states that started before it', () => {
    const records = [
      raw('ps-1', { eventType: 'Profile Switch', date: T0 - 2 * HOUR, percentage: 80, originalProfileName: 'Default', duration: 0 }),
    ];
    const states = therapyStatesForRange(records, { start: T0, end: T0 + 10 * HOUR }, T0 + HOUR);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ start: T0 - 2 * HOUR, end: T0 + HOUR, endBasis: 'open', percentage: 80 });
    expect(therapyStatesForRange(records, { start: T0 - 5 * HOUR, end: T0 - 3 * HOUR }, T0 + HOUR)).toEqual([]);
  });
});

describe('therapy-state de-duplication', () => {
  const nightscoutCopy = raw('ns-tt', {
    eventType: 'Temporary Target',
    date: T0,
    reason: 'Activity',
    targetBottom: 140,
    targetTop: 140,
    units: 'mg/dl',
    duration: 60,
  });
  const phoneCopy = raw(
    'aaps-tt',
    { eventType: 'Temporary Target', date: T0 + 20_000, reason: 'Activity', targetBottom: 7.8, targetTop: 7.8, units: 'mmol', duration: 60 },
    'aaps-local',
    'Received on this phone; sender not verified',
  );

  it('keeps one state per AAPS record, prefers Nightscout and lists the phone copy', () => {
    const states = therapyStatesForRange([phoneCopy, nightscoutCopy], { start: T0 - HOUR, end: T0 + 3 * HOUR }, T0 + 3 * HOUR);
    expect(states).toHaveLength(1);
    expect(states[0]!.source.rawRecordId).toBe('ns-tt');
    expect(states[0]!.duplicateSources.map(({ rawRecordId }) => rawRecordId)).toEqual(['aaps-tt']);
    expect(therapyStateSourceNote(states[0]!)).toBe('Nightscout; also AAPS on this phone, sender not verified');
  });

  it('keeps two different records from the same source and different settings apart', () => {
    const states = therapyStatesForRange(
      [
        nightscoutCopy,
        raw('ns-tt-2', { eventType: 'Temporary Target', date: T0 + 30_000, reason: 'Hypo', targetBottom: 150, targetTop: 150, units: 'mg/dl', duration: 30 }),
        raw(
          'aaps-eating',
          { eventType: 'Temporary Target', date: T0 + 10_000, reason: 'Eating Soon', targetBottom: 4.5, targetTop: 4.5, units: 'mmol', duration: 30 },
          'aaps-local',
          'Received on this phone; sender confirmed',
        ),
      ],
      { start: T0 - HOUR, end: T0 + 3 * HOUR },
      T0 + 3 * HOUR,
    );
    expect(states.map(({ source: ref }) => ref.rawRecordId).sort()).toEqual(['aaps-eating', 'ns-tt', 'ns-tt-2']);
  });

  it('uses a phone copy alone when Nightscout has not uploaded it yet', () => {
    const [state] = therapyStatesForRange([phoneCopy], { start: T0 - HOUR, end: T0 + 3 * HOUR }, T0 + 3 * HOUR);
    expect(state!.source.sourceId).toBe('aaps-local');
    expect(therapyStateLabel(state!)).toBe('Activity temporary target (target 7.8 mmol/L)');
  });
});

describe('therapy states across a clock change', () => {
  it('keeps exact elapsed time over the autumn change and shows local wall-clock times', () => {
    // 25 Oct 2026, Europe/London: 01:59 BST is followed by 01:00 GMT.
    const start = Date.parse('2026-10-25T00:30:00Z'); // 01:30 BST
    const [state] = therapyStatesForRange(
      [raw('ps-dst', { eventType: 'Profile Switch', date: start, percentage: 80, originalProfileName: 'Default', originalDuration: 2 * HOUR })],
      { start: start - HOUR, end: start + 6 * HOUR },
      start + 6 * HOUR,
    );
    expect(state!.end - state!.start).toBe(2 * HOUR);
    // 01:30 BST plus two hours is 02:30 GMT.
    expect(describeTherapyState(state!)).toContain('recorded 01:30–02:30');
  });

  it('keeps exact elapsed time over the spring change', () => {
    // 29 Mar 2026: 01:00 GMT is followed by 02:00 BST.
    const start = Date.parse('2026-03-29T00:30:00Z'); // 00:30 GMT
    const [state] = therapyStatesForRange(
      [raw('tt-dst', { eventType: 'Temporary Target', date: start, reason: 'Hypo', targetBottom: 8, targetTop: 8, units: 'mmol', duration: 60 })],
      { start: start - HOUR, end: start + 6 * HOUR },
      start + 6 * HOUR,
    );
    expect(state!.end - state!.start).toBe(HOUR);
    expect(describeTherapyState(state!)).toContain('recorded 00:30–02:30');
  });
});

describe('therapy states from the two import routes', () => {
  it('builds the same state from a Nightscout upload and the phone broadcast', () => {
    const nightscout = normalizeNightscoutTreatments(
      [
        {
          _id: 'ps-ns',
          created_at: '2026-11-10T17:00:00.000Z',
          date: T0,
          eventType: 'Profile Switch',
          profile: 'Default (80%)',
          originalProfileName: 'Default',
          percentage: 80,
          timeshift: 0,
          duration: 90,
          originalDuration: 90 * MINUTE,
        },
      ],
      [],
      T0 + HOUR,
    );
    const local = normalizeAapsLocalTreatments(
      [
        {
          id: 1,
          receivedAt: T0 + 1_000,
          senderVerified: false,
          treatment: {
            identifier: `profile-switch-${T0}`,
            eventType: 'Profile Switch',
            date: T0,
            profile: 'Default (80%)',
            originalProfileName: 'Default',
            percentage: 80,
            timeshift: 0,
            duration: 90,
          },
        } as never,
      ],
      T0 + HOUR,
    );
    const states = therapyStatesForRange(
      [...nightscout.rawRecords, ...local.rawRecords],
      { start: T0 - HOUR, end: T0 + 4 * HOUR },
      T0 + 4 * HOUR,
    );
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ kind: 'profile-switch', percentage: 80, end: T0 + 90 * MINUTE, endBasis: 'programmed' });
    expect(states[0]!.duplicateSources).toHaveLength(1);
    expect(therapyStateEventsFromRawRecords(local.rawRecords)[0]!.source.sourceId).toBe('aaps-local');
  });
});

async function save(
  store: MemoryHealthRecordStore,
  normalized: ReturnType<typeof normalizeNightscoutTreatments>,
  name: string,
  importedAt: number,
) {
  await store.writeImport(
    {
      id: `nightscout:${name}`,
      sourceId: 'nightscout',
      fileName: name,
      fileSha256: name.padEnd(64, '0'),
      importedAt,
      skippedCount: 0,
      warnings: [],
    },
    normalized.basal,
    normalized.boluses,
    normalized.context,
    undefined,
    [],
    normalized.rawRecords,
    { revisedRecordIds: normalized.revisedRecordIds },
  );
}

describe('stored therapy-state records', () => {
  it('finds candidate records by time and refreshes a re-sent shortened record', async () => {
    const store = new MemoryHealthRecordStore();
    const first = normalizeNightscoutTreatments(
      [{ _id: 'tt', created_at: '2026-11-10T17:00:00.000Z', date: T0, eventType: 'Temporary Target', reason: 'Activity', targetBottom: 140, targetTop: 140, units: 'mg/dl', duration: 90 }],
      [],
      T0 + MINUTE,
    );
    await save(store, first, 'first', T0 + MINUTE);
    const shortened = normalizeNightscoutTreatments(
      [{ _id: 'tt', created_at: '2026-11-10T17:00:00.000Z', date: T0, eventType: 'Temporary Target', reason: 'Activity', targetBottom: 140, targetTop: 140, units: 'mg/dl', duration: 20 }],
      [],
      T0 + 30 * MINUTE,
    );
    await save(store, shortened, 'second', T0 + 30 * MINUTE);
    const records = await store.getTherapyStateRecords!({ start: T0 - HOUR, end: T0 + HOUR });
    expect(records).toHaveLength(1);
    const [state] = therapyStatesForRange(records, { start: T0 - HOUR, end: T0 + 3 * HOUR }, T0 + 3 * HOUR);
    expect(state).toMatchObject({ end: T0 + 20 * MINUTE, endBasis: 'programmed' });
  });
});
