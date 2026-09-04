import Ionicons from "@expo/vector-icons/Ionicons";

export type SourceJump =
  | "profile"
  | "libre"
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
  | "privacy";

export interface SourceMenuItem {
  source: SourceJump;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}

export const SETTINGS_OVERVIEW_MENU_ITEM = {
  accessibilityHint:
    "Opens the full Settings screen, including Help and learning and Automatic updates",
  detail: "Help, app tour, automatic updates and every connection",
  icon: "settings-outline",
  label: "All settings",
} as const satisfies Omit<SourceMenuItem, "source"> & {
  accessibilityHint: string;
};

export const DIABETES_PROFILE_MENU_ITEM = {
  source: "profile",
  label: "Diabetes profile",
  detail: "Carb ratios and personal diabetes settings",
  icon: "person-circle-outline",
} as const satisfies SourceMenuItem;

export const SOURCE_MENU_SECTIONS: {
  id: string;
  title: string;
  items: SourceMenuItem[];
}[] = [
  {
    id: "glucose",
    title: "Glucose connections",
    items: [
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
    id: "app",
    title: "Display and privacy",
    items: [
      {
        source: "display",
        label: "Display and alerts",
        detail: "Theme, alerts and glucose displays",
        icon: "watch-outline",
      },
      {
        source: "privacy",
        label: "Backup and privacy",
        detail: "Your local data",
        icon: "shield-checkmark-outline",
      },
    ],
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
