import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SOURCE_CHOOSER_ANSWERS,
  SOURCE_MENU_ITEMS,
  SOURCE_MENU_SECTIONS,
  sourceJumpFromRoute,
  sourceSettingsBackTarget,
  sourceSettingsRouteParams,
} from "@/navigation/sourceNavigation";
import type { SourceJump } from "@/navigation/sourceNavigation";

const EXPECTED_SOURCE_JUMPS = [
  "profile",
  "aaps",
  "libre",
  "dexcom",
  "nightscout",
  "medtrum",
  "xdrip",
  "notification",
  "health",
  "glooko",
  "hevy",
  "strava",
  "display",
  "watch",
  "region",
  "privacy",
  "support",
  "about",
  "advanced",
] as const satisfies readonly SourceJump[];

const appMenuSource = readFileSync(
  path.join(process.cwd(), "src", "components", "AppMenuButton.tsx"),
  "utf8",
);

describe("Settings source back navigation", () => {
  it("opens the Settings overview directly from the gear", () => {
    expect(sourceSettingsRouteParams()).toEqual({
      focused: false,
      source: undefined,
    });
    expect(appMenuSource).toContain(
      'navigation.navigate("Sources", sourceSettingsRouteParams())',
    );
    expect(appMenuSource).not.toContain("<Modal");
    expect(appMenuSource).not.toContain("Settings shortcuts");
  });

  it("keeps the complete settings shortcut contract explicit", () => {
    expect(SOURCE_MENU_ITEMS.map(({ source }) => source)).toEqual(
      EXPECTED_SOURCE_JUMPS,
    );
  });

  it("orders Settings with data connections first and help last", () => {
    expect(SOURCE_MENU_SECTIONS.map(({ id }) => id)).toEqual([
      "glucose",
      "health",
      "display",
      "data",
      "help",
      "advanced",
    ]);
  });

  it("labels connectors that have not been checked with a real account", () => {
    const untested = SOURCE_MENU_ITEMS.filter(
      (item) => "notTestedWithRealAccount" in item && item.notTestedWithRealAccount,
    ).map(({ source }) => source);
    // docs/REGIONAL_CAPABILITY_MATRIX.md: "no real-account verification claimed".
    expect(untested).toEqual(["dexcom", "medtrum"]);
  });

  it("collects experimental and development-only settings in one place", () => {
    const screen = readFileSync(
      path.join(process.cwd(), "src", "screens", "SourcesScreen.tsx"),
      "utf8",
    );
    const advanced = screen.slice(screen.indexOf('{activeSource === "advanced" ? ('));
    expect(advanced).toContain('variant="advanced"');
    expect(advanced).toContain('title="Earlier test-app migration"');
    const privacy = screen.slice(
      screen.indexOf('{activeSource === "privacy" ? ('),
      screen.indexOf('{activeSource === "advanced" ? ('),
    );
    expect(privacy).not.toContain("MaintainerMigrationCard");
    const card = readFileSync(
      path.join(process.cwd(), "src", "components", "GlucoseDisplayCard.tsx"),
      "utf8",
    );
    expect(card).toContain("{advanced ? (\n      <SettingRow");
    expect(card).toContain("{enabled && advanced ? (");
  });

  it("answers which source to choose with a short list of common setups", () => {
    expect(SOURCE_CHOOSER_ANSWERS.length).toBeGreaterThanOrEqual(3);
    expect(SOURCE_CHOOSER_ANSWERS.length).toBeLessThanOrEqual(6);
    const sources = SOURCE_CHOOSER_ANSWERS.map(({ source }) => source);
    expect(sources).toEqual(
      expect.arrayContaining(["aaps", "libre", "nightscout", "dexcom", "xdrip"]),
    );
    for (const answer of SOURCE_CHOOSER_ANSWERS) {
      expect(SOURCE_MENU_ITEMS.some(({ source }) => source === answer.source)).toBe(true);
    }
  });

  it.each(EXPECTED_SOURCE_JUMPS)(
    "routes the %s shortcut to its focused detail and back to the overview",
    (source) => {
      expect(sourceSettingsRouteParams(source)).toEqual({
        focused: true,
        source,
      });
      expect(sourceJumpFromRoute(source)).toBe(source);
      expect(sourceSettingsBackTarget(source)).toBe("overview");
    },
  );

  it("returns from the Settings overview to the previous app screen", () => {
    expect(sourceSettingsBackTarget(undefined)).toBe("previous-screen");
  });

  it("rejects invalid source route values", () => {
    expect(sourceJumpFromRoute("not-a-source")).toBeUndefined();
    expect(sourceJumpFromRoute(null)).toBeUndefined();
  });

  it("clears the route source when returning to the Settings overview", () => {
    expect(sourceSettingsRouteParams()).toEqual({
      focused: false,
      source: undefined,
    });
  });

  it("keeps screen shortcuts beside the gear available to assistive technology", () => {
    expect(appMenuSource).toContain("accessibilityLabel={action.label}");
    expect(appMenuSource).toContain("accessibilityHint={action.detail}");
  });
});
