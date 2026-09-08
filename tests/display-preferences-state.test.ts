import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  GLANCE_METRIC_IDS,
  moveDisplayPriority,
  parseDisplayPreferences,
  prioritiseGlanceMetrics,
} from '@/domain/displayPreferences';
import { createDisplayPreferencesState } from '@/hooks/displayPreferencesState';

function memory() {
  let value: string | undefined;
  const read = vi.fn(async () => value);
  const update = vi.fn(async (fn: (stored: string | undefined) => ReturnType<typeof parseDisplayPreferences>) => {
    const next = fn(value);
    value = JSON.stringify(next);
    return next;
  });
  return { state: createDisplayPreferencesState({ read, update }), read, update, setRaw: (next: string | undefined) => { value = next; } };
}

describe('personal display choices', () => {
  it('keeps existing defaults and only surfaces three available priorities', () => {
    const metrics = GLANCE_METRIC_IDS.map(id => ({ id }));
    expect(prioritiseGlanceMetrics(metrics, DEFAULT_DISPLAY_PREFERENCES.glanceOrder).map(({ id }) => id))
      .toEqual(['time-in-range', 'insulin', 'nutrition']);
    const order = ['sleep', 'activity', 'weight', ...GLANCE_METRIC_IDS];
    expect(prioritiseGlanceMetrics(metrics, order).map(({ id }) => id)).toEqual(['sleep', 'activity', 'weight']);
    expect(prioritiseGlanceMetrics(metrics.filter(({ id }) => id !== 'sleep'), order).map(({ id }) => id))
      .toEqual(['activity', 'weight', 'time-in-range']);
    expect(order[0]).toBe('sleep');
  });

  it('moves priorities without mutating a saved list or crossing an edge', () => {
    const ids = ['sleep', 'activity', 'weight'];
    expect(moveDisplayPriority(ids, 'activity', -1)).toEqual(['activity', 'sleep', 'weight']);
    expect(moveDisplayPriority(ids, 'sleep', -1)).toEqual(ids);
    expect(moveDisplayPriority(ids, 'weight', 1)).toEqual(ids);
    expect(moveDisplayPriority(ids, 'missing', 1)).toEqual(ids);
    expect(ids).toEqual(['sleep', 'activity', 'weight']);
  });

  it('rejects corrupt or unknown glance choices without modifying stored records', () => {
    expect(() => parseDisplayPreferences({ ...DEFAULT_DISPLAY_PREFERENCES, glanceOrder: ['invented'] })).toThrow();
    expect(() => parseDisplayPreferences({ ...DEFAULT_DISPLAY_PREFERENCES, glanceOrder: ['sleep', 'sleep'] })).toThrow();
    expect(() => parseDisplayPreferences({ ...DEFAULT_DISPLAY_PREFERENCES, hiddenHealthMetrics: ['../private'] })).toThrow();
  });

  it('publishes saved patches to mounted subscribers and preserves unrelated choices', async () => {
    const { state, read, update } = memory();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = state.subscribe(first);
    state.subscribe(second);
    await state.refresh();
    expect(state.getSnapshot().loading).toBe(false);
    await state.save({ glanceOrder: ['sleep', 'steps', 'time-in-range'] });
    await state.save({ hiddenHealthMetrics: ['weight', 'energy'] });
    expect(state.getSnapshot().preferences).toMatchObject({
      glanceOrder: ['sleep', 'steps', 'time-in-range'], hiddenHealthMetrics: ['weight', 'energy'],
    });
    expect(first).toHaveBeenCalledTimes(5);
    expect(second).toHaveBeenCalledTimes(5);
    unsubscribe();
    await state.refresh();
    expect(first).toHaveBeenCalledTimes(5);
    expect(second).toHaveBeenCalledTimes(6);
    expect(read).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does not save before loading has finished', async () => {
    const { state, update } = memory();
    expect(await state.save({ glanceOrder: ['sleep'] })).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not present a failed save as saved or discard earlier preferences', async () => {
    const { state, update } = memory();
    await state.refresh();
    const before = state.getSnapshot().preferences;
    update.mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await state.save({ hiddenHealthMetrics: ['weight'] })).toBe(false);
    expect(state.getSnapshot().preferences).toEqual(before);
    expect(state.getSnapshot().saving).toBe(false);
    expect(state.getSnapshot().error).toContain('weren’t saved');
    expect(await state.save({ hiddenHealthMetrics: ['weight'] })).toBe(true);
    expect(state.getSnapshot().error).toBeUndefined();
  });

  it('does not overwrite corrupt stored preferences with defaults', async () => {
    const { state, setRaw } = memory();
    setRaw('{invalid');
    await state.refresh();
    expect(state.getSnapshot().error).toContain('couldn’t be loaded');
    expect(await state.save({ hiddenHealthMetrics: ['weight'] })).toBe(false);
  });

  it('ignores a slow old read after a successful save', async () => {
    const { state, read } = memory();
    await state.refresh();
    let resolveRead!: (value: string | undefined) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }));
    const refreshing = state.refresh();
    await state.save({ glanceOrder: ['weight'] });
    resolveRead(undefined);
    await refreshing;
    expect(state.getSnapshot().preferences.glanceOrder).toEqual(['weight']);
  });

  it('does not let a subscriber make a completed save fail', async () => {
    const { state } = memory();
    await state.refresh();
    state.subscribe(() => { throw new Error('view failed'); });
    expect(await state.save({ glanceOrder: ['sleep'] })).toBe(true);
    expect(state.getSnapshot().preferences.glanceOrder).toEqual(['sleep']);
  });

  it('reloads restored choices and resets to defaults after the stored row is erased', async () => {
    const { state, setRaw } = memory();
    await state.refresh();
    setRaw(JSON.stringify({ ...DEFAULT_DISPLAY_PREFERENCES, hiddenHealthMetrics: ['weight'] }));
    await state.refresh();
    expect(state.getSnapshot().preferences.hiddenHealthMetrics).toEqual(['weight']);
    setRaw(undefined);
    await state.refresh();
    expect(state.getSnapshot().preferences).toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });
});
