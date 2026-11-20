import { Alert } from '@/components/appAlert';
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { checkPublicRelease, OFFICIAL_REPOSITORY, type InstalledAppIdentity, type PublicReleaseCheck } from "@/data/updates/publicRelease";
import {
  automaticChecksUnsupported,
  getPendingUpdateAsync,
  getUpdateAlertsSettingAsync,
  releaseCheckFromPending,
  setUpdateAlertsEnabledAsync,
} from "@/data/updates/updateAlerts";
import { UPDATE_ALERTS_COPY } from "@/domain/updateAlertsCopy";
import { useAppTheme } from "@/theme/theme";

export function AppUpdateCard({ installed }: { installed: InstalledAppIdentity }) {
  const { colors, radius } = useAppTheme();
  const { applicationId, version, buildNumber } = installed;
  const [result, setResult] = useState<PublicReleaseCheck>();
  // A release the daily check already verified, shown until "Check for updates" runs.
  const [found, setFound] = useState<PublicReleaseCheck>();
  const [checking, setChecking] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  // Opened from the update notification, or a daily check already found a
  // newer release: show what that check verified. This makes no request, so
  // reopening About never adds to the once-a-day check.
  useEffect(() => {
    let active = true;
    getPendingUpdateAsync({ applicationId, version, buildNumber })
      .then((pending) => {
        if (active && pending) setFound(releaseCheckFromPending(pending));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [applicationId, version, buildNumber]);

  async function check() {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setShowNotes(false);
    const next = await checkPublicRelease(installed, { signal: controller.signal });
    if (!controller.signal.aborted) {
      setResult(next);
      setChecking(false);
      request.current = null;
    }
  }

  const shown = result ?? found;

  async function open(url: string) {
    try { await Linking.openURL(url); }
    catch { Alert.alert("Could not open GitHub", "Try again when a browser is available."); }
  }

  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>App updates</Text>
      {automaticChecksUnsupported(installed)
        ? <Text style={[styles.body, { color: colors.textSecondary }]}>{UPDATE_ALERTS_COPY.testBuildNote}</Text>
        : <UpdateAlertsSwitch />}
      <Text style={[styles.body, { color: colors.textSecondary }]}>Check GitHub at any time. Nothing downloads or installs automatically.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: checking }} disabled={checking}
        onPress={() => void check()} style={({ pressed }) => [styles.button, { borderColor: colors.border, borderRadius: radius.md, opacity: checking || pressed ? 0.65 : 1 }]}>
        {checking ? <ActivityIndicator color={colors.primary} /> : null}
        <Text style={[styles.buttonText, { color: colors.primary }]}>{checking ? "Checking GitHub…" : "Check for updates"}</Text>
      </Pressable>
      {shown ? <View accessibilityLiveRegion="polite" style={styles.result}>
        <Text style={[styles.body, { color: colors.text }]}>{shown.kind === "available" ? `Version ${shown.version} is available.` : shown.message}</Text>
        {result ? null : <Text style={[styles.body, { color: colors.textSecondary }]}>{UPDATE_ALERTS_COPY.foundByDailyCheck}</Text>}
        {shown.kind === "available" ? <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showNotes }} onPress={() => setShowNotes(!showNotes)} style={styles.link}>
            <Text style={[styles.buttonText, { color: colors.primary }]}>{showNotes ? "Hide release notes" : "What's changed"}</Text>
          </Pressable>
          {showNotes ? <Text selectable style={[styles.body, { color: colors.textSecondary }]}>{shown.notes}</Text> : null}
          <Text style={[styles.body, { color: colors.textSecondary }]}>Create an encrypted backup first. Open the release on GitHub and download its phone APK. Android checks the signing key and asks before updating. Do not uninstall this app if Android rejects an update.</Text>
          <Pressable accessibilityRole="link" onPress={() => void open(shown.releaseUrl)} style={styles.link}>
            <Text style={[styles.buttonText, { color: colors.primary }]}>Open release and download</Text>
          </Pressable>
        </> : <Pressable accessibilityRole="link" onPress={() => void open(`${OFFICIAL_REPOSITORY}/releases`)} style={styles.link}>
          <Text style={[styles.buttonText, { color: colors.primary }]}>Read public release information</Text>
        </Pressable>}
      </View> : null}
    </View>
  );
}

/**
 * Switch for the daily automatic update check. It always shows the choice
 * stored on this phone; with no stored choice it is on.
 */
function UpdateAlertsSwitch() {
  const { colors } = useAppTheme();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const request = ++sequence.current;
    getUpdateAlertsSettingAsync()
      .then((setting) => {
        if (request !== sequence.current) return;
        setEnabled(setting === "enabled");
        setLoadError(false);
      })
      .catch(() => {
        if (request === sequence.current) setLoadError(true);
      })
      .finally(() => {
        if (request === sequence.current) setLoading(false);
      });
    return () => {
      sequence.current += 1;
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  async function change(value: boolean) {
    const request = ++sequence.current;
    setBusy(true);
    setEnabled(value);
    try {
      await setUpdateAlertsEnabledAsync(value);
    } catch {
      if (request === sequence.current) {
        setBusy(false);
        Alert.alert(UPDATE_ALERTS_COPY.saveErrorTitle, UPDATE_ALERTS_COPY.saveErrorBody);
        // Show what is actually stored rather than the attempted position.
        retry();
      }
      return;
    }
    if (request === sequence.current) setBusy(false);
  }

  return (
    <View>
      <View style={styles.switchRow}>
        <View style={styles.fill}>
          <Text style={[styles.switchLabel, { color: colors.text }]}>{UPDATE_ALERTS_COPY.settingLabel}</Text>
          <Text style={[styles.body, styles.hint, { color: colors.textSecondary }]}>{UPDATE_ALERTS_COPY.settingHint}</Text>
        </View>
        <Switch
          accessibilityLabel={UPDATE_ALERTS_COPY.settingLabel}
          accessibilityHint="Turning this off stops the daily check and removes an update notification."
          value={enabled}
          disabled={busy || loading || loadError}
          onValueChange={(value) => {
            void change(value);
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {loadError ? (
        <Pressable accessibilityRole="button" onPress={retry} style={styles.link}>
          <Text style={[styles.buttonText, { color: colors.primary }]}>{UPDATE_ALERTS_COPY.loadError}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 16, paddingTop: 16, gap: 10 },
  title: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  body: { fontSize: 14, lineHeight: 21 },
  button: { borderWidth: 1, minHeight: 48, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  buttonText: { fontSize: 14, lineHeight: 21, fontWeight: "600" },
  result: { gap: 8 },
  link: { minHeight: 48, paddingVertical: 12, justifyContent: "center" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  fill: { flex: 1 },
  switchLabel: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  hint: { marginTop: 4 },
});
