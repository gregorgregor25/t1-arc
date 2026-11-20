import Ionicons from "@expo/vector-icons/Ionicons";

/**
 * Every page that Settings can show. The route param keeps its historical
 * name (`source`) so existing links such as `t1arc://sources/glooko` keep
 * working. New pages were added beside the old ones; none was renamed.
 */
export type SourceJump =
  // Six main places on the Settings home.
  | "glucose"
  | "alarms"
  | "phone"
  | "watch"
  | "healthdata"
  | "privacy"
  // The short list under them.
  | "notifications"
  | "region"
  | "appearance"
  | "tarvis"
  | "help"
  | "about"
  | "advanced"
  // Glucose source pages (children of "glucose").
  | "aaps"
  | "xdrip"
  | "notification"
  | "libre"
  | "dexcom"
  | "nightscout"
  | "medtrum"
  // Health and insulin data pages (children of "healthdata").
  | "health"
  | "glooko"
  | "hevy"
  | "strava"
  // Other child pages.
  | "profile"
  | "support"
  // Earlier page, kept so old links and shortcuts still open something useful.
  | "display";

/** A one-off request to open a panel when Settings is shown. */
export type SourceSettingsPanel = "source-health" | "display-alerts";

export interface SourceMenuItem {
  source: SourceJump;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  /**
   * Set when the connector is implemented and contract-tested but has not
   * been checked with a real account (docs/REGIONAL_CAPABILITY_MATRIX.md).
   */
  notTestedWithRealAccount?: true;
}

export const NOT_TESTED_WITH_REAL_ACCOUNT_LABEL =
  "Not yet tested with a real account";

export const DIABETES_PROFILE_MENU_ITEM = {
  source: "profile",
  label: "Diabetes profile",
  detail: "Carb ratios and personal diabetes settings",
  icon: "person-circle-outline",
} as const satisfies SourceMenuItem;

export type SourceMenuSectionId =
  | "main"
  | "more"
  | "glucose-phone"
  | "glucose-online"
  | "health"
  | "tarvis"
  | "help";

/**
 * Settings, in the order people see it: the six main places, the short list,
 * then the pages one level deeper (grouped by the page that lists them).
 */
