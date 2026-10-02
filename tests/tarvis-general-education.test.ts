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
    "HbA1c will not identify what caused the change. Your meal caused the low.",
    "What caused the low was your walk.",
    "Whether a person was unable to treat it themselves and needed another person to administer carbohydrates matters. To treat a low, administer carbohydrates.",
    "You have gastroparesis.",
  ])("rejects unsafe or invented personal prose: %s", (copy) => {
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify(explanation(copy)))).toThrow();
  });

  it.each([
    "The full CGM trace and variability statistics show the clinical severity of the lows.",
    "Time in range shows how severe a hypoglycaemic event was.",
    "Severe hypoglycemia can be determined from the CGM trace.",
    "A glucose reading below 54 mg/dL is severe hypoglycaemia.",
    "HbA1c measures clinical severity of a low episode.",
    "CGM cannot identify every symptom but the sensor trace reveals clinical severity.",
    "CGM tells you a hypo was severe.",
    "Sensor readings classify a low as severe.",
    "CGM does not just show glucose depth, it also reveals clinical severity.",
    "No, neither HbA1c nor CGM can show clinical severity, yet a sensor trace can show how severe the hypo was.",
    "Neither CGM nor time in range can establish clinical severity, and CGM can establish severe hypoglycaemia.",
    "Neither CGM nor HbA1c captures patient distress, and CGM confirms clinical severity.",
    "Neither CGM nor HbA1c reflects patient distress, and CGM confirms clinical severity.",
    "CGM does not only show glucose depth, it also confirms clinical severity.",
  ])("rejects a glucose metric being presented as a clinical severity classification: %s", (copy) => {
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify(explanation(copy))))
      .toThrow("Tarv1s returned an explanation outside its safety boundary. Please try again.");
  });

  it.each([
    "The full CGM trace shows timing and depth of lows. It cannot establish clinical severity without context.",
    "A CGM trace cannot establish clinical severity by itself.",
    "Severe hypoglycaemia involves impaired functioning requiring another person's assistance, regardless of glucose value.",
    "Readings below 54 mg/dL are level 2 hypoglycaemia; level 3 is defined by requiring help from another person.",
    "A glucose reading below 54 mg/dL is not severe hypoglycaemia by itself.",
    "A CGM trace can show low duration and variability, but severe hypoglycaemia is defined by needing assistance.",
    "CGM cannot tell you whether a hypo was severe.",
    "No, neither HbA1c, CGM time in range, nor a sensor trace alone can show whether a hypoglycaemic event was clinically severe (level 3).",
    "No, neither HbA1c, time in range, nor a CGM sensor trace can establish whether a hypoglycaemic event was clinically severe (level 3).",
    "HbA1c on its own will not identify what caused the change.",
    "A time-in-range percentage cannot determine what caused your low.",
    "Whether a person was unable to treat it themselves and needed another person to administer carbohydrates is relevant to severe hypoglycaemia.",
  ])("keeps accurate distinctions between glucose patterns and clinical severity: %s", (copy) => {
    expect(parseTarvisGeneralEducationAnswer(JSON.stringify(explanation(copy))).acceptedHostedAnswer).toBe(true);
  });

  it("checks the headline and limitations as well as the main explanation", () => {
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify({
      ...explanation("A CGM trace shows the depth of a low."),
      headline: "CGM reveals clinical severity of hypoglycaemia",
    }))).toThrow();
    expect(() => parseTarvisGeneralEducationAnswer(JSON.stringify({
      ...explanation("A CGM trace shows the depth of a low."),
      limitations: ["HbA1c indicates the clinical severity of the lows."],
    }))).toThrow();
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
