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
  tourGlucoseUnitChoice,
} from "@/screens/onboarding/tourModel";

describe("onboarding tour model", () => {
  it("keeps the walkthrough concise, ordered and uniquely identified", () => {
    expect(ONBOARDING_TOUR_STEPS).toHaveLength(6);
    expect(new Set(ONBOARDING_TOUR_STEPS.map((step) => step.id)).size).toBe(6);
    expect(ONBOARDING_TOUR_STEPS.map((step) => step.id)).toEqual([
      "today",
      "log",
      "context",
      "tarvis",
      "control",
      "setup",
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
    expect(onboardingTourProgressLabel(0)).toBe("Step 1 of 6");
    expect(onboardingTourProgressLabel(99)).toBe("Step 6 of 6");
  });

  it("removes transitions when reduced motion is enabled", () => {
    expect(onboardingTransitionDuration(true)).toBe(0);
    expect(onboardingTransitionDuration(false)).toBeGreaterThan(0);
  });

  it("opens the demo for exploration and live mode for source setup", () => {
    expect(onboardingDestinationDataMode("Today")).toBe("demo");
    expect(onboardingDestinationDataMode("Sources")).toBe("live");
    expect(onboardingDestinationDataMode("Alerts")).toBe("live");
  });

  it("ends with the setup step and states the local-first promise once", () => {
    const setup = ONBOARDING_TOUR_STEPS[LAST_ONBOARDING_TOUR_INDEX]!;
    expect(setup.id).toBe("setup");
    const control = ONBOARDING_TOUR_STEPS.find((step) => step.id === "control")!;
    expect(control.detail).toContain("encrypted on this phone");
    expect(control.detail.split(". ").length).toBe(1);
  });

  it("preselects the saved glucose unit, or the regional default when automatic", () => {
    expect(tourGlucoseUnitChoice({ glucoseUnit: "mgDl" }, { glucoseUnit: "mmolL" })).toBe("mgDl");
    expect(tourGlucoseUnitChoice({ glucoseUnit: "automatic" }, { glucoseUnit: "mgDl" })).toBe("mgDl");
    expect(tourGlucoseUnitChoice({ glucoseUnit: "automatic" }, { glucoseUnit: "mmolL" })).toBe("mmolL");
  });
});
