import { describe, expect, it, vi } from 'vitest';

import { GlookoSingleFlight } from '@/data/glooko/glookoSingleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Glooko JavaScript single-flight reservation', () => {
  it('reserves before asynchronous planning starts', async () => {
    const flight = new GlookoSingleFlight<string>();
    const planning = deferred<void>();
    const firstFactory = vi.fn(async () => {
      await planning.promise;
      return 'first';
    });
    const competingFactory = vi.fn(async () => 'competing');

    const first = flight.run(firstFactory);
    const competing = flight.run(competingFactory);

    expect(competing).toBe(first);
    expect(firstFactory).not.toHaveBeenCalled();
    expect(competingFactory).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(firstFactory).toHaveBeenCalledOnce();
    planning.resolve();

    await expect(Promise.all([first, competing])).resolves.toEqual([
      'first',
      'first',
    ]);
    expect(competingFactory).not.toHaveBeenCalled();
  });

  it('queues one interactive run behind silent work and keeps its reservation', async () => {
    const flight = new GlookoSingleFlight<string>();
    const silentGate = deferred<void>();
    const silentFactory = vi.fn(async () => {
      await silentGate.promise;
      return 'silent';
    });
    const interactiveFactory = vi.fn(async () => 'interactive');
    const duplicateInteractiveFactory = vi.fn(async () => 'duplicate');
    const lateSilentFactory = vi.fn(async () => 'late-silent');

    const silent = flight.run(silentFactory);
    const interactive = flight.runInteractive(interactiveFactory);
    const duplicateInteractive = flight.runInteractive(
      duplicateInteractiveFactory,
    );
    const lateSilent = flight.run(lateSilentFactory);

    expect(duplicateInteractive).toBe(interactive);
    expect(lateSilent).toBe(interactive);
    await Promise.resolve();
    expect(silentFactory).toHaveBeenCalledOnce();
    expect(interactiveFactory).not.toHaveBeenCalled();

    silentGate.resolve();
    await expect(silent).resolves.toBe('silent');
    await expect(interactive).resolves.toBe('interactive');
    await expect(duplicateInteractive).resolves.toBe('interactive');
    await expect(lateSilent).resolves.toBe('interactive');
    expect(interactiveFactory).toHaveBeenCalledOnce();
    expect(duplicateInteractiveFactory).not.toHaveBeenCalled();
    expect(lateSilentFactory).not.toHaveBeenCalled();
  });

  it('releases only the currently tracked reservation', async () => {
    const flight = new GlookoSingleFlight<string>();
    const silentGate = deferred<void>();
    const interactiveGate = deferred<void>();

    const silent = flight.run(async () => {
      await silentGate.promise;
      return 'silent';
    });
    const interactive = flight.runInteractive(async () => {
      await interactiveGate.promise;
      return 'interactive';
    });

    silentGate.resolve();
    await silent;

    const joinedWhileInteractive = flight.run(async () => 'wrong');
    expect(joinedWhileInteractive).toBe(interactive);
    interactiveGate.resolve();
    await interactive;

    const afterCompletion = flight.run(async () => 'new');
    expect(afterCompletion).not.toBe(interactive);
    await expect(afterCompletion).resolves.toBe('new');
  });

  it('invalidates old work and queues a distinct fresh generation', async () => {
    const flight = new GlookoSingleFlight<string>();
    const oldGate = deferred<void>();
    let oldIsCurrent = true;
    let freshGeneration = 0;

    const old = flight.run(async (lease) => {
      await oldGate.promise;
      oldIsCurrent = lease.isCurrent();
      return 'old';
    });
    await Promise.resolve();

    const fresh = flight.runFresh(async (lease) => {
      freshGeneration = lease.generation;
      return 'fresh';
    });
    const joinedFresh = flight.run(async () => 'wrong');

    expect(fresh).not.toBe(old);
    expect(joinedFresh).toBe(fresh);
    oldGate.resolve();

    await expect(old).resolves.toBe('old');
    await expect(fresh).resolves.toBe('fresh');
    expect(oldIsCurrent).toBe(false);
    expect(freshGeneration).toBe(1);
  });
});
