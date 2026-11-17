import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { classifyTarvisSafety } from "@/data/tarvis/safety";
import {
  TARVIS_SHORT_LIST_VISIBLE,
  buildTarvisDirectShortAnswer,
  buildTarvisShortAnswer,
  tarvisAnswerSourceLine,
  tarvisShortPeriod,
  type TarvisShortAnswer,
} from "@/data/tarvis/shortAnswer";
import type { TarvisEvidenceLineData } from "@/data/tarvis/evidenceLine";
import type { TarvisAnswer, TarvisDirectAnswerPresentation } from "@/data/tarvis/types";

// Synthetic values only.
const settings = { locale: "en-GB", timeZone: "Europe/London", glucoseUnit: "mmolL" as const };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const asOf = Date.UTC(2026, 10, 12, 14, 30);
const midnightToday = Date.UTC(2026, 10, 12);
const local = { answerSource: "local" as const, modelRequestSent: false };

function answer(changes: Partial<TarvisAnswer>): TarvisAnswer {
  return {
    headline: "Answer",
    answer: "",
    confidence: "high",
    evidenceIds: ["e1"],
    limitations: [],
    ...changes,
  };
}

function line(coveragePercent: number | null, start = midnightToday - 6 * DAY, records = 1800): TarvisEvidenceLineData {
  return {
    version: 1,
    windows: [{ start, end: asOf, records, coveragePercent }],
    range: { lowerMmolL: 3.9, upperMmolL: 10 },
  };
}

describe("short answer first", () => {
  it("leads time in range with the number, the period and compact coverage", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({
        headline: "Observed time in range: 82.0%",
        answer: "Between the dates, 82.0% of readings were in 3.9–10.0 mmol/L. Below range 3.0%, above range 15.0%.",
      }),
      evidenceLine: line(88),
      asOf,
      settings,
    });
    expect(model.label).toBe("Time in range, last 7 days");
    expect(model.value).toEqual({ text: "82", unit: "%", tone: "target" });
    expect(model.context).toBe("3.9–10.0 mmol/L · sensor worn 88% of the time");
    expect(model.meaning).toBeUndefined();
    // The full worked answer and exact period move under Details, not away.
    expect(model.detailText.join(" ")).toContain("Below range 3.0%");
    expect(model.exactPeriod).toBeTruthy();
    expect(model.source).toBe("Worked out on this phone · nothing sent");
  });

  it("adds a line only when low coverage changes the meaning", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({ headline: "Observed time in range: 64.5%", answer: "Synthetic." }),
      evidenceLine: line(41),
      asOf,
      settings,
    });
    expect(model.value?.text).toBe("64.5");
    expect(model.value?.tone).toBe("neutral");
    expect(model.context).toContain("sensor worn 41% of the time");
    expect(model.meaning).toBe("Sensor worn only 41% of the time, so this may not reflect the whole period.");
  });

  it("says plainly when a period has no glucose readings", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({ headline: "Average glucose", answer: "No readings were stored." }),
      evidenceLine: line(null, midnightToday - 6 * DAY, 0),
      asOf,
      settings,
    });
    expect(model.meaning).toBe("No glucose readings are stored for this period.");
    expect(model.context).toContain("0 glucose readings");
  });

  it("colours glucose values by the user's glucose colours", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({ headline: "Your average glucose: 7.4 mmol/L", answer: "Synthetic." }),
      evidenceLine: line(93, midnightToday),
      asOf,
      settings,
    });
    expect(model.label).toBe("Average glucose, today so far");
    expect(model.value).toEqual({ text: "7.4", unit: "mmol/L", tone: "glucose", mmolL: 7.4 });
  });

  it("names rolling whole-day windows and falls back to exact dates", () => {
    expect(tarvisShortPeriod({ start: asOf - 14 * DAY, end: asOf }, asOf, settings)).toBe("last 14 days");
    expect(tarvisShortPeriod({ start: asOf - DAY, end: asOf }, asOf, settings)).toBe("last 24 hours");
    expect(tarvisShortPeriod({ start: midnightToday - DAY, end: midnightToday }, asOf, settings)).not.toMatch(/last|today/);
  });

  it("shows a dose refusal whole and never collapses it", () => {
    const result = classifyTarvisSafety("How much insulin should I bolus for 40 g of carbs right now?");
    expect(result.kind).not.toBe("allow");
    if (result.kind === "allow") throw new Error("Dose question was allowed");
    const model = buildTarvisShortAnswer({ ...local, answer: result.answer, asOf, settings });
    expect(model.safety).toBe(result.answer.answer);
    expect(model.value).toBeUndefined();
    expect(model.detailText).toEqual([]);
    expect(model.listItems).toEqual([]);
  });

  it("keeps a clarifying question whole", () => {
    const text = "Do you mean the last 7 days or the last 14 days? I can work out either on this phone.";
    const model = buildTarvisShortAnswer({ ...local, answer: answer({ headline: "Which period?", answer: text, evidenceIds: [] }), asOf, settings });
    expect(model.headline).toBe(text);
    expect(model.detailText).toEqual([]);
  });

  it("turns bullet answers into a list the card cuts after three", () => {
    const text = ["Four stored changes:", "• Change A", "• Change B", "• Change C", "• Change D", "• Change E"].join("\n");
    const model = buildTarvisShortAnswer({ ...local, answer: answer({ headline: "Profile changes", answer: text }), asOf, settings });
    expect(model.headline).toBe("Four stored changes:");
    expect(model.listItems).toHaveLength(5);
    expect(TARVIS_SHORT_LIST_VISIBLE).toBe(3);
  });

  it("turns one-record-per-line answers into a list", () => {
    const text = "Site change: Monday 09:10\nSite change: Thursday 08:40";
    const model = buildTarvisShortAnswer({ ...local, answer: answer({ headline: "Last site changes", answer: text }), asOf, settings });
    expect(model.headline).toBeUndefined();
    expect(model.listItems).toEqual(["Site change: Monday 09:10", "Site change: Thursday 08:40"]);
  });

  it("keeps the first sentence up front and the rest under Details", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({ headline: "Overnight", answer: "Glucose stayed mostly level overnight. A rise started near 04:00. It eased by 07:00." }),
      evidenceLine: line(90, midnightToday),
      asOf,
      settings,
    });
    expect(model.headline).toBe("Glucose stayed mostly level overnight.");
    expect(model.detailText).toEqual(["A rise started near 04:00. It eased by 07:00."]);
    expect(model.context).toBe("today so far · 3.9–10.0 mmol/L · sensor worn 90% of the time");
  });

  it("marks general explanations as using no personal records", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({ headline: "What time in range means", answer: "Time in range is the share of readings in a range.", responseKind: "general-education", evidenceIds: [] }),
      asOf,
      settings,
    });
    expect(model.context).toBe("General explanation · no personal records used");
  });

  it("says what left the phone", () => {
    expect(tarvisAnswerSourceLine({ answerSource: "hosted", modelRequestSent: true })).toBe(
      "Written by your AI connection · your question and the selected records were sent",
    );
    expect(tarvisAnswerSourceLine({ answerSource: "local", modelRequestSent: true })).toContain("Worked out on this phone");
    expect(tarvisAnswerSourceLine({ answerSource: "local", modelRequestSent: false })).toBe("Worked out on this phone · nothing sent");
  });
});

