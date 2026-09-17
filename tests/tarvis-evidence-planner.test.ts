import { afterEach, describe, expect, it } from "vitest";

import {
  buildTarvisEvidencePlanningOptions,
  parseTarvisEvidencePlan,
  tarvisEvidencePlannerTextConfig,
} from "@/data/tarvis/evidencePlanner";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

const AS_OF = Date.parse("2026-08-26T10:00:00+01:00");
const QUESTION =
  "I had a really high reading two days ago. Do you know why?";
const EXACT_PHONE_QUESTION =
  "Why did I go high on Saturday 15 August Please check food insulin activity and data gaps";

function options() {
  return buildTarvisEvidencePlanningOptions(QUESTION, AS_OF);
}

function validPlan() {
  return JSON.stringify({
    kind: "glucose-episode",
    rangeOptionId: "range-1",
    eventOptionId: "event-high",
    categoryIds: [
      "glucose",
      "insulin",
      "food",
      "activity",
      "sleep",
      "context",
      "data-quality",
    ],
    clarificationCode: "none",
  });
}

describe("Tarv1s AI evidence planner boundary", () => {
  it("offers the exact UK calendar day named by the failed phone question", () => {
    const result = options();
    expect(result.rangeOptions).toHaveLength(1);
    expect(result.rangeOptions[0]?.current).toEqual({
      start: Date.parse("2026-08-24T00:00:00+01:00"),
      end: Date.parse("2026-08-25T00:00:00+01:00"),
    });
    expect(result.rangeOptions[0]?.previous).toEqual({
      start: Date.parse("2026-08-23T00:00:00+01:00"),
      end: Date.parse("2026-08-24T00:00:00+01:00"),
    });
  });

  it("offers a bounded late Sunday-night window and its prior equivalent", () => {
    const result = buildTarvisEvidencePlanningOptions(
      "Why did I go really low late on Sunday night",
      AS_OF,
    );
    expect(result.rangeOptions).toHaveLength(1);
    expect(result.rangeOptions[0]?.current).toEqual({
      start: Date.parse("2026-08-23T20:00:00+01:00"),
      end: Date.parse("2026-08-24T06:00:00+01:00"),
    });
    expect(result.rangeOptions[0]?.previous).toEqual({
      start: Date.parse("2026-08-22T20:00:00+01:00"),
      end: Date.parse("2026-08-23T06:00:00+01:00"),
    });
    expect(result.eventOptions).toEqual([
      {
        id: "event-low",
        kind: "low",
        label: "A past low-glucose episode",
      },
    ]);
  });

  it.each([
    "Why did I go low on Sunday late at night?",
    "Why did I go low late at night on Sunday?",
  ])("keeps a natural late-night variant inside the night window: %s", (question) => {
    expect(
      buildTarvisEvidencePlanningOptions(question, AS_OF).rangeOptions[0]
        ?.current,
    ).toEqual({
      start: Date.parse("2026-08-23T20:00:00+01:00"),
      end: Date.parse("2026-08-24T06:00:00+01:00"),
    });
  });

  it.each([
    "Please investigate why I went low Sunday night",
    "Could something have caused my low Sunday night?",
  ])("recognises a bare named-weekday night: %s", (question) => {
    expect(
      buildTarvisEvidencePlanningOptions(question, AS_OF).rangeOptions[0]
        ?.current,
    ).toEqual({
      start: Date.parse("2026-08-23T18:00:00+01:00"),
      end: Date.parse("2026-08-24T06:00:00+01:00"),
    });
  });

  it("uses a bounded named-weekday evening rather than the whole day", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "Why did I go low Sunday evening?",
        AS_OF,
      ).rangeOptions[0]?.current,
    ).toEqual({
      start: Date.parse("2026-08-23T18:00:00+01:00"),
      end: Date.parse("2026-08-24T00:00:00+01:00"),
    });
  });

  it("uses a bounded four-hour window for an exact named clock time", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "What might explain my low at 11pm on Sunday?",
        AS_OF,
      ).rangeOptions[0]?.current,
    ).toEqual({
      start: Date.parse("2026-08-23T21:00:00+01:00"),
      end: Date.parse("2026-08-24T01:00:00+01:00"),
    });
  });

  it.each([
    {
      asOf: Date.parse("2026-03-30T10:00:00+01:00"),
      question: "Why did I go low at 1:30am on Sunday?",
    },
    {
      asOf: Date.parse("2026-10-26T10:00:00Z"),
      question: "Why did I go low at 1:30am on Sunday?",
    },
  ])(
    "withholds an exact named time that is missing or repeated at a clock change",
    ({ asOf, question }) => {
      expect(
        buildTarvisEvidencePlanningOptions(question, asOf).rangeOptions,
      ).toEqual([]);
    },
  );

  it("anchors an early clock time to the following morning of a named night", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "What might explain my low on Sunday night at 1am?",
        AS_OF,
      ).rangeOptions[0]?.current,
    ).toEqual({
      start: Date.parse("2026-08-23T23:00:00+01:00"),
      end: Date.parse("2026-08-24T03:00:00+01:00"),
    });
  });

  it.each([
    "Why did I go low on Sunday morning at 11pm?",
    "Why did I go low on Sunday night at 7am?",
  ])("does not ignore a clock time that contradicts its daypart: %s", (question) => {
    expect(
      buildTarvisEvidencePlanningOptions(question, AS_OF).rangeOptions,
    ).toEqual([]);
  });

  it("maps named-weekday overnight to a bounded night window", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "Why did I go low overnight on Sunday?",
        AS_OF,
      ).rangeOptions[0]?.current,
    ).toEqual({
      start: Date.parse("2026-08-23T18:00:00+01:00"),
      end: Date.parse("2026-08-24T06:00:00+01:00"),
    });
  });

  it("does not guess which boundary 'midnight on Sunday' means", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "Why did I go low around midnight on Sunday?",
        AS_OF,
      ).rangeOptions,
    ).toEqual([]);
  });

  it("does not collapse alternative weekdays or compound event kinds", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "Why did I go low on Sunday or Monday night?",
        AS_OF,
      ).rangeOptions,
    ).toEqual([]);
    expect(
      buildTarvisEvidencePlanningOptions(
        "Why did I go low on 23 or 24 August?",
        AS_OF,
      ).rangeOptions,
    ).toEqual([]);
    [
      "Why did I go low last night or Sunday night?",
      "Why did I go low yesterday or the day before?",
      "Why did I go low last night or the night before?",
      "Why did I go low two days ago or yesterday?",
      "Why did I go low either two days ago or yesterday?",
      "Why did I go low two days ago and yesterday?",
      "Why did I go low 48 hours ago or yesterday?",
      "Why did I go low 48h ago or yesterday?",
      "Why did I go low 2d ago or yesterday?",
      "Why did I go low a week ago or yesterday?",
      "Why did I go low a couple of days ago or yesterday?",
      "Why did I go low a couple days ago or yesterday?",
      "Why did I go low three days back or yesterday?",
      "Why did I go low earlier in the week or yesterday?",
      "Why did I go low yesterday and the next day?",
      "Why did I go low two days ago and the following day?",
      "Why did I go low Sunday or the previous day?",
      "Why did I go low Sunday or the prior day?",
      "Why did I go low last Sunday or the week before?",
      "Why did I go low Sunday and the next day?",
      "Why did I go low last Sunday and the following day?",
      "Why did I go low the weekend before last or yesterday?",
      "Why did I go low on 23/24 August?",
      "Why did I go low on 23rd & 24th August?",
      "Why did I go low on 23rd or the 24th August?",
      "Why did I go low on 23rd and/or 24th August?",
      "Why did I go low on 23rd or maybe the 24th August?",
      "Why did I go low on 23rd versus 24th August?",
      "Why did I go low on 23rd compared with 24th August?",
      "Why did I go low on 23rd, possibly 24th August?",
      "Why did I go low on 23rd plus 24th August?",
      "Why did I go low from 23rd to 24th August?",
      "Why did I go low on 23rd-24th August?",
      "Why did I go low on 23rd rather than 24th August?",
      "Why did I go low on 23rd instead of 24th August?",
      "Why did I go low on 23rd and perhaps 24th August?",
      "Why did I go low on 23rd or possibly 24th August?",
      "Why did I go low on 23rd, 24th August?",
      "Why did I go low on 23 and then 24 August?",
      "Why did I go low from 23 up to 24 August?",
      "Why did I go low on 23 if not 24 August?",
      "Why did I go low on 23 and also 24 August?",
      "Why did I go low on 23 as well as 24 August?",
      "Why did I go low on 23 followed by 24 August?",
      "Why did I go low on 23 then 24 August?",
      "Why did I go low on 23 August and the next day?",
      "Why did I go low on 23 August and the following day?",
    ].forEach((question) => {
      expect(
        buildTarvisEvidencePlanningOptions(question, AS_OF).rangeOptions,
      ).toEqual([]);
    });
    expect(
      buildTarvisEvidencePlanningOptions(
        "Why did I go high then low on Sunday night?",
        AS_OF,
      ).eventOptions,
    ).toEqual([]);
    [
      "Why did I spike and crash on Sunday night?",
      "Why did I rise then drop on Sunday night?",
      "Why did my glucose spike then fall on Sunday night?",
      "Why was I above range then low on Sunday night?",
      "Why was I high then below target on Sunday night?",
      "Why was I over range then low on Sunday night?",
      "Why was I over target then hypo on Sunday night?",
      "Why was I high then under range on Sunday night?",
      "Why was I high then under target on Sunday night?",
      "Why did I spike or dip on Sunday night?",
      "Why did my glucose shoot up and go low on Sunday night?",
    ].forEach((question) => {
      expect(
        buildTarvisEvidencePlanningOptions(question, AS_OF).eventOptions,
      ).toEqual([]);
    });
  });

  it("resolves only opaque offered IDs into a bounded local request", () => {
    expect(parseTarvisEvidencePlan(validPlan(), options())).toMatchObject({
      kind: "glucose-episode",
      eventKind: "high",
      rangeOptionId: "range-1",
      range: {
        current: {
          start: Date.parse("2026-08-24T00:00:00+01:00"),
          end: Date.parse("2026-08-25T00:00:00+01:00"),
        },
      },
    });
  });

  it("preserves every evidence category explicitly named in the phone question", () => {
    const exactOptions = buildTarvisEvidencePlanningOptions(
      EXACT_PHONE_QUESTION,
      AS_OF,
    );
    expect(exactOptions.explicitCategoryIds).toEqual([
      "insulin",
      "food",
      "activity",
      "data-quality",
    ]);
    expect(exactOptions.explicitDataQualityChecks).toEqual(["gaps"]);

    const sparseHostedPlan = JSON.stringify({
      kind: "glucose-episode",
      rangeOptionId: "range-1",
      eventOptionId: "event-high",
      categoryIds: ["glucose", "insulin", "data-quality"],
      clarificationCode: "none",
    });
    expect(parseTarvisEvidencePlan(sparseHostedPlan, exactOptions)).toMatchObject({
      kind: "glucose-episode",
      categoryIds: [
        "glucose",
        "insulin",
        "food",
        "activity",
        "data-quality",
      ],
      explicitCategoryIds: [
        "insulin",
        "food",
        "activity",
        "data-quality",
      ],
      explicitDataQualityChecks: ["gaps"],
    });
  });

  it("does not mistake a temporal night reference for an explicit sleep request", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "Why did I go low late on Sunday night?",
        AS_OF,
      ).explicitCategoryIds,
    ).toEqual([]);
  });

  it("honours explicitly excluded categories even when the hosted plan selects them", () => {
    const question =
      "Why did I go high yesterday? Do not check food or activity; just check insulin and data gaps.";
    const result = buildTarvisEvidencePlanningOptions(question, AS_OF);
    expect(result.explicitCategoryIds).toEqual(["insulin", "data-quality"]);
    expect(result.excludedCategoryIds).toEqual(["food", "activity"]);

    const hostedPlan = JSON.stringify({
      kind: "glucose-episode",
      rangeOptionId: "range-1",
      eventOptionId: "event-high",
      categoryIds: [
        "glucose",
        "insulin",
        "food",
        "activity",
        "data-quality",
      ],
      clarificationCode: "none",
    });
    expect(parseTarvisEvidencePlan(hostedPlan, result)).toMatchObject({
      kind: "glucose-episode",
      categoryIds: ["glucose", "insulin", "data-quality"],
      explicitCategoryIds: ["insulin", "data-quality"],
    });
  });

  it("does not mistake uncertainty or causal absence for an exclusion directive", () => {
    const uncertainty = buildTarvisEvidencePlanningOptions(
      "I am not sure whether food, insulin or activity caused my high yesterday; please check food, insulin and activity.",
      AS_OF,
    );
    expect(uncertainty.excludedCategoryIds).toEqual([]);
    expect(uncertainty.explicitCategoryIds).toEqual([
      "insulin",
      "food",
      "activity",
    ]);

    const absence = buildTarvisEvidencePlanningOptions(
      "Was my high yesterday because I was without insulin? Please check insulin.",
      AS_OF,
    );
    expect(absence.excludedCategoryIds).toEqual([]);
    expect(absence.explicitCategoryIds).toEqual(["insulin"]);

    const postListUncertainty = buildTarvisEvidencePlanningOptions(
      "Please check food and insulin, but not sure whether activity mattered yesterday.",
      AS_OF,
    );
    expect(postListUncertainty.excludedCategoryIds).toEqual([]);
    expect(postListUncertainty.explicitCategoryIds).toEqual([
      "insulin",
      "food",
      "activity",
    ]);
  });

  it.each([
    "Please check not only food but activity after my high yesterday.",
    "Please check not just food but insulin after my high yesterday.",
  ])("does not treat inclusive 'not' phrasing as an exclusion: %s", (question) => {
    expect(
      buildTarvisEvidencePlanningOptions(question, AS_OF)
        .excludedCategoryIds,
    ).toEqual([]);
  });

  it("does not make a negated data-gap request explicitly required", () => {
    const result = buildTarvisEvidencePlanningOptions(
      "Why did I go high yesterday? Do not check data gaps; check food and insulin.",
      AS_OF,
    );
    expect(result.excludedCategoryIds).not.toContain("data-quality");
    expect(result.excludedDataQualityChecks).toEqual(["gaps"]);
    expect(result.explicitDataQualityChecks).toEqual([]);
    expect(result.explicitCategoryIds).toEqual(["insulin", "food"]);
  });

  it("preserves a requested context sibling when another subtype is excluded", () => {
    const result = buildTarvisEvidencePlanningOptions(
      "Why did I go high yesterday? Do not check ketones; check medication.",
      AS_OF,
    );
    expect(result.excludedCategoryIds).not.toContain("context");
    expect(result.explicitCategoryIds).toEqual(["context"]);
    expect(result.explicitContextChecks).toEqual(["medication"]);
    expect(result.excludedContextChecks).toEqual(["ketones"]);
  });

  it("preserves a requested data-quality sibling when gaps are excluded", () => {
    const result = buildTarvisEvidencePlanningOptions(
      "Why did I go high yesterday? Do not check data gaps; check source freshness.",
      AS_OF,
    );
    expect(result.excludedCategoryIds).not.toContain("data-quality");
    expect(result.explicitCategoryIds).toEqual(["data-quality"]);
    expect(result.explicitDataQualityChecks).toEqual(["freshness"]);
    expect(result.excludedDataQualityChecks).toEqual(["gaps"]);

    expect(parseTarvisEvidencePlan(validPlan(), result)).toMatchObject({
      kind: "glucose-episode",
      categoryIds: expect.arrayContaining(["glucose", "data-quality"]),
      explicitDataQualityChecks: ["freshness"],
      excludedDataQualityChecks: ["gaps"],
    });
  });

  it("keeps literal parent-category exclusions whole", () => {
    const context = buildTarvisEvidencePlanningOptions(
      "Why did I go high yesterday? Exclude context; check insulin.",
      AS_OF,
    );
    expect(context.excludedCategoryIds).toContain("context");
    expect(context.explicitContextChecks).toEqual([]);

    const dataQuality = buildTarvisEvidencePlanningOptions(
      "Why did I go high yesterday? Exclude data quality; check insulin.",
      AS_OF,
    );
    expect(dataQuality.excludedCategoryIds).toContain("data-quality");
    expect(dataQuality.explicitDataQualityChecks).toEqual([]);
  });

  it("preserves the exact explicitly requested context subtype", () => {
    const result = buildTarvisEvidencePlanningOptions(
      "Why did I go high yesterday? Please check ketones and medication.",
      AS_OF,
    );
    expect(result.explicitCategoryIds).toEqual(["context"]);
    expect(result.explicitContextChecks).toEqual(["medication", "ketones"]);
    expect(result.excludedContextChecks).toEqual([]);
    const parsed = parseTarvisEvidencePlan(
      JSON.stringify({
        kind: "glucose-episode",
        rangeOptionId: "range-1",
        eventOptionId: "event-high",
        categoryIds: ["glucose", "context", "data-quality"],
        clarificationCode: "none",
      }),
      result,
    );
    expect(parsed).toMatchObject({
      kind: "glucose-episode",
      explicitContextChecks: ["medication", "ketones"],
      excludedContextChecks: [],
    });
  });

  it.each([
    "gaps in the data",
    "reading gaps",
    "CGM gaps",
    "gaps in my sensor readings",
    "missing sensor data",
  ])("recognises an explicitly requested data-quality check: %s", (phrase) => {
    const result = buildTarvisEvidencePlanningOptions(
      `Why did I go high yesterday? Please check ${phrase}.`,
      AS_OF,
    );
    expect(result.explicitCategoryIds).toContain("data-quality");
    expect(result.explicitDataQualityChecks).toEqual(["gaps"]);
  });

  it("expands a generic data-quality request to all three bounded checks", () => {
    const result = buildTarvisEvidencePlanningOptions(
      "Why did I go high yesterday? Please check data quality.",
      AS_OF,
    );
    expect(result.explicitDataQualityChecks).toEqual([
      "gaps",
      "coverage",
      "freshness",
    ]);
  });

  it.each(["hiking", "football", "weights", "sport"])(
    "recognises an explicitly requested activity alias: %s",
    (activity) => {
      expect(
        buildTarvisEvidencePlanningOptions(
          `Why did I go high yesterday? Please check ${activity}.`,
          AS_OF,
        ).explicitCategoryIds,
      ).toContain("activity");
    },
  );

  it.each([
    "Can you walk me through why I went high yesterday and check food, insulin and data gaps?",
    "Please run through why I went high yesterday; check food, insulin and data gaps.",
    "What steps should we check after my high yesterday? Check food, insulin and data gaps.",
    "Why did I go high yesterday? I was stressed about it afterwards.",
  ])("does not force an incidental conversational category: %s", (question) => {
    expect(
      buildTarvisEvidencePlanningOptions(question, AS_OF).explicitCategoryIds,
    ).not.toContain("activity");
  });

  it("recognises requested categories introduced by 'using' after an idiom", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "Please run through why I went high on Saturday 15 August using meals, insulin and sensor gaps.",
        AS_OF,
      ).explicitCategoryIds,
    ).toEqual(["insulin", "food", "data-quality"]);
  });

  it("preserves categories named in an open-ended causal question", () => {
    expect(
      buildTarvisEvidencePlanningOptions(
        "Could activity, food or insulin have caused my high on Saturday 15 August?",
        AS_OF,
      ).explicitCategoryIds,
    ).toEqual(["insulin", "food", "activity"]);
  });

  it("constrains the hosted output to IDs rather than timestamps or queries", () => {
    const config = tarvisEvidencePlannerTextConfig(options());
    const properties = config.format.schema.properties;
    expect(properties.rangeOptionId.enum).toEqual(["none", "range-1"]);
    expect(properties.eventOptionId.enum).toEqual([
      "none",
      "event-high",
    ]);
    expect(properties).not.toHaveProperty("start");
    expect(properties).not.toHaveProperty("end");
    expect(properties).not.toHaveProperty("query");
  });

  it.each([
    {
      name: "unknown range",
      change: { rangeOptionId: "range-invented" },
    },
    {
      name: "duplicate category",
      change: { categoryIds: ["glucose", "glucose", "data-quality"] },
    },
    {
      name: "missing mandatory data quality",
      change: { categoryIds: ["glucose"] },
    },
    {
      name: "opposite glucose event",
      change: { eventOptionId: "event-low" },
    },
    {
      name: "arbitrary query field",
      change: { query: "SELECT * FROM glucose" },
    },
  ])("rejects $name", ({ change }) => {
    const candidate = { ...JSON.parse(validPlan()), ...change };
    expect(() =>
      parseTarvisEvidencePlan(JSON.stringify(candidate), options()),
    ).toThrow(/evidence plan/i);
  });

  it("does not invent a default range when the user did not name one", () => {
    [
      "Can you investigate a high for me?",
      "I had a high. Do you know why?",
    ].forEach((question) => {
      expect(
        buildTarvisEvidencePlanningOptions(question, AS_OF).rangeOptions,
      ).toEqual([]);
    });
  });
});
