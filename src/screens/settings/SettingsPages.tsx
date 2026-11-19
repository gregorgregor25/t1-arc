import { useContext, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import T1ArcGlucoseDisplay from "../../../modules/t1arc-glucose-display";
import { AapsSourceCard } from "@/components/AapsSourceCard";
import { AppInfoCard } from "@/components/AppInfoCard";
import { DexcomClarityImportCard } from "@/components/DexcomClarityImportCard";
import { DexcomShareSourceCard } from "@/components/DexcomShareSourceCard";
import { EncryptedBackupCard } from "@/components/EncryptedBackupCard";
import { FeatureEntry } from "@/components/FeatureEntry";
import { FoodSourceCard } from "@/components/FoodSourceCard";
import { GlookoImportCard } from "@/components/GlookoImportCard";
import { GlucoseAlertSettingsCard } from "@/components/GlucoseAlertSettingsCard";
import { GlucoseAppearanceSettingsScreen } from "@/components/GlucoseAppearanceSettings";
import { GlucoseDisplayCard } from "@/components/GlucoseDisplayCard";
import { HealthConnectCard } from "@/components/HealthConnectCard";
import { HealthConnectRecordReview } from "@/components/HealthConnectRecordReview";
import { HevySourceCard } from "@/components/HevySourceCard";
import { HomeGlucoseWidgetCard } from "@/components/HomeGlucoseWidgetCard";
import { InsightReviewScheduleCard } from "@/components/InsightReviewScheduleCard";
import { LocalDataControlCard } from "@/components/LocalDataControlCard";
import { MaintainerMigrationCard } from "@/components/MaintainerMigrationCard";
import { MedtrumSourceCard } from "@/components/MedtrumSourceCard";
import { NightscoutSourceCard } from "@/components/NightscoutSourceCard";
import { NotificationSourceCard } from "@/components/NotificationSourceCard";
import { PrivacyPolicyLink } from "@/components/PrivacyPolicyLink";
import { RecordExportPanel } from "@/components/RecordExportPanel";
import { RegionalSettingsCard } from "@/components/RegionalSettingsCard";
import { SectionCard } from "@/components/SectionCard";
import { StravaSourceCard } from "@/components/StravaSourceCard";
import { SupportReportCard } from "@/components/SupportReportCard";
import { TarvisTreatmentProfileCard } from "@/components/TarvisTreatmentProfileCard";
import { ThemePreferenceCard } from "@/components/ThemePreferenceCard";
import { UsageReportingCard } from "@/components/UsageReportingCard";
import { WearCompanionCard } from "@/components/WearCompanionCard";
import { XdripSourceCard } from "@/components/XdripSourceCard";
import { ListGroup, ListRow } from "@/components/ui";
import { openGlucoseAlarmExactAlarmSettings } from "@/data/glucoseAlerts/glucoseAlarms";
import type { GlucoseAlarmKind } from "@/domain/glucoseAlarms";
import { resolveRegionalDefaults } from "@/domain/regionalProfile";
import { useLatestData } from "@/hooks/useTimeline";
import {
  DIABETES_PROFILE_MENU_ITEM,
  SOURCE_MENU_SECTIONS,
  type SourceJump,
} from "@/navigation/sourceNavigation";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";

import { GlucoseSourcePage } from "./GlucoseSourcePage";
import { LibreDraftRetentionContext, LibreSettingsPage } from "./LibreSettingsPage";
import { SettingsDisclosure } from "./SettingsDisclosure";
import type { SettingsPageProps } from "./settingsPageTypes";

export type SettingsScreenTarget = "Feedback" | "Cycle" | "TarvisSettings" | "Tour";

const ALARM_EDITOR_PREFIX = "alarm-";
const ALARM_KINDS: readonly GlucoseAlarmKind[] = ["urgentLow", "low", "high", "veryHigh", "stale"];

/** The alarm editor named by an expanded-panel key such as `alarm-low`. */
export function alarmKindFromPanel(panel: string | undefined): GlucoseAlarmKind | undefined {
  if (!panel?.startsWith(ALARM_EDITOR_PREFIX)) return undefined;
  const kind = panel.slice(ALARM_EDITOR_PREFIX.length);
  return (ALARM_KINDS as readonly string[]).includes(kind) ? (kind as GlucoseAlarmKind) : undefined;
}

/**
 * Whether the current glucose source reports live readings. A stored sign-in
 * is not proof that a source is usable, so display and alert controls unlock
 * only after the active source reports live.
 */
function useGlucoseSourceReady() {
  const latest = useLatestData();
  const liveStatus = latest.sources.find(
    (source) =>
      source.id === "t1arc-live-glucose" ||
      source.id === "t1arc-librelinkup",
  );
  return Boolean(liveStatus?.isLive);
}

export function SettingsPageContent({
  page,
  openScreen,
  ...props
}: SettingsPageProps & {
  page: SourceJump;
  openScreen(screen: SettingsScreenTarget): void;
}) {
  // Same defaults as before the redesign: the saved profile alone decides the
  // suggested Dexcom and Medtrum regions.
  const { profile } = useRegionalProfile();
  const regional = useMemo(() => resolveRegionalDefaults(profile), [profile]);
  const { expanded, toggle, setExpanded, openPage, onDataChanged } = props;

  switch (page) {
    case "glucose":
      return <GlucoseSourcePage {...props} />;
    case "libre":
      return <LibreSettingsPage />;
    case "aaps":
      return (
        <View style={styles.sections}>
          <AapsSourceCard
            foodTotals={<FoodSourceCard />}
            onDataChanged={onDataChanged}
            onOpenNightscout={() => openPage("nightscout")}
          />
        </View>
      );
    case "nightscout":
      return (
        <View style={styles.sections}>
          <NightscoutSourceCard />
        </View>
      );
    case "dexcom":
      return (
        <View style={styles.sections}>
          <DexcomShareSourceCard defaultRegion={regional.dexcomRegion} />
          <SettingsDisclosure
            detail="Add older glucose from a Dexcom Clarity CSV if you need it."
            expanded={expanded === "dexcom-history"}
            icon="time-outline"
            onToggle={() => toggle("dexcom-history")}
            title="Older history (optional)"
          >
            <DexcomClarityImportCard />
          </SettingsDisclosure>
        </View>
      );
    case "medtrum":
      return (
        <View style={styles.sections}>
          <MedtrumSourceCard defaultRegion={regional.medtrumRegion} />
        </View>
      );
    case "xdrip":
      return (
        <View style={styles.sections}>
          <XdripSourceCard />
        </View>
      );
    case "notification":
      return (
        <View style={styles.sections}>
          <NotificationSourceCard onConnected={onDataChanged} />
        </View>
      );
    case "alarms":
      return <AlarmsPage {...props} />;
    case "phone":
    case "display":
      return <PhonePage openPage={openPage} />;
    case "watch":
      return <WearCompanionCard />;
    case "healthdata":
      return <HealthDataPage openPage={openPage} openScreen={openScreen} />;
    case "health":
      return (
        <View style={styles.sections}>
          <HealthConnectCard onDataChanged={onDataChanged} />
          <SettingsDisclosure
            detail="Review the Health Connect entries available in T1 Arc."
            expanded={expanded === "health-records"}
            icon="list-outline"
            onToggle={() => toggle("health-records")}
            title="View imported data"
          >
            <HealthConnectRecordReview />
          </SettingsDisclosure>
        </View>
      );
    case "glooko":
      return (
        <View style={styles.sections}>
          <GlookoImportCard />
        </View>
      );
    case "hevy":
      return (
        <View style={styles.sections}>
          <HevySourceCard onDataChanged={onDataChanged} />
        </View>
      );
    case "strava":
      return (
        <View style={styles.sections}>
          <StravaSourceCard onOpenHealthConnect={() => openPage("health")} />
        </View>
      );
    case "privacy":
      return <BackupPrivacyPage {...props} />;
    case "notifications":
      return <NotificationsPage {...props} openScreen={openScreen} />;
    case "region":
      return (
        <View style={styles.sections}>
          <RegionalSettingsCard
            moreOptionsOpen={expanded === "region-more"}
            onToggleMoreOptions={() => toggle("region-more")}
            showHeading={false}
          />
        </View>
      );
    case "appearance":
      return (
        <View style={styles.sections}>
          <FeatureEntry
            title="Glucose ranges"
            detail="Your target range, low and high levels, and their colours"
            icon="options-outline"
            onPress={() => setExpanded("appearance-ranges")}
          />
          <GlucoseAppearanceSettingsScreen
            onClose={() => setExpanded(undefined)}
            visible={expanded === "appearance-ranges"}
          />
          <ThemePreferenceCard />
        </View>
      );
    case "tarvis":
      return (
        <View style={styles.sections}>
          <ListGroup>
            <ListRow
              accessibilityLabel="Open Tarv1s settings"
              accessibilityHint="Manage your AI provider connection and privacy"
              detail="AI provider connection and privacy"
              onPress={() => openScreen("TarvisSettings")}
              title="Tarv1s connection and privacy"
            />
            <ListRow
              accessibilityHint="Opens your diabetes profile"
              detail={DIABETES_PROFILE_MENU_ITEM.detail}
              onPress={() => openPage("profile")}
              title={DIABETES_PROFILE_MENU_ITEM.label}
            />
          </ListGroup>
        </View>
      );
    case "profile":
      return (
        <View style={styles.sections}>
          <TarvisTreatmentProfileCard />
        </View>
      );
    case "help":
      return (
        <View style={styles.sections}>
          <ListGroup>
            <ListRow
              detail="Help shape T1 Arc and manage your weekly reminder"
              onPress={() => openScreen("Feedback")}
              title="Share feedback"
            />
            <ListRow
              detail="Report a problem or export technical diagnostics"
              onPress={() => openPage("support")}
              title="Help and support"
            />
            <ListRow
              accessibilityHint="Opens a short visual guide to the app."
              detail="A quick guide to Today, logging, History, Health and Tarv1s."
              onPress={() => openScreen("Tour")}
              title="Take the T1 Arc tour"
            />
          </ListGroup>
        </View>
      );
    case "support":
      return (
        <View style={styles.sections}>
          <FeatureEntry title="Share feedback" detail="Suggest a feature, email support or visit the community" icon="chatbubble-outline" onPress={() => openScreen("Feedback")} />
          <SupportReportCard />
        </View>
      );
    case "about":
      return (
        <View style={styles.sections}>
          <AppInfoCard />
        </View>
      );
    case "advanced":
      return <AdvancedPage {...props} />;
  }
}

function AlarmsPage({ expanded, setExpanded }: SettingsPageProps) {
  const glucoseSourceReady = useGlucoseSourceReady();
  return (
    <View style={styles.sections}>
      <GlucoseAlertSettingsCard
        connected={glucoseSourceReady}
        onOpenKind={(kind) => setExpanded(kind ? `${ALARM_EDITOR_PREFIX}${kind}` : undefined)}
        openKind={alarmKindFromPanel(expanded)}
      />
    </View>
  );
}

function PhonePage({ openPage }: Pick<SettingsPageProps, "openPage">) {
  const { colors } = useAppTheme();
  const glucoseSourceReady = useGlucoseSourceReady();
  return (
    <View style={styles.sections}>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        Where your glucose shows outside the app.
      </Text>
      <GlucoseDisplayCard
        connected={glucoseSourceReady}
        onOpenAdvanced={() => openPage("advanced")}
      />
      <HomeGlucoseWidgetCard />
      <ListGroup label="More places · experimental">
        <ListRow
          detail="Position and size are in Advanced and experimental"
          onPress={() => openPage("advanced")}
          title="Always-on display"
        />
        <ListRow
          detail="A glucose card while driving, in Advanced and experimental"
          onPress={() => openPage("advanced")}
          title="Android Auto"
        />
        <ListRow detail="Open from Today's menu" title="Bedside view" />
        <ListRow
          detail="Has its own page in Settings"
          onPress={() => openPage("watch")}
          title="Watch and watch faces"
        />
      </ListGroup>
    </View>
  );
}

function HealthDataPage({
  openPage,
  openScreen,
}: Pick<SettingsPageProps, "openPage"> & { openScreen(screen: SettingsScreenTarget): void }) {
  const items = SOURCE_MENU_SECTIONS.find((section) => section.id === "health")!.items;
  return (
    <View style={styles.sections}>
      <ListGroup label="Connections">
        {items.map((item) => (
          <ListRow
            accessibilityHint={`Opens ${item.label} settings`}
            accessibilityLabel={item.source === "glooko" ? "Open Glooko connection" : undefined}
            detail={item.detail}
            key={item.source}
            onPress={() => openPage(item.source)}
            title={item.label}
          />
        ))}
      </ListGroup>
      <FoodSourceCard />
      <ListGroup label="Also in the Health tab">
        <ListRow
          detail="Periods, symptoms and cycle history"
          onPress={() => openScreen("Cycle")}
          title="Cycle tracking"
        />
      </ListGroup>
    </View>
  );
}

function BackupPrivacyPage({ expanded, toggle, onDataChanged }: SettingsPageProps) {
  const { colors } = useAppTheme();
  const libreDraft = useContext(LibreDraftRetentionContext);
  return (
    <View style={styles.sections}>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        Your records live only on this phone. A backup is a locked file you
        keep, so you can move to a new phone or recover.
      </Text>
      <SettingsDisclosure
        detail="Create or restore a protected copy of your data that you control."
        expanded={expanded === "privacy-backup"}
        icon="lock-closed-outline"
        onToggle={() => toggle("privacy-backup")}
        title="Encrypted backup"
      >
        <EncryptedBackupCard onDataChanged={onDataChanged} />
      </SettingsDisclosure>
      <SettingsDisclosure
        detail="Save glucose, insulin and carbohydrate records as files, or a clinic report."
        expanded={expanded === "privacy-export"}
        icon="document-text-outline"
        onToggle={() => toggle("privacy-export")}
        title="Export records"
      >
        <SectionCard><RecordExportPanel /></SectionCard>
      </SettingsDisclosure>
      <Text accessibilityRole="header" style={[styles.groupLabel, { color: colors.textTertiary }]}>
        Privacy
      </Text>
      <SectionCard><UsageReportingCard /></SectionCard>
      <SectionCard><PrivacyPolicyLink /></SectionCard>
      <SettingsDisclosure
        detail="Inspect or remove personal data stored on this device."
        expanded={expanded === "privacy-device"}
        icon="phone-portrait-outline"
        onToggle={() => toggle("privacy-device")}
        title="Device data controls"
      >
        <LocalDataControlCard
          hasUnsavedSignIn={Boolean(libreDraft?.read())}
          onErased={() => libreDraft?.clearAfterErase()}
        />
      </SettingsDisclosure>
    </View>
  );
}

function NotificationsPage({
  expanded,
  toggle,
  openPage,
  openScreen,
}: SettingsPageProps & { openScreen(screen: SettingsScreenTarget): void }) {
  const { colors } = useAppTheme();
  const [message, setMessage] = useState<string>();
  return (
    <View style={styles.sections}>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        Every notification and reminder T1 Arc can show, in one place. Each
        link opens the page where that choice is kept.
      </Text>
      <ListGroup label="Glucose">
        <ListRow detail="Levels, sounds and night schedule" onPress={() => openPage("alarms")} title="Alarms" />
        <ListRow detail="Ongoing glucose notification and lock screen" onPress={() => openPage("phone")} title="Glucose in notifications" />
        <ListRow detail="Notification access for reading another app's glucose" onPress={() => openPage("notification")} title="Another app's notification" />
      </ListGroup>
      <ListGroup label="Reminders">
        <ListRow detail="Turn the weekly reminder on or off" onPress={() => openScreen("Feedback")} title="Weekly feedback reminder" />
        <ListRow detail="A quiet note in backup settings, not a notification" onPress={() => openPage("privacy", "privacy-backup")} title="Weekly backup reminder" />
      </ListGroup>
      <SettingsDisclosure
        detail="Choose the day and time for a weekly Tarv1s review notification."
        expanded={expanded === "notifications-review"}
        icon="calendar-outline"
        onToggle={() => toggle("notifications-review")}
        title="Weekly review"
      >
        <InsightReviewScheduleCard />
      </SettingsDisclosure>
      <ListGroup label="Android settings">
        <ListRow
          accessibilityRole="link"
          detail="Opens Android's notification settings for T1 Arc"
          onPress={() => void T1ArcGlucoseDisplay.openGlucoseAlertAppSettingsAsync().catch(() => false)}
          title="Android notification settings"
        />
        <ListRow
          accessibilityRole="link"
          detail="Lets alarms fire on time while the phone is idle"
          onPress={() => {
            setMessage(undefined);
            void openGlucoseAlarmExactAlarmSettings().catch((error: unknown) =>
              setMessage(error instanceof Error ? error.message : "Android alarm timing settings could not be opened."),
            );
          }}
          title="Allow precise alarm timing"
        />
      </ListGroup>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={[styles.intro, { color: colors.danger }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function AdvancedPage({ expanded, toggle, onDataChanged }: SettingsPageProps) {
  const { colors } = useAppTheme();
  const glucoseSourceReady = useGlucoseSourceReady();
  return (
    <View style={styles.sections}>
      <SectionCard>
        <Text style={[styles.intro, { color: colors.textSecondary }]}>
          These features are still being tested. They may change, or may
          not work on every phone. Your records do not depend on them.
        </Text>
      </SectionCard>
      <GlucoseDisplayCard
        connected={glucoseSourceReady}
        variant="advanced"
      />
      {__DEV__ ? (
        <SettingsDisclosure
          detail="Only for a protected migration bundle from an earlier T1 Arc test installation."
          expanded={expanded === "advanced-migration"}
          icon="swap-horizontal-outline"
          onToggle={() => toggle("advanced-migration")}
          title="Earlier test-app migration"
        >
          <MaintainerMigrationCard onDataChanged={onDataChanged} />
        </SettingsDisclosure>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sections: {
    marginTop: 4,
    gap: 12,
  },
  intro: {
    fontSize: 15,
    lineHeight: 21,
  },
  groupLabel: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 0.4,
    paddingTop: 6,
    textTransform: "uppercase",
  },
});
