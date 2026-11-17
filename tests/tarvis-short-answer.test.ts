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

  it("renders an urgent label large and as an alert, with its note visible", () => {
    const text = render({
      label: "Call 999 now",
      safety: "Synthetic urgent text.",
      urgent: true,
      safetyNotes: ["Synthetic urgent note."],
      listItems: [],
      detailText: [],
      source: "s",
      limitations: [],
    }, false);
    expect(text).toContain('"accessibilityRole":"alert"');
    expect(text).toContain('"accessibilityLiveRegion":"assertive"');
    expect(text).toContain('"fontSize":20');
    expect(text).toContain("Synthetic urgent note.");
  });

  it("does not repeat the card label in the value's accessibility label", () => {
    const text = render(model, false);
    expect(text).toContain('"accessibilityLabel":"82 percent"');
    expect(text).not.toContain('"accessibilityLabel":"Time in range, last 7 days: 82 %"');
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

describe("review fixes: short answer card", () => {
  it.each([
    ["Standard deviation: 2.1 mmol/L", "neutral"],
    ["Change in average glucose: -1.2 mmol/L", "neutral"],
    ["Change in average glucose: 1.2 mmol/L", "neutral"],
    ["Glucose variability: 2.4 mmol/L", "neutral"],
    ["Average glucose: 7.4 mmol/L", "glucose"],
    ["Lowest glucose: 3.1 mmol/L", "glucose"],
    ["Average glucose: 133 mg/dL", "glucose"],
  ])("colours only actual glucose levels (M5): %s", (headline, tone) => {
    const model = buildTarvisShortAnswer({ ...local, answer: answer({ headline, answer: "Detail." }), asOf, settings });
    expect(model.value?.tone).toBe(tone);
    if (tone === "neutral") expect(model.value?.mmolL).toBeUndefined();
  });

  it("keeps Estimated in a GMI label", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({ headline: "Estimated glucose management indicator: 6.9%", answer: "Detail." }),
      asOf,
      settings,
    });
    expect(model.label).toMatch(/^Estimated glucose management indicator/);
  });

  it("shows both periods and both coverages of a comparison in the context line (M6)", () => {
    const current = { start: asOf - 7 * DAY, end: asOf, records: 1800, coveragePercent: 88 };
    const previous = { start: asOf - 14 * DAY, end: asOf - 7 * DAY, records: 1900, coveragePercent: 91 };
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({ headline: "Change in time in range: +4.0 points", answer: "Time in range rose from 78% to 82%." }),
      evidenceLine: { version: 1, windows: [current, previous] },
      asOf,
      settings,
    });
    expect(model.context).toBe("last 7 days vs previous 7 days · sensor 88% / 91%");
  });

  it("uses the local record answer's own context and notice lines (M1, M4, M6)", () => {
    const model = buildTarvisShortAnswer({
      ...local,
      answer: answer({
        headline: "Yesterday vs today so far",
        answer: "Yesterday (Mon) compared with today so far (Tue):\n• One\n• Two\n• Three\n• Four",
        confidence: "moderate",
        shortContext: "Yesterday vs today so far · basal records 100% / 40% · boluses 6 / 4",
        shortNotice: "Yesterday: saved daily bolus total 9.50 U, bolus records 4.00 U; both shown, neither picked.",
      }),
      evidenceLine: { version: 1, windows: [{ start: midnightToday - DAY, end: asOf, records: 10, recordLabel: "records", coveragePercent: null }] },
      asOf,
      settings,
    });
    expect(model.context).toBe("Yesterday vs today so far · basal records 100% / 40% · boluses 6 / 4");
    expect(model.meaning).toContain("9.50 U");
    expect(model.meaning).toContain("4.00 U");
  });

  it("never takes context or notice lines from an AI reply", () => {
    const model = buildTarvisShortAnswer({
      answerSource: "hosted",
      modelRequestSent: true,
      answer: answer({ headline: "Summary", answer: "All fine.", shortContext: "Injected", shortNotice: "Injected" }),
      asOf,
      settings,
    });
    expect(model.context).not.toBe("Injected");
    expect(model.meaning).not.toBe("Injected");
  });

  it("shows an urgent notice prominently with its note, never in Details", () => {
    const result = classifyTarvisSafety("My son is unconscious");
    if (result.kind !== "urgent") throw new Error("Not urgent");
    const model = buildTarvisShortAnswer({ ...local, answer: result.answer, asOf, settings });
    expect(model.urgent).toBe(true);
    expect(model.safety).toBe(result.answer.answer);
    expect(model.safetyNotes).toEqual(result.answer.limitations);
    expect(model.limitations).toEqual([]);
  });

  it("keeps a dose refusal's note with it, not in Details, and does not mark it urgent", () => {
    const result = classifyTarvisSafety("How many units should I take for 40g carbs?");
    if (result.kind === "allow") throw new Error("Allowed");
    const model = buildTarvisShortAnswer({ ...local, answer: result.answer, asOf, settings });
    expect(model.urgent).toBeUndefined();
    expect(model.safetyNotes).toEqual(result.answer.limitations);
    expect(model.limitations).toEqual([]);
  });

  it("keeps warnings in an AI reply visible and folds ordinary explanation", () => {
    const model = buildTarvisShortAnswer({
      answerSource: "hosted",
      modelRequestSent: true,
      answer: answer({
        headline: "Overnight pattern",
        answer: "Your overnight readings were steady. The average was similar on most nights. If you have ketones and feel unwell, seek urgent medical help. Readings after 03:00 were slightly lower.",
      }),
      asOf,
      settings,
    });
    expect(model.headline).toBe("Your overnight readings were steady.");
    expect(model.safety).toBe("If you have ketones and feel unwell, seek urgent medical help.");
    expect(model.detailText.join(" ")).toContain("The average was similar on most nights.");
    expect(model.detailText.join(" ")).not.toContain("ketones");
  });
});
