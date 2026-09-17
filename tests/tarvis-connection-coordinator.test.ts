import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginTarvisConnectionRequest,
  resetTarvisConnectionCoordinatorForTests,
  runTarvisConnectionMutation,
} from "@/data/tarvis/connectionCoordinator";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Tarv1s connection coordinator", () => {
  beforeEach(() => {
    resetTarvisConnectionCoordinatorForTests();
  });

  it("aborts and supersedes an active hosted request before changing the connection", async () => {
    const request = await beginTarvisConnectionRequest();
    const mutation = runTarvisConnectionMutation(async () => undefined);

    expect(request.signal.aborted).toBe(true);
    expect(() => request.assertCurrent()).toThrowError(
      expect.objectContaining({ name: "TarvisConnectionSupersededError" }),
    );

    await mutation;
    request.release();
  });

  it("does not let a request capture credentials while a connection mutation is unfinished", async () => {
    const gate = deferred();
    const mutation = runTarvisConnectionMutation(async () => {
      await gate.promise;
    });
    let requestStarted = false;
    const requestPromise = beginTarvisConnectionRequest().then((request) => {
      requestStarted = true;
      return request;
    });

    await Promise.resolve();
    expect(requestStarted).toBe(false);

    gate.resolve();
    await mutation;
    const request = await requestPromise;
    expect(request.signal.aborted).toBe(false);
    expect(() => request.assertCurrent()).not.toThrow();
    request.release();
  });

  it("treats an aborted request as unusable even when its connection generation is current", async () => {
    const request = await beginTarvisConnectionRequest();

    request.abort();

    expect(() => request.assertGenerationCurrent()).not.toThrow();
    expect(() => request.assertCurrent()).toThrowError(
      expect.objectContaining({ name: "TarvisConnectionRequestAbortedError" }),
    );
    request.release();
  });

  it("orders connection mutations by invocation so the latest action wins", async () => {
    const firstGate = deferred();
    const events: string[] = [];
    const first = runTarvisConnectionMutation(async () => {
      events.push("first-start");
      await firstGate.promise;
      events.push("first-end");
    });
    const secondTask = vi.fn(async () => {
      events.push("second");
    });
    const second = runTarvisConnectionMutation(secondTask);

    await Promise.resolve();
    expect(secondTask).not.toHaveBeenCalled();
    firstGate.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual(["first-start", "first-end", "second"]);
  });
});
