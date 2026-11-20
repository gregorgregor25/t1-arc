import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SETTINGS_MAIN_PLACES,
  SETTINGS_SHORT_LIST,
  SOURCE_CHOOSER_ANSWERS,
  SOURCE_MENU_ITEMS,
  SOURCE_MENU_SECTIONS,
  glucoseSourcePageForSourceId,
  resolveSettingsRequest,
  settingsBackLabel,
  settingsParentPage,
  sourceJumpFromRoute,
  sourceSettingsBackTarget,
  sourceSettingsRouteParams,
} from "@/navigation/sourceNavigation";
import type { SourceJump } from "@/navigation/sourceNavigation";

const EXPECTED_SOURCE_JUMPS = [
  // Six main places
  "glucose",
  "alarms",
  "phone",
  "watch",
  "healthdata",
  "privacy",
  // Short list
  "notifications",
  "region",
  "appearance",
  "tarvis",
  "help",
  "about",
  "advanced",
  // Glucose sources: on this phone, then online accounts
  "aaps",
  "xdrip",
  "notification",
  "libre",
  "dexcom",
  "nightscout",
  "medtrum",
  // Health and insulin data connections
  "health",
  "glooko",
  "hevy",
  "strava",
  // Pages inside a place
  "profile",
  "support",
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

  it("orders Settings as six main places, then the short list, then the pages inside them", () => {
    expect(SOURCE_MENU_SECTIONS.map(({ id }) => id)).toEqual([
      "main",
      "more",
      "glucose-phone",
      "glucose-online",
      "health",
      "tarvis",
      "help",
    ]);
    expect(SETTINGS_MAIN_PLACES.map(({ label }) => label)).toEqual([
      "Glucose source",
      "Alarms",
      "Phone, widget and car",
      "Watch",
      "Health and insulin data",
      "Backup and privacy",
    ]);
    expect(SETTINGS_SHORT_LIST.map(({ label }) => label)).toEqual([
      "Notifications and reminders",
      "Units and region",
      "Appearance, ranges and colours",
      "Tarv1s and diabetes profile",
      "Help, feedback and tour",
      "About and updates",
      "Advanced and experimental",
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
      path.join(process.cwd(), "src", "screens", "settings", "SettingsPages.tsx"),
      "utf8",
    );
    const advanced = screen.slice(screen.indexOf("function AdvancedPage("));
    expect(advanced).toContain('variant="advanced"');
    expect(advanced).toContain('title="Earlier test-app migration"');
    const privacy = screen.slice(
      screen.indexOf("function BackupPrivacyPage("),
      screen.indexOf("function NotificationsPage("),
    );
    expect(privacy).toContain("<EncryptedBackupCard");
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

  it("keeps the earlier Display and alerts link working", () => {
    expect(sourceJumpFromRoute("display")).toBe("display");
    expect(resolveSettingsRequest("display")).toEqual({ page: "phone" });
    expect(SOURCE_MENU_ITEMS.some(({ source }) => source === "display")).toBe(false);
  });

  it("opens one-off panel requests on the page that now holds them", () => {
    expect(resolveSettingsRequest("display", "display-alerts")).toEqual({ page: "alarms" });
    expect(resolveSettingsRequest(undefined, "source-health")).toEqual({
      page: "glucose",
      expand: "glucose-health",
    });
    expect(resolveSettingsRequest("glooko")).toEqual({ page: "glooko" });
    expect(resolveSettingsRequest(undefined)).toEqual({ page: undefined });
  });

  it("returns from a page inside a place to that place, and from a place to Settings", () => {
    for (const source of ["aaps", "xdrip", "notification", "libre", "dexcom", "nightscout", "medtrum"] as const) {
      expect(settingsParentPage(source)).toBe("glucose");
      expect(settingsBackLabel(source)).toBe("Glucose source");
    }
    for (const source of ["health", "glooko", "hevy", "strava"] as const) {
      expect(settingsParentPage(source)).toBe("healthdata");
    }
    expect(settingsParentPage("profile")).toBe("tarvis");
    expect(settingsParentPage("support")).toBe("help");
    for (const place of [...SETTINGS_MAIN_PLACES, ...SETTINGS_SHORT_LIST]) {
      expect(settingsParentPage(place.source)).toBeUndefined();
      expect(settingsBackLabel(place.source)).toBe("Settings");
    }
  });

  it("names the Settings page of the glucose source in use", () => {
    expect(glucoseSourcePageForSourceId("aaps-local")).toBe("aaps");
    expect(glucoseSourcePageForSourceId("xdrip-local")).toBe("xdrip");
    expect(glucoseSourcePageForSourceId("android-notification")).toBe("notification");
    expect(glucoseSourcePageForSourceId("t1arc-librelinkup")).toBe("libre");
    expect(glucoseSourcePageForSourceId("dexcom-share")).toBe("dexcom");
    expect(glucoseSourcePageForSourceId("nightscout")).toBe("nightscout");
    expect(glucoseSourcePageForSourceId("medtrum-easyfollow")).toBe("medtrum");
    expect(glucoseSourcePageForSourceId("glooko")).toBeUndefined();
    expect(glucoseSourcePageForSourceId(undefined)).toBeUndefined();
  });

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
