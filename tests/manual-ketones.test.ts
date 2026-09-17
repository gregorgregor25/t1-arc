import { describe, expect, it } from "vitest";

import {
  decodeManualKetoneDetail,
  encodeManualKetoneDetail,
  formatManualKetoneTitle,
  manualKetoneSafetyLevel,
  type ManualKetoneReading,
} from "@/data/manualKetones";

describe("manual ketone detail codec", () => {
  it.each<ManualKetoneReading>([
    { ketoneType: "blood", value: 0 },
    { ketoneType: "blood", value: 1.6 },
    { ketoneType: "blood", value: 20 },
    { ketoneType: "urine", value: "negative" },
    { ketoneType: "urine", value: "trace" },
    { ketoneType: "urine", value: "+" },
    { ketoneType: "urine", value: "++" },
    { ketoneType: "urine", value: "+++" },
    { ketoneType: "urine", value: "++++" },
  ])("round-trips the canonical reading $ketoneType/$value", (reading) => {
    const encoded = encodeManualKetoneDetail(reading);
    expect(encoded).toBe(`t1arc:ketone:v1:${JSON.stringify(reading)}`);
    expect(decodeManualKetoneDetail(encoded)).toEqual(reading);
  });

  it("canonicalises a valid runtime object whose keys were inserted in reverse", () => {
    const reading = { value: 1.2, ketoneType: "blood" } as ManualKetoneReading;
    expect(encodeManualKetoneDetail(reading)).toBe(
      't1arc:ketone:v1:{"ketoneType":"blood","value":1.2}',
    );
  });

  it.each([
    undefined,
    "",
    " ",
    ' t1arc:ketone:v1:{"ketoneType":"blood","value":1}',
    't1arc:ketone:v1:{"ketoneType":"blood","value":1} ',
    'T1arc:ketone:v1:{"ketoneType":"blood","value":1}',
    't1arc:ketone:v01:{"ketoneType":"blood","value":1}',
    "t1arc:ketone:v1",
    "t1arc:ketone:v1:",
    "t1arc:ketone:v1:not-json",
    "t1arc:ketone:v1:null",
    "t1arc:ketone:v1:[]",
    't1arc:ketone:v1: {"ketoneType":"blood","value":1}',
    't1arc:ketone:v1:{ "ketoneType":"blood","value":1}',
    't1arc:ketone:v1:{"value":1,"ketoneType":"blood"}',
    't1arc:ketone:v1:{"ketoneType":"blood","value":1,"value":2}',
  ])("rejects malformed, non-canonical, or lookalike detail: %s", (detail) => {
    expect(decodeManualKetoneDetail(detail)).toBeUndefined();
  });

  it.each([null, 1, {}, []])(
    "does not throw for non-string input: %o",
    (detail) => {
      expect(
        decodeManualKetoneDetail(detail as unknown as string),
      ).toBeUndefined();
    },
  );

  it.each([
    "{}",
    '{"ketoneType":"blood"}',
    '{"value":1}',
    '{"ketoneType":"blood","value":1,"note":"extra"}',
    '{"ketoneType":"urine","value":"+","note":"extra"}',
    '{"ketoneType":"capillary","value":1}',
    '{"ketoneType":"blood","value":"1.6"}',
    '{"ketoneType":"blood","value":-0.1}',
    '{"ketoneType":"blood","value":20.1}',
    '{"ketoneType":"blood","value":1e309}',
    '{"ketoneType":"urine","value":""}',
    '{"ketoneType":"urine","value":"Negative"}',
    '{"ketoneType":"urine","value":"+++++"}',
  ])("rejects an invalid payload: %s", (payload) => {
    expect(
      decodeManualKetoneDetail(`t1arc:ketone:v1:${payload}`),
    ).toBeUndefined();
  });

  it.each([
    { ketoneType: "blood", value: Number.NaN },
    { ketoneType: "blood", value: Number.POSITIVE_INFINITY },
    { ketoneType: "blood", value: -1 },
    { ketoneType: "blood", value: 21 },
    { ketoneType: "urine", value: "+++++" },
  ])("refuses to encode an invalid runtime reading", (reading) => {
    expect(() =>
      encodeManualKetoneDetail(reading as ManualKetoneReading),
    ).toThrow(/invalid manual ketone reading/i);
  });
});

describe("manual ketone display", () => {
  it.each([
    [{ ketoneType: "blood", value: 1.2 }, "Blood ketones · 1.2 mmol/L"],
    [{ ketoneType: "urine", value: "negative" }, "Urine ketones · Negative"],
    [{ ketoneType: "urine", value: "trace" }, "Urine ketones · Trace"],
    [{ ketoneType: "urine", value: "+" }, "Urine ketones · +"],
    [{ ketoneType: "urine", value: "++" }, "Urine ketones · ++"],
    [{ ketoneType: "urine", value: "+++" }, "Urine ketones · +++"],
    [{ ketoneType: "urine", value: "++++" }, "Urine ketones · ++++"],
  ] as const)("formats %o as %s", (reading, expected) => {
    expect(formatManualKetoneTitle(reading, "en-GB")).toBe(expected);
  });

  it("uses the selected locale for blood-ketone decimals", () => {
    expect(
      formatManualKetoneTitle(
        { ketoneType: "blood", value: 4.5 },
        "fr-FR",
      ),
    ).toBe("Blood ketones · 4,5 mmol/L");
  });
});

describe("manual ketone safety level", () => {
  it.each([
    [0, "routine"],
    [1.59, "routine"],
    [1.6, "urgent"],
    [3, "urgent"],
    [3.01, "emergency"],
    [20, "emergency"],
  ] as const)("classifies blood ketones %s as %s", (value, expected) => {
    expect(manualKetoneSafetyLevel({ ketoneType: "blood", value }, "GB")).toBe(
      expected,
    );
  });

  it.each([
    ["negative", "routine"],
    ["trace", "routine"],
    ["+", "routine"],
    ["++", "urgent"],
    ["+++", "emergency"],
    ["++++", "emergency"],
  ] as const)("classifies urine ketones %s as %s", (value, expected) => {
    expect(manualKetoneSafetyLevel({ ketoneType: "urine", value }, "GB")).toBe(
      expected,
    );
  });

  it.each(["US", "JP", "generic"])(
    "does not apply the reviewed GB numeric pathway in %s",
    (jurisdiction) => {
      expect(
        manualKetoneSafetyLevel(
          { ketoneType: "blood", value: 4.5 },
          jurisdiction,
        ),
      ).toBe("unclassified");
      expect(
        manualKetoneSafetyLevel(
          { ketoneType: "urine", value: "++++" },
          jurisdiction,
        ),
      ).toBe("unclassified");
    },
  );
});
