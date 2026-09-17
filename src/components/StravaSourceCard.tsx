import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  getHealthConnectOverview,
  HealthConnectOverview,
} from "@/data/healthConnect/healthConnectRepository";
import { relativeAge } from "@/domain/time";
import { useAppTheme } from "@/theme/theme";

import { SectionCard } from "./SectionCard";

type StravaLoadState = "loading" | "ready" | "unavailable";

export function StravaSourceCard({
  onOpenHealthConnect,
}: {
  onOpenHealthConnect(): void;
}) {
  const { colors, radius } = useAppTheme();
  const [overview, setOverview] = useState<HealthConnectOverview>();
  const [loadState, setLoadState] = useState<StravaLoadState>("loading");
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadState("loading");
    try {
      const next = await getHealthConnectOverview();
      if (loadGeneration.current !== generation) return;
      setOverview(next);
      setLoadState("ready");
    } catch {
      if (loadGeneration.current !== generation) return;
      setOverview(undefined);
      setLoadState("unavailable");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      loadGeneration.current += 1;
    };
  }, [load]);

  const strava = useMemo(
    () =>
      loadState === "ready"
        ? overview?.sources.find((source) =>
            /strava/i.test(`${source.packageName} ${source.displayName}`),
          )
        : undefined,
    [loadState, overview?.sources],
  );

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.warning}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.warning}
            name="bicycle-outline"
            size={24}
          />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Strava via Health Connect
          </Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Connect inside the Strava Android app first. T1 Arc then reads new
            GPS activities through Health Connect.
          </Text>
        </View>
      </View>

      <View
        accessible
        accessibilityLabel={
          loadState === "loading"
            ? "Checking Strava in Health Connect"
            : loadState === "unavailable"
              ? "Strava connection status is unavailable"
              : strava
                ? "A Strava activity was received through Health Connect"
                : "No Strava activity has been received through Health Connect"
        }
        accessibilityLiveRegion="polite"
        accessibilityState={{ busy: loadState === "loading" }}
        style={[
          styles.status,
          {
            backgroundColor:
              loadState === "unavailable"
                ? `${colors.warning}12`
                : strava
                  ? `${colors.accent}12`
                  : colors.surfaceMuted,
            borderColor:
              loadState === "unavailable"
                ? `${colors.warning}36`
                : strava
                  ? `${colors.accent}38`
                  : colors.divider,
            borderRadius: radius.md,
          },
        ]}
      >
        {loadState === "loading" ? (
          <ActivityIndicator
            accessibilityElementsHidden
            color={colors.textTertiary}
            size="small"
          />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={
              loadState === "unavailable"
                ? colors.warning
                : strava
                  ? colors.accent
                  : colors.textTertiary
            }
            name={
              loadState === "unavailable"
                ? "alert-circle-outline"
                : strava
                  ? "checkmark-circle-outline"
                  : "hourglass-outline"
            }
            size={19}
          />
        )}
        <View style={styles.statusCopy}>
          <Text style={[styles.statusTitle, { color: colors.text }]}>
            {loadState === "loading"
              ? "Checking connection"
              : loadState === "unavailable"
                ? "Connection status unavailable"
                : strava
                  ? "Activity received"
                  : "No Strava activity found yet"}
          </Text>
          <Text style={[styles.statusDetail, { color: colors.textSecondary }]}>
            {loadState === "loading"
              ? "Reading Health Connect on this phone…"
              : loadState === "unavailable"
                ? "T1 Arc could not safely check Health Connect."
                : strava
                  ? `Last activity received ${relativeAge(strava.lastSeenAt)}.`
                  : "This status changes after Strava writes a new GPS activity to Health Connect."}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityLabel={
          loadState === "loading"
            ? "Checking Strava in Health Connect"
            : loadState === "unavailable"
              ? "Check Strava connection again"
              : strava
                ? "Manage Strava in Health Connect"
                : "Open Health Connect settings"
        }
        accessibilityRole="button"
        accessibilityState={{
          busy: loadState === "loading",
          disabled: loadState === "loading",
        }}
        disabled={loadState === "loading"}
        onPress={
          loadState === "unavailable" ? () => void load() : onOpenHealthConnect
        }
        style={({ pressed }) => [
          styles.primary,
          {
            backgroundColor:
              loadState !== "ready" || strava
                ? colors.surfaceMuted
                : colors.primary,
            borderColor:
              loadState !== "ready" || strava ? colors.border : colors.primary,
            borderRadius: radius.md,
            opacity: pressed || loadState === "loading" ? 0.72 : 1,
          },
        ]}
      >
        {loadState === "loading" ? (
          <ActivityIndicator
            accessibilityElementsHidden
            color={colors.textTertiary}
            size="small"
          />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={
              loadState === "unavailable" || strava
                ? colors.primary
                : colors.onPrimary
            }
            name={
              loadState === "unavailable" ? "refresh-outline" : "open-outline"
            }
            size={18}
          />
        )}
        <Text
          style={[
            styles.primaryText,
            {
              color:
                loadState === "loading"
                  ? colors.textTertiary
                  : loadState === "unavailable" || strava
                    ? colors.primary
                    : colors.onPrimary,
            },
          ]}
        >
          {loadState === "loading"
            ? "Checking Health Connect…"
            : loadState === "unavailable"
              ? "Try again"
              : strava
                ? "Manage Health Connect"
                : "Open Health Connect settings"}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  detail: { marginTop: 3, fontSize: 12, lineHeight: 18 },
  status: {
    minHeight: 72,
    marginTop: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusCopy: { flex: 1, minWidth: 0 },
  statusTitle: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  statusDetail: { marginTop: 2, fontSize: 12, lineHeight: 18 },
  primary: {
    minHeight: 52,
    marginTop: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  secondary: {
    minHeight: 48,
    marginTop: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
    textAlign: "center",
  },
});
