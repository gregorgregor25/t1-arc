import { describe, expect, it } from "vitest";

import { formatTarvisConversation } from "@/data/tarvis/conversationExport";

describe("Tarv1s conversation export", () => {
  it("exports the questions, answers and material limitations", () => {
    const text = formatTarvisConversation([
      {
        question: "Why was I high last night?",
        answer: {
          headline: "A late meal overlaps the rise",
          answer: "The cited records show a meal before the glucose rise.",
          confidence: "moderate",
          evidenceIds: ["meal"],
          limitations: ["Insulin history was incomplete."],
        },
      },
    ]);

    expect(text).toContain("Ask Tarv1s conversation");
    expect(text).toContain("Why was I high last night?");
    expect(text).toContain("Insulin history was incomplete.");
  });
});
