import { describe, expect, it } from "vitest";

import { classifyTarvisSafety } from "@/data/tarvis/safety";

describe("Tarv1s deterministic safety preflight", () => {
  it.each([
    "I am vomiting and have ketones right now, what should I do?",
    "I am vomiting and have ketones",
    "I'm confused and low",
    "Help, I am confused and having difficulty breathing now",
    "I can't keep fluids down and I still have ketones",
  ])("interrupts analytics for urgent symptoms: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("urgent");
  });

  it.each([
    "How much insulin should I take?",
    "Should I increase my basal rate?",
    "Calculate a correction bolus for me",
    "Tell me how to change my carb ratio",
    "Should I take 3 units now?",
    "What correction should I do now?",
    "How many units should I take?",
    "Can I inject now?",
    "Should I correct now?",
    "How many carbs should I eat to treat this low?",
    "How many glucose tablets for this hypo?",
    "This low is stubborn. Should I drink some juice?",
    "I'm low. Should I take 15g?",
    "How should I treat this hypo?",
  ])("blocks treatment recommendations: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("treatment-advice");
  });

  it.each([
    "How much insulin did I take yesterday?",
    "Did my last correction overlap the high?",
    "Show my delivered basal rate overnight",
    "How did my basal rate change last week?",
    "Did insulin increase after exercise?",
    "Should delivered insulin include basal?",
  ])("allows descriptive insulin questions: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("allow");
  });

  it.each([
    "I was vomiting yesterday but I feel fine now",
    "I had ketones last Tuesday",
  ])(
    "does not turn clearly historical symptoms into an emergency interruption: %s",
    (question) => {
      expect(classifyTarvisSafety(question).kind).toBe("allow");
    },
  );

  it("does not diagnose DKA from historical records", () => {
    expect(classifyTarvisSafety("Was that DKA last Tuesday?").kind).toBe(
      "diagnosis",
    );
  });

  it.each([
    "Where will my glucose be in 30 minutes?",
    "Will I go low in 30 minutes?",
    "Will I go high after this meal?",
    "Am I going to become hypo overnight?",
    "Could I go low overnight?",
    "Will I have a hypo tonight?",
    "Will my glucose drop later?",
    "Is my glucose going to rise after dinner?",
  ])("blocks unsupported glucose forecasts: %s", (question) => {
    expect(classifyTarvisSafety(question).kind).toBe("prediction");
  });
});
