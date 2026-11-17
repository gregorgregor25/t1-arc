import {
  DIABETES_PROFILE_MENU_ITEM,
  SOURCE_MENU_SECTIONS,
  type SourceJump,
} from "./sourceNavigation";

/**
 * Where a Settings search result leads. `expand` names the collapsible panel
 * (SettingsDisclosure key in SourcesScreen) to open once the page is shown.
 */
export type SettingsSearchTarget =
  | { kind: "source"; source: SourceJump; expand?: string }
  | { kind: "overview"; expand: string }
  | { kind: "screen"; screen: "Feedback" | "Cycle" | "TarvisSettings" | "Tour" };

export interface SettingsSearchEntry {
  id: string;
  label: string;
  detail: string;
  /** Where the result lives, shown under the result so people learn the layout. */
  location: string;
  keywords: readonly string[];
  target: SettingsSearchTarget;
}

const PAGE_KEYWORDS: Partial<Record<SourceJump, readonly string[]>> = {
  aaps: ["androidaps", "android aps", "loop", "iob", "cob", "juggluco"],
  libre: ["libre", "freestyle", "abbott", "follower", "librelinkup", "sensor"],
  dexcom: ["dexcom", "share", "clarity", "g6", "g7", "one"],
  nightscout: ["nightscout", "ns", "site", "cloud", "treatments"],
  medtrum: ["medtrum", "easyfollow", "nano"],
  xdrip: ["xdrip", "juggluco", "web service", "local"],
  notification: ["notification", "camaps", "omnipod 5", "minimed", "app"],
  health: ["health connect", "steps", "sleep", "food", "nutrition", "activity", "weight"],
  glooko: ["glooko", "pump", "insulin", "pdf", "report", "omnipod"],
  hevy: ["hevy", "gym", "strength", "workout"],
  strava: ["strava", "run", "ride", "gps"],
  region: ["country", "language", "units", "mmol", "mg/dl", "time zone", "timezone", "kcal", "kj", "metric", "imperial"],
  display: ["notification", "lock screen", "theme", "dark", "alerts", "alarms", "widget"],
  watch: ["wear os", "watch face", "companion", "smartwatch"],
  privacy: ["backup", "restore", "export", "erase", "delete", "usage counts", "privacy policy"],
  support: ["help", "problem", "diagnostics", "report", "bug"],
  about: ["version", "build", "source code", "licence", "update"],
  profile: ["carb ratio", "icr", "care plan"],
  advanced: ["experimental", "beta", "always-on", "always on", "aod", "android auto", "car", "migration"],
};

function sectionTitle(source: SourceJump) {
  if (source === DIABETES_PROFILE_MENU_ITEM.source) return "Settings";
  return (
    SOURCE_MENU_SECTIONS.find((section) =>
      section.items.some((item) => item.source === source),
    )?.title ?? "Settings"
  );
}

const PAGE_ENTRIES: SettingsSearchEntry[] = [
  DIABETES_PROFILE_MENU_ITEM,
  ...SOURCE_MENU_SECTIONS.flatMap((section) => section.items),
].map((item) => ({
  id: `page:${item.source}`,
  label: item.label,
  detail: item.detail,
  location: sectionTitle(item.source),
  keywords: PAGE_KEYWORDS[item.source] ?? [],
  target: { kind: "source", source: item.source },
}));

