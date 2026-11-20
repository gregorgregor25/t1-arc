import {
  SOURCE_MENU_SECTIONS,
  type SourceJump,
  type SourceMenuSectionId,
} from "./sourceNavigation";

/**
 * Where a Settings search result leads. `expand` names the collapsible panel
 * (a SettingsDisclosure key, or an alarm editor `alarm-<kind>`) to open once
 * the page is shown.
 */
export type SettingsSearchTarget =
  | { kind: "source"; source: SourceJump; expand?: string }
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
  glucose: ["source", "cgm", "sensor", "connection", "readings", "data source"],
  alarms: ["alarm", "alerts", "alert", "sound", "vibrate", "urgent low", "night"],
  phone: ["notification", "lock screen", "status bar", "widget", "android auto", "car", "always-on"],
  watch: ["wear os", "watch face", "companion", "smartwatch"],
  healthdata: ["health", "insulin", "pump", "food", "steps", "activity"],
  privacy: ["backup", "restore", "export", "erase", "delete", "usage counts", "privacy policy"],
  notifications: ["notification", "permission", "reminder", "weekly review", "android settings"],
  region: ["country", "language", "units", "mmol", "mg/dl", "time zone", "timezone", "kcal", "kj", "metric", "imperial"],
  appearance: ["theme", "dark", "light", "colours", "colors", "ranges", "target"],
  tarvis: ["tarvis", "ai", "assistant", "chatgpt", "openai", "gemini", "claude", "api key"],
  help: ["help", "feedback", "tour", "support", "problem"],
  aaps: ["androidaps", "android aps", "aaps local", "loop", "iob", "cob", "juggluco"],
  libre: ["libre", "freestyle", "abbott", "follower", "librelinkup", "sensor"],
  dexcom: ["dexcom", "share", "clarity", "g6", "g7", "one"],
  nightscout: ["nightscout", "ns", "site", "cloud", "treatments"],
  medtrum: ["medtrum", "easyfollow", "nano"],
  xdrip: ["xdrip", "juggluco", "web service", "local"],
  notification: ["notification source", "camaps", "omnipod 5", "minimed", "app"],
  health: ["health connect", "steps", "sleep", "food", "nutrition", "activity", "weight"],
  glooko: ["glooko", "pump", "insulin", "pdf", "report", "omnipod"],
  hevy: ["hevy", "gym", "strength", "workout"],
  strava: ["strava", "run", "ride", "gps"],
  support: ["help", "problem", "diagnostics", "report", "bug"],
  about: ["version", "build", "source code", "licence", "update", "updates"],
  profile: ["carb ratio", "icr", "care plan"],
  advanced: ["experimental", "beta", "always-on", "always on", "aod", "android auto", "car", "migration"],
};

const SECTION_LOCATION: Record<SourceMenuSectionId, string> = {
  main: "Settings",
  more: "Settings",
  "glucose-phone": "Glucose source",
  "glucose-online": "Glucose source",
  health: "Health and insulin data",
  tarvis: "Tarv1s and diabetes profile",
  help: "Help, feedback and tour",
};

const PAGE_ENTRIES: SettingsSearchEntry[] = SOURCE_MENU_SECTIONS.flatMap(
  (section) =>
    section.items.map((item) => ({
      id: `page:${item.source}`,
      label: item.label,
      detail: item.detail,
      location: SECTION_LOCATION[section.id],
      keywords: PAGE_KEYWORDS[item.source] ?? [],
      target: { kind: "source", source: item.source } as const,
    })),
);

const ALARM_KIND_ENTRIES: SettingsSearchEntry[] = [
  { kind: "urgentLow", label: "Urgent low alert", keywords: ["urgent low", "hypo", "very low"] },
  { kind: "low", label: "Low alert", keywords: ["low", "hypo"] },
  { kind: "high", label: "High alert", keywords: ["high", "hyper"] },
  { kind: "veryHigh", label: "Very high alert", keywords: ["very high", "hyper"] },
  { kind: "stale", label: "Missing or stale readings alert", keywords: ["missing", "stale", "no readings", "signal loss"] },
].map(({ kind, label, keywords }) => ({
  id: `alarm:${kind}`,
  label,
  detail: "Level, sound and sound preview",
  location: "Alarms",
  keywords: ["alarm", "threshold", "sound", ...keywords],
  target: { kind: "source", source: "alarms", expand: `alarm-${kind}` } as const,
}));

