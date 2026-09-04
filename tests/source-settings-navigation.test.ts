import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SETTINGS_OVERVIEW_MENU_ITEM,
  SOURCE_MENU_ITEMS,
  sourceJumpFromRoute,
  sourceSettingsBackTarget,
  sourceSettingsRouteParams,
} from "@/navigation/sourceNavigation";
import type { SourceJump } from "@/navigation/sourceNavigation";

const EXPECTED_SOURCE_JUMPS = [
  "profile",
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
  "privacy",
] as const satisfies readonly SourceJump[];

const appMenuSource = readFileSync(
  path.join(process.cwd(), "src", "components", "AppMenuButton.tsx"),
  "utf8",
);

describe("Settings source back navigation", () => {
  it("keeps the full Settings overview discoverable from the shortcuts menu", () => {
    expect(SETTINGS_OVERVIEW_MENU_ITEM).toEqual({
      accessibilityHint:
        "Opens the full Settings screen, including Help and learning and Automatic updates",
      detail: "Help, app tour, automatic updates and every connection",
      icon: "settings-outline",
      label: "All settings",
    });
    expect(sourceSettingsRouteParams()).toEqual({
      focused: false,
      source: undefined,
    });
    expect(appMenuSource).toContain("menuRow(SETTINGS_OVERVIEW_MENU_ITEM)");
    expect(appMenuSource).toContain("menuRow(DIABETES_PROFILE_MENU_ITEM)");
  });

  it("keeps the complete settings shortcut contract explicit", () => {
    expect(SOURCE_MENU_ITEMS.map(({ source }) => source)).toEqual(
      EXPECTED_SOURCE_JUMPS,
    );
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

  it("keeps shortcut details visible and available to assistive technology", () => {
    expect(appMenuSource).toContain(
      "accessibilityLabel={`${item.label}. ${item.detail}`}",
    );
    expect(appMenuSource).not.toContain("numberOfLines={1}");
  });
});