describe("AI answers use the same structure", () => {
  const presentation: TarvisDirectAnswerPresentation = {
    version: 1,
    kind: "fact",
    headline: "Most readings were in range",
    summary: "Most readings were in range this week. Afternoons were higher.",
    confidence: "moderate",
    primaryMetric: { label: "Time in range", value: "79.0", unit: "%" },
    keyFindings: [{ title: "Afternoons", detail: "Higher than mornings" }],
    interpretation: "This is an observation, not a cause.",
    evidence: [],
    limitations: ["Synthetic limitation."],
    followUpQuestions: [],
    safetyNotice: null,
  };

  it("leads with the metric and keeps the summary under Details", () => {
    const model = buildTarvisDirectShortAnswer({
      presentation,
      evidenceLine: line(88),
      asOf,
      settings,
      answerSource: "hosted",
      modelRequestSent: true,
    });
    expect(model.label).toBe("Time in range, last 7 days");
    expect(model.value?.text).toBe("79.0");
    expect(model.context).toBe("3.9–10.0 mmol/L · sensor worn 88% of the time");
    expect(model.listItems).toEqual(["Afternoons: Higher than mornings"]);
    expect(model.detailText).toContain(presentation.summary);
    expect(model.source).toContain("Written by your AI connection");
  });

  it("never hides a safety notice", () => {
    const model = buildTarvisDirectShortAnswer({
      presentation: { ...presentation, safetyNotice: "If you feel unwell, follow your care team's plan or call 999." },
      asOf,
      settings,
      ...local,
    });
    expect(model.safety).toBe("If you feel unwell, follow your care team's plan or call 999.");
  });

  it("uses the first summary sentence when there is no single number", () => {
    const model = buildTarvisDirectShortAnswer({ presentation: { ...presentation, primaryMetric: null }, asOf, settings, ...local });
    expect(model.label).toBe(presentation.headline);
    expect(model.headline).toBe("Most readings were in range this week.");
    expect(model.detailText[0]).toBe("Afternoons were higher.");
  });
});

