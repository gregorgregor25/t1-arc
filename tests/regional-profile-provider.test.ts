import type { ReactNode } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REGIONAL_PROFILE,
  type T1ArcRegionalDefaults,
  type T1ArcRegionalProfile,
} from '@/domain/regionalProfile';

import { RegionalProfileProvider } from '@/providers/RegionalProfileProvider';
import { toDateKey } from '@/domain/time';

const providerMocks = vi.hoisted(() => ({
  appStateListener: undefined as ((state: string) => void) | undefined,
  deviceContext: { locale: 'en-GB', timeZone: 'Europe/London' },
  displayPreferences: vi.fn(async () => undefined),
  glookoPreferences: vi.fn(async () => undefined),
  observer: undefined as ((profile: T1ArcRegionalProfile) => void) | undefined,
}));

const hookRuntime = vi.hoisted(() => {
  interface EffectSlot {
    cleanup?: () => void;
    dependencies?: readonly unknown[];
  }
  interface MemoSlot {
    dependencies?: readonly unknown[];
    value: unknown;
  }

  const effects = new Map<number, EffectSlot>();
  const initializedState = new Set<number>();
  const memos = new Map<number, MemoSlot>();
  const state: unknown[] = [];
  let cursor = 0;
  let dirty = false;
  let pendingEffects: {
    callback: () => void | (() => void);
    dependencies?: readonly unknown[];
    index: number;
  }[] = [];

  function dependenciesMatch(
    left: readonly unknown[] | undefined,
    right: readonly unknown[] | undefined,
  ) {
    return (
      left !== undefined &&
      right !== undefined &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index]))
    );
  }

  return {
    beginRender() {
      cursor = 0;
      dirty = false;
      pendingEffects = [];
    },
    flushEffects() {
      for (const pending of pendingEffects) {
        const previous = effects.get(pending.index);
        previous?.cleanup?.();
        const cleanup = pending.callback();
        effects.set(pending.index, {
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
          dependencies: pending.dependencies,
        });
      }
      pendingEffects = [];
    },
    needsRender() {
      return dirty;
    },
    reset() {
      for (const effect of effects.values()) effect.cleanup?.();
      effects.clear();
      initializedState.clear();
      memos.clear();
      state.length = 0;
      cursor = 0;
      dirty = false;
      pendingEffects = [];
    },
    useEffect(
      callback: () => void | (() => void),
      dependencies?: readonly unknown[],
    ) {
      const index = cursor++;
      const previous = effects.get(index);
      if (!dependenciesMatch(previous?.dependencies, dependencies)) {
        pendingEffects.push({ callback, dependencies, index });
      }
    },
    useMemo<T>(factory: () => T, dependencies: readonly unknown[]) {
      const index = cursor++;
      const previous = memos.get(index);
      if (previous && dependenciesMatch(previous.dependencies, dependencies)) {
        return previous.value as T;
      }
      const value = factory();
      memos.set(index, { dependencies, value });
      return value;
    },
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!initializedState.has(index)) {
        state[index] =
          typeof initial === 'function' ? (initial as () => T)() : initial;
        initializedState.add(index);
      }
      const setState = (next: T | ((current: T) => T)) => {
        const current = state[index] as T;
        const resolved =
          typeof next === 'function'
            ? (next as (current: T) => T)(current)
            : next;
        if (!Object.is(current, resolved)) {
          state[index] = resolved;
          dirty = true;
        }
      };
      return [state[index] as T, setState] as const;
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: hookRuntime.useEffect,
    useMemo: hookRuntime.useMemo,
    useState: hookRuntime.useState,
  };
});

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(
      (_event: string, listener: (state: string) => void) => {
        providerMocks.appStateListener = listener;
        return {
          remove: () => {
            if (providerMocks.appStateListener === listener) {
              providerMocks.appStateListener = undefined;
            }
          },
        };
      },
    ),
  },
  StyleSheet: { create: <T>(styles: T) => styles },
  View: 'View',
}));

vi.mock('@/domain/regionalProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/regionalProfile')>();
  return {
    ...actual,
    deviceRegionalContext: vi.fn(() => ({ ...providerMocks.deviceContext })),
  };
});

vi.mock('@/data/regionalProfile', () => ({
  observeRegionalProfile: vi.fn(
    (observer: (profile: T1ArcRegionalProfile) => void) => {
      providerMocks.observer = observer;
      return () => {
        if (providerMocks.observer === observer) providerMocks.observer = undefined;
      };
    },
  ),
  saveRegionalProfile: vi.fn(async (profile: T1ArcRegionalProfile) => profile),
}));

vi.mock('../modules/t1arc-glucose-display', () => ({
  default: {
    setRegionalDisplayPreferencesAsync: providerMocks.displayPreferences,
  },
}));

vi.mock('../modules/t1arc-glooko-export', () => ({
  default: { setRegionalPreferencesAsync: providerMocks.glookoPreferences },
}));

interface ProviderElement {
  props: {
    children: ReactNode;
    value: { defaults: T1ArcRegionalDefaults; ready: boolean };
  };
}

