import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countryOptions,
  filterPickerOptions,
  timeZoneLabel,
  timeZoneOptions,
} from "../src/domain/regionalPickerOptions";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("regional picker options", () => {
  it("lists IANA time zones with readable labels", () => {
    const options = timeZoneOptions();
    expect(options).toBeDefined();
    expect(options?.some((option) => option.value === "Europe/London")).toBe(true);
    expect(timeZoneLabel("America/New_York")).toBe("America/New York");
  });

  it("returns undefined when the engine cannot list time zones", () => {
    const intl = Intl as typeof Intl & { supportedValuesOf?: unknown };
    const original = intl.supportedValuesOf;
    try {
      Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: undefined, writable: true });
      expect(timeZoneOptions()).toBeUndefined();
    } finally {
      Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: original, writable: true });
    }
  });

  it("lists named countries sorted by name and leaves out groupings", () => {
    const options = countryOptions("en-GB");
    expect(options).toBeDefined();
    const values = options?.map((option) => option.value) ?? [];
    expect(values).toContain("GB");
    expect(values).toContain("CA");
    expect(values).not.toContain("EU");
    expect(values).not.toContain("ZZ");
    expect(values).not.toContain("UN");
    expect(new Set(values).size).toBe(values.length);
    const labels = options?.map((option) => option.label) ?? [];
    expect([...labels].sort((a, b) => a.localeCompare(b, "en-GB"))).toEqual(labels);
  });

  it("returns undefined when region names are unavailable", () => {
    vi.spyOn(Intl, "DisplayNames").mockImplementation(() => {
      throw new Error("unsupported");
    });
    expect(countryOptions("en-GB")).toBeUndefined();
  });

  it("filters by label or value, ignoring case, accents and separators", () => {
    const options = [
      { value: "America/New_York", label: "America/New York" },
      { value: "CI", label: "Côte d’Ivoire" },
      { value: "Europe/London", label: "Europe/London" },
    ];
    expect(filterPickerOptions(options, "new york").map((o) => o.value)).toEqual(["America/New_York"]);
    expect(filterPickerOptions(options, "cote").map((o) => o.value)).toEqual(["CI"]);
    expect(filterPickerOptions(options, "LONDON").map((o) => o.value)).toEqual(["Europe/London"]);
    expect(filterPickerOptions(options, "  ")).toHaveLength(3);
  });
});

describe("Region and Display settings layout", () => {
  const card = readFileSync("src/components/RegionalSettingsCard.tsx", "utf8");
  const sources = readFileSync("src/screens/SourcesScreen.tsx", "utf8");

  it("shows the glucose unit before More options", () => {
    const unit = card.indexOf('optionGroup("Glucose unit"');
    const more = card.indexOf(">More options<");
    const preset = card.indexOf('optionGroup("Region preset"');
    expect(unit).toBeGreaterThan(-1);
    expect(more).toBeGreaterThan(unit);
    expect(preset).toBeGreaterThan(more);
  });

  it("keeps a labelled, validated text fallback for time zones", () => {
    expect(card).toContain('accessibilityLabel="Time zone, for example Europe/London"');
    expect(card).toContain("isIanaTimeZone(candidate)");
    expect(card).toContain("timeZoneList ? (");
  });

  it("puts Glucose ranges at the top of Display settings", () => {
    const display = sources.slice(sources.indexOf('{activeSource === "display" ? ('));
    const ranges = display.indexOf('title="Glucose ranges"');
    const theme = display.indexOf('title="App appearance"');
    expect(ranges).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(ranges);
    expect(display).toContain('visible={expandedSetting === "display-ranges"}');
    expect(sources).toContain('moreOptionsOpen={expandedSetting === "region-more"}');
  });
});
