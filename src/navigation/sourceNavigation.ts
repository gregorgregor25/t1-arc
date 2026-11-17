import Ionicons from "@expo/vector-icons/Ionicons";

export type SourceJump =
  | "profile"
  | "libre"
  | "aaps"
  | "dexcom"
  | "medtrum"
  | "nightscout"
  | "xdrip"
  | "notification"
  | "health"
  | "glooko"
  | "hevy"
  | "strava"
  | "display"
  | "watch"
  | "region"
  | "about"
  | "support"
  | "privacy"
  | "advanced";

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
  | "glucose"
  | "health"
  | "display"
  | "data"
  | "help"
  | "advanced";

export const SOURCE_MENU_SECTIONS: {
  id: SourceMenuSectionId;
  title: string;
  items: SourceMenuItem[];
}[] = [
  {
    id: "glucose",
    title: "Glucose connections",
    items: [
      {
        source: "aaps",
        label: "AAPS local",
        detail: "Glucose, IOB and COB on this phone",
        icon: "pulse-outline",
      },
      {
        source: "libre",
        label: "LibreLinkUp",
        detail: "Direct follower connection",
        icon: "pulse-outline",
      },
      {
        source: "dexcom",
        label: "Dexcom",
        detail: "Share and Clarity history",
        icon: "analytics-outline",
        notTestedWithRealAccount: true,
      },
      {
        source: "nightscout",
        label: "Nightscout",
        detail: "Read-only site",
        icon: "cloud-outline",
      },
      {
        source: "medtrum",
        label: "Medtrum",
        detail: "EasyFollow follower",
        icon: "people-outline",
        notTestedWithRealAccount: true,
      },
      {
        source: "xdrip",
        label: "xDrip",
        detail: "Current readings",
        icon: "git-network-outline",
      },
      {
        source: "notification",
        label: "Notification source",
        detail: "Compatible CGM app",
        icon: "notifications-outline",
      },
    ],
  },
  {
    id: "health",
    title: "Health and insulin",
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
    id: "display",
    title: "Display, alerts and units",
    items: [
      {
        source: "display",
        label: "Display and alerts",
        detail: "Glucose ranges, alerts, theme and glucose displays",
        icon: "notifications-outline",
      },
      {
        source: "watch",
        label: "Watch & watch faces",
        detail: "Guided watch setup, companion and faces",
        icon: "watch-outline",
      },
      {
        source: "region",
        label: "Region and services",
        detail: "Glucose unit, country, number formats and time zone",
        icon: "globe-outline",
      },
    ],
  },
  {
    id: "data",
    title: "Data and backup",
    items: [
      {
        source: "privacy",
        label: "Backup and privacy",
        detail: "Backups, exports and your local data",
        icon: "shield-checkmark-outline",
      },
    ],
  },
  {
    id: "help",
    title: "Help and information",
    items: [
      {
        source: "support",
        label: "Help and support",
        detail: "Report a problem or export technical diagnostics",
        icon: "help-buoy-outline",
      },
      {
        source: "about",
        label: "About T1 Arc",
        detail: "Version, build details and source code",
        icon: "information-circle-outline",
      },
    ],
  },
  {
    id: "advanced",
    title: "Advanced and experimental",
    items: [
      {
        source: "advanced",
        label: "Advanced and experimental",
        detail: "Always-on display, Android Auto and other features still being tested",
        icon: "flask-outline",
      },
    ],
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
    answer: "Choose AAPS local. It reads glucose, IOB and COB from AAPS on this phone, even without the internet.",
    source: "aaps",
  },
  {
    question: "I use a FreeStyle Libre sensor with the LibreLink app",
    answer: "Choose LibreLinkUp. You need a separate follower account invited from the Libre app.",
    source: "libre",
  },
  {
    question: "I use a Dexcom sensor with the Dexcom app",
    answer: "Choose Dexcom and sign in with the account that shares from the Dexcom app.",
    source: "dexcom",
  },
  {
    question: "I use Nightscout",
    answer: "Choose Nightscout and enter your site address. T1 Arc only reads from your site.",
    source: "nightscout",
  },
  {
    question: "I use xDrip+ or Juggluco on this phone",
    answer: "Choose xDrip. Turn on the app's local web service, then use the same-phone option.",
    source: "xdrip",
  },
  {
    question: "My app is not listed here",
    answer: "Try Notification source. T1 Arc can read glucose from the notifications of supported apps.",
    source: "notification",
  },
];

export const SOURCE_MENU_ITEMS = [
  DIABETES_PROFILE_MENU_ITEM,
  ...SOURCE_MENU_SECTIONS.flatMap((section) => section.items),
];

export const SOURCE_JUMP_VALUES = new Set<SourceJump>(
  SOURCE_MENU_ITEMS.map((item) => item.source),
);

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
 * A source detail is a child of the Settings overview, regardless of whether
 * it was opened from the overview itself or directly from the app menu.
 */
export function sourceSettingsBackTarget(
  activeSource?: SourceJump,
): SourceSettingsBackTarget {
  return activeSource ? "overview" : "previous-screen";
}