export const SOURCE_MENU_SECTIONS: {
  id: SourceMenuSectionId;
  title: string;
  items: SourceMenuItem[];
}[] = [
  {
    id: "main",
    title: "Settings",
    items: [
      {
        source: "glucose",
        label: "Glucose source",
        detail: "Where your readings come from",
        icon: "pulse-outline",
      },
      {
        source: "alarms",
        label: "Alarms",
        detail: "Levels, sounds and night schedule",
        icon: "notifications-outline",
      },
      {
        source: "phone",
        label: "Phone, widget and car",
        detail: "Notification, lock screen, widget, Android Auto",
        icon: "phone-portrait-outline",
      },
      {
        source: "watch",
        label: "Watch",
        detail: "Guided watch setup, companion and faces",
        icon: "watch-outline",
      },
      {
        source: "healthdata",
        label: "Health and insulin data",
        detail: "Health Connect, Glooko, Hevy, food totals",
        icon: "fitness-outline",
      },
      {
        source: "privacy",
        label: "Backup and privacy",
        detail: "Backup, restore, export, erase",
        icon: "shield-checkmark-outline",
      },
    ],
  },
  {
    id: "more",
    title: "More settings",
    items: [
      {
        source: "notifications",
        label: "Notifications and reminders",
        detail: "Android permissions, weekly review, feedback and backup reminders",
        icon: "notifications-circle-outline",
      },
      {
        source: "region",
        label: "Units and region",
        detail: "Glucose unit, country, number formats and time zone",
        icon: "globe-outline",
      },
      {
        source: "appearance",
        label: "Appearance, ranges and colours",
        detail: "Light or dark theme, glucose ranges and their colours",
        icon: "color-palette-outline",
      },
      {
        source: "tarvis",
        label: "Tarv1s and diabetes profile",
        detail: "AI provider connection, privacy and carb ratios",
        icon: "chatbubble-ellipses-outline",
      },
      {
        source: "help",
        label: "Help, feedback and tour",
        detail: "Share feedback, report a problem, take the tour",
        icon: "help-buoy-outline",
      },
      {
        source: "about",
        label: "About and updates",
        detail: "Version, updates, build details and source code",
        icon: "information-circle-outline",
      },
      {
        source: "advanced",
        label: "Advanced and experimental",
        detail: "Always-on display, Android Auto and other features still being tested",
        icon: "flask-outline",
      },
    ],
  },
  {
    id: "glucose-phone",
    title: "Apps on this phone · no account needed",
    items: [
      {
        source: "aaps",
        label: "AAPS on this phone",
        detail: "Glucose, direction, insulin and carbs on board from AAPS",
        icon: "pulse-outline",
      },
      {
        source: "xdrip",
        label: "xDrip+",
        detail: "Reads xDrip+ or Juggluco running on this phone",
        icon: "git-network-outline",
      },
      {
        source: "notification",
        label: "Another app's notification",
        detail: "Reads glucose from a supported app's notification",
        icon: "notifications-outline",
      },
    ],
  },
  {
    id: "glucose-online",
    title: "Online account · needs internet",
    items: [
      {
        source: "libre",
        label: "LibreLinkUp",
        detail: "FreeStyle Libre follower sign-in",
        icon: "pulse-outline",
      },
      {
        source: "dexcom",
        label: "Dexcom Share",
        detail: "Dexcom Share sign-in and Clarity history",
        icon: "analytics-outline",
        notTestedWithRealAccount: true,
      },
      {
        source: "nightscout",
        label: "Nightscout",
        detail: "Your own site, read only",
        icon: "cloud-outline",
      },
      {
        source: "medtrum",
        label: "Medtrum EasyFollow",
        detail: "Medtrum follower sign-in",
        icon: "people-outline",
        notTestedWithRealAccount: true,
      },
    ],
  },
  {
    id: "health",
    title: "Health and insulin data",
    items: [
      {
        source: "health",
        label: "Health Connect",
        detail: "Health, activity and food",
        icon: "fitness-outline",
      },
      {
        source: "glooko",
        label: "Glooko",
        detail: "Pump and insulin history",
        icon: "archive-outline",
      },
      {
        source: "hevy",
        label: "Hevy",
        detail: "Strength workout detail",
        icon: "barbell-outline",
      },
      {
        source: "strava",
        label: "Strava",
        detail: "Activities via Health Connect",
        icon: "bicycle-outline",
      },
    ],
  },
  {
    id: "tarvis",
    title: "Tarv1s and diabetes profile",
    items: [DIABETES_PROFILE_MENU_ITEM],
  },
  {
    id: "help",
    title: "Help, feedback and tour",
    items: [
      {
        source: "support",
        label: "Help and support",
        detail: "Report a problem or export technical diagnostics",
        icon: "help-buoy-outline",
      },
    ],
  },
];

/** Pages kept only so earlier links still open; not listed or searched. */
export const LEGACY_SOURCE_MENU_ITEMS: readonly SourceMenuItem[] = [
  {
    source: "display",
    label: "Phone, widget and car",
    detail: "Display settings moved to Phone, widget and car, Alarms and Appearance",
    icon: "phone-portrait-outline",
  },
];

/**
 * Plain answers for "Which source do I need?". Each maps a common setup to the
 * Settings page that connects it. T1 Arc only reads from these sources.
 */
export const SOURCE_CHOOSER_ANSWERS: readonly {
  question: string;
  answer: string;
  source: SourceJump;
}[] = [
  {
    question: "I use AndroidAPS on this phone",
    answer: "Choose AAPS on this phone. It reads glucose, IOB and COB from AAPS on this phone, even without the internet.",
    source: "aaps",
  },
  {
    question: "I use xDrip+ or Juggluco on this phone",
    answer: "Choose xDrip+. Turn on the app's local web service, then use the same-phone option. It works without the internet.",
    source: "xdrip",
  },
  {
    question: "I use a FreeStyle Libre sensor with the LibreLink app",
    answer: "Choose LibreLinkUp. You need a separate follower account invited from the Libre app.",
    source: "libre",
  },
  {
    question: "I use a Dexcom sensor with the Dexcom app",
    answer: "Choose Dexcom Share and sign in with the account that shares from the Dexcom app.",
    source: "dexcom",
  },
  {
    question: "I use Nightscout",
    answer: "Choose Nightscout and enter your site address. T1 Arc only reads from your site.",
    source: "nightscout",
  },
  {
    question: "My app is not listed here",
    answer: "Try Another app's notification. T1 Arc can read glucose from the notifications of supported apps.",
    source: "notification",
  },
];

