import { describe, expect, it } from 'vitest';
import { WATCH_BRANDS, WATCH_SETUP_TITLES, automaticWatchChoice, setupError, watchPort } from '@/components/watchSetup/watchSetupGuide';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { injectWatchInstaller } = require('../plugins/with-t1arc-watch-installer.js');

describe('guided watch setup', () => {
  const first = { id: 'first', name: 'Watch one', host: '192.168.1.2', legacy: false, pairingPort: 1234, connectionPort: 5678 };
  const second = { ...first, id: 'second', name: 'Watch two', host: '192.168.1.3' };
  it('requires an explicit choice when discovery finds multiple watches', () => {
    expect(automaticWatchChoice([first, second], '', false)).toBeUndefined();
    expect(automaticWatchChoice([first, second], second.host, false)).toBe(second);
  });
  it('selects a lone watch while preserving manual entries and a missing previous target', () => {
    expect(automaticWatchChoice([first], '', false)).toBe(first);
    expect(automaticWatchChoice([first], first.host, true)).toBeUndefined();
    expect(automaticWatchChoice([first], second.host, false)).toBeUndefined();
    expect(automaticWatchChoice([], '', false)).toBeUndefined();
  });
  it('refreshes a selected watch after discovery fell back to manual ports', () => {
    expect(automaticWatchChoice([first, second], first.host, true, first.id)).toBe(first);
    expect(automaticWatchChoice([second], first.host, true, first.id)).toBeUndefined();
    expect(automaticWatchChoice([second], second.host, true, first.id)).toBeUndefined();
    expect(automaticWatchChoice([first], first.host, true)).toBeUndefined();
  });
  it.each(['', '0', '-1', '65536', '123:456', '12.5', 'abc'])('rejects invalid ports: %s', value => {
    expect(watchPort(value)).toBeUndefined();
  });
  it.each(['1', '44609', '65535'])('accepts an explicit valid port: %s', value => {
    expect(watchPort(value)).toBe(Number(value));
  });
  it('provides native-library errors and a useful fallback', () => {
    expect(setupError(new Error('Pair again'))).toBe('Pair again');
    expect(setupError(new Error("Call to function 'T1ArcWatchInstaller.connectAsync' has been rejected.\n→ Caused by: Pair again"))).toBe('Pair again');
    expect(setupError(null)).toContain('try again');
  });
  it('keeps separate manufacturer instructions and the six setup stages', () => {
    expect(WATCH_SETUP_TITLES).toHaveLength(6);
    expect(WATCH_BRANDS.find(item => item.id === 'samsung')?.developerSteps).toContain('five');
    expect(WATCH_BRANDS.find(item => item.id === 'pixel')?.developerSteps).toContain('seven');
  });
  it('survives repeated Expo prebuild without duplicate asset registration', () => {
    const once = injectWatchInstaller('apply plugin: "com.android.application"\n');
    expect(injectWatchInstaller(once)).toBe(once);
    expect(once).toContain('t1arc-watch-installer.gradle');
  });
});
