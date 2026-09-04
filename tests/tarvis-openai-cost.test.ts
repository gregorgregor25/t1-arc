import { describe, expect, it } from "vitest";

import { estimateTarvisCostUsd } from "@/data/tarvis/cost";

describe("Tarv1s OpenAI cost estimate", () => {
  it("uses gpt-5.6-luna rates of $0.20/M input and $1.20/M output", () => {
    expect(estimateTarvisCostUsd(1_000_000, 1_000_000)).toBeCloseTo(1.4);
    expect(estimateTarvisCostUsd(10_000, 1_000)).toBeCloseTo(0.0032);
  });
});
