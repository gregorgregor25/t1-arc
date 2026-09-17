import { describe, expect, it, vi } from "vitest";

import { HevySyncCoordinator } from "@/data/hevy/syncCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("Hevy sync coordinator", () => {
  it("invalidates and drains non-cooperative older work", async () => {
    const coordinator = new HevySyncCoordinator();
    const network = deferred<void>();
    const finished = vi.fn();
    const old = coordinator.run(async (lease) => {
      await network.promise;
      finished(lease.isCurrent());
      return "old";
    });
    await Promise.resolve();

    const barrier = coordinator.beginExclusiveChange();
    await expect(
      coordinator.run(async () => "must-not-run"),
    ).rejects.toThrow("superseded");

    let drained = false;
    void barrier.ready.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    network.resolve();
    await expect(old).resolves.toBe("old");
    await expect(barrier.ready).resolves.toBeUndefined();
    expect(finished).toHaveBeenCalledWith(false);

    barrier.release();
    await expect(coordinator.run(async () => "new")).resolves.toBe("new");
  });

  it("aborts cooperative remote work so an exclusive change drains promptly", async () => {
    const coordinator = new HevySyncCoordinator();
    const started = deferred<void>();
    const old = coordinator.run(
      (lease) =>
        new Promise<string>((_resolve, reject) => {
          lease.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled remote work")),
            { once: true },
          );
          started.resolve();
        }),
    );
    await started.promise;

    const barrier = coordinator.beginExclusiveChange();

    await expect(old).rejects.toThrow("cancelled remote work");
    await expect(barrier.ready).resolves.toBeUndefined();
    barrier.release();
  });
});
