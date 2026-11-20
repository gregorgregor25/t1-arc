import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve('src/components/GlucoseAlertSettingsCard.tsx'), 'utf8');
const handler = source.match(/const refreshStatus = useCallback\(async \(\) => \{([\s\S]*?)\n  }, \[\]\);/)?.[1];
if (!handler) throw new Error('The readiness refresh handler was not found.');

function fixture() {
  let finish: ((value: { readinessIssues: string[] }) => void) | undefined;
  const statusRefreshPending = { current: false };
  const statusMutationPending = { current: false };
  const statusRefreshGeneration = { current: 0 };
  const mounted = { current: true };
  const AppState = { currentState: 'active' };
  const getGlucoseAlarmStatus = vi.fn(() => new Promise<{ readinessIssues: string[] }>(resolveRead => { finish = resolveRead; }));
  const setStatus = vi.fn();
  const setConfiguration = vi.fn();
  const refresh = runInNewContext(`(async function() {${handler}})`, {
    statusRefreshPending, statusMutationPending, statusRefreshGeneration, mounted, AppState,
    getGlucoseAlarmStatus, setStatus, setConfiguration,
  }) as () => Promise<void>;
  return { refresh, setStatus, setConfiguration, getGlucoseAlarmStatus, mounted, AppState, statusRefreshGeneration, statusMutationPending,
    finish() { if (!finish) throw new Error('No status read is pending.'); finish({ readinessIssues: [] }); },
  };
}

describe('foreground alarm readiness refresh', () => {
  it('refreshes readiness without reloading the editing form or overlapping reads', async () => {
    const f = fixture();
    const first = f.refresh();
    await f.refresh();
    expect(f.getGlucoseAlarmStatus).toHaveBeenCalledTimes(1);
    f.finish();
    await first;
    expect(f.setStatus).toHaveBeenCalledWith({ readinessIssues: [] });
    expect(f.setConfiguration).not.toHaveBeenCalled();
  });

  it('does not overwrite a newer save or import with an old readiness snapshot', async () => {
    const f = fixture();
    const first = f.refresh();
    f.statusRefreshGeneration.current += 1;
    f.statusMutationPending.current = true;
    f.finish();
    await first;
    expect(f.setStatus).not.toHaveBeenCalled();
    await f.refresh();
    expect(f.getGlucoseAlarmStatus).toHaveBeenCalledTimes(1);
  });

  it('ignores a read that finishes after backgrounding or leaving settings', async () => {
    for (const leave of ['background', 'unmount']) {
      const f = fixture();
      const first = f.refresh();
      if (leave === 'background') f.AppState.currentState = 'background';
      else f.mounted.current = false;
      f.finish();
      await first;
      expect(f.setStatus).not.toHaveBeenCalled();
      await f.refresh();
      expect(f.getGlucoseAlarmStatus).toHaveBeenCalledTimes(1);
    }
  });
});
