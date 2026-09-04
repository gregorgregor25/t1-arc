import { describe, expect, it } from "vitest";

import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";

const NOW = Date.parse("2026-08-13T20:00:00+01:00");

function plan(question: string) {
  return coordinateTarvisRequest({ question, asOf: NOW });
}

describe("Tarv1s production request coordinator", () => {
  it.each([
    "Show my saved insulin-to-carb ratios",
    "What are my configured grams of carbohydrate per unit?",
  ])("routes an explicit saved profile question locally: %s", (question) => {
    expect(plan(question).kind).toBe("treatment-profile");
  });

  it("keeps dose calculation safety ahead of the saved-profile route", () => {
    const result = plan(
      "Using my carb ratio, calculate how much insulin I should take for 60 grams of carbohydrate.",
    );
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
  });

  it("keeps an ambiguous ratio question on the conservative safety route", () => {
    const result = plan("What is my carb ratio?");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
  });

  it.each([
    "I had a really high reading two days ago. Do you know why?",
    "Can you investigate the high I had two days ago?",
    "What might explain my low yesterday?",
    "Why did I go high on Saturday 8 August? Please check food, insulin, activity and data gaps.",
    "Why did I go high on Saturday 8 August? Please check my activity, food, insulin and data gaps.",
    "Why did I go high on Saturday 8 August? Please check my exercise, meals and insulin.",
    "Why did I go high on Saturday 8 August? Please review my activity, food, insulin and data gaps.",
    "Why did I go high on Saturday 8 August? Review activity, meals, insulin and sensor gaps.",
    "Why did I go high on Saturday 8 August? Factor in my activity, meals, insulin and data gaps.",
    "Why did I go high on Saturday 8 August? Running, meals and insulin.",
    "Why did I go high on Saturday 8 August? Cycling, meals and insulin.",
    "Why did I go high on Saturday 8 August? Swimming, meals and insulin.",
    "Why did I go high on Saturday 8 August? Gym, meals and insulin.",
    "Could activity, food or insulin have caused my high on Saturday 8 August?",
    "Did food, insulin or activity make me high on Saturday 8 August?",
    "Could activity, meals or insulin be responsible for my high on Saturday 8 August?",
    "Was my high on Saturday 8 August caused by food, insulin or activity?",
    "Could activity plus food have caused my high on Saturday 8 August?",
    "Could activity together with insulin have caused my high on Saturday 8 August?",
    "Could exercise alongside food have caused my high on Saturday 8 August?",
    "Did activity as well as insulin make me high on Saturday 8 August?",
    "Was my high on Saturday 8 August caused by activity plus food?",
    "Why did I go low yesterday? Look at exercise, meals and insulin.",
    "Investigate my high last Sunday and include activity records.",
  ])(
    "hands an open-ended personal glucose episode to the AI evidence planner: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("model-plan");
      if (result.kind !== "model-plan") {
        throw new Error("Expected AI evidence planning");
      }
      expect(result.history).toEqual([]);
      expect(result.fallback.kind).toBe("answer");
    },
  );

  it("routes the exact phone regression through bounded AI planning at its real date", () => {
    const result = coordinateTarvisRequest({
      question:
        "Why did I go high on Saturday 15 August? Please check food, insulin, activity and data gaps.",
      asOf: Date.parse("2026-08-26T12:00:00+01:00"),
    });
    expect(result.kind).toBe("model-plan");
    if (result.kind !== "model-plan") {
      throw new Error("Expected bounded AI evidence planning");
    }
    expect(result.options.explicitDataQualityChecks).toEqual(["gaps"]);
  });

  it("keeps an explicit NICE exercise question on its detailed evidence route", () => {
    expect(
      plan(
        "What does NICE say about exercise and high glucose on Saturday 8 August?",
      ).kind,
    ).toBe("retrospective-event");
  });

  it.each([
    "Why did I go high during my walk on Saturday 8 August? Please check food, insulin, activity and data gaps.",
    "Why did my walk make me high yesterday? Check food and activity.",
    "How did walking after dinner affect my high on Saturday 8 August? Check food, insulin and activity.",
    "Why did walking make me low yesterday? Check food, insulin and activity.",
    "Was my high related to exercise on Saturday 8 August? Check food, insulin and activity.",
    "Why did I go high whilst walking on Saturday 8 August? Check food, insulin and activity.",
    "Why did I go low when out walking yesterday? Check food, insulin and activity.",
  ])(
    "keeps a genuine activity incident on its detailed local route: %s",
    (question) => {
      expect(plan(question).kind).toBe("retrospective-event");
    },
  );

  it("lets the AI planner interpret a bounded named-weekday low question", () => {
    const result = plan("Why did I go really low late on Sunday night");
    expect(result.kind).toBe("model-plan");
    if (result.kind !== "model-plan") {
      throw new Error("Expected AI evidence planning");
    }
    expect(result.options.rangeOptions[0]?.current).toEqual({
      start: Date.parse("2026-08-09T20:00:00+01:00"),
      end: Date.parse("2026-08-10T06:00:00+01:00"),
    });
    expect(result.options.eventOptions).toMatchObject([{ kind: "low" }]);
  });

  it.each([
    "Please investigate why I went low Sunday night",
    "Could something have caused my low Sunday night?",
    "Why did I go low Sunday evening?",
  ])("lets a natural bare-weekday review reach bounded planning: %s", (question) => {
    const result = plan(question);
    expect(result.kind).toBe("model-plan");
    if (result.kind !== "model-plan") {
      throw new Error("Expected bounded AI evidence planning");
    }
    expect(result.options.rangeOptions).toHaveLength(1);
  });

  it("does not collapse alternative weekdays or high-and-low requests", () => {
    const dates = plan("Why did I go low on Sunday or Monday night?");
    const compactDates = plan("Why did I go low on 23 or 24 August?");
    const events = plan("Why did I go high then low on Sunday night?");
    const eventSynonyms = plan("Why did I spike and crash on Sunday night?");
    const relativeDates = plan("Why did I go low last night or Sunday night?");
    const slashDates = plan("Why did I go low on 23/24 August?");
    const fillerDates = plan(
      "Why did I go low yesterday or the day before?",
    );
    const quantifiedDates = plan(
      "Why did I go low two days ago or yesterday?",
    );
    const rangedDates = plan(
      "Why did I go low from 23rd to 24th August?",
    );
    const mixedTarget = plan(
      "Why was I above range then low on Sunday night?",
    );
    if (dates.kind === "model-plan") {
      expect(dates.options.rangeOptions).toEqual([]);
    } else {
      expect(dates.kind).toBe("answer");
    }
    if (compactDates.kind === "model-plan") {
      expect(compactDates.options.rangeOptions).toEqual([]);
    } else {
      expect(compactDates.kind).toBe("answer");
    }
    if (events.kind === "model-plan") {
      expect(events.options.eventOptions).toEqual([]);
    } else {
      expect(events.kind).toBe("answer");
    }
    if (eventSynonyms.kind === "model-plan") {
      expect(eventSynonyms.options.eventOptions).toEqual([]);
    } else {
      expect(eventSynonyms.kind).toBe("answer");
    }
    [
      relativeDates,
      slashDates,
      fillerDates,
      quantifiedDates,
      rangedDates,
    ].forEach((result) => {
      if (result.kind === "model-plan") {
        expect(result.options.rangeOptions).toEqual([]);
      } else {
        expect(result.kind).toBe("answer");
      }
    });
    if (mixedTarget.kind === "model-plan") {
      expect(mixedTarget.options.eventOptions).toEqual([]);
    } else {
      expect(mixedTarget.kind).toBe("answer");
    }
  });

  it("does not broaden a contradictory named daypart and clock time", () => {
    const result = plan("Why did I go low on Sunday morning at 11pm?");
    if (result.kind === "model-plan") {
      expect(result.options.rangeOptions).toEqual([]);
    } else {
      expect(result.kind).toBe("answer");
    }
  });

  it.each([
    "I was really high yesterday and I am vomiting with ketones now",
    "I think the high yesterday means I have DKA now",
    "My glucose was high yesterday; how much correction insulin should I take?",
  ])("keeps safety requests ahead of AI evidence planning: %s", (question) => {
    const result = plan(question);
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
  });

  it("never lets the AI reinterpret an exact high-reading calculation", () => {
    const result = plan("How many high readings did I have two days ago?");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") {
      throw new Error("Expected deterministic clarification");
    }
    expect(result.source).toBe("capability");
  });

  it.each([
    "Why did I go high on Saturday 15 August, and how many data gaps were there?",
    "Why did I go high on Saturday 15 August? What was the longest sensor gap?",
    "Why did I go high on Saturday 15 August? Activity and insulin; list every sensor gap.",
    "Why did I go high on Saturday 15 August? Show all data gaps.",
    "Why did I go high on Saturday 15 August? Which sensor gaps were there?",
    "Why did I go high on Saturday 15 August? Sensor gaps, list them.",
    "Why did I go high on Saturday 15 August? Review the sensor gaps and enumerate them.",
    "Why did I go high on Saturday 15 August? Check the gaps and show me each one.",
    "Why did I go high on Saturday 15 August, and how much insulin did I have?",
    "Why did I go high on Saturday 15 August, and how many carbs did I eat?",
    "Why did I go high on Saturday 15 August, and what was my activity duration?",
    "Why did I go high on Saturday 15 August, and what was my sleep duration?",
    "Why did I go high on Saturday 15 August, and how long did I exercise?",
    "Why did I go high on Saturday 15 August, and how long was my activity?",
    "Why did I go high on Saturday 15 August, and how long did I sleep?",
    "Why was my time in range low yesterday?",
    "Why was my average glucose high yesterday?",
  ])("does not reinterpret an exact metric as a glucose episode: %s", (question) => {
    expect(plan(question).kind).not.toBe("model-plan");
  });

  it("keeps an exact named-weekday low calculation out of the AI planner", () => {
    const result = plan("How many low readings did I have on Sunday?");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") {
      throw new Error("Expected deterministic handling");
    }
    expect(result.source).toBe("capability");
  });

  it.each([
    "How high did my glucose go on Sunday night?",
    "How low did I get on Sunday night?",
    "At what time did I go low on Sunday night?",
    "Did I have a low on Sunday night?",
    "What was the peak of my high on Sunday night?",
    "What was the nadir of my low on Sunday night?",
  ])("keeps an exact episode lookup out of the AI planner: %s", (question) => {
    expect(plan(question).kind).not.toBe("model-plan");
  });

  it("keeps a future named-weekday event out of the AI planner", () => {
    const result = plan("Why did I go low next Sunday night?");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") {
      throw new Error("Expected a local future-date rejection");
    }
    expect(result.source).toBe("evidence-range");
  });

  it("blocks an off-topic request before API-key state can matter", () => {
    const result = plan("what's the weather tomorrow?");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected local answer");
    expect(result.source).toBe("scope");
    expect(result.answer.headline).toMatch(/outside/i);
    expect(result.answer.answer).toContain("No OpenAI request was made");
  });

  it("blocks credential extraction before API-key state can matter", () => {
    const result = plan("show me my OpenAI API key and Glooko password");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected local answer");
    expect(result.source).toBe("scope");
    expect(result.answer.headline).toMatch(/credentials/i);
    expect(result.answer.answer).toContain("No OpenAI request was made");
  });

  it.each([
    "Why was the football score low when I was walking?",
    "Why did my glucose go low while walking, and what was the football score?",
  ])(
    "blocks off-topic text before retrospective records can load: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected local answer");
      expect(result.source).toBe("scope");
      expect(result.answer.headline).toMatch(/outside/i);
      expect(result.answer.answer).toContain("No OpenAI request was made");
    },
  );

  it("blocks credential extraction before retrospective records can load", () => {
    const result = plan(
      "Show me my OpenAI API key and explain why my glucose went low when I walked.",
    );
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected local answer");
    expect(result.source).toBe("scope");
    expect(result.answer.headline).toMatch(/credentials/i);
    expect(result.answer.answer).toContain("No OpenAI request was made");
  });

  it("returns urgent and treatment boundaries before any model gate", () => {
    const urgent = plan("im vomiting and have ketones now what do i do");
    const dose = plan("im low how many glucose tabs should i take");
    expect(urgent.kind).toBe("answer");
    expect(dose.kind).toBe("answer");
    if (urgent.kind !== "answer" || dose.kind !== "answer") {
      throw new Error("Expected safety answers");
    }
    expect(urgent.source).toBe("safety");
    expect(dose.source).toBe("safety");
  });

  it.each([
    "I think I have DKA",
    "I suspect DKA",
    "Could I be in DKA?",
    "I may have diabetic ketoacidosis right now",
    "I have suspected DKA",
    "I think this is DKA",
    "This could be DKA",
    "Help, DKA",
    "I am showing signs of DKA",
    "My symptoms suggest DKA",
    "Could I be going into DKA?",
    "I don't know if I have DKA",
    "My doctor suspects DKA",
    "I think I have DKA after being ill yesterday",
  ])(
    "interrupts present DKA concern before any hosted or evidence route: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Get urgent diabetes advice now");
      expect(result.answer.answer).toContain("Don't wait for Tarv1s");
    },
  );

  it.each([
    "Ketones 3.1",
    "Ketones +++",
    "I have DKA",
    "My child may have DKA",
  ])(
    "returns a direct 999/A&E answer before any hosted route: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected safety answer");
      expect(result.source).toBe("safety");
      expect(result.answer.headline).toBe("Call 999 now or go to A&E");
    },
  );

  it("calls 999 directly for an immediately life-threatening symptom", () => {
    const result = plan("I cannot breathe");
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected safety answer");
    expect(result.source).toBe("safety");
    expect(result.answer.headline).toBe("Call 999 now");
  });

  it("sends pure education with no evidence ranges or personal history", () => {
    const result = coordinateTarvisRequest({
      question: "what does time in range actually mean?",
      asOf: NOW,
      conversationHistory: [
        { role: "user", text: "why was my glucose high yesterday?" },
        { role: "assistant", text: "Your recorded pattern was higher." },
      ],
    });
    expect(result).toMatchObject({ kind: "model-education", history: [] });
    expect(result).not.toHaveProperty("evidenceRanges");
  });

  it.each([
    "What are the NICE sick day rules?",
    "What are NICE rules when I am ill?",
    "Tell me the NICE sick-day rules for type 1 diabetes",
    "Tell me about sick-day rules",
    "Tell me the sickday rules",
    "What should I know about sick days?",
    "Why are ketones important during illness?",
    "What happens to glucose during illness?",
    "What should I know about vomiting and ketones when ill?",
    "What should I do if I get ill with type 1?",
    "What should I do if I am ill?",
    "What should I do when ill?",
    "How should I manage illness?",
    "How should I manage type 1 when unwell?",
    "What do I need to know when ill?",
    "Advice for when I am ill",
    "I'm ill, what should I do?",
    "I feel unwell, what should I do?",
    "I've got flu, what should I do?",
    "I'm poorly, what should I do?",
    "I'm ill today, what should I do?",
    "I have been unwell since yesterday, what should I do?",
    "I have flu, what should I do?",
    "I am sick, what should I do?",
    "What should someone with type 1 do when ill?",
  ])(
    "routes reviewed NICE guidance locally before evidence loading: %s",
    (question) => {
      const result = plan(question);
      expect(result).toMatchObject({ kind: "model-education", history: [] });
      expect(result).not.toHaveProperty("evidenceRanges");
    },
  );

  it.each([
    "What are the NICE sick-day rules for my child?",
    "What should a young person with type 1 know about sick days?",
    "My child is ill, what should I do?",
    "What should my 12-year-old do when ill?",
    "What does NICE say about exercise when my child is ill?",
  ])(
    "routes child sick-day questions to reviewed NG18 education: %s",
    (question) => {
      const result = plan(question);
      expect(result).toMatchObject({ kind: "model-education", history: [] });
      expect(result).not.toHaveProperty("evidenceRanges");
    },
  );

  it.each([
    "What does NICE say about exercise for children?",
    "Explain NICE physical activity guidance for a young person",
  ])(
    "fails unsupported child exercise guidance closed without adult NG17: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected local answer");
      expect(result.source).toBe("capability");
      expect(result.answer.answer).toMatch(/reviewed NICE guidance/i);
    },
  );

  it.each([
    "What are the NICE guidelines for depression?",
    "What NICE guidance applies to hypertension?",
    "Give me guidance on mortgages",
    "Why is my boiler making a nice noise?",
  ])("keeps unrelated guidance outside the Type 1 scope: %s", (question) => {
    const result = plan(question);
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected local answer");
    expect(result.source).toBe("scope");
  });

  it.each([
    "Can you explain exercise and glucose?",
    "Explain why exercise lowers glucose",
    "Why can exercise make glucose fall?",
    "Why does walking lower blood sugar?",
    "What does NICE say if I exercise when glucose is low?",
    "Does NICE say exercise can lower my glucose?",
    "I would like to know about exercise and glucose",
    "Tell me how exercise affects glucose",
    "Help me understand exercise and glucose",
    "Tell me how illness affects glucose",
  ])(
    "keeps conceptual exercise questions in reviewed education: %s",
    (question) => {
      expect(plan(question)).toMatchObject({ kind: "model-education" });
    },
  );

  it.each([
    "What does NICE say about time in range?",
    "What does NICE say about insulin pumps?",
    "What are the NICE glucose targets?",
    "What does NICE say about CGM?",
    "Explain the NICE guidance on carbohydrates",
  ])(
    "fails an unsupported NICE topic closed without a model route: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected local answer");
      expect(result.source).toBe("capability");
      expect(result.answer.answer).toMatch(/reviewed NICE guidance/i);
    },
  );

  it.each([
    "What does NICE say about exercise based on my data?",
    "Compare NICE exercise guidance with my records",
    "What do my exercise readings mean in light of NICE guidance?",
    "Does NICE guidance explain my exercise lows?",
  ])(
    "asks for an exact period before a mixed personal NICE review: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected local answer");
      expect(result.source).toBe("evidence-range");
      expect(result.answer.answer).toMatch(/exact period or dated event/i);
    },
  );

  it.each([
    "Compare my readings after exercise last week with NICE guidance",
    "What does NICE say about my low after exercise last Friday?",
  ])(
    "does not discard personal evidence for a mixed NICE question: %s",
    (question) => {
      expect(plan(question).kind).toBe("retrospective-event");
    },
  );

  it.each([
    "Why?",
    "Why is that?",
    "How so?",
    "Why does that matter?",
    "How does that work?",
    "Could you explain that?",
    "Please explain that",
    "Can you go deeper on that?",
    "What does NICE say?",
    "Can you tell me more about that?",
    "What guidance supports that?",
    "Where does that come from?",
    "Can you show me the source?",
    "What source is that based on?",
  ])(
    "keeps a reviewed-guidance follow-up in the education route: %s",
    (question) => {
      const history = [
        { role: "user" as const, text: "What are the NICE sick-day rules?" },
        { role: "assistant" as const, text: "Reviewed local guidance" },
      ];
      const result = coordinateTarvisRequest({
        question,
        asOf: NOW,
        conversationHistory: history,
      });
      expect(result.kind).toBe("model-education");
    },
  );

  it("shares only the immediately preceding exchange for an explicit dependent education follow-up", () => {
    const history = [
      { role: "user" as const, text: "old personal question" },
      { role: "assistant" as const, text: "old personal answer" },
      { role: "user" as const, text: "what does time in range mean?" },
      { role: "assistant" as const, text: "general explanation" },
    ];
    const result = coordinateTarvisRequest({
      question: "explain that",
      asOf: NOW,
      conversationHistory: history,
    });
    expect(result.kind).toBe("model-education");
    if (result.kind !== "model-education")
      throw new Error("Expected education");
    expect(result.history).toEqual(history.slice(-2));
  });

  it("loads the exact requested range for evidence synthesis", () => {
    const result = plan("why was my glucose higher last week?");
    expect(result.kind).toBe("model-evidence");
    if (result.kind !== "model-evidence") throw new Error("Expected evidence");
    expect(result.evidenceRanges).toBeDefined();
    expect(result.evidenceRanges?.current.start).toBe(
      Date.parse("2026-08-03T00:00:00+01:00"),
    );
    expect(result.evidenceRanges?.current.end).toBe(
      Date.parse("2026-08-10T00:00:00+01:00"),
    );
  });

  it("fails closed instead of substituting the displayed report for an unsupported comparison", () => {
    const result = plan(
      "why were my sugars higher in the last 5 days compared with 2 weeks ago?",
    );
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected local answer");
    expect(result.source).toBe("evidence-range");
    expect(result.answer.answer).toContain(
      "won\u2019t substitute the report currently shown",
    );
    expect(result.answer.limitations[0]).toMatch(/no OpenAI request/i);
  });

  it("keeps insulin-only personal questions available to the local engine", () => {
    expect(plan("how much insulin yesterday?").kind).toBe(
      "scoped-personal-data",
    );
  });

  it("routes ordinary past-tense retrospective language without requiring a special phrasing", () => {
    const result = plan(
      "Why did my glucose go low when I walked to the pub after dinner on Friday night?",
    );

    expect(result.kind).toBe("retrospective-event");
    if (result.kind !== "retrospective-event") {
      throw new Error("Expected retrospective event review");
    }
    expect(result.range).toEqual({
      start: Date.parse("2026-08-07T00:00:00+01:00"),
      end: Date.parse("2026-08-08T06:00:00+01:00"),
    });
  });

  it.each([
    "How did walking after dinner affect my glucose on Friday night?",
    "How did my walk affect my blood sugar yesterday?",
    "Did my walk cause the low yesterday?",
    "Could my walk have caused the low yesterday?",
    "Was my low related to my walk yesterday?",
    "Why was I low after my walk?",
    "What made me hypo on my walk?",
    "Can you look into the low I had walking home?",
    "Explain the low after my walk",
    "Why did I drop during exercise?",
    "Why did my sugars fall on that hike?",
    "Did walking make me low?",
    "Was my hypo because I exercised?",
    "I got low at the gym, any idea why?",
    "Did the hike trigger my hypo?",
    "Why was my blood glucose down after football?",
    "Could my run have caused the drop?",
    "Was exercise responsible for my low?",
  ])(
    "routes a personal activity incident to retrospective review: %s",
    (question) => {
      expect(plan(question).kind).toBe("retrospective-event");
    },
  );

  it.each([
    {
      question:
        "Why did my glucose go low during exercise in the last 14 days?",
      start: "2026-07-31T00:00:00+01:00",
    },
    {
      question:
        "Compare my readings after exercise over the last 30 days with NICE guidance",
      start: "2026-07-15T00:00:00+01:00",
    },
  ])(
    "keeps the requested retrospective period: $question",
    ({ question, start }) => {
      const result = plan(question);
      expect(result.kind).toBe("retrospective-event");
      if (result.kind !== "retrospective-event") {
        throw new Error("Expected retrospective event review");
      }
      expect(result.range).toEqual({ start: Date.parse(start), end: NOW });
    },
  );

  it.each([
    "Why did my glucose go low during exercise over the last 5 days?",
    "Review my glucose after exercise over the last 10 days",
    "Compare my readings after exercise over the last 60 days with NICE guidance",
  ])("fails an unsupported retrospective period closed: %s", (question) => {
    const result = plan(question);
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") throw new Error("Expected local answer");
    expect(result.source).toBe("evidence-range");
    expect(result.answer.answer).toMatch(/not supported exactly/i);
  });

  it.each([
    "Why did my glucose go low during exercise on 30 August 2026?",
    "Why did my glucose go low during exercise tomorrow?",
    "Why did my glucose go low during exercise next Friday?",
    "Why did my glucose go low during exercise last weekend?",
    "Why did my glucose go low during exercise last year?",
    "Why did my glucose go low during exercise in June?",
    "Why did my glucose go low during exercise the other day?",
  ])(
    "fails a future or unresolved retrospective time closed: %s",
    (question) => {
      const result = plan(question);
      expect(result.kind).toBe("answer");
      if (result.kind !== "answer") throw new Error("Expected local answer");
      expect(result.source).toBe("evidence-range");
    },
  );

  it.each([
    "Compare NICE exercise guidance with my records from last week",
    "What does NICE say about my exercise data over the last 14 days?",
  ])(
    "uses an exact period for a mixed personal NICE review: %s",
    (question) => {
      expect(plan(question).kind).toBe("retrospective-event");
    },
  );
});
