import { describe, expect, it } from "vitest";

import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import { safetyQuestionWithImmediateContext } from "@/data/tarvis/safetyContext";
import type { TarvisConversationTurn } from "@/data/tarvis/types";

const NOW = Date.parse("2026-08-26T12:00:00+01:00");

function history(previousUserText: string): TarvisConversationTurn[] {
  return [
    { role: "user", text: previousUserText },
    { role: "assistant", text: "Previous local answer." },
  ];
}

function plan(question: string, previousUserText: string) {
  return coordinateTarvisRequest({
    question,
    asOf: NOW,
    conversationHistory: history(previousUserText),
  });
}

describe("Tarv1s immediate safety context", () => {
  it.each([
    "She has tummy pain",
    "They are taking very deep breaths",
    "She is vomiting now",
    "She's vomiting",
    "She is dehydrated",
    "She can't keep fluids down",
    "She feels sick",
    "Her tummy hurts",
  ])(
    "retains a known child Type 1 subject for a terse current symptom: %s",
    (question) => {
      const result = plan(question, "My daughter has Type 1 diabetes.");
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it("retains a known adult Type 1 subject for a terse current symptom", () => {
    const result = plan("I have stomach pain", "I have Type 1 diabetes.");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
    expect(result.answer.headline).toBe("Call 999 now or go to A&E");
  });

  it.each(["I'm a T1 diabetic.", "I was diagnosed with type one diabetes."])(
    "recognises an explicit self Type 1 assertion: %s",
    (previous) => {
      const result = plan("I have stomach pain", previous);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it.each(["I feel sick", "I'm vomiting", "I am dehydrated"])(
    "retains a known adult Type 1 subject for another DKA symptom: %s",
    (question) => {
      const result = plan(question, "I have Type 1 diabetes.");
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it.each(["3.2", "Mine are 3.2"])(
    "retains blood-ketone modality for a terse reading: %s",
    (question) => {
      const result = plan(question, "I just checked my blood ketones.");
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it("keeps an explicit current blood-ketone check despite a historical aside", () => {
    const result = plan(
      "3.2",
      "I just checked my blood ketones; yesterday they were normal.",
    );
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
    expect(result.answer.headline).toBe("Call 999 now or go to A&E");
  });

  it("keeps an explicit current blood-ketone assertion despite a historical aside", () => {
    const result = plan(
      "3.2",
      "My blood ketones are high now; they were 0.2 yesterday.",
    );
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
    expect(result.answer.headline).toBe("Call 999 now or go to A&E");
  });

  it.each(["three point two", "three and a half"])(
    "retains blood-ketone modality for a spoken reading: %s",
    (question) => {
      const result = plan(question, "I just checked my blood ketones.");
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it("retains urine-ketone modality for a terse strip result", () => {
    const result = plan("+++", "I checked my urine ketone test strip.");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
    expect(result.answer.headline).toBe("Call 999 now or go to A&E");
  });

  it.each(["three plus", "3+", "large"])(
    "retains urine-ketone modality for a spoken strip result: %s",
    (question) => {
      const result = plan(question, "I checked my urine ketone test strip.");
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it("retains low-glucose modality for a terse reading", () => {
    const result = plan("3.2", "My glucose is low.");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
    expect(result.answer.headline).toBe("Use your trusted treatment plan now");
  });

  it("retains a generic current ketone context for a numeric update", () => {
    const result = plan("3.2", "My ketones are high.");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
    expect(result.answer.headline).toBe("Call 999 now or go to A&E");
  });

  it.each([
    { previous: "My glucose is high.", question: "22" },
    { previous: "My current glucose reading", question: "2.8" },
  ])(
    "retains an explicit current glucose modality: $previous -> $question",
    ({ previous, question }) => {
      const result = plan(question, previous);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe(
        "Use your trusted treatment plan now",
      );
    },
  );

  it("does not transfer a symptom when two female relatives are mentioned", () => {
    const previous =
      "My wife has T1D. My daughter does not have diabetes.";
    expect(
      safetyQuestionWithImmediateContext("She's vomiting", history(previous)),
    ).toBe("She's vomiting");
  });

  it("does not scan past a newer unrelated user turn", () => {
    const conversationHistory: TarvisConversationTurn[] = [
      { role: "user", text: "I just checked my blood ketones." },
      { role: "assistant", text: "Previous local answer." },
      { role: "user", text: "Tell me about time in range." },
      { role: "assistant", text: "Previous local answer." },
    ];
    expect(safetyQuestionWithImmediateContext("3.2", conversationHistory)).toBe(
      "3.2",
    );
  });

  it.each([
    "What do blood ketones mean?",
    "My blood ketones were 3.2 last week.",
    "For education, explain my blood ketone result.",
    "My blood ketones and urine ketones are both shown.",
  ])("rejects non-current or ambiguous reading context: %s", (previous) => {
    expect(safetyQuestionWithImmediateContext("3.2", history(previous))).toBe(
      "3.2",
    );
  });

  it("does not carry a child subject into a first-person symptom", () => {
    expect(
      safetyQuestionWithImmediateContext(
        "I have stomach pain",
        history("My daughter has Type 1 diabetes."),
      ),
    ).toBe("I have stomach pain");
  });

  it.each([
    "My adult child has Type 1 diabetes.",
    "My grown-up child has Type 1 diabetes.",
    "My 40-year-old son has Type 1 diabetes.",
    "My child is 18 and has Type 1 diabetes.",
    "My son aged forty has Type 1 diabetes.",
  ])(
    "retains an explicitly adult relative without treating them as a child: %s",
    (previous) => {
      const result = plan("He is vomiting now", previous);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it.each([
    ["My husband has Type 1 diabetes.", "He's vomiting"],
    ["My wife has Type 1 diabetes.", "She's vomiting"],
    ["My partner has Type 1 diabetes.", "They're vomiting"],
    ["My mum has Type 1 diabetes.", "She's vomiting"],
    ["My friend has Type 1 diabetes.", "They're vomiting"],
  ])(
    "retains a known adult relative for a terse symptom: %s -> %s",
    (previous, question) => {
      const result = plan(question, previous);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it.each([
    ["My daughter has Type 1 diabetes.", "He's vomiting"],
    ["My son has Type 1 diabetes.", "She's vomiting"],
  ])(
    "does not transfer a known child across an incompatible pronoun: %s -> %s",
    (previous, question) => {
      expect(
        safetyQuestionWithImmediateContext(question, history(previous)),
      ).toBe(question);
    },
  );

  it("does not infer a known child from general education", () => {
    expect(
      safetyQuestionWithImmediateContext(
        "She is vomiting now",
        history("What should a child with Type 1 diabetes do when ill?"),
      ),
    ).toBe("She is vomiting now");
  });

  it.each([
    "Does my daughter have Type 1 diabetes?",
    "My daughter may have Type 1 diabetes.",
    "I think my daughter has Type 1 diabetes.",
    "My daughter is being tested for Type 1 diabetes.",
  ])("does not treat an uncertain child diagnosis as known: %s", (previous) => {
    expect(
      safetyQuestionWithImmediateContext(
        "She is vomiting now",
        history(previous),
      ),
    ).toBe("She is vomiting now");
  });

  it.each([
    "Could I have Type 1 diabetes?",
    "I think I have Type 1 diabetes.",
    "I'm not sure if I have Type 1 diabetes.",
  ])("does not treat an uncertain adult diagnosis as known: %s", (previous) => {
    expect(
      safetyQuestionWithImmediateContext(
        "I have stomach pain",
        history(previous),
      ),
    ).toBe("I have stomach pain");
  });
});