const PANEL_ENTRIES: SettingsSearchEntry[] = [
  {
    id: "panel:source-chooser",
    label: "Which source do I need?",
    detail: "Short answers for common setups",
    location: "Glucose source",
    keywords: ["choose", "which", "help", "setup"],
    target: { kind: "source", source: "glucose", expand: "glucose-chooser" },
  },
  {
    id: "panel:source-health",
    label: "Source health",
    detail: "When each connection last updated and any gaps",
    location: "Glucose source",
    keywords: ["sync", "last updated", "gaps", "stale", "connection status", "check again", "history"],
    target: { kind: "source", source: "glucose", expand: "glucose-health" },
  },
  {
    id: "panel:automation",
    label: "Automatic updates",
    detail: "Background syncing status",
    location: "Glucose source",
    keywords: ["background", "sync", "battery"],
    target: { kind: "source", source: "glucose", expand: "glucose-automation" },
  },
  {
    id: "panel:glucose-ranges",
    label: "Glucose ranges",
    detail: "Target range, low and high levels and their colours",
    location: "Appearance, ranges and colours",
    keywords: ["target", "target range", "range", "low", "high", "colours", "colors", "thresholds", "time in range"],
    target: { kind: "source", source: "appearance", expand: "appearance-ranges" },
  },
  {
    id: "panel:theme",
    label: "App appearance",
    detail: "Light, dark or follow the phone",
    location: "Appearance, ranges and colours",
    keywords: ["theme", "dark mode", "light mode"],
    target: { kind: "source", source: "appearance" },
  },
  {
    id: "panel:phone-display",
    label: "Glucose in notifications",
    detail: "Ongoing glucose notification and lock screen",
    location: "Phone, widget and car",
    keywords: ["notification", "status bar", "lock screen", "iob", "cob", "keep glucose visible", "phone and lock screen"],
    target: { kind: "source", source: "phone" },
  },
  {
    id: "panel:widget",
    label: "Home screen widget",
    detail: "A glucose glance on your home screen",
    location: "Phone, widget and car",
    keywords: ["widget", "home screen", "launcher"],
    target: { kind: "source", source: "phone" },
  },
  {
    id: "panel:always-on",
    label: "Glucose on always-on display",
    detail: "Experimental overlay on the locked dark screen",
    location: "Advanced and experimental",
    keywords: ["aod", "always-on", "always on", "ambient", "overlay", "position", "size"],
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
  ...ALARM_KIND_ENTRIES,
  {
    id: "panel:alarm-sound-level",
    label: "Alarm sound level",
    detail: "Volume and how quickly it rises, for all alerts",
    location: "Alarms",
    keywords: ["volume", "loud", "quiet", "rise", "ramp", "preview"],
    target: { kind: "source", source: "alarms" },
  },
  {
    id: "panel:night-schedule",
    label: "Night schedule",
    detail: "Ordinary high is silent at night; other alerts keep their sounds",
    location: "Alarms",
    keywords: ["night", "quiet hours", "sleep", "silent"],
    target: { kind: "source", source: "alarms" },
  },
  {
    id: "panel:alarm-repeat",
    label: "Repeat while unresolved",
    detail: "How often an alert reminds you",
    location: "Alarms",
    keywords: ["repeat", "remind", "snooze"],
    target: { kind: "source", source: "alarms" },
  },
  {
    id: "panel:hypo-pause",
    label: "Pause low alerts after a hypo treatment",
    detail: "Ordinary low alerts pause after you log a hypo treatment",
    location: "Alarms",
    keywords: ["hypo", "treatment", "pause", "snooze"],
    target: { kind: "source", source: "alarms" },
  },
  {
    id: "panel:high-delay",
    label: "Only alert if high lasts",
    detail: "Delay for high and very high alerts",
    location: "Alarms",
    keywords: ["delay", "persist", "high"],
    target: { kind: "source", source: "alarms" },
  },
  {
    id: "panel:notification-permissions",
    label: "Android notification permissions",
    detail: "Notification settings and precise alarm timing",
    location: "Notifications and reminders",
    keywords: ["permission", "android settings", "exact alarm", "precise", "do not disturb"],
    target: { kind: "source", source: "notifications" },
  },
  {
    id: "panel:weekly-review",
    label: "Weekly review",
    detail: "A weekly Tarv1s review notification",
    location: "Notifications and reminders",
    keywords: ["weekly", "review", "reminder", "schedule"],
    target: { kind: "source", source: "notifications", expand: "notifications-review" },
  },
  {
    id: "panel:backup-reminder",
    label: "Weekly backup reminder",
    detail: "A quiet note in backup settings",
    location: "Backup and privacy",
    keywords: ["backup", "reminder", "weekly"],
    target: { kind: "source", source: "privacy", expand: "privacy-backup" },
  },
  {
    id: "panel:glucose-unit",
    label: "Glucose unit",
    detail: "mmol/L or mg/dL",
    location: "Units and region",
    keywords: ["mmol", "mmol/l", "mg/dl", "mgdl", "units"],
    target: { kind: "source", source: "region" },
  },
  {
    id: "panel:time-zone",
    label: "Time zone",
    detail: "Follow the phone or keep a home time zone",
    location: "Units and region",
    keywords: ["timezone", "travel", "clock"],
    target: { kind: "source", source: "region", expand: "region-more" },
  },
  {
    id: "panel:dexcom-history",
    label: "Dexcom Clarity history",
    detail: "Add older glucose from a Clarity file",
    location: "Dexcom Share",
    keywords: ["clarity", "csv", "import", "older"],
    target: { kind: "source", source: "dexcom", expand: "dexcom-history" },
  },
  {
    id: "panel:nightscout-history",
    label: "Nightscout full history",
    detail: "Import older readings and treatments from your site",
    location: "Nightscout",
    keywords: ["older", "history", "import", "backfill"],
    target: { kind: "source", source: "nightscout" },
  },
  {
    id: "panel:food-totals",
    label: "Food totals",
    detail: "Choose which food diary counts carbohydrate",
    location: "Health and insulin data",
    keywords: ["food", "carbs", "carbohydrate", "nutrition", "count carbs", "diary"],
    target: { kind: "source", source: "healthdata" },
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
    id: "panel:update-alerts",
    label: "Update alerts",
    detail: "Get one notification when a new version is out",
    location: "About T1 Arc",
    keywords: ["update", "updates", "new version", "release", "upgrade", "notify me"],
    target: { kind: "source", source: "about" },
  },
  {
    id: "screen:tarvis",
    label: "Tarv1s connection and privacy",
    detail: "AI provider connection and privacy",
    location: "Tarv1s and diabetes profile",
    keywords: ["tarvis", "tarv1s", "ai", "assistant", "chatgpt", "openai", "gemini", "claude", "api key"],
    target: { kind: "screen", screen: "TarvisSettings" },
  },
  {
    id: "screen:feedback",
    label: "Share feedback",
    detail: "Suggest a feature or manage your weekly reminder",
    location: "Help, feedback and tour",
    keywords: ["feedback", "suggest", "reminder", "community"],
    target: { kind: "screen", screen: "Feedback" },
  },
  {
    id: "screen:cycle",
    label: "Cycle tracking",
    detail: "Periods, symptoms and cycle history",
    location: "Health and insulin data",
    keywords: ["period", "menstrual", "cycle", "hormone"],
    target: { kind: "screen", screen: "Cycle" },
  },
  {
    id: "screen:tour",
    label: "Take the T1 Arc tour",
    detail: "A short guide to the app",
    location: "Help, feedback and tour",
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
