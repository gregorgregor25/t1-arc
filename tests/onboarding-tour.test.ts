import { describe, expect, it } from "vitest";

import {
  LAST_ONBOARDING_TOUR_INDEX,
  ONBOARDING_TOUR_STEPS,
  clampOnboardingTourIndex,
  nextOnboardingTourIndex,
  onboardingDestinationDataMode,
  onboardingTourProgressLabel,
  onboardingTransitionDuration,
  previousOnboardingTourIndex,
} from "@/screens/onboarding/tourModel";

describe("onboarding tour model", () => {
  it("keeps the walkthrough concise, ordered and uniquely identified", () => {
    expect(ONBOARDING_TOUR_STEPS).toHaveLength(5);
    expect(new Set(ONBOARDING_TOUR_STEPS.map((step) => step.id)).size).toBe(5);
    expect(ONBOARDING_TOUR_STEPS.map((step) => step.id)).toEqual([
      "today",
      "log",
      "context",
      "tarvis",
      "control",
    ]);
  });

  it("clamps navigation at both ends", () => {
    expect(clampOnboardingTourIndex(Number.NaN)).toBe(0);
    expect(previousOnboardingTourIndex(0)).toBe(0);
    expect(nextOnboardingTourIndex(LAST_ONBOARDING_TOUR_INDEX)).toBe(
      LAST_ONBOARDING_TOUR_INDEX,
    );
  });

  it("provides spoken progress copy", () => {
    expect(onboardingTourProgressLabel(0)).toBe("Step 1 of 5");
    expect(onboardingTourProgressLabel(99)).toBe("Step 5 of 5");
  });

  it("removes transitions when reduced motion is enabled", () => {
    expect(onboardingTransitionDuration(true)).toBe(0);
    expect(onboardingTransitionDuration(false)).toBeGreaterThan(0);
  });

  it("opens the demo for exploration and live mode for source setup", () => {
    expect(onboardingDestinationDataMode("Today")).toBe("demo");
    expect(onboardingDestinationDataMode("Sources")).toBe("live");
  });
});
