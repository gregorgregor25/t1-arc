import { describe, expect, it } from "vitest";

import {
  APP_RECOVERY_COPY,
  initialAppRecoveryState,
  markAppRecoveryNeeded,
  reloadAppInterface,
} from "@/domain/appRecovery";

describe("app recovery", () => {
  it("enters recovery without retaining an error or personal detail", () => {
    const initial = initialAppRecoveryState();
    const recovery = markAppRecoveryNeeded(initial);

    expect(recovery).toEqual({ hasError: true, reloadKey: 0 });
    expect(Object.keys(recovery)).toEqual(["hasError", "reloadKey"]);
  });

  it("remounts the app tree for every explicit reload attempt", () => {
    const first = reloadAppInterface(
      markAppRecoveryNeeded(initialAppRecoveryState()),
    );
    const second = reloadAppInterface(markAppRecoveryNeeded(first));

    expect(first).toEqual({ hasError: false, reloadKey: 1 });
    expect(second).toEqual({ hasError: false, reloadKey: 2 });
  });

  it("uses fixed privacy-safe copy instead of interpolating error details", () => {
    const copy = Object.values(APP_RECOVERY_COPY).join(" ");

    expect(copy).toContain("personal data was not changed");
    expect(copy).toContain("does not send the error");
    expect(copy).not.toContain("stack");
  });
});