export const SOURCE_MENU_ITEMS = SOURCE_MENU_SECTIONS.flatMap(
  (section) => section.items,
);

/** The six main places and the short list, in Settings home order. */
export const SETTINGS_MAIN_PLACES = SOURCE_MENU_SECTIONS.find(
  (section) => section.id === "main",
)!.items;
export const SETTINGS_SHORT_LIST = SOURCE_MENU_SECTIONS.find(
  (section) => section.id === "more",
)!.items;

export const SOURCE_JUMP_VALUES = new Set<SourceJump>([
  ...SOURCE_MENU_ITEMS.map((item) => item.source),
  ...LEGACY_SOURCE_MENU_ITEMS.map((item) => item.source),
]);

/** Menu details for any page, including the earlier pages kept for links. */
export function settingsMenuItem(source: SourceJump): SourceMenuItem {
  return (
    SOURCE_MENU_ITEMS.find((item) => item.source === source) ??
    LEGACY_SOURCE_MENU_ITEMS.find((item) => item.source === source)!
  );
}

export function sourceJumpFromRoute(value: unknown): SourceJump | undefined {
  return typeof value === "string" &&
    SOURCE_JUMP_VALUES.has(value as SourceJump)
    ? (value as SourceJump)
    : undefined;
}

/** Route params are the durable source of truth for the open Settings page. */
export function sourceSettingsRouteParams(source?: SourceJump) {
  return source
    ? ({ focused: true, source } as const)
    : ({ focused: false, source: undefined } as const);
}

export type SourceSettingsBackTarget = "overview" | "previous-screen";

/**
 * A page is a child of the Settings overview, regardless of whether it was
 * opened from the overview itself or directly from the app menu.
 */
export function sourceSettingsBackTarget(
  activeSource?: SourceJump,
): SourceSettingsBackTarget {
  return activeSource ? "overview" : "previous-screen";
}

const PARENT_PAGES: Partial<Record<SourceJump, SourceJump>> = {
  aaps: "glucose",
  xdrip: "glucose",
  notification: "glucose",
  libre: "glucose",
  dexcom: "glucose",
  nightscout: "glucose",
  medtrum: "glucose",
  health: "healthdata",
  glooko: "healthdata",
  hevy: "healthdata",
  strava: "healthdata",
  profile: "tarvis",
  support: "help",
};

/**
 * The page that lists this one. `undefined` means the Settings home. Back
 * from a source page returns to Glucose source, not straight to the home.
 */
export function settingsParentPage(source: SourceJump): SourceJump | undefined {
  return PARENT_PAGES[source];
}

/** Title of the place Back returns to, for the "‹ Settings" link. */
export function settingsBackLabel(source: SourceJump): string {
  const parent = settingsParentPage(source);
  return parent ? settingsMenuItem(parent).label : "Settings";
}

/**
 * Where an incoming request lands. Earlier links named the combined
 * "Display and alerts" page and its panels; those now open the page that holds
 * the same controls. `expand` names a panel on that page to open once.
 */
export function resolveSettingsRequest(
  source: SourceJump | undefined,
  panel?: SourceSettingsPanel,
): { page?: SourceJump; expand?: string } {
  if (panel === "display-alerts") return { page: "alarms" };
  if (panel === "source-health") {
    return { page: "glucose", expand: "glucose-health" };
  }
  if (source === "display") return { page: "phone" };
  return { page: source };
}

const GLUCOSE_SOURCE_PAGES: Readonly<Record<string, SourceJump>> = {
  "aaps-local": "aaps",
  "xdrip-local": "xdrip",
  "android-notification": "notification",
  "t1arc-librelinkup": "libre",
  "dexcom-share": "dexcom",
  nightscout: "nightscout",
  "medtrum-easyfollow": "medtrum",
};

/** The Settings page for a live glucose source id, if it has one. */
export function glucoseSourcePageForSourceId(
  sourceId: string | undefined,
): SourceJump | undefined {
  if (!sourceId) return undefined;
  return Object.prototype.hasOwnProperty.call(GLUCOSE_SOURCE_PAGES, sourceId)
    ? GLUCOSE_SOURCE_PAGES[sourceId]
    : undefined;
}