const CHILD = { type: 'regional-consumer' } as unknown as ReactNode;

function renderOnce() {
  hookRuntime.beginRender();
  const element = RegionalProfileProvider({ children: CHILD }) as ProviderElement;
  hookRuntime.flushEffects();
  return element;
}

function renderAfterStateChange() {
  let element = renderOnce();
  let passes = 0;
  while (hookRuntime.needsRender() && passes++ < 5) element = renderOnce();
  return element;
}

beforeEach(() => {
  hookRuntime.reset();
  providerMocks.appStateListener = undefined;
  providerMocks.deviceContext = {
    locale: 'en-GB',
    timeZone: 'Europe/London',
  };
  providerMocks.displayPreferences.mockClear();
  providerMocks.glookoPreferences.mockClear();
  providerMocks.observer = undefined;
});

describe('RegionalProfileProvider device-context lifecycle', () => {
  it('waits for a stored Tokyo profile before mounting date-sensitive children', () => {
    const firstRender = renderOnce();
    const loading = firstRender.props.children as {
      props?: { accessibilityLabel?: string };
    };
    expect(firstRender.props.value.ready).toBe(false);
    expect(firstRender.props.children).not.toBe(CHILD);
    expect(loading.props?.accessibilityLabel).toBe('Loading regional preferences');

    providerMocks.observer?.({
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'japan',
      countryCode: 'JP',
      languageTag: 'ja-JP',
      analysisTimeZone: 'Asia/Tokyo',
      followDeviceTimeZone: false,
      glucoseUnit: 'mgDl',
      measurementSystem: 'metric',
      energyUnit: 'kcal',
      clinicalJurisdiction: 'JP',
    });
    const hydrated = renderAfterStateChange();
    const boundary = Date.parse('2026-08-27T16:30:00.000Z');

    expect(hydrated.props.value.ready).toBe(true);
    expect(hydrated.props.children).toBe(CHILD);
    expect(hydrated.props.value.defaults.timeZone).toBe('Asia/Tokyo');
    expect(toDateKey(boundary, hydrated.props.value.defaults.timeZone)).toBe(
      '2026-08-28',
    );
    expect(toDateKey(boundary, 'Europe/London')).toBe('2026-08-27');
    expect(providerMocks.displayPreferences).toHaveBeenLastCalledWith(
      'mgDl',
      'ja-JP',
      'Asia/Tokyo',
    );
    expect(providerMocks.glookoPreferences).toHaveBeenLastCalledWith(
      'Asia/Tokyo',
      'eu',
    );
  });

  it('refreshes automatic context and native preferences when travel returns active', () => {
    renderOnce();
    providerMocks.observer?.({ ...DEFAULT_REGIONAL_PROFILE });
    const london = renderAfterStateChange();
    expect(london.props.value.defaults).toMatchObject({
      locale: 'en-GB',
      timeZone: 'Europe/London',
      glucoseUnit: 'mmolL',
      glookoRegion: 'eu',
    });

    providerMocks.deviceContext = {
      locale: 'en-US',
      timeZone: 'America/New_York',
    };
    providerMocks.appStateListener?.('inactive');
    providerMocks.appStateListener?.('active');
    const newYork = renderAfterStateChange();

    expect(newYork.props.value.defaults).toMatchObject({
      locale: 'en-US',
      timeZone: 'America/New_York',
      glucoseUnit: 'mgDl',
      glookoRegion: 'us',
    });
    expect(providerMocks.displayPreferences).toHaveBeenLastCalledWith(
      'mgDl',
      'en-US',
      'America/New_York',
    );
    expect(providerMocks.glookoPreferences).toHaveBeenLastCalledWith(
      'America/New_York',
      'us',
    );
  });

  it('keeps an explicit analysis timezone stable across a device-context refresh', () => {
    const explicitTokyo: T1ArcRegionalProfile = {
      ...DEFAULT_REGIONAL_PROFILE,
      region: 'japan',
      countryCode: 'JP',
      languageTag: 'ja-JP',
      analysisTimeZone: 'Asia/Tokyo',
      followDeviceTimeZone: false,
      glucoseUnit: 'mgDl',
      measurementSystem: 'metric',
      energyUnit: 'kcal',
      clinicalJurisdiction: 'JP',
    };
    renderOnce();
    providerMocks.observer?.(explicitTokyo);
    const hydrated = renderAfterStateChange();
    expect(hydrated.props.value.defaults.timeZone).toBe('Asia/Tokyo');
    expect(providerMocks.displayPreferences).toHaveBeenCalledTimes(1);

    providerMocks.deviceContext = {
      locale: 'en-US',
      timeZone: 'America/New_York',
    };
    providerMocks.appStateListener?.('active');
    const refreshed = renderAfterStateChange();

    expect(refreshed.props.value.defaults).toEqual(hydrated.props.value.defaults);
    expect(providerMocks.displayPreferences).toHaveBeenCalledTimes(1);
    expect(providerMocks.glookoPreferences).toHaveBeenCalledTimes(1);
  });
});