const PANEL_ENTRIES: SettingsSearchEntry[] = [
  {
    id: "panel:source-health",
    label: "Source health",
    detail: "When each connection last updated and any gaps",
    location: "Settings",
    keywords: ["sync", "last updated", "gaps", "stale", "connection status"],
    target: { kind: "overview", expand: "overview-source-health" },
  },
  {
    id: "panel:automation",
    label: "Automatic updates",
    detail: "Background syncing status",
    location: "Settings",
    keywords: ["background", "sync", "battery"],
    target: { kind: "overview", expand: "overview-automation" },
  },
  {
    id: "panel:glucose-ranges",
    label: "Glucose ranges",
    detail: "Target range, low and high levels and their colours",
    location: "Display and alerts",
    keywords: ["target", "range", "low", "high", "colours", "colors", "thresholds", "time in range"],
    target: { kind: "source", source: "display", expand: "display-ranges" },
  },
  {
    id: "panel:theme",
    label: "App appearance",
    detail: "Light, dark or follow the phone",
    location: "Display and alerts",
    keywords: ["theme", "dark mode", "light mode"],
    target: { kind: "source", source: "display", expand: "display-theme" },
  },
  {
    id: "panel:phone-display",
    label: "Phone and lock screen",
    detail: "Ongoing glucose notification and lock screen",
    location: "Display and alerts",
    keywords: ["notification", "status bar", "lock screen", "iob", "cob"],
    target: { kind: "source", source: "display", expand: "display-phone" },
  },
  {
    id: "panel:always-on",
    label: "Glucose on always-on display",
    detail: "Experimental overlay on the locked dark screen",
    location: "Advanced and experimental",
    keywords: ["aod", "always-on", "always on", "ambient", "overlay"],
    target: { kind: "source", source: "advanced" },
  },
  {
    id: "panel:android-auto",
    label: "Android Auto glance",
    detail: "Experimental glucose glance in the car",
    location: "Advanced and experimental",
    keywords: ["android auto", "car", "driving"],
    target: { kind: "source", source: "advanced" },
  },
  {
    id: "panel:alerts",
    label: "Glucose alerts",
    detail: "Low, high and missing-reading alerts",
    location: "Display and alerts",
    keywords: ["alarm", "alarms", "alert", "urgent low", "sound", "vibrate"],
    target: { kind: "source", source: "display", expand: "display-alerts" },
  },
  {
    id: "panel:widget",
    label: "Home screen widget",
    detail: "A glucose glance on your home screen",
    location: "Display and alerts",
    keywords: ["widget", "home screen", "launcher"],
    target: { kind: "source", source: "display", expand: "display-widget" },
  },
  {
    id: "panel:glucose-unit",
    label: "Glucose unit",
    detail: "mmol/L or mg/dL",
    location: "Region and services",
    keywords: ["mmol", "mmol/l", "mg/dl", "mgdl", "units"],
    target: { kind: "source", source: "region" },
  },
  {
    id: "panel:time-zone",
    label: "Time zone",
    detail: "Follow the phone or keep a home time zone",
    location: "Region and services",
    keywords: ["timezone", "travel", "clock"],
    target: { kind: "source", source: "region", expand: "region-more" },
  },
  {
    id: "panel:dexcom-history",
    label: "Dexcom Clarity history",
    detail: "Add older glucose from a Clarity file",
    location: "Dexcom",
    keywords: ["clarity", "csv", "import", "older"],
    target: { kind: "source", source: "dexcom", expand: "dexcom-history" },
  },
  {
    id: "panel:health-records",
    label: "Imported Health Connect data",
    detail: "Review the Health Connect entries in T1 Arc",
    location: "Health Connect",
    keywords: ["records", "entries", "imported"],
    target: { kind: "source", source: "health", expand: "health-records" },
  },
  {
    id: "panel:backup",
    label: "Encrypted backup",
    detail: "Make or restore a protected copy of your data",
    location: "Backup and privacy",
    keywords: ["backup", "restore", "copy", "new phone", "transfer"],
    target: { kind: "source", source: "privacy", expand: "privacy-backup" },
  },
  {
    id: "panel:export",
    label: "Export records",
    detail: "Glucose, insulin and carbohydrate files or a clinic report",
    location: "Backup and privacy",
    keywords: ["csv", "pdf", "clinic", "report", "share"],
    target: { kind: "source", source: "privacy", expand: "privacy-export" },
  },
  {
    id: "panel:device-data",
    label: "Device data controls",
    detail: "Inspect or erase data stored on this phone",
    location: "Backup and privacy",
    keywords: ["erase", "delete", "wipe", "remove data"],
    target: { kind: "source", source: "privacy", expand: "privacy-device" },
  },
  {
    id: "panel:usage-counts",
    label: "Anonymous usage counts",
    detail: "Turn the daily and weekly counts on or off",
    location: "Backup and privacy",
    keywords: ["telemetry", "analytics", "usage", "counts", "tracking"],
    target: { kind: "source", source: "privacy" },
  },
  {
    id: "screen:tarvis",
    label: "Tarv1s",
    detail: "AI provider connection and privacy",
    location: "Assistant",
    keywords: ["tarvis", "ai", "assistant", "chatgpt", "openai", "gemini", "claude", "api key"],
    target: { kind: "screen", screen: "TarvisSettings" },
  },
  {
    id: "screen:feedback",
    label: "Share feedback",
    detail: "Suggest a feature or manage your weekly reminder",
    location: "Feedback and more",
    keywords: ["feedback", "suggest", "reminder", "community"],
    target: { kind: "screen", screen: "Feedback" },
  },
  {
    id: "screen:cycle",
    label: "Cycle tracking",
    detail: "Periods, symptoms and cycle history",
    location: "Feedback and more",
    keywords: ["period", "menstrual", "cycle", "hormone"],
    target: { kind: "screen", screen: "Cycle" },
  },
  {
    id: "screen:tour",
    label: "Take the T1 Arc tour",
    detail: "A short guide to the app",
    location: "Feedback and more",
    keywords: ["tour", "walkthrough", "guide", "help", "learn"],
    target: { kind: "screen", screen: "Tour" },
  },
];

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  ...PAGE_ENTRIES,
  ...PANEL_ENTRIES,
];

function normalise(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic, case-insensitive search across labels, details, locations and
 * keywords. Every typed word must appear. Label matches rank first.
 */
export function searchSettings(
  query: string,
  entries: readonly SettingsSearchEntry[] = SETTINGS_SEARCH_ENTRIES,
  limit = 12,
): SettingsSearchEntry[] {
  const needle = normalise(query);
  if (!needle) return [];
  const words = needle.split(" ");
  const scored: { entry: SettingsSearchEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = normalise(entry.label);
    const haystack = normalise(
      [entry.label, entry.detail, entry.location, ...entry.keywords].join(" "),
    );
    if (!words.every((word) => haystack.includes(word))) return;
    const keywords = entry.keywords.map(normalise);
    const score = label.startsWith(needle)
      ? 0
      : label.includes(needle)
        ? 1
        : keywords.includes(needle)
          ? 2
          : keywords.some((keyword) => keyword.startsWith(needle))
            ? 3
            : 4;
    scored.push({ entry, score, index });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
