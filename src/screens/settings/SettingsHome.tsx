import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ListGroup, ListRow, NavCard, StatusLine } from "@/components/ui";
import { isBackupReminderDue, loadBackupStatus, type BackupStatus } from "@/data/backup/backupStatus";
import { getGlucoseAlarmStatus, loadGlucoseAlarmSettings } from "@/data/glucoseAlerts/glucoseAlarms";
import type { GlucoseAlarmConfiguration, GlucoseAlarmStatus } from "@/domain/glucoseAlarms";
import { useLatestData } from "@/hooks/useTimeline";
import {
  SETTINGS_MAIN_PLACES,
  SETTINGS_SHORT_LIST,
  type SourceJump,
} from "@/navigation/sourceNavigation";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";

import { alarmSummary, backupSummary, glucoseSourceSummary } from "./settingsStatus";
import { glucoseUnitLabel } from "@/domain/regionalFormat";

/**
 * Reads the saved alarm choices and backup record for the status card. Read
 * only: it never changes alarms, starts monitoring or plays a sound.
 */
function useSettingsStatus() {
  const { revision } = useDataContext();
  const [alarms, setAlarms] = useState<{
    configuration?: GlucoseAlarmConfiguration;
    status?: GlucoseAlarmStatus;
    unavailable?: boolean;
  }>({});
  const [backup, setBackup] = useState<{ status?: BackupStatus; unavailable?: boolean }>({});

  useEffect(() => {
    let active = true;
    void Promise.all([loadGlucoseAlarmSettings(), getGlucoseAlarmStatus()])
      .then(([settings, status]) => {
        if (active) setAlarms({ configuration: settings.configuration, status });
      })
      .catch(() => {
        if (active) setAlarms({ unavailable: true });
      });
    void loadBackupStatus()
      .then((status) => {
        if (active) setBackup({ status });
      })
      .catch(() => {
        if (active) setBackup({ unavailable: true });
      });
    return () => {
      active = false;
    };
  }, [revision]);

  return { alarms, backup };
}

export function SettingsHome({
  onOpenPage,
}: {
  onOpenPage(page: SourceJump, expand?: string): void;
}) {
  const latest = useLatestData();
  const { now } = useDataContext();
  const { defaults: regional } = useRegionalProfile();
  const { alarms, backup } = useSettingsStatus();

  const glucose = glucoseSourceSummary({
    readingSourceId: latest.reading?.sourceId,
    readingTimestamp: latest.reading?.timestamp,
    sources: latest.sources,
    now,
  });
  const alarm = alarms.unavailable
    ? { tone: "attention" as const, title: "Alarms", detail: "Alarm choices could not be read. Open Alarms to check them." }
    : alarmSummary(alarms.configuration, alarms.status);
  const backupLine = backup.unavailable
    ? { tone: "attention" as const, title: "Backup", detail: "Backup status could not be read. Your saved files are unchanged.", due: false }
    : backupSummary(backup.status, backup.status ? isBackupReminderDue(backup.status, now) : false, now);

  return (
    <View style={styles.sections}>
      <ListGroup label="Is everything working?">
        <StatusLine
          action={{
            label: glucose.tone === "off" ? "Choose" : "Open",
            accessibilityHint: "Opens Glucose source",
            onPress: () => onOpenPage("glucose"),
          }}
          detail={glucose.detail}
          statusLabel={glucose.statusLabel}
          title={glucose.title}
          tone={glucose.tone}
        />
        <StatusLine
          action={{
            label: "Open",
            accessibilityHint: "Opens Alarms",
            onPress: () => onOpenPage("alarms"),
          }}
          detail={alarm.detail}
          statusLabel={"statusLabel" in alarm ? alarm.statusLabel : undefined}
          title={alarm.title}
          tone={alarm.tone}
        />
        <StatusLine
          action={
            backupLine.due
              ? {
                  label: "Back up",
                  accessibilityHint: "Opens Encrypted backup in Backup and privacy",
                  onPress: () => onOpenPage("privacy", "privacy-backup"),
                }
              : undefined
          }
          detail={backupLine.detail}
          statusLabel={"statusLabel" in backupLine ? backupLine.statusLabel : undefined}
          title={backupLine.title}
          tone={backupLine.tone}
        />
      </ListGroup>

      <View style={styles.places}>
        {SETTINGS_MAIN_PLACES.map((item) => (
          <NavCard
            accessibilityHint={`Opens ${item.label}`}
            detail={item.detail}
            icon={item.icon}
            key={item.source}
            onPress={() => onOpenPage(item.source)}
            title={item.label}
          />
        ))}
      </View>

      <ListGroup label="More settings">
        {SETTINGS_SHORT_LIST.map((item) => (
          <ListRow
            accessibilityHint={item.detail}
            accessibilityLabel={item.label}
            key={item.source}
            onPress={() => onOpenPage(item.source)}
            title={item.label}
            value={item.source === "region" ? glucoseUnitLabel(regional.glucoseUnit) : undefined}
          />
        ))}
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: 22,
  },
  places: {
    gap: 10,
  },
});
