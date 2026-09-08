import { describe, expect, it } from "vitest";
import {
  parseTarvisGeneralEducationAnswer,
  isTarvisGeneralEducationAnswer,
  TARVIS_GENERAL_EDUCATION_PROMPT,
  tarvisGeneralEducationTextConfig,
} from "@/data/tarvis/generalEducation";

const explanation = (answer: string) => ({
  kind: "explanation", headline: "A general explanation", answer, limitations: [],
});

describe("Tarv1s general explanations", () => {
  it.each([
    "Fibre is a type of carbohydrate that is not fully digested in the small intestine.",
    "HbA1c describes glycated haemoglobin, whereas CGM measures glucose in interstitial fluid.",
    "Sleep and appetite can influence each other. That alone does not establish why an individual feels hungry.",
    "A high-fat meal can reduce insulin sensitivity temporarily and delay carbohydrate absorption.",
    "Fat can slow digestion. When you eat carbohydrates with fat, glucose absorption can happen later.",
    "Stress hormones can increase insulin resistance. This is a general mechanism, not an explanation of your records.",
  ])("accepts general explanations without claiming personal evidence: %s", (copy) => {
    const result = parseTarvisGeneralEducationAnswer(JSON.stringify(explanation(copy)));
    expect(result.acceptedHostedAnswer).toBe(true);
    expect(result.answer.answer).toBe(copy);
    expect(result.answer.evidenceIds).toEqual([]);
    expect(result.answer.confidence).toBe("moderate");
    expect(result.answer.responseKind).toBe("general-education");
    expect(isTarvisGeneralEducationAnswer(result.answer)).toBe(true);
    expect(isTarvisGeneralEducationAnswer({ ...result.answer, responseKind: undefined })).toBe(true);
    expect(result.answer.limitations).toContain("General information, not an analysis of your personal records or medical advice.");
  });

  it.each([
    "Take 3 units of insulin before dinner.",
    "Reduce your basal rate overnight.",
    "After dinner, increase your insulin dose.",
    "For example take insulin before eating.",
    "You can try reducing your basal rate.",
    "It is best to increase your insulin dose.",
    "Consider taking more insulin.",
    "Eat 15 grams of carbs to treat the low.",
    "For example, take three units.",
    "Your correction dose = glucose minus target divided by sensitivity.",
    "Increase your basal rate overnight.",
    "You should start metformin at 500 mg.",
    "You should take amoxicillin.",
    "I recommend switching to a different antidepressant.",
    "Your readings show that poor sleep caused the rise.",
    "I reviewed your meals and found a pattern.",
    "You probably have depression.",
    "Your meal definitely caused the spike.",
    "You have gastroparesis.",
  ])("rejects unsafe or invented personal prose: %s", (copy) => {
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify(explanation(copy)))).toThrow();
  });

  it.each(["boundary", "urgent", "off-topic"])("uses local copy for %s and ignores returned prose", (kind) => {
    const result = parseTarvisGeneralEducationAnswer(JSON.stringify({ ...explanation("Take insulin now"), kind }));
    expect(result.acceptedHostedAnswer).toBe(false);
    expect(result.answer.answer).not.toContain("Take insulin now");
    expect(result.answer.evidenceIds).toEqual([]);
  });

  it("does not put unvalidated model text into a JSON error", () => {
    expect(() => parseTarvisGeneralEducationAnswer("Take 3 units now, not JSON"))
      .toThrow("Tarv1s returned an unreadable explanation. Please try again.");
  });

  it.each([
    null, [], {},
    { ...explanation("An explanation"), evidenceIds: ["invented"] },
    { ...explanation("An explanation"), kind: "medical-advice" },
    { ...explanation("An explanation"), limitations: [42] },
    explanation("x".repeat(2401)),
  ])("rejects malformed responses", (value) => {
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify(value))).toThrow();
  });

  it("keeps an explicit broad remit, no-record boundary and strict schema", () => {
    expect(TARVIS_GENERAL_EDUCATION_PROMPT).toContain("not a fixed question list");
    expect(TARVIS_GENERAL_EDUCATION_PROMPT).toContain("no personal health records");
    expect(TARVIS_GENERAL_EDUCATION_PROMPT).toContain("Never diagnose");
    expect(tarvisGeneralEducationTextConfig().format.strict).toBe(true);
    expect(tarvisGeneralEducationTextConfig().format.schema.additionalProperties).toBe(false);
  });
});
