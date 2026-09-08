import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { isBackupReminderDue, loadBackupStatus, setBackupReminder, type BackupStatus } from "@/data/backup/backupStatus";
import { formatDate, formatTime, toDateKey } from "@/domain/time";
import { useAppTheme } from "@/theme/theme";

export function BackupCarePanel({ revision }: { revision: number }) {
  const { colors } = useAppTheme();
  const [status, setStatus] = useState<BackupStatus>();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void loadBackupStatus().then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setError("Backup status could not be read. Your saved files are unchanged."); });
    return () => { active = false; };
  }, [revision]);

  async function toggleReminder(value: boolean) {
    setSaving(true);
    setError(undefined);
    try { setStatus(await setBackupReminder(value)); }
    catch { setError("The reminder preference could not be saved. Try again."); }
    finally { setSaving(false); }
  }

  return <View style={styles.container}>
    <Text style={[styles.body, { color: colors.textSecondary }]}>
      {status?.lastExportedAt
        ? `Last saved backup: ${formatDate(toDateKey(Date.parse(status.lastExportedAt)), { day: "numeric", month: "short", year: "numeric" })} at ${formatTime(Date.parse(status.lastExportedAt))}`
        : status ? "No backup date recorded yet." : "Checking backup status…"}
    </Text>
    {status && isBackupReminderDue(status) ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>It has been at least a week. When convenient, save a fresh encrypted backup.</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}
      style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.7 : 1 }]}>
      <Text style={[styles.label, { color: colors.primary }]}>Backups and moving to a new phone</Text>
      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.primary} accessibilityElementsHidden />
    </Pressable>
    {expanded ? <View style={styles.details}>
      <Text style={[styles.body, { color: colors.textSecondary }]}>1. Create an encrypted backup and keep its passphrase somewhere safe. T1 Arc cannot recover a forgotten passphrase.</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>2. Keep a copy somewhere you choose outside this phone. A file in Downloads alone will not protect you if the phone is lost. T1 Arc does not upload your backup automatically.</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>3. On the new phone, install T1 Arc, choose Restore from backup and check the preview before merging. History, saved reviews, Tarv1s conversations and supported preferences restore without removing existing records.</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>4. Reconnect your sources and OpenAI key, and grant Android permissions again. Sign-ins, API keys and permissions are not in the backup. Check your restored history before removing the old app.</Text>
      <View style={styles.reminder}>
        <View style={styles.copy}>
          <Text style={[styles.label, { color: colors.text }]}>Weekly reminder here</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>A quiet note in these backup settings, not a notification.</Text>
        </View>
        <Switch accessibilityLabel="Show a weekly reminder in backup settings" disabled={saving || !status}
          value={status?.reminderEnabled ?? false} onValueChange={(value) => void toggleReminder(value)}
          trackColor={{ true: colors.primary }} />
      </View>
    </View> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.warning }]}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  body: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 14, lineHeight: 21, fontWeight: "600", flexShrink: 1 },
  disclosure: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  details: { gap: 12 },
  reminder: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  copy: { flex: 1, gap: 4 },
});
