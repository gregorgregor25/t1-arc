import { describe, expect, it, vi } from "vitest";

import {
  createTarvisScreenLifecycleCoordinator,
  isTarvisScreenLifecycleSupersededError,
} from "@/data/tarvis/screenLifecycle";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Tarv1s screen lifecycle", () => {
  it("prevents delayed work from an old scope saving or publishing after a new scope wins", async () => {
    const lifecycle = createTarvisScreenLifecycleCoordinator();
    const scopeA = lifecycle.enterScope("scope-a");
    const operationA = scopeA.beginOperation();
    expect(operationA.isCurrent()).toBe(true);
    const delayedA = deferred();
    const saveA = vi.fn();
    const publishA = vi.fn();
    const workA = (async () => {
      await delayedA.promise;
      operationA.assertCurrent();
      saveA();
      operationA.assertCurrent();
      publishA();
    })();

    scopeA.close();
    const scopeB = lifecycle.enterScope("scope-b");
    const operationB = scopeB.beginOperation();
    expect(operationA.isCurrent()).toBe(false);
    expect(operationB.isCurrent()).toBe(true);
    const saveB = vi.fn();
    const publishB = vi.fn();
    operationB.assertCurrent();
    saveB();
    publishB();

    delayedA.resolve();
    await expect(workA).rejects.toSatisfy(
      isTarvisScreenLifecycleSupersededError,
    );
    expect(operationA.signal.aborted).toBe(true);
    expect(saveA).not.toHaveBeenCalled();
    expect(publishA).not.toHaveBeenCalled();
    expect(saveB).toHaveBeenCalledOnce();
    expect(publishB).toHaveBeenCalledOnce();

    operationA.release();
    operationB.release();
    scopeB.close();
  });

  it("invalidates a mounted scope on unmount even without a replacement", () => {
    const lifecycle = createTarvisScreenLifecycleCoordinator();
    const scope = lifecycle.enterScope("scope-a");
    const operation = scope.beginOperation();

    scope.close();

    expect(operation.signal.aborted).toBe(true);
    expect(operation.isCurrent()).toBe(false);
    expect(() => operation.assertCurrent()).toThrowError(
      expect.objectContaining({
        name: "TarvisScreenLifecycleSupersededError",
      }),
    );
  });

  it("rejects a destructive callback captured by an old scope after rerender", () => {
    const lifecycle = createTarvisScreenLifecycleCoordinator();
    const capturedScopeA = lifecycle.enterScope("scope-a");
    const replace = vi.fn();

    capturedScopeA.close();
    const scopeB = lifecycle.enterScope("scope-b");
    try {
      const operation = capturedScopeA.beginOperation();
      replace();
      operation.release();
    } catch (reason) {
      expect(isTarvisScreenLifecycleSupersededError(reason)).toBe(true);
    }

    expect(replace).not.toHaveBeenCalled();
    expect(() => scopeB.assertCurrent()).not.toThrow();
    scopeB.close();
  });
});
