import { describe, expect, it } from "vitest";

import {
  buildTarvisTreatmentProfileAnswer,
  isTarvisTreatmentProfileQuestion,
  treatmentProfileLoadFailureAnswer,
} from "@/data/tarvis/treatmentProfileAnswer";

describe("Tarv1s treatment-profile answer", () => {
  it.each([
    "Show my saved insulin-to-carb ratios",
    "What are my configured grams of carbohydrate per unit?",
  ])("recognises an explicit saved-profile question: %s", (question) => {
    expect(isTarvisTreatmentProfileQuestion(question)).toBe(true);
  });

  it.each([
    "How many carbohydrates did I eat today?",
    "What is my carb ratio?",
    "What is an insulin-to-carb ratio?",
    "How long did I exercise today?",
  ])("does not claim an unrelated question: %s", (question) => {
    expect(isTarvisTreatmentProfileQuestion(question)).toBe(false);
  });

  it("repeats the complete confirmed schedule locally without dosing", () => {
    const answer = buildTarvisTreatmentProfileAnswer(
      {
        schemaVersion: 1,
        source: "manual",
        confirmedAt: 123_456,
        carbRatioSchedule: [
          { id: "later", startMinute: 360, gramsPerUnit: 12 },
          { id: "all-day", startMinute: 0, gramsPerUnit: 10 },
        ],
      },
      "en-US",
    );

    expect(answer.headline).toBe("Your saved carb-ratio profile");
    expect(answer.answer).toContain(
      "from 12:00 AM, 1 unit covers 10 g carbohydrate",
    );
    expect(answer.answer).toContain(
      "from 06:00 AM, 1 unit covers 12 g carbohydrate",
    );
    expect(answer.answer).toContain("did not calculate a dose");
    expect(answer.limitations).toContain("No OpenAI request was made.");
  });

  it("fails closed for an absent or unreadable local profile", () => {
    const absent = buildTarvisTreatmentProfileAnswer(undefined, "en-GB");
    const unreadable = treatmentProfileLoadFailureAnswer();

    expect(absent.headline).toBe("No saved carb-ratio profile");
    expect(absent.answer).toContain("Settings → Diabetes profile");
    expect(unreadable.headline).toContain("could not read");
    expect(unreadable.answer).toContain("did not use the saved ratio");
    expect(unreadable.limitations).toContain("No OpenAI request was made.");
  });
});
