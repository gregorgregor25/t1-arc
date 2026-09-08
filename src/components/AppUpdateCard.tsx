import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { checkPublicRelease, OFFICIAL_REPOSITORY, type InstalledAppIdentity, type PublicReleaseCheck } from "@/data/updates/publicRelease";
import { useAppTheme } from "@/theme/theme";

export function AppUpdateCard({ installed }: { installed: InstalledAppIdentity }) {
  const { colors, radius } = useAppTheme();
  const [result, setResult] = useState<PublicReleaseCheck>();
  const [checking, setChecking] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

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

  async function open(url: string) {
    try { await Linking.openURL(url); }
    catch { Alert.alert("Could not open GitHub", "Try again when a browser is available."); }
  }

  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>App updates</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Check GitHub when you want to. Nothing downloads or installs automatically.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: checking }} disabled={checking}
        onPress={() => void check()} style={({ pressed }) => [styles.button, { borderColor: colors.border, borderRadius: radius.md, opacity: checking || pressed ? 0.65 : 1 }]}>
        {checking ? <ActivityIndicator color={colors.primary} /> : null}
        <Text style={[styles.buttonText, { color: colors.primary }]}>{checking ? "Checking GitHub…" : "Check for updates"}</Text>
      </Pressable>
      {result ? <View accessibilityLiveRegion="polite" style={styles.result}>
        <Text style={[styles.body, { color: colors.text }]}>{result.kind === "available" ? `Version ${result.version} is available.` : result.message}</Text>
        {result.kind === "available" ? <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showNotes }} onPress={() => setShowNotes(!showNotes)} style={styles.link}>
            <Text style={[styles.buttonText, { color: colors.primary }]}>{showNotes ? "Hide release notes" : "What's changed"}</Text>
          </Pressable>
          {showNotes ? <Text selectable style={[styles.body, { color: colors.textSecondary }]}>{result.notes}</Text> : null}
          <Text style={[styles.body, { color: colors.textSecondary }]}>Create an encrypted backup first. Open the release on GitHub and download its phone APK. Android checks the signing key and asks before updating. Do not uninstall this app if Android rejects an update.</Text>
          <Pressable accessibilityRole="link" onPress={() => void open(result.releaseUrl)} style={styles.link}>
            <Text style={[styles.buttonText, { color: colors.primary }]}>Open release and download</Text>
          </Pressable>
        </> : <Pressable accessibilityRole="link" onPress={() => void open(`${OFFICIAL_REPOSITORY}/releases`)} style={styles.link}>
          <Text style={[styles.buttonText, { color: colors.primary }]}>Read public release information</Text>
        </Pressable>}
      </View> : null}
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
});
