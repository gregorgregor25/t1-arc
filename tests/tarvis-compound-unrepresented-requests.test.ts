import { describe, expect, it } from "vitest";
import { resolveTarvisCompoundIntents, resolveTarvisIntent } from "@/data/tarvis/intent";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

const NOW = Date.parse("2026-09-08T18:20:50+01:00");
const OPTIONS = { now: NOW, timezone: "Europe/London" };

function compound(question: string) {
  return resolveTarvisCompoundIntents(resolveTarvisIntent(question, OPTIONS), OPTIONS);
}

describe("Compound requests cannot silently omit an unsupported requested statistic", () => {
  it.each([
    "Show my average glucose, low episodes and total calories yesterday.",
    "Show my total carbs, total bolus insulin and protein yesterday.",
    "Show protein, total carbs and total bolus insulin yesterday.",
    "Compare my average glucose and low episodes yesterday, including calories.",
    "Show my total carbs and total bolus insulin yesterday, plus my fat intake.",
    "What were my total carbs, total bolus insulin and fibre yesterday?",
    "Show total carbs and total bolus insulin yesterday, and how much sodium did I log?",
    "Show my average glucose and low episodes yesterday, and how many calories were logged?",
    "Show my average glucose, low episodes and energy intake yesterday.",
    "Show my total carbs, total bolus insulin and dietary cholesterol yesterday.",
    "Show my average glucose and low episodes yesterday, including the longest episode.",
    "Show my average glucose and low episodes yesterday, plus the maximum duration of a low.",
    "Show my average glucose and low episodes yesterday, and the shortest hypo.",
    "Show my average glucose and low episodes yesterday, including their durations.",
    "Show my average glucose and total duration of low episodes yesterday.",
    "Show my average glucose and low episodes yesterday, and how long they lasted.",
    "Show my average glucose and high episodes yesterday with their durations.",
    "Show my average glucose and low episodes yesterday, and time spent low.",
  ])("declines the entire compound rather than answering a subset: %s", (question) => {
    expect(compound(question)).toBeNull();
    expect(coordinateTarvisRequest({ question, asOf: NOW })).toMatchObject({ kind: "answer", source: "capability" });
  });

  it.each([
    "My meals contained protein. Show my total carbs and total bolus insulin yesterday.",
    "I had a protein shake. Show my total carbs and total bolus insulin yesterday.",
    "I read about calories. Show my average glucose and low episodes yesterday.",
    "Protein is important to me. Show my total carbs and total bolus insulin yesterday.",
    "Show my total carbs and total bolus insulin yesterday. My meals contained fat and protein.",
    "What was my average blood sugar and how many low sugar episodes did I have yesterday?",
    "Show my average glucose and low episodes yesterday. One episode felt longest to me.",
  ])("does not mistake descriptive context for another calculation: %s", (question) => {
    expect(compound(question)).toHaveLength(2);
    expect(coordinateTarvisRequest({ question, asOf: NOW }).kind).toBe("scoped-compound");
  });

  it.each([
    "Hey. What was my average glucose over the last 7 days compared the previous 7 days? And how many periods of low sugar did I have in the last 7 days compared to the previous 7 days?",
    "How many carbohydrates did I log yesterday versus how much bolus insulin I took?",
    "Show my time in range and low episodes yesterday.",
  ])("preserves the approved supported requests: %s", (question) => {
    expect(compound(question)).toHaveLength(2);
    expect(coordinateTarvisRequest({ question, asOf: NOW }).kind).toBe("scoped-compound");
  });

  it("does not change the existing same-operation minimum/maximum glucose route", () => {
    const question = "Show my minimum glucose and maximum glucose yesterday.";
    const resolution = resolveTarvisIntent(question, OPTIONS);
    expect(resolution.outcome.code).toBe("ready");
    expect(coordinateTarvisRequest({ question, asOf: NOW }).kind).toBe("scoped-glucose");
  });
});
