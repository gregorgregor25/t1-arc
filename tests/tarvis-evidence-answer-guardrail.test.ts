import { afterEach, describe, expect, it } from "vitest";

import {
  parseTarvisEvidenceSelectionResult,
  tarvisEvidenceFindingOptions,
} from "@/data/tarvis/evidenceAnswerGuardrail";
import type {
  TarvisEvidencePacket,
  TarvisInsightWindowSummary,
} from "@/data/tarvis/types";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

function summary(
  overrides: Partial<TarvisInsightWindowSummary> = {},
): TarvisInsightWindowSummary {
  return {
    glucoseAverage: 7.4,
    glucoseStandardDeviation: 2.1,
    glucoseCvPercent: 28.4,
    timeInRangePercent: 72.3,
    timeAbovePercent: 24.5,
    timeBelowPercent: 3.2,
    coveragePercent: 96.8,
    glucoseReadings: 8_212,
    highGlucoseRuns: 18,
    lowGlucoseRuns: 4,
    insulinUnits: null,
    mealCarbsPerDay: null,
    lateMeals: 0,
    sleepMinutesPerNight: null,
    activityMinutes: null,
    ...overrides,
  };
}

function packet(): TarvisEvidencePacket {
  const currentRange = { start: 100, end: 200 };
  const previousRange = { start: 0, end: 100 };
  return {
    schemaVersion: 1,
    timezone: "Europe/London",
    units: { glucose: "mmol/L", weight: "kg", distance: "km" },
    generatedAt: 200,
    comparison: {
      currentRange,
      previousRange,
      headline: "Your recent glucose comparison",
      summary: "The recent and previous periods were compared locally.",
      current: summary(),
      previous: summary({ glucoseAverage: 7.8 }),
    },
    findings: [
      {
        id: "glucose-pattern",
        kind: "change",
        category: "glucose",
        title: "Glucose was steadier",
        summary: "Recorded glucose variability was lower in the recent period.",
        caveat: "This is an association in the available records.",
        evidenceIds: ["current-glucose", "previous-glucose"],
      },
      {
        id: "activity-pattern",
        kind: "context",
        category: "activity",
        title: "More activity was recorded",
        summary: "The recent period contained more recorded activity.",
        evidenceIds: ["activity"],
      },
    ],
    evidence: [
      {
        id: "current-glucose",
        label: "Recent glucose",
        description: "Recent readings",
        range: currentRange,
        recordCount: 100,
        examples: [],
      },
      {
        id: "previous-glucose",
        label: "Previous glucose",
        description: "Previous readings",
        range: previousRange,
        recordCount: 100,
        examples: [],
      },
      {
        id: "activity",
        label: "Activity",
        description: "Recorded activity",
        range: currentRange,
        recordCount: 3,
        examples: [],
      },
    ],
  };
}

