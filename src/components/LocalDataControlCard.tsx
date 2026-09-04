import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from "react-native";

import { getLocalDataResetState } from "@/data/privacy/localDataResetState";
import {
  LocalDataSummary,
  localDataRecordCount,
  localDataStoredItemCount,
} from "@/domain/localDataSummary";
import { useDataContext } from "@/providers/DataProvider";
import { useAppTheme } from "@/theme/theme";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";

import { SectionCard } from "./SectionCard";

const EMPTY_SUMMARY: LocalDataSummary = {
  glucoseReadings: 0,
  insulinRecords: 0,
  contextRecords: 0,
  foodLogs: 0,
  foodRecipes: 0,
  healthConnectRecords: 0,
  retainedSourceExports: 0,
  notificationSourceEvents: 0,
  savedInsightReports: 0,
};

function VaultFact({ label, value }: { label: string; value: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factValue, { color: colors.text }]}>
        {formatRegionalNumber(value, getRuntimeRegionalDefaults().locale)}
      </Text>
      <Text style={[styles.factLabel, { color: colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

export function LocalDataControlCard({ onErased }: { onErased(): void }) {
  const { colors, radius } = useAppTheme();
  const {
    eraseAllLocalHealthData,
    glookoReportSyncing,
    glookoSyncing,
    revision,
    syncing,
  } = useDataContext();
  const [summary, setSummary] = useState<LocalDataSummary>();
  const [hasSavedConfiguration, setHasSavedConfiguration] = useState<boolean>();
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setHasSavedConfiguration(undefined);
    });
    void getLocalDataResetState()
      .then((next) => {
        if (active) {
          setSummary(next.summary);
          setHasSavedConfiguration(next.hasResettableConfiguration);
          setError(undefined);
        }
      })
      .catch(() => {
        if (active) {
          setSummary(undefined);
          setHasSavedConfiguration(undefined);
          setError(
            "T1 Arc could not safely check everything stored on this device. Try again before erasing.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const hasStoredData = summary ? localDataStoredItemCount(summary) > 0 : false;

  const disabled =
    erasing ||
    syncing ||
    glookoSyncing ||
    glookoReportSyncing ||
    !summary ||
    (!hasStoredData && !hasSavedConfiguration);

  async function erase() {
    setErasing(true);
    setError(undefined);
    try {
      const removed = await eraseAllLocalHealthData();
      setSummary(EMPTY_SUMMARY);
      setHasSavedConfiguration(false);
      onErased();
      if (Platform.OS === "android") {
        ToastAndroid.show(
          `${formatRegionalNumber(localDataRecordCount(removed), getRuntimeRegionalDefaults().locale)} local health records erased.`,
          ToastAndroid.LONG,
        );
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The local data could not be erased.",
      );
    } finally {
      setErasing(false);
    }
  }

  function confirmErase() {
    Alert.alert(
      "Erase all T1 Arc health data?",
      "This removes health history, saved reviews and source connections from this device. Your data in other apps and services is not changed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "This cannot be undone",
              "Create an encrypted backup first if you may need this history again. Android Health Connect permissions remain under Android control, but every T1 Arc category is switched off so erased records are not silently copied back.",
              [
                { text: "Keep my data", style: "cancel" },
                {
                  text: "Erase this device",
                  style: "destructive",
                  onPress: () => void erase(),
                },
              ],
            );
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
              backgroundColor: `${colors.danger}12`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.danger}
            name="shield-outline"
            size={23}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Data on this device
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Health history, saved reviews and source connections kept privately
            on this phone.
          </Text>
        </View>
      </View>

      {summary ? (
        <View
          accessibilityLabel={`${localDataRecordCount(summary)} encrypted T1 Arc health records`}
          style={[styles.facts, { borderColor: colors.divider }]}
        >
          <VaultFact
            label="Encrypted health records"
            value={localDataRecordCount(summary)}
          />
          <VaultFact
            label="Saved reviews"
            value={summary.savedInsightReports}
          />
        </View>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Counting encrypted records…
          </Text>
        </View>
      )}

      <Text style={[styles.warning, { color: colors.textSecondary }]}>
        This removes T1 Arc&apos;s health history and source connections from this
        phone. Other apps and services are not changed.
      </Text>
      {error ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={[styles.error, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel="Erase all T1 Arc data from this device"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={confirmErase}
        style={({ pressed }) => [
          styles.eraseButton,
          {
            borderColor: disabled ? colors.divider : `${colors.danger}88`,
            borderRadius: radius.md,
            opacity: pressed ? 0.65 : 1,
          },
        ]}
      >
        {erasing ? (
          <ActivityIndicator color={colors.danger} />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={disabled ? colors.textTertiary : colors.danger}
            name="trash-outline"
            size={18}
          />
        )}
        <Text
          style={[
            styles.eraseText,
            { color: disabled ? colors.textTertiary : colors.danger },
          ]}
        >
          {erasing ? "Erasing securely…" : "Erase all data from this device"}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  icon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "800",
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  facts: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 16,
    paddingVertical: 6,
  },
  fact: {
    width: "50%",
    minHeight: 64,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  factValue: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  factLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },
  loading: {
    minHeight: 90,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  loadingText: {
    fontSize: 12,
    lineHeight: 18,
  },
  warning: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 13,
  },
  error: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  eraseButton: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 14,
  },
  eraseText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
});
