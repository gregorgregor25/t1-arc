import { describe, expect, it } from "vitest";

import { currentGlucoseCardLayout } from "@/components/currentGlucoseCardLayout";

describe("current glucose card large-text layout", () => {
  it.each([
    [Number.NaN, { minHeight: 238, traceTop: 78 }],
    [0.85, { minHeight: 238, traceTop: 78 }],
    [1, { minHeight: 238, traceTop: 78 }],
    [1.5, { minHeight: 278, traceTop: 88 }],
    [2, { minHeight: 318, traceTop: 98 }],
  ])(
    "maps font scale %s to collision-free card geometry",
    (fontScale, expected) => {
      expect(currentGlucoseCardLayout(fontScale)).toEqual(expected);
    },
  );
});
