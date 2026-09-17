import type { SourceSetupGuideContent } from "@/components/SourceSetupGuide";

import type { SourceJump } from "./sourceNavigation";

export const SOURCE_SETUP_GUIDES: Partial<
  Record<SourceJump, SourceSetupGuideContent>
> = {
  libre: {
    title: "LibreLinkUp",
    intro:
      "Use a separate LibreLinkUp follower account that can already see the glucose you want to follow.",
    steps: [
      "In the FreeStyle Libre app, open Connected Apps or Share and invite the separate LibreLinkUp follower account.",
      "Accept the invitation and confirm that the glucose appears for that follower.",
      "Enter that LibreLinkUp email address and password here.",
      "Test the connection. A current reading confirms that the account is ready.",
    ],
    note: "The sign-in is protected on this phone. Rechecking the same follower keeps its copied history; after a different follower is verified, it replaces this source’s copied history. To avoid Abbott rate limits, do not keep another follower app polling with the same account while T1 Arc is connected.",
  },
  dexcom: {
    title: "Dexcom Share",
    intro:
      "Dexcom Share needs the account that publishes glucose from the Dexcom app, not a follower-only login.",
    steps: [
      "In the Dexcom app, open Connections and make sure Share is on. Create a follower if Share has not been activated yet.",
      "Choose the region used by the Dexcom account.",
      "Enter the publisher username, email or phone number and password. Include the country code for a phone-number login.",
      "Test the connection. T1 Arc should receive the latest reading before it saves the account.",
    ],
    note: "Share supplies current readings and a rolling recent history. Rechecking the same publisher keeps its copied Share history; after a different publisher is verified, it replaces that history. The optional Clarity import is separate and stays protected on this phone.",
  },
  medtrum: {
    title: "Medtrum EasyFollow",
    intro:
      "Medtrum works through a separate follower account rather than the main patient account.",
    steps: [
      "Create a follower account in EasyFollow or EasyView. Do not reuse the main Medtrum account.",
      "Invite the follower from the patient account and accept the invitation.",
      "Choose the correct server, then enter the follower username and password here.",
      "If the account follows more than one person, choose the person whose glucose should appear in T1 Arc.",
    ],
    note: "The follower credentials are protected on this phone. Disconnecting keeps copied glucose. Rechecking the same followed person also keeps it; after a different person is verified, that person replaces this source’s copied history.",
  },
  nightscout: {
    title: "Nightscout",
    intro:
      "Connect to the read-only glucose endpoint for your own Nightscout site.",
    steps: [
      "Enter the full Nightscout site address, including https://.",
      "For a protected site, add either a read-only access token or the legacy API secret. Public sites can leave both blank.",
      "Turn on IOB and COB only if your Nightscout pebble endpoint provides those values.",
      "Test the connection, then optionally choose how far back T1 Arc should build encrypted history.",
    ],
    note: "T1 Arc uses read requests only and never changes your Nightscout site. Rechecking the same site keeps its copied history; after a different site is verified, it replaces this source’s copied glucose, treatments and history progress.",
  },
  xdrip: {
    title: "xDrip",
    intro:
      "T1 Arc reads xDrip’s glucose web service either on this phone or through a secure remote address.",
    steps: [
      "In xDrip, enable its local web service and confirm that glucose is available.",
      "If xDrip is on this phone, use the same-phone preset for 127.0.0.1:17580.",
      "For another device or relay, enter its full HTTPS address.",
      "Test the address before saving it.",
    ],
    note: "Unencrypted local access is accepted only on this phone. Every remote xDrip address must use HTTPS. Rechecking the same address keeps copied history; after a different address is verified, it replaces this source’s copied history.",
  },
  notification: {
    title: "Notification source",
    intro:
      "This option reads supported CGM and loop-app notifications when a direct connection is unavailable.",
    steps: [
      "Keep glucose notifications enabled in the supported app. T1 Arc will show compatible apps detected on this phone.",
      "Choose the app whose notification should be read.",
      "Tap Allow notification source and approve T1 Arc in Android’s notification access screen.",
      "Return to T1 Arc. The status will confirm when access is active.",
    ],
    note: "Only notifications from the selected app are processed and encrypted on this phone. T1 Arc cannot control a sensor, Pod, pump or insulin delivery.",
  },
  health: {
    title: "Health Connect",
    intro:
      "Health Connect is Android’s private bridge for activity, sleep, nutrition and other health records.",
    steps: [
      "Choose the categories you want represented in the Health tab.",
      "Approve the matching read permissions in Android Health Connect.",
      "Return to T1 Arc and start the import. Available history will be organised into its matching health cards.",
      "Use the refresh-history option later if another app adds older records.",
    ],
    note: "Android controls the permissions. T1 Arc stores only approved information in its encrypted database on this phone.",
  },
  glooko: {
    title: "Glooko",
    intro:
      "Glooko supplies delayed pump, insulin and glucose history rather than live treatment state.",
    steps: [
      "Choose the account region and sign in to the matching Glooko consumer account.",
      "Confirm that the date and time format matches your selected regional settings so timezone-free export rows can be stored safely.",
      "Connect the account. T1 Arc checks it once before automatic updates begin.",
      "If automatic updates are unavailable, open Import another way for the ZIP, CSV or Daily Overview options.",
    ],
    note: "Glooko information is delayed and is never presented as live pump state.",
  },
  hevy: {
    title: "Hevy",
    intro:
      "Connect a Hevy Pro account to add exact strength workouts, exercises and sets as read-only context.",
    steps: [
      "Open Hevy on the web and go to Settings, then Developer.",
      "Create or copy the API key for the Hevy Pro account whose workouts you want to use.",
      "Paste the key here. T1 Arc verifies the account before storing it securely.",
      "Completed workouts are checked automatically about every 30 minutes when Android allows background work. Sync now remains available as a recovery option.",
    ],
    note: "T1 Arc only reads Hevy. Disconnecting removes the key but keeps imported workouts; removing those workouts is a separate action.",
  },
  strava: {
    title: "Strava",
    intro:
      "T1 Arc does not sign in to Strava directly. The Strava Android app first writes a new GPS activity to Health Connect, then T1 Arc reads the activity information you allow.",
    steps: [
      "Install and open Strava on this Android phone. In Strava, tap You, then the settings gear, then Manage Apps and Devices, then Health Connect.",
      "Follow Strava’s prompts and allow it to write activity information to Health Connect.",
      "In T1 Arc, open Settings, then Health Connect. Choose Workouts, Distance and Active energy, tap Manage access, and allow those permissions.",
      "Record and save a new GPS activity in Strava. If it does not appear, reopen Strava or refresh its Home feed, then return to T1 Arc and run a Health Connect import.",
    ],
    note: "The Strava screen shows that an activity was received; it cannot prove that sharing is still enabled. Strava currently supplies time, distance and calories for GPS-based activities through Health Connect; T1 Arc cannot retrieve the full Strava workout directly from this route.",
  },
};
