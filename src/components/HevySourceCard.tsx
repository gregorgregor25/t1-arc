import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { HevyWorkoutRepository } from "@/data/hevy/repository";
import { updateHevyBackgroundSyncRegistration } from "@/data/background/hevySyncTask";
import { HevySyncSupersededError } from "@/data/hevy/ownership";
import { loadHevyConnection } from "@/data/hevy/secureStore";
import {
  connectAndSyncHevy,
  disconnectHevy,
  syncHevyConnection,
} from "@/data/hevy/sync";
import type {
  HevyConnection,
  HevySourceStatus,
  HevySyncResult,
} from "@/data/hevy/types";
import { relativeAge } from "@/domain/time";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";

type HevyLoadState = "loading" | "ready" | "unavailable";

export function HevySourceCard({
  onDataChanged,
}: {
  onDataChanged(): Promise<void>;
}) {
  const { colors, radius } = useAppTheme();
  const [connection, setConnection] = useState<HevyConnection>();
  const [status, setStatus] = useState<HevySourceStatus>();
  const [loadState, setLoadState] = useState<HevyLoadState>("loading");
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<HevySyncResult>();
  const [showManage, setShowManage] = useState(false);
  const mounted = useRef(false);

  async function refreshState() {
    const [saved, sourceStatus] = await Promise.all([
      loadHevyConnection(),
      new HevyWorkoutRepository().status(),
    ]);
    if (!mounted.current) return;
    setConnection(saved);
    setStatus({ ...sourceStatus, connected: Boolean(saved) });
    setLoadState("ready");
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.all([
      loadHevyConnection(),
      new HevyWorkoutRepository().status(),
    ])
      .then(([saved, sourceStatus]) => {
        if (!active) return;
        setConnection(saved);
        setStatus({ ...sourceStatus, connected: Boolean(saved) });
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("unavailable");
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  async function retryLoad() {
    setLoadState("loading");
    setError(undefined);
    try {
      await refreshState();
    } catch {
      if (mounted.current) setLoadState("unavailable");
    }
  }

  async function connect() {
    setWorking(true);
    setError(undefined);
    setResult(undefined);
    try {
      const synced = await connectAndSyncHevy(apiKey);
      if (!mounted.current) return;
      setConnection(synced.connection);
      setApiKey("");
      setResult(synced.result);
      // Reloading the provider also reconciles background registration. Keep
      // one owner for that work so a stale card callback cannot register late.
      await Promise.all([refreshState(), onDataChanged()]);
    } catch (reason) {
      if (!mounted.current || reason instanceof HevySyncSupersededError) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Hevy could not be connected.",
      );
      await Promise.all([
        refreshState().catch(() => {
          if (mounted.current) setLoadState("unavailable");
        }),
        onDataChanged().catch(() => undefined),
      ]);
    } finally {
      if (mounted.current) setWorking(false);
    }
  }

  async function sync() {
    setWorking(true);
    setError(undefined);
    setResult(undefined);
    try {
      const synced = await syncHevyConnection();
      if (!mounted.current) return;
      setResult(synced);
      await Promise.all([refreshState(), onDataChanged()]);
    } catch (reason) {
      if (!mounted.current || reason instanceof HevySyncSupersededError) return;
      setError(
        reason instanceof Error ? reason.message : "Hevy could not be synced.",
      );
      await refreshState();
    } finally {
      if (mounted.current) setWorking(false);
    }
  }

  function disconnect() {
    Alert.alert(
      "Disconnect Hevy?",
      "This removes the API key from this phone. Workouts already copied into encrypted history are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setWorking(true);
              setError(undefined);
              try {
                await disconnectHevy();
                await updateHevyBackgroundSyncRegistration().catch(
                  () => false,
                );
                if (!mounted.current) return;
                setConnection(undefined);
                setStatus((current) =>
                  current ? { ...current, connected: false } : current,
                );
                setResult(undefined);
              } catch (reason) {
                if (!mounted.current) return;
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Hevy could not be disconnected.",
                );
              } finally {
                if (mounted.current) setWorking(false);
              }
            })();
          },
        },
      ],
    );
  }

  function removeImportedWorkouts() {
    Alert.alert(
      "Remove imported Hevy workouts?",
      "This disconnects Hevy and removes its workout detail and Hevy-only activity cards from this phone. Matching Health Connect workouts are not removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove workouts",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setWorking(true);
              setError(undefined);
              try {
                await disconnectHevy({ removeImportedWorkouts: true });
                await updateHevyBackgroundSyncRegistration().catch(
                  () => false,
                );
                if (!mounted.current) return;
                setConnection(undefined);
                setResult(undefined);
                await Promise.all([refreshState(), onDataChanged()]);
              } catch (reason) {
                if (!mounted.current) return;
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "The imported Hevy workouts could not be removed.",
                );
              } finally {
                if (mounted.current) setWorking(false);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.accent}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="barbell-outline"
            size={24}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Hevy workouts
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {loadState === "loading"
              ? "Checking the saved Hevy connection on this phone…"
              : loadState === "unavailable"
                ? "The saved connection could not be checked safely."
                : connection
                  ? `${connection.user.name} · ${status?.workoutCount ?? 0} workout${status?.workoutCount === 1 ? "" : "s"} available`
                  : status?.workoutCount
                    ? `${status.workoutCount} imported workout${status.workoutCount === 1 ? "" : "s"} kept on this phone`
                    : "Completed strength workouts for Health and Tarv1s."}
          </Text>
        </View>
      </View>

      {loadState === "loading" ? (
        <View
          accessible
          accessibilityLabel="Checking saved Hevy connection"
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: true }}
          style={[
            styles.status,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.divider,
              borderRadius: radius.md,
            },
          ]}
        >
          <ActivityIndicator
            accessibilityElementsHidden
            color={colors.textTertiary}
            size="small"
          />
          <Text style={[styles.statusText, { color: colors.textSecondary }]}>
            Checking connection…
          </Text>
        </View>
      ) : loadState === "unavailable" ? (
        <>
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.status,
              {
                backgroundColor: `${colors.warning}12`,
                borderColor: `${colors.warning}36`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.warning}
              name="alert-circle-outline"
              size={19}
            />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              Connection status unavailable. No changes have been made.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Check saved Hevy connection again"
            accessibilityRole="button"
            onPress={() => void retryLoad()}
            style={({ pressed }) => [
              styles.secondarySync,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="refresh-outline"
              size={18}
            />
            <Text style={[styles.primaryText, { color: colors.primary }]}>
              Try again
            </Text>
          </Pressable>
        </>
      ) : connection ? (
        <>
          <View
            style={[
              styles.status,
              {
                backgroundColor: `${status?.lastError ? colors.warning : colors.accent}12`,
                borderColor: `${status?.lastError ? colors.warning : colors.accent}36`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={status?.lastError ? colors.warning : colors.accent}
              name={
                status?.lastError
                  ? "alert-circle-outline"
                  : "checkmark-circle-outline"
              }
              size={19}
            />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              {status?.lastError
                ? "Automatic update needs attention. Open More options to try again."
                : `Workouts update automatically${
                    status?.lastSuccessAt
                      ? ` · last checked ${relativeAge(status.lastSuccessAt)}`
                      : ""
                  }`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={
              showManage ? "Hide Hevy options" : "Show more Hevy options"
            }
            accessibilityRole="button"
            accessibilityState={{ expanded: showManage }}
            onPress={() => setShowManage((visible) => !visible)}
            style={({ pressed }) => [
              styles.manageToggle,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.68 : 1,
              },
            ]}
          >
            <Text
              style={[styles.manageToggleText, { color: colors.textSecondary }]}
            >
              {showManage ? "Hide options" : "More options"}
            </Text>
            <Ionicons
              accessibilityElementsHidden
              color={colors.textTertiary}
              name={showManage ? "chevron-up" : "chevron-down"}
              size={17}
            />
          </Pressable>
          {showManage ? (
            <>
              <Pressable
                accessibilityLabel="Check Hevy now"
                accessibilityRole="button"
                accessibilityState={{ busy: working, disabled: working }}
                disabled={working}
                onPress={() => void sync()}
                style={({ pressed }) => [
                  styles.secondarySync,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.68 : 1,
                  },
                ]}
              >
                {working ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="refresh-outline"
                    size={18}
                  />
                )}
                <Text style={[styles.primaryText, { color: colors.primary }]}>
                  {working ? "Checking Hevy…" : "Check now"}
                </Text>
              </Pressable>
              <View style={styles.actionRow}>
                <SecondaryButton label="Disconnect" onPress={disconnect} />
                <SecondaryButton
                  danger
                  label="Remove workouts"
                  onPress={removeImportedWorkouts}
                />
              </View>
            </>
          ) : null}
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: colors.text }]}>
            Hevy API key
          </Text>
          <View
            style={[
              styles.keyRow,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radius.md,
              },
            ]}
          >
            <TextInput
              accessibilityLabel="Hevy API key"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setApiKey}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              placeholderTextColor={colors.textTertiary}
              secureTextEntry={!keyVisible}
              style={[styles.keyInput, { color: colors.text }]}
              value={apiKey}
            />
            <Pressable
              accessibilityLabel={
                keyVisible ? "Hide Hevy API key" : "Show Hevy API key"
              }
              accessibilityRole="button"
              onPress={() => setKeyVisible((current) => !current)}
              style={styles.eye}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.textSecondary}
                name={keyVisible ? "eye-off-outline" : "eye-outline"}
                size={21}
              />
            </Pressable>
          </View>
          <Text style={[styles.help, { color: colors.textTertiary }]}>
            Available to Hevy Pro accounts from Hevy web settings. T1 Arc only
            reads completed workouts and checks automatically.
          </Text>
          <Pressable
            accessibilityLabel="Connect Hevy"
            accessibilityRole="button"
            accessibilityState={{
              busy: working,
              disabled: working || !apiKey.trim(),
            }}
            disabled={working || !apiKey.trim()}
            onPress={() => void connect()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor:
                  working || !apiKey.trim()
                    ? colors.surfaceMuted
                    : colors.primary,
                borderRadius: radius.md,
                opacity: pressed ? 0.74 : 1,
              },
            ]}
          >
            {working ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Ionicons
                accessibilityElementsHidden
                color={apiKey.trim() ? colors.onPrimary : colors.textTertiary}
                name="shield-checkmark-outline"
                size={19}
              />
            )}
            <Text
              style={[
                styles.primaryText,
                {
                  color: apiKey.trim() ? colors.onPrimary : colors.textTertiary,
                },
              ]}
            >
              {working ? "Checking and importing…" : "Connect Hevy"}
            </Text>
          </Pressable>
          {status?.workoutCount ? (
            <Pressable
              accessibilityLabel="Remove imported Hevy workouts"
              accessibilityRole="button"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={removeImportedWorkouts}
              style={styles.removeOnly}
            >
              <Text style={[styles.removeText, { color: colors.danger }]}>
                Remove the {status.workoutCount} workouts kept on this phone
              </Text>
            </Pressable>
          ) : null}
        </>
      )}

      {result ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.result, { color: colors.accent }]}
        >
          Workouts updated.
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={[styles.error, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
      {status?.lastError && !error && (!connection || showManage) ? (
        <Text style={[styles.error, { color: colors.danger }]}>
          Last sync: {status.lastError}
        </Text>
      ) : null}
    </SectionCard>
  );

  function SecondaryButton({
    danger = false,
    label,
    onPress,
  }: {
    danger?: boolean;
    label: string;
    onPress(): void;
  }) {
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled: working }}
        disabled={working}
        onPress={onPress}
        style={({ pressed }) => [
          styles.secondaryButton,
          {
            borderColor: danger ? `${colors.danger}66` : colors.border,
            borderRadius: radius.md,
            opacity: pressed || working ? 0.64 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.secondaryText,
            { color: danger ? colors.danger : colors.primary },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  body: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  label: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 18,
    marginBottom: 6,
  },
  keyRow: {
    minHeight: 54,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  keyInput: { flex: 1, minHeight: 52, paddingLeft: 14, fontSize: 13 },
  eye: {
    width: 52,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  help: { fontSize: 12, lineHeight: 18, marginTop: 7 },
  status: {
    minHeight: 48,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusText: { flex: 1, fontSize: 12, lineHeight: 18 },
  primaryButton: {
    minHeight: 54,
    marginTop: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  manageToggle: {
    minHeight: 48,
    marginTop: 12,
    paddingHorizontal: 13,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  manageToggleText: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  secondarySync: {
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionRow: { flexDirection: "row", gap: 10, marginTop: 10 },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  secondaryText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  removeOnly: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  removeText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  result: { fontSize: 12, lineHeight: 18, fontWeight: "700", marginTop: 13 },
  error: { fontSize: 12, lineHeight: 18, marginTop: 12 },
});
