import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Exercise the production event handler with deferred bridge promises. Audio
// functions are injected fakes; these tests cannot open an audio device.
const source = readFileSync(resolve('src/components/GlucoseAlertSettingsCard.tsx'), 'utf8');
const handler = source.match(/  async function play\(soundId: string\) \{([\s\S]*?)\n  }\n\n  async function chooseCustomSound/)?.[1];
if (!handler) throw new Error('The production preview event handler was not found.');

function fixture() {
  let finishStop: (() => void) | undefined;
  const generation = { current: 0 };
  const mounted = { current: true };
  const appState = { currentState: 'active' };
  const preview = vi.fn(async () => true);
  const stop = vi.fn(() => new Promise<boolean>(resolveStop => { finishStop = () => resolveStop(true); }));
  const setPreviewing = vi.fn();
  const play = runInNewContext(`(async function(soundId) {${handler}})`, {
    configuration: { volume: 0.35 }, busy: false, previewGeneration: generation,
    previewTimer: { current: undefined }, mounted, AppState: appState,
    stopGlucoseAlarmPreview: stop, previewGlucoseAlarmSound: preview,
    setPreviewing, setMessage: vi.fn(), stopPreview: vi.fn(),
    clearTimeout: vi.fn(), setTimeout: vi.fn(),
  }) as (soundId: string) => Promise<void>;
  return { play, generation, mounted, appState, preview, setPreviewing, finishStop: () => { if (!finishStop) throw new Error('No stop is pending.'); finishStop(); } };
}

describe('explicit glucose sound preview cancellation', () => {
  it('does not start audio after Stop invalidates a pending Play', async () => {
    const f = fixture();
    const pending = f.play('pulse');
    f.generation.current += 1;
    f.finishStop();
    await pending;
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.setPreviewing).not.toHaveBeenCalled();
  });

  it('does not start audio after leaving the screen while Stop is pending', async () => {
    const f = fixture();
    const pending = f.play('notes');
    f.mounted.current = false;
    f.finishStop();
    await pending;
    expect(f.preview).not.toHaveBeenCalled();
  });

  it('does not start audio after backgrounding before the AppState listener cancels', async () => {
    const f = fixture();
    const pending = f.play('pulse');
    f.appState.currentState = 'background';
    f.finishStop();
    await pending;
    expect(f.preview).not.toHaveBeenCalled();
  });
});
