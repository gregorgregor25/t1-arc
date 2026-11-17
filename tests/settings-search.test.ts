import { describe, expect, it } from "vitest";

import { SETTINGS_SEARCH_ENTRIES, searchSettings } from "@/navigation/settingsSearch";
import { SOURCE_MENU_ITEMS } from "@/navigation/sourceNavigation";

describe("Settings search", () => {
  it("returns nothing for an empty or blank query", () => {
    expect(searchSettings("")).toEqual([]);
    expect(searchSettings("   ")).toEqual([]);
  });

  it("can reach every Settings page by its own name", () => {
    for (const item of SOURCE_MENU_ITEMS) {
      const results = searchSettings(item.label);
      expect(
        results.some(
          (entry) => entry.target.kind === "source" && entry.target.source === item.source,
        ),
        item.label,
      ).toBe(true);
    }
  });

  it("finds settings by everyday words, case-insensitively", () => {
    expect(searchSettings("ALARM")[0]?.id).toBe("page:alarms");
    expect(searchSettings("target range")[0]?.id).toBe("panel:glucose-ranges");
    expect(searchSettings("mg/dl").map((entry) => entry.id)).toContain("panel:glucose-unit");
    expect(searchSettings("restore").map((entry) => entry.id)).toContain("panel:backup");
    expect(searchSettings("juggluco").map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["page:aaps", "page:xdrip"]),
    );
  });

  it("requires every typed word and ranks label matches first", () => {
    expect(searchSettings("backup zebra")).toEqual([]);
    const results = searchSettings("dexcom");
    expect(results[0]?.label).toBe("Dexcom Share");
  });

  it("opens each alarm's own editor", () => {
    expect(searchSettings("urgent low")[0]?.target).toEqual({
      kind: "source",
      source: "alarms",
      expand: "alarm-urgentLow",
    });
    for (const kind of ["urgentLow", "low", "high", "veryHigh", "stale"]) {
      const entry = SETTINGS_SEARCH_ENTRIES.find((candidate) => candidate.id === `alarm:${kind}`);
      expect(entry?.target).toEqual({ kind: "source", source: "alarms", expand: `alarm-${kind}` });
    }
  });

  it("finds settings that moved in the redesign at their new place", () => {
    const target = (id: string) => SETTINGS_SEARCH_ENTRIES.find((entry) => entry.id === id)?.target;
    expect(target("panel:glucose-unit")).toMatchObject({ source: "region" });
    expect(target("panel:glucose-ranges")).toMatchObject({ source: "appearance", expand: "appearance-ranges" });
    expect(target("panel:food-totals")).toMatchObject({ source: "healthdata" });
    expect(target("panel:weekly-review")).toMatchObject({ source: "notifications", expand: "notifications-review" });
    expect(target("panel:dexcom-history")).toMatchObject({ source: "dexcom", expand: "dexcom-history" });
    expect(searchSettings("nightscout history").map((entry) => entry.id)).toContain("panel:nightscout-history");
  });

  it("gives every entry a unique id, a location and plain detail", () => {
    const ids = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      expect(entry.location.length).toBeGreaterThan(0);
      expect(entry.detail).not.toMatch(/HTTP|IANA|endpoint|payload/);
    }
  });
});