describe("Tarv1s personal evidence selection guardrail", () => {
  it("exposes a closed menu and renders accepted selections from local copy", () => {
    const source = packet();
    expect(tarvisEvidenceFindingOptions(source)).toEqual(
      source.findings.map(({ id, title, summary, caveat, evidenceIds }) => ({
        id,
        title,
        summary,
        ...(caveat ? { caveat } : {}),
        evidenceIds,
      })),
    );

    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({ findingIds: ["activity-pattern", "glucose-pattern"] }),
      source,
    );

    expect(result.acceptedHostedSelection).toBe(true);
    expect(result.answer.answer).toContain("more recorded activity");
    expect(result.answer.answer).toContain("variability was lower");
    expect(result.answer.evidenceIds).toEqual([
      "activity",
      "current-glucose",
      "previous-glucose",
    ]);
    expect(result.answer.confidence).toBe("moderate");
  });

  it.each([
    "Take insulin now.",
    "Inject insulin now.",
    "Use 3 units of insulin now.",
    "Reduce your basal by 20%.",
    "Have 15 grams of carbohydrate now.",
    "The walk led to your low.",
    "This is DKA.",
  ])("never displays arbitrary hosted personal prose: %s", (unsafeProse) => {
    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({
        findingIds: ["glucose-pattern"],
        answer: unsafeProse,
      }),
      packet(),
    );

    expect(result.acceptedHostedSelection).toBe(false);
    expect(result.answer.answer).not.toContain(unsafeProse);
    expect(result.answer.answer).toContain("compared locally");
  });

  it.each([
    "not-json",
    JSON.stringify([]),
    JSON.stringify({ findingIds: ["unknown"] }),
    JSON.stringify({ findingIds: ["glucose-pattern", "glucose-pattern"] }),
    JSON.stringify({ findingIds: ["a", "b", "c", "d", "e"] }),
  ])("fails a malformed or unapproved selection closed: %s", (value) => {
    const result = parseTarvisEvidenceSelectionResult(value, packet());
    expect(result.acceptedHostedSelection).toBe(false);
    expect(result.answer.answer).toContain("compared locally");
    expect(result.answer.evidenceIds.length).toBeLessThanOrEqual(5);
  });

  it("accepts abstention while keeping the answer completely local", () => {
    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({ findingIds: [] }),
      packet(),
    );
    expect(result.acceptedHostedSelection).toBe(true);
    expect(result.answer.answer).toContain("compared locally");
  });

  it("locally enforces a required finding when hosted ranking omits it", () => {
    const source = packet();
    source.requiredFindingIds = ["activity-pattern"];
    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({ findingIds: ["glucose-pattern"] }),
      source,
    );
    expect(result.acceptedHostedSelection).toBe(true);
    expect(result.answer.answer).toContain("variability was lower");
    expect(result.answer.answer).toContain("more recorded activity");

    const invalid = parseTarvisEvidenceSelectionResult("not-json", source);
    expect(invalid.answer.answer).toContain("more recorded activity");
  });

  it.each([
    ["unknown", ["unknown"]],
    ["duplicate", ["activity-pattern", "activity-pattern"]],
  ])("fails closed for %s required-finding metadata", (_name, required) => {
    const source = packet();
    source.requiredFindingIds = required;
    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({ findingIds: ["glucose-pattern"] }),
      source,
    );
    expect(result.acceptedHostedSelection).toBe(false);
    expect(result.answer.answer).toContain("compared locally");
  });

  it("rejects a selection whose combined provenance exceeds five references", () => {
    const source = packet();
    source.findings = [
      {
        ...source.findings[0]!,
        evidenceIds: ["a", "b", "c"],
      },
      {
        ...source.findings[1]!,
        evidenceIds: ["d", "e", "f"],
      },
    ];
    source.evidence = ["a", "b", "c", "d", "e", "f"].map((id) => ({
      id,
      label: id,
      description: id,
      range: source.comparison.currentRange,
      recordCount: 1,
      examples: [],
    }));

    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({
        findingIds: ["glucose-pattern", "activity-pattern"],
      }),
      source,
    );
    expect(result.acceptedHostedSelection).toBe(false);
    expect(result.answer.evidenceIds.length).toBeLessThanOrEqual(5);
  });

  it("limits confidence when a comparison window has sparse coverage", () => {
    const source = packet();
    source.comparison.current = summary({ coveragePercent: 42 });
    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({ findingIds: ["glucose-pattern"] }),
      source,
    );
    expect(result.answer.confidence).toBe("limited");
    expect(result.answer.limitations.join(" ")).toContain(
      "42% sensor coverage",
    );
  });

  it("uses regional digits in sparse-coverage limitations", () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: "ar-EG",
    });
    const source = packet();
    source.comparison.current = summary({ coveragePercent: 42.5 });

    const result = parseTarvisEvidenceSelectionResult(
      JSON.stringify({ findingIds: ["glucose-pattern"] }),
      source,
    );

    expect(result.answer.limitations.join(" ")).toContain(
      "٤٢٫٥% sensor coverage",
    );
  });
});
