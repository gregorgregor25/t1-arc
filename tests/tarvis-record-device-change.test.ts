import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { containsTreatmentDirective } from "@/data/tarvis/guardrails";
import { buildDeviceChangeAnswer, recordQuestionRange } from "@/data/tarvis/recordAnswers";
import { parseRecordQuestion } from "@/data/tarvis/recordQuestions";
import { coordinateTarvisRequest } from "@/data/tarvis/requestCoordinator";
import type { ContextNoteEvent, HealthContextEvent, TimelineData } from "@/domain/models";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// A synthetic afternoon after the UK clocks went back (last Sunday of October).
const NOW = Date.parse("2030-10-29T15:00:00Z");

function note(id: string, start: number, title: string, category: ContextNoteEvent["category"], extra: Partial<ContextNoteEvent> = {}): ContextNoteEvent {
  return { id, kind: "note", start, title, category, sourceId: "nightscout", origin: "imported", ...extra };
}

function timeline(context: HealthContextEvent[]): Pick<TimelineData, "context" | "range"> {
  return { context, range: { start: NOW - 30 * DAY, end: NOW } };
}

describe("device change questions", () => {
  it.each([
    ["When did I last change my site?", ["site"]],
    ["When was my last pod change?", ["site"]],
    ["How old is my sensor?", undefined],
    ["How long ago did I change my sensor?", ["sensor"]],
    ["When did I last change my site, sensor and insulin cartridge?", ["site", "sensor", "insulin"]],
    ["When did I last change my insulin?", ["insulin"]],
    ["When did I last change my set?", ["site"]],
    ["When did I put a new set in?", ["site"]],
    ["How long since I changed my infusion set?", ["site"]],
    ["When did I start my new sensor?", ["sensor"]],
    // Review regressions.
    ["When was my last set change?", ["site"]],
    ["When was the last set change?", ["site"]],
    ["When did I change set?", ["site"]],
    ["When did I last change my sensor? My readings look off", ["sensor"]],
  ])("parses %s", (question, changes) => {
    const parsed = parseRecordQuestion(question);
    expect(parsed?.kind === "device-change" ? parsed.changes : undefined).toEqual(changes);
  });

  it.each([
    "When should I change my site?",
    "Is my sensor due for a change?",
    "When did I last eat?",
    "When did I last set a temp target?",
    "How often should I change my pod?",
    // Near misses: a change used as an anchor for another question.
    "When was my last low after I changed my sensor?",
    "average glucose since my last sensor change",
    "When did AAPS last set a new temp basal?",
    "When did AAPS last start a new temp basal?",
    "When did I last set a new temp target?",
    "What was my time in range since I changed my site?",
    "How many highs since my last pod change?",
    "When did I last change my profile?",
  ])("leaves %s to the existing pipeline", (question) => {
    expect(parseRecordQuestion(question)).toBeUndefined();
  });

  it("routes to the local record answer after safety", () => {
    const plan = coordinateTarvisRequest({ question: "When did I last change my site?", asOf: NOW });
    expect(plan.kind).toBe("record-question");
    expect(coordinateTarvisRequest({ question: "When did I last change my site and how much should I bolus now?", asOf: NOW }).kind).toBe("answer");
  });
});

describe("device change answers", () => {
  it("gives the newest record of each kind with time, source and elapsed age", () => {
    const context = [
      note("site-old", NOW - 6 * DAY, "Site Change", "pump"),
      // Changed at the same minute as the insulin.
      note("site-new", NOW - 2 * DAY - 3 * HOUR, "Site Change", "pump"),
      note("insulin-new", NOW - 2 * DAY - 3 * HOUR, "Insulin Change", "pump"),
      note("sensor-new", NOW - 5 * DAY - 1 * HOUR, "Sensor Start", "sensor"),
      // A future timestamp is ignored.
      note("site-future", NOW + HOUR, "Site Change", "pump"),
    ];
    const { answer, evidence } = buildDeviceChangeAnswer({
      question: { kind: "device-change", changes: ["site", "sensor", "insulin"] },
      timeline: timeline(context),
      asOf: NOW,
    });
    expect(answer.headline).toBe("Last recorded changes");
    const lines = answer.answer.split("\n");
    expect(lines[0]).toMatch(/^Site change: last recorded .*, from Nightscout\. That was 2 days 3 hours ago\.$/);
    // Elapsed across the clock change: 5 days 1 hour of real time.
    expect(lines[1]).toMatch(/That was 5 days 1 hour ago\.$/);
    expect(lines[2]).toMatch(/^Cartridge or reservoir change: last recorded .*That was 2 days 3 hours ago\.$/);
    expect(evidence[0]!.recordIds).toEqual(["site-new", "sensor-new", "insulin-new"]);
    expect(containsTreatmentDirective(answer.answer)).toBe(false);
  });

  it("prefers a newer manual entry and labels it as the user's", () => {
    const context = [
      note("site-imported", NOW - 3 * DAY, "Site Change", "pump"),
      note("site-manual", NOW - 20 * HOUR, "Site change", "pump", {
        origin: "manual",
        sourceId: "t1arc-manual",
        observation: { kind: "site-change", device: "pump" } as ContextNoteEvent["observation"],
      }),
    ];
    const { answer } = buildDeviceChangeAnswer({
      question: { kind: "device-change", changes: ["site"] },
      timeline: timeline(context),
      asOf: NOW,
    });
    expect(answer.headline).toBe("Last site change");
    expect(answer.answer).toContain("recorded by you in T1 Arc. That was 20 hours ago.");
  });

  it("says no record is stored for the last 30 days, never a guessed age", () => {
    const { answer, evidence } = buildDeviceChangeAnswer({
      question: { kind: "device-change", changes: ["sensor"] },
      timeline: timeline([note("sensor-ancient", NOW - 40 * DAY, "Sensor Change", "sensor")]),
      asOf: NOW,
    });
    expect(answer.answer).toBe("Sensor change: no sensor change record is stored for the last 30 days.");
    expect(evidence).toEqual([]);
    expect(answer.confidence).toBe("limited");
  });

  it("reads the last 30 days", () => {
    expect(recordQuestionRange({ kind: "device-change", changes: ["site"] }, NOW)).toEqual({ start: NOW - 30 * DAY, end: NOW });
  });

  it("is answered locally in the Tarv1s screen with no provider request", () => {
    const screen = readFileSync("src/screens/TarvisScreen.tsx", "utf8");
    const block = screen.slice(screen.indexOf('if (plan.kind === "record-question")'), screen.indexOf('if (plan.kind === "therapy-state")'));
    expect(block).toContain("buildDeviceChangeAnswer(");
    expect(block).toContain('answerSource: "local"');
    expect(block).toContain("modelRequestSent: false");
    expect(block).toContain('modelSharing: "local-only"');
  });
});