describe("short answer card", () => {
  const source = readFileSync("src/components/tarvis/TarvisShortAnswerCard.tsx", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;

  function render(model: TarvisShortAnswer, open: boolean) {
    const scope = {
      exports: {},
      React: { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props, children }) },
      require: (name: string) => {
        if (name === "@expo/vector-icons/Ionicons") return { default: "Icon" };
        if (name === "react") return { useState: () => [open, () => undefined] };
        if (name === "react-native") return { Pressable: "Pressable", StyleSheet: { create: (s: object) => s, hairlineWidth: 1 }, Text: "Text", View: "View" };
        if (name === "@/data/tarvis/shortAnswer") return { TARVIS_SHORT_LIST_VISIBLE: 3 };
        if (name === "@/domain/glucoseAppearance") return { glucoseTone: () => "#0a0" };
        if (name === "@/providers/GlucoseAppearanceProvider") return { useGlucoseAppearance: () => ({ settings: { targetMin: 3.9, targetMax: 10 } }) };
        if (name === "@/theme/theme") return { useAppTheme: () => ({ colors: {}, radius: {}, dark: false }) };
        throw new Error(`Unexpected import: ${name}`);
      },
    };
    runInNewContext(compiled, scope);
    const tree = (scope.exports as { TarvisShortAnswerCard(props: object): unknown }).TarvisShortAnswerCard({
      model,
      details: { type: "Marker", props: { id: "evidence" }, children: [] },
      footer: { type: "Marker", props: { id: "footer" }, children: [] },
    });
    return JSON.stringify(tree);
  }

  const model: TarvisShortAnswer = {
    label: "Time in range, last 7 days",
    value: { text: "82", unit: "%", tone: "target" },
    context: "3.9–10.0 mmol/L · sensor worn 88% of the time",
    listItems: ["One", "Two", "Three", "Four"],
    detailText: ["Worked answer text."],
    exactPeriod: "Exact period text",
    source: "Worked out on this phone · nothing sent",
    limitations: ["A synthetic note."],
  };

  it("shows the answer and coverage with Details collapsed", () => {
    const text = render(model, false);
    expect(text).toContain("Time in range, last 7 days");
    expect(text).toContain('"82"');
    expect(text).toContain("sensor worn 88% of the time");
    expect(text).toContain('"accessibilityLabel":"Details"');
    expect(text).toContain("Show all 4");
    expect(text).not.toContain("Four");
    expect(text).not.toContain("Worked answer text.");
    expect(text).not.toContain("Worth keeping in mind");
    expect(text).not.toContain('"id":"evidence"');
    expect(text).toContain('"id":"footer"');
  });

  it("opens Details with the period, calculation source and notes", () => {
    const text = render(model, true);
    expect(text).toContain("Exact period text");
    expect(text).toContain("Worked answer text.");
    expect(text).toContain("Worth keeping in mind");
    expect(text).toContain("Worked out on this phone · nothing sent");
    expect(text).toContain('"id":"evidence"');
  });

  it("shows safety text in full outside Details", () => {
    const text = render({ label: "I can't help with dose amounts", safety: "Synthetic refusal text.", listItems: [], detailText: [], source: "s", limitations: [] }, false);
    expect(text).toContain("Synthetic refusal text.");
  });
});

describe("screen and footer wiring", () => {
  const screen = readFileSync("src/screens/TarvisScreen.tsx", "utf8");

  it("renders every answer through the short answer card and keeps the orb", () => {
    expect(screen).toContain("<TarvisShortAnswerCard");
    expect(screen).toContain("buildTarvisDirectShortAnswer({");
    expect(screen).toContain("buildTarvisShortAnswer({");
    expect(screen).toContain("TarvisOrb");
    expect(screen).not.toContain("TarvisDirectAnswerContent");
  });

  it("uses small labelled icon buttons in the card footer", () => {
    const save = readFileSync("src/components/SaveToNotebookButton.tsx", "utf8");
    const report = readFileSync("src/components/TarvisReportButton.tsx", "utf8");
    expect(save).toContain("accessibilityLabel={label}");
    expect(save).toContain("minWidth: 44");
    expect(save).toContain("minHeight: 44");
    expect(report).toContain('accessibilityLabel="Report response"');
    expect(report).toContain("minWidth: 44");
    expect(report).toContain("minHeight: 44");
  });
});
